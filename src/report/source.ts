import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContractRegistry } from '../contracts/registry.ts'
import type { GovernanceRepository } from '../governance/repository.ts'
import { boundaryIntegrityDigest, selectConfirmedSiteBoundary } from '../governance/site-boundary-service.ts'
import { deriveSiteBoundaryState } from '../governance/site-boundary-status.ts'
import type { GateDecisionRecord } from '../governance/types.ts'
import type { ProjectRepository } from '../state/repository.ts'
import type { VisualAssetStore } from '../visual/asset-store.ts'
import type { ClientProjectProfile } from './client-types.ts'
import { createDefaultClientProjectProfile } from './default-profile.ts'
import { createFrozenReportSections, reportReferenceNames } from './report-content.ts'
import type { FrozenProjectInput, FrozenSiteBoundary, FrozenStateFact, FrozenStateObject, ReportAsset } from './types.ts'

export interface ReportSourceDependencies {
  readonly repository: Pick<ProjectRepository, 'readProjectRevision'>
  readonly governance: Pick<GovernanceRepository, 'readProject'>
  readonly registry: Pick<ContractRegistry, 'workflows'>
  readonly visualStore: Pick<VisualAssetStore, 'resolveAsset'>
}

export async function loadClientProjectProfile(
  profileRoot: string,
  projectId: string,
  fallbackInput?: FrozenProjectInput,
): Promise<ClientProjectProfile> {
  if (!/^[A-Za-z0-9._-]+$/u.test(projectId) || projectId === '.' || projectId === '..') {
    throw new Error('unsafe project id for client profile')
  }
  let raw: string
  try {
    raw = await readFile(join(profileRoot, `${projectId}.json`), 'utf8')
  } catch (error) {
    if (fallbackInput !== undefined && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createDefaultClientProjectProfile(fallbackInput)
    }
    throw error
  }
  const parsed = JSON.parse(raw) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('client project profile must be an object')
  }
  const record = parsed as Record<string, unknown>
  const identity = record.identity
  if (identity === null || typeof identity !== 'object' || Array.isArray(identity)
    || (identity as Record<string, unknown>).projectId !== projectId) {
    throw new Error('client project profile identity does not match project id')
  }
  for (const key of ['chapters', 'products', 'evidence', 'assetBindings', 'requiredVisualRoles']) {
    if (!Array.isArray(record[key])) throw new Error(`client project profile ${key} must be an array`)
  }
  if (record.visualContractVersion !== 'architectural-v1') {
    throw new Error('client project profile must enable the architectural visual contract')
  }
  return parsed as ClientProjectProfile
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {}
}

