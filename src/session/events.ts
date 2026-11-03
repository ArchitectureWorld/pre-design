import type { GovernanceRepository } from '../governance/repository.ts'
import type {} from '@deepseek-ai/dsh-session/types'
import { deriveSiteBoundaryState } from '../governance/site-boundary-status.ts'
import type { ArtifactRecord, ReportPackageRecord, SiteBoundarySource, SiteBoundaryStateSummary } from '../governance/types.ts'
import type { PresentationAutoSyncService, PresentationAutoSyncState } from '../presentation/auto-sync.ts'
import type { WorkflowRuntime } from '../runtime/workflow-runtime.ts'
import type { ProjectContext } from '../state/types.ts'
import { reportLinkFormats, reportLinks, type ReportPackageLinks } from '../client/report-links.ts'
import type { ReportDeliveryState } from '../report/delivery-state.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'preplanning/status': PreplanningStatusEventData
  }
}

export interface PreplanningChapterStatus {
  readonly id: string
  readonly completed: number
  readonly total: number
  readonly gateStatus: string
}

export interface PreplanningBlockerStatus {
  readonly workflowId: string
  readonly workItemId: string
  readonly reason: string
}

export interface PreplanningBoundaryStatus {
  readonly kind: SiteBoundaryStateSummary['kind']
  readonly label: string
  readonly source?: SiteBoundarySource
  readonly nextAction: string
}

export interface PreplanningPresentationStatus {
  readonly state: PresentationAutoSyncState
  readonly currentRevision: number
  readonly syncedRevision: number
  readonly message?: string
}

export interface PreplanningStatusEventData {
  readonly researchProgress?: { readonly scheme: 'research-v210'; readonly status: string; readonly total: number; readonly qualified: number; readonly chapters: readonly PreplanningChapterStatus[]; readonly stage?: string; readonly blockers?: readonly PreplanningBlockerStatus[] }
  readonly reportDelivery?: ReportDeliveryState
  readonly projectId: string
  readonly projectName: string
  readonly revision: number
  readonly stage: string
  readonly status: 'active' | 'attention_required' | 'pending_review'
  readonly pendingProposalCount: number
  readonly pendingProposalId?: string
  readonly openQuestionCount: number
  readonly mode: 'manual' | 'automatic'
  readonly reportDepth: 'standard' | 'extended'
  readonly chapters: readonly PreplanningChapterStatus[]
  readonly blocked: number
  readonly blockers?: readonly PreplanningBlockerStatus[]
  readonly visual: { readonly candidates: number; readonly adopted: number; readonly blocked: number }
  readonly boundary: PreplanningBoundaryStatus
  readonly modelRoute: { readonly primary: string; readonly visual: string }
  readonly presentation?: PreplanningPresentationStatus
  readonly reportPackage?: ReportPackageLinks
  readonly reportError?: string
}

export interface PreplanningStatusDependencies {
  readonly researchProgress?: (projectId: string) => PreplanningStatusEventData['researchProgress']
  readonly reportDelivery?:(projectId:string)=>ReportDeliveryState|undefined
  readonly reportErrors?: ReadonlyMap<string, string>
  readonly reportFormats?: (record: ReportPackageRecord) => readonly ArtifactRecord['format'][] | undefined
  readonly governance: Pick<GovernanceRepository, 'readProject'>
  readonly runtime: Pick<WorkflowRuntime, 'snapshot'>
  readonly presentationSync?: Pick<PresentationAutoSyncService, 'status'>
}

const CHAPTER_TOTALS = [7, 8, 6, 6, 7, 7, 8, 8] as const
const PRIMARY_MODEL_ROUTE = '当前 DSH Session 所选模型'
const VISUAL_MODEL_ROUTE = '按子 Agent 类配置；实际模型见前期策划面板'
const PRESENTATION_STATES: readonly PresentationAutoSyncState[] = [
  'pending', 'syncing', 'synced', 'migration_required', 'external_changes', 'error',
]

function statusBoundary(records: Parameters<typeof deriveSiteBoundaryState>[0], revision: number): PreplanningBoundaryStatus {
  const state = deriveSiteBoundaryState(records, revision)
  const { kind, label, nextAction } = state
  return 'source' in state
    ? { kind, label, source: state.source, nextAction }
    : { kind, label, nextAction }
}

