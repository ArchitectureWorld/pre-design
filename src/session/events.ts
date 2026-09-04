import type { GovernanceRepository } from '../governance/repository.ts'
import { deriveSiteBoundaryState } from '../governance/site-boundary-status.ts'
import type { SiteBoundarySource, SiteBoundaryStateSummary } from '../governance/types.ts'
import type { PresentationAutoSyncService, PresentationAutoSyncState } from '../presentation/auto-sync.ts'
import type { WorkflowRuntime } from '../runtime/workflow-runtime.ts'
import type { ProjectContext } from '../state/types.ts'
import { reportLinks, type ReportPackageLinks } from '../client/report-links.ts'

export interface PreplanningChapterStatus {
  readonly id: string
  readonly completed: number
  readonly total: number
  readonly gateStatus: string
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
  readonly visual: { readonly candidates: number; readonly adopted: number; readonly blocked: number }
  readonly boundary: PreplanningBoundaryStatus
  readonly modelRoute: { readonly primary: string; readonly visual: string }
  readonly presentation?: PreplanningPresentationStatus
  readonly reportPackage?: ReportPackageLinks
}

export interface PreplanningStatusDependencies {
  readonly governance: Pick<GovernanceRepository, 'readProject'>
  readonly runtime: Pick<WorkflowRuntime, 'snapshot'>
  readonly presentationSync?: Pick<PresentationAutoSyncService, 'status'>
}

const CHAPTER_TOTALS = [7, 8, 6, 6, 7, 7, 8, 8] as const
const PRIMARY_MODEL_ROUTE = '当前 DSH Session 所选模型'
const VISUAL_MODEL_ROUTE = 'antigravity / gemini-3.1-flash-image'
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
    mode: 'manual', reportDepth: 'standard', chapters: defaultChapters(), blocked: 0,
    visual: { candidates: 0, adopted: 0, blocked: 0 },
    boundary: defaultBoundary(context.project.currentRevision),
    modelRoute: { primary: PRIMARY_MODEL_ROUTE, visual: VISUAL_MODEL_ROUTE },
  }
  const governed = dependencies.governance.readProject(context.project.projectId)
  const workflow = dependencies.runtime.snapshot(context.project.projectId)
  const gateByChapter = new Map<string, { revision: number; decision: string }>()
  for (const gate of governed.gateDecisions) {
    if (gate.revision > context.project.currentRevision) continue
    const chapterId = gate.gateId.replace(/^G/u, '').padStart(2, '0')
    const existing = gateByChapter.get(chapterId)
    if (existing === undefined || existing.revision <= gate.revision) gateByChapter.set(chapterId, gate)
  }
  const latestPackage = [...governed.reportPackages]
    .filter(row => row.status === 'published' && row.sourceRevision <= context.project.currentRevision)
    .sort((left, right) => left.sourceRevision - right.sourceRevision || left.packageId.localeCompare(right.packageId))
    .at(-1)
  const presentation = presentationStatus(context, dependencies)
  return {
    ...base,
    mode: governed.policy?.mode ?? 'manual',
    reportDepth: governed.policy?.reportDepth ?? 'standard',
    chapters: workflow.chapters.map(chapter => ({
      id: chapter.chapterId,
      completed: chapter.completed,
      total: chapter.total,
      gateStatus: gateByChapter.get(chapter.chapterId)?.decision ?? 'pending',
    })),
    blocked: workflow.blocked.length,
    visual: {
      candidates: governed.visualAssets.filter(row => row.status === 'candidate').length,
      adopted: governed.visualAssets.filter(row => row.status === 'adopted').length,
      blocked: governed.visualTasks.filter(row => row.status === 'blocked').length,
    },
    boundary: statusBoundary(governed.siteBoundaries, context.project.currentRevision),
    modelRoute: { primary: PRIMARY_MODEL_ROUTE, visual: VISUAL_MODEL_ROUTE },
    ...(presentation === undefined ? {} : { presentation }),
    ...(latestPackage === undefined ? {} : { reportPackage: reportLinks(latestPackage.packageId) }),
  }
}

export function formatPreplanningStatus(status: PreplanningStatusEventData): string {
  const proposal = status.pendingProposalId === undefined ? '' : `，待确认提案 ${JSON.stringify(status.pendingProposalId)}`
  const base = `前期策划状态：项目 ${JSON.stringify(status.projectName)}（${status.projectId}），revision ${status.revision}，阶段 ${status.stage}，待确认 ${status.pendingProposalCount} 项，开放问题 ${status.openQuestionCount} 项${proposal}。`
  const chapters = status.chapters
    .map(chapter => `${chapter.id}=${chapter.completed}/${chapter.total}/${chapter.gateStatus}`)
    .join(',')
  const report = status.reportPackage?.id ?? 'none'
  const source = status.boundary.source === undefined ? '' : `（来源 ${JSON.stringify(status.boundary.source)}）`
  const detail = `前期策划全流程：模式 ${status.mode}；报告 ${status.reportDepth}；阻断 ${status.blocked}；视觉 ${status.visual.candidates}/${status.visual.adopted}/${status.visual.blocked}；章节 ${chapters}；成果 ${report}；主模型 ${JSON.stringify(status.modelRoute.primary)}；视觉模型 ${JSON.stringify(status.modelRoute.visual)}；场地边界 ${JSON.stringify(status.boundary.label)}${source}；下一步 ${JSON.stringify(status.boundary.nextAction)}。`
  const presentation = status.presentation === undefined
    ? ''
    : `\n前期策划 Presentation：${JSON.stringify(status.presentation)}。`
  return `${base}\n${detail}${presentation}`
}

