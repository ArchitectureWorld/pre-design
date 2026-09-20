import type { FrozenProjectInput } from '../types.ts'
import { MATERIAL_EXPLANATION } from './client-copy.ts'
import { makeSourceIndex, manuscriptSourceFingerprint } from './source.ts'
import { PLANNING_CHAPTER_IDS, PLANNING_MANUSCRIPT_POLICY_VERSION, PLANNING_MANUSCRIPT_SCHEMA_VERSION,
  type PlanningChapterId, type PlanningManuscript, type PlanningManuscriptChapter, type PlanningManuscriptDiagram, type PlanningManuscriptPage, type PlanningManuscriptSource } from './types.ts'

const pageKinds = new Set(['argument', 'evidence', 'comparison', 'product', 'spatial', 'delivery', 'financial'])
const visualKinds = new Set(['source', 'concept', 'diagram', 'none'])
const internalCopy = /本页|本幻灯片|我们将|接下来(?:介绍|讨论|转向)|下一步填写|置信(?:等级|度)|质量(?:守卫|阈值|评估)|任务状态|工作项(?:状态|完成)|质量证据|会议纪要|讨论纪要|已(?:彻底)?剔除旧版|旧版无依据|经讨论|中央Runtime|综合得分|稳健性(?:评分|0[.．])|\b(?:VETO|GRP|PROD)-\d+|\b(?:Workflow|ProposalEnvelope|qualityEvidence|sourceRevision)\b|override\/edit/iu
const administrativeLead = /^(?:(?:目前|当前|现阶段|本阶段)[，,：:]?)?(?:(?:仍?需(?:要)?|尚需|有待|建议)(?:进一步)?(?:明确|补充|核实|确认|填写|收集|完善)|(?:下一步|后续)(?:再|应|需|需要)?(?:明确|补充|核实|确认|填写|收集|完善)|待(?:明确|补充|核实|确认|填写|完善))/u
const emptyScale = /^(?:(?:规模|具体规模)[：:]?)?(?:根据实际情况确定|视实际情况(?:确定|调整)|具体规模待(?:核实|明确|确定|确认)|待(?:核实|明确|确定|确认)|尚未确定)[。！!]?$/u
const sloganWords = /全面|持续|积极|大力|深度|推动|推进|助力|赋能|创新|融合|协同|升级|发展|打造|构建|建设|形成|提升|促进|文旅|产业|区域|城市|乡村|生态|标杆|示范|高质量|新引擎|新格局|新活力|新高地|新动能|品牌|价值|活力|引领|与|和|的|[\s，。；：、！？,.;:!?]/gu
const identifier = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/u

function fail(code: string, path: string): never { throw new Error(`${code}: ${path}`) }
function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('MANUSCRIPT_SHAPE', path)
  return value as Record<string, unknown>
}
function text(value: unknown, path: string, code = 'MANUSCRIPT_SHAPE'): string {
  if (typeof value !== 'string' || value.trim() === '') fail(code, path)
  return value.trim()
}
function list(value: unknown, path: string, allowEmpty = false): unknown[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail('MANUSCRIPT_SHAPE', path)
  return value
}
function prose(value: unknown, path: string): string {
  const result = text(value, path)
  if (internalCopy.test(result) || MATERIAL_EXPLANATION.test(result)) fail('MANUSCRIPT_AUDIENCE', path)
  return result
}
function proposition(value: unknown, path: string): string {
  const result = prose(value, path)
  if (administrativeLead.test(result)) fail('MANUSCRIPT_AUDIENCE', `${path}: 需要项目判断或具体方案主张，不能用泛化补资料待办代替。`)
  if (/赋能|标杆|新引擎|新格局|新高地|高质量/u.test(result) && result.replace(sloganWords, '') === '') {
    fail('MANUSCRIPT_AUDIENCE', `${path}: 纯口号缺少具体对象、规划动作或使用价值。`)
  }
  return result
}

