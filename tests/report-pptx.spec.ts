import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { clientTextChunks, clientTextWidth } from '../src/report/client-typography.ts'
import { planClientPages } from '../src/report/page-plan.ts'
import { renderPptx } from '../src/report/render-pptx.ts'
import * as pptxRenderer from '../src/report/render-pptx.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'
import { inspectPptx } from './support/pptx-inspector.ts'

const roots: string[] = []
const FULL_BLEED_BEFORE = '分散节点彼此独立，使用时段和客群覆盖有限'
const FULL_BLEED_AFTER = '公共主轴串联水岸、场馆与社区服务，形成全天候体验'

function unzipPptxEntry(buffer: Buffer, entryName: string): Buffer {
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02])
  let offset = buffer.indexOf(signature)
  while (offset >= 0 && offset + 46 <= buffer.length) {
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (name === entryName) {
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
      if (method === 0) return compressed
      if (method === 8) return inflateRawSync(compressed)
      throw new Error(`unsupported PPTX compression method: ${method}`)
    }
    offset = buffer.indexOf(signature, offset + 46 + nameLength + extraLength + commentLength)
  }
  throw new Error(`missing PPTX entry: ${entryName}`)
}

async function pptxSlideXml(path: string, slideNumber: number): Promise<string> {
  return unzipPptxEntry(await readFile(path), `ppt/slides/slide${slideNumber}.xml`).toString('utf8')
}

function namedShapeXml(slideXml: string, name: string): string {
  const shape = [...slideXml.matchAll(/<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/gu)]
    .map(match => match[0])
    .find(value => value.includes(`name="${name}"`))
  if (shape === undefined) throw new Error(`missing named PPTX shape: ${name}`)
  return shape
}

function expectNamedArrow(slideXml: string, name: string): void {
  expect(namedShapeXml(slideXml, name), `${name} 缺少明确箭头`).toMatch(/<a:tailEnd\s+type="triangle"\s*\/>/u)
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function sourceImageDimensions(path: string): Promise<Readonly<{ width: number; height: number }>> {
  const source = await readFile(path)
  if (source.length >= 24 && source.subarray(1, 4).toString('ascii') === 'PNG') {
    return { width: source.readUInt32BE(16), height: source.readUInt32BE(20) }
  }
  const svg = /<svg\b([^>]*)>/iu.exec(source.toString('utf8'))?.[1] ?? ''
  const attribute = (name: string): number => Number(
    new RegExp(`\\b${name}="([0-9.]+)(?:px)?"`, 'iu').exec(svg)?.[1] ?? 0,
  )
  const width = attribute('width')
  const height = attribute('height')
  if (width > 0 && height > 0) return { width, height }
  const viewBox = /\bviewBox="[0-9.+-]+\s+[0-9.+-]+\s+([0-9.]+)\s+([0-9.]+)"/iu.exec(svg)
  if (viewBox !== null) return { width: Number(viewBox[1]), height: Number(viewBox[2]) }
  throw new Error(`unsupported source image dimensions: ${path}`)
}

async function professionalVariantContext(root: string) {
  const sourceImage = join(root, 'professional-layout.svg')
  await writeFile(sourceImage, '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#17333a"/><path d="M0 720L420 360 780 610 1180 210 1600 560V900H0Z" fill="#d59a63"/></svg>')
  const profile = {
    ...CLIENT_PROFILE,
    assetBindings: CLIENT_PROFILE.assetBindings.map((binding, index) => index !== 0
      ? binding
      : { ...binding, width: 1600, height: 900 }),
  }
  const bundle = createClientReportBundle({
    ...REPORT_INPUT,
    visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage, mimeType: 'image/svg+xml' as const }],
  }, profile)
  const roles = ['map', 'diagram', 'chart'] as const
  const variants = ['editorial', 'full-bleed', 'split'] as const
  const assets = roles.map((role, index) => ({
    ...bundle.report.assets[0]!,
    assetId: `professional-layout-${index + 1}`,
    role,
    chapterId: bundle.report.chapters[index]!.id,
    caption: `专业构图图片 ${variants[index]}`,
    provenance: {
      sourceLabel: '专业构图测试资料',
      sourceDate: '2026-08-28',
      locator: `构图 ${variants[index]}`,
      sourceFileSha256: 'd'.repeat(64),
      evidenceIds: ['evidence-1'],
    },
  }))
  const report = {
    ...bundle.report,
    assets: [...bundle.report.assets, ...assets],
    chapters: bundle.report.chapters.map((chapter, index) => index >= assets.length
      ? chapter
      : {
          ...chapter,
          blocks: chapter.blocks.map((block, blockIndex) => blockIndex !== 0
            ? block
            : index === 1
              ? {
                  type: 'comparison' as const,
                  headline: `专业构图 ${variants[index]}`,
                  before: FULL_BLEED_BEFORE,
                  after: FULL_BLEED_AFTER,
                  evidenceIds: block.type === 'narrative' ? block.evidenceIds : [],
                  assetIds: [assets[index]!.assetId],
                }
              : {
                  type: 'evidence' as const,
                  headline: `专业构图 ${variants[index]}`,
                  evidenceIds: block.type === 'narrative' ? block.evidenceIds : [],
                  assetIds: [assets[index]!.assetId],
                }),
        }),
  }
  const basePlan = planClientPages(report, 'pptx')
  const plan = {
    ...basePlan,
    pages: basePlan.pages.map(page => {
      const index = assets.findIndex(asset => page.assetIds.includes(asset.assetId))
      return index < 0 ? page : { ...page, layoutVariant: variants[index]! }
    }),
  }
  return { report, plan, identity: bundle.identity, sourceImage }
}

