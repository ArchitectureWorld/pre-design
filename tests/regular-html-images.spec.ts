// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { renderRegularHtml } from '../src/report/regular/render-html.ts'
import { planRegularManuscriptPage } from '../src/report/regular/layout.ts'
import type { ClientRenderContext } from '../src/report/client-types.ts'

it('shares identical photo files across pages while verifying every source and retaining asset identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'regular-html-images-'))
  try {
    const bytes = await readFile(join(process.cwd(), 'tests/fixtures/golden-project/assets/concept-01.jpg'))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const sources = ['first.jpg', 'second.jpg'].map(name => join(root, name))
    for (const path of sources) await writeFile(path, bytes)
    const assets = sources.map((sourcePath, i) => ({ assetId: `photo-${i}`, sourcePath, sha256, caption: '公共活动空间' }))
    const context = { report: { identity: { reportTitle: '项目汇报' }, chapters: [], assets }, identity: { projectId: 'project', sourceRevision: 1, recommendationId: 'choice', adoptedAssetIds: assets.map(a => a.assetId) },
      plan: { pages: assets.map(asset => ({ pageId: asset.assetId, headline: '场景体验', regularLayout: { mode: 'left', chapterTitle: '产品体验', texts: [], media: [{ assetId: asset.assetId, fit: 'cover', box: { x: 0, y: 0, w: 6.6, h: 7.5 } }] } })) } } as unknown as ClientRenderContext
    await renderRegularHtml(context, root)
    const files = await readdir(join(root, 'html/assets/images'))
    expect(files).toHaveLength(1)
    const html = await readFile(join(root, 'html/index.html'), 'utf8')
    expect(html).toContain('data-asset-id="photo-0"')
    expect(html).toContain('data-asset-id="photo-1"')
    expect([...html.matchAll(/src="(assets\/images\/[^" ]+)"/gu)].map(match => match[1])).toEqual([`assets/images/${files[0]}`, `assets/images/${files[0]}`])
    await writeFile(sources[1]!, Buffer.from('changed bytes'))
    await expect(renderRegularHtml(context, join(root, 'changed'))).rejects.toThrow('REGULAR_IMAGE_CHANGED: photo-1')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('renders a centered, 65-percent-transparent stage caption with opaque readable text and source-family evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'regular-stage-caption-'))
  try {
    const bytes = await readFile(join(process.cwd(), 'tests/fixtures/golden-project/assets/concept-01.jpg'))
    const sha256 = createHash('sha256').update(bytes).digest('hex'), sourcePath = join(root, 'scene.jpg')
    await writeFile(sourcePath, bytes)
    const asset = { assetId: 'photo', sourcePath, sha256, caption: '公共空间', role: 'product-scene' as const, chapterId: 'c', sourceKind: 'ai-concept' as const,
      width: 4000, height: 900, stageNodeIds: ['entry'], imageIdentity: { originalId: 'source-family', fileSha256: sha256, verification: 'decoded-pixels' as const } }
    const [part] = planRegularManuscriptPage({ id: 'walk', kind: 'argument', editorialSummary: true, title: '公众体验', claim: '连接入口与停留空间。', body: [], notes: [], sourceRefs: [],
      visual: { kind: 'diagram', subject: '步行', purpose: '公众体验', caption: '公共空间', diagram: { nodes: [{ id: 'entry', label: '在公共入口保留连续步行并组织清晰可达的服务设施', column: 0, row: 0 }], edges: [] } } }, '活动组织', [asset], 0)
    const context = { report: { identity: { reportTitle: '项目汇报' }, chapters: [], assets: [asset] }, identity: { projectId: 'project', sourceRevision: 1, recommendationId: 'choice', adoptedAssetIds: ['photo'] },
      plan: { pages: [{ pageId: 'p1', headline: '公众体验', regularLayout: part!.layout }] } } as unknown as ClientRenderContext
    await renderRegularHtml(context, root)
    const html = await readFile(join(root, 'html/index.html'), 'utf8'), parsed = new DOMParser().parseFromString(html, 'text/html')
    document.head.innerHTML = parsed.head.innerHTML
    document.body.innerHTML = parsed.body.innerHTML
    const caption = document.querySelector<HTMLElement>('.regular-stage')!, image = document.querySelector<HTMLImageElement>('.regular-media')!
    const style = window.getComputedStyle(caption)
    expect(style.backgroundColor).toBe('rgba(245, 244, 239, 0.35)')
    expect(style.opacity).toBe('1')
    expect(style.textAlign).toBe('center')
    expect(style.color).toBe('rgb(32, 59, 60)')
    expect(caption.dataset.nodeId).toBe('entry')
    expect(image.dataset.originalId).toBe('source-family')
    expect(image.dataset.retainedArea).toBe('1')
    expect(image.dataset.imageReviewed).toBe('false')
    expect(parseFloat(caption.style.left) + parseFloat(caption.style.width) / 2).toBeCloseTo(parseFloat(image.style.left) + parseFloat(image.style.width) / 2, 5)
    expect(caption.textContent!.replace(/\n/gu, '')).toBe('在公共入口保留连续步行并组织清晰可达的服务设施')
    document.head.replaceChildren(); document.body.replaceChildren()
  } finally { await rm(root, { recursive: true, force: true }) }
})