function firstText(record: Readonly<Record<string, unknown>>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

function printable(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

const FACT_EXCLUDED_KEYS = new Set([
  'id', 'object_id', 'objectId', 'object_type', 'project_id', 'chapter_id', 'work_item_id',
  'schema_version', 'revision', 'status', 'created_at', 'updated_at', 'created_by',
  'source_snapshot', 'quality', 'approval', 'prompt', 'promptSummary',
  'origin_mode', 'mandatory_level', 'level', 'score', 'role', 'actor_id', 'event_type',
  'event_id', 'scope_type', 'kind', 'type', 'claim_class', 'version_id', 'asset_id',
  'locator', 'admin_codes', 'geometry_refs', 'evidence_refs', 'data_versions',
  'evaluation_model_version', 'snapshot_id',
  'backup_option', 'recommended_option', 'decision_snapshot', 'brand_level',
])

const CLIENT_FACT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  location: '项目地点',
  aliases: '项目识别',
  start_reason: '策划目标',
  canonical_name: '项目名称',
  trigger_events: '启动背景',
  impact: '项目影响',
  allowed: '可实施方向',
  clauses: '管控原则',
  effective_dates: '规划期限',
  prohibited: '禁止事项',
  hierarchy: '规划依据',
  spatial_applicability: '适用范围',
  documents: '上位依据',
  restricted: '开发约束',
  reference_standard: '参考标准',
  affected_groups: '影响人群',
  gap_value: '综合缺口',
  issues: '核心问题',
  baseline: '现状基线',
  problem_links: '核心矛盾',
  opportunity_links: '发展机会',
  beneficiaries: '受益人群',
  service_objects: '服务对象',
  public_value: '公共价值',
  strategic_role: '战略角色',
  mission: '项目使命',
  non_goals: '项目边界',
  fixed_conditions: '不可突破条件',
  variable_list: '方案变量',
  common_assumptions: '共同前提',
  day_types: '使用时段',
  user_groups: '核心客群',
  needs: '核心需求',
  time_slots: '活力时段',
  peak_demands: '高峰需求',
  seasons: '四季场景',
  journeys: '体验动线',
  inclusion_needs: '全龄友好',
  zones: '空间分区',
  intensity: '开发强度',
  area_balance: '功能平衡',
  assumptions: '规划前提',
  planning_alignment: '规划衔接',
  land_use: '用地布局',
  networks: '空间网络',
  centers: '核心节点',
  axes: '发展轴线',
  public_space: '公共空间',
  measures: '建设内容',
  dependencies: '前置条件',
  expected_outcomes: '预期成效',
  quantities: '建设规模',
  owners: '实施主体',
  packages: '工程包',
  boundary: '实施边界',
  object_refs: '关联成果',
  scope: '实施范围',
  problems: '核心问题',
  financing_cost: '融资成本',
  startup_cost: '启动成本',
  contingency: '预备费',
  unit_rates: '成本单价',
  lifecycle_cost: '全周期成本',
  ranges: '投资区间',
  other_fees: '其他费用',
  capex: '建设投资',
  tax_basis: '含税口径',
  package_costs: '工程包投资',
  annual_investment: '年度投资',
  prerequisites: '启动条件',
  critical_path: '关键路径',
  decision_points: '决策节点',
  phases: '分期路径',
  milestones: '关键节点',
  contingencies: '备选安排',
  typical_sections: '典型空间尺度',
  materials: '材质体系',
  review_methods: '审查机制',
  interfaces: '开放界面',
  signage: '标识系统',
  scales: '空间尺度',
  node_briefs: '重点场景',
  height_far: '开发强度',
  control_zones: '风貌分区',
  heritage_rules: '风貌底线',
  project_relevance: '项目价值',
  invalidation_signals: '失效信号',
  opportunities: '发展机会',
  required_conditions: '成立条件',
  trend_or_policy: '发展趋势',
  time_window: '机会窗口',
  uncertainty: '关键不确定性',
  rationale: '推荐理由',
  rejection_reasons: '排除理由',
  invalidation_triggers: '回退条件',
  decision_snapshot: '推荐结论',
  next_validation: '下一步验证',
  conditions: '成立条件',
  requirements: '准入要求',
  services: '服务内容',
  products: '产品组合',
  activity_calendar: '活动日历',
  public_or_revenue_role: '收益结构',
  operator_types: '运营主体',
  scenarios: '经营情景',
  stress_results: '压力测试',
  cashflows: '经营现金流',
  revenues: '经营收入',
  financing: '资金结构',
  opex: '运营成本',
  irr: '内部收益率',
  dscr: '偿债备付率',
  npv: '财务净现值',
  basis: '判断依据',
})

function factLabel(key: string): string {
  return CLIENT_FACT_LABELS[key] ?? '项目要点'
}

const OBJECT_SUMMARY_PRIORITIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  DG05: ['project_relevance', 'opportunities'],
  OP07: ['rationale', 'decision_snapshot'],
  PG04: ['products', 'activity_calendar'],
  SP07: ['typical_sections', 'height_far'],
  IM02: ['capex', 'package_costs'],
  IM06: ['scenarios', 'cashflows'],
  IM07: ['phases', 'milestones'],
})

function summaryFromField(value: unknown): string | undefined {
  const text = printable(value)
  if (text !== undefined) return text
  const candidates = Array.isArray(value) ? value : [value]
  for (const candidate of candidates) {
    const record = recordOf(candidate)
    const name = firstText(record, ['name', 'title', 'label'])
    const measuredValue = printable(record.value)
    const unit = printable(record.unit)
    if (name !== undefined && measuredValue !== undefined) {
      const clientName = name.replace(/[（(]\s*CAPEX\s*[）)]/giu, '').trim()
      const numericValue = typeof record.value === 'number'
        ? record.value
        : /^\d+(?:\.\d+)?$/u.test(measuredValue)
          ? Number(measuredValue)
          : undefined
      if (unit === '万元' && numericValue !== undefined && numericValue >= 10_000) {
        const yi = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(numericValue / 10_000)
        return `${clientName}约${yi}亿元`
      }
      return `${clientName}为${measuredValue}${unit === undefined ? '' : ` ${unit}`}`
    }
    if (name !== undefined) return name
  }
  return undefined
}

function fieldName(value: unknown): string | undefined {
  const candidates = Array.isArray(value) ? value : [value]
  for (const candidate of candidates) {
    const name = firstText(recordOf(candidate), ['name', 'title', 'label'])
    if (name !== undefined) return name
  }
  return undefined
}

