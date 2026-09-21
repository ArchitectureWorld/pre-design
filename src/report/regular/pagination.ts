import type { PlanningManuscriptPage, PlanningPageTask } from '../manuscript/types.ts'
import { planningProductRows } from '../render-planning-page.ts'
import { allowsAnalyticalTableText } from './analytical-table.ts'
import { photoStagePresentation, photoStageTopReserve, routePhotoStages } from './stage-connections.ts'
import { consumeRegularText, emptyRegularPage, regularBox as box, regularHeader, regularText, regularTextHeight as height,
  regularWrap, splitRegularText, type Box, type RegularImageSlot, type RegularLayout, type RegularPagePart, type RegularText } from './layout.ts'

const W = 13.333333, H = 7.5
type Template = NonNullable<PlanningPageTask['preferredTemplate']>
interface Composition { mode: RegularLayout['mode']; copy: Box; frames: Box[]; purpose: RegularImageSlot['purpose']; shade?: Box }
interface Flow { part: RegularPagePart; body: string[]; rows: string[][] }
const bodyCopy = (page: PlanningManuscriptPage) => page.editorialSummary ? [...page.body] : [...page.body, ...planningProductRows(page).map(([label, value]) => `${label}｜${value}`)]
const geographicPage = (page: PlanningManuscriptPage) => !!page.task && ['regional-context', 'accessibility', 'audience-catchment', 'competitor-distribution', 'site-analysis'].includes(page.task.kind)

function defaultTemplate(page: PlanningManuscriptPage): Template {
  if (page.task?.preferredTemplate) return page.task.preferredTemplate
  if (page.table) return 'data'
  if (page.visual.kind === 'source' || page.visual.kind === 'diagram' || geographicPage(page)) return 'map-analysis'
  if (page.task?.kind === 'divider' || bodyCopy(page).join('').length <= 90) return 'full-background'
  return 'split-right'
}

function composition(template: Template, count: number, analytical = false): Composition {
  const side = W / 2
  switch (template) {
    case 'full-background': return { mode: 'background', copy: box(0.72, 0.5, 7.5, 6.45), frames: [box(0, 0, W, H)], purpose: 'scene', shade: box(0, 0, 8.85, H) }
    case 'split-left': return { mode: 'left', copy: box(7.18, 0.45, 5.5, 6.5), frames: [box(0, 0, side, H)], purpose: 'scene' }
    case 'split-right': return { mode: 'right', copy: box(0.65, 0.45, 5.5, 6.5), frames: [box(side, 0, side, H)], purpose: 'scene' }
    case 'split-top': return { mode: 'top', copy: box(0.65, 4.05, 12, 2.95), frames: [box(0, 0, W, H / 2)], purpose: 'scene' }
    case 'split-bottom': return { mode: 'bottom', copy: box(0.65, 0.3, 12, 3.15), frames: [box(0, H / 2, W, H / 2)], purpose: 'scene' }
    case 'array-horizontal': return { mode: 'row', copy: box(0.65, 4.05, 12, 2.95), frames: Array.from({ length: count }, (_, i) => box(i * W / count, 0, W / count, H / 2)), purpose: 'scene' }
    case 'array-vertical': return { mode: 'column', copy: box(7.18, 0.45, 5.5, 6.5), frames: Array.from({ length: count }, (_, i) => box(0, i * H / count, W / 2, H / count)), purpose: 'scene' }
    case 'map-analysis': return { mode: 'diagram', copy: box(0.5, 0.45, 3.35, 6.5), frames: [box(4.05, 0, W - 4.05, H)], purpose: 'analysis' }
    case 'data': return analytical ? { mode: 'table', copy: box(0.65, 0.4, 12, 6.55), frames: [], purpose: 'analysis' }
      : { mode: 'right', copy: box(0.55, 0.4, 8.3, 6.55), frames: [box(9.333333, 0, 4, H)], purpose: 'scene' }
  }
}

function readableFallback(template: Template): Composition {
  const wider = composition('split-right', 1)
  // A wider copy column must never turn source plans or maps into scene crops.
  return template === 'map-analysis' ? { ...wider, mode: 'diagram', purpose: 'analysis' } : wider
}

function imageSlots(page: PlanningManuscriptPage, comp: Composition, partIndex: number): RegularImageSlot[] {
  return comp.frames.map((frame, index) => ({
    usageId: index ? `${page.id}:${partIndex ? `continuation:${partIndex}:` : ''}detail:${index + 1}`
      : partIndex ? `${page.id}:continuation:${partIndex}` : `${page.id}:main`,
    box: frame, targetAspectRatio: frame.w / frame.h, purpose: comp.purpose, fit: comp.purpose === 'analysis' ? 'contain' : 'cover',
  }))
}

