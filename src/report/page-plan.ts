import type {
  ClientChapter,
  ClientContentBlock,
  ClientMedium,
  ClientPage,
  ClientPageKind,
  ClientPagePlan,
  ClientPolicyViolation,
  ClientReport,
} from './client-types.ts'

const LAYOUT_CONTRACT = Object.freeze({
  safeMarginRatio: 0.06,
  minimumTitle: 24,
  minimumBody: 14,
  minimumCaption: 10,
})

function coverPage(report: ClientReport): ClientPage {
  return {
    pageId: 'cover',
    kind: 'cover',
    layoutVariant: 'full-bleed',
    chapterId: 'opening',
    headline: report.identity.reportTitle,
    primaryFocus: { type: 'claim', statement: report.proposition.projectDefinition },
    blockIndexes: [],
    assetIds: report.assets.filter(asset => asset.role === 'hero').map(asset => asset.assetId),
    evidenceIds: [],
  }
}

function openingPage(
  id: string,
  headline: string,
  statement: string,
  layoutVariant: ClientPage['layoutVariant'],
): ClientPage {
  return {
    pageId: id,
    kind: 'opening-claim',
    layoutVariant,
    chapterId: 'opening',
    headline,
    primaryFocus: { type: 'claim', statement },
    blockIndexes: [],
    assetIds: [],
    evidenceIds: [],
  }
}

function chapterDivider(chapter: ClientChapter): ClientPage {
  return {
    pageId: chapter.id + '-divider',
    kind: 'chapter-divider',
    layoutVariant: 'full-bleed',
    chapterId: chapter.id,
    headline: chapter.headline,
    primaryFocus: { type: 'claim', statement: chapter.claim },
    blockIndexes: [],
    assetIds: [],
    evidenceIds: [],
  }
}

function evidenceIds(block: ClientContentBlock): readonly string[] {
  if (block.type === 'decision') return block.rationaleEvidenceIds
  if (block.type === 'product' || block.type === 'scene') return []
  return block.evidenceIds
}

function assetIds(block: ClientContentBlock): readonly string[] {
  if (block.type === 'evidence' || block.type === 'comparison' || block.type === 'product' || block.type === 'scene') {
    return block.assetIds
  }
  if (block.type === 'map') return [block.assetId]
  return []
}

function kindFor(chapter: ClientChapter, block: ClientContentBlock): ClientPageKind {
  if (block.type === 'decision') return 'decision'
  if (block.type === 'product') return 'product'
  if (block.type === 'scene') return 'scene'
  if (block.type === 'timeline' || block.type === 'investment') return 'implementation'
  if (chapter.role === 'opportunity') return 'opportunity'
  if (chapter.role === 'positioning' || chapter.role === 'strategy') return 'positioning'
  if (chapter.role === 'product') return 'product'
  if (chapter.role === 'spatial') return 'scene'
  if (chapter.role === 'operation' || chapter.role === 'implementation') return 'implementation'
  return 'evidence'
}

function headlineFor(block: ClientContentBlock): string {
  if (block.type === 'narrative') return block.statement
  if (block.type === 'metric') return block.label + '：' + block.value + block.unit
  if (block.type === 'product') return '核心产品'
  if (block.type === 'map') return block.headline
  return block.headline
}

function focusFor(block: ClientContentBlock): ClientPage['primaryFocus'] {
  const assets = assetIds(block)
  if (assets.length > 0) return { type: 'asset', assetId: assets[0]! }
  if (block.type === 'product') return { type: 'product', productId: block.productId }
  if (block.type === 'scene' && block.productIds.length > 0) {
    return { type: 'product', productId: block.productIds[0]! }
  }
  if (block.type === 'decision') return { type: 'decision', asks: block.asks }
  if (block.type === 'narrative') return { type: 'claim', statement: block.statement }
  if (block.type === 'metric') return { type: 'claim', statement: block.label + '：' + block.value + block.unit }
  return { type: 'claim', statement: block.headline }
}

function variantFor(kind: ClientPageKind, index: number): ClientPage['layoutVariant'] {
  if (kind === 'scene') return index % 2 === 0 ? 'split' : 'full-bleed'
  if (kind === 'product' || kind === 'opportunity') return index % 2 === 0 ? 'split' : 'editorial'
  if (kind === 'implementation') return index % 2 === 0 ? 'timeline' : 'data'
  if (kind === 'decision') return (['summary', 'data', 'editorial'] as const)[index % 3]!
  if (kind === 'positioning') return index % 2 === 0 ? 'editorial' : 'split'
  return index % 2 === 0 ? 'data' : 'split'
}