function defaultBoundary(revision = 0): PreplanningBoundaryStatus {
  return statusBoundary([], revision)
}

function defaultChapters(): PreplanningChapterStatus[] {
  return CHAPTER_TOTALS.map((total, index) => ({
    id: String(index + 1).padStart(2, '0'), completed: 0, total, gateStatus: 'pending',
  }))
}

function baseStatus(context: ProjectContext) {
  const pendingProposals = context.proposals.filter(proposal => proposal.status === 'pending_review')
  const pendingProposalCount = pendingProposals.length
  const openQuestionCount = context.questions.filter(question => question.status === 'open').length
  return {
    projectId: context.project.projectId,
    projectName: context.project.name,
    revision: context.project.currentRevision,
    stage: context.project.currentStage,
    status: pendingProposalCount > 0
      ? 'pending_review' as const
      : openQuestionCount > 0 ? 'attention_required' as const : 'active' as const,
    pendingProposalCount,
    ...(pendingProposals[0] === undefined ? {} : { pendingProposalId: pendingProposals[0].proposalId }),
    openQuestionCount,
  }
}

function presentationStatus(
  context: ProjectContext,
  dependencies: PreplanningStatusDependencies,
): PreplanningPresentationStatus | undefined {
  const value = dependencies.presentationSync?.status(
    context.project.projectId,
    context.project.currentRevision,
  )
  if (value === undefined) return undefined
  return {
    state: value.state,
    currentRevision: value.currentRevision,
    syncedRevision: value.syncedRevision,
    ...(value.message === undefined ? {} : { message: value.message }),
  }
}

