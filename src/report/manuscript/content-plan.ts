import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { PlanningManuscript, PlanningManuscriptPage, PlanningPageTask } from './types.ts'

export const REPORT_CONTENT_PLAN_VERSION = 'report-content-plan-2026-09-21.1'
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const key = (value: string) => value.replace(/\s+/gu, ' ').trim().replace(/。$/u, '')
const fields = ['name', 'audience', 'experience', 'location', 'scale', 'operations'] as const
const labels = ['产品', '服务客群', '体验内容', '空间载体', '容量规模', '运营方式'] as const
export interface ReportContentUnit {
  readonly id: string; readonly pageId: string; readonly chapterId: string; readonly path: string; readonly text: string
  readonly sourceRefs: readonly string[]
}
export interface ReportContentPlan {
  readonly groups: readonly { readonly pageIds: readonly string[]; readonly task: PlanningPageTask }[]
  readonly equivalents: readonly { readonly duplicateId: string; readonly keepId: string; readonly reason: string }[]
}
export interface CompiledContentPlan {
  readonly version: string; readonly sourceFingerprint: string; readonly manuscript: PlanningManuscript
  readonly coverage: readonly { readonly unitId: string; readonly sourcePageId: string; readonly sourcePath: string; readonly sourceRefs: readonly string[]; readonly presentedOn: readonly string[]; readonly equivalentTo?: string }[]
  readonly rejectedEquivalences: readonly { readonly duplicateId: string; readonly keepId: string; readonly reason: string }[]
}
export const contentPlanFingerprint = (source: PlanningManuscript) => digest({ version: REPORT_CONTENT_PLAN_VERSION, source })
export function contentUnits(source: PlanningManuscript): ReportContentUnit[] {
  return source.chapters.flatMap(chapter => chapter.pages.flatMap(page => {
    const units: ReportContentUnit[] = []
    const add = (path: string, text: string) => units.push({ id: `${page.id}/${path}`, pageId: page.id, chapterId: chapter.id, path, text, sourceRefs: page.sourceRefs })
    add('title', page.title)
    add('claim', page.claim)
    page.body.forEach((text, index) => add(`body[${index}]`, text))
    if (page.product) fields.forEach(field => add(`product.${field}`, page.product![field]))
    page.table?.rows.forEach((row, index) => add(`table.rows[${index}]`, row.join('｜')))
    page.visual.diagram?.nodes.forEach(node => add(`diagram.node:${node.id}`, node.label))
    page.visual.diagram?.edges.forEach((edge, index) => add(`diagram.edge:${index}`, JSON.stringify(edge)))
    return units
  }))
}
export function isGeographicTask(task?: PlanningPageTask): boolean {
  return !!task && ['regional-context', 'accessibility', 'audience-catchment', 'competitor-distribution', 'site-analysis'].includes(task.kind)
}
export function inferPlanningPageTask(page: PlanningManuscriptPage): PlanningPageTask {
  if (page.task) return page.task
  if (/^case[-:]/u.test(page.id) || page.sourceRefs.some(ref => /^case[-:]/u.test(ref))) return {
    kind: 'comparison', question: page.claim, scale: 'site', requiredEvidence: [], preferredTemplate: 'map-analysis', imageCount: 1,
  }
  const title = page.title
  const geographic: PlanningPageTask['kind'] | undefined = /区位|区域联系|城市联系|城市群|都市圈|主城.*(?:出行|交通)|主城区.*客源/u.test(title) ? 'regional-context'
    : /客源(?:分布|分析|范围)|客群来源/u.test(title) ? 'audience-catchment'
    : /竞品|竞争项目|同类项目分布/u.test(title) ? 'competitor-distribution'
    : /外部交通|对外交通|可达性/u.test(title) ? 'accessibility' : undefined
  if (geographic) return { kind: geographic, question: page.claim, scale: /场地|本底|水库主导/u.test(title) ? 'site' : 'regional', preferredTemplate: 'map-analysis',
    requiredEvidence: ['basemap', 'location', ...(geographic === 'accessibility' ? ['roads'] : [])], imageCount: 1 }
  const kind = page.kind === 'financial' ? 'financial' : page.visual.diagram?.nodes.length ? 'process' : page.table ? 'comparison' : 'scene'
  return { kind, question: page.claim, scale: page.kind === 'spatial' ? 'site' : 'scene', requiredEvidence: [],
    ...(kind === 'process' ? { preferredTemplate: 'array-horizontal' as const, imageCount: page.visual.diagram!.nodes.length } : {}) }
}
export function defaultContentPlan(source: PlanningManuscript): ReportContentPlan {
  return { groups: source.chapters.flatMap(chapter => chapter.pages.map(page => ({ pageIds: [page.id], task: inferPlanningPageTask(page) }))), equivalents: [] }
}
const taskSchema = z.object({ kind: z.enum(['scene', 'regional-context', 'accessibility', 'audience-catchment', 'competitor-distribution', 'site-analysis', 'process', 'comparison', 'financial', 'divider']),
  question: z.string().min(1), scale: z.enum(['regional', 'city', 'site', 'node', 'scene']), requiredEvidence: z.array(z.string()),
  preferredTemplate: z.enum(['full-background', 'split-left', 'split-right', 'split-top', 'split-bottom', 'array-horizontal', 'array-vertical', 'map-analysis', 'data']).optional(),
  imageCount: z.number().int().min(1).max(12).optional(),
}).strict()
const planSchema = z.object({ groups: z.array(z.object({ pageIds: z.array(z.string()).min(1), task: taskSchema }).strict()).min(1),
  equivalents: z.array(z.object({ duplicateId: z.string(), keepId: z.string(), reason: z.string().min(1) }).strict()),
}).strict()
// A semantic suggestion never gets to erase a different number, negation,
// season or operating prerequisite. Whole qualified clauses are deliberately
// conservative: uncertain equivalence stays visible rather than losing a fact.
function qualifiers(text: string): string {
  return JSON.stringify({ numbers: [...text.matchAll(/\d+(?:\.\d+)?(?:%|％)?/gu)].map(m => m[0]).sort(),
    negatives: [...text.matchAll(/不|无|未|禁止|不得|仅|只|至少|最多/gu)].map(m => m[0]).sort(),
    conditions: text.split(/[。；｜]/u).filter(s => /如果|若|前提|条件|期间|雨天|晴天|正常天气|暴雨|预警|季节|采摘季|非采摘|未经|通过后|资金不足|超过|中断/u.test(s)).map(key).sort() })
}
function semanticEquivalent(a: ReportContentUnit, b: ReportContentUnit): boolean {
  if (!a.sourceRefs.some(ref => b.sourceRefs.includes(ref))) return false
  if (a.path.startsWith('table.') || a.path.startsWith('diagram.')) return false
  if (b.path.startsWith('table.') && key(a.text) !== key(b.text)) return false
  return qualifiers(a.text) === qualifiers(b.text)
}

