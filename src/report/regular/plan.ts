import type { ClientMedium, ClientPage, ClientPagePlan, ClientReport } from '../client-types.ts'
import { planRegularManuscriptPage, regularCover, REGULAR_CANVAS } from './layout.ts'
import { assertRegularVisuals } from './visual-audit.ts'

export function assertRegularPagePlan(plan: ClientPagePlan, report: ClientReport): void {
  const canvas = plan.canvas, ids = new Set<string>()
  if (!canvas || plan.pages.length === 0 || Math.abs(canvas.width / canvas.height - 16 / 9) > 0.00001) throw new Error('REGULAR_CANVAS_INVALID')
  for (const page of plan.pages) {
    const chapter = report.chapters.find(c => c.id === page.chapterId), layout = page.regularLayout
    if (!layout || ids.has(page.pageId) || (page.kind !== 'cover' && !chapter) || page.blockIndexes.some(index => !chapter?.blocks[index])) throw new Error('REGULAR_PAGE_REFERENCE_INVALID')
    ids.add(page.pageId)
    for (const { box } of [...layout.texts, ...layout.media, ...(layout.table ? [layout.table] : [])]) {
      if (box.x < 0 || box.y < 0 || box.w <= 0 || box.h <= 0 || box.x + box.w > canvas.width + 0.00001 || box.y + box.h > canvas.height + 0.00001) throw new Error('REGULAR_LAYOUT_OVERFLOW')
    }
    if (page.assetIds.some(id => !report.assets.some(a => a.assetId === id)) || JSON.stringify(page.assetIds) !== JSON.stringify(layout.media.map(a => a.assetId))) throw new Error('REGULAR_MEDIA_PLAN_MISMATCH')
    if (['row', 'column'].includes(layout.mode) && layout.media.length > 1) {
      const frames = layout.media.map(m => m.box)
      const edge = Math.min(...frames.map(b => b.x)) === 0 || Math.min(...frames.map(b => b.y)) === 0
        || Math.abs(Math.max(...frames.map(b => b.x + b.w)) - canvas.width) < 0.00001
        || Math.abs(Math.max(...frames.map(b => b.y + b.h)) - canvas.height) < 0.00001
      if (!edge) throw new Error('REGULAR_ARRAY_EDGE_REQUIRED: 图像阵列至少一边抵达页面边缘。')
    }
  }
  assertRegularVisuals(plan, report)
}

export function planRegularPages(report: ClientReport, medium: ClientMedium): ClientPagePlan {
    const coverAsset = report.assets.find(asset => asset.role === 'hero' && !asset.physicalPlacement) ?? report.assets.find(asset => asset.sourceKind === 'ai-concept' && !asset.physicalPlacement) ?? report.assets[0]
    const pages: ClientPage[] = [{ pageId: 'cover', kind: 'cover', layoutVariant: 'full-bleed', chapterId: 'opening',
      headline: report.identity.reportTitle, primaryFocus: { type: 'claim', statement: report.proposition.coreValue },
      blockIndexes: [], assetIds: coverAsset ? [coverAsset.assetId] : [], evidenceIds: [],
      regularLayout: regularCover(report.identity.reportTitle, report.proposition.coreValue, coverAsset) }]
    let ordinal = 0
    for (const chapter of report.chapters) chapter.blocks.forEach((block, index) => {
      if (block.type !== 'planning-page') throw new Error('REGULAR_PLANNING_BLOCK_REQUIRED')
      const assets = report.assets.filter(asset => asset.chapterId === chapter.id && !asset.physicalPlacement)
      const parts = planRegularManuscriptPage(block.page, block.chapterTitle, assets, ordinal++)
      parts.forEach((part, partIndex) => pages.push({ pageId: `${chapter.id}-divider${partIndex ? `-part${partIndex + 1}` : ''}`,
        kind: 'evidence', layoutVariant: part.layout.mode === 'background' ? 'full-bleed' : 'editorial', chapterId: chapter.id,
        headline: part.content.title, primaryFocus: { type: 'claim', statement: part.content.claim },
        planningContent: part.content, regularLayout: part.layout,
        pagination: { sourcePageId: block.page.id, partIndex, partCount: parts.length },
        blockIndexes: [index], assetIds: part.layout.media.map(a => a.assetId), evidenceIds: [],
      }))
    })
    const placed = pages.map(page => {
      const overrides = report.assets.filter(asset => asset.physicalPlacement?.pageId === page.pageId)
      if (!overrides.length || !page.regularLayout) return page
      const media = page.regularLayout.media.map((placement, index) => {
        const asset = overrides.find(a => a.physicalPlacement!.mediaIndex === index)
        return asset ? { ...placement, assetId: asset.assetId } : placement
      })
      return { ...page, assetIds: media.map(m => m.assetId), regularLayout: { ...page.regularLayout, media } }
    })
    return { medium, canvas: REGULAR_CANVAS, pages: placed, layoutContract: { safeMarginRatio: 0.05, minimumTitle: 24, minimumBody: 14, minimumCaption: 10 } }
}
