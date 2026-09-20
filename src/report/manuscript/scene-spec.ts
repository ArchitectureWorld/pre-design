import { z } from 'zod'
import type { ImageSlotBrief } from '../../visual/image-policy.ts'
import type { PlanningManuscriptPage } from './types.ts'

export const SCENE_SPEC_VERSION = 'report-scene-spec-2026-09-20.4'
export interface SceneSpecSource { readonly path: string; readonly text: string }
export interface SceneSpecContext {
  readonly usageId: string
  readonly pageTitle: string
  readonly intent: string
  readonly nodeLabel?: string
  readonly sources: readonly SceneSpecSource[]
}

/** Keep original strings and stable paths; selecting a related scene is not a graph traversal. */
export function sceneSpecContext(page: PlanningManuscriptPage, usageId: string, nodeId?: string): SceneSpecContext {
  const sources: SceneSpecSource[] = []
  const add = (path: string, text: string) => { if (text.trim()) sources.push({ path, text }) }
  add('title', page.title)
  add('claim', page.claim)
  page.body.forEach((text, index) => add(`body[${index}]`, text))
  if (page.product) for (const key of ['name', 'audience', 'experience', 'location', 'scale', 'operations'] as const) add(`product.${key}`, page.product[key])
  page.table?.columns.forEach((text, index) => add(`table.columns[${index}]`, text))
  page.table?.rows.forEach((row, rowIndex) => row.forEach((text, columnIndex) => add(`table.rows[${rowIndex}][${columnIndex}]`, text)))
  add('visual.subject', page.visual.subject)
  add('visual.purpose', page.visual.purpose)
  add('visual.caption', page.visual.caption)
  let nodeLabel: string | undefined
  if (nodeId !== undefined) {
    const nodes = page.visual.diagram?.nodes ?? [], index = nodes.findIndex(node => node.id === nodeId)
    if (index < 0) throw new Error('SCENE_SPEC_NODE_NOT_FOUND: nodeId: 场景位置未对应原稿节点')
    nodeLabel = nodes[index]!.label
    add(`visual.diagram.nodes[${index}].label`, nodeLabel)
  }
  return { usageId, pageTitle: page.title, intent: page.claim, ...(nodeLabel !== undefined ? { nodeLabel } : {}), sources }
}

// These describe presentation or administrative propositions, not visible facilities.
// Ordinary construction/operation words alone are deliberately insufficient.
const abstractRequirement = /图表|表格|矩阵|流程图|总平图|平面图|剖面图|概念剖面|对比图|示意图|关系图|关系示意|分析图|结构图|构成表|对照表|计算关系|计算公式|管理制度|运营制度|规章|制度|机制|权责|职责|分工|(?:成立|建设|管理|运营|经营|开业|准入|验收)条件|经营方式|运营模式|盈利模式|指标|测算|资金|融资|投资|预算|收入构成|成本构成|收益率|投入产出|(?:服务|主体|政府|企业|资本|财政)投入|阶段[^。；\n]{0,30}(?:对照|安排|计划|条件)|(?:游程|运营|管理|时序)(?:的)?(?:衔接|安排|组织|协调)/u
const genericRequirement = /^(?:(?:本项目|项目|相关|本地|公共|配套|主要|基本|综合|必要|日常|完善|首期|中期|远期|新增|新建|建设|实施|运营|管理|经营|使用|所需|具体|服务|休闲|核心|的)\s*)*(?:空间|场所|场景|环境|设施|活动|服务|内容|空间载体)$/u
// Financial relationships need a related service scene; price signs and toll booths remain visible subjects.
const financialRelationship = /(?:价格|费用|收费|定价|收支|收益)(?:的)?(?:关系|结构|安排|承担|分配|核算|边界|规则|方式)/u
function unobservable(text: string): boolean { return abstractRequirement.test(text) || financialRelationship.test(text) || genericRequirement.test(text.trim()) }

export function needsSceneSpecification(brief: ImageSlotBrief, context?: SceneSpecContext): boolean {
  const sceneKinds = brief.allowedKinds.filter(kind => kind === 'photo' || kind === 'render')
  if (!sceneKinds.length) return false
  // A source-only analysis slot must keep its original media contract, even if photos are also allowed.
  if (!brief.allowedSources.includes('generated') && sceneKinds.length !== brief.allowedKinds.length) return false
  // Node roles and the cover can carry decisions/conditions regardless of their wording.
  if (brief.nodeId !== undefined || brief.id === 'cover:main' && brief.pageId === 'cover') return true
  return [...brief.subjects, ...brief.activities, brief.environment].some(unobservable)
    || context?.sources.some(source => ['visual.subject', 'visual.purpose', 'visual.caption'].includes(source.path) && unobservable(source.text)) === true
}

const quotedText = z.string().min(1).max(600).refine(text => text === text.trim() && text.trim().length > 0)
const citationSchema = z.object({ text: quotedText, sourcePath: z.string().min(1).max(200) }).strict()
const specificationSchema = z.object({
  usageId: z.string().min(1).max(200),
  subjects: z.array(citationSchema).min(1).max(6),
  activities: z.array(citationSchema).max(4),
  environment: citationSchema,
}).strict()
type Citation = z.infer<typeof citationSchema>

