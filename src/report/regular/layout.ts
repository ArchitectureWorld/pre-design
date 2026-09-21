import type { ClientVisualAsset } from '../client-types.ts'
import type { PlanningManuscriptPage } from '../manuscript/types.ts'
import { wrapClientText } from '../client-typography.ts'
import { planningProductRows } from '../render-planning-page.ts'
import { photoStagePresentation, photoStageTopReserve, routePhotoStages } from './stage-connections.ts'
import { imageBriefHash, imagePlacementHash, MIN_RETAINED_IMAGE_AREA } from '../../visual/image-policy.ts'

export const REGULAR_CANVAS = { width: 13.333333, height: 7.5, unit: 'in' as const }
export const REGULAR_LAYOUT_VERSION = 'regular-2026-09-21.1'
export interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface RegularText { readonly role: 'eyebrow' | 'title' | 'claim' | 'body' | 'stage'; readonly text: string; readonly box: Box; readonly size: number; readonly leading: number; readonly dark?: boolean; readonly nodeId?: string }
export interface RegularMedia { readonly assetId: string; readonly box: Box; readonly fit: 'cover' | 'contain'; readonly nodeId?: string }
export interface RegularMaterialGap { readonly pageId: string; readonly nodeId?: string; readonly reason: 'missing-stage-image' | 'duplicate-original' | 'continuation-image-required' }
export interface RegularLayout {
  readonly mode: 'cover' | 'background' | 'left' | 'right' | 'top' | 'bottom' | 'row' | 'column' | 'diagram' | 'text' | 'table'
  readonly chapterTitle: string
  readonly texts: readonly RegularText[]
  readonly media: readonly RegularMedia[]
  readonly shade?: Box
  readonly materialGaps?: readonly RegularMaterialGap[]
  readonly stageFlow?: 'sequence' | 'parallel' | 'network'
  /** Relations whose endpoint is shown on another physical page. */
  readonly relationReferences?: readonly { readonly from: string; readonly to: string; readonly label?: string }[]
  readonly connections?: readonly { readonly from: string; readonly to: string; readonly path: string; readonly label?: string; readonly labelX: number; readonly labelY: number }[]
  readonly table?: { readonly box: Box; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[]; readonly rowHeights: readonly number[]; readonly columnWidths?: readonly number[] }
}
export interface RegularPagePart { readonly content: PlanningManuscriptPage; readonly layout: RegularLayout }

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h })
const widthChars = (w: number, size: number) => Math.max(4, Math.floor(w * 72 / size) - 1)
export const regularWrap = (value: string, w: number, size: number) => wrapClientText(value, widthChars(w, size), Number.MAX_SAFE_INTEGER, 'REGULAR_REPORT_COPY')
const height = (value: string, w: number, size: number, leading: number) => regularWrap(value, w, size).split('\n').length * leading / 72 + 0.05
function text(role: RegularText['role'], value: string, bounds: Box, size: number, leading: number, dark = false): RegularText {
  return { role, text: regularWrap(value, bounds.w, size), box: bounds, size, leading, ...(dark ? { dark } : {}) }
}
function header(page: PlanningManuscriptPage, chapter: string, bounds: Box, compact = false, dark = false) {
  const texts: RegularText[] = [text('eyebrow', chapter, box(bounds.x, bounds.y, bounds.w, 0.25), 10, 13, dark)]
  let y = bounds.y + 0.4
  const size = compact ? 24 : 28, leading = compact ? 31 : 36
  const th = height(page.title, bounds.w, size, leading)
  texts.push(text('title', page.title, box(bounds.x, y, bounds.w, th), size, leading, dark)); y += th + 0.17
  const cs = compact ? 16 : 18, cl = compact ? 24 : 27, ch = height(page.claim, bounds.w, cs, cl)
  texts.push(text('claim', page.claim, box(bounds.x, y, bounds.w, ch), cs, cl, dark)); y += ch + 0.24
  if (y > bounds.y + bounds.h) throw new Error(`REGULAR_HEADER_OVERFLOW: ${page.id}`)
  return { texts, body: box(bounds.x, y, bounds.w, bounds.y + bounds.h - y) }
}
const empty = (page: PlanningManuscriptPage): PlanningManuscriptPage => ({ ...page, body: [], product: undefined, table: undefined })
function splitToFit(value: string, capacity: number, measure: (v: string) => number): [string, string] {
  if (measure(value) <= capacity) return [value, '']
  const chars = Array.from(value)
  let low = 1, high = chars.length, size = 0
  while (low <= high) { const mid = Math.floor((low + high) / 2); if (measure(chars.slice(0, mid).join('')) <= capacity) { size = mid; low = mid + 1 } else high = mid - 1 }
  if (!size) return ['', value]
  // Prefer a sentence boundary when it leaves at most two lines of unused space.
  const candidate = chars.slice(0, size).join(''), sentence = Math.max(candidate.lastIndexOf('。'), candidate.lastIndexOf('；'))
  if (sentence > candidate.length * 0.72) size = Array.from(candidate.slice(0, sentence + 1)).length
  return [chars.slice(0, size).join(''), chars.slice(size).join('')]
}
function consume(queue: string[], area: Box, texts: RegularText[]) {
  const body: string[] = []; let y = area.y
  while (queue.length && area.y + area.h - y >= 0.38) {
    const fullHeight = height(queue[0]!, area.w, 15, 23)
    if (y > area.y && fullHeight <= area.h && fullHeight > area.y + area.h - y) break
    const [head, tail] = splitToFit(queue[0]!, area.y + area.h - y, v => height(v, area.w, 15, 23))
    if (!head) break
    const h = height(head, area.w, 15, 23)
    body.push(head); texts.push(text('body', head, box(area.x, y, area.w, h), 15, 23)); y += h + 0.13
    if (tail) { queue[0] = tail; break } else queue.shift()
  }
  return body
}
export function regularOriginalImageId(asset: ClientVisualAsset): string {
  return asset.imageIdentity?.fileSha256 === asset.sha256 && asset.imageIdentity.originalId.trim()
    ? asset.imageIdentity.originalId : asset.sha256
}
const validDimensions = (asset: ClientVisualAsset) => Number.isFinite(asset.width) && Number.isFinite(asset.height) && asset.width > 0 && asset.height > 0
const analyticalImage = (asset: ClientVisualAsset) => ['diagram', 'map', 'chart'].includes(asset.role)
  || [asset.imageQuality?.contentKind, asset.imageQuality?.inspection?.contentKind].some(kind => ['plan', 'map', 'section', 'diagram', 'composite'].includes(kind ?? ''))
