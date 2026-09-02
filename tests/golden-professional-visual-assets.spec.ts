import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ClientChartTopic } from '../src/report/client-types.ts'

const PRODUCT_VALUE_TOPIC = 'product-value' satisfies ClientChartTopic
const EXPECTED_EVIDENCE_STATEMENTS = {
  'evidence-1': '项目目标覆盖公共文化、生态水岸与城市生活三类价值。',
  'evidence-2': '现有资源需要通过连续公共界面建立整体识别。',
  'evidence-3': '门户、文化核心与水岸之间仍缺少连续步行体验。',
  'evidence-4': '公共活动与日常使用尚未形成稳定的时段组合。',
  'evidence-5': '高识别门户能够提升首访吸引力并组织后续游线。',
  'evidence-6': '弹性公共空间能够兼容日常休闲与主题活动。',
  'evidence-7': '连续慢行与开放空间是滨水公共价值实现的重要载体。',
  'evidence-8': '公共服务与轻量经营可以共享客流和空间基础设施。',
  'evidence-9': '家庭、青年与社区居民对全天候共享场景具有重叠需求。',
  'evidence-10': '生态设施应与公共空间和景观体验一体设计。',
  'evidence-11': '示范先行有利于在扩大建设前验证空间与运营模型。',
  'evidence-12': '示范先行、骨架成网与场景扩展的示例投资分别为 1200、2800、4500 万元。',
} as const

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom') as {
  JSDOM: new (source: string, options: { contentType: 'image/svg+xml' }) => {
    window: { document: Document }
  }
}

interface DatumContract {
  category: string
  value: number
  unit: string
  directLabel: string
  series?: string
}

interface ChartContract {
  id: string
  chartTopic: ClientChartTopic
  chartType?: 'bar' | 'dot'
  title: string
  dataSource: string
  unit: string
  methodology: string
  upperBound?: number
  axisTicks?: number[]
  stages?: string[]
  series?: Array<{ id: string; name: string; color: string }>
  visualEncoding?: string
  areaScale?: number
  sizeLegend?: number[]
  data: DatumContract[]
}

interface MapContract {
  id: string
  title: string
  dataSource: string
  scale: string
  northLabel: string
  routes: Array<{
    id: string
    name: string
    color: string
    strokeWidth: number
    dashArray: string
  }>
}

interface ProfessionalVisualData {
  disclosure: string
  canvas: { width: number; height: number; viewBox: string }
  evidenceSources: Array<{ evidenceId: string; sourceLabel: string; statement: string }>
  charts: ChartContract[]
  map: MapContract
}

interface ManifestAsset {
  assetId: string
  file: string
  sha256: string
  width?: number
  height?: number
  caption: string
}

interface AssetBinding {
  assetId: string
  chartTopic?: ClientChartTopic
  sha256?: string
  width?: number
  height?: number
  provenance?: { sourceLabel?: string; locator?: string; sourceFileSha256?: string }
  chartContract?: { unit?: string; methodology?: string }
}

interface ClientProfile {
  evidence: Array<{ evidenceId: string; sourceLabel: string; statement: string }>
  chapters: Array<{
    id: string
    blocks: Array<{ type?: string; evidenceIds?: string[]; assetIds?: string[] }>
  }>
  assetBindings: AssetBinding[]
}

const REQUIRED_MAP_LABELS = {
  'map-regional': ['示例城市中心方向', '示例滨水联系轴', '研究范围中心', '城市主干路'],
  'map-boundary': ['研究范围（待核）', '滨水开放界面', '公共文化节点', '社区入口'],
  'map-existing': ['存量建筑', '公共服务', '开放空间', '空间断点'],
  'map-access': ['城市主干路', '公交到达', '主要入口', '滨水步道'],
  'map-circulation': ['文化场馆', '共享草坪', '滨水界面', '后勤入口'],
  'map-constraints': ['滨水生态资源', '噪声影响带', '建设退界', '保留建筑', '易涝关注区'],
} as const

