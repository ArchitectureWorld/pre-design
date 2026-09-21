import { describe, expect, it } from 'vitest'
import { planRegularManuscriptPage, regularCover } from '../src/report/regular/layout.ts'
import { summarizeReportPage } from '../src/report/manuscript/report-story.ts'
import { allowsAnalyticalTableText, allowsAnalyticalSourceText } from '../src/report/regular/analytical-table.ts'
import type { PlanningManuscriptPage } from '../src/report/manuscript/types.ts'
import type { ClientVisualAsset } from '../src/report/client-types.ts'

const page: PlanningManuscriptPage = { id: 'tea-walk', kind: 'argument', title: '茶园漫游', claim: '以步行连接茶园与休息场所。', body: ['保留原有生产路径，设置连续的步行体验。'.repeat(32)], sourceRefs: ['s1'], notes: [], visual: { kind: 'concept', subject: '茶园', purpose: '游览', caption: '茶园漫游' } }
const assets = (count: number): ClientVisualAsset[] => Array.from({ length: count }, (_, i) => ({ assetId: `a${i}`, role: 'product-scene', chapterId: 'c', caption: '茶园', sourceKind: 'ai-concept', sourcePath: 'test.png', sha256: String(i + 1).padStart(64, '0'), width: 900, height: 1800, disclosure: '概念示意' }))
const concisePage: PlanningManuscriptPage = { ...page, body: ['游客在窗边的桌椅旁休息，沿湖游线继续游览。'] }

describe('analytical table continuations', () => {
  const financial: PlanningManuscriptPage = { ...page, id: 'funding-analysis', kind: 'financial', editorialSummary: true,
    title: '持续运营与资金安排', claim: '按年度核算投入与经营现金流。', body: [],
    visual: { kind: 'none', subject: '财务核算', purpose: '核算资金', caption: '资金安排' },
    table: { columns: ['核算项目', '计算关系', '用途'], rows: Array.from({ length: 12 }, (_, index) => [
      ['持续运营支出', '税费与融资', '年度现金流', '投资回收'][index % 4]!,
      '按实际业务收入、支出和有效资金安排分年核算，比较正常经营与暂停营业的资金需求。',
      '形成年度资金计划，测算固定成本、变动成本和周转资金。',
    ]) } }

  it('keeps photo-free financial table continuations intentional without inventing a scene', () => {
    const parts = planRegularManuscriptPage(financial, '实施运营', assets(1), 0)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts[0]!.layout.media).toHaveLength(1)
    expect(parts.slice(1).every(part => part.layout.media.length === 0)).toBe(true)
    expect(parts.slice(1).flatMap(part => part.layout.materialGaps ?? [])).toEqual([])
    expect(parts.flatMap(part => part.content.table?.rows ?? [])).toEqual(financial.table!.rows)
  })

  it('still requires the first image and spatial/table scene continuations', () => {
    const first = planRegularManuscriptPage(financial, '实施运营', [], 0)[0]!
    expect(first.layout.materialGaps).toHaveLength(1)
    const spatial = { ...financial, table: { ...financial.table!, rows: financial.table!.rows.map(row => ['滨水步道', ...row.slice(1)]) } }
    const parts = planRegularManuscriptPage(spatial, '空间布局', assets(1), 0)
    expect(parts.slice(1).every(part => part.layout.materialGaps?.length === 1)).toBe(true)
  })
})