function preferredSummary(
  objectId: string,
  record: Readonly<Record<string, unknown>>,
  facts: readonly FrozenStateFact[],
): string | undefined {
  const data = recordOf(record.data)
  if (objectId === 'SP07') {
    const section = summaryFromField(data.typical_sections)
    const heightControl = fieldName(data.height_far)
    if (section !== undefined && heightControl !== undefined) return `${section}；${heightControl}`
  }
  for (const key of OBJECT_SUMMARY_PRIORITIES[objectId] ?? []) {
    const summary = summaryFromField(data[key])
    if (summary !== undefined) return summary
  }
  const direct = firstText(record, ['summary', 'conclusion', 'recommendation', 'statement'])
    ?? firstText(data, [
      'summary', 'conclusion', 'recommendation', 'statement', 'mission', 'strategic_role',
      'public_value', 'start_reason', 'planning_alignment', 'critical_path', 'contingency',
      'hierarchy', 'spatial_applicability',
    ])
  if (direct !== undefined) return direct

  for (const key of ['issues', 'problem_links', 'needs', 'expected_outcomes', 'zones', 'measures', 'allowed']) {
    const value = data[key]
    const candidates = Array.isArray(value) ? value : [value]
    for (const candidate of candidates) {
      const semantic = firstText(recordOf(candidate), ['name', 'title', 'label'])
      if (semantic !== undefined) return semantic
    }
  }
  return facts[0]?.value
}

function factsOf(record: Readonly<Record<string, unknown>>): FrozenStateFact[] {
  const facts: FrozenStateFact[] = []
  const seen = new Set<string>()
  const root = recordOf(record.data)
  const source = Object.keys(root).length === 0 ? record : root

  const push = (label: string, value: string): void => {
    const normalizedLabel = label.trim()
    const normalizedValue = value.trim()
    if (normalizedLabel === '' || normalizedValue === '') return
    const signature = `${normalizedLabel}\u0000${normalizedValue}`
    if (seen.has(signature)) return
    seen.add(signature)
    facts.push({ label: normalizedLabel, value: normalizedValue, basis: '项目冻结资料' })
  }

  const visit = (value: unknown, path: readonly string[]): void => {
    if (facts.length >= 8) return
    if (Array.isArray(value)) {
      for (const child of value) visit(child, path)
      return
    }
    const text = printable(value)
    if (text !== undefined) {
      const key = path.at(-1)
      if (typeof value === 'number' || /^-?\d+(?:\.\d+)?$/u.test(text)) return
      if (key !== undefined && !FACT_EXCLUDED_KEYS.has(key)) push(factLabel(key), text)
      return
    }
    const child = recordOf(value)
    if (Object.keys(child).length === 0) return
    const semanticLabel = firstText(child, ['name', 'title', 'label'])
    const measuredValue = printable(child.value)
    const unit = printable(child.unit)
    if (measuredValue !== undefined) {
      push(semanticLabel ?? factLabel(path.at(-1) ?? '指标'), `${measuredValue}${unit === undefined ? '' : ` ${unit}`}`)
      return
    }
    if (semanticLabel !== undefined) push(factLabel(path.at(-1) ?? '内容'), semanticLabel)
    for (const [key, nested] of Object.entries(child)) {
      if (FACT_EXCLUDED_KEYS.has(key) || ['name', 'title', 'label', 'value', 'unit'].includes(key)) continue
      visit(nested, [...path, key])
    }
  }

  for (const [key, value] of Object.entries(source)) {
    if (FACT_EXCLUDED_KEYS.has(key) || ['title', 'name', 'summary', 'conclusion', 'recommendation', 'statement'].includes(key)) continue
    visit(value, [key])
  }
  return facts
}

function latestGates(decisions: readonly GateDecisionRecord[], revision: number): FrozenProjectInput['gates'] {
  const latest = new Map<string, GateDecisionRecord>()
  for (const decision of decisions) {
    if (decision.revision > revision) continue
    const existing = latest.get(decision.gateId)
    if (existing === undefined || existing.revision <= decision.revision) latest.set(decision.gateId, decision)
  }
  return [...latest.values()]
    .sort((left, right) => left.gateId.localeCompare(right.gateId))
    .map(decision => ({ gateId: decision.gateId, decision: decision.decision, revision: decision.revision }))
}

const RESEARCH_BOUNDARY_DECLARATIONS = ['研究范围（待核）', '非法定红线', '非测绘成果'] as const

