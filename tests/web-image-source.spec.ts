import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { expect, it, vi } from 'vitest'
import { acquireWebImage, discoverCasePublicationImages, validateCachedWebImage, validateWebImageCase } from '../src/visual/web-image-source.ts'
import { validateProjectDirectoryWithAjv } from '@architectureworld/presentation-contracts'
import { presentationContractPackageRoot } from '../src/presentation/standard-contract.ts'

const candidate = { imageUrl: 'https://example.org/original.png', sourcePageUrl: 'https://example.org/article', publisher: '公共项目资料', author: '摄影作者', usageRights: '来源页注明署名使用', sourceLocation: '中国浙江', description: '树荫步道全景', evidenceExcerpt: '建成后的步道向公众开放。' }
const imageResponse = (data: Uint8Array) => new Response(Uint8Array.from(data).buffer, { headers: { 'content-type': 'image/png' } })
it('stores downloaded originals as declared candidates in an existing standard project', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'standard-web-images-'))
  const root = join(parent, 'project')
  const data = PNG.sync.write(new PNG({ width: 1200, height: 800 }))
  try {
    await cp(join(presentationContractPackageRoot(), 'fixtures/minimal/project_01992a80-0000-7000-8000-000000000001-minimal-project'),
      root, { recursive: true })
    const fetcher = vi.fn(async (input: any) => String(input).endsWith('.png') ? imageResponse(data)
      : new Response('<img src="/original.png">建成后的步道向公众开放。'))
    const material = await acquireWebImage(candidate, { root, trustedHosts: ['example.org'], fetch: fetcher, signal: AbortSignal.timeout(3000) })
    expect(material.sourcePath).toBe(join(root, 'assets', 'images', `${createHash('sha256').update(data).digest('hex')}.png`))
    const manifest = JSON.parse(await readFile(join(root, 'assets', 'manifest.json'), 'utf8'))
    expect(manifest.assets).toMatchObject([{ relativePath: `assets/images/${createHash('sha256').update(data).digest('hex')}.png`, adoptionStatus: 'candidate' }])
    expect((await validateProjectDirectoryWithAjv(root, { allowGitKeep: true })).valid).toBe(true)
    expect((await readdir(join(root, '.pre-design', 'web-images'))).some(name => name.endsWith('.png'))).toBe(false)
    expect((await acquireWebImage(candidate, { root, trustedHosts: ['example.org'], fetch: fetcher, signal: AbortSignal.timeout(3000) })).sourcePath).toBe(material.sourcePath)
    expect(fetcher).toHaveBeenCalledTimes(2)
  } finally { await rm(parent, { recursive: true, force: true }) }
})
it('does not collect a sibling recruitment image from outside the established article content', async () => {
  const sourcePageUrl = 'https://www.gooood.cn/park', registeredImageUrl = 'https://www.gooood.cn/park-plan.png'
  const evidenceExcerpt = '项目地点：中国浙江杭州。'
  const html = `<article><div class="entry-content-shell">${evidenceExcerpt}<img src="${registeredImageUrl}" alt="总平面"></div>
    <div class="recruitment"><img src="/recruitment.png" alt="招聘平面设计师"></div></article>`
  const candidates = await discoverCasePublicationImages({ name: '杭州公园', mediaPurpose: 'circulation',
    publicationSources: [{ sourcePageUrl, evidenceExcerpt, registeredImageUrl }] }, {
    signal: AbortSignal.timeout(3000), fetch: async () => new Response(html),
  })
  expect(candidates.map(candidate => candidate.imageUrl)).toEqual([registeredImageUrl])
})
it('uses an original URL from inert JSON only when its thumbnail belongs to the same article', async () => {
  const root = await mkdtemp(join(tmpdir(), 'published-original-')), data = PNG.sync.write(new PNG({ width: 1600, height: 900 }))
  const sourcePageUrl = 'https://www.gooood.cn/published-park', imageUrl = 'https://www.gooood.cn/uploads/park-plan.png'
  const evidenceExcerpt = '项目地点：中国浙江杭州。', source = { ...candidate, sourcePageUrl, imageUrl,
    sourceLocation: '中国浙江杭州', sourceLocationEvidence: evidenceExcerpt, evidenceExcerpt }
  const html = `<article>${evidenceExcerpt}<img src="/uploads/park-plan-960x540.png" alt="公园流线总平面"></article>
    <script type="application/json">${JSON.stringify([imageUrl, 'https://www.gooood.cn/uploads/unrelated-plan.png'])}</script>`
  try {
    const material = await acquireWebImage(source, { root, signal: AbortSignal.timeout(3000),
      fetch: async address => String(address) === sourcePageUrl ? new Response(html) : imageResponse(data) })
    expect(material.widthPx).toBe(1600)
    expect(await validateWebImageCase(material, { name: '杭州公园', location: '浙江·杭州', publicationSources: [{ sourcePageUrl,
      evidenceExcerpt, registeredImageUrl: 'https://www.gooood.cn/uploads/park-plan-960x540.png' }] },
    { root, signal: AbortSignal.timeout(3000) })).toBeDefined()
    await expect(acquireWebImage({ ...source, imageUrl: 'https://www.gooood.cn/uploads/unrelated-plan.png' }, {
      root, signal: AbortSignal.timeout(3000), fetch: async () => new Response(html),
    })).rejects.toThrow('WEB_IMAGE_SOURCE_UNVERIFIED')
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('recognizes a selected case through its verified publication and location passage despite display-name/address formatting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-case-publication-')), data = PNG.sync.write(new PNG({ width: 1200, height: 800 }))
  const sourcePageUrl = 'https://www.gooood.cn/tea-house', imageUrl = 'https://www.gooood.cn/tea-house-plan.png'
  const evidenceExcerpt = '项目地点：浙江省杭州市青林茶园。'
  const source = { ...candidate, sourcePageUrl, imageUrl, sourceLocation: '浙江省杭州市', sourceLocationEvidence: evidenceExcerpt,
    evidenceExcerpt: '茶室位于青林茶园，已经建成并对公众开放。' }
  const requested = { name: '杭州青林茶室', location: '中国·浙江·杭州', publicationSources: [{ sourcePageUrl, evidenceExcerpt, registeredImageUrl: imageUrl }] }
  try {
    const material = await acquireWebImage(source, { root, signal: AbortSignal.timeout(1000), fetch: async (input: any) => String(input).endsWith('.png')
      ? imageResponse(data) : new Response(`<article><h1>青林茶室 / 浙江杭州</h1><img src="${imageUrl}">${evidenceExcerpt}${source.evidenceExcerpt}</article>`) })
    expect(await validateWebImageCase(material, requested, { root, signal: AbortSignal.timeout(1000) })).toMatchObject({ sourcePath: material.sourcePath })
    // A publisher URL or a model's alternate name alone does not establish the case.
    for (const publicationSources of [[], [{ sourcePageUrl: 'https://www.gooood.cn/other-case', evidenceExcerpt, registeredImageUrl: imageUrl }],
      [{ sourcePageUrl, evidenceExcerpt: '项目地点：并不存在于页面的地址。', registeredImageUrl: imageUrl }],
      [{ sourcePageUrl, evidenceExcerpt, registeredImageUrl: 'https://www.gooood.cn/not-published.png' }]]) {
      expect(await validateWebImageCase(material, { ...requested, publicationSources }, { root, signal: AbortSignal.timeout(1000) })).toBeUndefined()
    }
    expect(material.imageQuality?.inspection).toBeUndefined()
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('does not use an associated publication to validate a location taken from another project on the same page', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-case-location-')), data = PNG.sync.write(new PNG({ width: 1200, height: 800 }))
  const sourcePageUrl = 'https://www.gooood.cn/tea-house', imageUrl = 'https://www.gooood.cn/tea-house-plan.png'
  const actual = '项目地点：浙江省杭州市青林茶园。', other = '另一个参照项目位于日本北海道。'
  try {
    const material = await acquireWebImage({ ...candidate, sourcePageUrl, imageUrl, sourceLocation: '日本北海道', sourceLocationEvidence: other },
      { root, signal: AbortSignal.timeout(1000), fetch: async (input: any) => String(input).endsWith('.png') ? imageResponse(data)
        : new Response(`<article><img src="${imageUrl}">${candidate.evidenceExcerpt}${actual}${other}</article>`) })
    expect(await validateWebImageCase(material, { name: '杭州青林茶室', location: '中国·浙江·杭州',
      publicationSources: [{ sourcePageUrl, evidenceExcerpt: actual, registeredImageUrl: imageUrl }] }, { root, signal: AbortSignal.timeout(1000) })).toBeUndefined()
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('rejects same-city recommendation images and same-address captions outside the selected article body', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-case-article-')), data = PNG.sync.write(new PNG({ width: 1200, height: 800 }))
  const sourcePageUrl = 'https://www.gooood.cn/tea-house', imageUrl = 'https://www.gooood.cn/other-project.png'
  const evidenceExcerpt = '项目地点：浙江省杭州市青林茶园。', other = '杭州青林茶室的同城推荐：另一项目的活动庭院与茶饮空间。'
  const requested = { name: '杭州青林茶室', location: '浙江省杭州市', publicationSources: [{ sourcePageUrl, evidenceExcerpt, registeredImageUrl: imageUrl }] }
  try {
    for (const [index, recommendation] of [
      `<article>${other}<img src="${imageUrl}"></article>`,
      `<aside>${evidenceExcerpt}${other}<img src="${imageUrl}"></aside>`,
      `<section class="related-posts">${evidenceExcerpt}${other}<img src="${imageUrl}"></section>`,
    ].entries()) {
      const source = { ...candidate, sourcePageUrl, imageUrl, sourceLocation: '浙江省杭州市', sourceLocationEvidence: evidenceExcerpt, evidenceExcerpt: other }
      const isolated = join(root, String(index))
      const material = await acquireWebImage(source, { root: isolated, signal: AbortSignal.timeout(1000), fetch: async (input: any) => String(input).endsWith('.png')
        ? imageResponse(data) : new Response(`<article><h1>青林茶室</h1>${evidenceExcerpt}${recommendation}</article>`) })
      expect(await validateWebImageCase(material, requested, { root: isolated, signal: AbortSignal.timeout(1000) })).toBeUndefined()
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('archives the real original and provenance but never certifies it visually from labels', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-images-'))
  const data = PNG.sync.write(new PNG({ width: 1200, height: 800 }))
  try {
    const result = await acquireWebImage(candidate, { root, trustedHosts: ['example.org'], fetch: async (url: any) => String(url).endsWith('.png')
      ? imageResponse(data) : new Response('<img src="/original.png">建成后的步道向公众开放。'), signal: AbortSignal.timeout(1000) })
    expect(result).toMatchObject({ semanticRole: 'source_evidence', widthPx: 1200, heightPx: 800 })
    expect(result.origin.method).toContain('中国浙江')
    expect(result.imageQuality?.inspection).toBeUndefined()
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('rejects an unverified source, thumbnail and local/redirect target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-images-'))
  try {
    await expect(acquireWebImage(candidate, { root, trustedHosts: [], signal: AbortSignal.timeout(1000) })).rejects.toThrow('WEB_IMAGE_SOURCE_UNTRUSTED')
    await expect(acquireWebImage({ ...candidate, imageUrl: 'http://127.0.0.1/secret' }, { root, trustedHosts: ['example.org'], signal: AbortSignal.timeout(1000) })).rejects.toThrow('WEB_IMAGE_URL_INVALID')
    const data = PNG.sync.write(new PNG({ width: 200, height: 100 }))
    await expect(acquireWebImage(candidate, { root, trustedHosts: ['example.org'], fetch: async (url: any) => String(url).endsWith('.png') ? imageResponse(data) : new Response('<img src="/original.png">建成后的步道向公众开放。'), signal: AbortSignal.timeout(1000) })).rejects.toThrow('WEB_IMAGE_RESOLUTION')
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('rejects a trusted source-page redirect to an untrusted publisher before fetching its content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-images-'))
  const calls: string[] = [], data = PNG.sync.write(new PNG({ width: 1200, height: 800 }))
  try {
    const fetcher = async (input: URL | RequestInfo) => { const address = String(input); calls.push(address)
      if (address === candidate.sourcePageUrl) return new Response(null, { status: 302, headers: { location: 'https://untrusted.example/article' } })
      return address.endsWith('.png') ? imageResponse(data) : new Response('<img src="https://example.org/original.png">建成后的步道向公众开放。') }
    await expect(acquireWebImage(candidate, { root, trustedHosts: ['example.org'], fetch: fetcher as typeof fetch, signal: AbortSignal.timeout(1000) })).rejects.toThrow('WEB_IMAGE_SOURCE_UNTRUSTED')
    expect(calls).toEqual([candidate.sourcePageUrl])
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('resolves image links against the final trusted source URL and records both final download URLs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-images-')), data = PNG.sync.write(new PNG({ width: 1200, height: 800 }))
  const sourcePageUrl = 'https://example.org/article', finalSourcePageUrl = 'https://example.org/built/article/'
  const imageUrl = 'https://example.org/built/article/original.png', finalImageUrl = 'https://images.example.net/full.png'
  try {
    const fetcher = async (input: URL | RequestInfo) => {
      const address = String(input)
      if (address === sourcePageUrl) return new Response(null, { status: 301, headers: { location: finalSourcePageUrl } })
      if (address === imageUrl) return new Response(null, { status: 302, headers: { location: finalImageUrl } })
      return address === finalImageUrl ? imageResponse(data) : new Response('<img src="original.png">建成后的步道向公众开放。')
    }
    const result = await acquireWebImage({ ...candidate, sourcePageUrl, imageUrl }, { root, trustedHosts: ['example.org'], fetch: fetcher as typeof fetch, signal: AbortSignal.timeout(1000) })
    expect(JSON.parse(result.origin.method)).toMatchObject({ sourcePageUrl, imageUrl, finalSourcePageUrl, finalImageUrl })
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('does not promote unsupported location, author or usage claims into verified source evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-images-')), data = PNG.sync.write(new PNG({ width: 1200, height: 800 }))
  try {
    const result = await acquireWebImage(candidate, { root, trustedHosts: ['example.org'], fetch: async (input: any) => String(input).endsWith('.png')
      ? imageResponse(data) : new Response('<img src="/original.png"><article>项目位于日本东京。建成后的步道向公众开放。</article><script>中国浙江 摄影作者 来源页注明署名使用</script>'), signal: AbortSignal.timeout(1000) })
    expect(result.imageQuality?.sourceLocation).toBeUndefined()
    expect(JSON.parse(result.origin.method).sourceClaims).toMatchObject({ sourceLocation: { value: '中国浙江', status: 'unverified' }, author: { status: 'unverified' }, usageRights: { status: 'unverified' } })
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('records supporting excerpts for corroborated claims and validates the archived page before cache reuse', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-images-')), data = PNG.sync.write(new PNG({ width: 1200, height: 800 }))
  const evidence = { sourceLocationEvidence: '项目地点：中国浙江。', authorEvidence: '本图摄影：摄影作者。', usageRightsEvidence: '图片使用说明：来源页注明署名使用。', publisherEvidence: '发布单位：公共项目资料。' }
  try {
    const fetcher = vi.fn(async (input: any) => String(input).endsWith('.png') ? imageResponse(data)
      : new Response(`<img src="/original.png"><article>${candidate.evidenceExcerpt}${Object.values(evidence).join('')}</article>`))
    const result = await acquireWebImage({ ...candidate, ...evidence }, { root, trustedHosts: ['example.org'], fetch: fetcher, signal: AbortSignal.timeout(1000) })
    const method = JSON.parse(result.origin.method)
    expect(result.imageQuality?.sourceLocation).toBe('中国浙江')
    expect(method.sourceClaims).toMatchObject({ sourceLocation: { status: 'supported', evidenceExcerpt: evidence.sourceLocationEvidence }, author: { status: 'supported' }, usageRights: { status: 'supported' }, publisher: { status: 'supported' } })
    expect((await readFile(result.sourcePath)).length).toBeGreaterThan(0)
    const reused = await acquireWebImage({ ...candidate, ...evidence }, { root, trustedHosts: ['example.org'], fetch: fetcher, signal: AbortSignal.timeout(1000) })
    expect(reused.imageQuality?.sourceLocation).toBe('中国浙江')
    // Review caches bind this string's hash; harmless JSON key reordering must
    // not make a completed source review look stale and consume another task.
    expect(reused.origin.method).toBe(result.origin.method)
    expect(fetcher).toHaveBeenCalledTimes(2)
    const directory = join(root, '.pre-design', 'web-images')
    const archivedPage = (await readdir(directory)).find(name => name.endsWith('.source.html'))!
    await writeFile(join(directory, archivedPage), '<p>Changed page without the image or its source claims.</p>')
    await acquireWebImage({ ...candidate, ...evidence }, { root, trustedHosts: ['example.org'], fetch: fetcher, signal: AbortSignal.timeout(1000) })
    expect(fetcher).toHaveBeenCalledTimes(4)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('honors cancellation even when a matching local image receipt exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-images-')), data = PNG.sync.write(new PNG({ width: 1200, height: 800 }))
  try {
    const fetcher = vi.fn(async (input: any) => String(input).endsWith('.png') ? imageResponse(data) : new Response('<img src="/original.png">建成后的步道向公众开放。'))
    await acquireWebImage(candidate, { root, trustedHosts: ['example.org'], fetch: fetcher, signal: AbortSignal.timeout(1000) })
    const controller = new AbortController(); controller.abort(new Error('STOPPED'))
    await expect(acquireWebImage(candidate, { root, trustedHosts: ['example.org'], fetch: fetcher, signal: controller.signal })).rejects.toThrow('STOPPED')
    expect(fetcher).toHaveBeenCalledTimes(2)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('sanitizes invalid source candidate failures without echoing submitted extra data', async () => {
  await expect(acquireWebImage({ ...candidate, injected: 'PRIVATE_SOURCE_TEXT' } as never,
    { root: tmpdir(), trustedHosts: ['example.org'], signal: AbortSignal.timeout(1000) })).rejects.toThrow(/^WEB_IMAGE_CANDIDATE_INVALID$/u)
})
it('does not redownload an invalid archive during cache-only validation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-images-cache-only-')), data = PNG.sync.write(new PNG({ width: 1200, height: 800 }))
  try {
    const fetcher = vi.fn(async (input: any) => String(input).endsWith('.png') ? imageResponse(data) : new Response('<img src="/original.png">建成后的步道向公众开放。'))
    await acquireWebImage(candidate, { root, trustedHosts: ['example.org'], fetch: fetcher, signal: new AbortController().signal })
    const directory = join(root, '.pre-design', 'web-images'), archive = (await readdir(directory)).find(name => name.endsWith('.source.html'))!
    await writeFile(join(directory, archive), '<p>The original evidence is no longer present.</p>')
    await expect(acquireWebImage(candidate, { root, trustedHosts: ['example.org'], fetch: fetcher, signal: new AbortController().signal, cacheOnly: true })).rejects.toThrow('WEB_IMAGE_CACHE_INVALID')
    expect(fetcher).toHaveBeenCalledTimes(2)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('invalidates a saved final-plan source proof when the canonical archive changes but image pixels do not', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-images-plan-proof-')), data = PNG.sync.write(new PNG({ width: 1200, height: 800 }))
  const trusted = { ...candidate, sourcePageUrl: 'https://www.gooood.cn/article', imageUrl: 'https://www.gooood.cn/original.png' }
  const page = '<img src="/original.png">建成后的步道向公众开放。'
  try {
    const saved = await acquireWebImage(trusted, { root, signal: new AbortController().signal,
      fetch: async (input: any) => String(input).endsWith('.png') ? imageResponse(data) : new Response(page) })
    const valid = await validateCachedWebImage(saved, { root, signal: new AbortController().signal })
    expect(valid?.sourcePath).toBe(saved.sourcePath)
    expect(JSON.parse(valid!.origin.method)).toEqual(JSON.parse(saved.origin.method))
    const directory = join(root, '.pre-design', 'web-images'), entries = await readdir(directory)
    const archive = join(directory, entries.find(name => name.endsWith('.source.html'))!), receipt = join(directory, entries.find(name => name.endsWith('.json'))!)
    const changedPage = `${page}<p>新增正文：部分步道已经关闭。</p>`
    const current = JSON.parse(await readFile(receipt, 'utf8')), provenance = JSON.parse(current.origin.method)
    provenance.sourcePageSha256 = createHash('sha256').update(changedPage).digest('hex')
    current.origin.method = JSON.stringify(provenance)
    await writeFile(archive, changedPage); await writeFile(receipt, JSON.stringify(current))
    expect(await acquireWebImage(trusted, { root, signal: new AbortController().signal, cacheOnly: true })).toMatchObject({ sourcePath: saved.sourcePath })
    expect(await validateCachedWebImage(saved, { root, signal: new AbortController().signal })).toBeUndefined()
    const controller = new AbortController(), reason = new Error('USER_CANCELLED'); controller.abort(reason)
    await expect(validateCachedWebImage(current, { root, signal: controller.signal })).rejects.toBe(reason)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('extracts full originals from a publication descriptor without an image URL, within the evidenced article', async () => {
  const { discoverPublicationImages } = await import('../src/visual/web-image-source.ts')
  const { imageUrl: _unused, ...publication } = { ...candidate, sourcePageUrl: 'https://www.gooood.cn/park',
    sourceLocationEvidence: '项目地点：中国浙江杭州。' }
  const html = `<main><article><div class="entry-content">${publication.evidenceExcerpt}${publication.sourceLocationEvidence}
    <a href="mailto:editor@example.org">编辑</a><img src="/walk-640x360.png" alt="林下步道"><img src="/plan.png" alt="总平面">
    <div hidden><img src="/hidden.png"></div><div style="display:none"><img src="/css-hidden.png"></div>
    <aside><img src="/related.png"></aside><div class="advertisement"><img src="/ad.png"></div>
    <article><img src="/nested.png"></article></div><img src="/outside.png"></article></main>
    <script type="application/json">["/walk.png","/foreign.png"]</script>`
  const result = await discoverPublicationImages([publication], { signal: AbortSignal.timeout(3000), mediaPurpose: 'scene', fetch: async () => new Response(html) })
  expect(result.map(value => value.imageUrl)).toEqual(['https://www.gooood.cn/walk.png', 'https://www.gooood.cn/plan.png'])
  expect(result[0]).toMatchObject(publication)
})
it.each(['missing excerpt', 'missing location', 'split bodies', 'hidden evidence', 'untrusted source'])(
  'rejects a publication with %s', async mode => {
  const { discoverPublicationImages } = await import('../src/visual/web-image-source.ts')
  const { imageUrl: _unused, ...publication } = { ...candidate, sourcePageUrl: mode === 'untrusted source' ? 'https://example.org/park' : 'https://www.gooood.cn/park',
    sourceLocationEvidence: '项目地点：中国浙江杭州。' }
  const excerpt = mode === 'missing excerpt' ? '另外一个项目的介绍内容。' : publication.evidenceExcerpt
  const location = mode === 'missing location' ? '项目地点：法国巴黎。' : publication.sourceLocationEvidence
  const html = mode === 'split bodies' ? `<article>${excerpt}<img src="/walk.png"></article><article>${location}</article>`
    : `<article>${mode === 'hidden evidence' ? `<div hidden>${excerpt}${location}</div>` : excerpt + location}<img src="/walk.png"></article>`
  await expect(discoverPublicationImages([publication], { signal: AbortSignal.timeout(3000), fetch: async () => new Response(html) })).rejects.toThrow(/WEB_IMAGE_SOURCE_(?:UNVERIFIED|UNTRUSTED)/u)
})
it('propagates publication extraction cancellation', async () => {
  const { discoverPublicationImages } = await import('../src/visual/web-image-source.ts')
  const { imageUrl: _unused, ...publication } = { ...candidate, sourcePageUrl: 'https://www.gooood.cn/park', sourceLocationEvidence: '项目地点：中国浙江杭州。' }
  const controller = new AbortController(), reason = new Error('USER_CANCELLED')
  await expect(discoverPublicationImages([publication], { signal: controller.signal, fetch: async () => { controller.abort(reason); throw reason } })).rejects.toBe(reason)
})