describe('financial narrative continuations', () => {
  it('keeps purely financial prose and estimates with their table instead of demanding an invented scene', () => {
    const analytical: PlanningManuscriptPage = { ...page, id: 'investment-analysis', kind: 'financial', editorialSummary: true,
      title: '投资估算', claim: '按各项费用核算总投资。',
      body: Array.from({ length: 8 }, () => '工程部分按工程量与单价估算，设备部分结合规格和询价，总投资由各项费用汇总。'),
      table: { columns: ['项目', '计算关系', '用途'], rows: Array.from({ length: 10 }, (_, index) => index % 2
        ? ['外围新增活动', '按价格和成本独立测算；条件明确后实施。', '不纳入首期收入预测。']
        : ['工程建设其他费用与预备费用', '按适用编制依据分别计列。', '建设投资合计按各项费用汇总。']) },
    }
    const parts = planRegularManuscriptPage(analytical, '投资运营', assets(1), 0)
    expect(parts[0]!.layout.media).toHaveLength(1)
    expect(parts.slice(1).some(part => part.content.body.length > 0)).toBe(true)
    expect(parts.slice(1).flatMap(part => part.layout.materialGaps ?? [])).toEqual([])
    expect(parts.slice(1).every(part => part.layout.intentionalTextOnly === 'financial-table')).toBe(true)
    expect(parts.flatMap(part => part.content.body).join('')).toBe(analytical.body.join(''))
    expect(parts.flatMap(part => part.content.table?.rows ?? [])).toEqual(analytical.table!.rows)
  })

  it('does not exempt a financial row that describes an actual activity or a facility', () => {
    for (const subject of ['采摘体验', '零售商店', '滨水步道', '餐饮空间', '茶园漫游', '品茶', '旧茶厂新增体验']) {
      const related: PlanningManuscriptPage = { ...page, id: 'revenue-analysis', kind: 'financial', editorialSummary: true,
        title: '收入测算', claim: '按产品价格与参与人次测算收入。', body: [],
        table: { columns: ['核算项目', '计算关系', '用途'], rows: Array.from({ length: 12 }, () => [
          '经营收入', `${subject}按参与人次和价格测算收入，分别核算经营成本。`, '形成年度资金计划，测算固定成本、变动成本和周转资金。',
        ]) } }
      const parts = planRegularManuscriptPage(related, '产品经营', assets(1), 0)
      expect(parts.slice(1).every(part => part.layout.materialGaps?.length === 1)).toBe(true)
    }
  })
  it('does not treat an operating phase or a responsibilities row as financial analysis just because one cell mentions money', () => {
    expect(allowsAnalyticalTableText([], [['首期运营', '服务内容同步成组，核算资金需求。']])).toBe(false)
    expect(allowsAnalyticalTableText([], [['主体分工', '各方按协议分配收益。']])).toBe(false)
  })
  it('uses complete cached table rows in column order and preserves concrete scene requirements on resume', () => {
    const sources = [{ path: 'table.rows[0][1]', text: '按成本与价格核算。' }, { path: 'table.rows[0][0]', text: '经营收入' }]
    expect(allowsAnalyticalSourceText(sources)).toBe(true)
    expect(allowsAnalyticalSourceText([...sources, { path: 'table.rows[0][2]', text: '茶园漫游、品茶和采购形成完整游程。' }])).toBe(false)
    expect(allowsAnalyticalSourceText([{ path: 'table.rows[0][1]', text: '按成本核算。' }])).toBe(false)
  })
})

const withTemplate = (input: PlanningManuscriptPage, preferredTemplate: NonNullable<PlanningManuscriptPage['task']>['preferredTemplate'], imageCount?: number): PlanningManuscriptPage => ({ ...input,
  task: { kind: 'scene', question: '怎样组织公共空间？', scale: 'scene', requiredEvidence: ['公共活动场景'], preferredTemplate, ...(imageCount ? { imageCount } : {}) } })

describe('regular client physical pages', () => {
  it('retains every body character and shows each compatible planned image once with stable continuation slots', () => {
    const parts = planRegularManuscriptPage(page, '产品体系', assets(1), 0)
    expect(parts.map(p => p.content.body.join('')).join('')).toBe(page.body.join(''))
    expect(parts.flatMap(p => p.layout.media.map(a => a.assetId))).toEqual(['a0'])
    expect(parts.slice(1).every(p => p.layout.imageSlots?.length === 1 && p.layout.materialGaps?.length === 1)).toBe(true)
    expect(parts).toHaveLength(planRegularManuscriptPage(page, '产品体系', [], 0).length)
  })
  it('supports explicit photo compositions and reserves a third and fourth image before acquisition', () => {
    const templates = ['split-left', 'split-right', 'split-top', 'split-bottom', 'full-background'] as const
    const modes = templates.map(template => planRegularManuscriptPage(withTemplate(concisePage, template), '产品', [], 0)[0]!.layout.mode)
    expect(modes).toEqual(['left', 'right', 'top', 'bottom', 'background'])
    for (const template of ['array-horizontal', 'array-vertical'] as const) {
      const input = withTemplate(concisePage, template, 4), photos = assets(4).map(asset => ({ ...asset, width: template === 'array-horizontal' ? 800 : 3200, height: 900 }))
      const parts = planRegularManuscriptPage(input, '产品', photos, 0)
      expect(parts).toHaveLength(1)
      expect(parts.flatMap(p => p.layout.media.map(a => a.assetId))).toEqual(['a0', 'a1', 'a2', 'a3'])
      expect(parts[0]!.layout.mode).toBe(template === 'array-horizontal' ? 'row' : 'column')
    }
  })
  it('gives an analysis its own large area, keeps prose and does not duplicate the drawing', () => {
    const p = { ...page, visual: { ...page.visual, kind: 'diagram' as const } }
    const parts = planRegularManuscriptPage(p, '空间组织', assets(1).map(a => ({ ...a, role: 'diagram' as const })), 0)
    expect(parts[0]!.layout.mode).toBe('diagram')
    expect(parts[0]!.layout.media[0]!.fit).toBe('contain')
    expect(parts[0]!.layout.media[0]!.box.w).toBeGreaterThan(9)
    expect(parts.map(p => p.content.body.join('')).join('')).toBe(page.body.join(''))
    expect(parts.flatMap(part => part.layout.media)).toHaveLength(1)
  })
  it('bounds every text/media rectangle and uses a 16:9 canvas', () => {
    const layouts = [regularCover('少潭河前期策划', '茶园与湖岸的日间休闲目的地', { ...assets(1)[0]!, width: 1600, height: 900 }), ...planRegularManuscriptPage(page, '产品', assets(3), 0).map(p => p.layout)]
    for (const layout of layouts) for (const item of [...layout.texts, ...layout.media]) {
      expect(item.box.x).toBeGreaterThanOrEqual(0); expect(item.box.y).toBeGreaterThanOrEqual(0)
      expect(item.box.x + item.box.w).toBeLessThanOrEqual(13.333334)
      expect(item.box.y + item.box.h).toBeLessThanOrEqual(7.5)
    }
  })
})

