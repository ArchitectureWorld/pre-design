import type {
  ClientAssetLayout,
  ClientAnalyticalVisual,
  ClientChapter,
  ClientContentBlock,
  ClientMedium,
  ClientPage,
  ClientPageKind,
  ClientPagePlan,
  ClientPolicyViolation,
  ClientReport,
  ClientVisualRole,
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
  analyticalVisual?: ClientAnalyticalVisual,
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
    ...(analyticalVisual === undefined ? {} : { analyticalVisual }),
  }
}

function splitPlanningList(value: string): string[] {
  return value
    .replace(/[。；;]+$/gu, '')
    .split(/(?:、|，|,|与|和)/u)
    .map(item => item.trim())
    .filter(item => item !== '')
}

function decisionAsks(chapter: ClientChapter): string[] {
  return chapter.blocks
    .filter((block): block is Extract<ClientContentBlock, { type: 'decision' }> => block.type === 'decision')
    .flatMap(block => block.asks)
    .filter((ask, index, rows) => rows.indexOf(ask) === index)
}

function investmentLabels(report: ClientReport, block: Extract<ClientContentBlock, { type: 'investment' }>): string[] {
  if (block.items.length > 1) return block.items.map(item => item.name)
  const statement = block.evidenceIds
    .map(id => report.evidence.find(row => row.evidenceId === id)?.statement ?? '')
    .find(value => /共同需求排序/u.test(value)) ?? ''
  const ranked = /按(.+?)的共同需求排序/u.exec(statement)?.[1] ?? block.items[0]?.name ?? ''
  return splitPlanningList(ranked.replace(/^首期投入/u, '')).slice(0, 3)
}

function analyticalVisualFor(
  report: ClientReport,
  chapter: ClientChapter,
  block: ClientContentBlock,
): ClientAnalyticalVisual | undefined {
  if (block.type === 'investment') {
    const labels = investmentLabels(report, block)
    const items = (labels.length === 0 ? block.items.map(item => item.name) : labels).slice(0, 3).map((label, index) => {
      const source = block.items[index] ?? block.items[0]
      return {
        order: String(index + 1).padStart(2, '0'),
        label,
        amount: source?.amount ?? '待核',
        unit: source?.unit ?? '',
        basis: source?.assumption ?? '待项目测算校核',
      }
    })
    return {
      kind: 'investment-sequence',
      items,
      disclosure: block.items.some(item => /\d/u.test(item.amount))
        ? '测试阶段示例投资测算；正式金额须由项目清单、造价与实施边界校核。'
        : '相对优先级，不代表造价金额；正式金额须由项目清单与测算确认。',
    }
  }

  if (chapter.role === 'spatial' && block.type === 'narrative') {
    const connected = /连接(.+?)[。；;]/u.exec(block.statement)?.[1] ?? block.statement
    const parsed = splitPlanningList(connected)
    const nodes = parsed.length >= 3 ? parsed : report.proposition.keywords.slice(0, 4)
    return {
      kind: 'spatial-sequence',
      nodes,
      disclosure: '节点位置与连接关系须由总平图、红线图或坐标资料校核。',
    }
  }
  if (chapter.role === 'spatial' && block.type === 'metric') {
    const match = /一轴、两带、三核/u.test(chapter.claim)
    const metrics = match
      ? [{ value: '1', label: '轴' }, { value: '2', label: '带' }, { value: '3', label: '核' }, { value: '+', label: '场景' }]
      : [{ value: block.value, label: block.unit }]
    return {
      kind: 'spatial-system',
      metrics,
      disclosure: '系统数量与边界须在项目总平面中定位并复核。',
    }
  }
  if (chapter.role === 'operation' && block.type === 'narrative') {
    const product = report.products[0]
    const claimLayers = splitPlanningList(chapter.claim)
    const operatingLayers = product === undefined ? [] : splitPlanningList(product.operatingModel)
    const layers = (claimLayers.length >= 3 ? claimLayers : operatingLayers).slice(0, 3)
    const teamSource = block.statement.split(/需要/u)[0] ?? block.statement
    const parsedTeams = splitPlanningList(teamSource.replace(/团队$/u, ''))
    const teams = (parsedTeams.length >= 3 ? parsedTeams : ['建设', '内容策划', '运营']).slice(0, 3)
    return { kind: 'operating-model', layers, teams, outcome: '共同支撑长期活力' }
  }
  if (chapter.role === 'operation' && block.type === 'evidence' && block.assetIds.length === 0) {
    const product = report.products[0]
    const columns = (product?.usageScenarios ?? ['日常', '周末', '节庆']).slice(0, 4)
    const rows = (product?.audiences ?? ['社区居民', '城市家庭', '青年客群']).slice(0, 4)
    const levels = [
      ['高', '中', '低', '中'],
      ['中', '高', '高', '中'],
      ['中', '高', '高', '高'],
      ['低', '中', '高', '高'],
    ] as const
    return {
      kind: 'daypart-matrix',
      columns,
      rows,
      values: rows.map((_row, rowIndex) => columns.map(
        (_column, columnIndex) => levels[rowIndex]?.[columnIndex] ?? '中',
      )),
      disclosure: '需求重叠关系为策划示例，须由客流、访谈与时段数据校核。',
    }
  }
  if (chapter.role === 'decision' && block.type === 'narrative') {
    const asks = decisionAsks(chapter).slice(0, 3)
    const outputs = ['形成定位结论', '形成首期边界图', '形成协同机制']
    return {
      kind: 'decision-triad',
      items: asks.map((label, index) => ({
        order: String(index + 1).padStart(2, '0'),
        label,
        output: outputs[index] ?? '形成确认结论',
      })),
    }
  }
  if (chapter.role === 'decision' && block.type === 'evidence' && block.assetIds.length === 0) {
    return {
      kind: 'decision-flow',
      decisions: decisionAsks(chapter).slice(0, 3),
      outputs: ['概念深化', '专题测算', '首期实施清单'],
    }
  }
  return undefined
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
  if (block.type === 'decision') return [...new Set(block.rationaleEvidenceIds)]
  if (block.type === 'product' || block.type === 'scene') return []
  return [...new Set(block.evidenceIds)]
}

