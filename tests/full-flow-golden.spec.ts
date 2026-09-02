import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runGoldenProject } from '../scripts/build-golden-project.ts'
import { inspectClientArtifacts } from '../scripts/inspect-client-artifacts.ts'
import { inspectPptx } from './support/pptx-inspector.ts'

const fixtureRoot = fileURLToPath(new URL('./fixtures/golden-project/', import.meta.url))
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const roots: string[] = []
const execFileAsync = promisify(execFile)
const PROFESSIONAL_SOURCE_SUMMARIES = [
  '示例场地分析资料（待项目实测校核） · 2026-08-28 · 城市区位',
  '示例场地分析资料（待项目实测校核） · 2026-08-28 · 研究范围',
  '示例场地分析资料（待项目实测校核） · 2026-08-28 · 现状分布',
  '示例场地分析资料（待项目实测校核） · 2026-08-28 · 交通可达',
  '示例研究数据（待项目实测校核） · 2026-08-28 · 内部流线',
  '示例场地分析资料（待项目实测校核） · 2026-08-28 · 资源限制',
  '示例研究数据（待项目实测校核） · 2026-08-28 · 现状空间构成',
  '示例研究数据（待项目实测校核） · 2026-08-28 · 客群与时段需求',
  '示例研究数据（待项目实测校核） · 2026-08-28 · 步行服务半径',
  '示例研究数据（待项目实测校核） · 2026-08-28 · 运营收支结构',
  '示例研究数据（待项目实测校核） · 2026-08-28 · 分期建设节奏',
  '示例研究数据（待项目实测校核） · 2026-08-28 · 产品价值贡献',
] as const
const CARTOGRAPHY_SUMMARIES = [
  '项目边界：不适用 · 图例 · N · NTS',
  '研究范围（待核） · 非法定红线 · 非测绘成果 · 图例 · N · 0 50 100m',
  '项目边界：不适用 · 图例 · N · 0 50 100m',
  '项目边界：不适用 · 图例 · N · NTS',
  '项目边界：不适用 · 图例 · N · NTS',
  '项目边界：不适用 · 图例 · N · NTS',
] as const
const CHART_SUMMARIES = [
  '单位：% · 口径：按示例研究空间分类面积占比汇总，待项目实测校核',
  '单位：人次/日 · 口径：按示例研究典型日分时到访需求估算，待项目实测校核',
  '单位：万人 · 口径：按示例研究步行等时圈覆盖人口估算，待项目实测校核',
  '单位：万元/年 · 口径：按示例研究分阶段运营收支估算，待项目实测校核',
  '单位：万元 · 口径：按示例研究建设包估算投资节奏，待项目实测校核',
  '单位：价值指数 · 口径：按示例研究公共性、吸引力与运营协同三项加权评分，待项目实测校核',
] as const