function freezeSiteBoundary(
  governed: ReturnType<GovernanceRepository['readProject']>,
  revision: number,
): FrozenSiteBoundary {
  const state = deriveSiteBoundaryState(governed.siteBoundaries ?? [], revision)
  if (state.kind === 'not_provided') return { status: 'not_provided' }
  if (state.kind === 'pending_confirmation') {
    return { status: 'pending_confirmation', boundaryId: state.boundaryId, source: state.source }
  }
  if (state.kind === 'synthetic_research') {
    return {
      status: 'synthetic_research', boundaryId: state.boundaryId, source: state.source,
      declarations: RESEARCH_BOUNDARY_DECLARATIONS,
    }
  }
  const boundary = selectConfirmedSiteBoundary(governed.siteBoundaries ?? [], revision)
  if (boundary === undefined || boundary.boundaryId !== state.boundaryId || boundary.confirmedRevision === undefined) {
    throw new Error('SITE_BOUNDARY_SOURCE_MISMATCH：冻结边界与治理确认状态不一致。')
  }
  const assetId = boundary.sourceAsset?.assetId ?? boundary.geometry?.derivedAssetId
  const asset = assetId === undefined ? undefined : governed.visualAssets.find(candidate => candidate.assetId === assetId)
  if (assetId === undefined || asset === undefined) {
    throw new Error('SITE_BOUNDARY_SOURCE_MISMATCH：冻结边界缺少治理采用资产。')
  }
  return {
    status: 'confirmed', boundaryId: boundary.boundaryId, assetId,
    confirmedRevision: boundary.confirmedRevision, source: boundary.source,
    ...(boundary.sourceAsset === undefined ? {} : { sourceSha256: boundary.sourceAsset.sha256 }),
    ...(boundary.geometry === undefined ? {} : { geometrySha256: boundary.geometry.sha256 }),
    assetSha256: asset.sha256,
    integrityDigest: boundaryIntegrityDigest(boundary),
  }
}

export function createFrozenProjectInput(
  projectId: string,
  revision: number,
  dependencies: ReportSourceDependencies,
): FrozenProjectInput {
  const snapshot = dependencies.repository.readProjectRevision(projectId, revision)
  const governed = dependencies.governance.readProject(projectId)
  const descriptors = new Map(dependencies.registry.workflows().map(workflow => [workflow.targetObjectId, workflow]))
  const references = reportReferenceNames(snapshot.stateSnapshot,
    new Map([...descriptors].map(([objectId, descriptor]) => [objectId, descriptor.title])))
  const stateObjects: FrozenStateObject[] = Object.entries(snapshot.stateSnapshot)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([objectId, value]) => {
      const record = recordOf(value)
      const descriptor = descriptors.get(objectId)
      const title = firstText(record, ['title', 'name']) ?? descriptor?.title ?? objectId
      const facts = factsOf(record)
      const summary = preferredSummary(objectId, record, facts) ?? title
      return {
        objectId,
        chapterId: descriptor?.chapterId ?? '01',
        workItemId: descriptor?.workItemId,
        title,
        summary,
        facts,
        reportSections: createFrozenReportSections(record, title, CLIENT_FACT_LABELS, references),
      }
    })
  const recommendation = stateObjects
    .map(object => object.summary)
    .find(summary => summary.trim() !== '')
    ?? `本轮成果已冻结至 Revision ${revision}，建议按 Gate 决策进入下一阶段。`
  const gates = latestGates(governed.gateDecisions, revision)
  const decisionItems = gates
    .filter(gate => gate.decision === 'returned' || gate.decision === 'blocked')
    .map(gate => `${gate.gateId} 尚未通过，需甲方确认处理意见。`)
  if (decisionItems.length === 0) decisionItems.push(`确认本轮核心建议，并授权按成果版本 R${revision} 进入下一阶段。`)
  const visualTasks = new Map((governed.visualTasks ?? []).map(task => [task.taskId, task]))
  const visualAssets: ReportAsset[] = governed.visualAssets
    .filter(asset => asset.status === 'adopted' && (asset.adoptedRevision ?? Number.POSITIVE_INFINITY) <= revision)
    .map(asset => {
      const task = visualTasks.get(asset.taskId)
      return {
        assetId: asset.assetId,
        taskId: asset.taskId,
        ...(task === undefined ? {} : { chapterId: task.chapterId, workItemId: task.workItemId }),
        kind: asset.kind,
        caption: asset.kind === 'concept'
          ? `${snapshot.project.name}项目场景图`
          : asset.kind === 'deterministic'
            ? `${snapshot.project.name}分析图`
            : `${snapshot.project.name}项目资料图`,
        sourcePath: dependencies.visualStore.resolveAsset(asset.fileName),
        mimeType: asset.mimeType,
        sha256: asset.sha256,
        ...(asset.boundaryGeometrySha256 === undefined ? {} : { boundaryGeometrySha256: asset.boundaryGeometrySha256 }),
        width: asset.width,
        height: asset.height,
      }
    })
  return {
    projectId,
    projectName: snapshot.project.name,
    revision,
    generatedAt: snapshot.revision.committedAt,
    recommendationId: `recommendation-r${revision}`,
    recommendation,
    decisionItems,
    stateObjects,
    gates,
    visualAssets,
    adoptedAssetIds: visualAssets.map(asset => asset.assetId),
    siteBoundary: freezeSiteBoundary(governed, revision),
  }
}