/** A diagram is an authored relationship, never inferred from prose or a visual brief. */
export function validatePlanningDiagram(value: unknown, path = 'visual.diagram'): PlanningManuscriptDiagram {
  const object = (value: unknown, at: string): Record<string, unknown> => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('MANUSCRIPT_DIAGRAM', at)
    return value as Record<string, unknown>
  }
  const label = (value: unknown, at: string, limit?: number): string => {
    const result = text(value, at, 'MANUSCRIPT_DIAGRAM')
    if (MATERIAL_EXPLANATION.test(result)) fail('MANUSCRIPT_AUDIENCE', at)
    if ((limit !== undefined && Array.from(result).length > limit) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result)) fail('MANUSCRIPT_DIAGRAM', at)
    return result
  }
  const row = object(value, path)
  if (!Array.isArray(row.nodes) || row.nodes.length === 0 || row.nodes.length > 12) fail('MANUSCRIPT_DIAGRAM', `${path}.nodes`)
  if (!Array.isArray(row.edges) || row.edges.length > 20) fail('MANUSCRIPT_DIAGRAM', `${path}.edges`)
  const ids = new Set<string>(), cells = new Set<string>()
  const nodes = row.nodes.map((value, index): PlanningManuscriptDiagram['nodes'][number] => {
    const at = `${path}.nodes[${index}]`, node = object(value, at), id = label(node.id, `${at}.id`)
    if (ids.has(id)) fail('MANUSCRIPT_DIAGRAM', `${at}.id`)
    ids.add(id)
    if (typeof node.column !== 'number' || !Number.isInteger(node.column) || node.column < 0 || node.column > 3) fail('MANUSCRIPT_DIAGRAM', `${at}.column`)
    if (typeof node.row !== 'number' || !Number.isInteger(node.row) || node.row < 0 || node.row > 2) fail('MANUSCRIPT_DIAGRAM', `${at}.row`)
    const cell = `${node.column}:${node.row}`
    if (cells.has(cell)) fail('MANUSCRIPT_DIAGRAM', `${at}: overlapping cell`)
    cells.add(cell)
    if (node.tone !== undefined && !['accent', 'neutral', 'muted'].includes(String(node.tone))) fail('MANUSCRIPT_DIAGRAM', `${at}.tone`)
    return { id, label: label(node.label, `${at}.label`, 32), column: node.column, row: node.row,
      ...(node.tone === undefined ? {} : { tone: node.tone as 'accent' | 'neutral' | 'muted' }) }
  })
  const edges = row.edges.map((value, index): PlanningManuscriptDiagram['edges'][number] => {
    const at = `${path}.edges[${index}]`, edge = object(value, at)
    const from = label(edge.from, `${at}.from`), to = label(edge.to, `${at}.to`)
    if (!ids.has(from) || !ids.has(to)) fail('MANUSCRIPT_DIAGRAM', at)
    return { from, to, ...(edge.label === undefined ? {} : { label: label(edge.label, `${at}.label`, 20) }) }
  })
  return { nodes, edges }
}

export function validatePlanningChapter(value: unknown, chapterId: PlanningChapterId, sources: readonly PlanningManuscriptSource[]): PlanningManuscriptChapter {
  const row = record(value, chapterId)
  if (row.id !== chapterId) fail('MANUSCRIPT_CHAPTER_ID', chapterId)
  const sourceIds = new Set(sources.map(source => source.id))
  const seen = new Set<string>()
  const pages = list(row.pages, `${chapterId}.pages`).map((value, index): PlanningManuscriptPage => {
    const path = `${chapterId}.pages[${index}]`, page = record(value, path)
    const id = text(page.id, `${path}.id`)
    if (!identifier.test(id) || !id.startsWith(`${chapterId}-`) || seen.has(id)) fail('MANUSCRIPT_PAGE_ID', `${path}.id`)
    seen.add(id)
    const kind = text(page.kind, `${path}.kind`)
    if (!pageKinds.has(kind)) fail('MANUSCRIPT_PAGE_KIND', path)
    if (!Array.isArray(page.sourceRefs) || page.sourceRefs.length === 0 || page.sourceRefs.some(ref => typeof ref !== 'string' || !sourceIds.has(ref))) {
      fail('MANUSCRIPT_SOURCE', `${path}.sourceRefs`)
    }
    const visual = record(page.visual, `${path}.visual`)
    if (!visualKinds.has(String(visual.kind))) fail('MANUSCRIPT_VISUAL', path)
    if (visual.diagram !== undefined && visual.kind !== 'diagram') fail('MANUSCRIPT_DIAGRAM', `${path}.visual.kind`)
    const diagram = visual.diagram === undefined ? undefined : validatePlanningDiagram(visual.diagram, `${path}.visual.diagram`)
    if (visual.sourceMaterialKey !== undefined && visual.kind !== 'source') fail('MANUSCRIPT_VISUAL_SOURCE', `${path}.visual.kind`)
    const sourceMaterialKey = visual.sourceMaterialKey === undefined ? undefined : text(visual.sourceMaterialKey, `${path}.visual.sourceMaterialKey`, 'MANUSCRIPT_VISUAL_SOURCE')
    const optionalProduct = page.product === undefined ? undefined : record(page.product, `${path}.product`)
    // Some structured-output models fill an unused optional object with empty
    // strings. Discard only a wholly blank block on a non-product page; a real
    // product or a partially populated block still requires every field.
    const product = kind !== 'product' && optionalProduct !== undefined
      && Object.values(optionalProduct).every(value => typeof value === 'string' && value.trim() === '')
      ? undefined : optionalProduct
    if (kind === 'product' && !product) fail('MANUSCRIPT_PRODUCT', path)
    const productCopy = product === undefined ? undefined : Object.fromEntries(['name', 'audience', 'experience', 'location', 'scale', 'operations']
      .map(key => [key, prose(text(product[key], `${path}.product.${key}`, 'MANUSCRIPT_PRODUCT'), `${path}.product.${key}`)])) as unknown as PlanningManuscriptPage['product']
    if (productCopy && emptyScale.test(productCopy.scale)) fail('MANUSCRIPT_PRODUCT', `${path}.product.scale: 说明场地、人员、时长等限制怎样决定规模，不能只有待定占位。`)
    const table = page.table === undefined ? undefined : record(page.table, `${path}.table`)
    const columns = table === undefined ? undefined : list(table.columns, `${path}.columns`).map((cell, i) => prose(cell, `${path}.columns[${i}]`))
    const rows = table === undefined ? undefined : list(table.rows, `${path}.rows`).map((row, i) => {
      if (!Array.isArray(row) || row.length !== columns!.length) fail('MANUSCRIPT_TABLE', `${path}.rows[${i}]`)
      return row.map((cell, j) => prose(cell, `${path}.rows[${i}][${j}]`))
    })
    const body = list(page.body, `${path}.body`).map((body, i) => prose(body, `${path}.body[${i}]`))
    const statements = body.flatMap(paragraph => paragraph.split(/[。！？；\n]/u).map(text => text.trim()).filter(Boolean))
    if (statements.length && statements.every(statement => administrativeLead.test(statement))) fail('MANUSCRIPT_AUDIENCE', `${path}.body: 正文只有资料待办，缺少方案内容及依据。`)
    return { id, kind: kind as PlanningManuscriptPage['kind'], title: proposition(page.title, `${path}.title`), claim: proposition(page.claim, `${path}.claim`),
      body, sourceRefs: [...new Set(page.sourceRefs as string[])],
      ...(productCopy ? { product: productCopy } : {}), ...(columns ? { table: { columns, rows: rows! } } : {}),
      visual: { kind: visual.kind as PlanningManuscriptPage['visual']['kind'], subject: prose(visual.subject, `${path}.visual.subject`),
        purpose: prose(visual.purpose, `${path}.visual.purpose`), caption: prose(visual.caption, `${path}.visual.caption`),
        ...(diagram ? { diagram } : {}), ...(sourceMaterialKey === undefined ? {} : { sourceMaterialKey }) },
      notes: list(page.notes, `${path}.notes`, true).map((note, i) => text(note, `${path}.notes[${i}]`)),
    }
  })
  if (chapterId === 'products' && !pages.some(page => page.kind === 'product')) fail('MANUSCRIPT_PRODUCT', 'products: 产品章必须展开具体产品，不能只写抽象策略。')
  return { id: chapterId, title: proposition(row.title, `${chapterId}.title`), thesis: proposition(row.thesis, `${chapterId}.thesis`), pages }
}

