import type { ClientVisualAsset } from '../client-types.ts'
import type { PlanningManuscriptPage } from '../manuscript/types.ts'
import { wrapClientText } from '../client-typography.ts'
import { imageBriefHash, imagePlacementHash, MIN_RETAINED_IMAGE_AREA, REPORT_IMAGE_POLICY_VERSION } from '../../visual/image-policy.ts'
import { planStableRegularContent } from './pagination.ts'
import { photoStageTopReserve, routePhotoStages } from './stage-connections.ts'

export const REGULAR_CANVAS = { width: 13.333333, height: 7.5, unit: 'in' as const }
export const REGULAR_LAYOUT_VERSION = 'regular-2026-09-21.6-stable'
export interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface RegularText { readonly role: 'eyebrow' | 'title' | 'claim' | 'body' | 'stage'; readonly text: string; readonly box: Box; readonly size: number; readonly leading: number; readonly dark?: boolean; readonly nodeId?: string }
export interface RegularMedia { readonly assetId: string; readonly box: Box; readonly fit: 'cover' | 'contain'; readonly nodeId?: string; readonly usageId?: string }
export interface RegularImageSlot {
  readonly usageId: string
  readonly box: Box
  readonly targetAspectRatio: number
  readonly nodeId?: string
  readonly purpose: 'scene' | 'analysis' | 'stage'
  readonly fit: 'cover' | 'contain'
}
export interface RegularMaterialGap { readonly pageId: string; readonly nodeId?: string; readonly usageId?: string; readonly reason: 'missing-stage-image' | 'duplicate-original' | 'continuation-image-required' | 'incompatible-image-slot' }
export interface RegularLayout {
  readonly mode: 'cover' | 'background' | 'left' | 'right' | 'top' | 'bottom' | 'row' | 'column' | 'diagram' | 'text' | 'table'
  readonly chapterTitle: string
  readonly texts: readonly RegularText[]
  readonly media: readonly RegularMedia[]
  /** Fixed before acquisition; images may fill slots but may never add pages. */
  readonly imageSlots?: readonly RegularImageSlot[]
  readonly intentionalWhitespace?: 'divider'
  readonly shade?: Box
  readonly materialGaps?: readonly RegularMaterialGap[]
  readonly intentionalTextOnly?: 'financial-table'
  readonly stageFlow?: 'sequence' | 'parallel' | 'network'
  /** Relations whose endpoint is shown on another physical page. */
  readonly relationReferences?: readonly { readonly from: string; readonly to: string; readonly label?: string }[]
  readonly connections?: readonly { readonly from: string; readonly to: string; readonly path: string; readonly label?: string; readonly labelX: number; readonly labelY: number }[]
  readonly table?: { readonly box: Box; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[]; readonly rowHeights: readonly number[]; readonly columnWidths?: readonly number[] }
}
export interface RegularPagePart { readonly content: PlanningManuscriptPage; readonly layout: RegularLayout }

