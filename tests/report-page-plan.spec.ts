import { describe, expect, it } from 'vitest'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { planClientPages, validateClientPagePlan } from '../src/report/page-plan.ts'
import type { ClientPage, ClientPagePlan, ClientReport, ClientVisualRole } from '../src/report/client-types.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const CLIENT_REPORT = createClientReportBundle(REPORT_INPUT, CLIENT_PROFILE).report
const VALIDATOR_PROFESSIONAL_CHAPTER = 'validator-professional-chapter'
const VALIDATOR_PROFESSIONAL_ASSETS = (['map', 'chart', 'diagram'] as const).map((role, index) => ({
  ...CLIENT_REPORT.assets[0]!,
  assetId: `validator-professional-${index + 1}`,
  role,
  chapterId: VALIDATOR_PROFESSIONAL_CHAPTER,
  caption: `validator professional ${index + 1}`,
}))
const VALIDATOR_REPORT: ClientReport = {
  ...CLIENT_REPORT,
  assets: [...CLIENT_REPORT.assets, ...VALIDATOR_PROFESSIONAL_ASSETS],
}

function reportWithProfessionalEvidence(): ClientReport {
  const roles = ['map', 'diagram', 'chart'] as const satisfies readonly ClientVisualRole[]
  const professionalAssets = roles.map((role, index) => ({
    ...CLIENT_REPORT.assets[0]!,
    assetId: `professional-${role}`,
    role,
    chapterId: CLIENT_REPORT.chapters[index]!.id,
    caption: `${role} professional evidence`,
  }))
  return {
    ...CLIENT_REPORT,
    assets: [...CLIENT_REPORT.assets, ...professionalAssets],
    chapters: CLIENT_REPORT.chapters.map((chapter, index) => index >= roles.length
      ? chapter
      : {
          ...chapter,
          blocks: chapter.blocks.map((block, blockIndex) => blockIndex === 0
            ? {
                type: 'evidence' as const,
                headline: `${roles[index]} evidence headline`,
                evidenceIds: block.type === 'narrative' ? block.evidenceIds : [],
                assetIds: [professionalAssets[index]!.assetId],
              }
            : block),
        }),
  }
}

function reportWithProfessionalRun(
  roles: readonly Extract<ClientVisualRole, 'map' | 'diagram' | 'chart'>[] = [
    'map', 'chart', 'diagram', 'map', 'chart', 'diagram',
  ],
): ClientReport {
  const chapter = CLIENT_REPORT.chapters[1]!
  const professionalAssets = roles.map((role, index) => ({
    ...CLIENT_REPORT.assets[0]!,
    assetId: `professional-run-${index + 1}`,
    role,
    chapterId: chapter.id,
    caption: `professional run ${index + 1}`,
  }))
  return {
    ...CLIENT_REPORT,
    assets: [...CLIENT_REPORT.assets, ...professionalAssets],
    chapters: CLIENT_REPORT.chapters.map(candidate => candidate.id !== chapter.id
      ? candidate
      : {
          ...candidate,
          blocks: professionalAssets.map((asset, index) => ({
            type: 'evidence' as const,
            headline: `专业图件 ${index + 1}`,
            evidenceIds: [`evidence-${index + 1}`],
            assetIds: [asset.assetId],
          })),
        }),
  }
}

function reportWithAssetGroup(
  count: number,
  role: ClientVisualRole = 'map',
  dimensions: Readonly<{ width: number; height: number }> = { width: 1920, height: 1080 },
) {
  const chapter = CLIENT_REPORT.chapters[0]!
  const assets = Array.from({ length: count }, (_, index) => ({
    ...CLIENT_REPORT.assets[0]!,
    assetId: `asset-group-${count}-${index + 1}`,
    role,
    chapterId: chapter.id,
    caption: `组图 ${count}-${index + 1}`,
    ...dimensions,
  }))
  const report: ClientReport = {
    ...CLIENT_REPORT,
    assets: [...CLIENT_REPORT.assets, ...assets],
    chapters: CLIENT_REPORT.chapters.map(candidate => candidate.id !== chapter.id
      ? candidate
      : {
          ...candidate,
          blocks: candidate.blocks.map((block, index) => index !== 0
            ? block
            : {
                type: 'evidence' as const,
                headline: `${count} 张图形成清晰的页面构图`,
                evidenceIds: [CLIENT_REPORT.evidence[0]!.evidenceId],
                assetIds: assets.map(asset => asset.assetId),
              }),
        }),
  }
  return { report, chapterId: chapter.id, assetIds: assets.map(asset => asset.assetId) }
}