const STATUS_PATTERN = /(?:^|\n)前期策划状态：项目 ("(?:\\.|[^"\\])*")（([^）\r\n]+)），revision (\d+)，阶段 ([^，\r\n]+)，待确认 (\d+) 项，开放问题 (\d+) 项(?:，待确认提案 ("(?:\\.|[^"\\])*"))?。(?:$|\n)/u
const DETAIL_PATTERN = /(?:^|\n)前期策划全流程：模式 (manual|automatic)；报告 (standard|extended)；阻断 (\d+)；视觉 (\d+)\/(\d+)\/(\d+)；章节 ([^；\r\n]+)；成果 ([A-Za-z0-9._-]+|none)；主模型 ("(?:\\.|[^"\\])*")；视觉模型 ("(?:\\.|[^"\\])*")(?:；场地边界 ("(?:\\.|[^"\\])*")(?:（来源 ("(?:\\.|[^"\\])*")）)?；下一步 ("(?:\\.|[^"\\])*"))?。(?:$|\n)/u
const PRESENTATION_PATTERN = /(?:^|\n)前期策划 Presentation：(\{[^\r\n]*\})。(?:$|\n)/u

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
  const presentation = presentationFromText(text)
  const base = {
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
    ...(presentation === undefined ? {} : { presentation }),
  }
  const detail = DETAIL_PATTERN.exec(text)
  if (detail === null) return {
    ...base,
    mode: 'manual', reportDepth: 'standard', chapters: defaultChapters(), blocked: 0,
    visual: { candidates: 0, adopted: 0, blocked: 0 },
    boundary: defaultBoundary(revision),
    modelRoute: { primary: PRIMARY_MODEL_ROUTE, visual: VISUAL_MODEL_ROUTE },
  }
  const chapters = parseChapters(detail[7]!)
  if (chapters === undefined) return undefined
  const boundary = parseBoundary(detail[11], detail[12], detail[13])
  if (boundary === undefined) return undefined
  const packageId = detail[8]!
  return {
    ...base,
    mode: detail[1] as PreplanningStatusEventData['mode'],
    reportDepth: detail[2] as PreplanningStatusEventData['reportDepth'],
    blocked: Number(detail[3]),
    visual: { candidates: Number(detail[4]), adopted: Number(detail[5]), blocked: Number(detail[6]) },
    chapters,
    modelRoute: { primary: JSON.parse(detail[9]!) as string, visual: JSON.parse(detail[10]!) as string },
    boundary,
    ...(packageId === 'none' ? {} : { reportPackage: reportLinks(packageId) }),
  }
}

export function normalizePreplanningStatus(value: unknown): PreplanningStatusEventData | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.projectId !== 'string' || typeof record.projectName !== 'string'
    || typeof record.revision !== 'number' || !Number.isSafeInteger(record.revision) || record.revision < 0
    || typeof record.stage !== 'string'
    || (record.status !== 'active' && record.status !== 'attention_required' && record.status !== 'pending_review')
    || typeof record.pendingProposalCount !== 'number' || !Number.isSafeInteger(record.pendingProposalCount)
    || typeof record.openQuestionCount !== 'number' || !Number.isSafeInteger(record.openQuestionCount)) return undefined
  const presentation = normalizedPresentation(record.presentation)
  if (record.presentation !== undefined && presentation === undefined) return undefined
  const base = record as unknown as Omit<PreplanningStatusEventData, 'mode' | 'reportDepth' | 'chapters' | 'blocked' | 'visual' | 'modelRoute' | 'boundary' | 'presentation'>
  const rich = record.mode === 'manual' || record.mode === 'automatic'
  if (!rich) return {
    ...base, mode: 'manual', reportDepth: 'standard', chapters: defaultChapters(), blocked: 0,
    visual: { candidates: 0, adopted: 0, blocked: 0 },
    boundary: defaultBoundary(record.revision),
    modelRoute: { primary: PRIMARY_MODEL_ROUTE, visual: VISUAL_MODEL_ROUTE },
    ...(presentation === undefined ? {} : { presentation }),
  }
  return {
    ...(value as Omit<PreplanningStatusEventData, 'boundary' | 'presentation'>),
    boundary: normalizedBoundary(record.boundary, record.revision),
    ...(presentation === undefined ? {} : { presentation }),
  }
}