export function buildPreplanningStatus(
  context: ProjectContext,
  dependencies?: PreplanningStatusDependencies,
): PreplanningStatusEventData {
  const base = baseStatus(context)
  if (dependencies === undefined) return {
    ...base,
    mode: 'manual', reportDepth: 'standard', chapters: defaultChapters(), blocked: 0, blockers: [],
    visual: { candidates: 0, adopted: 0, blocked: 0 },
    boundary: defaultBoundary(context.project.currentRevision),
    modelRoute: { primary: PRIMARY_MODEL_ROUTE, visual: VISUAL_MODEL_ROUTE },
  }
  const governed = dependencies.governance.readProject(context.project.projectId)
  const workflow = dependencies.runtime.snapshot(context.project.projectId)
  // Automatic commits advance workflow runs, while the legacy project stage may
  // remain at its seed value. Project status must reflect the actual run snapshot.
  const runs = workflow.runs ?? []
  let stage = base.stage
  if (governed.policy?.mode === 'automatic') {
    const current = ['running', 'blocked', 'pending_review', 'ready']
      .map(status => runs.filter(run => run.status === status))
      .find(rows => rows.length > 0)
    const latestConfirmed = runs.filter(run => run.status === 'confirmed'
      && (run.confirmedRevision ?? 0) <= context.project.currentRevision)
      .sort((left, right) => (right.confirmedRevision ?? 0) - (left.confirmedRevision ?? 0))[0]
    stage = current?.map(run => run.workItemId).sort().join('、') ?? latestConfirmed?.workItemId ?? stage
  }
  const gateByChapter = new Map<string, { revision: number; decision: string }>()
  for (const gate of governed.gateDecisions) {
    if (gate.revision > context.project.currentRevision) continue
    const chapterId = gate.gateId.replace(/^G/u, '').padStart(2, '0')
    const existing = gateByChapter.get(chapterId)
    if (existing === undefined || existing.revision <= gate.revision) gateByChapter.set(chapterId, gate)
  }
  const latestPackage = [...governed.reportPackages]
    .filter(row => (row.status === 'published' || row.status === 'generated_conditional') && row.sourceRevision <= context.project.currentRevision)
    .sort((left, right) => left.sourceRevision - right.sourceRevision || (left.createdAt ?? '').localeCompare(right.createdAt ?? '') || left.packageId.localeCompare(right.packageId))
    .at(-1)
  const presentation = presentationStatus(context, dependencies)
  const latestReportAttempt = [...governed.reportPackages].filter(row => row.sourceRevision === context.project.currentRevision)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1)
  let reportPackage: ReportPackageLinks | undefined
  let manifestError: string | undefined
  if (latestPackage !== undefined) {
    const metadata = { deliveryMode: latestPackage.status === 'generated_conditional' ? 'conditional' as const : 'formal' as const,
      sourceRevision: latestPackage.sourceRevision,...(latestPackage.acceptanceState==='passed'&&latestPackage.acceptanceHash?{acceptanceState:'passed' as const}:{}) }
    reportPackage = { id: latestPackage.packageId, ...metadata }
    try {
      const formats = dependencies.reportFormats?.(latestPackage)
      if (formats === undefined || formats.length === 0) throw new Error('REPORT_MANIFEST_UNAVAILABLE')
      reportPackage = reportLinks(latestPackage.packageId, metadata, formats)
    } catch {
      reportPackage={id:latestPackage.packageId,...metadata,...(latestPackage.acceptanceState?{acceptanceState:'unverified' as const}:{})}
      manifestError = '成果清单缺失或校验失败，暂不提供下载链接；请重新生成成果。'
    }
  }
  const researchProgress = dependencies.researchProgress?.(context.project.projectId)
  return {
    ...base,
    stage: researchProgress?.stage ?? stage,
    mode: governed.policy?.mode ?? 'manual',
    reportDepth: governed.policy?.reportDepth ?? 'standard',
    ...(researchProgress ? { researchProgress } : {}),
    chapters: researchProgress?.chapters ?? workflow.chapters.map(chapter => ({
      id: chapter.chapterId,
      completed: chapter.completed,
      total: chapter.total,
      gateStatus: chapter.completed === chapter.total ? gateByChapter.get(chapter.chapterId)?.decision ?? 'pending' : 'pending',
    })),
    blocked: researchProgress ? researchProgress.blockers?.length ?? 0 : workflow.blocked.length,
    blockers: researchProgress ? researchProgress.blockers ?? [] : workflow.blocked.map(run => ({
      workflowId: run.workflowId,
      workItemId: run.workItemId,
      reason: run.blockedReason ?? '工作项受阻，原因未记录。',
    })),
    visual: {
      candidates: governed.visualAssets.filter(row => row.status === 'candidate').length,
      adopted: governed.visualAssets.filter(row => row.status === 'adopted').length,
      blocked: governed.visualTasks.filter(row => row.status === 'blocked').length,
    },
    boundary: statusBoundary(governed.siteBoundaries, context.project.currentRevision),
    modelRoute: { primary: PRIMARY_MODEL_ROUTE, visual: VISUAL_MODEL_ROUTE },
    ...(presentation === undefined ? {} : { presentation }),
    ...(reportPackage === undefined ? {} : { reportPackage }),
    ...(dependencies.reportDelivery?.(context.project.projectId)?.revision===context.project.currentRevision?{reportDelivery:manifestError?{...dependencies.reportDelivery(context.project.projectId)!,status:'failed' as const,message:manifestError}:dependencies.reportDelivery(context.project.projectId)}:{}),
    ...(dependencies.reportErrors?.has(context.project.projectId)
      ? { reportError: dependencies.reportErrors.get(context.project.projectId)! }
      : latestReportAttempt?.status === 'failed' ? { reportError: latestReportAttempt.warnings.join('；') || '报告生成失败。' }
        : manifestError === undefined ? {} : { reportError: manifestError }),
  }
}