function reportWithRepeatedAssetGroups(count: number, groupCount: number): ClientReport {
  const chapter = CLIENT_REPORT.chapters[0]!
  const groups = Array.from({ length: groupCount }, (_, groupIndex) => Array.from(
    { length: count },
    (_, assetIndex) => ({
      ...CLIENT_REPORT.assets[0]!,
      assetId: `repeated-${count}-${groupIndex + 1}-${assetIndex + 1}`,
      role: 'material' as const,
      chapterId: chapter.id,
      caption: `重复构图 ${groupIndex + 1}-${assetIndex + 1}`,
      width: 1920,
      height: 1080,
    }),
  ))
  return {
    ...CLIENT_REPORT,
    assets: [...CLIENT_REPORT.assets, ...groups.flat()],
    chapters: CLIENT_REPORT.chapters.map(candidate => candidate.id !== chapter.id
      ? candidate
      : {
          ...candidate,
          blocks: groups.map((assets, index) => ({
            type: 'evidence' as const,
            headline: `连续组图 ${index + 1}`,
            evidenceIds: [CLIENT_REPORT.evidence[index % CLIENT_REPORT.evidence.length]!.evidenceId],
            assetIds: assets.map(asset => asset.assetId),
          })),
        }),
  }
}

function reportWithChartRun(count: number): ClientReport {
  const chapter = CLIENT_REPORT.chapters[1]!
  const assets = Array.from({ length: count }, (_, index) => ({
    ...CLIENT_REPORT.assets[0]!,
    assetId: `chart-direction-${index + 1}`,
    role: 'chart' as const,
    chapterId: chapter.id,
    caption: `图表方向 ${index + 1}`,
  }))
  return {
    ...CLIENT_REPORT,
    assets: [...CLIENT_REPORT.assets, ...assets],
    chapters: CLIENT_REPORT.chapters.map(candidate => candidate.id !== chapter.id
      ? candidate
      : {
          ...candidate,
          blocks: assets.map((asset, index) => ({
            type: 'evidence' as const,
            headline: `图表方向 ${index + 1}`,
            evidenceIds: [CLIENT_REPORT.evidence[index % CLIENT_REPORT.evidence.length]!.evidenceId],
            assetIds: [asset.assetId],
          })),
        }),
  }
}

function professionalRunPages(): ClientPage[] {
  const source = planClientPages(CLIENT_REPORT, 'pptx').pages.find(page => page.kind === 'evidence')!
  const variants = ['full-bleed', 'split', 'editorial'] as const
  return variants.map((layoutVariant, index) => {
    const asset = VALIDATOR_PROFESSIONAL_ASSETS[index]!
    return {
      ...source,
      pageId: `validator-professional-${index + 1}`,
      kind: 'visual-evidence' as const,
      layoutVariant,
      chapterId: VALIDATOR_PROFESSIONAL_CHAPTER,
      visualRole: asset.role as Extract<ClientVisualRole, 'map' | 'chart' | 'diagram'>,
      primaryFocus: { type: 'asset' as const, assetId: asset.assetId },
      assetIds: [asset.assetId],
    }
  })
}

function planWithTrailingRun(run: readonly ClientPage[]): ClientPagePlan {
  const base = planClientPages(CLIENT_REPORT, 'pptx')
  return { ...base, pages: [...base.pages, ...run] }
}