const REQUIRED_DATA_CHART_IDS = [
  'chart-existing',
  'chart-audience',
  'chart-access',
  'chart-operation',
  'chart-phasing',
  'chart-value',
] as const

const fixtureRoot = fileURLToPath(new URL('./fixtures/golden-project/', import.meta.url))

async function jsonFixture<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(fixtureRoot, name), 'utf8')) as T
}

async function svgDocument(assetId: string): Promise<{ bytes: Buffer; document: Document }> {
  const bytes = await readFile(join(fixtureRoot, 'assets', `${assetId}.svg`))
  const dom = new JSDOM(bytes.toString('utf8'), { contentType: 'image/svg+xml' })
  return { bytes, document: dom.window.document }
}

function expectVisibleText(node: Element | null, expected: string): void {
  expect(node, `缺少可见文本“${expected}”`).not.toBeNull()
  expect(node?.textContent?.trim()).toBe(expected)
  expect(node?.getAttribute('display')).not.toBe('none')
  expect(node?.getAttribute('visibility')).not.toBe('hidden')
  expect(node?.getAttribute('opacity')).not.toBe('0')
}

function expectSvgFrame(document: Document, title: string, source: string, data: ProfessionalVisualData): void {
  const svg = document.documentElement
  expect(svg.localName).toBe('svg')
  expect(svg.getAttribute('width')).toBe(String(data.canvas.width))
  expect(svg.getAttribute('height')).toBe(String(data.canvas.height))
  expect(svg.getAttribute('viewBox')).toBe(data.canvas.viewBox)
  expect(svg.getAttribute('data-source')).toBe(source)
  expectVisibleText(svg.querySelector('title'), title)
  expect(svg.querySelector('desc')?.textContent).toContain(data.disclosure)
  expectVisibleText(svg.querySelector('.source-note'), data.disclosure)
}

function translatedPoint(node: Element, x: number, y: number): { x: number; y: number } {
  let current: Element | null = node
  let translatedX = x
  let translatedY = y
  while (current !== null) {
    const transform = current.getAttribute('transform')
    const match = transform?.match(/^translate\(\s*(-?\d+(?:\.\d+)?)\s*(?:,|\s)\s*(-?\d+(?:\.\d+)?)\s*\)$/u)
    if (match !== undefined && match !== null) {
      translatedX += Number(match[1])
      translatedY += Number(match[2])
    }
    current = current.parentElement
  }
  return { x: translatedX, y: translatedY }
}

function numericAttribute(node: Element, name: string): number {
  const value = Number(node.getAttribute(name))
  expect(Number.isFinite(value), `${node.localName}.${name} 不是有限数值`).toBe(true)
  return value
}

