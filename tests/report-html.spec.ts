import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { planClientPages } from '../src/report/page-plan.ts'
import { renderHtml } from '../src/report/render-html.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom') as {
  JSDOM: new (source: string, options?: { readonly url?: string }) => { window: { document: Document } }
}

const roots: string[] = []
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
  const mediaPositions = ['bottom', 'background', 'right'] as const
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
  const basePlan = planClientPages(report, 'html')
  const plan = {
    ...basePlan,
    pages: basePlan.pages.map(page => {
      const index = assets.findIndex(asset => page.assetIds.includes(asset.assetId))
      return index < 0 ? page : {
        ...page,
        layoutVariant: variants[index]!,
        mediaPosition: mediaPositions[index]!,
      }
    }),
  }
  return { report, plan, identity: bundle.identity }
}

async function galleryVariantContext(root: string) {
  const sourceImage = join(root, 'gallery-layout.png')
  await writeFile(sourceImage, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ))
  const bundle = createClientReportBundle({
    ...REPORT_INPUT,
    visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
  }, CLIENT_PROFILE)
  const counts = [2, 3, 4, 5, 6, 8] as const
  const roles = ['map', 'product-scene', 'material', 'site-photo', 'diagram', 'before', 'after', 'chart'] as const
  const dimensions = [
    { width: 1920, height: 1080 },
    { width: 900, height: 1600 },
    { width: 900, height: 1600 },
    { width: 1200, height: 1200 },
    { width: 900, height: 1600 },
    { width: 1920, height: 1080 },
  ] as const
  const groups = counts.map((count, groupIndex) => {
    const chapter = bundle.report.chapters[groupIndex]!
    return Array.from({ length: count }, (_, assetIndex) => ({
      ...bundle.report.assets[0]!,
      assetId: `gallery-${count}-${assetIndex + 1}`,
      role: count === 5 ? 'material' as const : roles[assetIndex % roles.length]!,
      chapterId: chapter.id,
      caption: `完整图注 ${count}-${assetIndex + 1}：不应省略`,
      ...dimensions[groupIndex]!,
    }))
  })
  const report = {
    ...bundle.report,
    assets: [...bundle.report.assets, ...groups.flat()],
    chapters: bundle.report.chapters.map((chapter, chapterIndex) => chapterIndex >= groups.length
      ? chapter
      : {
          ...chapter,
          blocks: chapter.blocks.map((block, blockIndex) => blockIndex !== 0
            ? block
            : {
                type: 'evidence' as const,
                headline: `${counts[chapterIndex]} 图专业组图`,
                evidenceIds: [bundle.report.evidence[chapterIndex]!.evidenceId],
                assetIds: groups[chapterIndex]!.map(asset => asset.assetId),
              }),
        }),
  }
  return {
    report,
    plan: planClientPages(report, 'html'),
    identity: bundle.identity,
  }
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
  const plan = JSON.parse(JSON.stringify(planClientPages(report, 'html'))) as ReturnType<typeof planClientPages>
  return { report, plan, identity: bundle.identity }
}