const storyVisual = (asset: ClientVisualAsset) => !['diagram', 'chart', 'map'].includes(asset.role) || asset.sourceKind === 'project-source'
export function regularInspectionProblem(asset: ClientVisualAsset, placement: RegularMedia): string | undefined {
  const inspection = asset.imageQuality?.inspection, brief = asset.imageQuality?.requirement
  if (!inspection) return 'missing-inspection'
  if (inspection.actualImageInput !== true) return 'missing-image-input'
  if (inspection.schemaVersion !== 'pre-design.image-inspection.v1' || !inspection.executionId?.trim()
    || !inspection.actualModel?.provider?.trim() || !inspection.actualModel?.model?.trim()) return 'missing-review-execution'
  if (inspection.imageSha256 !== asset.sha256) return 'stale-image'
  if (!brief || inspection.usageId !== brief.id || inspection.requirementHash !== imageBriefHash(brief)) return 'stale-requirement'
  if (inspection.placementHash !== imagePlacementHash(placement)) return 'stale-placement'
  if (inspection.decision !== 'approved' || inspection.quality !== 'pass' || !inspection.relevant || inspection.mismatches.length
    || !inspection.textLegible || inspection.watermark === 'obstructive') return 'rejected-inspection'
  return undefined
}
/** CSS uses centered object positioning; return the actual visible pixels and source crop. */
export function regularImageGeometry(asset: ClientVisualAsset, placement: RegularMedia) {
  const target = placement.box, valid = validDimensions(asset)
  let source = { x: 0, y: 0, width: 1, height: 1 }, visible = target
  if (valid) {
    const ratio = asset.width / asset.height, slot = target.w / target.h
    if (placement.fit === 'contain') {
      const w = Math.min(target.w, target.h * ratio), h = w / ratio
      visible = { x: target.x + (target.w - w) / 2, y: target.y + (target.h - h) / 2, w, h }
    } else if (slot > ratio) { const h = ratio / slot; source = { x: 0, y: (1 - h) / 2, width: 1, height: h } }
    else { const w = slot / ratio; source = { x: (1 - w) / 2, y: 0, width: w, height: 1 } }
  }
  const essential = asset.imageQuality?.inspection?.essentialBounds ?? []
  const safeSubjects = placement.fit === 'contain' || essential.length > 0 && essential.every(b =>
    [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0 && b.x >= source.x - 1e-6 && b.y >= source.y - 1e-6
    && b.x + b.width <= source.x + source.width + 1e-6 && b.y + b.height <= source.y + source.height + 1e-6)
  return { visible, source, retainedArea: valid || placement.fit === 'contain' ? source.width * source.height : 0,
    safeSubjects, analytical: analyticalImage(asset), validDimensions: valid }
}
function media(asset: ClientVisualAsset, bounds: Box, preserveComposition = false, nodeId?: string): RegularMedia {
  const candidate: RegularMedia = { assetId: asset.assetId, box: bounds, fit: 'cover', ...(nodeId ? { nodeId } : {}) }
  const geometry = regularImageGeometry(asset, candidate)
  const fit = !preserveComposition && !geometry.analytical && geometry.validDimensions
    && geometry.retainedArea + 1e-6 >= MIN_RETAINED_IMAGE_AREA && geometry.safeSubjects && !regularInspectionProblem(asset, candidate) ? 'cover' : 'contain'
  if (fit === 'cover' || !geometry.validDimensions || geometry.analytical) return { ...candidate, fit }
  // Contain is a composition decision, not a centered image in an oversized
  // empty panel. Keep source proportions and align the visible image to the
  // panel's full-bleed edges; inner array cells retain their existing geometry.
  const w = Math.min(bounds.w, bounds.h * asset.width / asset.height), h = w * asset.height / asset.width
  const x = bounds.x < 1e-6 ? bounds.x : Math.abs(bounds.x + bounds.w - REGULAR_CANVAS.width) < 1e-6
    ? bounds.x + bounds.w - w : bounds.x + (bounds.w - w) / 2
  const y = bounds.y < 1e-6 ? bounds.y : Math.abs(bounds.y + bounds.h - REGULAR_CANVAS.height) < 1e-6
    ? bounds.y + bounds.h - h : bounds.y + (bounds.h - h) / 2
  return { ...candidate, fit, box: box(x, y, w, h) }
}
function uniqueImages(assets: readonly ClientVisualAsset[]): ClientVisualAsset[] {
  const originals = new Set<string>(), hashes = new Set<string>()
  return assets.filter(asset => {
    const original = regularOriginalImageId(asset)
    if (originals.has(original) || hashes.has(asset.sha256)) return false
    originals.add(original); hashes.add(asset.sha256); return true
  })
}
const continuationImage = (asset: ClientVisualAsset, pageId: string) => asset.imageQuality?.requirement?.id.startsWith(`${pageId}:continuation:`) === true
/** The slot follows the source ratio. Its bottom edge remains on the array boundary. */
function compositionBox(asset: ClientVisualAsset, cell: Box): Box {
  if (!validDimensions(asset)) return cell
  const w = Math.min(cell.w, cell.h * asset.width / asset.height), h = w * asset.height / asset.width
  return box(cell.x + (cell.w - w) / 2, cell.y + cell.h - h, w, h)
}
function arrayBoxes(assets: readonly ClientVisualAsset[], bounds: Box, vertical: boolean, gap: number): Box[] {
  const cell = ((vertical ? bounds.h : bounds.w) - gap * (assets.length - 1)) / assets.length
  return assets.map((asset, index) => compositionBox(asset, vertical
    ? box(bounds.x, bounds.y + index * (cell + gap), bounds.w, cell)
    : box(bounds.x + index * (cell + gap), bounds.y, cell, bounds.h)))
}
const visibleArrayArea = (boxes: readonly Box[]) => boxes.reduce((sum, b) => sum + b.w * b.h, 0)
function isPortraitPhoto(asset: ClientVisualAsset): boolean {
  return !['diagram', 'map', 'chart'].includes(asset.role)
    && Number.isFinite(asset.width) && Number.isFinite(asset.height) && asset.width > 0 && asset.height > asset.width
}
function needsWideComposition(asset: ClientVisualAsset): boolean {
  if (!validDimensions(asset) || asset.width <= asset.height) return false
  const visible = compositionBox(asset, box(0, 0, REGULAR_CANVAS.width / 2, REGULAR_CANVAS.height))
  return visible.w * visible.h < REGULAR_CANVAS.width * REGULAR_CANVAS.height * 0.2
}
function portraitColumnBounds(asset: ClientVisualAsset, bounds: Box, imageBounds: Box) {
  // Near-square portraits need a slightly wider column to remain full-height under contain.
  const extraWidth = Math.max(0, imageBounds.h * (asset.width / asset.height) - imageBounds.w)
  const left = imageBounds.x === 0
  return {
    bounds: box(bounds.x + (left ? extraWidth : 0), bounds.y, bounds.w - extraWidth, bounds.h),
    imageBounds: box(imageBounds.x - (left ? 0 : extraWidth), imageBounds.y, imageBounds.w + extraWidth, imageBounds.h),
  }
}

export function regularCover(title: string, claim: string, asset?: ClientVisualAsset): RegularLayout {
  const bounds = box(0.72, 3.4, 10.8, 3.3)
  const page = { id: 'cover', title: title.replace(/汇报文案$/u, '汇报'), claim } as PlanningManuscriptPage
  const h = header(page, '前期策划 · 项目汇报', bounds, false, true)
  return { mode: 'cover', chapterTitle: '项目汇报', texts: h.texts, media: asset ? [media(asset, box(0, 0, REGULAR_CANVAS.width, 7.5))] : [], shade: box(0, 2.7, REGULAR_CANVAS.width, 4.8) }
}

/** One physical plan for all output formats. No model calls or content summarization. */
export function planRegularManuscriptPage(page: PlanningManuscriptPage, chapterTitle: string, assets: readonly ClientVisualAsset[], ordinal: number): RegularPagePart[] {
  if (page.editorialSummary) return planVisualStory(page, chapterTitle, assets, ordinal)
  if (assets.some(asset => continuationImage(asset, page.id))) return planVisualStory({ ...page, editorialSummary: true, product: undefined,
    body: [...page.body, ...planningProductRows(page).map(([label, value]) => `${label}｜${value}`)] }, chapterTitle, assets, ordinal)
  assets = uniqueImages(assets)
  if (assets.length > 3) {
    const parts: RegularPagePart[] = [], pending = [...assets]
    while (pending.length) {
      const group = pending.splice(0, pending.length === 4 ? 2 : 3)
      const content = pending.length ? { ...empty(page), body: [] } : page
      parts.push(...planRegularManuscriptPage(content, chapterTitle, group, ordinal++))
    }
    return parts
  }
  const parts: RegularPagePart[] = []
  const queue = [...page.body, ...planningProductRows(page).map(([label, value]) => `${label}｜${value}`)]
  let mode: RegularLayout['mode'] = assets.length > 1 ? ordinal % 2 ? 'column' : 'row'
    : assets.length ? (assets[0]!.role === 'diagram' || page.visual.kind === 'diagram' ? 'diagram' : page.kind === 'comparison' ? ordinal % 2 ? 'right' : 'left' : (['left', 'right', 'top', 'bottom', 'background'] as const)[ordinal % 5]!) : 'text'
  const wide = assets.length === 1 && needsWideComposition(assets[0]!)
  if (wide) mode = ordinal % 2 ? 'top' : 'bottom'
  const portrait = assets.length === 1 && mode !== 'diagram' && isPortraitPhoto(assets[0]!)
  if (portrait && ['top', 'bottom', 'background'].includes(mode)) mode = ordinal % 2 ? 'right' : 'left'
  if (assets.length) {
    let bounds = box(0.7, 0.5, 11.93, 6.35), imageBounds = box(0, 0, 6.666666, 7.5)
    if (mode === 'left') bounds = box(7.22, 0.55, 5.4, 6.35)
    if (mode === 'right') { bounds = box(0.7, 0.55, 5.4, 6.35); imageBounds = box(6.666666, 0, 6.666666, 7.5) }
    if (mode === 'top') { bounds = box(0.7, 4.12, 11.93, 2.7); imageBounds = box(0, 0, 13.333333, 3.75) }
    if (mode === 'bottom') { bounds = box(0.7, 0.42, 11.93, 2.83); imageBounds = box(0, 3.75, 13.333333, 3.75) }
    if (mode === 'background') { bounds = box(0.72, 0.65, 7.5, 5.9); imageBounds = box(0, 0, 13.333333, 7.5) }
    if (portrait) ({ bounds, imageBounds } = portraitColumnBounds(assets[0]!, bounds, imageBounds))
    const h = header(page, chapterTitle, bounds, ['top', 'bottom', 'left', 'right'].includes(mode), mode === 'background')
    let images: RegularMedia[]
    let body: string[] = []
    if (['diagram', 'row', 'column'].includes(mode)) {
      imageBounds = box(0, h.body.y, REGULAR_CANVAS.width, 7.5 - h.body.y)
      // Every bound asset is shown. Multiple photos use equal horizontal or vertical tracks.
      const gap = 0.14
      let frames = arrayBoxes(assets, imageBounds, mode === 'column', gap)
      if (assets.length > 1 && visibleArrayArea(frames) < REGULAR_CANVAS.width * REGULAR_CANVAS.height * 0.2) {
        const alternate = arrayBoxes(assets, imageBounds, mode !== 'column', gap)
        if (visibleArrayArea(alternate) > visibleArrayArea(frames)) { mode = mode === 'column' ? 'row' : 'column'; frames = alternate }
      }
      images = assets.map((asset, i) => media(asset, mode === 'diagram' ? imageBounds : frames[i]!))
    } else {
      images = [media(assets[0]!, imageBounds, portrait || wide)]
      if (mode !== 'background') {
        const originalQueue = [...queue], headerCount = h.texts.length
        body = consume(queue, h.body, h.texts)
        // Do not strand a short closing sentence on a largely empty continuation.
        if (queue.length && queue.join('').length < 80) { queue.splice(0, queue.length, ...originalQueue); body = []; h.texts.splice(headerCount) }
      }
    }
    let inlineTable: RegularLayout['table']
    if (page.table && !queue.length && ['left', 'right'].includes(mode)) {
      const rows = [page.table.columns, ...page.table.rows]
      const shortLabels = page.table.columns.length === 2 && rows.every(row => row[0]!.length <= 6)
      const columnWidths = shortLabels ? [bounds.w * 0.28, bounds.w * 0.72] : page.table.columns.map(() => bounds.w / page.table!.columns.length)
      const rowHeights = rows.map(row => Math.max(...row.map((v, i) => height(v, columnWidths[i]! - 0.24, 14, 21) + 0.15)))
      const y = Math.max(...h.texts.map(t => t.box.y + t.box.h)) + 0.2, tableHeight = rowHeights.reduce((sum, n) => sum + n, 0)
      if (y + tableHeight <= 6.9) inlineTable = { box: box(bounds.x, y, bounds.w, tableHeight), columns: page.table.columns.map((v, i) => regularWrap(v, columnWidths[i]! - 0.24, 14)), rows: page.table.rows.map(row => row.map((v, i) => regularWrap(v, columnWidths[i]! - 0.24, 14))), rowHeights, columnWidths }
    }
    parts.push({ content: { ...empty(page), body, ...(inlineTable ? { table: page.table } : {}) }, layout: { mode, chapterTitle, texts: h.texts, media: images, ...(inlineTable ? { table: inlineTable } : {}), ...(mode === 'background' ? { shade: box(0, 0, 8.85, 7.5) } : {}) } })
  }
  while (queue.length || parts.length === 0) {
    const h = header(page, chapterTitle, box(0.7, 0.5, 11.93, 6.37))
    const totalHeight = queue.reduce((sum, p) => sum + height(p, h.body.w, 15, 23) + 0.13, 0)
    let body: string[]
    if (totalHeight > h.body.h) {
      const w = (h.body.w - 0.48) / 2
      const columnTotal = queue.reduce((sum, p) => sum + height(p, w, 15, 23) + 0.13, 0)
      const firstHeight = columnTotal <= 2 * h.body.h ? Math.min(h.body.h, columnTotal / 2 + 0.4) : h.body.h
      body = consume(queue, box(h.body.x, h.body.y, w, firstHeight), h.texts)
      body.push(...consume(queue, box(h.body.x + w + 0.48, h.body.y, w, h.body.h), h.texts))
    } else body = consume(queue, h.body, h.texts)
    if (queue.length && !body.length) throw new Error(`REGULAR_COPY_OVERFLOW: ${page.id}`)
    parts.push({ content: { ...empty(page), body }, layout: { mode: 'text', chapterTitle, texts: h.texts, media: [],
      ...(assets.length ? { materialGaps: [{ pageId: page.id, reason: 'continuation-image-required' as const }] } : {}) } })
    if (!queue.length) break
  }
  if (page.table && !parts.some(p => p.content.table)) {
    const h = header(page, chapterTitle, box(0.7, 0.5, 11.93, 6.37))
    const width = h.body.w / page.table.columns.length, measure = (v: string) => height(v, width - 0.24, 14, 21) + 0.15
    const head = Math.max(...page.table.columns.map(measure)), capacity = h.body.h - head
    if (capacity < 0.5) throw new Error(`REGULAR_TABLE_HEADER_OVERFLOW: ${page.id}`)
    const rowHeights = page.table.rows.map(row => Math.max(...row.map(measure)))
    const tableHeight = head + rowHeights.reduce((sum, n) => sum + n, 0)
    const last = parts.at(-1)!
    const lastBottom = Math.max(...last.layout.texts.map(t => t.box.y + t.box.h)) + 0.2
    if (last.layout.mode === 'text' && lastBottom + tableHeight <= 6.9) {
      parts[parts.length - 1] = { content: { ...last.content, table: page.table }, layout: { ...last.layout,
        table: { box: box(0.7, lastBottom, 11.93, tableHeight), columns: page.table.columns.map(v => regularWrap(v, width - 0.24, 14)), rows: page.table.rows.map(row => row.map(v => regularWrap(v, width - 0.24, 14))), rowHeights: [head, ...rowHeights] } } }
      return parts
    }
    let rows: string[][] = [], heights: number[] = [head], used = head
    const finish = () => {
      if (!rows.length) return
      parts.push({ content: { ...empty(page), table: { columns: page.table!.columns, rows } }, layout: { mode: 'table', chapterTitle, texts: h.texts, media: [], table: { box: box(h.body.x, h.body.y, h.body.w, used), columns: page.table!.columns.map(v => regularWrap(v, width - 0.24, 14)), rows: rows.map(row => row.map(v => regularWrap(v, width - 0.24, 14))), rowHeights: heights } } })
      rows = []; heights = [head]; used = head
    }
    for (const source of page.table.rows) {
      let rest = [...source]
      do {
        const pairs = rest.map(v => splitToFit(v, capacity, measure)), row = pairs.map(p => p[0]); rest = pairs.map(p => p[1])
        if (rest.some(Boolean) && !row.some(Boolean)) throw new Error(`REGULAR_TABLE_CELL_OVERFLOW: ${page.id}`)
        const rh = Math.max(...row.map(measure))
        if (used + rh > h.body.h) finish()
        rows.push(row); heights.push(rh); used += rh
      } while (rest.some(Boolean))
    }
    finish()
  }
  return parts
}

function stageStory(page: PlanningManuscriptPage, chapter: string, assets: readonly ClientVisualAsset[]): RegularPagePart[] | undefined {
  const graph = page.visual.diagram
  if (!graph?.nodes.length) return undefined
  const presentation = photoStagePresentation(graph), originals = new Set<string>(), hashes = new Set<string>()
  const assigned = presentation.nodeIds.map((nodeId, index) => {
    const node = graph.nodes.find(node => node.id === nodeId)!
    const candidates = assets.filter(asset => asset.stageNodeIds?.includes(nodeId))
    const asset = candidates.find(asset => !originals.has(regularOriginalImageId(asset)) && !hashes.has(asset.sha256))
    if (asset) { originals.add(regularOriginalImageId(asset)); hashes.add(asset.sha256) }
    return { node, asset, label: presentation.kind === 'sequence' ? `${String(index + 1).padStart(2, '0')} ${node.label}` : node.label,
      gap: asset ? undefined : { pageId: page.id, nodeId, reason: candidates.length ? 'duplicate-original' as const : 'missing-stage-image' as const } }
  })
  const queue = [...page.body], parts: RegularPagePart[] = [], pending = [...assigned]
  while (pending.length) {
    const h = header(page, chapter, box(0.68, 0.35, 11.97, 6.7), true)
    const body = parts.length ? [] : consume(queue, box(h.body.x, h.body.y, h.body.w, 0.9), h.texts)
    const headerBottom = Math.max(...h.texts.map(t => t.box.y + t.box.h))
    // Three readable scenes are preferable to twelve cropped slivers. A long
    // caption or panoramic source reduces this further before any image is cropped.
    let count = Math.min(3, pending.length)
    if (pending.length === 4) count = 2
    const gap = 0.28, side = 0.3
    const available = 7.5 - headerBottom - 0.55
    const fits = (count: number) => {
      const width = (REGULAR_CANVAS.width - 2 * side - gap * (count - 1)) / count
      return pending.slice(0, count).every(item => {
        const caption = Math.max(0.45, height(item.label, width - 0.24, 14, 20) + 0.14)
        const ratio = item.asset && validDimensions(item.asset) ? item.asset.width / item.asset.height : 16 / 9
        return Math.min(available - caption, width / ratio) >= 1.5 && caption <= available - 1.5
      })
    }
    while (count > 1 && !fits(count)) count--
    if (!fits(count)) throw new Error(`REGULAR_STAGE_SPACE_REQUIRED: ${page.id}/${pending[0]!.node.id}`)
    const group = pending.splice(0, count), ids = new Set(group.map(item => item.node.id))
    const localEdges = presentation.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to))
    const references = presentation.edges.filter(edge => ids.has(edge.from) && !ids.has(edge.to))
    const localGraph = { nodes: group.map(item => item.node), edges: localEdges }
    const reserve = localEdges.length ? photoStageTopReserve(localGraph, REGULAR_CANVAS.width) : 0.12
    const width = (REGULAR_CANVAS.width - 2 * side - gap * (count - 1)) / count
    const referenceCopy = references.map(edge => `${graph.nodes.find(n => n.id === edge.from)!.label} → ${graph.nodes.find(n => n.id === edge.to)!.label}${edge.label ? `（${edge.label}）` : ''}`).join('；')
    const referenceHeight = referenceCopy ? height(referenceCopy, 11.97, 12, 18) + 0.08 : 0
    const imageHeight = 7.5 - headerBottom - reserve - referenceHeight
    const nodes = new Map<string, Box>(), images: RegularMedia[] = []
    for (const [index, item] of group.entries()) {
      const captionH = Math.max(0.45, height(item.label, width - 0.24, 14, 20) + 0.14)
      const cell = box(side + index * (width + gap), headerBottom + reserve + referenceHeight + captionH, width, imageHeight - captionH)
      const bounds = item.asset ? compositionBox(item.asset, cell) : compositionBox({ width: 1600, height: 900 } as ClientVisualAsset, cell)
      // The caption may use its own cell's blank side space for a portrait;
      // its center still coincides with the visible image and never a neighbour.
      const caption = box(cell.x, bounds.y - captionH, cell.w, captionH)
      // Captions sit outside actual image pixels, including essential subjects.
      h.texts.push({ ...text('stage', item.label, caption, 14, 20), nodeId: item.node.id })
      nodes.set(item.node.id, box(caption.x, caption.y, caption.w, bounds.h + captionH))
      if (item.asset) images.push(media(item.asset, bounds, false, item.node.id))
    }
    const top = Math.min(...[...nodes.values()].map(bounds => bounds.y))
    if (referenceCopy) h.texts.push(text('body', referenceCopy, box(0.68, headerBottom, 11.97, referenceHeight), 12, 18))
    const connections = localEdges.length ? routePhotoStages(localGraph, nodes, REGULAR_CANVAS, top) : []
    parts.push({ content: { ...empty(page), body }, layout: { mode: 'row', chapterTitle: chapter, texts: h.texts, media: images,
      stageFlow: presentation.kind, connections, ...(references.length ? { relationReferences: references } : {}),
      ...(group.some(item => item.gap) ? { materialGaps: group.flatMap(item => item.gap ? [item.gap] : []) } : {}) } })
  }
  if (queue.length || page.table) {
    const continuation = { ...page, body: queue, visual: { ...page.visual, kind: 'concept' as const, diagram: undefined } }
    const unused = assets.filter(asset => !originals.has(regularOriginalImageId(asset)) && !hashes.has(asset.sha256))
    const continued = planVisualStory(continuation, chapter, unused, 0)
    parts.push(...continued.map(part => part.layout.media.length ? part : { ...part, layout: { ...part.layout,
      materialGaps: [{ pageId: page.id, reason: 'continuation-image-required' as const }] } }))
  }
  return parts
}

