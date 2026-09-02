import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { planClientPages } from '../src/report/page-plan.ts'
import { renderPdf } from '../src/report/render-pdf.ts'
import { renderPrintHtml } from '../src/report/render-print-html.ts'
import { readHtmlArtifactIdentity } from '../src/report/validate-artifacts.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const { JSDOM } = require('jsdom') as {
  JSDOM: new (source: string) => { window: { document: Document } }
}

const roots: string[] = []
function visibleText(fragment: string): string {
  return new JSDOM(fragment).window.document.body.textContent ?? ''
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function professionalVariantContext(root: string) {
  const sourceImage = join(root, 'professional-layout.png')
  await writeFile(sourceImage, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ))
  const bundle = createClientReportBundle({
    ...REPORT_INPUT,
    visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
  }, CLIENT_PROFILE)
  const roles = ['map', 'diagram', 'chart'] as const
  const variants = ['editorial', 'full-bleed', 'split'] as const
  const assets = roles.map((role, index) => ({
    ...bundle.report.assets[0]!,
    assetId: `professional-layout-${index + 1}`,
    role,
    chapterId: bundle.report.chapters[index]!.id,
    caption: `专业构图图片 ${variants[index]}`,
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
            : {
                type: 'evidence' as const,
                headline: `专业构图 ${variants[index]}`,
                evidenceIds: block.type === 'narrative' ? block.evidenceIds : [],
                assetIds: [assets[index]!.assetId],
              }),
        }),
  }
  const basePlan = planClientPages(report, 'pdf')
  const plan = {
    ...basePlan,
    pages: basePlan.pages.map(page => {
      const index = assets.findIndex(asset => page.assetIds.includes(asset.assetId))
      return index < 0 ? page : { ...page, layoutVariant: variants[index]! }
    }),
  }
  return { report, plan, identity: bundle.identity }
}

async function serializedProfessionalRunContext(root: string) {
  const sourceImage = join(root, 'serialized-professional-run.png')
  await writeFile(sourceImage, Buffer.from([1, 2, 3]))
  const bundle = createClientReportBundle({
    ...REPORT_INPUT,
    visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
  }, CLIENT_PROFILE)
  const chapter = bundle.report.chapters[1]!
  const roles = Array.from({ length: 12 }, (_, index) =>
    (['map', 'chart', 'diagram'] as const)[index % 3]!)
  const assets = roles.map((role, index) => ({
    ...bundle.report.assets[0]!,
    assetId: `serialized-professional-${index + 1}`,
    role,
    chapterId: chapter.id,
    caption: `序列化专业图件 ${index + 1}`,
  }))
  const report = {
    ...bundle.report,
    assets: [...bundle.report.assets, ...assets],
    chapters: bundle.report.chapters.map(candidate => candidate.id !== chapter.id
      ? candidate
      : {
          ...candidate,
          blocks: assets.map((asset, index) => ({
            type: 'evidence' as const,
            headline: `序列化专业判断 ${index + 1}`,
            evidenceIds: [bundle.report.evidence[index % bundle.report.evidence.length]!.evidenceId],
            assetIds: [asset.assetId],
          })),
        }),
  }
  const plan = JSON.parse(JSON.stringify(planClientPages(report, 'pdf'))) as ReturnType<typeof planClientPages>
  return { report, plan, identity: bundle.identity }
}