describe.each([
  { path: 'original manuscript', input: concisePage },
  { path: 'editorial summary', input: summarizeReportPage(concisePage) },
])('single photograph composition in $path', ({ input }) => {
  it.each(['split-left', 'split-right'] as const)('keeps the complete portrait at both vertical edges in the explicit %s template', template => {
    const asset = { ...assets(1)[0]!, width: 960, height: 1440 }, source = withTemplate(input, template)
    const parts = planRegularManuscriptPage(source, '休憩场所', [asset], 4)
    expect(parts).toHaveLength(1)
    const layout = parts[0]!.layout, image = layout.media[0]!
    expect(['left', 'right']).toContain(layout.mode)
    expect(layout.shade).toBeUndefined()
    expect(layout.media).toHaveLength(1)
    expect(image.assetId).toBe(asset.assetId)
    expect(image.fit).toBe('contain')
    expect(image.box.y).toBe(0)
    expect(image.box.h).toBe(7.5)
    expect(asset.height * Math.min(image.box.w / asset.width, image.box.h / asset.height)).toBeCloseTo(7.5, 6)
    expect(parts.flatMap(part => part.content.body).join('')).toBe(input.body.join(''))
    for (const item of layout.texts) {
      if (layout.mode === 'left') expect(item.box.x).toBeGreaterThanOrEqual(image.box.x + image.box.w)
      else expect(item.box.x + item.box.w).toBeLessThanOrEqual(image.box.x)
    }
  })
  it('keeps an unreviewed near-square image out of an incompatible narrow slot without changing copy or page count', () => {
    const asset = { ...assets(1)[0]!, width: 900, height: 960 }, source = withTemplate(input, 'split-left')
    const [part] = planRegularManuscriptPage(source, '休憩场所', [asset], 4)
    expect(part!.layout.media).toEqual([])
    expect(part!.layout.materialGaps?.[0]?.reason).toBe('incompatible-image-slot')
    expect(part!.content.body).toEqual(input.body)
  })
  it('chooses the same template for the same task at every page position', () => {
    const source = withTemplate(input, 'full-background'), photo = { ...assets(1)[0]!, width: 1600, height: 900 }
    for (let ordinal = 0; ordinal < 5; ordinal++) {
      const layout = planRegularManuscriptPage(source, '休憩场所', [photo], ordinal)[0]!.layout
      expect(layout.mode).toBe('background')
      expect(layout.media[0]!.fit).toBe('contain')
    }
  })
  it.each([
    { label: 'missing dimensions', dimensions: { width: undefined, height: undefined } },
    { label: 'missing width', dimensions: { width: undefined, height: 1440 } },
    { label: 'missing height', dimensions: { width: 960, height: undefined } },
    { label: 'zero width', dimensions: { width: 0, height: 1440 } },
    { label: 'negative width', dimensions: { width: -960, height: 1440 } },
    { label: 'NaN width', dimensions: { width: Number.NaN, height: 1440 } },
    { label: 'infinite height', dimensions: { width: 960, height: Number.POSITIVE_INFINITY } },
    { label: 'nonnumeric width', dimensions: { width: '960', height: 1440 } },
  ])('retains the stable background slot and an explicit material gap for $label', ({ dimensions }) => {
    const asset = { ...assets(1)[0]!, ...dimensions } as ClientVisualAsset
    const layout = planRegularManuscriptPage(withTemplate(input, 'full-background'), '休憩场所', [asset], 4)[0]!.layout
    expect(layout.mode).toBe('background')
    expect(layout.media).toEqual([])
    expect(layout.imageSlots![0]!.box).toEqual({ x: 0, y: 0, w: 13.333333, h: 7.5 })
    expect(layout.materialGaps?.[0]?.reason).toBe('incompatible-image-slot')
  })
  it.each(['diagram', 'map', 'chart'] as const)('preserves the large contained %s composition', role => {
    const asset = { ...assets(1)[0]!, role, width: 960, height: 1440 }
    const p = { ...input, visual: { ...input.visual, kind: 'diagram' as const } }
    const layout = planRegularManuscriptPage(p, '空间组织', [asset], 4)[0]!.layout
    expect(layout.mode).toBe('diagram')
    expect(layout.media[0]!.fit).toBe('contain')
    expect(layout.media[0]!.box.w).toBeGreaterThan(9)
    expect(layout.shade).toBeUndefined()
  })
})