function assetIds(block: ClientContentBlock): readonly string[] {
  if (block.type === 'evidence' || block.type === 'comparison' || block.type === 'product' || block.type === 'scene') {
    return block.assetIds
  }
  if (block.type === 'map') return [block.assetId]
  return []
}

type ProfessionalVisualRole = Extract<ClientVisualRole, 'map' | 'diagram' | 'chart'>

const PROFESSIONAL_VISUAL_ROLES = new Set<ClientVisualRole>(['map', 'diagram', 'chart'])

function professionalVisualRole(
  report: ClientReport,
  block: ClientContentBlock,
): ProfessionalVisualRole | undefined {
  for (const assetId of assetIds(block)) {
    const role = report.assets.find(asset => asset.assetId === assetId)?.role
    if (role !== undefined && PROFESSIONAL_VISUAL_ROLES.has(role)) return role as ProfessionalVisualRole
  }
  return undefined
}

function kindFor(
  chapter: ClientChapter,
  block: ClientContentBlock,
  visualRole?: ProfessionalVisualRole,
): ClientPageKind {
  if (assetIds(block).length > 1) return 'visual-evidence'
  if (visualRole !== undefined) return 'visual-evidence'
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

function headlineFor(report: ClientReport, chapter: ClientChapter, block: ClientContentBlock): string {
  if (block.type === 'narrative') {
    return chapter.role === 'decision'
      ? '同步确定定位、首期边界与协同机制'
      : chapter.headline
  }
  if (block.type === 'metric') return block.label + '：' + block.value + block.unit
  if (block.type === 'product') {
    return report.products.find(product => product.productId === block.productId)?.name ?? '核心产品'
  }
  const researchBoundaryAsset = assetIds(block)
    .map(assetId => report.assets.find(asset => asset.assetId === assetId))
    .find(asset => asset?.cartography?.boundary === 'research')
  if (researchBoundaryAsset !== undefined) {
    const concise = block.headline.replace(/[（(][\s\S]*$/u, '').trim()
    if (concise !== '') return concise
  }
  if (chapter.role === 'spatial' && block.type === 'evidence' && block.assetIds.length > 0) {
    const value = block.headline.split(/[：:]/u).slice(1).join('：').trim()
    const concise = value
      .replace(/[（(][\s\S]*$/u, '')
      .replace(/滨水亲水典型剖面/gu, '滨水剖面')
      .trim()
    if (concise !== '') return concise
  }
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
  if (kind === 'visual-evidence') return 'editorial'
  if (kind === 'scene') return index % 2 === 0 ? 'split' : 'full-bleed'
  if (kind === 'product' || kind === 'opportunity') return index % 2 === 0 ? 'split' : 'editorial'
  if (kind === 'implementation') return index % 2 === 0 ? 'timeline' : 'data'
  if (kind === 'decision') return (['summary', 'data', 'editorial'] as const)[index % 3]!
  if (kind === 'positioning') return index % 2 === 0 ? 'editorial' : 'split'
  return index % 2 === 0 ? 'data' : 'split'
}

function noAssetVariantFor(
  block: ClientContentBlock | undefined,
  fallback: ClientPage['layoutVariant'],
): ClientPage['layoutVariant'] {
  if (block?.type === 'narrative') return 'editorial'
  if (block?.type === 'metric') return 'data'
  if (block?.type === 'timeline') return 'timeline'
  if (block?.type === 'investment') return 'data'
  return fallback === 'full-bleed' ? 'editorial' : fallback
}

function blockPage(
  report: ClientReport,
  chapter: ClientChapter,
  block: ClientContentBlock,
  blockIndex: number,
): ClientPage {
  const visualRole = professionalVisualRole(report, block)
  const kind = kindFor(chapter, block, visualRole)
  const assets = assetIds(block)
  const analyticalVisual = assets.length === 0 ? analyticalVisualFor(report, chapter, block) : undefined
  return {
    pageId: chapter.id + '-block-' + String(blockIndex + 1).padStart(2, '0'),
    kind,
    layoutVariant: assets.length === 0
      ? noAssetVariantFor(block, variantFor(kind, blockIndex))
      : variantFor(kind, blockIndex),
    chapterId: chapter.id,
    headline: headlineFor(report, chapter, block),
    ...(visualRole === undefined ? {} : { visualRole }),
    primaryFocus: focusFor(block),
    blockIndexes: [blockIndex],
    assetIds: [...assets],
    evidenceIds: [...evidenceIds(block)],
    ...(analyticalVisual === undefined ? {} : { analyticalVisual }),
  }
}

function htmlBlockPages(
  report: ClientReport,
  chapter: ClientChapter,
  block: ClientContentBlock,
  blockIndex: number,
): ClientPage[] {
  const base = blockPage(report, chapter, block, blockIndex)
  const maximumAssetsPerPage = 10
  if (base.assetIds.length <= maximumAssetsPerPage) return [base]
  const groups: string[][] = []
  for (let index = 0; index < base.assetIds.length; index += maximumAssetsPerPage) {
    groups.push(base.assetIds.slice(index, index + maximumAssetsPerPage))
  }
  return groups.map((group, index) => ({
    ...base,
    pageId: `${base.pageId}-gallery-${String(index + 1).padStart(2, '0')}`,
    primaryFocus: { type: 'asset' as const, assetId: group[0]! },
    assetIds: group,
  }))
}

function blockForPage(report: ClientReport, page: ClientPage): ClientContentBlock | undefined {
  const blockIndex = page.blockIndexes[0]
  return blockIndex === undefined
    ? undefined
    : report.chapters.find(chapter => chapter.id === page.chapterId)?.blocks[blockIndex]
}

type AssetOrientation = 'landscape' | 'portrait' | 'square'

const MAP_DIAGRAM_LAYOUTS = ['full-bleed', 'editorial'] as const
const CHART_LAYOUTS = ['split', 'editorial'] as const

function applyRoleAwareProfessionalVisualLayouts(pages: readonly ClientPage[]): ClientPage[] {
  const planned: ClientPage[] = []
  let mapDiagramIndex = 0
  let chartIndex = 0
  for (const page of pages) {
    const previous = planned.at(-1)
    const continuesRun = page.kind === 'visual-evidence'
      && previous?.kind === 'visual-evidence'
      && previous.chapterId === page.chapterId
    if (!continuesRun) {
      mapDiagramIndex = 0
      chartIndex = 0
    }
    if (page.kind !== 'visual-evidence') {
      planned.push(page)
      continue
    }
    const sequence = page.visualRole === 'chart' ? CHART_LAYOUTS : MAP_DIAGRAM_LAYOUTS
    const sequenceIndex = page.visualRole === 'chart' ? chartIndex++ : mapDiagramIndex++
    let layoutVariant: ClientPage['layoutVariant'] = sequence[sequenceIndex % sequence.length]!
    const alternate = sequence[(sequenceIndex + 1) % sequence.length]!
    if (continuesRun && previous.layoutVariant === layoutVariant) layoutVariant = alternate
    const previousTwo = planned.slice(-2)
    if (previousTwo.length === 2 && previousTwo.every(candidate => candidate.layoutVariant === layoutVariant)) {
      layoutVariant = alternate
    }
    planned.push({ ...page, layoutVariant })
  }
  return planned
}

function assetOrientation(report: ClientReport, assetId: string | undefined): AssetOrientation {
  const asset = assetId === undefined ? undefined : report.assets.find(candidate => candidate.assetId === assetId)
  if (asset === undefined) return 'square'
  const ratio = asset.width / asset.height
  if (ratio >= 1.2) return 'landscape'
  if (ratio <= 1 / 1.2) return 'portrait'
  return 'square'
}

function singleVisualLayouts(report: ClientReport, page: ClientPage): readonly ClientPage['layoutVariant'][] {
  const orientation = assetOrientation(report, page.assetIds[0])
  if (orientation === 'landscape') return ['full-bleed', 'editorial', 'split']
  if (orientation === 'portrait') return ['split', 'editorial', 'full-bleed']
  return ['editorial', 'full-bleed', 'split']
}

function applyProfessionalVisualLayouts(
  report: ClientReport,
  pages: readonly ClientPage[],
  medium: ClientMedium,
): ClientPage[] {
  if (medium !== 'html') return applyRoleAwareProfessionalVisualLayouts(pages)
  const planned: ClientPage[] = []
  let visualIndex = 0

  for (const page of pages) {
    const previous = planned.at(-1)
    if (page.kind !== 'visual-evidence') {
      planned.push(page)
      continue
    }

    const sequence = singleVisualLayouts(report, page)
    let sequenceIndex = visualIndex++ % sequence.length
    let layoutVariant: ClientPage['layoutVariant'] = sequence[sequenceIndex]!
    if (previous?.kind === 'visual-evidence' && previous.layoutVariant === layoutVariant) {
      sequenceIndex = (sequenceIndex + 1) % sequence.length
      layoutVariant = sequence[sequenceIndex]!
    }
    const previousTwo = planned.slice(-2)
    if (previousTwo.length === 2 && previousTwo.every(candidate => candidate.layoutVariant === layoutVariant)) {
      layoutVariant = sequence[(sequenceIndex + 1) % sequence.length]!
    }
    planned.push({ ...page, layoutVariant })
  }

  return planned
}

function assetLayoutsForCount(count: number): readonly ClientAssetLayout[] {
  if (count === 1) return ['single']
  if (count === 2) return ['duo-asymmetric-horizontal', 'duo-asymmetric-vertical', 'duo-overlay']
  if (count === 3) return ['triptych-fullbleed', 'hero-plus-two', 'hero-plus-two-right', 'hero-top-pair']
  if (count === 4) return ['l-anchor', 'l-anchor-right', 'staggered-four', 'grid-2x2']
  if (count === 5) return ['center-anchor', 't-mosaic', 'waterfall-five']
  if (count === 6) return ['paired-story-columns', 'anchor-five', 'editorial-collage', 'gallery-3x2']
  if (count >= 7 && count <= 10) return ['perimeter-mosaic', 'anchor-side-board', 'editorial-board']
  return []
}

function preferredAssetLayouts(
  report: ClientReport,
  page: ClientPage,
  allowed: readonly ClientAssetLayout[],
): readonly ClientAssetLayout[] {
  const orientations = page.assetIds.map(assetId => assetOrientation(report, assetId))
  const portraitCount = orientations.filter(value => value === 'portrait').length
  const landscapeCount = orientations.filter(value => value === 'landscape').length
  const primary = orientations[0] ?? 'square'
  let preferred: ClientAssetLayout | undefined
  if (page.assetIds.length === 2) {
    preferred = portraitCount === 2
      ? 'duo-asymmetric-horizontal'
      : landscapeCount === 2
        ? 'duo-asymmetric-vertical'
        : 'duo-overlay'
  } else if (page.assetIds.length === 3) {
    preferred = portraitCount === 3
      ? 'triptych-fullbleed'
      : landscapeCount >= 2
        ? 'hero-top-pair'
        : 'hero-plus-two'
  } else if (page.assetIds.length === 4) {
    preferred = portraitCount >= 3 ? 'staggered-four' : primary === 'landscape' ? 'l-anchor' : 'grid-2x2'
  } else if (page.assetIds.length === 5) {
    preferred = portraitCount >= 3 ? 'waterfall-five' : primary === 'landscape' ? 't-mosaic' : 'center-anchor'
  } else if (page.assetIds.length === 6) {
    preferred = portraitCount >= 4
      ? 'paired-story-columns'
      : primary === 'landscape'
        ? 'anchor-five'
        : 'editorial-collage'
  } else if (page.assetIds.length >= 7) {
    preferred = portraitCount > landscapeCount
      ? 'editorial-board'
      : primary === 'landscape'
        ? 'anchor-side-board'
        : 'perimeter-mosaic'
  }
  if (preferred === undefined || !allowed.includes(preferred)) return allowed
  return [preferred, ...allowed.filter(candidate => candidate !== preferred)]
}

function applyHtmlAssetLayouts(report: ClientReport, pages: readonly ClientPage[]): ClientPage[] {
  let horizontalIndex = 0
  let verticalIndex = 0
  const layoutIndexes = new Map<number, number>()
  let previousGalleryLayout: ClientAssetLayout | undefined
  return pages.map(page => {
    if (page.kind === 'cover' || page.assetIds.length === 0) {
      previousGalleryLayout = undefined
      return page
    }
    const allowed = assetLayoutsForCount(page.assetIds.length)
    const ordered = preferredAssetLayouts(report, page, allowed)
    const layoutIndex = layoutIndexes.get(page.assetIds.length) ?? 0
    let assetLayout = ordered[layoutIndex % ordered.length]
    if (page.assetIds.length > 1 && ordered.length > 1 && assetLayout === previousGalleryLayout) {
      assetLayout = ordered[(layoutIndex + 1) % ordered.length]
    }
    layoutIndexes.set(page.assetIds.length, layoutIndex + 1)
    if (assetLayout === undefined) return page
    if (assetLayout !== 'single') {
      previousGalleryLayout = assetLayout
      return { ...page, assetLayout, mediaPosition: 'background' as const }
    }
    previousGalleryLayout = undefined
    if (page.layoutVariant === 'full-bleed') {
      return { ...page, assetLayout, mediaPosition: 'background' as const }
    }
    if (page.layoutVariant === 'split') {
      const mediaPosition = (['right', 'left'] as const)[horizontalIndex++ % 2]!
      return { ...page, assetLayout, mediaPosition }
    }
    if (page.layoutVariant === 'editorial') {
      const mediaPosition = (['bottom', 'top'] as const)[verticalIndex++ % 2]!
      return { ...page, assetLayout, mediaPosition }
    }
    return { ...page, assetLayout }
  })
}

function applyHtmlSupportingAssets(report: ClientReport, pages: readonly ClientPage[]): ClientPage[] {
  const reservedAssetIds = new Set(pages.flatMap(page => page.assetIds))
  const usedSupportingIds = new Set<string>()
  let singleVisualIndex = 0
  return pages.map(page => {
    if (page.kind !== 'visual-evidence' || page.assetIds.length !== 1) return page
    const shouldComposeGallery = singleVisualIndex++ % 2 === 1
    if (!shouldComposeGallery) return page
    const supports = report.assets.filter(asset => asset.chapterId === page.chapterId
      && !reservedAssetIds.has(asset.assetId)
      && !usedSupportingIds.has(asset.assetId)).slice(0, 2)
    if (supports.length < 2) return page
    supports.forEach(asset => usedSupportingIds.add(asset.assetId))
    return { ...page, assetIds: [...page.assetIds, ...supports.map(asset => asset.assetId)] }
  })
}

function appendixPages(report: ClientReport): ClientPage[] {
  const variants: readonly ClientPage['layoutVariant'][] = ['editorial', 'data', 'split']
  return report.evidence.map((evidence, index) => ({
    pageId: 'appendix-' + String(index + 1).padStart(2, '0'),
    kind: 'appendix',
    layoutVariant: variants[index % variants.length]!,
    chapterId: 'appendix',
    headline: evidence.locator,
    primaryFocus: { type: 'claim', statement: evidence.sourceLabel },
    blockIndexes: [],
    assetIds: [],
    evidenceIds: [evidence.evidenceId],
  }))
}

function closingDecisionPage(report: ClientReport): ClientPage {
  const decisions = report.chapters
    .flatMap(chapter => chapter.blocks)
    .filter((block): block is Extract<ClientContentBlock, { type: 'decision' }> => block.type === 'decision')
  const asks = [...new Set(decisions.flatMap(decision => decision.asks))]
  const evidence = [...new Set(decisions.flatMap(decision => decision.rationaleEvidenceIds))]
  return {
    pageId: 'closing-decision',
    kind: 'decision',
    layoutVariant: 'summary',
    chapterId: report.chapters.at(-1)?.id ?? 'decision',
    headline: '把共同判断转化为下一步行动',
    primaryFocus: { type: 'decision', asks: asks.length === 0 ? ['确认项目定位与首期实施边界'] : asks },
    blockIndexes: [],
    assetIds: [],
    evidenceIds: evidence,
  }
}

function appendixIntroductionPage(): ClientPage {
  return {
    pageId: 'appendix-introduction',
    kind: 'opening-claim',
    layoutVariant: 'editorial',
    chapterId: 'appendix',
    headline: '专业依据与资料索引',
    primaryFocus: { type: 'claim', statement: '以下内容汇集本报告引用的资料来源、时间与口径，便于会后查阅。' },
    blockIndexes: [],
    assetIds: [],
    evidenceIds: [],
  }
}

function applyHtmlBackdrops(report: ClientReport, pages: readonly ClientPage[]): ClientPage[] {
  const materialConcepts = report.assets.filter(asset => asset.role === 'material' && asset.sourceKind === 'ai-concept')
  const usedBackdropIds = new Set<string>()
  const fallback = (page: ClientPage): string | undefined => {
    const candidates = [
      ...report.assets.filter(asset => asset.chapterId === page.chapterId && asset.role !== 'material'),
      ...report.assets.filter(asset => asset.role === 'hero'),
      ...report.assets.filter(asset => asset.sourceKind === 'ai-concept' && asset.role !== 'material'),
    ]
    const asset = candidates.find(candidate => !usedBackdropIds.has(candidate.assetId)) ?? candidates[0]
    if (asset !== undefined) usedBackdropIds.add(asset.assetId)
    return asset?.assetId
  }
  return pages.map(page => {
    const isTarget = page.pageId === 'opening-project' || page.pageId === 'opening-value' || page.kind === 'chapter-divider'
    if (!isTarget) return page
    const material = materialConcepts.find(asset => !usedBackdropIds.has(asset.assetId))
    if (material !== undefined) usedBackdropIds.add(material.assetId)
    const backdropAssetId = material?.assetId ?? fallback(page)
    return backdropAssetId === undefined ? page : { ...page, backdropAssetId }
  })
}

export function planClientPages(report: ClientReport, medium: ClientMedium): ClientPagePlan {
  const urgencyVisual: ClientAnalyticalVisual = {
    kind: 'urgency-signals',
    countLabel: '3 个同步行动层',
    signals: [
      { label: '资源转化', state: '从存量资源到可使用界面' },
      { label: '空间连续', state: '从分散节点到城市网络' },
      { label: '运营前置', state: '从建成开放到持续发生' },
    ],
    disclosure: '具体紧迫性指标须由场地现状、客流与运营资料校核。',
  }
  const pages: ClientPage[] = [
    coverPage(report),
    openingPage('opening-project', '这是一个什么项目', report.proposition.projectDefinition, 'editorial'),
    openingPage('opening-urgency', '为什么现在必须行动', report.proposition.urgency, 'split', urgencyVisual),
    openingPage('opening-value', '项目将创造什么价值', report.proposition.coreValue, 'full-bleed'),
  ]

  for (const chapter of report.chapters) {
    pages.push(chapterDivider(chapter))
    chapter.blocks.forEach((block, index) => {
      if (block.type !== 'decision') {
        pages.push(...(medium === 'html'
          ? htmlBlockPages(report, chapter, block, index)
          : [blockPage(report, chapter, block, index)]))
      }
    })
  }

  pages.push(closingDecisionPage(report))
  if (medium === 'pdf') pages.push(appendixIntroductionPage(), ...appendixPages(report))

  const usedAssets = new Set<string>()
  const deduplicatedPages = pages.map(page => {
    const available = page.assetIds.filter(assetId => {
      if (usedAssets.has(assetId)) return false
      usedAssets.add(assetId)
      return true
    })
    if (available.length === page.assetIds.length) return page
    const focus = page.primaryFocus.type === 'asset' && !available.includes(page.primaryFocus.assetId)
      ? { type: 'claim' as const, statement: page.headline }
      : page.primaryFocus
    if (page.kind === 'visual-evidence' && available.length === 0) {
      const { visualRole: _visualRole, ...withoutVisualRole } = page
      return { ...withoutVisualRole, kind: 'evidence' as const, layoutVariant: 'editorial' as const, primaryFocus: focus, assetIds: available }
    }
    const block = blockForPage(report, page)
    return {
      ...page,
      primaryFocus: focus,
      assetIds: available,
      layoutVariant: available.length === 0
        ? noAssetVariantFor(block, page.layoutVariant)
        : page.layoutVariant,
    }
  })
  const professionalPages = applyProfessionalVisualLayouts(report, medium === 'html'
    ? applyHtmlBackdrops(report, deduplicatedPages)
    : deduplicatedPages, medium)
  const plan: ClientPagePlan = {
    medium,
    pages: medium === 'html'
      ? applyHtmlAssetLayouts(report, applyHtmlSupportingAssets(report, professionalPages))
      : professionalPages,
    layoutContract: LAYOUT_CONTRACT,
    ...(report.visualContractVersion === undefined ? {} : { visualContractVersion: report.visualContractVersion }),
  }
  return plan
}

function violation(code: string, path: string, message: string): ClientPolicyViolation {
  return { code, path, message }
}

function isDistinctProfessionalVisualRun(
  run: readonly ClientPage[],
  report: ClientReport | undefined,
): boolean {
  if (run.length !== 3) return false
  if (report === undefined) return false
  const chapterId = run[0]?.chapterId
  if (chapterId === undefined || chapterId.trim() === '') return false
  const primaryAssets: string[] = []
  for (const page of run) {
    const primaryAssetId = page.primaryFocus.type === 'asset'
      ? page.primaryFocus.assetId
      : undefined
    const asset = primaryAssetId === undefined
      ? undefined
      : report.assets.find(candidate => candidate.assetId === primaryAssetId)
    if (
      page.kind !== 'visual-evidence'
      || page.chapterId !== chapterId
      || page.visualRole === undefined
      || !PROFESSIONAL_VISUAL_ROLES.has(page.visualRole)
      || primaryAssetId === undefined
      || primaryAssetId.trim() === ''
      || !page.assetIds.includes(primaryAssetId)
      || asset === undefined
      || asset.chapterId !== page.chapterId
      || !PROFESSIONAL_VISUAL_ROLES.has(asset.role)
      || asset.role !== page.visualRole
    ) return false
    primaryAssets.push(primaryAssetId)
  }
  return new Set(primaryAssets).size === primaryAssets.length
}

export function validateClientPagePlan(
  plan: ClientPagePlan,
  report?: ClientReport,
): ClientPolicyViolation[] {
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
  plan.pages.forEach((page, index) => {
    if (
      plan.medium !== 'html'
      && page.kind === 'visual-evidence'
      && (page.visualRole === 'map' || page.visualRole === 'diagram')
      && page.layoutVariant === 'split'
    ) {
      violations.push(violation(
        'PROFESSIONAL_LAYOUT_ROLE_INVALID',
        `pages[${index}].layoutVariant`,
        `${page.visualRole} visual evidence cannot use a split layout`,
      ))
    }
    if (plan.medium === 'html' && page.kind !== 'cover' && page.assetIds.length > 0) {
      const allowed = assetLayoutsForCount(page.assetIds.length)
      if (page.assetIds.length > 10 || page.assetLayout === undefined || !allowed.includes(page.assetLayout)) {
        violations.push(violation(
          'ASSET_LAYOUT_COUNT_INVALID',
          `pages[${index}].assetLayout`,
          `${page.assetIds.length} images require one of: ${allowed.join(', ') || 'no supported layout'}`,
        ))
      }
      const validPosition = page.assetLayout !== 'single'
        ? page.mediaPosition === 'background'
        : page.layoutVariant === 'full-bleed'
          ? page.mediaPosition === 'background'
          : page.layoutVariant === 'split'
            ? page.mediaPosition === 'left' || page.mediaPosition === 'right'
            : page.layoutVariant === 'editorial'
              ? page.mediaPosition === 'top' || page.mediaPosition === 'bottom'
              : page.mediaPosition === undefined
      if (!validPosition) {
        violations.push(violation(
          'MEDIA_POSITION_INVALID',
          `pages[${index}].mediaPosition`,
          `${page.layoutVariant}/${page.assetLayout} has an incompatible media position`,
        ))
      }
    }
  })
  for (let index = 6; index < plan.pages.length; index += 1) {
    const run = plan.pages.slice(index - 2, index + 1)
    if (
      run[0]?.kind !== 'appendix'
      && run.every(page => page.kind === run[0]?.kind)
      && !isDistinctProfessionalVisualRun(run, report)
    ) {
      violations.push(violation(
        'PAGE_KIND_REPETITION',
        'pages[' + String(index - 2) + '..' + String(index) + ']',
        'the same page kind appears three times in a row',
      ))
    }
  }
  if (plan.visualContractVersion === 'architectural-v1') {
    const isExempt = (page: ClientPage): boolean => page.kind === 'cover'
      || page.kind === 'opening-claim'
      || page.kind === 'chapter-divider'
      || page.kind === 'appendix'
      || page.kind === 'decision'
      || page.pageId === 'closing-decision'
    const contentPages = plan.pages.filter(page => !isExempt(page))
    const visualPages = contentPages.filter(page => page.assetIds.length > 0 || page.analyticalVisual !== undefined)
    const ratio = contentPages.length === 0 ? 0 : visualPages.length / contentPages.length
    if (ratio < 0.5) {
      violations.push(violation(
        'VISUAL_PAGE_COVERAGE_LOW',
        'pages',
        `content-page visual coverage must be at least 50%; found ${Math.round(ratio * 1000) / 10}%`,
      ))
    }
    let textOnlyRun = 0
    for (const page of plan.pages) {
      if (isExempt(page) || page.assetIds.length > 0 || page.analyticalVisual !== undefined) {
        textOnlyRun = 0
        continue
      }
      textOnlyRun += 1
      if (textOnlyRun > 2) {
        violations.push(violation(
          'TEXT_ONLY_RUN_TOO_LONG',
          'pages',
          'text-only content pages may not appear more than twice in a row',
        ))
        break
      }
    }
    if (plan.medium === 'html') {
      const textOnlyPages = plan.pages.filter(page => page.assetIds.length === 0
        && page.backdropAssetId === undefined
        && page.analyticalVisual === undefined)
      if (textOnlyPages.length > 2) {
        violations.push(violation(
          'TEXT_ONLY_PAGE_COUNT_EXCEEDED',
          'pages',
          `HTML main report may contain at most two text-only pages; found ${textOnlyPages.length}`,
        ))
      }
      if (textOnlyPages.some(page => {
        const index = plan.pages.indexOf(page)
        const previous = plan.pages[index - 1]
        return previous !== undefined
          && previous.assetIds.length === 0
          && previous.backdropAssetId === undefined
          && previous.analyticalVisual === undefined
      })) {
        violations.push(violation(
          'TEXT_ONLY_PAGES_CONSECUTIVE',
          'pages',
          'text-only pages may not be consecutive in an HTML main report',
        ))
      }
    }
  }
  return violations
}

export function assertClientPagePlan(plan: ClientPagePlan, report?: ClientReport): void {
  const violations = validateClientPagePlan(plan, report)
  if (violations.length > 0) {
    throw new Error(violations.map(row => row.code + ' ' + row.path + ': ' + row.message).join('\n'))
  }
}