function blockPage(
  chapter: ClientChapter,
  block: ClientContentBlock,
  blockIndex: number,
): ClientPage {
  const kind = kindFor(chapter, block)
  return {
    pageId: chapter.id + '-block-' + String(blockIndex + 1).padStart(2, '0'),
    kind,
    layoutVariant: variantFor(kind, blockIndex),
    chapterId: chapter.id,
    headline: headlineFor(block),
    primaryFocus: focusFor(block),
    blockIndexes: [blockIndex],
    assetIds: [...assetIds(block)],
    evidenceIds: [...evidenceIds(block)],
  }
}

function appendixPages(report: ClientReport): ClientPage[] {
  const variants: readonly ClientPage['layoutVariant'][] = ['editorial', 'data', 'split']
  return report.evidence.map((evidence, index) => ({
    pageId: 'appendix-' + String(index + 1).padStart(2, '0'),
    kind: 'appendix',
    layoutVariant: variants[index % variants.length]!,
    chapterId: 'appendix',
    headline: evidence.statement,
    primaryFocus: { type: 'claim', statement: evidence.sourceLabel + '｜' + evidence.locator },
    blockIndexes: [],
    assetIds: [],
    evidenceIds: [evidence.evidenceId],
  }))
}

function closingDecisionPage(report: ClientReport): ClientPage {
  const decision = report.chapters
    .flatMap(chapter => chapter.blocks)
    .find((block): block is Extract<ClientContentBlock, { type: 'decision' }> => block.type === 'decision')
  const asks = decision?.asks ?? ['确认项目定位与首期实施边界']
  return {
    pageId: 'closing-decision',
    kind: 'decision',
    layoutVariant: 'summary',
    chapterId: report.chapters.at(-1)?.id ?? 'decision',
    headline: '把共同判断转化为下一步行动',
    primaryFocus: { type: 'decision', asks },
    blockIndexes: [],
    assetIds: [],
    evidenceIds: [...(decision?.rationaleEvidenceIds ?? [])],
  }
}

export function planClientPages(report: ClientReport, medium: ClientMedium): ClientPagePlan {
  const pages: ClientPage[] = [
    coverPage(report),
    openingPage('opening-project', '这是一个什么项目', report.proposition.projectDefinition, 'editorial'),
    openingPage('opening-urgency', '为什么现在必须行动', report.proposition.urgency, 'split'),
    openingPage('opening-value', '项目将创造什么价值', report.proposition.coreValue, 'full-bleed'),
  ]

  for (const chapter of report.chapters) {
    pages.push(chapterDivider(chapter))
    chapter.blocks.forEach((block, index) => pages.push(blockPage(chapter, block, index)))
  }

  if (medium === 'pdf') pages.push(...appendixPages(report))
  pages.push(closingDecisionPage(report))
  return { medium, pages, layoutContract: LAYOUT_CONTRACT }
}

function violation(code: string, path: string, message: string): ClientPolicyViolation {
  return { code, path, message }
}

export function validateClientPagePlan(plan: ClientPagePlan): ClientPolicyViolation[] {
  const violations: ClientPolicyViolation[] = []
  if (plan.medium === 'pptx' && (plan.pages.length < 32 || plan.pages.length > 48)) {
    violations.push(violation('PAGE_COUNT_OUT_OF_RANGE', 'pages', 'PPTX requires 32-48 pages'))
  }
  if (plan.medium === 'pdf' && (plan.pages.length < 48 || plan.pages.length > 72)) {
    violations.push(violation('PAGE_COUNT_OUT_OF_RANGE', 'pages', 'PDF requires 48-72 pages'))
  }
  if (
    plan.layoutContract.safeMarginRatio < 0.05
    || plan.layoutContract.safeMarginRatio > 0.07
    || plan.layoutContract.minimumTitle < 24
    || plan.layoutContract.minimumBody < 14
    || plan.layoutContract.minimumCaption < 10
  ) {
    violations.push(violation('LAYOUT_CONTRACT_INVALID', 'layoutContract', 'layout contract is below the client minimum'))
  }
  for (let index = 2; index < plan.pages.length; index += 1) {
    const run = plan.pages.slice(index - 2, index + 1)
    if (run.every(page => page.layoutVariant === run[0]?.layoutVariant)) {
      violations.push(violation(
        'LAYOUT_REPETITION',
        'pages[' + String(index - 2) + '..' + String(index) + ']',
        'the same layout variant appears three times in a row',
      ))
    }
  }
  for (let index = 6; index < plan.pages.length; index += 1) {
    const run = plan.pages.slice(index - 2, index + 1)
    if (run[0]?.kind !== 'appendix' && run.every(page => page.kind === run[0]?.kind)) {
      violations.push(violation(
        'PAGE_KIND_REPETITION',
        'pages[' + String(index - 2) + '..' + String(index) + ']',
        'the same page kind appears three times in a row',
      ))
    }
  }
  return violations
}

export function assertClientPagePlan(plan: ClientPagePlan): void {
  const violations = validateClientPagePlan(plan)
  if (violations.length > 0) {
    throw new Error(violations.map(row => row.code + ' ' + row.path + ': ' + row.message).join('\n'))
  }
}