export function formatPreplanningStatus(status: PreplanningStatusEventData): string {
  const pendingLabel = status.mode === 'automatic' ? '自动处理' : '待确认'
  const proposal = status.pendingProposalId === undefined ? '' : `，${pendingLabel}提案 ${JSON.stringify(status.pendingProposalId)}`
  const base = `前期策划状态：项目 ${JSON.stringify(status.projectName)}（${status.projectId}），revision ${status.revision}，阶段 ${status.stage}，${pendingLabel} ${status.pendingProposalCount} 项，开放问题 ${status.openQuestionCount} 项${proposal}。`
  const chapters = status.chapters
    .map(chapter => `${chapter.id}=${chapter.completed}/${chapter.total}/${chapter.gateStatus}`)
    .join(',')
  const report = status.reportPackage?.id ?? 'none'
  const source = status.boundary.source === undefined ? '' : `（来源 ${JSON.stringify(status.boundary.source)}）`
  const detail = `前期策划全流程：模式 ${status.mode}；报告 ${status.reportDepth}；阻断 ${status.blocked}；视觉 ${status.visual.candidates}/${status.visual.adopted}/${status.visual.blocked}；章节 ${chapters}；成果 ${report}；主模型 ${JSON.stringify(status.modelRoute.primary)}；视觉模型 ${JSON.stringify(status.modelRoute.visual)}；场地边界 ${JSON.stringify(status.boundary.label)}${source}；边界补充事项 ${JSON.stringify(status.boundary.nextAction)}。`
  const blockers = (status.blockers?.length ?? 0) === 0
    ? ''
    : `\n前期策划阻断详情：${JSON.stringify(status.blockers)}。`
  const presentation = status.presentation === undefined
    ? ''
    : `\n前期策划 Presentation：${JSON.stringify(status.presentation)}。`
  const reportDetails = status.reportPackage === undefined ? ''
    : `\n前期策划成果信息：${JSON.stringify({ id: status.reportPackage.id, sourceRevision: status.reportPackage.sourceRevision,
      deliveryMode: status.reportPackage.deliveryMode, acceptanceState:status.reportPackage.acceptanceState, formats: reportLinkFormats(status.reportPackage) })}。`
  const reportError = status.reportError === undefined ? '' : `\n前期策划成果错误：${JSON.stringify(status.reportError)}。`
  const delivery=status.reportDelivery===undefined?'':`\n前期策划质量验收：${JSON.stringify(status.reportDelivery)}。`
  const research = status.researchProgress ? `\n新版研究执行：${JSON.stringify(status.researchProgress)}。` : ''
  return `${base}\n${detail}${blockers}${presentation}${reportDetails}${reportError}${delivery}${research}`
}
const DELIVERY_PATTERN=/(?:^|\n)前期策划质量验收：(\{[^\n]*\})。(?:$|\n)/u
function normalizedDelivery(value:unknown,projectId:string,revision:number):ReportDeliveryState|undefined{
  if(!value||typeof value!=='object')return undefined
  const r=value as ReportDeliveryState
  return r.projectId===projectId&&r.revision===revision&&typeof r.contractVersion==='string'&&['generating','pending','failed','passed'].includes(r.status)&&typeof r.message==='string'&&typeof r.updatedAt==='string'?r:undefined
}

const STATUS_PATTERN = /(?:^|\n)前期策划状态：项目 ("(?:\\.|[^"\\])*")（([^）\r\n]+)），revision (\d+)，阶段 ([^，\r\n]+)，(?:待确认|自动处理) (\d+) 项，开放问题 (\d+) 项(?:，(?:待确认|自动处理)提案 ("(?:\\.|[^"\\])*"))?。(?:$|\n)/u
const DETAIL_PATTERN = /(?:^|\n)前期策划全流程：模式 (manual|automatic)；报告 (standard|extended)；阻断 (\d+)；视觉 (\d+)\/(\d+)\/(\d+)；章节 ([^；\r\n]+)；成果 ([A-Za-z0-9._-]+|none)；主模型 ("(?:\\.|[^"\\])*")；视觉模型 ("(?:\\.|[^"\\])*")(?:；场地边界 ("(?:\\.|[^"\\])*")(?:（来源 ("(?:\\.|[^"\\])*")）)?；(?:下一步|边界补充事项) ("(?:\\.|[^"\\])*"))?。(?:$|\n)/u
const BLOCKERS_PATTERN = /(?:^|\n)前期策划阻断详情：(\[[^\r\n]*\])。(?:$|\n)/u
const PRESENTATION_PATTERN = /(?:^|\n)前期策划 Presentation：(\{[^\r\n]*\})。(?:$|\n)/u
const REPORT_PATTERN = /(?:^|\n)前期策划成果信息：(\{[^\r\n]*\})。(?:$|\n)/u
const REPORT_ERROR_PATTERN = /(?:^|\n)前期策划成果错误：("(?:\\.|[^"\\])*")。(?:$|\n)/u

function parseChapters(text: string): PreplanningChapterStatus[] | undefined {
  const chapters = text.split(',').map(value => {
    const match = /^(\d{2})=(\d+)\/(\d+)\/([^,；\r\n]+)$/u.exec(value)
    if (match === null) return undefined
    return { id: match[1]!, completed: Number(match[2]), total: Number(match[3]), gateStatus: match[4]! }
  })
  return chapters.some(chapter => chapter === undefined) ? undefined : chapters as PreplanningChapterStatus[]
}