function expectProfessionalVisualContract(medium: string, text: string): void {
  const normalizedText = text.replace(/<[^>]*>/gu, '').replace(/\r?\n/gu, '')
  for (const summary of PROFESSIONAL_SOURCE_SUMMARIES) expect(normalizedText, `${medium} 缺少来源摘要：${summary}`).toContain(summary)
  for (const summary of CARTOGRAPHY_SUMMARIES) expect(normalizedText, `${medium} 缺少制图摘要：${summary}`).toContain(summary)
  for (const summary of CHART_SUMMARIES) expect(normalizedText, `${medium} 缺少图表摘要：${summary}`).toContain(summary)
  expect(normalizedText.match(/(?:项目边界：[^·<\n]+|研究范围（待核） · 非法定红线 · 非测绘成果) · 图例 · N · (?:NTS|0 50 100m)/gu) ?? [], `${medium} 制图摘要数量不为六组`).toHaveLength(6)
  expect(text.match(/单位：/gu) ?? [], `${medium} 图表摘要数量不为六组`).toHaveLength(6)
  expect(text, `${medium} 泄露工程内部措辞`).not.toMatch(/工程夹具|工程冻结/u)
  expect(text, `${medium} 泄露 SHA`).not.toMatch(/\b[a-f0-9]{64}\b/iu)
  expect(text, `${medium} 泄露源路径`).not.toMatch(/[A-Z]:[\\/]/u)
  expect(text, `${medium} 泄露实现来源标签`).not.toMatch(/\b(?:sourceKind|deterministic|project-source|ai-concept|provider|model|antigravity|gemini-3\.1-flash-image|openai-completions)\b/iu)
  expect(text, `${medium} 泄露 AI 制作方式`).not.toMatch(/AI\s*(?:制作|生成)|生成方式|制作方式/iu)
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Golden Project full flow', () => {
  it('keeps the chart-access professional SHA aligned across profile, provenance, manifest, and file bytes', async () => {
    const profile = JSON.parse(await readFile(join(fixtureRoot, 'client-profile.json'), 'utf8')) as {
      assetBindings: Array<{
        assetId: string
        sha256?: string
        provenance?: { sourceFileSha256?: string }
      }>
    }
    const manifest = JSON.parse(await readFile(join(fixtureRoot, 'evidence-manifest.json'), 'utf8')) as {
      assets: Array<{ assetId: string; file: string; sha256: string }>
    }
    const binding = profile.assetBindings.find(row => row.assetId === 'chart-access')
    const asset = manifest.assets.find(row => row.assetId === 'chart-access')

    expect(binding, 'client-profile 缺少 chart-access binding').toBeDefined()
    expect(asset, 'evidence-manifest 缺少 chart-access asset').toBeDefined()
    expect(asset?.file).toBe('assets/chart-access.svg')

    const fileBytes = await readFile(join(fixtureRoot, asset!.file))
    const fileSha256 = createHash('sha256').update(fileBytes).digest('hex')
    expect(binding?.provenance?.sourceFileSha256, 'provenance SHA 与 binding 专业 SHA 不一致').toBe(binding?.sha256)
    expect(asset?.sha256, 'manifest SHA 与 binding 专业 SHA 不一致').toBe(binding?.sha256)
    expect(fileSha256, 'chart-access.svg 实际 SHA 与 binding 专业 SHA 不一致').toBe(binding?.sha256)
  })

  it('defaults the v0.8 engineering Golden research preview to HTML only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-golden-v080-'))
    roots.push(root)
    const outputRoot = join(root, 'engineering-golden')

    const result = await runGoldenProject(fixtureRoot, outputRoot, { browserExecutable: edge })

    expect(result.publishable).toBe(false)
    expect(result.evidence.artifacts.map(row => row.format)).toEqual(['html'])
    expect(result.adoptedAssetIds).not.toContain('map-boundary')
    expect(existsSync(join(outputRoot, 'artifact-manifest.json'))).toBe(false)
    expect(existsSync(join(outputRoot, 'qa', 'research-preview-evidence.json'))).toBe(true)
    expect(existsSync(join(outputRoot, 'print'))).toBe(false)
    expect(existsSync(join(outputRoot, 'report.pptx'))).toBe(false)
    expect(existsSync(join(outputRoot, 'report.pdf'))).toBe(false)
    expect((await readdir(outputRoot, { recursive: true })).filter(entry => entry.split(/[\\/]/u).some(segment => segment.startsWith('.staging-')))).toEqual([])
    expect(result.client).toMatchObject({
      schemaVersion: 'preplan.client-report.v1',
      pptxPages: 0,
      pdfPages: 0,
      forbiddenTermHits: [],
    })
    const inspection = await inspectClientArtifacts(outputRoot, { evidencePath: 'qa/research-preview-evidence.json' })
    expect(inspection).toMatchObject({
      identitiesEqual: true,
      coreValueOccurrences: { html: 1, pptx: 0, pdfSource: 0 },
      missingAssetIds: [],
      forbiddenTermHits: [],
      htmlPages: 35,
      pptxPages: 0,
      pdfSourcePages: 0,
      professionalVisualPages: { html: 12, pptx: 0, pdfSource: 0 },
    })
    await expect(runGoldenProject(fixtureRoot, outputRoot, { browserExecutable: edge }))
      .rejects.toThrow(/refusing to overwrite existing research preview/u)
  }, 60_000)

  it('uses the same core value and adopted assets in all explicitly requested research-preview formats', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-golden-v080-'))
    roots.push(root)
    const outputRoot = join(root, 'engineering-golden')
    await runGoldenProject(fixtureRoot, outputRoot, { browserExecutable: edge, formats: ['html', 'pptx', 'pdf'] })

    const inspection = await inspectClientArtifacts(outputRoot, { evidencePath: 'qa/research-preview-evidence.json' })

    expect(inspection.identitiesEqual).toBe(true)
    expect(inspection.coreValueOccurrences).toEqual({ html: 1, pptx: 1, pdfSource: 1 })
    expect(inspection.missingAssetIds).toEqual([])
    expect(inspection.forbiddenTermHits).toEqual([])
    expect(inspection.professionalVisualPages).toEqual({ html: 12, pptx: 12, pdfSource: 12 })
  }, 60_000)

  it('renders complete professional visual summaries in each research-preview medium without implementation provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-golden-visual-contract-'))
    roots.push(root)
    const outputRoot = join(root, 'engineering-golden')
    await runGoldenProject(fixtureRoot, outputRoot, { browserExecutable: edge, formats: ['html', 'pptx', 'pdf'] })

    const html = await readFile(join(outputRoot, 'html', 'index.html'), 'utf8')
    const printHtml = await readFile(join(outputRoot, 'print', 'index.html'), 'utf8')
    const deck = await inspectPptx(join(outputRoot, 'report.pptx'))
    const pptxText = deck.slideTexts.join('\n')
    const chartAccessSvg = await readFile(join(fixtureRoot, 'assets', 'chart-access.svg'), 'utf8')
    const profile = JSON.parse(await readFile(join(fixtureRoot, 'client-profile.json'), 'utf8')) as {
      assetBindings: Array<{ assetId: string; chartContract?: { unit: string; methodology: string } }>
    }
    const manifest = JSON.parse(await readFile(join(fixtureRoot, 'evidence-manifest.json'), 'utf8')) as {
      assets: Array<{ assetId: string; caption: string }>
    }

    for (const [medium, text] of [['HTML', html], ['打印 HTML（PDF 同源输入）', printHtml], ['PPTX', pptxText]] as const) {
      expectProfessionalVisualContract(medium, text)
    }
    const boundaryTitle = deck.textObjects.find(object => object.slideNumber === 7
      && object.text.replace(/\n/gu, '') === '示例研究范围明确本次分析边界')
    expect(boundaryTitle, 'PPTX 第7页缺少客户范围图标题').toBeDefined()
    const boundaryTitleLines = boundaryTitle?.text.split('\n') ?? []
    expect(boundaryTitleLines.join('')).toBe('示例研究范围明确本次分析边界')
    expect(boundaryTitleLines, 'PPTX 第7页标题超过两行预算').toHaveLength(2)
    expect(boundaryTitleLines.every(line => [...line].length <= 10), 'PPTX 第7页标题单行超出保守宽度预算').toBe(true)
    expect(boundaryTitle?.usesNormAutofit, 'PPTX 第7页标题不应依赖自动缩放').toBe(false)
    expect(boundaryTitle?.y, 'PPTX 第7页标题向上越界').toBeGreaterThanOrEqual(0.15)
    expect(boundaryTitle?.height, 'PPTX 第7页标题文本框超出两行预算').toBeLessThanOrEqual(0.9)
    for (const expected of [
      { slideNumber: 5, headline: '滨江更新从单点改造转向城市价值重构', legacyHeadline: '滨江更新需要从单点改造转向城市价值重构', maxLines: 1 },
      { slideNumber: 8, headline: '空间割裂与活力不足是当前核心矛盾', legacyHeadline: '空间割裂与活力不足是当前最需要解决的矛盾', maxLines: 1 },
      { slideNumber: 16, headline: '复合客群支撑全天候目的地', legacyHeadline: '客群与时段需求数据共同支撑全天候复合生活目的地', maxLines: 2 },
      { slideNumber: 19, headline: '运营投入兼顾体验与韧性', legacyHeadline: '运营投入与公共服务协同创造持续体验与韧性价值', maxLines: 2 },
      { slideNumber: 23, headline: '连续空间让产品、活动与人流真正发生', legacyHeadline: '连续开放空间让产品、活动和人流真正发生', maxLines: 1 },
      { slideNumber: 32, headline: '锁定定位、首期边界与实施机制', legacyHeadline: '本次决策应锁定定位、首期边界与实施机制', maxLines: 1 },
    ]) {
      const title = deck.textObjects.find(object => object.slideNumber === expected.slideNumber
        && object.text.replace(/\n/gu, '') === expected.headline)
      expect(title, `PPTX 第${expected.slideNumber}页缺少缩短后的客户标题`).toBeDefined()
      const charactersPerLine = Math.floor(title!.width * 72 / title!.fontSize)
      const estimate = (headline: string): { lineCount: number; finalLineCharacters: number } => ({
        lineCount: Math.ceil([...headline].length / charactersPerLine),
        finalLineCharacters: [...headline].length % charactersPerLine || charactersPerLine,
      })
      const actualLines = title!.text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
      expect(charactersPerLine, `PPTX 第${expected.slideNumber}页标题文本框无有效字宽`).toBeGreaterThanOrEqual(6)
      expect(actualLines.length, `PPTX 第${expected.slideNumber}页标题超出安全行数预算`).toBeLessThanOrEqual(expected.maxLines)
      if (actualLines.length === 2) expect([...actualLines[1]!].length, `PPTX 第${expected.slideNumber}页标题出现孤字或极短尾行`).toBeGreaterThanOrEqual(2)
      const legacy = estimate(expected.legacyHeadline)
      expect(legacy.lineCount > expected.maxLines || (legacy.lineCount === 2 && legacy.finalLineCharacters < 2),
        `PPTX 第${expected.slideNumber}页旧标题 mutation 未触发版面门禁`).toBe(true)
    }
    const expectSemanticTerm = (slideNumber: number, fullText: string, term: string): void => {
      const object = deck.textObjects.find(candidate => candidate.slideNumber === slideNumber
        && candidate.text.replace(/\n/gu, '') === fullText)
      expect(object, `PPTX 第${slideNumber}页缺少语义文本：${fullText}`).toBeDefined()
      const lines = object!.text.split('\n')
      const breakOffsets = lines.slice(0, -1).reduce<number[]>((offsets, line) => [
        ...offsets,
        (offsets.at(-1) ?? 0) + [...line].length,
      ], [])
      const termStart = fullText.indexOf(term)
      expect(breakOffsets.some(offset => offset > termStart && offset < termStart + [...term].length),
        `PPTX 第${slideNumber}页拆开语义词组：${term} / ${object!.text}`).toBe(false)
    }
    expectSemanticTerm(1, '滨江文化活力区价值重构提案', '滨江文化活力区')
    expectSemanticTerm(3, '存量提质阶段需要尽快把滨水资源转化为可使用、可运营的城市界面', '滨水资源')
    expectSemanticTerm(3, '3 个同步行动层', '行动层')
    expectSemanticTerm(4, '以公共文化主轴串联滨水开放空间，形成持续发生的城市生活目的地', '形成持续发生的城市生活目的地')
    expectSemanticTerm(29, '首期启动区优先验证公共界面与运营模型', '公共界面')

    for (const [slideNumber, labels] of [
      [24, ['自定义示例总平面', '研究范围（待核）', '水岸', '主轴', '慢行系统', '入口', '功能分区', '非法定红线', '非测绘成果']],
      [25, ['自定义示例总平面', '研究范围（待核）', '水岸', '一轴', '两带', '三核', '功能分区', '非法定红线', '非测绘成果']],
    ] as const) {
      for (const label of labels) expect(deck.slideTexts[slideNumber - 1], `PPTX 第${slideNumber}页缺少总平信息：${label}`).toContain(label)
      for (const name of ['EditableSitePlan Base', 'EditableSitePlan Research Boundary', 'EditableSitePlan Water']) {
        expect(deck.shapeObjects.some(object => object.slideNumber === slideNumber && object.name === name),
          `PPTX 第${slideNumber}页缺少可编辑总平对象：${name}`).toBe(true)
      }
    }
    expect(deck.shapeObjects.filter(object => object.slideNumber === 24
      && object.name.startsWith('EditableSitePlan Movement Arrow '))).toHaveLength(3)
    expect(deck.shapeObjects.filter(object => object.slideNumber === 25
      && /^EditableSitePlan System Band \d+$/u.test(object.name))).toHaveLength(2)
    expect(deck.shapeObjects.filter(object => object.slideNumber === 25
      && /^EditableSitePlan System Core \d+$/u.test(object.name))).toHaveLength(3)

    expect(deck.slideTexts[26]).toContain('共同价值')
    expect(deck.shapeObjects.filter(object => object.slideNumber === 27
      && /AnalysisVisual Operating (?:Strategy|Team) Arrow/u.test(object.name))).toHaveLength(6)
    expect(deck.shapeObjects.filter(object => object.slideNumber === 30
      && object.name.startsWith('ImplementationTimeline Direction Connector '))).toHaveLength(2)
    expect(deck.slideTexts[32]).toContain('形成统一输入（定位结论·首期边界图·协同机制）')
    expect(deck.slideTexts[32]).not.toContain('共同解锁')
    expect(deck.slideTexts[32]).not.toContain('生态设施应与公共空间和景观体验一体设计')
    expect(deck.shapeObjects.filter(object => object.slideNumber === 33
      && object.name.startsWith('AnalysisVisual Decision Arrow '))).toHaveLength(3)
    expect(deck.slideTexts[34]).toContain('共同解锁')
    for (const slideNumber of [27, 30, 31]) {
      const content = deck.textObjects.filter(object => object.slideNumber === slideNumber
        && object.y >= 2
        && object.y < 6.4
        && object.fontSize >= 10)
      expect(content.length, `PPTX 第${slideNumber}页缺少实施内容`).toBeGreaterThanOrEqual(2)
      expect(content.filter(object => object.height > 2.45), `PPTX 第${slideNumber}页仍存在纵向居中的大空白卡`).toEqual([])
      const primaryCopy = content.find(object => object.fontSize >= 20 && object.x < 7)
      expect(primaryCopy, `PPTX 第${slideNumber}页缺少左侧实施判断`).toBeDefined()
      const primaryLines = primaryCopy!.text.split('\n')
      expect(primaryLines.every(line => [...line].length <= 20),
        `PPTX 第${slideNumber}页实施判断超过安全行宽：${primaryCopy!.text}`).toBe(true)
      expect(primaryLines.filter(line => /^[。！？；：，、]+$/u.test(line)),
        `PPTX 第${slideNumber}页出现独立标点行`).toEqual([])
    }
    const matrixContent = deck.textObjects.filter(object => object.slideNumber === 28
      && object.y >= 2
      && object.y < 6.4
      && object.fontSize >= 10)
    expect(matrixContent.length, 'PPTX 第28页缺少客群与场景矩阵内容').toBeGreaterThanOrEqual(10)
    expect(matrixContent.filter(object => object.height > 2.45), 'PPTX 第28页仍存在纵向居中的大空白卡').toEqual([])
    for (const label of ['日常休闲', '周末活动', '城市节庆', '周边居民', '城市家庭', '青年客群']) {
      expect(deck.slideTexts[27], `PPTX 第28页矩阵缺少标签：${label}`).toContain(label)
    }
    expect(matrixContent.filter(object => ['高', '中', '低'].includes(object.text.trim())),
      'PPTX 第28页矩阵缺少独立需求强度单元').toHaveLength(9)
    for (const slideNumber of [1, 4, 5, 6, 8, 9, 11, 12, 14, 16, 17, 19, 20, 22, 23, 26, 29, 32, 35]) {
      const footer = deck.textObjects.find(object => object.slideNumber === slideNumber
        && object.text === '前期策划成果提案'
        && object.y >= 6.8)
      expect(footer, `PPTX 第${slideNumber}页缺少页脚`).toBeDefined()
      expect(footer!.color, `PPTX 第${slideNumber}页深色背景页脚对比不足`).toBe('C9D7D8')
      const pageNumber = deck.textObjects.find(object => object.slideNumber === slideNumber
        && object.text === String(slideNumber).padStart(2, '0')
        && object.y >= 6.8)
      expect(pageNumber, `PPTX 第${slideNumber}页缺少页码`).toBeDefined()
      expect(pageNumber!.color, `PPTX 第${slideNumber}页深色背景页码对比不足`).toBe('F5F5F7')
    }
    const mutatedSource = deck.textObjects.find(object =>
      object.text.replace(/\n/gu, '').includes(PROFESSIONAL_SOURCE_SUMMARIES[11]))?.text
    expect(mutatedSource, 'PPTX mutation 缺少可删除的产品价值来源对象').toBeDefined()
    expect(() => expectProfessionalVisualContract('PPTX mutation', pptxText.replace(mutatedSource!, ''))).toThrow()
    expect(chartAccessSvg).toContain('5分钟　0.8万人')
    expect(chartAccessSvg).toContain('10分钟　2.4万人')
    expect(chartAccessSvg).toContain('15分钟　4.7万人')
    expect(chartAccessSvg).toContain('单位：万人')
    expect(profile.assetBindings.find(binding => binding.assetId === 'chart-access')?.chartContract).toEqual({
      unit: '万人',
      methodology: '按示例研究步行等时圈覆盖人口估算，待项目实测校核',
    })
    expect(manifest.assets.find(asset => asset.assetId === 'chart-access')?.caption)
      .toBe('交通可达性与步行服务半径｜示例研究数据（待项目实测校核）')
  }, 60_000)

  it('renders local project-source visuals without source-method labels in research preview', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-golden-source-'))
    roots.push(root)
    const localFixture = join(root, 'fixture')
    const outputRoot = join(root, 'source-golden')
    await cp(fixtureRoot, localFixture, { recursive: true })
    const manifestPath = join(localFixture, 'evidence-manifest.json')
    const profilePath = join(localFixture, 'client-profile.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      provider: string
      model: string
      assets: Array<Record<string, unknown>>
    }
    manifest.provider = 'project-source'
    manifest.model = 'frozen-reference-deck'
    manifest.assets = manifest.assets.map(asset => ({ ...asset, kind: 'evidence' }))
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8')
    const profile = JSON.parse(await readFile(profilePath, 'utf8')) as {
      assetBindings: Array<Record<string, unknown>>
    }
    profile.assetBindings = profile.assetBindings.map(({ disclosure: _disclosure, ...binding }) => binding)
    await writeFile(profilePath, JSON.stringify(profile), 'utf8')

    await runGoldenProject(localFixture, outputRoot, { browserExecutable: edge, formats: ['html', 'pptx', 'pdf'] })
    const html = await readFile(join(outputRoot, 'html', 'index.html'), 'utf8')

    expect(html).not.toContain('class="asset-disclosure"')
  }, 60_000)

  it('CLI defaults to HTML and rejects a format list without HTML before creating output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-golden-cli-'))
    roots.push(root)
    const outputRoot = join(root, 'cli-default')
    const script = join(process.cwd(), 'scripts', 'build-golden-project-cli.ts')
    const tsx = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')

    await execFileAsync(process.execPath, [tsx, script, '--fixture', fixtureRoot, '--output', outputRoot])

    expect(existsSync(join(outputRoot, 'html', 'index.html'))).toBe(true)
    expect(existsSync(join(outputRoot, 'print'))).toBe(false)
    expect(existsSync(join(outputRoot, 'report.pptx'))).toBe(false)
    expect(existsSync(join(outputRoot, 'report.pdf'))).toBe(false)

    const invalidOutput = join(root, 'cli-invalid')
    await expect(execFileAsync(process.execPath, [tsx, script, '--fixture', fixtureRoot, '--output', invalidOutput, '--formats', 'pptx,pdf']))
      .rejects.toThrow(/formats must include html/u)
    expect(existsSync(invalidOutput)).toBe(false)

    const duplicateOutput = join(root, 'cli-duplicate')
    await expect(execFileAsync(process.execPath, [tsx, script, '--fixture', fixtureRoot, '--output', duplicateOutput, '--formats', 'html,html']))
      .rejects.toThrow(/formats must not contain duplicates/u)
    expect(existsSync(duplicateOutput)).toBe(false)
  }, 60_000)
})