export function validatePlanningManuscript(value: unknown, input: FrozenProjectInput): PlanningManuscript {
  const row = record(value, 'manuscript')
  if (row.schemaVersion !== PLANNING_MANUSCRIPT_SCHEMA_VERSION || row.policyVersion !== PLANNING_MANUSCRIPT_POLICY_VERSION) fail('MANUSCRIPT_VERSION', 'manuscript')
  if (row.projectId !== input.projectId || row.sourceRevision !== input.revision || row.sourceFingerprint !== manuscriptSourceFingerprint(input)) fail('MANUSCRIPT_SOURCE_CHANGED', 'manuscript')
  if (typeof row.generatedAt !== 'string' || !Number.isFinite(Date.parse(row.generatedAt))) fail('MANUSCRIPT_SHAPE', 'generatedAt')
  const rows = list(row.chapters, 'chapters')
  if (rows.length !== PLANNING_CHAPTER_IDS.length || rows.some((chapter, index) => record(chapter, 'chapter').id !== PLANNING_CHAPTER_IDS[index])) fail('MANUSCRIPT_CHAPTERS', 'chapters')
  const sources = makeSourceIndex(input)
  const editorial = row.editorial === undefined ? undefined : record(row.editorial, 'editorial')
  if (editorial && (!/^[a-f0-9]{64}$/u.test(String(editorial.draftFingerprint)) || !Number.isFinite(Date.parse(String(editorial.editedAt))))) fail('MANUSCRIPT_SHAPE', 'editorial')
  return { schemaVersion: PLANNING_MANUSCRIPT_SCHEMA_VERSION, policyVersion: PLANNING_MANUSCRIPT_POLICY_VERSION,
    projectId: input.projectId, sourceRevision: input.revision, sourceFingerprint: row.sourceFingerprint,
    generatedAt: row.generatedAt, title: prose(row.title, 'title'),
    chapters: rows.map((chapter, index) => validatePlanningChapter(chapter, PLANNING_CHAPTER_IDS[index]!, sources)),
    ...(editorial ? { editorial: { version: text(editorial.version, 'editorial.version'), draftFingerprint: String(editorial.draftFingerprint), editedAt: String(editorial.editedAt) } } : {}),
  }
}