describe('renderPptx', () => {
  it('uses one shared semantic chunk for the three client phrases protected across media', () => {
    for (const phrase of [
      '项目所处的区域网络',
      '公共界面与运营模型',
      '降低一次性投入风险',
    ]) {
      expect(clientTextChunks(`前文${phrase}后文`), `共享断句词组被拆开：${phrase}`).toContain(phrase)
    }
  })

  it('wraps client copy at semantic chunks without splitting planning terms or leaving a one-character tail', () => {
    const wrap = Reflect.get(pptxRenderer, 'wrapClientText') as undefined | ((
      text: string,
      maximumLineWidth: number,
      maximumLines: number,
      errorCode: string,
    ) => string)
    expect(wrap, 'PPTX 客户文字必须通过可回归的语义换行器').toBeTypeOf('function')

    for (const row of [
      {
        text: '滨江文化活力区价值重构提案',
        maximumLineWidth: 9,
        maximumLines: 3,
        protectedTerms: ['滨江文化活力区'],
      },
      {
        text: '把滨水资源转化为项目资产价值',
        maximumLineWidth: 6,
        maximumLines: 4,
        protectedTerms: ['滨水资源'],
      },
      {
        text: '三个同步行动层推动项目实施',
        maximumLineWidth: 6,
        maximumLines: 4,
        protectedTerms: ['行动层'],
      },
      {
        text: '优先验证公共界面与运营模型',
        maximumLineWidth: 10,
        maximumLines: 4,
        protectedTerms: ['公共界面与运营模型'],
      },
      {
        text: '城市区位关系明确项目所处的区域网络',
        maximumLineWidth: 10,
        maximumLines: 3,
        protectedTerms: ['项目所处的区域网络'],
      },
      {
        text: '以示范先行、骨架成网、场景扩展的路径降低一次性投入风险。',
        maximumLineWidth: 16,
        maximumLines: 4,
        protectedTerms: ['降低一次性投入风险'],
      },
      {
        text: '滨水公共界面能够转化为持续运营的城市资产',
        maximumLineWidth: 18,
        maximumLines: 2,
        protectedTerms: ['公共界面', '城市资产'],
      },
      {
        text: '把公共开放空间转化为全天候文化、社交与轻消费目的地',
        maximumLineWidth: 16,
        maximumLines: 3,
        protectedTerms: ['轻消费', '目的地'],
      },
      {
        text: '存量提质阶段需要尽快把滨水资源转化为可使用、可运营的城市界面',
        maximumLineWidth: 25,
        maximumLines: 3,
        protectedTerms: ['可使用', '可运营', '城市界面'],
      },
      {
        text: '建设、内容策划和运营团队需要在首期同步介入。',
        maximumLineWidth: 19,
        maximumLines: 3,
        protectedTerms: ['首期同步介入'],
      },
      {
        text: '单位：万元/年 · 口径：按示例研究分阶段运营收支估算，待项目实测校核',
        maximumLineWidth: 22,
        maximumLines: 7,
        protectedTerms: ['分阶段', '待项目实测校核'],
      },
      {
        text: '雨洪花园、生态台地和亲水界面一体组织',
        maximumLineWidth: 13,
        maximumLines: 4,
        protectedTerms: ['亲水界面'],
      },
      {
        text: '家庭、青年与社区居民对全天候共享场景具有重叠需求。',
        maximumLineWidth: 19,
        maximumLines: 4,
        protectedTerms: ['重叠需求'],
      },
      {
        text: '首期投入按公共空间、基础设施和运营启动的共同需求排序。',
        maximumLineWidth: 19,
        maximumLines: 4,
        protectedTerms: ['运营启动的共同需求排序'],
      },
      {
        text: '以公共文化主轴串联滨水开放空间，形成持续发生的城市生活目的地',
        maximumLineWidth: 25,
        maximumLines: 3,
        protectedTerms: ['形成持续发生的城市生活目的地'],
      },
    ] as const) {
      const wrapped = wrap!(row.text, row.maximumLineWidth, row.maximumLines, 'TEST_TEXT_BUDGET_EXCEEDED')
      const lines = wrapped.split('\n')
      expect(lines.join('')).toBe(row.text)
      expect(lines.length).toBeLessThanOrEqual(row.maximumLines)
      expect(lines.every(line => clientTextWidth(line) <= row.maximumLineWidth)).toBe(true)
      expect([...lines.at(-1)!].length, `出现极短尾行：${wrapped}`).toBeGreaterThanOrEqual(3)
      for (const term of row.protectedTerms) {
        const normalized = wrapped.replace(/\n/gu, '')
        const termStart = normalized.indexOf(term)
        const breakOffsets = lines.slice(0, -1).reduce<number[]>((offsets, line) => [
          ...offsets,
          (offsets.at(-1) ?? 0) + [...line].length,
        ], [])
        expect(termStart, `测试词组不存在：${term}`).toBeGreaterThanOrEqual(0)
        expect(breakOffsets.some(offset => offset > termStart && offset < termStart + [...term].length),
          `词内断行：${term} / ${wrapped}`).toBe(false)
      }
    }
  })

  it('rejects a profile-created research boundary without governed synthetic research input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-boundary-pptx-'))
    roots.push(root)
    const sourceImage = join(root, 'boundary.png')
    await writeFile(sourceImage, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    const profile = {
      ...CLIENT_PROFILE,
      assetBindings: [{ ...CLIENT_PROFILE.assetBindings[0]!, role: 'map' as const, chapterId: 'chapter-01', analysisKind: 'site-boundary' as const,
        provenance: { sourceLabel: '工程夹具范围', sourceDate: '2026-08-28', locator: 'boundary', sourceFileSha256: 'b'.repeat(64), evidenceIds: ['evidence-1'] },
        cartography: { boundary: 'research' as const, disclosures: ['研究范围（待核）', '非法定红线', '非测绘成果'], legend: 'present' as const, northArrow: 'present' as const, scale: { kind: 'nts' as const } },
      }], requiredVisualRoles: ['map' as const],
      chapters: CLIENT_PROFILE.chapters.map((chapter, index) => index !== 0 ? chapter : { ...chapter, blocks: [{ type: 'evidence' as const, headline: '研究范围', evidenceIds: ['evidence-1'], assetIds: ['concept-1'] }] }),
    }
    expect(() => createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, profile)).toThrow('SITE_BOUNDARY_PROFILE_CONFLICT')
  })

  it('creates 35 editable client-facing slides with one decision ending and no production appendix language', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-client-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, CLIENT_PROFILE)
    const context = {
      report: bundle.report,
      plan: planClientPages(bundle.report, 'pptx'),
      identity: bundle.identity,
    }

    const artifact = await renderPptx(context, output)
    const deck = await inspectPptx(output)

    expect(artifact).toMatchObject({ format: 'pptx', fileName: 'report.pptx', sha256: expect.any(String) })
    expect(deck.slideCount).toBe(35)
    expect(deck.pageKinds).toEqual(expect.arrayContaining([
      'cover', 'opening-claim', 'chapter-divider', 'product', 'scene', 'decision',
    ]))
    expect(deck.slideTexts.join('\n')).not.toMatch(/Gate|Revision|Workflow|工作项|完成度/iu)
    expect(deck.notesTexts.join('\n')).toContain('sourceRevision=57')
    expect(deck.notesTexts, 'PPTX 每页都必须有独立 notes').toHaveLength(35)
    for (const [index, notes] of deck.notesTexts.entries()) {
      expect(notes.match(/\[Publishable\]false/gu), `PPTX 第${index + 1}页 notes 必须且只能声明一次不可发布`)
        .toHaveLength(1)
    }
    expect(deck.mediaNames.length).toBeGreaterThanOrEqual(bundle.report.assets.length)
    expect(deck.outOfBoundsObjects).toEqual([])
    expect(deck.textBelowMinimum).toEqual([])
    expect(deck.slideTexts.join('\n')).not.toContain('概念示意')
    expect(deck.slideTexts.join('\n')).not.toMatch(/AI\s*生成/iu)
    expect(deck.slideTexts.join('\n')).not.toMatch(/仅 PDF|供核验|不属于主报告/iu)
    expect(deck.slideTexts.at(-1)).toContain('把共同判断转化为下一步行动')

    const closingSlide = 35
    const closingInputs = Array.from({ length: 3 }, (_, index) => deck.shapeObjects.find(object =>
      object.slideNumber === closingSlide && object.name === `ClosingDecision Label ${index + 1}`))
    expect(closingInputs.every(input => input !== undefined), 'P35 必须保留三个独立决策输入').toBe(true)
    const commonTargets = deck.shapeObjects.filter(object => object.slideNumber === closingSlide
      && object.name === 'ClosingDecision Common Target')
    expect(commonTargets, 'P35 必须且只能有一个明确共同目标').toHaveLength(1)
    expect(deck.slideTexts[closingSlide - 1]).toContain('共同解锁')
    expect(deck.shapeObjects.filter(object => object.slideNumber === closingSlide
      && object.name.startsWith('ClosingDecision Connector ')), 'P35 不得继续使用输入之间的相邻横向箭头').toEqual([])
    const closingXml = await pptxSlideXml(output, closingSlide)
    const commonTarget = commonTargets[0]!
    const closingArrows = Array.from({ length: 3 }, (_, index) => deck.shapeObjects.find(object =>
      object.slideNumber === closingSlide && object.name === `ClosingDecision Arrow ${index + 1}`))
    expect(closingArrows.every(arrow => arrow !== undefined), 'P35 三个输入必须各有一条有方向连接').toBe(true)
    for (const [index, arrow] of closingArrows.entries()) {
      const input = closingInputs[index]!
      expect(input.y + input.height).toBeLessThanOrEqual(arrow!.y + 0.03)
      expect(Math.abs(arrow!.y + arrow!.height - commonTarget.y), `P35 箭头 ${index + 1} 终点未汇聚到共同目标`).toBeLessThanOrEqual(0.08)
      expectNamedArrow(closingXml, `ClosingDecision Arrow ${index + 1}`)
    }
  })

  it('uses a product value proposition as the copy on a product visual page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-product-visual-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const sourceImage = join(root, 'lakefront-masterplan.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const secondProduct = {
      ...CLIENT_PROFILE.products[0]!,
      productId: 'product-lakefront-west',
      name: '洋澜湖·缤纷西岸',
      valueProposition: '把单一景观岸线转化为城市会客厅',
    }
    const mapAsset = {
      ...REPORT_INPUT.visualAssets[0]!,
      assetId: 'lakefront-masterplan',
      kind: 'evidence' as const,
      caption: '洋澜湖西岸滨湖空间总体布局',
      sourcePath: sourceImage,
    }
    const profile = {
      ...CLIENT_PROFILE,
      products: [...CLIENT_PROFILE.products, secondProduct],
      chapters: CLIENT_PROFILE.chapters.map(chapter => chapter.id !== 'chapter-06'
        ? chapter
        : {
            ...chapter,
            blocks: [{
              type: 'product' as const,
              productId: secondProduct.productId,
              assetIds: [mapAsset.assetId],
            }, ...chapter.blocks.slice(1)],
          }),
      assetBindings: [...CLIENT_PROFILE.assetBindings, {
        ...CLIENT_PROFILE.assetBindings[0]!,
        assetId: mapAsset.assetId,
        role: 'map' as const,
        productId: secondProduct.productId,
        disclosure: undefined,
      }],
    }
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }, mapAsset],
    }, profile)
    const context = {
      report: bundle.report,
      plan: planClientPages(bundle.report, 'pptx'),
      identity: bundle.identity,
    }

    await renderPptx(context, output)
    const deck = await inspectPptx(output)
    const fullBleedPageIndex = context.plan.pages.findIndex(page =>
      page.assetIds.includes(mapAsset.assetId))
    const slide = deck.slideTexts.find(text => text.includes('洋澜湖·缤纷西岸')) ?? ''
    const valueProposition = deck.textObjects.find(object =>
      object.slideNumber === fullBleedPageIndex + 1
      && object.text === secondProduct.valueProposition)

    expect(context.plan.pages[fullBleedPageIndex]?.layoutVariant).toBe('full-bleed')
    expect(slide).toContain('把单一景观岸线转化为城市会客厅')
    expect(slide).not.toContain('以核心产品承接项目定位与使用场景')
    expect(valueProposition).toBeDefined()
    expect(valueProposition!.fontSize).toBeGreaterThanOrEqual(14)
  })

  it('renders chart unit and methodology without exposing implementation provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-visual-contract-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const sourceImage = join(root, 'chart.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const profile = {
      ...CLIENT_PROFILE,
      chapters: CLIENT_PROFILE.chapters.map((chapter, index) => index !== 0 ? chapter : {
        ...chapter,
        blocks: [{
          type: 'evidence' as const,
          headline: '客流结构显示全天候使用需求',
          evidenceIds: ['evidence-1'],
          assetIds: ['concept-1'],
        }],
      }),
      assetBindings: [{
        ...CLIENT_PROFILE.assetBindings[0]!,
        role: 'chart' as const,
        chartTopic: 'audience-demand' as const,
        provenance: {
          sourceLabel: '工程夹具图表资料', sourceDate: '2026-08-28', locator: '项目简报·客流统计',
          sourceFileSha256: 'c'.repeat(64), evidenceIds: ['evidence-1'],
        },
        chartContract: { unit: '人次/日', methodology: '按工程夹具统计口径汇总' },
      }],
      requiredVisualRoles: ['chart' as const],
    }
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, profile)

    await renderPptx({ report: bundle.report, plan: planClientPages(bundle.report, 'pptx'), identity: bundle.identity }, output)
    const deck = await inspectPptx(output)
    const text = deck.slideTexts.join('\n')

    expect(text).toContain('工程夹具图表资料 · 2026-08-28 · 项目简报·客流统计')
    expect(text).toContain('单位：人次/日 · 口径：按工程夹具统计口径汇总')
    expect(text).not.toContain('c'.repeat(64))
    expect(text).not.toContain(sourceImage)
    expect(text).not.toMatch(/AI\s*生成/iu)
    expect(deck.textBelowMinimum).toEqual([])
  })

  it('uses distinct image geometry for the three professional layout variants without covering the full-bleed image', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-professional-layout-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')

    await renderPptx(await professionalVariantContext(root), output)
    const deck = await inspectPptx(output)
    const variants = ['full-bleed', 'split', 'editorial'] as const
    const pictures = variants.map(variant => deck.pictureObjects.find(object =>
      object.altText === `专业构图图片 ${variant}`))
    const captions = (['split', 'editorial'] as const).map(variant => deck.textObjects.find(object =>
      object.text.includes(`专业构图图片 ${variant}`)))
    const titles = variants.map(variant => deck.textObjects.find(object =>
      object.text.replace(/\r?\n/gu, '') === `专业构图 ${variant}`))

    expect(pictures.every(Boolean)).toBe(true)
    expect(captions.every(Boolean)).toBe(true)
    expect(titles.every(Boolean)).toBe(true)
    expect(new Set(pictures.map(object => `${object!.x}|${object!.width}|${object!.y}|${object!.height}`)).size).toBe(3)
    expect(new Set(titles.map(object => `${object!.x}|${object!.width}|${object!.y}`)).size).toBe(3)
    const fullBleedArea = pictures[0]!.width * pictures[0]!.height
    const editorialArea = pictures[2]!.width * pictures[2]!.height
    const fullBleedShapes = deck.shapeObjects.filter(object => object.slideNumber === pictures[0]!.slideNumber)
    const overlapsFullBleedPicture = fullBleedShapes.filter(object => (
      object.x < pictures[0]!.x + pictures[0]!.width
      && object.x + object.width > pictures[0]!.x
      && object.y < pictures[0]!.y + pictures[0]!.height
      && object.y + object.height > pictures[0]!.y
    ))
    expect(overlapsFullBleedPicture).toEqual([])
    expect(fullBleedShapes.map(object => object.text).join('\n')).not.toContain('专业构图图片 full-bleed')
    expect(fullBleedShapes.map(object => object.text).join('\n')).not.toContain('前期策划成果提案')
    expect(pictures[0]!.sourceCrop).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
    expect(pictures[0]!.width / 13.333).toBeGreaterThanOrEqual(0.85)
    expect(fullBleedArea / (13.333 * 7.5)).toBeGreaterThanOrEqual(0.75)
    expect(fullBleedArea).toBeGreaterThan(editorialArea)
    expect(pictures[1]!.x).toBeGreaterThanOrEqual(5.5)
    expect(pictures[1]!.width).toBeGreaterThanOrEqual(6.8)
    expect(pictures[1]!.x + pictures[1]!.width).toBeLessThanOrEqual(12.6)
    expect(pictures[2]!.x).toBeGreaterThanOrEqual(4.8)
    expect(pictures[2]!.width).toBeGreaterThanOrEqual(7.7)
    expect(captions[0]!.x).toBeGreaterThanOrEqual(0.8)
    expect(captions[0]!.x + captions[0]!.width).toBeLessThanOrEqual(12.533)
  })

  it('keeps the complete P6 regional phrase on one physical editorial title line without overflow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-editorial-semantic-line-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const context = await professionalVariantContext(root)
    const assetId = 'professional-layout-1'
    const report = {
      ...context.report,
      assets: context.report.assets.map(asset => asset.assetId !== assetId ? asset : {
        ...asset,
        provenance: {
          sourceLabel: '示例场地分析资料', sourceDate: '2026-08-28', locator: '城市区位',
          sourceFileSha256: 'a'.repeat(64), evidenceIds: ['evidence-1'],
        },
      }),
    }
    const plan = {
      ...context.plan,
      pages: context.plan.pages.map(page => page.pageId === 'chapter-01-block-01'
        ? { ...page, headline: '城市区位关系明确项目所处的区域网络' }
        : page),
    }

    await renderPptx({ ...context, report, plan }, output)
    const deck = await inspectPptx(output)
    const title = deck.textObjects.find(object => object.slideNumber === 6
      && object.text.replace(/\r?\n/gu, '') === '城市区位关系明确项目所处的区域网络')
    const picture = deck.pictureObjects.find(object => object.slideNumber === 6 && object.altText === '专业构图图片 editorial')
    const contract = deck.textObjects.find(object => object.slideNumber === 6 && object.text.includes('示例场地分析资料'))

    expect(title).toBeDefined()
    expect(title!.text.split(/\r?\n/u).some(line => line.includes('项目所处的区域网络'))).toBe(true)
    expect(title!.width).toBeGreaterThanOrEqual(3.8)
    expect(picture?.x).toBeGreaterThanOrEqual(4.8)
    expect(picture!.x + picture!.width).toBeLessThanOrEqual(12.54)
    expect(contract?.color).toBe('C9D7D8')
    expect(deck.outOfBoundsObjects).toEqual([])
  })

  it('does not leave conjunctions at the end of a physical P29 chapter line', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-implementation-divider-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const context = await professionalVariantContext(root)
    const headline = '首期启动区优先验证公共界面与运营模型'
    const claim = '以示范先行、骨架成网、场景扩展的路径降低一次性投入风险。'
    const report = {
      ...context.report,
      chapters: context.report.chapters.map(chapter => chapter.id !== 'chapter-09' ? chapter : {
        ...chapter, headline, claim,
      }),
    }
    const plan = {
      ...context.plan,
      pages: context.plan.pages.map(page => page.pageId === 'chapter-09-divider'
        ? { ...page, headline, primaryFocus: { type: 'claim' as const, statement: claim } }
        : page),
    }

    await renderPptx({ ...context, report, plan }, output)
    const deck = await inspectPptx(output)
    const textObjects = deck.textObjects.filter(object => object.slideNumber === 29)
    const physicalLines = textObjects.flatMap(object => object.text.split(/\r?\n/u))

    expect(physicalLines.some(line => line.includes('公共界面与运营模型'))).toBe(true)
    expect(physicalLines.some(line => line.includes('降低一次性投入风险'))).toBe(true)
    expect(physicalLines.some(line => line.trimEnd().endsWith('与'))).toBe(false)
    expect(deck.outOfBoundsObjects).toEqual([])
  })

  it('preserves the real source image aspect ratio on a full-bleed picture', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-full-bleed-ratio-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const context = await professionalVariantContext(root)

    await renderPptx(context, output)
    const deck = await inspectPptx(output)
    const picture = deck.pictureObjects.find(object => object.altText === '专业构图图片 full-bleed')
    const sourceDimensions = await sourceImageDimensions(context.sourceImage)

    expect(picture).toBeDefined()
    expect(picture!.width / picture!.height).toBeCloseTo(sourceDimensions.width / sourceDimensions.height, 5)
  })

  it('reserves deterministic non-overlapping text and image zones on a full-bleed visual page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-full-bleed-safe-zone-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const context = await professionalVariantContext(root)

    await renderPptx(context, output)
    const deck = await inspectPptx(output)
    const picture = deck.pictureObjects.find(object => object.altText === '专业构图图片 full-bleed')
    const title = deck.textObjects.find(object =>
      object.text.replace(/\r?\n/gu, '') === '专业构图 full-bleed')
    const pageText = deck.textObjects.filter(object => object.slideNumber === picture?.slideNumber)
    const copy = pageText.find(object => object.fontSize >= 14 && object.text !== title?.text)
    const contract = pageText.find(object => object.fontSize === 10)

    expect(picture).toBeDefined()
    expect(title).toBeDefined()
    expect(copy).toBeDefined()
    expect(contract).toBeDefined()
    expect(title!.height).toBeGreaterThanOrEqual(0.7)
    expect(copy!.height).toBeGreaterThanOrEqual(0.35)
    expect(contract!.height).toBeGreaterThanOrEqual(0.7)
    expect([title, copy, contract].every(object => object!.usesNormAutofit === false)).toBe(true)
    const normalizedSlideText = deck.slideTexts[picture!.slideNumber - 1]!.replace(/\r?\n/gu, '')

    expect(normalizedSlideText).toContain(FULL_BLEED_BEFORE)
    expect(normalizedSlideText).toContain(FULL_BLEED_AFTER)
    const safeGap = (left: typeof title, right: typeof title): number => Math.max(
      right!.x - (left!.x + left!.width),
      left!.x - (right!.x + right!.width),
      right!.y - (left!.y + left!.height),
      left!.y - (right!.y + right!.height),
    )
    expect(safeGap(title, copy)).toBeGreaterThanOrEqual(0.08)
    expect(safeGap(title, contract)).toBeGreaterThanOrEqual(0.08)
    expect(safeGap(copy, contract)).toBeGreaterThanOrEqual(0.08)
    for (const text of [title!, copy!, contract!]) {
      expect(safeGap(text, picture as typeof title)).toBeGreaterThanOrEqual(0.15)
    }
  })

  it('does not append PDF-only evidence production language to the PPTX main report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-pdf-only-notice-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, CLIENT_PROFILE)

    await renderPptx({ report: bundle.report, plan: planClientPages(bundle.report, 'pptx'), identity: bundle.identity }, output)
    const deck = await inspectPptx(output)

    expect(deck.slideTexts.join('\n')).not.toMatch(/仅 PDF|供核验|不属于主报告/iu)
    expect(deck.slideTexts.at(-1)).toContain('把共同判断转化为下一步行动')
  })

  it('fails closed instead of autofitting an over-budget full-bleed title', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-full-bleed-budget-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const context = await professionalVariantContext(root)
    const plan = {
      ...context.plan,
      pages: context.plan.pages.map(page => page.layoutVariant !== 'full-bleed' || page.kind !== 'visual-evidence'
        ? page
        : { ...page, headline: '超长标题'.repeat(6) }),
    }

    await expect(renderPptx({ ...context, plan }, output))
      .rejects.toThrow('CLIENT_PPTX_FULL_BLEED_TEXT_BUDGET_EXCEEDED')
  })

  it('preserves terminal punctuation on chapter-divider copy and reserves a stable line budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-chapter-divider-budget-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const punctuatedClaim = '公共文化主轴需要同时连接水岸、场馆、社区服务与全天候运营场景。'
    const profile = {
      ...CLIENT_PROFILE,
      chapters: CLIENT_PROFILE.chapters.map((chapter, index) => index === 0
        ? { ...chapter, claim: punctuatedClaim }
        : chapter),
    }
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, profile)

    await renderPptx({ report: bundle.report, plan: planClientPages(bundle.report, 'pptx'), identity: bundle.identity }, output)
    const deck = await inspectPptx(output)
    const dividerSlide = deck.pageKinds.findIndex(kind => kind === 'chapter-divider') + 1
    const rawClaim = punctuatedClaim
    const claim = deck.textObjects.find(object =>
      object.slideNumber === dividerSlide && object.text.replace(/\n/gu, '') === rawClaim)

    expect(claim).toBeDefined()
    expect(claim!.text.replace(/\n/gu, '')).toBe(rawClaim)
    expect(claim!.text.split('\n').filter(Boolean).every(line => !/^[。！？；：]+$/u.test(line))).toBe(true)
    expect(claim!.height).toBeGreaterThanOrEqual(1.35)
    expect(claim!.usesNormAutofit).toBe(false)
  })

  it('does not repeat a narrative statement as both title and body on one slide', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-client-pptx-dedup-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, CLIENT_PROFILE)
    const context = {
      report: bundle.report,
      plan: planClientPages(bundle.report, 'pptx'),
      identity: bundle.identity,
    }

    await renderPptx(context, output)
    const deck = await inspectPptx(output)
    const statement = CLIENT_PROFILE.chapters[0]!.blocks[0]!.type === 'narrative'
      ? CLIENT_PROFILE.chapters[0]!.blocks[0]!.statement
      : ''
    const slide = deck.slideTexts.find(text => text.includes(statement)) ?? ''

    expect(slide.match(new RegExp(statement, 'gu'))).toHaveLength(1)
  })

  it('places every product named by a multi-product scene on the scene slide', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-product-lineup-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const names = ['明塘文化街区', '滨水生活客厅', '落日剧场与城市活动场']
    const products = names.map((name, index) => ({
      ...CLIENT_PROFILE.products[0]!,
      productId: index === 0 ? CLIENT_PROFILE.products[0]!.productId : `product-${index + 1}`,
      name,
      valueProposition: `${name}的客户价值`,
    }))
    const profile = {
      ...CLIENT_PROFILE,
      products,
      chapters: CLIENT_PROFILE.chapters.map(chapter => chapter.id !== 'chapter-06'
        ? chapter
        : {
            ...chapter,
            blocks: [{
              type: 'scene' as const,
              headline: '三类产品共同构成完整体验',
              productIds: products.map(product => product.productId),
              assetIds: [],
            }, ...chapter.blocks.slice(1).map(block => block.type === 'evidence'
              ? { ...block, assetIds: [] }
              : block)],
          }),
    }
    const bundle = createClientReportBundle(
      { ...REPORT_INPUT, visualAssets: [] },
      { ...profile, assetBindings: [], requiredVisualRoles: [] },
    )

    await renderPptx({ report: bundle.report, plan: planClientPages(bundle.report, 'pptx'), identity: bundle.identity }, output)
    const deck = await inspectPptx(output)
    const slide = deck.slideTexts.find(text => text.includes('三类产品共同构成完整体验')) ?? ''

    for (const name of names) expect(slide).toContain(name)
  })

  it('keeps a structured spatial sequence above its evidence region', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-spatial-scene-layout-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const profile = {
      ...CLIENT_PROFILE,
      chapters: CLIENT_PROFILE.chapters.map(chapter => chapter.id !== 'chapter-07'
        ? chapter
        : {
            ...chapter,
            blocks: [{
              type: 'narrative' as const,
              statement: '空间骨架优先连接门户、文化核心、生态水岸与社区入口。',
              evidenceIds: ['evidence-7'],
            }, ...chapter.blocks.slice(1)],
          }),
    }
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, profile)

    await renderPptx({ report: bundle.report, plan: planClientPages(bundle.report, 'pptx'), identity: bundle.identity }, output)
    const deck = await inspectPptx(output)
    const sceneNode = deck.textObjects.find(object => object.text.trim() === '门户')
    const evidence = deck.textObjects.find(object => object.slideNumber === sceneNode?.slideNumber
      && object.text.includes('项目证据 7 支撑对应的客户判断'))

    expect(sceneNode).toBeDefined()
    expect(evidence).toBeDefined()
    expect(sceneNode!.slideNumber).toBe(evidence!.slideNumber)
    expect(sceneNode!.y + sceneNode!.height).toBeLessThanOrEqual(evidence!.y)
  })

  it('uses flat evidence composition instead of oversized white cards on no-image client pages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-flat-evidence-layout-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const profile = {
      ...CLIENT_PROFILE,
      chapters: CLIENT_PROFILE.chapters.map(chapter => chapter.id === 'chapter-07'
        ? {
            ...chapter,
            blocks: [{
              type: 'narrative' as const,
              statement: '空间骨架优先连接门户、文化核心、生态水岸与社区入口。',
              evidenceIds: ['evidence-3'],
            }, {
              type: 'metric' as const,
              label: '连续开放界面', value: '一体化', unit: '空间系统', evidenceIds: ['evidence-7'],
            }],
          }
        : chapter.id === 'chapter-10'
          ? {
              ...chapter,
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
    }
    const bundle = createClientReportBundle(
      { ...REPORT_INPUT, visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }] },
      profile,
    )

    await renderPptx({ report: bundle.report, plan: planClientPages(bundle.report, 'pptx'), identity: bundle.identity }, output)
    const deck = await inspectPptx(output)
    const targetedSlides = [
      deck.slideTexts.findIndex(slide => slide.includes('门户') && slide.includes('社区入口')) + 1,
      deck.slideTexts.findIndex(slide => slide.includes('连续开放界面') && slide.includes('系统数量与边界')) + 1,
      deck.slideTexts.findIndex(slide => slide.includes('确认总体定位') && slide.includes('形成统一输入')) + 1,
      deck.slideTexts.findIndex(slide => slide.includes('分期实施与运营前置共同降低项目不确定性')) + 1,
    ]

    expect(targetedSlides.every(slideNumber => slideNumber > 0)).toBe(true)
    const evidenceObjects = deck.textObjects.filter(object => targetedSlides.includes(object.slideNumber)
      && object.text.includes('项目证据'))
    expect(evidenceObjects).toHaveLength(3)
    expect(evidenceObjects.every(object => object.fillColor === '')).toBe(true)
  })

  it('renders implementation timelines and investments as structured visual objects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-structured-implementation-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const phases = ['示范先行', '骨架成网', '场景扩展']
    const profile = {
      ...CLIENT_PROFILE,
      chapters: CLIENT_PROFILE.chapters.map(chapter => chapter.id !== 'chapter-09'
        ? chapter
        : {
            ...chapter,
            blocks: [{
              type: 'timeline' as const,
              headline: '三阶段把共同判断转化为连续行动',
              phases: phases.map((name, index) => ({
                phaseId: `phase-${index + 1}`,
                name,
                actions: [`${name}的实施动作`],
                prerequisites: [`${name}的前置条件`],
              })),
              evidenceIds: ['evidence-11'],
            }, {
              type: 'investment' as const,
              headline: '首期投入优先保障公共空间与基础设施',
              items: [{
                name: '公共空间与基础设施', amount: '优先', unit: '投入序列',
                assumption: '按首期示范和骨架贯通需要排序',
              }],
              evidenceIds: ['evidence-12'],
            }],
          }),
    }
    const bundle = createClientReportBundle(
      { ...REPORT_INPUT, visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }] },
      profile,
    )

    await renderPptx({ report: bundle.report, plan: planClientPages(bundle.report, 'pptx'), identity: bundle.identity }, output)
    const deck = await inspectPptx(output)
    const timelineSlide = deck.slideTexts.findIndex(slide => slide.includes('三阶段把共同判断转化为连续行动')) + 1
    const phaseObjects = phases.map(phase => deck.textObjects.find(object =>
      object.slideNumber === timelineSlide && object.text.includes(phase)))
    const phaseObjectKeys = phaseObjects.map(object => object === undefined
      ? ''
      : `${object.x}|${object.y}|${object.width}|${object.height}|${object.text}`)
    const investmentSlide = deck.slideTexts.findIndex(slide => slide.includes('首期投入优先保障公共空间与基础设施')) + 1
    const investmentValue = deck.textObjects.find(object =>
      object.slideNumber === investmentSlide && object.text.trim() === '优先')
    const timelineXml = await pptxSlideXml(output, timelineSlide)
    const directionConnectors = deck.shapeObjects.filter(object =>
      object.slideNumber === timelineSlide && object.name.startsWith('ImplementationTimeline Direction Connector '))

    expect(phaseObjects.every(object => object !== undefined)).toBe(true)
    expect(new Set(phaseObjectKeys).size).toBe(phases.length)
    expect(phaseObjects.map(object => object?.fontSize)).toEqual([20, 20, 20])
    expect(directionConnectors, '三阶段之间应有两个连续方向连接').toHaveLength(2)
    directionConnectors.forEach((_, index) => {
      expectNamedArrow(timelineXml, `ImplementationTimeline Direction Connector ${index + 1}`)
    })
    for (const phase of phases) {
      expect(deck.slideTexts[timelineSlide - 1]).toContain(`${phase}的实施动作`)
      expect(deck.slideTexts[timelineSlide - 1]).toContain(`${phase}的前置条件`)
    }
    expect(investmentValue).toBeDefined()
    expect(investmentValue!.fontSize).toBeGreaterThanOrEqual(36)
  })

  it('renders analytical diagrams, a demand matrix, and an investment sequence on formerly text-only slides', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-analytical-visuals-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const profile = {
      ...CLIENT_PROFILE,
      chapters: CLIENT_PROFILE.chapters.map(chapter => chapter.id === 'chapter-07'
        ? {
            ...chapter,
            role: 'spatial' as const,
            claim: '一轴、两带、三核与多场景共同形成可步行、可停留的空间骨架。',
            blocks: [{
              type: 'narrative' as const,
              statement: '空间骨架优先连接门户、文化核心、生态水岸与社区入口。',
              evidenceIds: ['evidence-3'],
            }, {
              type: 'metric' as const,
              label: '连续开放界面', value: '一体化', unit: '空间系统', evidenceIds: ['evidence-7'],
            }],
          }
        : chapter.id === 'chapter-08'
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
          : chapter.id === 'chapter-09'
            ? {
                ...chapter,
                role: 'implementation' as const,
                blocks: [chapter.blocks[0]!, {
                  type: 'investment' as const,
                  headline: '首期投入优先保障公共空间与基础设施',
                  items: [{
                    name: '公共空间与基础设施', amount: '优先', unit: '投入序列',
                    assumption: '按首期示范和骨架贯通需要排序',
                  }],
                  evidenceIds: ['evidence-12'],
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
      evidence: CLIENT_PROFILE.evidence.map(row => row.evidenceId === 'evidence-10'
        ? { ...row, statement: '生态修复结论属于其他专题，不应出现在共同决策页页尾。' }
        : row.evidenceId === 'evidence-12'
          ? {
              ...row,
              statement: '首期投入按公共空间、基础设施和运营启动的共同需求排序。',
              unit: '投入序列', assumption: '未形成造价清单前仅表达相对优先级',
            }
          : row),
    }
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, profile)

    await renderPptx({ report: bundle.report, plan: planClientPages(bundle.report, 'pptx'), identity: bundle.identity }, output)
    const deck = await inspectPptx(output)
    const slideNumber = (headline: string) => deck.slideTexts.findIndex(text => text.includes(headline)) + 1
    const exactObjects = (slide: number, labels: readonly string[]) => labels.map(label => deck.textObjects.find(object =>
      object.slideNumber === slide && object.text.trim() === label))

    const urgency = slideNumber('为什么现在必须行动')
    const spatial = deck.slideTexts.findIndex(text => text.includes('门户') && text.includes('社区入口')) + 1
    const spatialSystem = deck.slideTexts.findIndex(text => text.includes('连续开放界面') && text.includes('一体化')) + 1
    const operating = deck.slideTexts.findIndex(text => text.includes('建设')
      && text.includes('内容策划') && text.includes('共同支撑长期活力')) + 1
    const matrix = slideNumber('多时段内容组合提升设施与空间使用效率')
    const investment = slideNumber('首期投入优先保障公共空间与基础设施')
    const decision = deck.slideTexts.findIndex(text =>
      text.includes('同步确定定位、首期边界与协同机制') && text.includes('总体定位')) + 1

    expect({ spatial, spatialSystem, operating, decision }).toEqual({
      spatial: 24,
      spatialSystem: 25,
      operating: 27,
      decision: 33,
    })

    expect(deck.slideTexts[urgency - 1]?.replace(/\s+/gu, '')).toContain('3个同步行动层')
    expect(deck.slideTexts[urgency - 1]).toContain('资源转化')
    expect(deck.slideTexts[urgency - 1]).toContain('空间连续')
    expect(deck.slideTexts[urgency - 1]).toContain('运营前置')

    const expectNamedTextFitsItsBox = (name: string) => {
      const shape = deck.shapeObjects.find(object => object.slideNumber === urgency && object.name === name)
      expect(shape, `PPTX 第${urgency}页缺少命名文本框：${name}`).toBeDefined()
      const textObject = deck.textObjects.find(object => object.slideNumber === urgency && object.text === shape?.text)
      expect(textObject, `PPTX 第${urgency}页无法读取文本框字号：${name}`).toBeDefined()
      const lineCapacity = shape!.width * 72 / textObject!.fontSize * 0.92
      const lineWidths = shape!.text.split('\n').map(line => [...line].reduce((width, character) => (
        width + (/^[\x00-\xff]$/u.test(character) ? 0.55 : 1)
      ), 0))
      expect(Math.max(...lineWidths), `${name} 会被 PowerPoint 再次自动换行并产生孤字`).toBeLessThanOrEqual(lineCapacity)
    }
    expectNamedTextFitsItsBox('AnalysisVisual Opening Claim')
    expectNamedTextFitsItsBox('AnalysisVisual Urgency Count')

    const spatialNodes = exactObjects(spatial, ['门户', '文化核心', '生态水岸', '社区入口'])
    expect(spatialNodes.every(object => object !== undefined)).toBe(true)
    expect(new Set(spatialNodes.map(object => `${object?.x}|${object?.y}`)).size).toBe(4)

    const shape = (slide: number, name: string) => {
      const found = deck.shapeObjects.find(object => object.slideNumber === slide && object.name === name)
      expect(found, `PPTX 第${slide}页缺少可编辑对象：${name}`).toBeDefined()
      return found!
    }
    for (const slide of [spatial, spatialSystem]) {
      for (const label of ['自定义示例总平面', '研究范围（待核）', '水岸', '功能分区', '非法定红线', '非测绘成果']) {
        expect(deck.slideTexts[slide - 1], `PPTX 第${slide}页缺少示例总平标识：${label}`).toContain(label)
      }
      shape(slide, 'EditableSitePlan Base')
      shape(slide, 'EditableSitePlan Research Boundary')
      shape(slide, 'EditableSitePlan Water')
      for (let index = 1; index <= 4; index += 1) shape(slide, `EditableSitePlan Functional Zone ${index}`)
    }

    for (const label of ['主轴', '慢行系统', '入口']) expect(deck.slideTexts[spatial - 1]).toContain(label)
    const sitePlanBase = shape(spatial, 'EditableSitePlan Base')
    const sitePlanBoundary = shape(spatial, 'EditableSitePlan Research Boundary')
    const movementNodes = Array.from({ length: 4 }, (_, index) => shape(spatial, `EditableSitePlan Movement Node ${index + 1}`))
    expect(movementNodes.every(node => node.x >= sitePlanBase.x
      && node.y >= sitePlanBase.y
      && node.x + node.width <= sitePlanBase.x + sitePlanBase.width
      && node.y + node.height <= sitePlanBase.y + sitePlanBase.height), 'P24 节点必须真正落在总平底图内').toBe(true)
    const spatialXml = await pptxSlideXml(output, spatial)
    for (let index = 1; index <= 3; index += 1) {
      const connector = shape(spatial, `EditableSitePlan Movement Arrow ${index}`)
      expect(connector.x).toBeGreaterThanOrEqual(sitePlanBase.x)
      expect(connector.x + connector.width).toBeLessThanOrEqual(sitePlanBase.x + sitePlanBase.width)
      expectNamedArrow(spatialXml, `EditableSitePlan Movement Arrow ${index}`)
    }
    const cultureCoreLabel = deck.textObjects.find(object => object.slideNumber === spatial
      && object.text.trim() === '文化核心')!
    const ecologyZoneLabel = deck.textObjects.find(object => object.slideNumber === spatial
      && object.text.trim() === '生态休闲')!
    expect(cultureCoreLabel).toBeDefined()
    expect(ecologyZoneLabel).toBeDefined()
    expect(
      cultureCoreLabel.x < ecologyZoneLabel.x + ecologyZoneLabel.width
      && cultureCoreLabel.x + cultureCoreLabel.width > ecologyZoneLabel.x
      && cultureCoreLabel.y < ecologyZoneLabel.y + ecologyZoneLabel.height
      && cultureCoreLabel.y + cultureCoreLabel.height > ecologyZoneLabel.y,
      'P24 文化核心与生态休闲标签不得重叠粘连',
    ).toBe(false)
    const entranceA = deck.textObjects.find(object => object.slideNumber === spatial && object.text.trim() === '入口 A')!
    const entranceB = deck.textObjects.find(object => object.slideNumber === spatial && object.text.trim() === '入口 B')!
    expect(entranceA.x, 'P24 入口 A 标签不得被左侧研究边界穿过').toBeGreaterThan(sitePlanBoundary.x + 0.05)
    expect(entranceB.x + entranceB.width, 'P24 入口 B 标签不得被右侧研究边界穿过').toBeLessThan(
      sitePlanBoundary.x + sitePlanBoundary.width - 0.05,
    )

    for (const label of ['一轴', '两带', '三核']) expect(deck.slideTexts[spatialSystem - 1]).toContain(label)
    const systemAxis = shape(spatialSystem, 'EditableSitePlan System Axis')
    const systemBands = Array.from({ length: 2 }, (_, index) => shape(spatialSystem, `EditableSitePlan System Band ${index + 1}`))
    for (let index = 1; index <= 3; index += 1) shape(spatialSystem, `EditableSitePlan System Core ${index}`)
    expectNamedArrow(await pptxSlideXml(output, spatialSystem), 'EditableSitePlan System Axis')
    expect(systemBands[0]!.x + systemBands[0]!.width, 'P25 两条功能带应保持清楚边界，不得大面积叠色').toBeLessThanOrEqual(
      systemBands[1]!.x - 0.1,
    )
    const waterfrontCore = shape(spatialSystem, 'EditableSitePlan System Core 3')
    expect(waterfrontCore.x, 'P25 滨水核心应落在生态水岸带内').toBeGreaterThanOrEqual(systemBands[1]!.x)
    expect(waterfrontCore.x + waterfrontCore.width, 'P25 滨水核心应落在生态水岸带内').toBeLessThanOrEqual(
      systemBands[1]!.x + systemBands[1]!.width,
    )
    for (const label of ['门户核心', '滨水核心']) {
      const object = deck.textObjects.find(candidate => candidate.slideNumber === spatialSystem && candidate.text.trim() === label)!
      expect(object).toBeDefined()
      expect(
        object.y + object.height <= systemAxis.y - 0.05 || object.y >= systemAxis.y + 0.05,
        `P25 公共主轴不得穿过${label}文字`,
      ).toBe(true)
    }
    expect(deck.textObjects.find(object => object.slideNumber === spatialSystem
      && object.text.trim() === '一轴 · 两带 · 三核')).toBeDefined()
    expect(deck.slideTexts[spatialSystem - 1], 'P25 策略叠加页不应把底图生态休闲色块误读为第三条系统带').not.toContain('生态休闲')
    for (const name of [
      'EditableSitePlan System Legend Axis Swatch',
      'EditableSitePlan System Legend Band Swatch',
      'EditableSitePlan System Legend Core Swatch',
    ]) shape(spatialSystem, name)
    for (const label of ['轴线', '功能带', '核心节点']) {
      expect(deck.textObjects.find(object => object.slideNumber === spatialSystem
        && object.text.trim() === label), `P25 图例缺少${label}释义`).toBeDefined()
    }

    for (const slide of [spatial, spatialSystem]) {
      const disclosureBand = deck.shapeObjects.find(object => object.slideNumber === slide
        && object.name === 'EditableSitePlan Disclosure Band')
      const disclosure = deck.shapeObjects.find(object => object.slideNumber === slide
        && object.name === 'EditableSitePlan Disclosure')
      expect(disclosureBand, `PPTX 第${slide}页边界前置条件应有独立提示条带`).toBeDefined()
      expect(disclosure?.text).toContain('正式资料前置')
      expect(disclosure?.text).toContain('总平图')
      expect(disclosure?.text).toContain('红线图')
      expect(disclosure?.text).toContain('带 CRS 的闭合坐标')
      expect(disclosure?.text).toContain('兼容 GeoJSON')
      expect(disclosure?.text).toContain('并由人确认')
      expect(disclosure?.text).toContain('研究范围（待核） · 非法定红线 · 非测绘成果')
      const disclosureLines = disclosure!.text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
      expect(disclosureLines, `PPTX 第${slide}页边界前置条件应按两条完整语义行排版`).toHaveLength(2)
      expect([...disclosureLines[1]!].length, `PPTX 第${slide}页边界前置条件不得出现极短尾行`).toBeGreaterThanOrEqual(24)
      expect(disclosureBand!.height).toBeGreaterThanOrEqual(0.36)
      const nextText = deck.textObjects
        .filter(object => object.slideNumber === slide
          && object.y > disclosureBand!.y
          && object.y < 6.5)
        .filter(object => !object.text.includes('正式资料前置'))
        .sort((left, right) => left.y - right.y)[0]
      expect(nextText, `PPTX 第${slide}页边界前置条件后应保留证据结论`).toBeDefined()
      expect(nextText!.y - (disclosureBand!.y + disclosureBand!.height),
        `PPTX 第${slide}页边界前置条件不得紧贴下方证据文字`).toBeGreaterThanOrEqual(0.08)
    }

    expect(deck.slideTexts[operating - 1]).toContain('共同价值')
    const commonValue = shape(operating, 'AnalysisVisual Operating Common Value')
    const operatingXml = await pptxSlideXml(output, operating)
    for (let index = 1; index <= 3; index += 1) {
      const strategy = shape(operating, `AnalysisVisual Operating Strategy ${index}`)
      const strategyArrow = shape(operating, `AnalysisVisual Operating Strategy Arrow ${index}`)
      const team = shape(operating, `AnalysisVisual Operating Team ${index}`)
      const teamArrow = shape(operating, `AnalysisVisual Operating Team Arrow ${index}`)
      expect(strategy.y + strategy.height).toBeLessThanOrEqual(strategyArrow.y + 0.03)
      expect(strategyArrow.y + strategyArrow.height).toBeLessThanOrEqual(commonValue.y + 0.03)
      expect(teamArrow.y).toBeGreaterThanOrEqual(commonValue.y + commonValue.height - 0.03)
      expect(teamArrow.y + teamArrow.height).toBeLessThanOrEqual(team.y + 0.03)
      expectNamedArrow(operatingXml, `AnalysisVisual Operating Strategy Arrow ${index}`)
      expectNamedArrow(operatingXml, `AnalysisVisual Operating Team Arrow ${index}`)
    }
    const teamHeading = deck.textObjects.find(object => object.slideNumber === operating
      && object.text.trim() === '建设 / 内容策划 / 运营三团队')!
    const operatingTeams = Array.from({ length: 3 }, (_, index) => shape(operating, `AnalysisVisual Operating Team ${index + 1}`))
    expect(teamHeading.x).toBeLessThanOrEqual(operatingTeams[0]!.x)
    expect(teamHeading.x + teamHeading.width).toBeGreaterThanOrEqual(
      operatingTeams[2]!.x + operatingTeams[2]!.width,
    )
    expect(deck.shapeObjects.filter(object => object.slideNumber === operating
      && object.name.startsWith('AnalysisVisual Operating Team Rule ')), 'P27 不应保留穿越连接线的橙色结构线').toEqual([])

    for (const label of ['日常休闲', '周末活动', '城市节庆', '周边居民', '城市家庭', '青年客群']) {
      expect(deck.slideTexts[matrix - 1]).toContain(label)
    }
    for (const label of ['01 公共空间', '02 基础设施', '03 运营启动', '相对优先级，不代表造价金额']) {
      expect(deck.slideTexts[investment - 1]).toContain(label)
    }
    for (const label of ['确认总体定位', '确认首期启动边界', '确认建设与运营协同机制']) {
      expect(deck.slideTexts[decision - 1]).toContain(label)
    }
    expect(deck.slideTexts[decision - 1]).toContain('形成统一输入（定位结论·首期边界图·协同机制）')
    const closing = slideNumber('把共同判断转化为下一步行动')
    for (const output of ['概念深化', '专题测算', '首期实施清单']) {
      expect(deck.slideTexts[closing - 1]).toContain(output)
    }
    expect(deck.slideTexts[decision - 1]).not.toContain('生态修复结论')
    const commonUnlock = shape(decision, 'AnalysisVisual Decision Common Input')
    const decisionXml = await pptxSlideXml(output, decision)
    for (let index = 1; index <= 3; index += 1) {
      const decisionNode = shape(decision, `AnalysisVisual Decision Input ${index}`)
      const connector = shape(decision, `AnalysisVisual Decision Arrow ${index}`)
      expect(decisionNode.y + decisionNode.height).toBeLessThanOrEqual(connector.y + 0.03)
      expect(connector.y + connector.height).toBeLessThanOrEqual(commonUnlock.y + 0.03)
      expectNamedArrow(decisionXml, `AnalysisVisual Decision Arrow ${index}`)
    }
  })

  it('keeps the golden investment sequence numeric and explicitly marked as example data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-golden-investment-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const profile = {
      ...CLIENT_PROFILE,
      chapters: CLIENT_PROFILE.chapters.map(chapter => chapter.id !== 'chapter-09'
        ? chapter
        : {
            ...chapter,
            blocks: [chapter.blocks[0]!, {
              type: 'investment' as const,
              headline: '首期投入优先保障公共空间与基础设施',
              items: [
                { name: '示范先行', amount: '1200', unit: '万元', assumption: '测试阶段示例测算' },
                { name: '骨架成网', amount: '2800', unit: '万元', assumption: '测试阶段示例测算' },
                { name: '场景扩展', amount: '4500', unit: '万元', assumption: '测试阶段示例测算' },
              ],
              evidenceIds: ['evidence-12'],
            }],
          }),
    }
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, profile)

    await renderPptx({ report: bundle.report, plan: planClientPages(bundle.report, 'pptx'), identity: bundle.identity }, output)
    const deck = await inspectPptx(output)
    const investment = deck.slideTexts.findIndex(text => text.includes('首期投入优先保障公共空间与基础设施')) + 1
    const text = deck.slideTexts[investment - 1]

    for (const value of ['1200 万元', '2800 万元', '4500 万元']) expect(text).toContain(value)
    expect(text).toContain('测试阶段示例投资测算')
    expect(text.match(/测试阶段示例测算/gu)).toHaveLength(1)
    expect(deck.shapeObjects.filter(object => object.slideNumber === investment
      && object.name === 'AnalysisVisual Investment Shared Basis')).toHaveLength(1)
  })
})