describe('renderPdf', () => {
  it('carries the formal boundary digest from print HTML into PDF metadata identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-formal-boundary-print-'))
    roots.push(root)
    const sourceImage = join(root, 'concept-1.png')
    const pdf = join(root, 'report.pdf')
    await writeFile(sourceImage, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{
        ...REPORT_INPUT.visualAssets[0]!, kind: 'evidence', sourcePath: sourceImage,
        sha256: 'a'.repeat(64), width: 1, height: 1,
      }],
      siteBoundary: {
        boundaryId: 'boundary-1', assetId: 'concept-1', status: 'confirmed', confirmedRevision: 57,
        source: 'approved_redline', sourceSha256: 'a'.repeat(64), assetSha256: 'a'.repeat(64), integrityDigest: 'd'.repeat(64),
      },
    }, { ...CLIENT_PROFILE, assetBindings: [], requiredVisualRoles: ['map'] })
    const html = await renderPrintHtml({ report: bundle.report, plan: planClientPages(bundle.report, 'pdf'), identity: bundle.identity }, root)
    expect(readHtmlArtifactIdentity(await readFile(html, 'utf8')).siteBoundaryIntegrityDigest).toBe('d'.repeat(64))
    await renderPdf(html, pdf, 'fake-edge.exe', async () => { await writeFile(pdf, Buffer.from('%PDF-1.7\n%%EOF')) })
    const encoded = (await readFile(pdf)).toString('latin1').split('%PREPLAN-METADATA:').at(-1)?.trim() ?? ''
    expect(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))).toMatchObject({ siteBoundaryIntegrityDigest: 'd'.repeat(64) })
  })

  it('rejects a profile-created research boundary without governed synthetic research input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-boundary-print-'))
    roots.push(root)
    const sourceImage = join(root, 'boundary.png')
    await writeFile(sourceImage, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    const profile = {
      ...CLIENT_PROFILE,
      assetBindings: [{ ...CLIENT_PROFILE.assetBindings[0]!, role: 'map' as const, chapterId: 'chapter-01', analysisKind: 'site-boundary' as const,
        provenance: { sourceLabel: '工程夹具范围', sourceDate: '2026-08-28', locator: 'boundary', sourceFileSha256: 'b'.repeat(64), evidenceIds: ['evidence-1'] },
        cartography: { boundary: 'research' as const, disclosures: ['研究范围（待核）', '非法定红线', '非测绘成果'], legend: 'present' as const, northArrow: 'present' as const, scale: { kind: 'nts' as const } },
      }], requiredVisualRoles: ['map' as const],
    }
    expect(() => createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, profile)).toThrow('SITE_BOUNDARY_PROFILE_CONFLICT')
  })

  it('builds a 48-72 page print source without client-visible governance fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-print-html-'))
    roots.push(root)
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
      plan: planClientPages(bundle.report, 'pdf'),
      identity: bundle.identity,
    }

    const path = await renderPrintHtml(context, root)
    const html = await readFile(path, 'utf8')
    const body = html.match(/<body[\s\S]*<\/body>/u)?.[0] ?? ''
    const printPages = html.match(/class="print-page/gu) ?? []

    expect(printPages.length).toBeGreaterThanOrEqual(48)
    expect(printPages.length).toBeLessThanOrEqual(72)
    expect(body).not.toMatch(/Gate|Revision|Workflow|工作项|完成度/iu)
    expect(html).toContain('data-page-kind="appendix"')
    expect(html).not.toMatch(/https?:\/\//iu)
    const closing = (html.match(/<section class="print-page[\s\S]*?<\/section>/gu) ?? [])
      .find(page => visibleText(page).includes('把共同判断转化为下一步行动')) ?? ''
    const closingText = visibleText(closing)
    expect(closingText).toContain('确认总体定位')
    expect(closingText).toContain('确认首期启动边界')
    expect(closingText).toContain('确认建设与运营协同机制')
  })

  it('places a client-readable professional appendix introduction between the main report and source pages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-pdf-only-divider-print-'))
    roots.push(root)
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, CLIENT_PROFILE)

    const path = await renderPrintHtml({ report: bundle.report, plan: planClientPages(bundle.report, 'pdf'), identity: bundle.identity }, root)
    const pages = (await readFile(path, 'utf8')).match(/<section class="print-page[\s\S]*?<\/section>/gu) ?? []
    const dividerIndex = pages.findIndex(page => visibleText(page).includes('专业依据与资料索引'))
    const appendixIndex = pages.findIndex(page => page.includes('data-page-kind="appendix"'))

    expect(dividerIndex).toBeGreaterThanOrEqual(0)
    expect(appendixIndex).toBeGreaterThan(dividerIndex)
    expect(visibleText(pages[dividerIndex]!)).toContain('以下内容汇集本报告引用的资料来源、时间与口径，便于会后查阅。')
    expect(pages[dividerIndex]).not.toMatch(/仅 PDF|供核验|不属于主报告/iu)
  })

  it('renders appendix sources as traceable index records instead of oversized quote cards', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-pdf-traceable-index-'))
    roots.push(root)
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, CLIENT_PROFILE)

    const path = await renderPrintHtml({ report: bundle.report, plan: planClientPages(bundle.report, 'pdf'), identity: bundle.identity }, root)
    const pages = (await readFile(path, 'utf8')).match(/<section class="print-page[\s\S]*?<\/section>/gu) ?? []
    const appendix = pages.find(page => page.includes('data-page-kind="appendix"')) ?? ''
    const firstEvidence = CLIENT_PROFILE.evidence[0]!
    const text = visibleText(appendix)

    expect(appendix).toContain('class="appendix-record"')
    expect(appendix).toContain(`data-evidence-id="${firstEvidence.evidenceId}"`)
    expect(text).toContain('E01')
    expect(text).toContain(firstEvidence.statement)
    expect(text).toContain(firstEvidence.sourceLabel)
    expect(text).toContain(firstEvidence.sourceDate)
    expect(text).toContain(firstEvidence.locator)
    expect(appendix).not.toContain('class="evidence"')
  })

  it('renders each product page with the product referenced by that page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-print-products-'))
    roots.push(root)
    const sourceImage = join(root, 'concept-1.png')
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
              assetIds: [],
            }, ...chapter.blocks.slice(1)],
          }),
    }
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, profile)
    const context = {
      report: bundle.report,
      plan: planClientPages(bundle.report, 'pdf'),
      identity: bundle.identity,
    }

    const path = await renderPrintHtml(context, root)
    const html = await readFile(path, 'utf8')
    const page = (html.match(/<section class="print-page[^>]*data-page-kind="product"[^>]*>[\s\S]*?<\/section>/gu) ?? [])
      .find(candidate => visibleText(candidate).includes('洋澜湖·缤纷西岸')) ?? ''

    expect(visibleText(page)).toContain('洋澜湖·缤纷西岸')
    expect(visibleText(page)).toContain('把单一景观岸线转化为城市会客厅')
    expect(page).not.toContain('以核心产品承接项目定位、内容组合与使用场景。')
  })

  it('prints a narrative statement only once on its page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-print-dedup-'))
    roots.push(root)
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
      plan: planClientPages(bundle.report, 'pdf'),
      identity: bundle.identity,
    }

    const path = await renderPrintHtml(context, root)
    const html = await readFile(path, 'utf8')
    const pages = html.match(/<section class="print-page[\s\S]*?<\/section>/gu) ?? []
    const statement = CLIENT_PROFILE.chapters[0]!.blocks[0]!.type === 'narrative'
      ? CLIENT_PROFILE.chapters[0]!.blocks[0]!.statement
      : ''
    const page = pages.find(candidate => visibleText(candidate).includes(statement)) ?? ''

    expect(visibleText(page).match(new RegExp(statement, 'gu'))).toHaveLength(1)
  })

  it('gives three consecutive appendix pages distinct visual treatments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-print-rhythm-'))
    roots.push(root)
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, CLIENT_PROFILE)
    const path = await renderPrintHtml({
      report: bundle.report,
      plan: planClientPages(bundle.report, 'pdf'),
      identity: bundle.identity,
    }, root)
    const html = await readFile(path, 'utf8')
    const appendixPages = html.match(/<section class="print-page[^>]*data-page-kind="appendix"[^>]*>/gu) ?? []
    const styles = html.match(/<style>([\s\S]*?)<\/style>/u)?.[1] ?? ''
    const signatures = (['editorial', 'data', 'split'] as const).map(variant => {
      const rule = styles.match(new RegExp(
        `\\.print-page\\[data-page-kind="appendix"\\]\\.layout-${variant}\\{([^}]*)\\}`,
        'u',
      ))?.[1] ?? ''
      const background = rule.match(/(?:^|;)background:([^;}]+)/u)?.[1] ?? ''
      const color = rule.match(/(?:^|;)color:([^;}]+)/u)?.[1] ?? ''
      return `${background}|${color}`
    })

    expect(appendixPages.length).toBeGreaterThanOrEqual(3)
    expect(signatures.every(signature => signature !== '|')).toBe(true)
    expect(new Set(signatures).size).toBe(3)
  })

  it('prints the three professional variants with different page geometry and full-image containment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-professional-layout-print-'))
    roots.push(root)

    const path = await renderPrintHtml(await professionalVariantContext(root), root)
    const html = await readFile(path, 'utf8')
    const pages = html.match(/<section class="print-page[\s\S]*?<\/section>/gu) ?? []
    const page = (variant: string) => pages.find(candidate => visibleText(candidate).includes(`专业构图 ${variant}`)) ?? ''
    const styles = html.match(/<style>([\s\S]*?)<\/style>/u)?.[1] ?? ''
    const fullBleedImageRule = styles.match(/\.visual-evidence\.layout-full-bleed \.page-media img\{([^}]*)\}/u)?.[1] ?? ''
    const fullBleedRule = styles.match(/\.visual-evidence\.layout-full-bleed\{([^}]*)\}/u)?.[1] ?? ''

    expect(page('full-bleed')).toContain('layout-full-bleed visual-evidence')
    expect(page('split')).toContain('layout-split visual-evidence')
    expect(page('editorial')).toContain('layout-editorial visual-evidence')
    expect(fullBleedRule).toContain('display:grid')
    expect(fullBleedRule).toContain('grid-template-rows:132mm minmax(0,1fr)')
    expect(styles).toContain('.visual-evidence.layout-split{grid-template-columns:1fr 1fr')
    expect(styles).toContain('.visual-evidence.layout-editorial{grid-template-columns:4.8fr 7.2fr;gap:8mm')
    expect(fullBleedImageRule).toContain('object-fit:contain')
    expect(page('full-bleed')).not.toContain('class="evidence"')
    const document = new JSDOM(html).window.document
    const editorial = Array.from(document.querySelectorAll<HTMLElement>('.visual-evidence.layout-editorial'))
      .find(candidate => candidate.textContent?.includes('专业构图 editorial'))
    const strong = editorial?.querySelector<HTMLElement>('.evidence strong')
    const small = editorial?.querySelector<HTMLElement>('.evidence small')
    expect(document.defaultView?.getComputedStyle(strong!).color).toBe('rgb(245, 245, 247)')
    expect(document.defaultView?.getComputedStyle(small!).color).toBe('rgb(201, 215, 216)')
    expect(styles).not.toContain('.evidence span')
  })

  it('fails closed before printing an over-budget full-bleed title', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-full-bleed-budget-print-'))
    roots.push(root)
    const context = await professionalVariantContext(root)
    const plan = {
      ...context.plan,
      pages: context.plan.pages.map(page => page.layoutVariant !== 'full-bleed' || page.kind !== 'visual-evidence'
        ? page
        : { ...page, headline: '超长标题'.repeat(24) }),
    }

    await expect(renderPrintHtml({ ...context, plan }, root))
      .rejects.toThrow('CLIENT_PRINT_FULL_BLEED_TEXT_BUDGET_EXCEEDED')
  })

  it('validates a serialized twelve-page professional run with the explicit report context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-serialized-professional-print-'))
    roots.push(root)

    const path = await renderPrintHtml(await serializedProfessionalRunContext(root), root)
    const html = await readFile(path, 'utf8')

    const headings = Array.from(new JSDOM(html).window.document.querySelectorAll('.print-page h1'))
      .map(heading => heading.textContent ?? '')
    expect(headings.filter(heading => /^序列化专业判断 \d+$/u.test(heading))).toHaveLength(12)
  })

  it('prints every product named by a multi-product scene', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-product-lineup-print-'))
    roots.push(root)
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
    const path = await renderPrintHtml({
      report: bundle.report,
      plan: planClientPages(bundle.report, 'pdf'),
      identity: bundle.identity,
    }, root)
    const html = await readFile(path, 'utf8')
    const page = (html.match(/<section class="print-page[\s\S]*?<\/section>/gu) ?? [])
      .find(candidate => visibleText(candidate).includes('三类产品共同构成完整体验')) ?? ''

    for (const name of names) expect(visibleText(page)).toContain(name)
  })

  it('prints no-media pages with flat evidence features and structured implementation layouts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-intentional-no-media-print-'))
    roots.push(root)
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const phases = ['示范先行', '骨架成网', '场景扩展']
    const profile = {
      ...CLIENT_PROFILE,
      chapters: CLIENT_PROFILE.chapters.map(chapter => chapter.id === 'chapter-07'
        ? {
            ...chapter,
            blocks: [{
              type: 'narrative' as const,
              statement: '空间骨架优先连接门户、文化核心、生态水岸与社区入口。',
              evidenceIds: ['evidence-3'],
            }, ...chapter.blocks.slice(1)],
          }
        : chapter.id === 'chapter-08'
          ? {
              ...chapter,
              claim: '明确公共服务底线，并以活动、内容与轻商业支撑长期活力。',
              blocks: [chapter.blocks[0]!, {
                type: 'evidence' as const,
                headline: '多时段内容组合提升设施与空间使用效率',
                evidenceIds: ['evidence-9'], assetIds: [],
              }],
            }
        : chapter.id === 'chapter-09'
          ? {
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
                items: [
                  { name: '示范先行', amount: '1200', unit: '万元', assumption: '测试阶段示例测算' },
                  { name: '骨架成网', amount: '2800', unit: '万元', assumption: '测试阶段示例测算' },
                  { name: '场景扩展', amount: '4500', unit: '万元', assumption: '测试阶段示例测算' },
                ],
                evidenceIds: ['evidence-12'],
              }],
            }
        : chapter.id === 'chapter-10'
          ? {
              ...chapter,
              claim: '三项共同决策是进入概念深化与专题测算的前提。',
              blocks: [{
                  type: 'evidence' as const,
                  headline: '分期实施与运营前置共同降低项目不确定性',
                  evidenceIds: ['evidence-11'], assetIds: [],
                }, ...chapter.blocks.slice(1)],
              }
            : chapter),
    }
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, profile)
    const path = await renderPrintHtml({
      report: bundle.report,
      plan: planClientPages(bundle.report, 'pdf'),
      identity: bundle.identity,
    }, root)
    const document = new JSDOM(await readFile(path, 'utf8')).window.document
    const pages = Array.from(document.querySelectorAll<HTMLElement>('.print-page'))
    const page = (text: string): HTMLElement | undefined => pages.find(candidate =>
      (candidate.textContent ?? '').includes(text))
    const implementationPage = (text: string): HTMLElement | undefined => pages.find(candidate =>
      candidate.dataset.pageKind === 'implementation' && (candidate.textContent ?? '').includes(text))
    const noMediaPage = (text: string): HTMLElement | undefined => pages.find(candidate =>
      candidate.classList.contains('no-media') && (candidate.textContent ?? '').includes(text))
    const scene = pages.find(candidate => candidate.dataset.pageKind === 'scene'
      && (candidate.textContent ?? '').includes('项目证据 3'))
    const urgency = page('为什么现在必须行动')
    const timeline = page('三阶段把共同判断转化为连续行动')
    const investment = page('首期投入优先保障公共空间与基础设施')
    const operationEvidence = implementationPage('多时段内容组合提升设施与空间使用效率')
    const evidence = noMediaPage('分期实施与运营前置共同降低项目不确定性')

    expect(scene?.querySelector('.evidence-feature')).not.toBeNull()
    expect(scene?.querySelector('.evidence')).toBeNull()
    expect(urgency?.querySelector('[data-analysis-kind="urgency-signals"]')).not.toBeNull()
    expect(scene?.querySelector('[data-analysis-kind="spatial-sequence"]')).not.toBeNull()
    expect(timeline?.querySelectorAll('.implementation-timeline .phase')).toHaveLength(3)
    for (const phase of phases) {
      expect(timeline?.textContent).toContain(`${phase}的实施动作`)
      expect(timeline?.textContent).toContain(`${phase}的前置条件`)
    }
    expect(investment?.querySelector('.investment-value')?.textContent?.trim()).toBe('1200')
    expect(investment?.querySelector('[data-analysis-kind="investment-sequence"]')).not.toBeNull()
    for (const amount of ['1200 万元', '2800 万元', '4500 万元']) {
      expect(investment?.textContent).toContain(amount)
    }
    expect(investment?.textContent?.match(/测试阶段示例测算/gu)).toHaveLength(1)
    expect(investment?.querySelector('.analysis-shared-basis')?.textContent).toContain('测试阶段示例测算')
    expect(operationEvidence?.querySelector('.focus.implementation-judgement')?.textContent)
      .toContain('明确公共服务底线，并以活动、内容与轻商业支撑长期活力。')
    expect(operationEvidence?.querySelector('[data-analysis-kind="daypart-matrix"]')).not.toBeNull()
    expect(evidence?.querySelector('.focus.implementation-judgement')?.textContent)
      .toContain('三项共同决策是进入概念深化与专题测算的前提。')
    expect(evidence?.querySelector('.evidence-feature')).not.toBeNull()
    expect(evidence?.querySelector('[data-analysis-kind="decision-flow"]')).not.toBeNull()
    expect(evidence?.querySelector('.evidence')).toBeNull()
    const feature = evidence?.querySelector<HTMLElement>('.evidence-feature')
    expect(feature?.children).toHaveLength(1)
    expect(document.defaultView?.getComputedStyle(feature!).gridTemplateColumns).toContain('auto-fit')
    const timelinePrerequisite = timeline?.querySelector<HTMLElement>('.implementation-timeline .phase small')
    expect(Number.parseFloat(document.defaultView?.getComputedStyle(timelinePrerequisite!).fontSize ?? '0')).toBeGreaterThanOrEqual(10)
  })

  it('keeps the site-plan studies and directed decision semantics in print HTML', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-print-analysis-semantics-'))
    roots.push(root)
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, CLIENT_PROFILE)
    const path = await renderPrintHtml({
      report: bundle.report,
      plan: planClientPages(bundle.report, 'pdf'),
      identity: bundle.identity,
    }, root)
    const document = new JSDOM(await readFile(path, 'utf8')).window.document
    const page = (number: string): HTMLElement | undefined => Array.from(document.querySelectorAll<HTMLElement>('.print-page'))
      .find(candidate => candidate.querySelector('.page-number')?.textContent?.trim().startsWith(number))

    for (const number of ['24', '25']) {
      const plan = page(number)?.querySelector<HTMLElement>('.analysis-site-plan')
      const svg = plan?.querySelector<SVGElement>('svg[role="img"][aria-label]')
      expect(plan).toBeDefined()
      expect(plan?.dataset.publishable).toBe('false')
      expect(svg).toBeDefined()
      expect(svg?.querySelector('[data-map-layer="context"]')).not.toBeNull()
      expect(svg?.querySelector('[data-map-layer="concept-boundary"]')).not.toBeNull()
      expect(svg?.querySelector('[data-map-anchor]')).not.toBeNull()
      expect(plan?.textContent).toContain('研究范围（待核） · 非法定红线 · 非测绘成果')
      expect(plan?.textContent).toMatch(/总平图.*红线图.*CRS.*闭合坐标.*GeoJSON.*复核确认/u)
    }

    for (const number of ['27', '33']) {
      const analysisPage = page(number)
      const edges = Array.from(analysisPage?.querySelectorAll<HTMLElement>('[data-relation-label][data-from][data-to]') ?? [])
      expect(edges.length).toBeGreaterThanOrEqual(3)
      for (const edge of edges) expect(edge.querySelector('svg[role="img"] marker')).not.toBeNull()
    }

    const operation = page('27')
    expect(operation?.querySelectorAll('[data-analysis-node]')).toHaveLength(7)
    expect(operation?.querySelectorAll('[data-to="operation-outcome"]')).toHaveLength(3)
    expect(operation?.querySelectorAll('[data-from="operation-outcome"]')).toHaveLength(3)

    const matrix = page('28')
    expect(Array.from(matrix?.querySelectorAll('.analysis-matrix td') ?? []).map(cell => cell.textContent?.trim())).toEqual([
      '高', '中', '低',
      '中', '高', '高',
      '中', '高', '高',
    ])

    const triad = page('33')
    expect(triad?.querySelectorAll('[data-to="triad-common-unlock"]')).toHaveLength(3)
    expect(triad?.querySelector('[data-analysis-node="triad-common-unlock"]')?.textContent)
      .toContain('形成统一输入（定位结论·首期边界图·协同机制）')
    for (const output of ['形成定位结论', '形成首期边界图', '形成协同机制']) {
      expect(triad?.textContent).toContain(output)
    }

    const closing = page('35')
    expect(closing?.querySelectorAll('[data-to="shared-unlock"]')).toHaveLength(3)
    expect(closing?.querySelector('[data-analysis-node="shared-unlock"]')?.textContent).toMatch(/共同决策|解锁|下一阶段/u)
  })

  it('prints the same local HTML through the supplied browser port and verifies a PDF header', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-pdf-'))
    roots.push(root)
    const html = join(root, 'index.html')
    const output = join(root, 'report.pdf')
    await writeFile(html, '<!doctype html><html><head><meta name="preplan-project-id" content="golden-project"><meta name="preplan-source-revision" content="57"><meta name="preplan-recommendation-id" content="recommendation-r57-cultural-riverfront"><meta name="preplan-adopted-assets" content="concept-1,concept-2"></head><body>前期策划</body></html>', 'utf8')
    const runner = vi.fn(async (_executable: string, args: readonly string[]) => {
      expect(args.some(argument => argument.startsWith('file:///'))).toBe(true)
      await writeFile(output, Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF'))
    })

    const artifact = await renderPdf(html, output, 'fake-edge.exe', runner)

    const pdf = await readFile(output)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const encoded = pdf.toString('latin1').split('%PREPLAN-METADATA:').at(-1)?.split(/\r?\n/u)[0]
    expect(JSON.parse(Buffer.from(encoded ?? '', 'base64url').toString('utf8'))).toEqual({
      projectId: 'golden-project',
      sourceRevision: 57,
      recommendationId: 'recommendation-r57-cultural-riverfront',
      adoptedAssetIds: ['concept-1', 'concept-2'],
    })
    expect(artifact).toMatchObject({ format: 'pdf', fileName: 'report.pdf', sha256: expect.any(String) })
    expect(runner).toHaveBeenCalledOnce()
  })
})