describe('Golden 专业图表与流线图可核验合同', () => {
  it('真实夹具保留至少六张有效数据图表、四类独立主题与六个必需图表 ID', async () => {
    const data = await jsonFixture<ProfessionalVisualData>('professional-visual-data.json')
    const validCharts = data.charts.filter(chart => chart.id.trim() !== ''
      && chart.title.trim() !== ''
      && chart.dataSource.trim() !== ''
      && chart.methodology.trim() !== ''
      && chart.unit.trim() !== ''
      && chart.data.length > 0
      && chart.data.every(datum => datum.category.trim() !== ''
        && Number.isFinite(datum.value)
        && datum.unit.trim() !== ''
        && datum.directLabel.trim() !== ''))
    const validIds = validCharts.map(chart => chart.id)

    expect(validCharts.length, '有效数据图表不得少于 6 张').toBeGreaterThanOrEqual(6)
    expect(new Set(validCharts.map(chart => chart.chartTopic)).size, '独立 chartTopic 不得少于 4 类')
      .toBeGreaterThanOrEqual(4)
    expect(validIds, '缺少当前六个必需数据图表').toEqual(expect.arrayContaining([...REQUIRED_DATA_CHART_IDS]))
    for (const id of REQUIRED_DATA_CHART_IDS) {
      expect(validIds.filter(candidate => candidate === id), `${id} 必须且只能存在一张有效图表`).toHaveLength(1)
    }
  })

  it('十二条 evidence 使用客户可读来源标签并遵守固定 statement 合同', async () => {
    const data = await jsonFixture<ProfessionalVisualData>('professional-visual-data.json')
    const profile = await jsonFixture<ClientProfile>('client-profile.json')
    expect(data.evidenceSources).toHaveLength(12)
    expect(Object.keys(EXPECTED_EVIDENCE_STATEMENTS)).toHaveLength(12)

    for (const expected of data.evidenceSources) {
      const rows = profile.evidence.filter(row => row.evidenceId === expected.evidenceId)
      const statement = EXPECTED_EVIDENCE_STATEMENTS[expected.evidenceId as keyof typeof EXPECTED_EVIDENCE_STATEMENTS]
      expect(rows, `${expected.evidenceId} 记录不唯一`).toHaveLength(1)
      expect(statement, `${expected.evidenceId} 缺少手工 statement 期望`).toBeDefined()
      expect(expected.statement).toBe(statement)
      expect(rows[0]).toMatchObject({ evidenceId: expected.evidenceId, sourceLabel: expected.sourceLabel, statement })
      expect(rows[0]!.sourceLabel).toContain('待项目实测校核')
      expect(JSON.stringify(rows[0])).not.toMatch(/工程夹具|工程冻结/u)
    }
  })

  it('为七项 SVG 提供 1200×700、可访问元数据和客户可读研究来源', async () => {
    const data = await jsonFixture<ProfessionalVisualData>('professional-visual-data.json')
    expect(data.disclosure).toBe('示例研究数据（待项目实测校核）')

    for (const asset of [...data.charts, data.map]) {
      const { document } = await svgDocument(asset.id)
      expectSvgFrame(document, asset.title, asset.dataSource, data)
    }
  })

  it('五张场地分析图使用统一客户来源，范围图保留研究声明', async () => {
    const manifest = await jsonFixture<{ assets: ManifestAsset[] }>('evidence-manifest.json')
    const profile = await jsonFixture<ClientProfile>('client-profile.json')
    const sourceLabel = '示例场地分析资料（待项目实测校核）'
    const mapLocators = {
      'map-regional': '城市区位',
      'map-boundary': '研究范围',
      'map-existing': '现状分布',
      'map-access': '交通可达',
      'map-circulation': '内部流线',
      'map-constraints': '资源限制',
    } as const

    for (const [assetId, locator] of Object.entries(mapLocators)) {
      const binding = profile.assetBindings.find(row => row.assetId === assetId)
      expect(binding, `client-profile 缺少 ${assetId} binding`).toBeDefined()
      if (assetId !== 'map-circulation') expect(binding?.provenance?.sourceLabel).toBe(sourceLabel)
      expect(binding?.provenance?.locator).toBe(locator)
    }

    const boundary = profile.assetBindings.find(row => row.assetId === 'map-boundary')
    const boundaryManifest = manifest.assets.find(row => row.assetId === 'map-boundary')
    const { document } = await svgDocument('map-boundary')
    const visibleText = document.documentElement.textContent ?? ''
    expect(boundary?.provenance?.locator).toBe('研究范围')
    expect(boundaryManifest?.caption).toBe('示例研究范围图')
    expect(visibleText).toContain('示例研究范围图')
    expect(visibleText).toContain('研究范围（待核）')
    expect(visibleText).toContain('非法定红线')
    expect(visibleText).toContain('非测绘成果')
    expect(visibleText).not.toMatch(/工程夹具|工程冻结/u)
    for (const assetId of ['map-boundary', 'map-existing']) {
      const scaleDocument = assetId === 'map-boundary' ? document : (await svgDocument(assetId)).document
      const scaleBar = scaleDocument.querySelector('#scale-bar')
      expect(scaleBar, `${assetId} 缺少可见比例尺分段`).not.toBeNull()
      expect(scaleBar?.querySelectorAll('line').length, `${assetId} 比例尺缺少分段与刻度`).toBeGreaterThanOrEqual(5)
      expect(scaleBar?.textContent).toContain('0')
      expect(scaleBar?.textContent).toContain('50')
      expect(scaleBar?.textContent).toContain('100m')
    }
    const regionalText = (await svgDocument('map-regional')).document.documentElement.textContent ?? ''
    const existingText = (await svgDocument('map-existing')).document.documentElement.textContent ?? ''
    for (const label of ['示例城市中心方向', '示例滨水联系轴', '研究范围中心']) expect(regionalText).toContain(label)
    for (const label of ['存量建筑', '公共服务', '开放空间']) expect(existingText).toContain(label)
  })

  it('六张场地分析图以真实线样或色块提供可直接解码的图例', async () => {
    for (const assetId of Object.keys(REQUIRED_MAP_LABELS)) {
      const { document } = await svgDocument(assetId)
      const legend = document.querySelector('.map-legend, .route-legend')
      expect(legend, `${assetId} 缺少结构化图例`).not.toBeNull()
      const items = [...(legend?.querySelectorAll('.legend-item') ?? [])]
      expect(items.length, `${assetId} 的图例项不足`).toBeGreaterThanOrEqual(3)

      for (const item of items) {
        const swatch = item.querySelector('[data-swatch]')
        const label = item.querySelector('text')
        expect(swatch, `${assetId} 图例项缺少线样或色块`).not.toBeNull()
        expect(label?.textContent?.trim(), `${assetId} 图例项缺少可读名称`).not.toBe('')
        const hasVisiblePaint = [swatch?.getAttribute('fill'), swatch?.getAttribute('stroke')]
          .some(value => value !== null && value !== '' && value !== 'none' && value !== 'transparent')
        expect(hasVisiblePaint, `${assetId} 图例样本不可见`).toBe(true)
      }
    }
  })

  it('地图图例与北向标之间保留清晰留白', async () => {
    const translatedY = (node: Element): number => Number(
      /translate\(\s*[-\d.]+(?:[ ,]+)([-\d.]+)\s*\)/u.exec(node.getAttribute('transform') ?? '')?.[1] ?? 0,
    )
    for (const assetId of ['map-boundary', 'map-existing']) {
      const { document } = await svgDocument(assetId)
      const legend = document.querySelector('.map-legend')!
      const finalItem = [...legend.querySelectorAll('.legend-item')].at(-1)!
      const finalLabel = finalItem.querySelector('text')!
      const northArrow = document.querySelector('#north-arrow')!
      const northLabel = northArrow.querySelector('.north-label')!
      const finalLegendBaseline = translatedY(legend) + translatedY(finalItem) + Number(finalLabel.getAttribute('y') ?? 0)
      const northBaseline = translatedY(northArrow) + Number(northLabel.getAttribute('y') ?? 0)
      expect(northBaseline - finalLegendBaseline, `${assetId} 的末项图例与北向标过近`).toBeGreaterThanOrEqual(32)
    }
  })

  it('六张场地分析图在图内标注支撑判断的空间对象', async () => {
    for (const [assetId, requiredLabels] of Object.entries(REQUIRED_MAP_LABELS)) {
      const { document } = await svgDocument(assetId)
      const labels = [...document.querySelectorAll('.feature-label[data-feature]')]
      const labelText = labels.map(node => node.textContent?.trim())
      const featureIds = labels.map(node => node.getAttribute('data-feature'))
      expect(labels.length, `${assetId} 的图内空间标签不足`).toBeGreaterThanOrEqual(requiredLabels.length)
      expect(new Set(featureIds).size, `${assetId} 的图内标签 feature id 不唯一`).toBe(labels.length)
      expect(labelText, `${assetId} 缺少必要空间对象标签`).toEqual(expect.arrayContaining([...requiredLabels]))
      for (const label of labels) expect(label.getAttribute('visibility')).not.toBe('hidden')
    }
  })

  it('六张场地分析图的空间标签不使用 PowerPoint 会覆盖字面的粗文本描边', async () => {
    for (const assetId of Object.keys(REQUIRED_MAP_LABELS)) {
      const { bytes } = await svgDocument(assetId)
      const featureLabelRule = /\.feature-label\s*\{([^}]*)\}/u.exec(bytes.toString('utf8'))?.[1]
      expect(featureLabelRule, `${assetId} 缺少 feature-label 样式`).toBeDefined()
      expect(featureLabelRule, `${assetId} 的标签必须显式关闭文本描边`).toMatch(/stroke:\s*none/u)
      expect(featureLabelRule, `${assetId} 不得依赖 PowerPoint 不支持的 stroke-first 绘制顺序`)
        .not.toMatch(/paint-order:\s*stroke/u)
    }
  })

  it('客群与时段离散场景使用独立柱状标记而不是连续趋势线', async () => {
    const data = await jsonFixture<ProfessionalVisualData>('professional-visual-data.json')
    const audience = data.charts.find(chart => chart.id === 'chart-audience')!
    const { document } = await svgDocument(audience.id)
    expect(audience.chartType).toBe('bar')
    expect(document.documentElement.getAttribute('data-chart-kind')).toBe('bar')
    expect(document.querySelectorAll('.datum [data-mark="bar"]')).toHaveLength(audience.data.length)
    expect(document.querySelectorAll('.trend-line, .trend-area, [data-continuous-series]')).toHaveLength(0)
  })

  it('决策前置页以实施验证证据支撑首期边界与协同机制', async () => {
    const profile = await jsonFixture<ClientProfile>('client-profile.json')
    const decisionChapter = profile.chapters.find(chapter => chapter.id === 'chapter-10')!
    const decisionPrelude = decisionChapter.blocks.find(block => block.type === 'narrative')!
    expect(decisionPrelude.evidenceIds).toEqual(['evidence-11'])
  })

  it('由独立数据合同逐项核对六张图表的语义 datum、直接数值与量轴', async () => {
    const data = await jsonFixture<ProfessionalVisualData>('professional-visual-data.json')

    for (const chart of data.charts) {
      const { document } = await svgDocument(chart.id)
      const nodes = [...document.querySelectorAll('.datum[data-category][data-value][data-unit]')]
      expect(nodes, `${chart.id} 的 datum 数量错误`).toHaveLength(chart.data.length)

      for (const expected of chart.data) {
        const matches = nodes.filter(node =>
          node.getAttribute('data-category') === expected.category
          && node.getAttribute('data-value') === String(expected.value)
          && node.getAttribute('data-unit') === expected.unit
          && node.getAttribute('data-series') === (expected.series ?? null))
        expect(matches, `${chart.id} 缺少独立 datum：${expected.directLabel}`).toHaveLength(1)
        expectVisibleText(matches[0]!.querySelector('.datum-label'), expected.directLabel)
      }

      if (chart.id === 'chart-value') {
        const sizeLegend = [...document.querySelectorAll('.size-legend-item[data-value]')]
          .map(node => Number(node.getAttribute('data-value')))
        expect(sizeLegend).toEqual(chart.sizeLegend)
        expectVisibleText(document.querySelector('.encoding-note'), chart.visualEncoding!)
      } else {
        const ticks = [...document.querySelectorAll('.axis-tick[data-value]')]
          .map(node => Number(node.getAttribute('data-value')))
        expect(ticks, `${chart.id} 的量轴刻度少于 3 个`).toHaveLength(chart.axisTicks!.length)
        expect(ticks).toEqual(chart.axisTicks)
        expect(ticks).toContain(0)
        expect(ticks).toContain(chart.upperBound)
      }
    }
  })

  it('运营图阶段与双系列点数一致且价值气泡使用面积图例', async () => {
    const data = await jsonFixture<ProfessionalVisualData>('professional-visual-data.json')
    const operation = data.charts.find(chart => chart.id === 'chart-operation')!
    const operationDocument = (await svgDocument(operation.id)).document
    const stageLabels = [...operationDocument.querySelectorAll('.stage-label[data-category]')]
      .map(node => node.getAttribute('data-category'))
    expect(stageLabels).toEqual(operation.stages)

    for (const series of operation.series!) {
      const points = operationDocument.querySelectorAll(`.datum[data-series="${series.id}"]`)
      expect(points, `${series.name} 点数与阶段数不一致`).toHaveLength(operation.stages!.length)
      const legend = operationDocument.querySelector(`.series-legend .legend-item[data-series="${series.id}"]`)
      expectVisibleText(legend?.querySelector('text') ?? null, series.name)
      expect(legend?.querySelector('[data-swatch]')?.getAttribute('stroke')).toBe(series.color)
    }

    const value = data.charts.find(chart => chart.id === 'chart-value')!
    const valueDocument = (await svgDocument(value.id)).document
    for (const datum of value.data) {
      const bubble = [...valueDocument.querySelectorAll('.datum circle[data-area-value]')]
        .find(node => node.getAttribute('data-area-value') === String(datum.value))
      expect(bubble, `chart-value 缺少面积值 ${datum.value}`).toBeDefined()
    }
    expectVisibleText(valueDocument.querySelector('.encoding-note'), '气泡面积代表价值指数')
  })

  it('价值气泡正文与尺寸图例统一使用显式 r²/value 面积比例尺', async () => {
    const data = await jsonFixture<ProfessionalVisualData>('professional-visual-data.json')
    const value = data.charts.find(chart => chart.id === 'chart-value')!
    const { document } = await svgDocument(value.id)
    const mainCircles = [...document.querySelectorAll('.datum circle[data-area-value]')]
      .map(circle => ({ circle, value: numericAttribute(circle, 'data-area-value') }))
    const legendCircles = [...document.querySelectorAll('.size-legend-item[data-value]')]
      .map(item => ({ circle: item.querySelector('circle')!, value: numericAttribute(item, 'data-value') }))
    expect(mainCircles).toHaveLength(value.data.length)
    expect(legendCircles).toHaveLength(value.sizeLegend!.length)

    for (const encoded of [...mainCircles, ...legendCircles]) {
      const radius = numericAttribute(encoded.circle, 'r')
      const areaScale = radius ** 2 / encoded.value
      expect(Math.abs(areaScale - value.areaScale!), `value=${encoded.value} 的 r²/value=${areaScale}`).toBeLessThanOrEqual(0.01)

      const center = translatedPoint(
        encoded.circle,
        numericAttribute(encoded.circle, 'cx'),
        numericAttribute(encoded.circle, 'cy'),
      )
      expect(center.x - radius).toBeGreaterThanOrEqual(0)
      expect(center.y - radius).toBeGreaterThanOrEqual(0)
      expect(center.x + radius).toBeLessThanOrEqual(data.canvas.width)
      expect(center.y + radius).toBeLessThanOrEqual(data.canvas.height)
    }
    expect(document.documentElement.getAttribute('data-area-scale')).toBe(String(value.areaScale))

    const legendUnitLabels = [...document.querySelectorAll('.size-legend > text.legend-label')]
    expect(legendUnitLabels, '尺寸图例缺少独立单位文字').toHaveLength(1)
    for (const unitLabel of legendUnitLabels) {
      const labelPoint = translatedPoint(unitLabel, numericAttribute(unitLabel, 'x'), numericAttribute(unitLabel, 'y'))
      for (const encoded of legendCircles) {
        const center = translatedPoint(
          encoded.circle,
          numericAttribute(encoded.circle, 'cx'),
          numericAttribute(encoded.circle, 'cy'),
        )
        expect(Math.abs(labelPoint.y - center.y), `图例单位文字与 value=${encoded.value} 圆重叠`)
          .toBeGreaterThanOrEqual(numericAttribute(encoded.circle, 'r') + 12)
      }
    }
  })

  it('六张图表 binding topic 与结构化数据一致且产品价值独立归类', async () => {
    const data = await jsonFixture<ProfessionalVisualData>('professional-visual-data.json')
    const profile = await jsonFixture<ClientProfile>('client-profile.json')
    expect(data.charts.find(chart => chart.id === 'chart-value')?.chartTopic).toBe(PRODUCT_VALUE_TOPIC)

    for (const chart of data.charts) {
      const bindings = profile.assetBindings.filter(binding => binding.assetId === chart.id)
      expect(bindings, `${chart.id} binding 不唯一`).toHaveLength(1)
      expect(bindings[0]!.chartTopic).toBe(chart.chartTopic)
    }
  })

  it('流线图的三类路线、方向、直接标签和分离图例逐项一致', async () => {
    const data = await jsonFixture<ProfessionalVisualData>('professional-visual-data.json')
    const { document } = await svgDocument(data.map.id)
    const routeGroups = document.querySelectorAll('.route[data-route]')
    const legendItems = document.querySelectorAll('.route-legend .legend-item[data-route]')
    expect(routeGroups).toHaveLength(3)
    expect(legendItems).toHaveLength(3)

    for (const route of data.map.routes) {
      const group = document.querySelector(`.route[data-route="${route.id}"]`)
      const path = group?.querySelector('.route-path')
      expect(path?.getAttribute('marker-end')).toBe(`url(#${route.id}-arrow)`)
      expect(path?.getAttribute('stroke')).toBe(route.color)
      expect(path?.getAttribute('stroke-width')).toBe(String(route.strokeWidth))
      expect(path?.getAttribute('stroke-dasharray') ?? '').toBe(route.dashArray)
      expectVisibleText(group?.querySelector('.route-label') ?? null, route.name)
      expect(document.querySelector(`marker#${route.id}-arrow`)).not.toBeNull()

      const legend = document.querySelector(`.route-legend .legend-item[data-route="${route.id}"]`)
      const legendLine = legend?.querySelector('line')
      const legendText = legend?.querySelector('text')
      expectVisibleText(legendText ?? null, route.name)
      expect(legendLine?.getAttribute('stroke')).toBe(route.color)
      expect(legendLine?.getAttribute('stroke-width')).toBe(String(route.strokeWidth))
      expect(legendLine?.getAttribute('stroke-dasharray') ?? '').toBe(route.dashArray)
      expect(Number(legendLine?.getAttribute('x2'))).toBeLessThanOrEqual(Number(legendText?.getAttribute('x')) - 20)
    }

    expectVisibleText(document.querySelector('#north-arrow .north-label'), data.map.northLabel)
    expectVisibleText(document.querySelector('.scale-note'), data.map.scale)
    const sourceNode = document.querySelector('.map-source[data-source]')
    expect(sourceNode?.getAttribute('data-source')).toBe(data.map.dataSource)
    expectVisibleText(sourceNode, data.disclosure)
  })

  it('流线图信息面板为第三图例与北针保留至少 48px 基线安全距', async () => {
    const { document } = await svgDocument('map-circulation')
    const panel = document.querySelector('.information-panel > rect')!
    const serviceLabel = document.querySelector('.route-legend .legend-item[data-route="service"] text')!
    const northGroup = document.querySelector('#north-arrow')!
    const northLabel = northGroup.querySelector('.north-label')!
    const nts = document.querySelector('.scale-note')!

    const serviceBaseline = translatedPoint(serviceLabel, numericAttribute(serviceLabel, 'x'), numericAttribute(serviceLabel, 'y'))
    const northBaseline = translatedPoint(northLabel, numericAttribute(northLabel, 'x'), numericAttribute(northLabel, 'y'))
    expect(Math.abs(northBaseline.y - serviceBaseline.y), '第三图例与 N 的绝对基线距离不足').toBeGreaterThanOrEqual(48)

    const panelBounds = {
      left: numericAttribute(panel, 'x'),
      top: numericAttribute(panel, 'y'),
      right: numericAttribute(panel, 'x') + numericAttribute(panel, 'width'),
      bottom: numericAttribute(panel, 'y') + numericAttribute(panel, 'height'),
    }
    const northPath = northGroup.querySelector('path')!
    const pathCoordinates = (northPath.getAttribute('d')?.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number)
    const northPoints = Array.from({ length: pathCoordinates.length / 2 }, (_, index) =>
      translatedPoint(northPath, pathCoordinates[index * 2]!, pathCoordinates[index * 2 + 1]!))
    const northLine = northGroup.querySelector('line')!
    northPoints.push(
      translatedPoint(northLine, numericAttribute(northLine, 'x1'), numericAttribute(northLine, 'y1')),
      translatedPoint(northLine, numericAttribute(northLine, 'x2'), numericAttribute(northLine, 'y2')),
      northBaseline,
    )
    for (const point of northPoints) {
      expect(point.x).toBeGreaterThanOrEqual(panelBounds.left)
      expect(point.x).toBeLessThanOrEqual(panelBounds.right)
      expect(point.y).toBeGreaterThanOrEqual(panelBounds.top)
      expect(point.y).toBeLessThanOrEqual(panelBounds.bottom)
    }

    const ntsPoint = translatedPoint(nts, numericAttribute(nts, 'x'), numericAttribute(nts, 'y'))
    expect(ntsPoint.x).toBeGreaterThanOrEqual(panelBounds.left + 16)
    expect(ntsPoint.x).toBeLessThanOrEqual(panelBounds.right - 16)
    expect(ntsPoint.y).toBeGreaterThanOrEqual(panelBounds.top + 16)
    expect(ntsPoint.y).toBeLessThanOrEqual(panelBounds.bottom - 16)
    expect(ntsPoint.y - Math.max(...northPoints.map(point => point.y))).toBeGreaterThanOrEqual(24)
  })

  it('同步数据合同、文件字节、manifest、binding/provenance、尺寸与唯一 block 引用', async () => {
    const data = await jsonFixture<ProfessionalVisualData>('professional-visual-data.json')
    const manifest = await jsonFixture<{ assets: ManifestAsset[] }>('evidence-manifest.json')
    const profile = await jsonFixture<ClientProfile>('client-profile.json')
    const assets = [...data.charts, data.map]
    const professionalIds = new Set(assets.map(asset => asset.id))

    for (const asset of assets) {
      const manifestRows = manifest.assets.filter(row => row.assetId === asset.id)
      const bindingRows = profile.assetBindings.filter(row => row.assetId === asset.id)
      expect(manifestRows, `manifest 中 ${asset.id} 记录不唯一`).toHaveLength(1)
      expect(bindingRows, `client-profile 中 ${asset.id} binding 不唯一`).toHaveLength(1)

      const manifestRow = manifestRows[0]!
      const binding = bindingRows[0]!
      const { bytes } = await svgDocument(asset.id)
      const actualSha256 = createHash('sha256').update(bytes).digest('hex')
      expect(manifestRow.file).toBe(`assets/${asset.id}.svg`)
      expect(manifestRow.sha256).toBe(actualSha256)
      expect(binding.sha256).toBe(actualSha256)
      expect(binding.provenance?.sourceFileSha256).toBe(actualSha256)
      expect(manifestRow).toMatchObject({ width: data.canvas.width, height: data.canvas.height })
      expect(binding).toMatchObject({ width: data.canvas.width, height: data.canvas.height })
      expect(manifestRow.caption).toContain(data.disclosure)
      expect(binding.provenance?.sourceLabel).toBe(data.disclosure)
      expect(JSON.stringify({ manifestRow, binding })).not.toMatch(/工程夹具|工程冻结/u)

      if ('unit' in asset) {
        expect(binding.chartContract).toEqual({ unit: asset.unit, methodology: asset.methodology })
      }
    }

    const references = profile.chapters.flatMap(chapter => chapter.blocks.flatMap((block, blockIndex) => {
      const ids = block.assetIds?.filter(assetId => professionalIds.has(assetId)) ?? []
      expect(new Set(ids).size, `${chapter.id} block-${blockIndex + 1} 有重复资产引用`).toBe(ids.length)
      expect(ids.length, `${chapter.id} block-${blockIndex + 1} 引用了多个专业图件`).toBeLessThanOrEqual(1)
      return ids.map(assetId => ({ assetId, chapterId: chapter.id, blockIndex }))
    }))

    for (const assetId of professionalIds) {
      expect(references.filter(reference => reference.assetId === assetId), `${assetId} 的 block 引用不唯一`).toHaveLength(1)
    }
  })
})