/** Compile a model's editorial decisions by reference, never by deleting keywords.
 * Every original fact is mapped to a visible owner; the authored manuscript stays intact. */
export function compileContentPlan(source: PlanningManuscript, proposal: unknown, verifiedEquivalences: readonly string[] = []): CompiledContentPlan {
  const plan = planSchema.parse(proposal), units = contentUnits(source), byUnit = new Map(units.map(unit => [unit.id, unit]))
  const pages = new Map(source.chapters.flatMap(chapter => chapter.pages.map(page => [page.id, { chapterId: chapter.id, page }] as const)))
  const membership = plan.groups.flatMap(group => group.pageIds)
  if (membership.length !== pages.size || new Set(membership).size !== pages.size || membership.some(id => !pages.has(id))) throw new Error('CONTENT_PLAN_COVERAGE: 展示分组必须完整覆盖原稿，且每页只归属一次。')
  const owner = new Map(plan.groups.flatMap(group => group.pageIds.map(id => [id, group.pageIds[0]!] as const)))
  const equivalent = new Map<string, string>(), rejected: ReportContentPlan['equivalents'][number][] = []
  for (const suggestion of plan.equivalents) {
    const a = byUnit.get(suggestion.duplicateId), b = byUnit.get(suggestion.keepId)
    if (!a || !b || a.id === b.id || equivalent.has(a.id) || equivalent.has(b.id) || [...equivalent.values()].includes(a.id)
      || a.path === 'title' || a.path === 'claim' || a.path === 'product.name' || !semanticEquivalent(a, b)
      || key(a.text) !== key(b.text) && !verifiedEquivalences.includes(a.id)) { rejected.push(suggestion); continue }
    equivalent.set(a.id, b.id)
  }
  const displayPages = new Map<string, PlanningManuscriptPage>()
  for (const group of plan.groups) {
    const retainedByText = new Map<string, ReportContentUnit>()
    const originals = group.pageIds.map(id => pages.get(id)!), primary = originals[0]!, first = primary.page
    if (originals.some(row => row.chapterId !== primary.chapterId)) throw new Error('CONTENT_PLAN_CHAPTER: 跨章论证应指定主位置，不合并不同职责的章节。')
    const products = originals.flatMap(row => row.page.product ? [row.page.product] : [])
    if (new Set(products.map(product => JSON.stringify(product))).size > 1) throw new Error('CONTENT_PLAN_PRODUCT: 不同核心产品必须保持独立身份。')
    const tables = originals.flatMap(row => row.page.table ? [row.page.table] : [])
    if (new Set(tables.map(table => JSON.stringify(table.columns))).size > 1) throw new Error('CONTENT_PLAN_TABLE: 不同列含义的比较表不得混合。')
    const diagrams = originals.flatMap(row => row.page.visual.diagram ? [row.page.visual.diagram] : [])
    if (new Set(diagrams.map(diagram => JSON.stringify(diagram))).size > 1) throw new Error('CONTENT_PLAN_DIAGRAM: 不同关系图必须独立保留。')
    if (diagrams.length && originals.some(row => row.page.visual.sourceMaterialKey && !row.page.visual.diagram)) throw new Error('CONTENT_PLAN_DIAGRAM: 独立底图与关系图需要分别保留。')
    if (new Set(originals.flatMap(row => row.page.visual.sourceMaterialKey ? [row.page.visual.sourceMaterialKey] : [])).size > 1) throw new Error('CONTENT_PLAN_SOURCE: 不同来源底图不能并为一个图槽。')
    const groupUnits = units.filter(unit => group.pageIds.includes(unit.pageId)), body: string[] = []
    const ownClaim = byUnit.get(`${first.id}/claim`)!, ownTitle = byUnit.get(`${first.id}/title`)!
    const tableKeys = new Map(groupUnits.filter(unit => unit.path.startsWith('table.')).map(unit => [key(unit.text), unit]))
    retainedByText.set(`${key(first.title)}\0${first.sourceRefs.slice().sort().join()}`, ownTitle)
    retainedByText.set(`${key(first.claim)}\0${first.sourceRefs.slice().sort().join()}`, ownClaim)
    for (const unit of groupUnits) {
      if (unit.id === ownClaim.id || unit.id === ownTitle.id || unit.path.startsWith('table.') || unit.path.startsWith('diagram.') || equivalent.has(unit.id)) continue
      if (unit.path === 'product.name' && key(unit.text) === key(first.title)) continue
      const scopedKey = `${key(unit.text)}\0${unit.sourceRefs.slice().sort().join()}`
      const existing = tableKeys.get(key(unit.text)) ?? retainedByText.get(scopedKey)
      if (existing && existing.id !== unit.id && !equivalent.has(existing.id)) { equivalent.set(unit.id, existing.id); continue }
      retainedByText.set(scopedKey, unit)
      const fieldIndex = fields.findIndex(field => unit.path === `product.${field}`)
      body.push(fieldIndex < 0 ? unit.text : `${labels[fieldIndex]}｜${unit.text}`)
    }
    let task: PlanningPageTask = group.task
    const inferred = originals.map(row => inferPlanningPageTask(row.page)).find(isGeographicTask)
    if (inferred && !isGeographicTask(task)) task = inferred
    if (isGeographicTask(task)) task = { ...task, preferredTemplate: 'map-analysis', imageCount: 1,
      requiredEvidence: [...new Set(['basemap', 'location', ...task.requiredEvidence])] }
    let visual = originals.find(row => row.page.visual.diagram || row.page.visual.sourceMaterialKey)?.page.visual ?? first.visual
    if (isGeographicTask(task) && diagrams.length) {
      // Legacy geographical pages often encode the argument as a scene flow.
      // Preserve that argument as visible copy; the image slot is now a real map.
      for (const diagram of diagrams) {
        for (const node of diagram.nodes) if (![first.claim, ...body].some(text => text.includes(node.label))) body.push(node.label)
        for (const edge of diagram.edges) {
          const from = diagram.nodes.find(node => node.id === edge.from)!.label, to = diagram.nodes.find(node => node.id === edge.to)!.label
          body.push(`${from} → ${to}${edge.label ? `（${edge.label}）` : ''}`)
        }
      }
      visual = { kind: 'source', subject: task.question, purpose: '以真实地图说明区域空间关系', caption: first.title }
    }
    displayPages.set(first.id, { ...first, editorialSummary: true, task, body,
      ...(products.length ? { kind: 'product', product: products[0] } : {}),
      ...(tables.length ? { table: { columns: tables[0]!.columns, rows: tables.flatMap(table => table.rows) } } : {}),
      visual, sourceRefs: [...new Set(originals.flatMap(row => row.page.sourceRefs))],
      notes: [...originals.flatMap(row => row.page.notes), JSON.stringify({ sourcePages: originals.map(row => row.page), contentUnits: groupUnits.map(unit => unit.id) })],
    })
  }
  const coverage = units.map(unit => {
    const target = equivalent.get(unit.id), retained = target ? byUnit.get(target)! : unit
    return { unitId: unit.id, sourcePageId: unit.pageId, sourcePath: unit.path, sourceRefs: unit.sourceRefs,
      presentedOn: [owner.get(retained.pageId)!], ...(target ? { equivalentTo: target } : {}) }
  })
  return { version: REPORT_CONTENT_PLAN_VERSION, sourceFingerprint: contentPlanFingerprint(source), coverage, rejectedEquivalences: rejected,
    manuscript: { ...source, chapters: source.chapters.map(chapter => ({ ...chapter,
      pages: plan.groups.filter(group => pages.get(group.pageIds[0]!)!.chapterId === chapter.id).map(group => displayPages.get(group.pageIds[0]!)!),
    })) } }
}
