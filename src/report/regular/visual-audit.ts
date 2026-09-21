import type { ClientPagePlan, ClientReport, ClientVisualAsset } from '../client-types.ts'
import { regularImageGeometry, regularInspectionProblem, regularOriginalImageId, type Box } from './layout.ts'
import { MAX_ORIGINAL_IMAGE_USES, MIN_RETAINED_IMAGE_AREA } from '../../visual/image-policy.ts'

export const MAX_TEXT_PAGE_RATIO = 0.15
export const MIN_PHOTO_AREA_RATIO = 0.2
export interface RegularVisualAuditOptions { readonly requireInspectedImages?: boolean }
export function isReportPhotograph(asset: ClientVisualAsset): boolean {
  return ['project-source', 'ai-concept'].includes(asset.sourceKind)
    && !['diagram', 'chart', 'map'].includes(asset.role) && asset.width >= 256 && asset.height >= 256
}
function isSubstantiveVisual(asset: ClientVisualAsset): boolean {
  const analytical = asset.sourceKind === 'project-source' && asset.provenance !== undefined
    && ((asset.role === 'map' && asset.analysisKind !== undefined && asset.cartography !== undefined)
      || (asset.role === 'chart' && asset.chartContract !== undefined)
      || ['plan', 'map', 'section', 'diagram', 'composite'].includes(asset.imageQuality?.inspection?.contentKind ?? ''))
  return isReportPhotograph(asset) || (analytical && asset.width >= 256 && asset.height >= 256)
}
function unionArea(rectangles: readonly Box[]): number {
  const xs = [...new Set(rectangles.flatMap(b => [b.x, b.x + b.w]))].sort((a, b) => a - b)
  let area = 0
  for (let i = 1; i < xs.length; i++) {
    const left = xs[i - 1]!, right = xs[i]!, ys = rectangles.filter(b => b.x < right && b.x + b.w > left).map(b => [b.y, b.y + b.h] as const).sort((a, b) => a[0] - b[0])
    let end = -Infinity, total = 0
    for (const [low, high] of ys) { total += Math.max(0, high - Math.max(low, end)); end = Math.max(end, high) }
    area += (right - left) * total
  }
  return area
}
/** A conflicting declared ID cannot split identical source bytes into new families. */
export function regularImageFamilies(assets: readonly ClientVisualAsset[]): ReadonlyMap<string, string> {
  const parents = new Map<string, string>()
  const find = (id: string): string => {
    const parent = parents.get(id)
    if (!parent) { parents.set(id, id); return id }
    if (parent === id) return id
    const root = find(parent); parents.set(id, root); return root
  }
  for (const asset of assets) {
    const file = `sha:${asset.sha256}`, original = regularOriginalImageId(asset)
    if (original !== asset.sha256) parents.set(find(file), find(`original:${original}`))
    else find(file)
  }
  const names = new Map<string, string>()
  for (const asset of assets) {
    const root = find(`sha:${asset.sha256}`), original = regularOriginalImageId(asset)
    if (!names.has(root) || original !== asset.sha256) names.set(root, names.get(root)?.startsWith('original:') ? names.get(root)! : original !== asset.sha256 ? `original:${original}` : asset.sha256)
  }
  return new Map(assets.map(asset => [asset.assetId, names.get(find(`sha:${asset.sha256}`))!.replace(/^original:/u, '')]))
}
export function auditRegularVisuals(plan: ClientPagePlan, report: ClientReport, options: RegularVisualAuditOptions = {}) {
  const totalArea = (plan.canvas?.width ?? 13.333333) * (plan.canvas?.height ?? 7.5), families = regularImageFamilies(report.assets)
  const originalImageUses: { originalId: string; count: number; pageIds: string[]; assetIds: string[] }[] = []
  const samePageDuplicates: { pageId: string; originalId: string; count: number }[] = []
  const unreviewedImages: { pageId: string; assetId: string; reason: string }[] = []
  const placementIssues: { pageId: string; assetId: string; reason: string }[] = []
  const placements: { pageId: string; assetId: string; originalId: string; nodeId?: string; visibleBox: Box; fit: 'cover' | 'contain'; retainedArea: number; subjectsRetained: boolean; reviewed: boolean; countsTowardCoverage: boolean }[] = []
  const materialGaps = plan.pages.flatMap(page => (page.regularLayout?.materialGaps ?? []).map(gap => ({ physicalPageId: page.pageId, ...gap })))
  const pages = plan.pages.map(page => {
    const pageUses = new Map<string, number>()
    const photos = (page.regularLayout?.media ?? []).flatMap(media => {
      const asset = report.assets.find(asset => asset.assetId === media.assetId)
      if (!asset) { placementIssues.push({ pageId: page.pageId, assetId: media.assetId, reason: 'missing-asset' }); return [] }
      const originalId = families.get(asset.assetId)!, geometry = regularImageGeometry(asset, media)
      pageUses.set(originalId, (pageUses.get(originalId) ?? 0) + 1)
      let use = originalImageUses.find(use => use.originalId === originalId)
      if (!use) { use = { originalId, count: 0, pageIds: [], assetIds: [] }; originalImageUses.push(use) }
      use.count++
      if (!use.pageIds.includes(page.pageId)) use.pageIds.push(page.pageId)
      if (!use.assetIds.includes(asset.assetId)) use.assetIds.push(asset.assetId)
      let problem = regularInspectionProblem(asset, media)
      const requirement = asset.imageQuality?.requirement
      const sourcePage = page.pagination?.sourcePageId ?? page.planningContent?.id ?? page.pageId
      if (!problem && (requirement?.pageId !== sourcePage || requirement.nodeId !== media.nodeId)) problem = 'wrong-usage'
      if (problem && isSubstantiveVisual(asset)) unreviewedImages.push({ pageId: page.pageId, assetId: asset.assetId, reason: problem })
      let issue: string | undefined
      if (!geometry.validDimensions) issue = 'invalid-dimensions'
      else if (geometry.analytical && geometry.retainedArea < 1 - 1e-6) issue = 'analytical-image-cropped'
      else if (geometry.retainedArea + 1e-6 < MIN_RETAINED_IMAGE_AREA) issue = 'retained-area-below-80-percent'
      else if (media.fit === 'cover' && !geometry.safeSubjects) issue = 'unknown-or-clipped-subjects'
      if (issue) placementIssues.push({ pageId: page.pageId, assetId: asset.assetId, reason: issue })
      const counts = isSubstantiveVisual(asset) && !issue && (!options.requireInspectedImages || !problem)
      placements.push({ pageId: page.pageId, assetId: asset.assetId, originalId, ...(media.nodeId ? { nodeId: media.nodeId } : {}),
        visibleBox: geometry.visible, fit: media.fit, retainedArea: geometry.retainedArea, subjectsRetained: geometry.safeSubjects,
        reviewed: !problem, countsTowardCoverage: counts })
      return counts ? [geometry.visible] : []
    })
    for (const [originalId, count] of pageUses) if (count > 1) samePageDuplicates.push({ pageId: page.pageId, originalId, count })
    const ratio = unionArea(photos) / totalArea
    return { pageId: page.pageId, photoAreaRatio: ratio, textOnly: ratio < MIN_PHOTO_AREA_RATIO }
  })
  const textOnly = pages.filter(page => page.textOnly).length
  const missingStages: { pageId: string; nodeId: string }[] = []
  for (const chapter of report.chapters) for (const block of chapter.blocks) {
    if (block.type !== 'planning-page' || !block.page.visual.diagram) continue
    if (block.page.task && ['regional-context', 'accessibility', 'audience-catchment', 'competitor-distribution', 'site-analysis'].includes(block.page.task.kind)) continue
    for (const node of block.page.visual.diagram.nodes) {
      // Node IDs are local to the authored page, including its physical continuations.
      const shown = plan.pages.filter(page => page.chapterId === chapter.id
        && (page.pagination?.sourcePageId ?? page.planningContent?.id) === block.page.id).some(page => placements.some(placement => placement.pageId === page.pageId
          && placement.nodeId === node.id && placement.visibleBox.w * placement.visibleBox.h >= 0.6 && placement.countsTowardCoverage
          && report.assets.some(asset => asset.assetId === placement.assetId && isReportPhotograph(asset) && asset.stageNodeIds?.includes(node.id))))
      if (!shown) missingStages.push({ pageId: block.page.id, nodeId: node.id })
    }
  }
  return { totalPages: pages.length, textOnlyPages: textOnly, textOnlyRatio: pages.length ? textOnly / pages.length : 1, pages, missingStages,
    originalImageUses, repeatedOriginals: originalImageUses.filter(use => use.count > MAX_ORIGINAL_IMAGE_USES), samePageDuplicates,
    placements, placementIssues, unreviewedImages, materialGaps }
}
export function assertRegularVisuals(plan: ClientPagePlan, report: ClientReport, options: RegularVisualAuditOptions = {}): void {
  const audit = auditRegularVisuals(plan, report, options)
  if (options.requireInspectedImages && audit.unreviewedImages.length) throw new Error(`REPORT_IMAGE_INSPECTION_REQUIRED: ${audit.unreviewedImages.map(item => `${item.pageId}/${item.assetId}: ${item.reason}`).join('，')}`)
  if (audit.repeatedOriginals.length) throw new Error(`REPORT_IMAGE_ORIGINAL_REUSE: ${audit.repeatedOriginals.map(use => `${use.originalId} (${use.count})`).join('，')}`)
  if (audit.samePageDuplicates.length) throw new Error(`REPORT_IMAGE_SAME_PAGE_DUPLICATE: ${audit.samePageDuplicates.map(use => `${use.pageId}/${use.originalId}`).join('，')}`)
  if (audit.textOnlyRatio > MAX_TEXT_PAGE_RATIO) throw new Error(`REPORT_TEXT_PAGE_RATIO: 无实质配图的文字/表格页 ${audit.textOnlyPages}/${audit.totalPages}，超过15%。`)
  if (audit.missingStages.length) throw new Error(`REPORT_STAGE_IMAGES_MISSING: ${audit.missingStages.map(m => `${m.pageId}/${m.nodeId}`).join('，')}`)
  if (audit.placementIssues.length) throw new Error(`REPORT_IMAGE_PLACEMENT_INVALID: ${audit.placementIssues.map(issue => `${issue.pageId}/${issue.assetId}: ${issue.reason}`).join('，')}`)
}