function tableStory(page: PlanningManuscriptPage, chapter: string, assets: readonly ClientVisualAsset[]): RegularPagePart[] {
  const table = page.table!, photos = uniqueImages(assets.filter(storyVisual))
    .sort((a, b) => Number(continuationImage(a, page.id)) - Number(continuationImage(b, page.id)))
  const queue = [...page.body], pendingRows = table.rows.map(row => [...row])
  const parts: RegularPagePart[] = []
  do {
    const currentPhoto = photos[parts.length]
    const imageX = currentPhoto && isPortraitPhoto(currentPhoto) ? 9.3 : 6.666666
    const width = currentPhoto ? imageX - 1 : 11.93
    const h = header(page, chapter, box(0.65, 0.4, width, 6.65), true)
    const shortLabels = table.columns.length > 2 && table.rows.every(row => row[0]!.length <= 12)
    const firstWidth = shortLabels ? Math.min(1.65, width / table.columns.length) : width / table.columns.length
    const widths = table.columns.map((_, i) => i === 0 ? firstWidth : (width - firstWidth) / (table.columns.length - 1 || 1))
    const rowHeight = (row: readonly string[]) => Math.max(...row.map((value, i) => height(value, widths[i]! - 0.24, 14, 21) + 0.15))
    const head = rowHeight(table.columns), fullHeight = 6.95 - h.body.y
    if (pendingRows.length && fullHeight < head + 0.5) throw new Error(`REGULAR_TABLE_HEADER_OVERFLOW: ${page.id}`)
    const texts = [...h.texts]
    // Reserve a readable first table row while flowing all independent prose.
    const reserve = pendingRows.length ? head + Math.min(rowHeight(pendingRows[0]!), Math.max(0.5, fullHeight * 0.38)) + 0.18 : 0
    const body = consume(queue, box(0.65, h.body.y, width, Math.max(0, fullHeight - reserve)), texts)
    const top = body.length ? Math.max(...texts.map(t => t.box.y + t.box.h)) + 0.18 : h.body.y
    const rows: string[][] = [], heights = [head]
    let used = head
    while (pendingRows.length) {
      const room = 6.95 - top - used, source = pendingRows[0]!, rh = rowHeight(source)
      if (rh <= room) { rows.push(source); heights.push(rh); used += rh; pendingRows.shift(); continue }
      // A normal row stays intact. Only an oversized row is split, with every
      // character retained and its column headings repeated on continuation.
      if (rows.length || (rh <= fullHeight - head && body.length)) break
      const pairs = source.map((v, i) => splitToFit(v, room, value => height(value, widths[i]! - 0.24, 14, 21) + 0.15))
      const row = pairs.map(p => p[0]), rest = pairs.map(p => p[1])
      if (!row.some(Boolean)) break
      rows.push(row); heights.push(rowHeight(row)); used += rowHeight(row)
      if (rest.some(Boolean)) pendingRows[0] = rest; else pendingRows.shift()
      break
    }
    if (!body.length && !rows.length && (queue.length || pendingRows.length)) throw new Error(`REGULAR_TABLE_CELL_OVERFLOW: ${page.id}`)
    parts.push({ content: { ...empty(page), body, ...(rows.length ? { table: { columns: table.columns, rows } } : {}) },
      layout: { mode: currentPhoto ? 'right' : 'table', chapterTitle: chapter, texts,
        media: currentPhoto ? [media(currentPhoto, box(imageX, 0, REGULAR_CANVAS.width - imageX, 7.5))] : [],
        ...(!currentPhoto ? { materialGaps: [{ pageId: page.id, reason: 'continuation-image-required' as const }] } : {}),
        ...(rows.length ? { table: { box: box(0.65, top, width, used), columns: table.columns.map((v, i) => regularWrap(v, widths[i]! - 0.24, 14)),
          rows: rows.map(row => row.map((v, i) => regularWrap(v, widths[i]! - 0.24, 14))), rowHeights: heights, columnWidths: widths } } : {}),
      } })
  } while (queue.length || pendingRows.length)
  return parts
}