function parseBoundary(
  encodedLabel: string | undefined,
  encodedSource: string | undefined,
  encodedNextAction: string | undefined,
): PreplanningBoundaryStatus | undefined {
  if (encodedLabel === undefined || encodedNextAction === undefined) return defaultBoundary()
  const label = JSON.parse(encodedLabel) as string
  const nextAction = JSON.parse(encodedNextAction) as string
  if (label === '尚未提供场地边界') return { kind: 'not_provided', label, nextAction }
  const source = encodedSource === undefined ? undefined : JSON.parse(encodedSource) as SiteBoundarySource
  if (source === undefined) return undefined
  if (label === '场地边界待项目负责人确认') return { kind: 'pending_confirmation', label, source, nextAction }
  if (label === '场地边界已正式确认') return { kind: 'confirmed_formal_boundary', label, source, nextAction }
  if (label === '模拟研究范围（不可正式确认）') return { kind: 'synthetic_research', label, source, nextAction }
  return undefined
}

function normalizedBlockers(value: unknown): PreplanningBlockerStatus[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const blockers: PreplanningBlockerStatus[] = []
  for (const candidate of value) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined
    const record = candidate as Record<string, unknown>
    if (typeof record.workflowId !== 'string' || record.workflowId.trim() === ''
      || typeof record.workItemId !== 'string' || record.workItemId.trim() === ''
      || typeof record.reason !== 'string' || record.reason.trim() === '') return undefined
    blockers.push({
      workflowId: record.workflowId,
      workItemId: record.workItemId,
      reason: record.reason,
    })
  }
  return blockers
}

function blockersFromText(text: string): PreplanningBlockerStatus[] | undefined {
  const match = BLOCKERS_PATTERN.exec(text)
  if (match === null) return []
  try {
    return normalizedBlockers(JSON.parse(match[1]!))
  } catch {
    return undefined
  }
}

function normalizedBoundary(value: unknown, revision: number): PreplanningBoundaryStatus {
  const fallback = defaultBoundary(revision)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fallback
  const boundary = value as Record<string, unknown>
  const kind = boundary.kind
  if (kind === 'not_provided'
    && boundary.label === '尚未提供场地边界'
    && boundary.nextAction === '请提供总平图、红线图或闭合红线坐标。') {
    return { kind, label: boundary.label, nextAction: boundary.nextAction }
  }
  const source = boundary.source
  if (source !== 'approved_site_plan' && source !== 'approved_redline'
    && source !== 'closed_coordinates' && source !== 'geojson') return fallback
  if (kind === 'pending_confirmation'
    && boundary.label === '场地边界待项目负责人确认'
    && boundary.nextAction === '请项目负责人确认采用当前边界表达。') {
    return { kind, label: boundary.label, source, nextAction: boundary.nextAction }
  }
  if (kind === 'confirmed_formal_boundary'
    && boundary.label === '场地边界已正式确认'
    && boundary.nextAction === '可作为正式边界用于后续工作。') {
    return { kind, label: boundary.label, source, nextAction: boundary.nextAction }
  }
  if (kind === 'synthetic_research'
    && boundary.label === '模拟研究范围（不可正式确认）'
    && boundary.nextAction === '请提供真实总平图、红线图或带 CRS 的闭合几何') {
    return { kind, label: boundary.label, source, nextAction: boundary.nextAction }
  }
  return fallback
}

function normalizedPresentation(value: unknown): PreplanningPresentationStatus | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!PRESENTATION_STATES.includes(record.state as PresentationAutoSyncState)
    || typeof record.currentRevision !== 'number' || !Number.isSafeInteger(record.currentRevision) || record.currentRevision < 0
    || typeof record.syncedRevision !== 'number' || !Number.isSafeInteger(record.syncedRevision) || record.syncedRevision < 0
    || (record.message !== undefined && typeof record.message !== 'string')) return undefined
  return {
    state: record.state as PresentationAutoSyncState,
    currentRevision: record.currentRevision,
    syncedRevision: record.syncedRevision,
    ...(typeof record.message === 'string' ? { message: record.message } : {}),
  }
}

function presentationFromText(text: string): PreplanningPresentationStatus | undefined {
  const match = PRESENTATION_PATTERN.exec(text)
  if (match === null) return undefined
  try {
    return normalizedPresentation(JSON.parse(match[1]!))
  } catch {
    return undefined
  }
}