function tableMetrics(page: PlanningManuscriptPage, width: number) {
  const table = page.table!
  const shortLabels = table.columns.length > 1 && table.rows.every(row => (row[0]?.length ?? 0) <= 12)
  const first = shortLabels ? Math.min(1.65, width / table.columns.length) : width / table.columns.length
  const widths = table.columns.map((_, i) => i === 0 ? first : (width - first) / (table.columns.length - 1 || 1))
  const measure = (value: string, index: number) => height(value, widths[index]! - 0.24, 14, 21) + 0.15
  const rowHeight = (row: readonly string[]) => Math.max(...row.map(measure))
  return { widths, measure, rowHeight, head: rowHeight(table.columns) }
}

/** Body paragraphs and table rows consume the same measured page budget. */
function flow(page: PlanningManuscriptPage, chapter: string, comp: Composition, pendingBody: readonly string[], pendingRows: readonly (readonly string[])[], partIndex: number): Flow {
  const body = [...pendingBody], rows = pendingRows.map(row => [...row]), h = regularHeader(page, chapter, comp.copy, true, comp.mode === 'background')
  const metrics = page.table ? tableMetrics(page, h.body.w) : undefined
  const reserve = rows.length && metrics ? metrics.head + Math.min(metrics.rowHeight(rows[0]!), h.body.h * 0.4) + 0.18 : 0
  const paragraphs = consumeRegularText(body, box(h.body.x, h.body.y, h.body.w, Math.max(0, h.body.h - reserve)), h.texts)
  let renderedTable: RegularLayout['table']
  const selectedRows: string[][] = []
  if (rows.length && metrics) {
    const y = paragraphs.length ? Math.max(...h.texts.map(item => item.box.y + item.box.h)) + 0.18 : h.body.y
    const capacity = h.body.y + h.body.h - y, rowHeights = [metrics.head]
    let used = metrics.head
    while (rows.length) {
      const source = rows[0]!, rh = metrics.rowHeight(source), room = capacity - used
      if (rh <= room + 1e-6) { selectedRows.push(source); rowHeights.push(rh); used += rh; rows.shift(); continue }
      // Keep a normal row intact, including its label. Only a row larger than a
      // whole page may be split; every cell character remains in source order.
      if (selectedRows.length || paragraphs.length || rh <= h.body.h - metrics.head) break
      const pairs = source.map((value, index) => splitRegularText(value, room, text => metrics.measure(text, index)))
      const head = pairs.map(pair => pair[0]), tail = pairs.map(pair => pair[1])
      if (!head.some(Boolean)) break
      selectedRows.push(head); rowHeights.push(metrics.rowHeight(head)); used += metrics.rowHeight(head)
      if (tail.some(Boolean)) rows[0] = tail; else rows.shift()
      break
    }
    if (selectedRows.length) renderedTable = { box: box(h.body.x, y, h.body.w, used), columns: page.table!.columns.map((value, i) => regularWrap(value, metrics.widths[i]! - 0.24, 14)),
      rows: selectedRows.map(row => row.map((value, i) => regularWrap(value, metrics.widths[i]! - 0.24, 14))), rowHeights, columnWidths: metrics.widths }
  }
  const intentional = comp.mode === 'table' && partIndex > 0 && allowsAnalyticalTableText(paragraphs, selectedRows)
  return { body, rows, part: { content: { ...emptyRegularPage(page), body: paragraphs, ...(selectedRows.length ? { table: { columns: page.table!.columns, rows: selectedRows } } : {}) },
    layout: { mode: comp.mode, chapterTitle: chapter, texts: h.texts, media: [], imageSlots: imageSlots(page, comp, partIndex),
      ...(comp.shade ? { shade: comp.shade } : {}), ...(renderedTable ? { table: renderedTable } : {}),
      ...(intentional ? { intentionalTextOnly: 'financial-table' as const } : {}),
      ...(page.task?.kind === 'divider' ? { intentionalWhitespace: 'divider' as const } : {}),
    } } }
}

const finished = (result: Flow) => result.body.length === 0 && result.rows.length === 0
const progressed = (result: Flow) => result.part.content.body.length > 0 || (result.part.content.table?.rows.length ?? 0) > 0

function takeCharacters(source: readonly string[], maximum: number): [string[], string[]] {
  const first: string[] = [], rest = [...source]
  let remaining = maximum
  while (rest.length && remaining > 0) {
    const value = rest.shift()!, chars = Array.from(value)
    if (chars.length <= remaining) { first.push(value); remaining -= chars.length; continue }
    let boundary = chars.slice(0, remaining).join('')
    const stop = Math.max(boundary.lastIndexOf('。'), boundary.lastIndexOf('；'))
    if (stop > boundary.length * 0.7) boundary = boundary.slice(0, stop + 1)
    first.push(boundary); rest.unshift(value.slice(boundary.length)); break
  }
  return [first, rest]
}