/** Client summaries share the same physical page with their imagery. */
function planVisualStory(page: PlanningManuscriptPage, chapter: string, assets: readonly ClientVisualAsset[], ordinal: number): RegularPagePart[] {
  const stages = stageStory(page, chapter, assets)
  if (stages) return stages
  if (page.table) return tableStory(page, chapter, assets)
  const photos = uniqueImages(assets.filter(storyVisual))
  const pendingPhotos = photos.filter(asset => !continuationImage(asset, page.id)), continuationPhotos = photos.filter(asset => continuationImage(asset, page.id))
  if (!photos.length) return planRegularManuscriptPage({ ...page, editorialSummary: undefined, product: undefined }, chapter, assets, ordinal)
  const queue = [...page.body], parts: RegularPagePart[] = []
  do {
    if (!pendingPhotos.length && !continuationPhotos.length) {
      const continuation = planRegularManuscriptPage({ ...page, editorialSummary: undefined, product: undefined, body: queue }, chapter, [], ordinal)
      parts.push(...continuation.map(part => ({ ...part, layout: { ...part.layout,
        materialGaps: [{ pageId: page.id, reason: 'continuation-image-required' as const }] } })))
      break
    }
    const photos = pendingPhotos.length ? pendingPhotos.splice(0, pendingPhotos.length === 4 ? 2 : 3) : continuationPhotos.splice(0, 1)
    let portrait = photos.length === 1 && page.visual.kind !== 'diagram' && isPortraitPhoto(photos[0]!)
    let mode: RegularLayout['mode'] = photos.length > 1 ? ordinal % 2 ? 'column' : 'row' : (['left', 'right', 'top', 'bottom', 'background'] as const)[ordinal % 5]!
    if (photos.length === 1 && analyticalImage(photos[0]!)) mode = ordinal % 2 ? 'right' : 'left'
    if (portrait && ['top', 'bottom', 'background'].includes(mode)) mode = ordinal % 2 ? 'right' : 'left'
    if (['top', 'bottom', 'row'].includes(mode) && (queue.join('').length > 95 || page.claim.length > 65)) mode = photos.length > 1 ? 'column' : ordinal % 2 ? 'left' : 'right'
    if (['top', 'bottom', 'row'].includes(mode)) {
      const available = (mode === 'bottom' ? 3.15 : 2.9) - 0.4 - height(page.title, 11.97, 24, 31) - 0.17 - height(page.claim, 11.97, 16, 24) - 0.24
      const required = queue.reduce((sum, value) => sum + height(value, 11.97, 15, 23) + 0.13, -0.13)
      // Choose the orientation from measured copy, not its character count.
      // Several short paragraphs must not create an almost empty extra page.
      if (required > available) mode = photos.length > 1 ? 'column' : ordinal % 2 ? 'left' : 'right'
    }
    while (photos.length > 1) {
      const bounds = mode === 'column' ? box(0, 0, 6.666666, 7.5) : box(0, 0, REGULAR_CANVAS.width, 3.75)
      if (visibleArrayArea(arrayBoxes(photos, bounds, mode === 'column', 0.08)) >= REGULAR_CANVAS.width * REGULAR_CANVAS.height * 0.2) break
      pendingPhotos.unshift(photos.pop()!)
      if (photos.length === 1) { portrait = isPortraitPhoto(photos[0]!); mode = ordinal % 2 ? 'right' : 'left' }
    }
    // A complete panorama can become a decorative strip in a side column.
    // Keep its full width and let prose paginate at the existing readable size.
    const wide = photos.length === 1 && needsWideComposition(photos[0]!)
    if (wide) mode = ordinal % 2 ? 'top' : 'bottom'
    let bounds = box(7.16, 0.5, 5.5, 6.45), imageBox = box(0, 0, 6.666666, 7.5)
    if (mode === 'right') { bounds = box(0.68, 0.5, 5.45, 6.45); imageBox = box(6.666666, 0, 6.666666, 7.5) }
    if (mode === 'top' || mode === 'row') { bounds = box(0.68, 4.08, 11.97, 2.9); imageBox = box(0, 0, 13.333333, 3.75) }
    if (mode === 'bottom') { bounds = box(0.68, 0.3, 11.97, 3.15); imageBox = box(0, 3.75, 13.333333, 3.75) }
    if (mode === 'background') { bounds = box(0.72, 0.65, 7.5, 6.2); imageBox = box(0, 0, 13.333333, 7.5) }
    if (portrait) ({ bounds, imageBounds: imageBox } = portraitColumnBounds(photos[0]!, bounds, imageBox))
    const h = header(page, chapter, bounds, true, mode === 'background')
    const body = consume(queue, h.body, h.texts)
    if (queue.length && !body.length) throw new Error(`REGULAR_STORY_OVERFLOW: ${page.id}`)
    if (mode === 'background') for (let i = 0; i < h.texts.length; i++) h.texts[i] = { ...h.texts[i]!, dark: true }
    const vertical = mode === 'column', gap = 0.08
    const mediaItems = ['row', 'column'].includes(mode) ? photos.map((asset, i) => {
      const cell = ((vertical ? imageBox.h : imageBox.w) - gap * (photos.length - 1)) / photos.length
      return media(asset, compositionBox(asset, vertical ? box(imageBox.x, imageBox.y + i * (cell + gap), imageBox.w, cell) : box(imageBox.x + i * (cell + gap), imageBox.y, cell, imageBox.h)))
    }) : [media(photos[0]!, imageBox, portrait || wide)]
    parts.push({ content: { ...empty(page), body }, layout: { mode, chapterTitle: chapter, texts: h.texts, media: mediaItems,
      ...(mode === 'background' ? { shade: box(0, 0, 8.85, 7.5) } : {}) } })
    ordinal++
  } while (queue.length || pendingPhotos.length)
  return parts
}