export function parsePreplanningStatus(text: string): PreplanningStatusEventData | undefined {
  const match = STATUS_PATTERN.exec(text)
  if (match === null) return undefined
  const [, encodedName, projectId, revisionText, stage, pendingText, openText, encodedProposalId] = match
  const revision = Number(revisionText)
  const pendingProposalCount = Number(pendingText)
  const openQuestionCount = Number(openText)
  if (![revision, pendingProposalCount, openQuestionCount].every(Number.isSafeInteger)) return undefined
  const blockers = blockersFromText(text)
  if (blockers === undefined) return undefined
  let researchProgress: PreplanningStatusEventData['researchProgress']
  try {const raw=/(?:^|\n)新版研究执行：(\{[^\n]*\})。/u.exec(text)?.[1];if(raw){researchProgress=normalizedResearchProgress(JSON.parse(raw));if(!researchProgress)return undefined}} catch{return undefined}
  const presentation = presentationFromText(text)
  const base = {
    ...(researchProgress ? {researchProgress} : {}),
    projectId,
    projectName: JSON.parse(encodedName) as string,
    revision,
    stage,
    status: pendingProposalCount > 0
      ? 'pending_review' as const
      : openQuestionCount > 0 ? 'attention_required' as const : 'active' as const,
    pendingProposalCount,
    ...(encodedProposalId === undefined ? {} : { pendingProposalId: JSON.parse(encodedProposalId) as string }),
    openQuestionCount,
    blockers,
    ...(presentation === undefined ? {} : { presentation }),
  }
  const detail = DETAIL_PATTERN.exec(text)
  if (detail === null) return {
    ...base,
    mode: 'manual', reportDepth: 'standard', chapters: defaultChapters(), blocked: blockers.length,
    visual: { candidates: 0, adopted: 0, blocked: 0 },
    boundary: defaultBoundary(revision),
    modelRoute: { primary: PRIMARY_MODEL_ROUTE, visual: VISUAL_MODEL_ROUTE },
  }
  const chapters = parseChapters(detail[7]!)
  if (chapters === undefined) return undefined
  const boundary = parseBoundary(detail[11], detail[12], detail[13])
  if (boundary === undefined) return undefined
  const packageId = detail[8]!
  let packageLinks = packageId === 'none' ? undefined : reportLinks(packageId)
  try {
    const metadata = REPORT_PATTERN.exec(text)?.[1]
    if (metadata !== undefined) {
      const row = JSON.parse(metadata) as Partial<ReportPackageLinks> & { formats?: readonly ArtifactRecord['format'][] }
      if (row.id !== packageId
        || (row.sourceRevision !== undefined && (!Number.isSafeInteger(row.sourceRevision) || row.sourceRevision < 0 || row.sourceRevision > revision))
        || (row.deliveryMode !== undefined && row.deliveryMode !== 'formal' && row.deliveryMode !== 'conditional')) return undefined
      packageLinks = reportLinks(packageId, {
        acceptanceState:row.acceptanceState, sourceRevision:row.sourceRevision, deliveryMode:row.deliveryMode,
      }, row.formats === undefined ? [] : row.formats)
    }
  } catch { return undefined }
  const reportError = REPORT_ERROR_PATTERN.exec(text)?.[1]
  let delivery:ReportDeliveryState|undefined
  try{const encoded=DELIVERY_PATTERN.exec(text)?.[1];if(encoded){delivery=normalizedDelivery(JSON.parse(encoded),projectId,revision);if(!delivery)return undefined}}catch{return undefined}
  return {
    ...base,
    mode: detail[1] as PreplanningStatusEventData['mode'],
    reportDepth: detail[2] as PreplanningStatusEventData['reportDepth'],
    blocked: Number(detail[3]),
    visual: { candidates: Number(detail[4]), adopted: Number(detail[5]), blocked: Number(detail[6]) },
    chapters,
    modelRoute: { primary: JSON.parse(detail[9]!) as string, visual: JSON.parse(detail[10]!) as string },
    boundary,
    ...(packageLinks === undefined ? {} : { reportPackage: packageLinks }),
    ...(delivery?{reportDelivery:delivery}:{}),
    ...(reportError === undefined ? {} : { reportError: JSON.parse(reportError) as string }),
  }
}