/** Render only schema-owned paths and fixed constraints, never issue messages or input values. */
function schemaDiagnostic(issue: z.ZodIssue): string {
  const fields = new Set(['usageId', 'subjects', 'activities', 'environment', 'text', 'sourcePath'])
  const safe = issue.path.every(part => typeof part === 'number' ? Number.isSafeInteger(part) && part >= 0 : typeof part === 'string' && fields.has(part))
  const path = safe ? issue.path.reduce<string>((value, part) => typeof part === 'number' ? `${value}[${part}]` : `${value ? `${value}.` : ''}${String(part)}`, '') || '$' : '$'
  let constraint: string
  if (issue.code === 'unrecognized_keys') constraint = '不允许额外字段'
  else if (path === 'subjects') constraint = '必须为数组，至少 1 项、最多 6 项'
  else if (path === 'activities') constraint = '必须为数组，最多 4 项'
  else if (path === 'usageId') constraint = '必须为非空字符串，长度 1–200 字符'
  else if (path.endsWith('.text')) constraint = '必须为非空原文字符串，长度 1–600 字符，不得有首尾空白'
  else if (path.endsWith('.sourcePath')) constraint = '必须为非空来源路径字符串，长度 1–200 字符'
  else if (path === '$') constraint = '必须为仅含 usageId、subjects、activities、environment 的对象'
  else constraint = '必须为仅含 text、sourcePath 的引用对象'
  return `${path}: ${constraint}`
}

/** Only a declared entity-name field has a reliable lexical completeness boundary.
 * Free prose and ordinary table cells provide evidence, not a noun-phrase schema.
 * Their semantic selection is reviewed against the full grounded source text.
 */
function assertStructuredNames(subjects: readonly Citation[], sources: ReadonlyMap<string, string>): void {
  for (const [index, subject] of subjects.entries()) {
    if (subject.sourcePath === 'product.name' && subject.text !== sources.get(subject.sourcePath)!.trim()) {
      throw new Error(`SCENE_SPEC_INCOMPLETE_NAME: subjects[${index}].text: 结构化实体名称必须完整保留`)
    }
  }
}

export function resolveSceneSpecification(value: unknown, original: ImageSlotBrief, context: SceneSpecContext): ImageSlotBrief {
  const parsed = specificationSchema.safeParse(value)
  if (!parsed.success) throw new Error(`SCENE_SPEC_INVALID: ${[...new Set(parsed.error.issues.map(schemaDiagnostic))].slice(0, 8).join('；')}`)
  const spec = parsed.data
  if (spec.usageId !== original.id || spec.usageId !== context.usageId) throw new Error('SCENE_SPEC_USAGE_MISMATCH: usageId: 场景规格不属于当前用图位置')
  const seenSubjects = new Set<string>()
  for (const [index, subject] of spec.subjects.entries()) {
    if (seenSubjects.has(subject.text)) throw new Error(`SCENE_SPEC_DUPLICATE_SUBJECT: subjects[${index}].text: 主体不得重复`)
    seenSubjects.add(subject.text)
  }
  const sources = new Map<string, string>()
  for (const [index, source] of context.sources.entries()) {
    if (sources.has(source.path)) throw new Error(`SCENE_SPEC_SOURCE_AMBIGUOUS: context.sources[${index}].path: 来源路径重复`)
    sources.set(source.path, source.text)
  }
  const fields = [...spec.subjects.map((item, index) => ({ item, path: `subjects[${index}]` })),
    ...spec.activities.map((item, index) => ({ item, path: `activities[${index}]` })), { item: spec.environment, path: 'environment' }]
  for (const { item, path } of fields) {
    const source = sources.get(item.sourcePath)
    if (!source) throw new Error(`SCENE_SPEC_CITATION_INVALID: ${path}.sourcePath: 必须引用当前上下文中存在的来源路径`)
    if (!source.includes(item.text)) throw new Error(`SCENE_SPEC_CITATION_INVALID: ${path}.text: 必须是所引来源字段中的连续原文`)
    if (unobservable(item.text)) throw new Error(`SCENE_SPEC_UNOBSERVABLE: ${path}.text: 必须为具体可观察要求，不接受抽象命题或泛称`)
  }
  assertStructuredNames(spec.subjects, sources)
  const groundedSources = [...new Set(fields.map(({ item }) => item.sourcePath))].sort()
    .map(path => ({ path, text: sources.get(path)! }))
  const suffix = `+${SCENE_SPEC_VERSION}`
  return { ...original, version: original.version.endsWith(suffix) ? original.version : `${original.version}${suffix}`,
    subjects: spec.subjects.map(subject => subject.text), activities: spec.activities.map(activity => activity.text), environment: spec.environment.text,
    sceneGrounding: { ...(context.nodeLabel !== undefined ? { nodeLabel: context.nodeLabel } : {}), sources: groundedSources } }
}