function recoverSparseTail(page: PlanningManuscriptPage, chapter: string, parts: RegularPagePart[], template: Template, primary: Composition) {
  if (parts.length < 2 || page.table) return
  const last = parts.at(-1)!, previous = parts.at(-2)!
  if (last.content.body.join('').length > 100) return
  const all = [...previous.content.body, ...last.content.body], index = parts.length - 2
  const candidates = [primary, readableFallback(template)]
  for (const candidate of candidates) {
    const result = flow(page, chapter, candidate, all, [], index)
    if (finished(result)) { parts.splice(index, 2, result.part); return }
  }
  // A genuine long page needs more space. Balance the final two pages at the
  // same readable type size instead of isolating its final sentence.
  const total = Array.from(all.join('')).length
  for (const fraction of [0.5, 0.55, 0.45, 0.6, 0.4]) {
    const [first, second] = takeCharacters(all, Math.floor(total * fraction))
    const a = flow(page, chapter, primary, first, [], index)
    const b = flow(page, chapter, primary, second, [], index + 1)
    if (finished(a) && finished(b) && first.join('').length > 100 && second.join('').length > 100) { parts.splice(index, 2, a.part, b.part); return }
  }
}

function paginateOrdinaryContent(page: PlanningManuscriptPage, chapter: string, template: Template, primary: Composition, startIndex: number): RegularPagePart[] {
  let body = bodyCopy(page), rows = page.table?.rows.map(row => [...row]) ?? []
  const parts: RegularPagePart[] = []
  do {
    const index = startIndex + parts.length
    const analytical = index > 0 && !page.visual.sourceMaterialKey && !page.visual.diagram?.nodes.length && allowsAnalyticalTableText(body, rows)
    const chosen = analytical ? 'data' as const : template
    let result: Flow
    try { result = flow(page, chapter, analytical ? composition('data', 1, true) : primary, body, rows, index) }
    catch (error) {
      if (chosen === 'split-right' || !String(error).includes('REGULAR_HEADER_OVERFLOW')) throw error
      result = flow(page, chapter, readableFallback(template), body, rows, index)
    }
    if (!finished(result) && !analytical && (result.body.join('').length <= 100 && !result.rows.length || !progressed(result))) {
      const alternate = flow(page, chapter, readableFallback(template), body, rows, index)
      if (finished(alternate) || !progressed(result) && progressed(alternate)) result = alternate
    }
    if (!progressed(result) && (body.length || rows.length)) throw new Error(`REGULAR_COPY_OVERFLOW: ${page.id}`)
    parts.push(result.part); body = result.body; rows = result.rows
  } while (body.length || rows.length)
  recoverSparseTail(page, chapter, parts, template, primary)
  return parts
}

function ordinaryContent(page: PlanningManuscriptPage, chapter: string, startIndex = 0): RegularPagePart[] {
  const template = defaultTemplate(page), count = ['array-horizontal', 'array-vertical'].includes(template) ? Math.max(2, Math.min(4, page.task?.imageCount ?? 2)) : 1
  // Regional arguments share one map context: measure all their copy in the
  // wider analytical layout before freezing slots. Case sources keep enough
  // image area for wide originals; they may use distinct continuation images.
  const wide = template === 'map-analysis' && geographicPage(page) ? paginateOrdinaryContent(page, chapter, template, readableFallback(template), startIndex) : undefined
  const regular = paginateOrdinaryContent(page, chapter, template, composition(template, count), startIndex)
  return wide && wide.length < regular.length ? wide : regular
}