export function normalizePreplanningStatus(value: unknown): PreplanningStatusEventData | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if(record.researchProgress!==undefined&&!normalizedResearchProgress(record.researchProgress))return undefined
  if(record.reportDelivery!==undefined&&!normalizedDelivery(record.reportDelivery,String(record.projectId),Number(record.revision)))return undefined
  if (record.reportError !== undefined && typeof record.reportError !== 'string') return undefined
  if (typeof record.projectId !== 'string' || typeof record.projectName !== 'string'
    || typeof record.revision !== 'number' || !Number.isSafeInteger(record.revision) || record.revision < 0
    || typeof record.stage !== 'string'
    || (record.status !== 'active' && record.status !== 'attention_required' && record.status !== 'pending_review')
    || typeof record.pendingProposalCount !== 'number' || !Number.isSafeInteger(record.pendingProposalCount)
    || typeof record.openQuestionCount !== 'number' || !Number.isSafeInteger(record.openQuestionCount)) return undefined
  const blockers = normalizedBlockers(record.blockers)
  if (blockers === undefined) return undefined
  const presentation = normalizedPresentation(record.presentation)
  if (record.presentation !== undefined && presentation === undefined) return undefined
  let normalizedReport: ReportPackageLinks | undefined
  if (record.reportPackage !== undefined) {
    if (record.reportPackage === null || typeof record.reportPackage !== 'object') return undefined
    const report = record.reportPackage as Partial<ReportPackageLinks>
    if (typeof report.id !== 'string'
      || (report.deliveryMode !== undefined && report.deliveryMode !== 'formal' && report.deliveryMode !== 'conditional')
      || (report.sourceRevision !== undefined && (!Number.isSafeInteger(report.sourceRevision) || report.sourceRevision < 0 || report.sourceRevision > record.revision))) return undefined
    try { normalizedReport = reportLinks(report.id, {
      acceptanceState:report.acceptanceState, deliveryMode:report.deliveryMode, sourceRevision:report.sourceRevision,
    }, reportLinkFormats(report as ReportPackageLinks)) } catch { return undefined }
  }
  const base = record as unknown as Omit<PreplanningStatusEventData, 'mode' | 'reportDepth' | 'chapters' | 'blocked' | 'blockers' | 'visual' | 'modelRoute' | 'boundary' | 'presentation'>
  const rich = record.mode === 'manual' || record.mode === 'automatic'
  if (!rich) return {
    ...base, mode: 'manual', reportDepth: 'standard', chapters: defaultChapters(), blocked: blockers.length, blockers,
    ...(normalizedReport === undefined ? {} : { reportPackage: normalizedReport }),
    visual: { candidates: 0, adopted: 0, blocked: 0 },
    boundary: defaultBoundary(record.revision),
    modelRoute: { primary: PRIMARY_MODEL_ROUTE, visual: VISUAL_MODEL_ROUTE },
    ...(presentation === undefined ? {} : { presentation }),
  }
  return {
    ...(value as Omit<PreplanningStatusEventData, 'blockers' | 'boundary' | 'presentation'>),
    ...(normalizedReport === undefined ? {} : { reportPackage: normalizedReport }),
    blockers,
    boundary: normalizedBoundary(record.boundary, record.revision),
    ...(presentation === undefined ? {} : { presentation }),
  }
}

function normalizedResearchProgress(value: unknown): PreplanningStatusEventData['researchProgress'] {
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined
  const row=value as PreplanningStatusEventData['researchProgress']
  if(row!.scheme!=='research-v210'||typeof row!.status!=='string'||!Number.isSafeInteger(row!.total)||!Number.isSafeInteger(row!.qualified)
    ||row!.qualified<0||row!.qualified>row!.total||!Array.isArray(row!.chapters)||row!.chapters.length!==8
    ||row!.stage!==undefined&&typeof row!.stage!=='string'||normalizedBlockers(row!.blockers)===undefined)return undefined
  if(row!.chapters.some(c=>!c||!/^0[1-8]$/u.test(c.id)||!Number.isSafeInteger(c.completed)||!Number.isSafeInteger(c.total)||c.completed<0||c.completed>c.total||typeof c.gateStatus!=='string')
    ||new Set(row!.chapters.map(c=>c.id)).size!==8
    ||row!.chapters.reduce((sum,c)=>sum+c.total,0)!==row!.total||row!.chapters.reduce((sum,c)=>sum+c.completed,0)!==row!.qualified)return undefined
  return row
}