describe('planClientPages', () => {
  it('creates the three-step opening and keeps the PPTX main report free of appendix production language', () => {
    const plan = planClientPages(CLIENT_REPORT, 'pptx')
    const htmlPlan = planClientPages(CLIENT_REPORT, 'html')

    expect(plan.pages.slice(0, 4).map(page => page.kind)).toEqual([
      'cover', 'opening-claim', 'opening-claim', 'opening-claim',
    ])
    expect(plan.pages).toHaveLength(35)
    expect(plan.pages.some(page => page.chapterId === 'appendix')).toBe(false)
    expect(htmlPlan.pages.some(page => page.chapterId === 'appendix')).toBe(false)
    expect(plan.pages.map(page => page.headline).join('\n')).not.toMatch(/仅 PDF|供核验|不属于主报告/iu)
    expect(htmlPlan.pages.map(page => page.headline).join('\n')).not.toMatch(/仅 PDF|供核验|不属于主报告/iu)
    expect(plan.pages.filter(page => page.kind === 'decision').map(page => page.pageId)).toEqual([
      'closing-decision',
    ])
    expect(plan.layoutContract).toEqual({
      safeMarginRatio: 0.06,
      minimumTitle: 24,
      minimumBody: 14,
      minimumCaption: 10,
    })
    const bodyKinds = plan.pages.slice(4).map(page => page.kind)
    expect(bodyKinds.some((kind, index) =>
      index >= 2 && kind === bodyKinds[index - 1] && kind === bodyKinds[index - 2])).toBe(false)
    expect(validateClientPagePlan(plan)).toEqual([])
  })

  it('uses each visual asset on at most one client page', () => {
    const report: ClientReport = {
      ...CLIENT_REPORT,
      assets: CLIENT_REPORT.assets.map(asset => ({ ...asset, role: 'hero' as const })),
    }
    const plan = planClientPages(report, 'pptx')
    const uses = plan.pages.flatMap(page => page.assetIds)

    expect(uses.filter(assetId => assetId === 'concept-1')).toHaveLength(1)
  })

  it('adds a client-readable professional appendix introduction and evidence pages only to PDF', () => {
    const plan = planClientPages(CLIENT_REPORT, 'pdf')

    expect(plan.pages).toHaveLength(48)
    expect(plan.pages.find(page => page.pageId === 'appendix-introduction')).toMatchObject({
      headline: '专业依据与资料索引',
      primaryFocus: {
        type: 'claim',
        statement: '以下内容汇集本报告引用的资料来源、时间与口径，便于会后查阅。',
      },
    })
    expect(plan.pages.map(page => `${page.headline}\n${page.primaryFocus.type === 'claim' ? page.primaryFocus.statement : ''}`).join('\n'))
      .not.toMatch(/仅 PDF|供核验|不属于主报告/iu)
    expect(plan.pages.filter(page => page.kind === 'appendix')).toHaveLength(12)
    expect(validateClientPagePlan(plan)).toEqual([])
  })

  it('uses a client-readable source label instead of an internal locator in the PDF appendix', () => {
    const appendix = planClientPages(CLIENT_REPORT, 'pdf').pages.find(page => page.kind === 'appendix')

    expect(appendix?.primaryFocus).toEqual({ type: 'claim', statement: 'Golden Project 冻结资料' })
  })

  it('deduplicates decision rationale evidence before rendering the closing page', () => {
    const decisionChapter = CLIENT_REPORT.chapters.find(chapter => chapter.role === 'decision')!
    const firstDecision = decisionChapter.blocks.find(block => block.type === 'decision')!
    const report: ClientReport = {
      ...CLIENT_REPORT,
      chapters: CLIENT_REPORT.chapters.map(chapter => chapter.role !== 'decision'
        ? chapter
        : {
            ...chapter,
            blocks: [...chapter.blocks.map(block => block.type !== 'decision'
              ? block
              : { ...block, rationaleEvidenceIds: ['evidence-12', 'evidence-12'] }), {
                ...firstDecision,
                headline: '补充形成运营协同决策',
                asks: ['确认建设与运营协同机制', '确认后续数据校核责任'],
                rationaleEvidenceIds: ['evidence-11', 'evidence-12'],
              }],
          }),
    }

    const closing = planClientPages(report, 'pdf').pages.find(page => page.pageId === 'closing-decision')

    expect(closing?.evidenceIds).toEqual(['evidence-12', 'evidence-11'])
    expect(closing?.primaryFocus).toEqual({
      type: 'decision',
      asks: [...new Set([...firstDecision.asks, '确认建设与运营协同机制', '确认后续数据校核责任'])],
    })
  })

  it('moves research-boundary disclosures from the page title into the shared visual contract', () => {
    const asset = CLIENT_REPORT.assets[0]!
    const chapter = CLIENT_REPORT.chapters[0]!
    const report: ClientReport = {
      ...CLIENT_REPORT,
      assets: [{
        ...asset,
        role: 'map',
        analysisKind: 'site-boundary',
        chapterId: chapter.id,
        cartography: {
          boundary: 'research',
          disclosures: ['研究范围（待核）', '非法定红线', '非测绘成果'],
          legend: 'present',
          northArrow: 'present',
          scale: { kind: 'nts' },
        },
      }, ...CLIENT_REPORT.assets.slice(1)],
      chapters: CLIENT_REPORT.chapters.map(candidate => candidate.id !== chapter.id
        ? candidate
        : {
            ...candidate,
            blocks: [{
              type: 'comparison',
              headline: '项目研究范围统筹场地分析（研究范围（待核） · 非法定红线 · 非测绘成果）',
              before: '边界资料尚未由项目团队确认',
              after: '研究范围仅用于组织当前策划分析',
              evidenceIds: ['evidence-1'],
              assetIds: [asset.assetId],
            }, ...candidate.blocks.slice(1)],
          }),
    }

    const page = planClientPages(report, 'pptx').pages.find(candidate => candidate.assetIds.includes(asset.assetId))

    expect(page?.headline).toBe('项目研究范围统筹场地分析')
    expect(report.assets[0]?.cartography?.disclosures).toEqual(['研究范围（待核）', '非法定红线', '非测绘成果'])
  })

  it('promotes maps, diagrams, and charts into role-aware visual evidence pages for PPTX', () => {
    const plan = planClientPages(reportWithProfessionalEvidence(), 'pptx')
    const visualPages = plan.pages.filter(page => page.kind === 'visual-evidence')

    expect(visualPages.map(page => page.visualRole)).toEqual(['map', 'diagram', 'chart'])
    expect(visualPages.map(page => page.layoutVariant)).toEqual(['editorial', 'full-bleed', 'split'])
    expect(visualPages.every(page => page.primaryFocus.type === 'asset')).toBe(true)
    expect(validateClientPagePlan(plan)).toEqual([])
  })

  it.each([
    [1, ['single'], [1]],
    [2, ['duo-asymmetric-vertical'], [2]],
    [3, ['hero-top-pair'], [3]],
    [4, ['l-anchor'], [4]],
    [5, ['t-mosaic'], [5]],
    [6, ['anchor-five'], [6]],
    [7, ['anchor-side-board'], [7]],
    [10, ['anchor-side-board'], [10]],
    [11, ['anchor-side-board', 'single'], [10, 1]],
    [12, ['anchor-side-board', 'duo-asymmetric-vertical'], [10, 2]],
    [20, ['anchor-side-board', 'perimeter-mosaic'], [10, 10]],
  ] as const)(
    'plans %i source images into explicit hierarchy-aware HTML layouts',
    (count, expectedLayouts, expectedGroupSizes) => {
      const { report, chapterId, assetIds } = reportWithAssetGroup(count)
      const pages = planClientPages(report, 'html').pages.filter(page =>
        page.chapterId === chapterId && page.blockIndexes[0] === 0)

      expect(pages.map(page => page.assetLayout)).toEqual(expectedLayouts)
      expect(pages.map(page => page.assetIds.length)).toEqual(expectedGroupSizes)
      expect(pages.flatMap(page => page.assetIds)).toEqual(assetIds)
      expect(pages.every(page => page.assetIds.length <= 10)).toBe(true)
      expect(pages.map(page => page.primaryFocus)).toEqual(pages.map(page => ({
        type: 'asset', assetId: page.assetIds[0],
      })))
    },
  )

  it('selects gallery composition from dimensions rather than image semantic roles', () => {
    const mapGroup = reportWithAssetGroup(4, 'map')
    const materialGroup = reportWithAssetGroup(4, 'material')
    const plannedLayout = ({ report, chapterId }: typeof mapGroup) => planClientPages(report, 'html').pages.find(page =>
      page.chapterId === chapterId && page.blockIndexes[0] === 0)

    expect(plannedLayout(mapGroup)).toMatchObject({ kind: 'visual-evidence', assetLayout: 'l-anchor' })
    expect(plannedLayout(materialGroup)).toMatchObject({ kind: 'visual-evidence', assetLayout: 'l-anchor' })
  })

  it('uses aspect ratio to choose the starting three-image composition', () => {
    const landscape = reportWithAssetGroup(3, 'material', { width: 1920, height: 1080 })
    const portrait = reportWithAssetGroup(3, 'material', { width: 900, height: 1600 })
    const square = reportWithAssetGroup(3, 'material', { width: 1200, height: 1200 })
    const layout = ({ report, chapterId }: typeof landscape) => planClientPages(report, 'html').pages.find(page =>
      page.chapterId === chapterId && page.blockIndexes[0] === 0)?.assetLayout

    expect(layout(landscape)).toBe('hero-top-pair')
    expect(layout(portrait)).toBe('triptych-fullbleed')
    expect(layout(square)).toBe('hero-plus-two')
  })

  it('rotates repeated same-count galleries without repeating adjacent compositions', () => {
    const report = reportWithRepeatedAssetGroups(4, 4)
    const chapterId = report.chapters[0]!.id
    const pages = planClientPages(report, 'html').pages.filter(page =>
      page.chapterId === chapterId && page.kind === 'visual-evidence')

    expect(pages.map(page => page.assetLayout)).toEqual([
      'l-anchor', 'l-anchor-right', 'staggered-four', 'grid-2x2',
    ])
  })

  it('keeps single-image page arrangement independent of visual role ordering', () => {
    const first = reportWithProfessionalRun(['map', 'chart', 'diagram', 'map', 'chart', 'diagram'])
    const second = reportWithProfessionalRun(['chart', 'diagram', 'map', 'chart', 'diagram', 'map'])
    const layouts = (report: ClientReport) => planClientPages(report, 'html').pages
      .filter(page => page.chapterId === report.chapters[1]!.id && page.kind === 'visual-evidence')
      .map(page => page.layoutVariant)

    expect(layouts(first)).toEqual(layouts(second))
  })

  it('cycles full-bleed, top-bottom, and left-right positions for consecutive single-image pages', () => {
    const report = reportWithChartRun(6)
    const pages = planClientPages(report, 'html').pages.filter(page =>
      page.chapterId === report.chapters[1]!.id && page.kind === 'visual-evidence')

    expect(pages.map(page => page.layoutVariant)).toEqual([
      'full-bleed', 'editorial', 'split', 'full-bleed', 'editorial', 'split',
    ])
    expect(pages.map(page => page.mediaPosition)).toEqual([
      'background', 'bottom', 'right', 'background', 'top', 'left',
    ])
    expect(pages.every(page => page.assetLayout === 'single')).toBe(true)
  })

  it('uses same-chapter material images as a primary visual page supporting pair without reusing them elsewhere', () => {
    const base = reportWithProfessionalRun()
    const chapterId = base.chapters[1]!.id
    const supports = [1, 2].map(index => ({
      ...base.assets[0]!,
      assetId: `chapter-support-${index}`,
      role: 'material' as const,
      sourceKind: 'ai-concept' as const,
      chapterId,
      caption: `章节辅助图 ${index}`,
    }))
    const report: ClientReport = { ...base, assets: [...base.assets, ...supports] }
    const pages = planClientPages(report, 'html').pages.filter(page =>
      page.chapterId === chapterId && page.kind === 'visual-evidence')

    expect(pages[0]?.assetLayout).toBe('single')
    expect(pages[1]?.assetIds).toEqual(['professional-run-2', 'chapter-support-1', 'chapter-support-2'])
    expect(pages[1]?.assetLayout).toBe('hero-top-pair')
    expect(pages.slice(2).flatMap(page => page.assetIds)).not.toEqual(expect.arrayContaining(
      supports.map(asset => asset.assetId),
    ))
  })

  it('rejects HTML pages whose declared gallery layout does not match the image count', () => {
    const { report, chapterId } = reportWithAssetGroup(3)
    const base = planClientPages(report, 'html')
    const plan = {
      ...base,
      pages: base.pages.map(page => page.chapterId === chapterId && page.blockIndexes[0] === 0
        ? { ...page, assetLayout: 'grid-2x2' as const }
        : page),
    }

    expect(validateClientPagePlan(plan, report).map(row => row.code)).toContain('ASSET_LAYOUT_COUNT_INVALID')
  })

  it('keeps six professional assets in order while choosing readable role-aware PPTX layouts', () => {
    const report = reportWithProfessionalRun()
    const chapter = report.chapters[1]!
    const expectedAssetIds = chapter.blocks.map(block => block.type === 'evidence' ? block.assetIds : [])

    const plan = planClientPages(report, 'pptx')
    const visualPages = plan.pages.filter(page => page.chapterId === chapter.id && page.kind === 'visual-evidence')
    const variants = visualPages.map(page => page.layoutVariant)
    const repetitionCodes = validateClientPagePlan(plan, report)
      .filter(row => row.code === 'LAYOUT_REPETITION' || row.code === 'PAGE_KIND_REPETITION')
      .map(row => row.code)

    expect(visualPages).toHaveLength(6)
    expect(visualPages.map(page => page.assetIds)).toEqual(expectedAssetIds)
    expect(visualPages.map(page => page.primaryFocus)).toEqual(expectedAssetIds.map(assetIds => ({
      type: 'asset', assetId: assetIds[0],
    })))
    expect(repetitionCodes).toEqual([])
    expect(new Set(variants)).toEqual(new Set(['full-bleed', 'split', 'editorial']))
    expect(visualPages.filter(page => page.visualRole !== 'chart').every(page => page.layoutVariant !== 'split')).toBe(true)
    for (let index = 1; index < variants.length; index += 1) {
      expect(variants[index]).not.toBe(variants[index - 1])
    }
    for (let index = 2; index < variants.length; index += 1) {
      expect(new Set(variants.slice(index - 2, index + 1)).size).toBeGreaterThanOrEqual(2)
    }
  })

  it('exempts only a same-chapter run of distinct professional focus assets from page-kind repetition', () => {
    const run = professionalRunPages()
    const codes = validateClientPagePlan(planWithTrailingRun(run), VALIDATOR_REPORT).map(row => row.code)
    const repeatedLayoutCodes = validateClientPagePlan(planWithTrailingRun(
      run.map(page => ({ ...page, layoutVariant: 'editorial' as const })),
    ), VALIDATOR_REPORT).map(row => row.code)

    expect(codes).not.toContain('PAGE_KIND_REPETITION')
    expect(repeatedLayoutCodes).not.toContain('PAGE_KIND_REPETITION')
    expect(repeatedLayoutCodes).toContain('LAYOUT_REPETITION')
  })

  it('fails closed when a copied plan has no report asset context', () => {
    const codes = validateClientPagePlan(planWithTrailingRun(professionalRunPages())).map(row => row.code)

    expect(codes).toContain('PAGE_KIND_REPETITION')
  })

  it.each([
    ['repeated primary asset', (page: ClientPage) => ({
      ...page,
      primaryFocus: { type: 'asset' as const, assetId: 'validator-professional-1' },
      assetIds: ['validator-professional-1'],
    })],
    ['missing visual role', (page: ClientPage) => {
      const { visualRole: _visualRole, ...withoutVisualRole } = page
      return withoutVisualRole
    }],
    ['non-asset focus', (page: ClientPage) => ({
      ...page,
      primaryFocus: { type: 'claim' as const, statement: page.headline },
    })],
    ['focus asset outside own asset ids', (page: ClientPage) => ({
      ...page,
      primaryFocus: { type: 'asset' as const, assetId: `${page.pageId}-outside` },
    })],
    ['empty primary asset', (page: ClientPage) => ({
      ...page,
      primaryFocus: { type: 'asset' as const, assetId: '' },
    })],
    ['different chapters', (page: ClientPage, index: number) => ({
      ...page,
      chapterId: `validator-professional-chapter-${index + 1}`,
    })],
  ] satisfies readonly (readonly [string, (page: ClientPage, index: number) => ClientPage])[])(
    'rejects a visual-evidence run with %s',
    (_label, mutate) => {
      const codes = validateClientPagePlan(
        planWithTrailingRun(professionalRunPages().map(mutate)),
        VALIDATOR_REPORT,
      )
        .map(row => row.code)

      expect(codes).toContain('PAGE_KIND_REPETITION')
    },
  )

  it.each([
    ['ghost focus asset', (page: ClientPage) => ({
      ...page,
      primaryFocus: { type: 'asset' as const, assetId: 'validator-professional-ghost' },
      assetIds: ['validator-professional-ghost'],
    })],
    ['asset role mismatched with page visual role', (page: ClientPage) => ({
      ...page,
      visualRole: page.visualRole === 'map' ? 'chart' as const : page.visualRole,
    })],
  ] satisfies readonly (readonly [string, (page: ClientPage) => ClientPage])[])(
    'does not exempt a professional run with %s',
    (_label, mutate) => {
      const run = professionalRunPages().map((page, index) => index === 0 ? mutate(page) : page)
      const codes = validateClientPagePlan(planWithTrailingRun(run), VALIDATOR_REPORT).map(row => row.code)

      expect(codes).toContain('PAGE_KIND_REPETITION')
    },
  )

  it.each(['map', 'diagram'] as const)(
    'rejects an injected %s visual-evidence PPTX page that uses a split layout',
    role => {
      const run = professionalRunPages().map(page => page.visualRole === role
        ? { ...page, layoutVariant: 'split' as const }
        : page)
      const codes = validateClientPagePlan(planWithTrailingRun(run), VALIDATOR_REPORT).map(row => row.code)

      expect(codes).toContain('PROFESSIONAL_LAYOUT_ROLE_INVALID')
    },
  )

  it('keeps ordinary three-page kind repetition invalid', () => {
    const ordinaryRun = professionalRunPages().map((page, index) => {
      const { visualRole: _visualRole, ...ordinary } = page
      return {
        ...ordinary,
        pageId: `ordinary-repetition-${index + 1}`,
        kind: 'evidence' as const,
        primaryFocus: { type: 'claim' as const, statement: `普通内容 ${index + 1}` },
        assetIds: [],
      }
    })

    expect(validateClientPagePlan(planWithTrailingRun(ordinaryRun)).map(row => row.code))
      .toContain('PAGE_KIND_REPETITION')
  })

  it('keeps the product name when a product asset becomes a visual evidence page', () => {
    const product = {
      ...CLIENT_REPORT.products[0]!,
      productId: 'product-lakefront-west',
      name: '洋澜湖·缤纷西岸',
    }
    const mapAsset = {
      ...CLIENT_REPORT.assets[0]!,
      assetId: 'lakefront-masterplan',
      role: 'map' as const,
      chapterId: 'chapter-06',
      productId: product.productId,
      caption: '洋澜湖西岸滨湖空间总体布局',
    }
    const report: ClientReport = {
      ...CLIENT_REPORT,
      products: [...CLIENT_REPORT.products, product],
      assets: [...CLIENT_REPORT.assets, mapAsset],
      chapters: CLIENT_REPORT.chapters.map(chapter => chapter.id !== 'chapter-06'
        ? chapter
        : {
            ...chapter,
            blocks: [{
              type: 'product' as const,
              productId: product.productId,
              assetIds: [mapAsset.assetId],
            }, ...chapter.blocks.slice(1)],
          }),
    }

    const page = planClientPages(report, 'pptx').pages.find(candidate =>
      candidate.primaryFocus.type === 'asset' && candidate.primaryFocus.assetId === mapAsset.assetId)

    expect(page).toMatchObject({
      kind: 'visual-evidence',
      visualRole: 'map',
      headline: '洋澜湖·缤纷西岸',
    })
  })

  it('uses a concise spatial scene title while keeping the full dimension statement in the source block', () => {
    const sceneAsset = {
      ...CLIENT_REPORT.assets[0]!,
      assetId: 'spatial-scene',
      role: 'product-scene' as const,
      chapterId: 'chapter-07',
      caption: '洋澜湖西岸连续空间鸟瞰',
    }
    const report: ClientReport = {
      ...CLIENT_REPORT,
      assets: [...CLIENT_REPORT.assets, sceneAsset],
      chapters: CLIENT_REPORT.chapters.map(chapter => chapter.id !== 'chapter-07'
        ? chapter
        : {
            ...chapter,
            role: 'spatial' as const,
            blocks: [{
              type: 'evidence' as const,
              headline: '典型空间尺度：洋澜湖西岸滨水亲水典型剖面（3米亲水木栈道＋4米骑行绿道＋草坡驳岸）',
              evidenceIds: ['evidence-7'],
              assetIds: [sceneAsset.assetId],
            }],
          }),
    }

    const page = planClientPages(report, 'pptx').pages.find(candidate => candidate.assetIds.includes(sceneAsset.assetId))

    expect(page?.headline).toBe('洋澜湖西岸滨水剖面')
    expect(report.chapters.find(chapter => chapter.id === 'chapter-07')?.blocks[0]).toMatchObject({
      headline: '典型空间尺度：洋澜湖西岸滨水亲水典型剖面（3米亲水木栈道＋4米骑行绿道＋草坡驳岸）',
    })
  })

  it('keeps no-asset blocks out of full-bleed layouts while preserving their content treatment', () => {
    const report: ClientReport = {
      ...CLIENT_REPORT,
      chapters: CLIENT_REPORT.chapters.map(chapter => chapter.id !== 'chapter-07'
        ? chapter
        : {
            ...chapter,
            blocks: [{
              type: 'narrative' as const,
              statement: '没有图像时仍应突出项目判断。',
              evidenceIds: ['evidence-3'],
            }, {
              type: 'metric' as const,
              label: '连续开放界面', value: '一体化', unit: '空间系统', evidenceIds: ['evidence-7'],
            }, {
              type: 'timeline' as const,
              headline: '三阶段把共同判断转化为连续行动',
              phases: [{ phaseId: 'phase-1', name: '示范先行', actions: ['先行实施'], prerequisites: ['确认边界'] }],
              evidenceIds: ['evidence-11'],
            }, {
              type: 'investment' as const,
              headline: '首期投入优先保障公共空间与基础设施',
              items: [{ name: '公共空间', amount: '优先', unit: '投入序列', assumption: '首期示范' }],
              evidenceIds: ['evidence-12'],
            }],
          }),
    }

    const pages = planClientPages(report, 'pptx').pages.filter(page => page.chapterId === 'chapter-07' && page.blockIndexes.length > 0)

    expect(pages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        blockIndexes: [0], assetIds: [], layoutVariant: 'editorial',
        analyticalVisual: expect.objectContaining({ kind: 'spatial-sequence' }),
      }),
      expect.objectContaining({
        blockIndexes: [1], assetIds: [], layoutVariant: 'data',
        analyticalVisual: expect.objectContaining({ kind: 'spatial-system' }),
      }),
      expect.objectContaining({ blockIndexes: [2], assetIds: [], layoutVariant: 'timeline' }),
      expect.objectContaining({
        blockIndexes: [3], assetIds: [], layoutVariant: 'data',
        analyticalVisual: expect.objectContaining({ kind: 'investment-sequence' }),
      }),
    ]))
    expect(pages.every(page => page.layoutVariant !== 'full-bleed')).toBe(true)
  })

  it('plans analytical visuals for the urgency, operation, and decision pages that have no source image', () => {
    const report = createClientReportBundle(REPORT_INPUT, {
      ...CLIENT_PROFILE,
      chapters: CLIENT_PROFILE.chapters.map(chapter => chapter.id === 'chapter-08'
        ? {
            ...chapter,
            role: 'operation' as const,
            claim: '公共服务保底、主题内容引流、轻量经营补充运营。',
            blocks: [{
              type: 'narrative' as const,
              statement: '建设、内容策划和运营团队需要在首期同步介入。',
              evidenceIds: ['evidence-8'],
            }, {
              type: 'evidence' as const,
              headline: '多时段内容组合提升设施与空间使用效率',
              evidenceIds: ['evidence-9'], assetIds: [],
            }],
          }
        : chapter.id === 'chapter-10'
          ? {
              ...chapter,
              role: 'decision' as const,
              claim: '三项共同决策是进入概念深化与专题测算的前提。',
              blocks: [{
                type: 'narrative' as const,
                statement: '总体定位、首期边界与建设运营协同机制需要同步确定。',
                evidenceIds: ['evidence-10'],
              }, {
                type: 'evidence' as const,
                headline: '分期实施与运营前置共同降低项目不确定性',
                evidenceIds: ['evidence-11'], assetIds: [],
              }, ...chapter.blocks.slice(2)],
            }
          : chapter),
    }).report
    const pages = planClientPages(report, 'pptx').pages
    const visualKind = (pageId: string) => pages.find(page => page.pageId === pageId)?.analyticalVisual?.kind

    expect(visualKind('opening-urgency')).toBe('urgency-signals')
    expect(visualKind('chapter-08-block-01')).toBe('operating-model')
    expect(visualKind('chapter-08-block-02')).toBe('daypart-matrix')
    expect(pages.find(page => page.pageId === 'chapter-08-block-02')?.analyticalVisual).toMatchObject({
      kind: 'daypart-matrix',
      values: [
        ['高', '中', '低'],
        ['中', '高', '高'],
        ['中', '高', '高'],
      ],
    })
    expect(visualKind('chapter-10-block-01')).toBe('decision-triad')
    expect(visualKind('chapter-10-block-02')).toBe('decision-flow')
    const decisionDividerIndex = pages.findIndex(page => page.pageId === 'chapter-10-divider')
    const decisionNarrative = pages[decisionDividerIndex + 1]
    expect(decisionNarrative?.headline).toBe('同步确定定位、首期边界与协同机制')
    expect(decisionNarrative?.headline).not.toBe(pages[decisionDividerIndex]?.headline)
    expect(decisionNarrative?.analyticalVisual).toMatchObject({
      kind: 'decision-triad',
      items: [
        expect.objectContaining({ output: '形成定位结论' }),
        expect.objectContaining({ output: '形成首期边界图' }),
        expect.objectContaining({ output: '形成协同机制' }),
      ],
    })
  })

  it('rejects contract-enabled plans below 50 percent visual coverage or with three text-only content pages', () => {
    const base = planClientPages(CLIENT_REPORT, 'pptx')
    const textOnlyPages = ['one', 'two', 'three'].map((suffix, index) => ({
      ...base.pages.find(page => page.kind === 'evidence')!,
      pageId: `contract-text-${suffix}`,
      kind: (['evidence', 'opportunity', 'positioning'] as const)[index]!,
      layoutVariant: (['data', 'split', 'editorial'] as const)[index]!,
      assetIds: [],
      primaryFocus: { type: 'claim' as const, statement: `纯文字内容页 ${index + 1}` },
    }))
    const plan = {
      ...base,
      pages: [...base.pages, ...textOnlyPages],
      visualContractVersion: 'architectural-v1' as const,
    }

    expect(validateClientPagePlan(plan).map(row => row.code)).toEqual(expect.arrayContaining([
      'VISUAL_PAGE_COVERAGE_LOW',
      'TEXT_ONLY_RUN_TOO_LONG',
    ]))
  })

  it('assigns material concept backdrops only to HTML opening and chapter divider pages', () => {
    const materialAssets = Array.from({ length: 12 }, (_, index) => ({
      ...CLIENT_REPORT.assets[0]!,
      assetId: `material-backdrop-${index + 1}`,
      role: 'material' as const,
      chapterId: CLIENT_REPORT.chapters[index % CLIENT_REPORT.chapters.length]!.id,
      sourceKind: 'ai-concept' as const,
    }))
    const report: ClientReport = { ...CLIENT_REPORT, assets: [...CLIENT_REPORT.assets, ...materialAssets] }
    const htmlPlan = planClientPages(report, 'html')
    const pptxPlan = planClientPages(report, 'pptx')
    const backdropTargets = htmlPlan.pages.filter(page => page.pageId === 'opening-project'
      || page.pageId === 'opening-value'
      || page.kind === 'chapter-divider')

    expect(backdropTargets).toHaveLength(12)
    expect(backdropTargets.map(page => page.backdropAssetId)).toEqual(materialAssets.map(asset => asset.assetId))
    expect(new Set(backdropTargets.map(page => page.backdropAssetId))).toHaveLength(12)
    expect(htmlPlan.pages.filter(page => !backdropTargets.includes(page)).every(page => page.backdropAssetId === undefined)).toBe(true)
    expect(pptxPlan.pages.every(page => page.backdropAssetId === undefined)).toBe(true)
  })

  it('reuses a related chapter asset or hero when material concept backdrops are scarce', () => {
    const material = {
      ...CLIENT_REPORT.assets[0]!, assetId: 'only-material', role: 'material' as const, sourceKind: 'ai-concept' as const,
    }
    const hero = (assetId: string) => ({ ...CLIENT_REPORT.assets[0]!, assetId, role: 'hero' as const })
    const related = (assetId: string, chapterId: string) => ({
      ...CLIENT_REPORT.assets[0]!, assetId, chapterId, role: 'product-scene' as const,
    })
    const report: ClientReport = {
      ...CLIENT_REPORT,
      assets: [
        material,
        hero('fallback-hero-1'),
        hero('fallback-hero-2'),
        related('chapter-01-support', 'chapter-01'),
        related('chapter-02-support', 'chapter-02'),
      ],
    }
    const targets = planClientPages(report, 'html').pages.filter(page => page.pageId === 'opening-project'
      || page.pageId === 'opening-value' || page.kind === 'chapter-divider')

    expect(targets.slice(0, 5).map(page => page.backdropAssetId)).toEqual([
      'only-material',
      'fallback-hero-1',
      'chapter-01-support',
      'chapter-02-support',
      'fallback-hero-2',
    ])
    expect(targets.every(page => page.backdropAssetId !== undefined)).toBe(true)
    expect(targets.filter(page => page.backdropAssetId === 'only-material')).toHaveLength(1)
    expect(targets[5]?.backdropAssetId).toBe('fallback-hero-1')
  })

  it('rejects an architectural HTML plan with more than two or consecutive text-only pages', () => {
    const base = planClientPages(CLIENT_REPORT, 'html')
    const source = base.pages.find(page => page.kind === 'evidence')!
    const { analyticalVisual: _analyticalVisual, ...textOnlySource } = source
    const textOnlyPages = ['one', 'two', 'three'].map((suffix, index) => ({
      ...textOnlySource,
      pageId: `html-text-${suffix}`,
      headline: `HTML 纯文字页 ${index + 1}`,
      assetIds: [],
    }))
    const plan: ClientPagePlan = {
      ...base,
      pages: [...base.pages, ...textOnlyPages],
      visualContractVersion: 'architectural-v1',
    }

    expect(validateClientPagePlan(plan).map(row => row.code)).toEqual(expect.arrayContaining([
      'TEXT_ONLY_PAGE_COUNT_EXCEEDED',
      'TEXT_ONLY_PAGES_CONSECUTIVE',
    ]))
  })
})