function stageContent(page: PlanningManuscriptPage, chapter: string): RegularPagePart[] {
  const graph = page.visual.diagram!, presentation = photoStagePresentation(graph)
  const paragraphOwner = (paragraph: string) => presentation.nodeIds.find(id => {
    const label = graph.nodes.find(node => node.id === id)!.label
    return paragraph === label || paragraph.startsWith(`${label}：`) || paragraph.startsWith(`${label}:`) || paragraph.startsWith(`${label}｜`)
  })
  const pending = presentation.nodeIds.map((id, index) => ({ node: graph.nodes.find(node => node.id === id)!,
    label: `${presentation.kind === 'sequence' ? `${String(index + 1).padStart(2, '0')} ` : ''}${graph.nodes.find(node => node.id === id)!.label}` }))
  const queue = bodyCopy(page), parts: RegularPagePart[] = []
  while (pending.length) {
    const h = regularHeader(page, chapter, box(0.65, 0.35, 12, 6.7), true)
    let count = Math.min(3, pending.length === 4 ? 2 : pending.length)
    // Stage count depends on measured labels and authored explanations, never on
    // the aspect ratios of images that happen to have arrived first.
    const groupHeight = (n: number) => Math.max(...pending.slice(0, n).map(item => height(item.label, W / n - 0.24, 14, 20) + 0.14))
    while (count > 1 && H - h.body.y - groupHeight(count) - W / count / (16 / 9) < 0.2) count--
    const group = pending.splice(0, count), ids = new Set(group.map(item => item.node.id))
    const localEdges = presentation.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to))
    const references = presentation.edges.filter(edge => ids.has(edge.from) && !ids.has(edge.to))
    const localGraph = { nodes: group.map(item => item.node), edges: localEdges }
    const reserve = localEdges.length ? photoStageTopReserve(localGraph, W) : 0.12
    const referenceCopy = references.map(edge => `${graph.nodes.find(node => node.id === edge.from)!.label} → ${graph.nodes.find(node => node.id === edge.to)!.label}${edge.label ? `（${edge.label}）` : ''}`).join('；')
    const referenceHeight = referenceCopy ? height(referenceCopy, 12, 12, 18) + 0.08 : 0
    const captionHeight = Math.max(...group.map(item => height(item.label, W / count - 0.24, 14, 20) + 0.14), 0.45)
    const remainingStagePages = 1 + Math.ceil(pending.length / 3)
    const proseHeight = queue.reduce((sum, paragraph) => sum + height(paragraph, h.body.w, 15, 23) + 0.13, 0)
    const targetProse = proseHeight / remainingStagePages + 0.13
    const imageHeight = Math.max(1.6, Math.min(3, W / count / (16 / 9), H - h.body.y - captionHeight - reserve - referenceHeight - targetProse))
    const imageY = H - imageHeight, captionY = imageY - captionHeight
    const proseCapacity = captionY - reserve - referenceHeight - h.body.y
    if (proseCapacity < 0) throw new Error(`REGULAR_STAGE_SPACE_REQUIRED: ${page.id}/${group[0]!.node.id}`)
    // Paragraphs naming a stage travel with that stage. Unassigned explanations
    // are distributed across the authored stage pages in source order.
    const groupBody: string[] = [], deferred: string[] = []
    for (const paragraph of queue) {
      const owner = paragraphOwner(paragraph)
      if (owner && ids.has(owner)) groupBody.push(paragraph)
      else deferred.push(paragraph)
    }
    const owned = [...groupBody], renderedBody = consumeRegularText(owned, box(h.body.x, h.body.y, h.body.w, proseCapacity), h.texts)
    let y = renderedBody.length ? Math.max(...h.texts.map(item => item.box.y + item.box.h)) + 0.13 : h.body.y
    const unassigned = deferred.filter(paragraph => !paragraphOwner(paragraph))
    const allowance = proseCapacity - (y - h.body.y)
    const extra = consumeRegularText(unassigned, box(h.body.x, y, h.body.w, Math.max(0, allowance)), h.texts)
    renderedBody.push(...extra)
    const remaining = deferred.filter(paragraph => paragraphOwner(paragraph))
    queue.splice(0, queue.length, ...owned, ...remaining, ...unassigned)
    if (referenceCopy) h.texts.push(regularText('body', referenceCopy, box(0.65, captionY - reserve - referenceHeight, 12, referenceHeight), 12, 18))
    const nodes = new Map<string, Box>(), slots: RegularImageSlot[] = []
    group.forEach((item, index) => {
      const frame = box(index * W / count, imageY, W / count, imageHeight), caption = box(frame.x, captionY, frame.w, captionHeight)
      h.texts.push({ ...regularText('stage', item.label, caption, 14, 20), nodeId: item.node.id })
      nodes.set(item.node.id, box(caption.x, caption.y, caption.w, imageHeight + captionHeight))
      slots.push({ usageId: `${page.id}:${item.node.id}`, nodeId: item.node.id, box: frame, targetAspectRatio: frame.w / frame.h, purpose: 'stage', fit: 'cover' })
    })
    const connections = localEdges.length ? routePhotoStages(localGraph, nodes, { width: W, height: H }, captionY - reserve) : []
    parts.push({ content: { ...emptyRegularPage(page), body: renderedBody }, layout: { mode: 'row', chapterTitle: chapter, texts: h.texts, media: [], imageSlots: slots,
      stageFlow: presentation.kind, connections, ...(references.length ? { relationReferences: references } : {}) } })
  }
  if (queue.length || page.table) parts.push(...ordinaryContent({ ...page, body: queue, product: undefined,
    task: page.task ? { ...page.task, kind: 'scene', preferredTemplate: 'split-right' } : undefined,
    visual: { ...page.visual, kind: 'concept', diagram: undefined } }, chapter, parts.length))
  return parts
}

/** Stable physical pages and image needs, computed exclusively from authored content. */
export function planStableRegularContent(page: PlanningManuscriptPage, chapter: string): RegularPagePart[] {
  return page.visual.diagram?.nodes.length && !geographicPage(page) ? stageContent(page, chapter) : ordinaryContent(page, chapter)
}