describe('renderHtml', () => {
  it('renders an offline client story without visible governance vocabulary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-client-html-'))
    roots.push(root)
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from([1, 2, 3]))
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, CLIENT_PROFILE)
    const context = {
      report: bundle.report,
      plan: planClientPages(bundle.report, 'html'),
      identity: bundle.identity,
    }

    const artifact = await renderHtml(context, root)
    const html = await readFile(join(root, 'html', 'index.html'), 'utf8')
    const body = html.match(/<body[\s\S]*<\/body>/u)?.[0] ?? ''
    const openingValuePage = html.match(/<section[^>]*id="opening-value"[^>]*>[\s\S]*?<\/section>/u)?.[0] ?? ''

    expect(artifact).toMatchObject({
      format: 'html',
      fileName: 'html/index.html',
      sha256: expect.any(String),
    })
    expect(html).toContain('<meta name="preplan-source-revision" content="57">')
    expect(html.match(/data-page-kind=/gu)).toHaveLength(35)
    expect(html).toContain('data-page-kind="product"')
    expect(html).toContain('@media (prefers-reduced-motion: reduce)')
    expect(html).toContain(':focus-visible')
    expect(html).toContain('aria-label="成果章节导航"')
    expect(html).toContain('<a href="#chapter-01-divider">01 项目定义</a>')
    expect(html).not.toContain(`01 ${CLIENT_PROFILE.chapters[0]!.headline}</a>`)
    expect(html.match(/\.report-nav\{[^}]*\}/u)?.[0]).toContain('grid-template-columns')
    expect(html.match(/\.report-nav\{[^}]*\}/u)?.[0]).not.toContain('overflow:auto')
    expect(body).not.toMatch(/Gate|Revision|Workflow|工作项|完成度/iu)
    expect(html).not.toMatch(/https?:\/\//iu)
    expect(html).not.toContain(sourceImage)
    expect(html).not.toContain('class="asset-disclosure"')
    expect(html).not.toMatch(/AI\s*生成/iu)
    expect(html).toContain('.client-text-chunk{white-space:nowrap}')
    expect(openingValuePage).toContain('<span class="client-text-chunk">形成持续发生的城市生活目的地</span>')
    await expect(access(join(root, 'html', 'assets', 'images', 'concept-1.png')))
      .resolves.toBeUndefined()
  })

  it('同一叙事页只展示一次正文判断', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-client-html-dedup-'))
    roots.push(root)
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from([1, 2, 3]))
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, CLIENT_PROFILE)
    const context = {
      report: bundle.report,
      plan: planClientPages(bundle.report, 'html'),
      identity: bundle.identity,
    }

    await renderHtml(context, root)
    const html = await readFile(join(root, 'html', 'index.html'), 'utf8')
    const page = html.match(/<section[^>]*id="chapter-01-block-01"[^>]*>[\s\S]*?<\/section>/u)?.[0] ?? ''
    const statement = CLIENT_PROFILE.chapters[0]!.blocks[0]!.type === 'narrative'
      ? CLIENT_PROFILE.chapters[0]!.blocks[0]!.statement
      : ''

    expect(page.match(new RegExp(statement, 'gu'))).toHaveLength(1)
  })

  it('renders product meaning instead of generic copy on a product visual page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-product-visual-html-'))
    roots.push(root)
    const sourceImage = join(root, 'lakefront-masterplan.png')
    await writeFile(sourceImage, Buffer.from([1, 2, 3]))
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
      plan: planClientPages(bundle.report, 'html'),
      identity: bundle.identity,
    }

    await renderHtml(context, root)
    const html = await readFile(join(root, 'html', 'index.html'), 'utf8')
    const document = new JSDOM(html).window.document
    const page = Array.from(document.querySelectorAll<HTMLElement>('[data-page-kind="visual-evidence"]'))
      .find(section => section.querySelector('h2')?.textContent === '洋澜湖·缤纷西岸')?.outerHTML ?? ''

    expect(page).toContain('把单一景观岸线转化为城市会客厅')
    expect(page).not.toContain('以核心产品承接项目定位与使用场景')
  })

  it('rejects a profile-created research boundary when governance did not provide one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-visual-contract-html-'))
    roots.push(root)
    const sourceImage = join(root, 'site-drawing.png')
    await writeFile(sourceImage, Buffer.from([1, 2, 3]))
    const profile = {
      ...CLIENT_PROFILE,
      chapters: CLIENT_PROFILE.chapters.map((chapter, index) => index !== 0 ? chapter : {
        ...chapter,
        blocks: [{
          type: 'evidence' as const,
          headline: '项目边界与城市关系形成专业判读基础',
          evidenceIds: ['evidence-1'],
          assetIds: ['concept-1'],
        }],
      }),
      assetBindings: [{
        ...CLIENT_PROFILE.assetBindings[0]!,
        role: 'map' as const,
        analysisKind: 'site-boundary' as const,
        provenance: {
          sourceLabel: '工程夹具图件资料', sourceDate: '2026-08-28', locator: '项目简报·总平面图',
          sourceFileSha256: 'b'.repeat(64), evidenceIds: ['evidence-1'],
        },
        cartography: {
          boundary: 'research' as const, disclosures: ['研究范围（待核）', '非法定红线', '非测绘成果'], legend: 'present' as const, northArrow: 'present' as const,
          scale: { kind: 'nts' as const },
        },
      }],
      requiredVisualRoles: ['map' as const],
    }
    expect(() => createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, profile)).toThrow('SITE_BOUNDARY_PROFILE_CONFLICT')
  })

  it('renders the cover and planned opening backdrops as full-page image layers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-backdrop-html-'))
    roots.push(root)
    const base = await professionalVariantContext(root)
    const hero = { ...base.report.assets[0]!, assetId: 'cover-hero', role: 'hero' as const }
    const materials = Array.from({ length: 12 }, (_, index) => ({
      ...base.report.assets[0]!,
      assetId: `html-material-${index + 1}`,
      role: 'material' as const,
      sourceKind: 'ai-concept' as const,
      chapterId: base.report.chapters[index % base.report.chapters.length]!.id,
    }))
    const report = { ...base.report, assets: [...base.report.assets, hero, ...materials] }
    const plan = planClientPages(report, 'html')

    await renderHtml({ report, plan, identity: base.identity }, root)
    const document = new JSDOM(await readFile(join(root, 'html', 'index.html'), 'utf8')).window.document
    const stylesheet = document.querySelector('style')?.textContent ?? ''
    const cover = document.querySelector<HTMLElement>('#cover')
    const opening = document.querySelector<HTMLElement>('#opening-value')
    const backdrop = opening?.querySelector<HTMLElement>('.page-backdrop')

    expect(cover?.querySelector('[data-backdrop-asset="cover-hero"]')).not.toBeNull()
    expect(opening?.classList.contains('has-backdrop')).toBe(true)
    expect(backdrop?.dataset.backdropAsset).toBe('html-material-2')
    expect(backdrop?.querySelector('img')?.getAttribute('alt')).toBe('')
    expect(stylesheet).toContain('.page-backdrop{position:absolute;inset:0;z-index:0;overflow:hidden}')
    expect(stylesheet).toContain('.has-backdrop::after')
    expect(document.defaultView?.getComputedStyle(backdrop!).position).toBe('absolute')
  })

  it('renders full-bleed, split, and editorial professional pages as different DOM compositions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-professional-layout-html-'))
    roots.push(root)

    await renderHtml(await professionalVariantContext(root), root)
    const html = await readFile(join(root, 'html', 'index.html'), 'utf8')
    const document = new JSDOM(html).window.document
    const page = (headline: string) => Array.from(document.querySelectorAll<HTMLElement>('[data-page-kind="visual-evidence"]'))
      .find(section => section.querySelector('h2')?.textContent === headline)?.outerHTML ?? ''
    const fullBleed = page('专业构图 full-bleed')
    const split = page('专业构图 split')
    const editorial = page('专业构图 editorial')
    const splitElement = Array.from(document.querySelectorAll<HTMLElement>('[data-page-kind="visual-evidence"]'))
      .find(section => section.querySelector('h2')?.textContent === '专业构图 split')!
    const editorialElement = Array.from(document.querySelectorAll<HTMLElement>('[data-page-kind="visual-evidence"]'))
      .find(section => section.querySelector('h2')?.textContent === '专业构图 editorial')!
    const fullBleedElement = Array.from(document.querySelectorAll<HTMLElement>('[data-page-kind="visual-evidence"]'))
      .find(section => section.querySelector('h2')?.textContent === '专业构图 full-bleed')!

    expect(fullBleed).toContain('visual-evidence-full-bleed')
    expect(fullBleed).toContain('data-visual-presentation="background"')
    expect(fullBleed.indexOf('visual-evidence-media')).toBeLessThan(fullBleed.indexOf('visual-evidence-copy'))
    expect(split).toContain('visual-evidence-split')
    expect(split).toContain('data-visual-presentation="horizontal-split"')
    expect(split.indexOf('visual-evidence-copy')).toBeLessThan(split.indexOf('visual-evidence-media'))
    expect(editorial).toContain('visual-evidence-editorial')
    expect(editorial).toContain('data-visual-presentation="vertical-stack"')
    expect(editorial).toContain('<aside class="visual-evidence-copy">')
    const stylesheet = document.querySelector('style')?.textContent ?? ''
    expect(stylesheet).toContain('.layout-full-bleed.kind-visual-evidence{padding:0')
    expect(stylesheet).toContain('grid-template-columns:5fr 7fr')
    expect(stylesheet).toContain('grid-template-rows:44vh 56vh')
    expect(stylesheet).toContain('.kind-visual-evidence .page-visual{position:relative;overflow:hidden')
    expect(stylesheet).toContain('.kind-visual-evidence .page-visual figcaption{position:absolute')
    expect(stylesheet).toContain('.page-backdrop img{display:block;width:100%;height:100%;object-fit:cover}')
    expect(stylesheet).toContain('justify-content:flex-start;padding:24px 6vw 20px')
    expect(stylesheet).toContain('margin-bottom:12px;font-size:clamp(28px,3vw,42px)')
    expect(document.defaultView?.getComputedStyle(splitElement.querySelector('.visual-evidence-media')!).gridColumn).toBe('2')
    expect(document.defaultView?.getComputedStyle(editorialElement.querySelector('.visual-evidence-media')!).gridRow).toBe('2')
    for (const visualPage of [fullBleedElement, splitElement, editorialElement]) {
      const figure = visualPage.querySelector<HTMLElement>('.page-visual')!
      const caption = figure.querySelector<HTMLElement>('figcaption')!
      expect(document.defaultView?.getComputedStyle(figure).position).toBe('relative')
      expect(document.defaultView?.getComputedStyle(figure).overflow).toBe('hidden')
      expect(document.defaultView?.getComputedStyle(caption).position).toBe('absolute')
      expect(document.defaultView?.getComputedStyle(figure.querySelector('img')!).objectFit).toBe('contain')
      expect(caption.textContent?.trim()).not.toBe('')
    }
    expect(document.defaultView?.getComputedStyle(editorialElement.querySelector('.visual-evidence-copy')!).justifyContent)
      .toBe('flex-start')
  })

  it('renders full-bleed, staggered, anchored, and editorial galleries with complete captions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-gallery-layout-html-'))
    roots.push(root)
    await renderHtml(await galleryVariantContext(root), root)

    const document = new JSDOM(await readFile(join(root, 'html', 'index.html'), 'utf8'), {
      url: 'https://preplan.test/',
    }).window.document
    const pageFor = (count: number) => Array.from(document.querySelectorAll<HTMLElement>('[data-page-kind="visual-evidence"]'))
      .find(page => page.querySelector('h2')?.textContent === `${count} 图专业组图`)!
    const duoPage = pageFor(2)
    const triptychPage = pageFor(3)
    const staggeredPage = pageFor(4)
    const centerPage = pageFor(5)
    const storyPage = pageFor(6)
    const boardPage = pageFor(8)
    const duoGallery = duoPage.querySelector<HTMLElement>('[data-gallery-layout="duo-asymmetric-vertical"]')!
    const triptychGallery = triptychPage.querySelector<HTMLElement>('[data-gallery-layout="triptych-fullbleed"]')!
    const triptychStage = triptychPage.querySelector<HTMLElement>('.visual-evidence-gallery')!
    const staggeredGallery = staggeredPage.querySelector<HTMLElement>('[data-gallery-layout="staggered-four"]')!
    const centerGallery = centerPage.querySelector<HTMLElement>('[data-gallery-layout="center-anchor"]')!
    const storyGallery = storyPage.querySelector<HTMLElement>('[data-gallery-layout="paired-story-columns"]')!
    const boardGallery = boardPage.querySelector<HTMLElement>('[data-gallery-layout="anchor-side-board"]')!

    expect(duoPage.dataset.assetLayout).toBe('duo-asymmetric-vertical')
    expect(triptychPage.dataset.assetLayout).toBe('triptych-fullbleed')
    expect(staggeredPage.dataset.assetLayout).toBe('staggered-four')
    expect(centerPage.dataset.assetLayout).toBe('center-anchor')
    expect(centerPage.querySelector('.visual-evidence-stage')?.getAttribute('data-visual-role')).toBe('gallery')
    expect(centerPage.querySelector('.eyebrow')?.textContent).toBe('视觉叙事')
    expect(storyPage.dataset.assetLayout).toBe('paired-story-columns')
    expect(boardPage.dataset.assetLayout).toBe('anchor-side-board')
    expect(duoGallery.querySelectorAll('.page-visual')).toHaveLength(2)
    expect(triptychGallery.querySelectorAll('.page-visual')).toHaveLength(3)
    expect(staggeredGallery.querySelectorAll('.page-visual')).toHaveLength(4)
    expect(centerGallery.querySelectorAll('.page-visual')).toHaveLength(5)
    expect(storyGallery.querySelectorAll('.page-visual')).toHaveLength(6)
    expect(boardGallery.querySelectorAll('.page-visual')).toHaveLength(8)
    expect(triptychGallery.querySelector('[data-gallery-rank="primary"]')).toBe(triptychGallery.firstElementChild)
    expect(triptychGallery.querySelectorAll('[data-gallery-rank="supporting"]')).toHaveLength(2)
    expect(Array.from(triptychGallery.querySelectorAll('figcaption')).map(caption => caption.textContent)).toEqual([
      '完整图注 3-1：不应省略', '完整图注 3-2：不应省略', '完整图注 3-3：不应省略',
    ])
    expect(document.defaultView?.getComputedStyle(duoGallery).gridTemplateRows).toBe('13fr 7fr')
    expect(document.defaultView?.getComputedStyle(triptychGallery).display).toBe('grid')
    expect(document.defaultView?.getComputedStyle(triptychStage).height).toBe('100vh')
    expect(document.defaultView?.getComputedStyle(triptychStage).minHeight).toMatch(/^0(?:px)?$/u)
    expect(document.defaultView?.getComputedStyle(triptychStage).gridTemplateRows).toBe('minmax(96px,18vh) minmax(0,1fr)')
    expect(document.defaultView?.getComputedStyle(triptychGallery).gridTemplateColumns).toBe('repeat(3,minmax(0,1fr))')
    expect(document.defaultView?.getComputedStyle(staggeredGallery).gridTemplateColumns).toBe('repeat(4,minmax(0,1fr))')
    expect(document.defaultView?.getComputedStyle(staggeredGallery.children[0]!).gridRow).toBe('3 / span 10')
    expect(document.defaultView?.getComputedStyle(staggeredGallery.children[1]!).gridRow).toBe('1 / span 10')
    expect(document.defaultView?.getComputedStyle(centerGallery).gridTemplateColumns).toBe('repeat(4,minmax(0,1fr))')
    expect(document.defaultView?.getComputedStyle(centerGallery.firstElementChild!).gridColumn).toBe('2 / span 2')
    expect(document.defaultView?.getComputedStyle(storyGallery).gridTemplateColumns).toBe('repeat(3,minmax(0,1fr))')
    expect(document.defaultView?.getComputedStyle(boardGallery).gridTemplateColumns).toBe('repeat(5,minmax(0,1fr))')
    expect(document.defaultView?.getComputedStyle(boardGallery.firstElementChild!).gridColumn).toBe('1 / span 3')
    const primaryImage = triptychGallery.querySelector<HTMLElement>('[data-gallery-rank="primary"] img')!
    const primaryCaption = triptychGallery.querySelector<HTMLElement>('[data-gallery-rank="primary"] figcaption')!
    expect(document.defaultView?.getComputedStyle(primaryImage).minWidth).toMatch(/^0(?:px)?$/u)
    expect(document.defaultView?.getComputedStyle(primaryImage).minHeight).toMatch(/^0(?:px)?$/u)
    expect(document.defaultView?.getComputedStyle(primaryCaption).position).toBe('absolute')
    expect(document.defaultView?.getComputedStyle(
      triptychGallery.querySelector('[data-visual-role="map"] img')!,
    ).objectFit).toBe('contain')
    expect(document.defaultView?.getComputedStyle(
      triptychGallery.querySelector('[data-visual-role="product-scene"] img')!,
    ).objectFit).toBe('cover')
    expect(boardPage.querySelector('.evidence-list')).toBeNull()
    expect(boardPage.querySelector('.visual-gallery-heading')).not.toBeNull()
  })

  it('keeps full-bleed comparison body text legible against comparison cards', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-full-bleed-comparison-contrast-html-'))
    roots.push(root)
    const base = await professionalVariantContext(root)
    const comparisonBlock = {
      type: 'comparison' as const,
      headline: '空间现状与目标转变',
      before: '当前：公共界面尚未形成连续体验。',
      after: '目标：形成可持续使用的滨水公共界面。',
      evidenceIds: ['evidence-2'],
      assetIds: ['professional-layout-2'],
    }
    const report = {
      ...base.report,
      chapters: base.report.chapters.map(chapter => chapter.id !== 'chapter-02'
        ? chapter
        : { ...chapter, blocks: [comparisonBlock, ...chapter.blocks.slice(1)] }),
    }
    const plan = {
      ...base.plan,
      pages: base.plan.pages.map(page => page.pageId !== 'chapter-02-block-01'
        ? page
        : { ...page, headline: comparisonBlock.headline, layoutVariant: 'full-bleed' as const }),
    }

    await renderHtml({ ...base, report, plan }, root)
    const document = new JSDOM(await readFile(join(root, 'html', 'index.html'), 'utf8'), {
      url: 'https://preplan.test/',
    }).window.document
    const page = document.querySelector<HTMLElement>('#chapter-02-block-01')
    const card = page?.querySelector<HTMLElement>('.comparison article')
    const body = card?.querySelector<HTMLElement>('p')
    const styles = document.defaultView
    const bodyColor = styles?.getComputedStyle(body!).color
    const cardBackground = styles?.getComputedStyle(card!).background

    // This assertion intentionally catches the production mutation that removes
    // the full-bleed comparison body color reset: JSDOM preserves the custom
    // property tokens, while a real Edge render resolves var(--ink) to a dark
    // color that is visibly different from the card background.
    expect(cardBackground).toBe('var(--surface)')
    expect(bodyColor).toBe('var(--ink)')
    expect(bodyColor).not.toBe(cardBackground)
  })

  it('renders P6 editorial title chunks in a wider five-column copy rail with readable evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-editorial-readability-html-'))
    roots.push(root)
    const context = await professionalVariantContext(root)
    const plan = {
      ...context.plan,
      pages: context.plan.pages.map(page => page.pageId === 'chapter-01-block-01'
        ? { ...page, headline: '城市区位关系明确项目所处的区域网络' }
        : page),
    }

    await renderHtml({ ...context, plan }, root)
    const document = new JSDOM(await readFile(join(root, 'html', 'index.html'), 'utf8'), {
      url: 'https://preplan.test/',
    }).window.document
    const page = document.querySelector<HTMLElement>('#chapter-01-block-01')
    const title = page?.querySelector<HTMLElement>('h2')
    const copy = page?.querySelector<HTMLElement>('.visual-evidence-copy')
    const media = page?.querySelector<HTMLElement>('.visual-evidence-media')
    const strong = page?.querySelector<HTMLElement>('.evidence-list strong')
    const small = page?.querySelector<HTMLElement>('.evidence-list small')

    expect(title?.querySelector('.client-text-chunk')?.parentElement).toBe(title)
    expect(Array.from(title?.querySelectorAll('.client-text-chunk') ?? []).map(chunk => chunk.textContent))
      .toContain('项目所处的区域网络')
    expect(document.defaultView?.getComputedStyle(copy!).gridRow).toBe('1')
    expect(document.defaultView?.getComputedStyle(media!).gridRow).toBe('2')
    expect(document.defaultView?.getComputedStyle(strong!).color).toBe('rgb(245, 245, 247)')
    expect(document.defaultView?.getComputedStyle(small!).color).toBe('rgb(201, 215, 216)')
  })

  it('renders the P29 chapter title and claim through shared semantic chunks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-chapter-implementation-html-'))
    roots.push(root)
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from([1, 2, 3]))
    const profile = {
      ...CLIENT_PROFILE,
      chapters: CLIENT_PROFILE.chapters.map(chapter => chapter.id !== 'chapter-09' ? chapter : {
        ...chapter,
        headline: '首期启动区优先验证公共界面与运营模型',
        claim: '以示范先行、骨架成网、场景扩展的路径降低一次性投入风险。',
      }),
    }
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, profile)

    await renderHtml({ report: bundle.report, plan: planClientPages(bundle.report, 'html'), identity: bundle.identity }, root)
    const document = new JSDOM(await readFile(join(root, 'html', 'index.html'), 'utf8')).window.document
    const page = document.querySelector<HTMLElement>('#chapter-09-divider')

    expect(Array.from(page?.querySelectorAll('h2 .client-text-chunk') ?? []).map(chunk => chunk.textContent))
      .toContain('公共界面与运营模型')
    expect(Array.from(page?.querySelectorAll('p .client-text-chunk') ?? [])
      .some(chunk => chunk.textContent?.includes('降低一次性投入风险'))).toBe(true)
  })

  it('validates a serialized twelve-page professional run with the explicit report context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-serialized-professional-html-'))
    roots.push(root)

    await expect(renderHtml(await serializedProfessionalRunContext(root), root)).resolves.toMatchObject({
      format: 'html',
    })
    const html = await readFile(join(root, 'html', 'index.html'), 'utf8')
    const headings = Array.from(new JSDOM(html).window.document.querySelectorAll('.report-page h2'))
      .map(heading => heading.textContent ?? '')

    expect(headings.filter(heading => /^序列化专业判断 \d+$/u.test(heading))).toHaveLength(12)
  })

  it('renders every product named by a multi-product scene', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-product-lineup-html-'))
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
    const context = { report: bundle.report, plan: planClientPages(bundle.report, 'html'), identity: bundle.identity }

    await renderHtml(context, root)
    const html = await readFile(join(root, 'html', 'index.html'), 'utf8')
    const scene = html.match(/<section[^>]*data-page-kind="scene"[^>]*>[\s\S]*?<h2>三类产品共同构成完整体验<\/h2>[\s\S]*?<\/section>/u)?.[0] ?? ''

    for (const name of names) expect(scene).toContain(name)
  })

  it('ends the HTML main report on the decision page without PDF-only production language', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-pdf-only-notice-html-'))
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

    await renderHtml({ report: bundle.report, plan: planClientPages(bundle.report, 'html'), identity: bundle.identity }, root)
    const html = await readFile(join(root, 'html', 'index.html'), 'utf8')
    const pages = html.match(/<section[^>]*>[\s\S]*?<\/section>/gu) ?? []

    expect(html).not.toMatch(/仅 PDF|供核验|不属于主报告/iu)
    expect(pages.at(-1)).toContain('把共同判断转化为下一步行动')
  })

  it('renders analytical visuals as first-class HTML content instead of text-only placeholders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-analytical-visuals-html-'))
    roots.push(root)
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const profile = {
      ...CLIENT_PROFILE,
      evidence: CLIENT_PROFILE.evidence.map(evidence => evidence.evidenceId !== 'evidence-12'
        ? evidence
        : { ...evidence, statement: '示范先行、骨架成网与场景扩展的示例投资分别为 1200、2800、4500 万元。' }),
      chapters: CLIENT_PROFILE.chapters.map(chapter => chapter.id !== 'chapter-09' ? chapter : {
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

    await renderHtml({ report: bundle.report, plan: planClientPages(bundle.report, 'html'), identity: bundle.identity }, root)
    const html = await readFile(join(root, 'html', 'index.html'), 'utf8')

    for (const kind of ['urgency-signals', 'spatial-sequence', 'public-operation', 'daypart-matrix', 'decision-triad', 'decision-flow']) {
      expect(html).toContain(`data-analysis-kind="${kind}"`)
    }
    const investment = new JSDOM(html).window.document.querySelector<HTMLElement>('#chapter-09-block-02')
    expect(investment?.textContent?.match(/测试阶段示例测算/gu)).toHaveLength(1)
    expect(investment?.querySelector('.analysis-shared-basis')?.textContent).toContain('测试阶段示例测算')
    expect(investment?.querySelectorAll('.evidence-list > li > span')).toHaveLength(0)
  })

  it('renders the two spatial pages as labelled architectural SVG site-plan studies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-site-plan-html-'))
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

    await renderHtml({ report: bundle.report, plan: planClientPages(bundle.report, 'html'), identity: bundle.identity }, root)
    const document = new JSDOM(await readFile(join(root, 'html', 'index.html'), 'utf8')).window.document
    const pages = ['chapter-07-block-01', 'chapter-07-block-02'].map(id => document.querySelector<HTMLElement>(`#${id}`))

    for (const page of pages) {
      const plan = page?.querySelector<HTMLElement>('.analysis-site-plan')
      const svg = plan?.querySelector<SVGElement>('svg[role="img"][aria-label]')
      expect(plan).not.toBeNull()
      expect(plan?.dataset.publishable).toBe('false')
      expect(svg?.getAttribute('aria-label')).toMatch(/示例总平|场地研究/u)
      expect(svg?.querySelector('[data-map-layer="context"]')).not.toBeNull()
      expect(svg?.querySelector('[data-map-layer="concept-boundary"]')).not.toBeNull()
      expect(svg?.querySelector('[data-map-anchor]')).not.toBeNull()
      expect(svg?.textContent).toMatch(/城市道路|建筑肌理/u)
      expect(svg?.textContent).toMatch(/水岸|功能分区/u)
      expect(plan?.textContent).toContain('研究范围（待核） · 非法定红线 · 非测绘成果')
      expect(plan?.textContent).toMatch(/总平图.*红线图.*CRS.*闭合坐标.*GeoJSON.*复核确认/u)
    }
  })

  it('keeps the site-plan building-text label above the concept-boundary edge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-site-plan-label-geometry-html-'))
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

    await renderHtml({ report: bundle.report, plan: planClientPages(bundle.report, 'html'), identity: bundle.identity }, root)
    const document = new JSDOM(await readFile(join(root, 'html', 'index.html'), 'utf8')).window.document
    const page = document.querySelector<HTMLElement>('#chapter-07-block-01')
    const boundary = page?.querySelector<SVGPathElement>('[data-map-layer="concept-boundary"] path')
    const label = Array.from(page?.querySelectorAll<SVGTextElement>('[data-map-layer="context"] text') ?? [])
      .find(text => text.textContent === '周边建筑肌理')
    const boundaryTop = Number(boundary?.getAttribute('d')?.match(/^M\d+\s+(\d+)/u)?.[1])
    const labelY = Number(label?.getAttribute('y'))

    // The baseline must leave a readable vertical gap above the boundary edge;
    // this catches moving the label back onto the cyan dashed line.
    expect(Number.isFinite(boundaryTop)).toBe(true)
    expect(Number.isFinite(labelY)).toBe(true)
    expect(labelY).toBeLessThanOrEqual(boundaryTop - 12)
  })

  it('renders P27 and P33 as labelled directed relationships and P35 as a converging decision graph', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-directed-analysis-html-'))
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

    await renderHtml({ report: bundle.report, plan: planClientPages(bundle.report, 'html'), identity: bundle.identity }, root)
    const document = new JSDOM(await readFile(join(root, 'html', 'index.html'), 'utf8')).window.document
    const stylesheet = document.querySelector('style')?.textContent ?? ''
    const assertDirected = (selector: string, minimumNodes: number, minimumEdges: number): HTMLElement => {
      const page = document.querySelector<HTMLElement>(selector)
      expect(page?.querySelectorAll('[data-analysis-node]').length).toBeGreaterThanOrEqual(minimumNodes)
      const edges = Array.from(page?.querySelectorAll<HTMLElement>('[data-relation-label][data-from][data-to]') ?? [])
      expect(edges.length).toBeGreaterThanOrEqual(minimumEdges)
      for (const edge of edges) {
        expect(edge.dataset.relationLabel?.trim()).not.toBe('')
        expect(edge.getAttribute('aria-label')).toMatch(/→|流向|汇聚|形成|支撑/u)
        expect(edge.querySelector('svg[role="img"] marker')).not.toBeNull()
      }
      return page!
    }

    assertDirected('#chapter-08-block-01', 7, 6)
    const triad = assertDirected('#chapter-10-block-01', 4, 3)
    expect(triad.querySelectorAll('[data-to="triad-common-unlock"]')).toHaveLength(3)
    expect(triad.querySelectorAll('[data-analysis-node^="triad-output-"]')).toHaveLength(0)
    expect(triad.querySelector('[data-analysis-node="triad-common-unlock"]')?.textContent)
      .toContain('形成统一输入（定位结论·首期边界图·协同机制）')
    for (const output of ['形成定位结论', '形成首期边界图', '形成协同机制']) {
      expect(triad.textContent).toContain(output)
    }
    const closing = assertDirected('#closing-decision', 4, 3)
    const commonTarget = closing.querySelector<HTMLElement>('[data-analysis-node="shared-unlock"]')
    expect(commonTarget?.textContent).toMatch(/共同决策|解锁|下一阶段/u)
    expect(closing.querySelectorAll('[data-to="shared-unlock"]')).toHaveLength(3)
    expect(closing.querySelector('.decision-list')).toBeNull()
    expect(stylesheet).not.toMatch(/\.analysis-convergence[^{}]*\{[^{}]*transform:rotate\(90deg\)/u)
  })
})