export const regularBox = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h })
const box = regularBox
const widthChars = (w: number, size: number) => Math.max(4, Math.floor(w * 72 / size) - 1)
export const regularWrap = (value: string, w: number, size: number) => wrapClientText(value, widthChars(w, size), Number.MAX_SAFE_INTEGER, 'REGULAR_REPORT_COPY')
export const regularTextHeight = (value: string, w: number, size: number, leading: number) => regularWrap(value, w, size).split('\n').length * leading / 72 + 0.05
const height = regularTextHeight
export function regularText(role: RegularText['role'], value: string, bounds: Box, size: number, leading: number, dark = false): RegularText {
  return { role, text: regularWrap(value, bounds.w, size), box: bounds, size, leading, ...(dark ? { dark } : {}) }
}
export function regularHeader(page: PlanningManuscriptPage, chapter: string, bounds: Box, compact = false, dark = false) {
  const texts: RegularText[] = [regularText('eyebrow', chapter, box(bounds.x, bounds.y, bounds.w, 0.25), 10, 13, dark)]
  let y = bounds.y + 0.4
  const size = compact ? 24 : 28, leading = compact ? 31 : 36
  const th = height(page.title, bounds.w, size, leading)
  texts.push(regularText('title', page.title, box(bounds.x, y, bounds.w, th), size, leading, dark)); y += th + 0.17
  const cs = compact ? 16 : 18, cl = compact ? 24 : 27, ch = height(page.claim, bounds.w, cs, cl)
  texts.push(regularText('claim', page.claim, box(bounds.x, y, bounds.w, ch), cs, cl, dark)); y += ch + 0.24
  if (y > bounds.y + bounds.h) throw new Error(`REGULAR_HEADER_OVERFLOW: ${page.id}`)
  return { texts, body: box(bounds.x, y, bounds.w, bounds.y + bounds.h - y) }
}
export const emptyRegularPage = (page: PlanningManuscriptPage): PlanningManuscriptPage => ({ ...page, body: [], product: undefined, table: undefined })
export function splitRegularText(value: string, capacity: number, measure: (v: string) => number): [string, string] {
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
export function consumeRegularText(queue: string[], area: Box, texts: RegularText[]) {
  const body: string[] = []; let y = area.y
  while (queue.length && area.y + area.h - y >= 0.38) {
    const fullHeight = height(queue[0]!, area.w, 15, 23)
    if (y > area.y && fullHeight <= area.h && fullHeight > area.y + area.h - y) break
    const [head, tail] = splitRegularText(queue[0]!, area.y + area.h - y, v => height(v, area.w, 15, 23))
    if (!head) break
    const h = height(head, area.w, 15, 23)
    body.push(head); texts.push(regularText('body', head, box(area.x, y, area.w, h), 15, 23)); y += h + 0.13
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
export function regularInspectionProblem(asset: ClientVisualAsset, placement: RegularMedia, allowFullOriginal = false): string | undefined {
  const inspection = asset.imageQuality?.inspection, brief = asset.imageQuality?.requirement
  if (!inspection) return 'missing-inspection'
  if (inspection.actualImageInput !== true) return 'missing-image-input'
  if (inspection.schemaVersion !== 'pre-design.image-inspection.v1' || !inspection.executionId?.trim()
    || !inspection.actualModel?.provider?.trim() || !inspection.actualModel?.model?.trim()) return 'missing-review-execution'
  if (inspection.imageSha256 !== asset.sha256) return 'stale-image'
  if (!brief || inspection.usageId !== brief.id || inspection.requirementHash !== imageBriefHash(brief)) return 'stale-requirement'
  if (inspection.placementHash !== imagePlacementHash(placement)
    && !(allowFullOriginal && inspection.placementHash === `${REPORT_IMAGE_POLICY_VERSION}:full-original`)) return 'stale-placement'
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
  // Integer raster normalization can move a nominal boundary by a fraction of
  // one original pixel. Larger subject loss remains an unsafe crop.
  const xTolerance = valid ? 1 / asset.width + Number.EPSILON : 0, yTolerance = valid ? 1 / asset.height + Number.EPSILON : 0
  const safeSubjects = placement.fit === 'contain' || essential.length > 0 && essential.every(b =>
    [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0 && b.x >= source.x - xTolerance && b.y >= source.y - yTolerance
    && b.x + b.width <= source.x + source.width + xTolerance && b.y + b.height <= source.y + source.height + yTolerance)
  return { visible, source, retainedArea: valid || placement.fit === 'contain' ? source.width * source.height : 0,
    safeSubjects, analytical: analyticalImage(asset), validDimensions: valid }
}
function media(asset: ClientVisualAsset, bounds: Box, preserveComposition = false, nodeId?: string): RegularMedia {
  const candidate: RegularMedia = { assetId: asset.assetId, box: bounds, fit: 'cover', ...(nodeId ? { nodeId } : {}) }
  const geometry = regularImageGeometry(asset, candidate)
  const fit = !preserveComposition && !geometry.analytical && geometry.validDimensions
    && geometry.retainedArea + 1e-6 >= MIN_RETAINED_IMAGE_AREA && geometry.safeSubjects && !regularInspectionProblem(asset, candidate, true) ? 'cover' : 'contain'
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

function fillsRequiredEdges(layout: RegularLayout, slot: RegularImageSlot, visible: Box): boolean {
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-5
  if (slot.purpose === 'analysis') return true
  if (['row', 'column'].includes(layout.mode)) return true
  if (['background', 'cover'].includes(layout.mode)) {
    return same(visible.x, slot.box.x) && same(visible.y, slot.box.y) && same(visible.w, slot.box.w) && same(visible.h, slot.box.h)
  }
  if (['left', 'right'].includes(layout.mode)) return same(visible.y, 0) && same(visible.h, REGULAR_CANVAS.height)
  if (['top', 'bottom'].includes(layout.mode)) return same(visible.x, 0) && same(visible.w, REGULAR_CANVAS.width)
  return true
}

/** Acquisition uses this exact geometry rule; final audit still requires the placement hash. */
export function regularSlotPlacement(layout: RegularLayout, slot: RegularImageSlot, asset: ClientVisualAsset): RegularMedia | undefined {
  if (slot.purpose !== 'analysis' && analyticalImage(asset)) return undefined
  const placement = { ...media(asset, slot.box, slot.purpose === 'analysis', slot.nodeId), usageId: slot.usageId }
  const geometry = regularImageGeometry(asset, placement)
  if (!geometry.validDimensions || !fillsRequiredEdges(layout, slot, geometry.visible)) return undefined
  return placement
}

export function canBindRegularImage(layout: RegularLayout, slot: RegularImageSlot, asset: ClientVisualAsset): boolean {
  return regularSlotPlacement(layout, slot, asset) !== undefined
}

function fitContinuousArray(layout: RegularLayout, images: readonly RegularMedia[], assets: readonly ClientVisualAsset[]): Pick<RegularLayout, 'media' | 'texts' | 'connections'> {
  if (!['row', 'column'].includes(layout.mode) || !images.length) return { media: images, texts: layout.texts, connections: layout.connections }
  const slots = layout.imageSlots ?? [], frames = slots.map(slot => slot.box)
  const allPresent = images.length === slots.length
  let fitted = [...images]
  if (allPresent) {
    const x = Math.min(...frames.map(frame => frame.x)), y = Math.min(...frames.map(frame => frame.y))
    const w = Math.max(...frames.map(frame => frame.x + frame.w)) - x, h = Math.max(...frames.map(frame => frame.y + frame.h)) - y
    const ratios = images.map(placement => { const asset = assets.find(asset => asset.assetId === placement.assetId)!; return asset.width / asset.height })
    const vertical = layout.mode === 'column'
    const shared = vertical ? Math.min(w, h / ratios.reduce((sum, ratio) => sum + 1 / ratio, 0)) : Math.min(h, w / ratios.reduce((sum, ratio) => sum + ratio, 0))
    let cursor = vertical ? y : x
    fitted = images.map((placement, index) => {
      const width = vertical ? shared : shared * ratios[index]!, height = vertical ? shared / ratios[index]! : shared
      const frame = box(vertical ? (x === 0 ? x : x + w - width) : cursor, vertical ? cursor : (y === 0 ? y : y + h - height), width, height)
      cursor += vertical ? height : width
      return { ...placement, box: frame, fit: 'contain' }
    })
  }
  const texts = layout.texts.map(item => {
    const placement = item.nodeId && fitted.find(image => image.nodeId === item.nodeId)
    if (!placement || item.role !== 'stage') return item
    const value = item.text.replace(/\n/gu, ''), captionHeight = Math.max(0.45, height(value, placement.box.w - 0.24, 14, 20) + 0.14)
    return { ...regularText('stage', value, box(placement.box.x, placement.box.y - captionHeight, placement.box.w, captionHeight), 14, 20), nodeId: item.nodeId }
  })
  let connections = layout.connections
  if (connections?.length) {
    const captions = texts.filter(item => item.role === 'stage' && item.nodeId)
    const graph = { nodes: captions.map((item, index) => ({ id: item.nodeId!, label: item.text, column: index, row: 0 })),
      edges: connections.map(({ from, to, label }) => ({ from, to, ...(label ? { label } : {}) })) }
    const nodes = new Map(captions.map(item => {
      const frame = fitted.find(image => image.nodeId === item.nodeId)?.box ?? slots.find(slot => slot.nodeId === item.nodeId)!.box
      return [item.nodeId!, box(item.box.x, item.box.y, item.box.w, frame.y + frame.h - item.box.y)]
    }))
    const top = Math.max(0, Math.min(...captions.map(item => item.box.y)) - photoStageTopReserve(graph, REGULAR_CANVAS.width))
    connections = routePhotoStages(graph, nodes, REGULAR_CANVAS, top)
  }
  return { media: fitted, texts, connections }
}

/** Bind only compatible images to a frozen plan. Failed candidates cannot reflow copy. */
export function bindRegularImages(parts: readonly RegularPagePart[], assets: readonly ClientVisualAsset[]): RegularPagePart[] {
  const usedAssets = new Set<string>()
  return parts.map(part => {
    const images: RegularMedia[] = [], gaps: RegularMaterialGap[] = [], originals = new Set<string>(), hashes = new Set<string>()
    for (const slot of part.layout.imageSlots ?? []) {
      const exact = assets.filter(asset => asset.imageQuality?.requirement?.id === slot.usageId)
      const candidates = exact.length ? exact : assets.filter(asset => !usedAssets.has(asset.assetId)
        && (slot.nodeId ? asset.stageNodeIds?.includes(slot.nodeId) : !asset.stageNodeIds?.length)
        && (!asset.imageQuality?.requirement || (asset.imageQuality.requirement.id === `${part.content.id}:scene` && slot.usageId === `${part.content.id}:main`)))
      let duplicate = false, incompatible = false, chosen: { asset: ClientVisualAsset; placement: RegularMedia } | undefined
      for (const asset of candidates) {
        if (originals.has(regularOriginalImageId(asset)) || hashes.has(asset.sha256)) { duplicate = true; continue }
        const placement = regularSlotPlacement(part.layout, slot, asset)
        if (!placement) { incompatible = true; continue }
        chosen = { asset, placement }; break
      }
      if (chosen) {
        images.push(chosen.placement); usedAssets.add(chosen.asset.assetId)
        originals.add(regularOriginalImageId(chosen.asset)); hashes.add(chosen.asset.sha256)
      } else {
        gaps.push({ pageId: part.content.id, ...(slot.nodeId ? { nodeId: slot.nodeId } : {}),
          ...(incompatible ? { usageId: slot.usageId } : {}),
          reason: duplicate ? 'duplicate-original' : incompatible ? 'incompatible-image-slot' : slot.nodeId ? 'missing-stage-image' : 'continuation-image-required' })
      }
    }
    return { ...part, layout: { ...part.layout, ...fitContinuousArray(part.layout, images, assets), ...(gaps.length ? { materialGaps: gaps } : {}) } }
  })
}

export function regularCover(title: string, claim: string, asset?: ClientVisualAsset): RegularLayout {
  const page = { id: 'cover', title: title.replace(/汇报文案$/u, '汇报'), claim, body: [] } as unknown as PlanningManuscriptPage
  const h = regularHeader(page, '前期策划 · 项目汇报', box(0.72, 3.4, 10.8, 3.3), false, true)
  const frame = box(0, 0, REGULAR_CANVAS.width, REGULAR_CANVAS.height)
  const layout: RegularLayout = { mode: 'cover', chapterTitle: '项目汇报', texts: h.texts, media: [],
    imageSlots: [{ usageId: 'cover:main', box: frame, targetAspectRatio: frame.w / frame.h, purpose: 'scene', fit: 'cover' }],
    shade: box(0, 2.7, REGULAR_CANVAS.width, 4.8) }
  return bindRegularImages([{ content: page, layout }], asset ? [asset] : [])[0]!.layout
}

/** The ordinal is retained for callers; page position no longer controls the template. */
export function planRegularManuscriptPage(page: PlanningManuscriptPage, chapterTitle: string, assets: readonly ClientVisualAsset[], _ordinal = 0): RegularPagePart[] {
  return bindRegularImages(planStableRegularContent(page, chapterTitle), assets)
}
