import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { lookup } from 'node:dns/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { parse as parseHtml, type DefaultTreeAdapterMap } from 'parse5'
import type { PresentationAdoptedAssetInput } from '../presentation/standard-project-types.ts'
import { verifiedRasterImageDimensions } from '../governance/site-boundary-asset-store.ts'

export const webImageCandidateSchema = z.object({ imageUrl: z.string().url(), sourcePageUrl: z.string().url(), publisher: z.string().min(1),
  author: z.string().min(1), usageRights: z.string().min(1), sourceLocation: z.string().min(1), description: z.string().min(1), evidenceExcerpt: z.string().min(8),
  sourceLocationEvidence: z.string().min(8).max(4000).optional(), authorEvidence: z.string().min(8).max(4000).optional(),
  usageRightsEvidence: z.string().min(8).max(4000).optional(), publisherEvidence: z.string().min(8).max(4000).optional(),
}).strict()
export type WebImageCandidate = z.infer<typeof webImageCandidateSchema>
export const webPublicationDescriptorSchema = webImageCandidateSchema.omit({ imageUrl: true }).extend({
  sourceLocationEvidence: z.string().min(8).max(4000),
})
export type WebPublicationDescriptor = z.infer<typeof webPublicationDescriptorSchema>
export const DEFAULT_IMAGE_SOURCE_HOSTS = ['gov.cn', 'edu.cn', 'archdaily.cn', 'archdaily.com', 'gooood.cn', 'archiposition.com', 'designboom.com', 'commons.wikimedia.org'] as const
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const PAGE_LIMIT = 5 * 1024 * 1024, IMAGE_LIMIT = 25 * 1024 * 1024
const claimSchema = z.object({ value: z.string(), status: z.enum(['supported', 'unverified']), evidenceExcerpt: z.string().optional() }).strict()
const claimNames = ['sourceLocation', 'author', 'usageRights', 'publisher'] as const
const sourceClaimsSchema = z.object({ sourceLocation: claimSchema, author: claimSchema, usageRights: claimSchema, publisher: claimSchema }).strict()
const provenanceSchema = webImageCandidateSchema.extend({ kind: z.literal('web-reference'), schemaVersion: z.literal('pre-design.web-image.v2'),
  retrievedAt: z.string().datetime(), fileSha256: z.string().regex(/^[a-f0-9]{64}$/u), sourcePageSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  finalSourcePageUrl: z.string().url(), finalImageUrl: z.string().url(), sourceClaims: sourceClaimsSchema,
  sourcePageRedirects: z.array(z.string().url()).min(1).max(4), imageRedirects: z.array(z.string().url()).min(1).max(4),
}).strict()
const privateHost = (host: string) => /^(localhost|.*\.localhost|.*\.local|0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::|\[?f[cd]|\[?fe[89ab])/iu.test(host)
function url(value: string): URL {
  let result: URL
  try { result = new URL(value) } catch { throw new Error('WEB_IMAGE_URL_INVALID') }
  if (!['https:', 'http:'].includes(result.protocol) || result.username || result.password || privateHost(result.hostname)) throw new Error('WEB_IMAGE_URL_INVALID')
  return result
}
function trusted(host: string, hosts: readonly string[]) { return hosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`)) }
interface Download { readonly bytes: Buffer; readonly contentType: string; readonly finalUrl: string; readonly redirects: readonly string[] }
async function boundedFetch(value: string, fetcher: typeof fetch, signal: AbortSignal, maximum: number, sourceHosts?: readonly string[]): Promise<Download> {
  let current = url(value)
  const visited: string[] = []
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted()
    if (sourceHosts && !trusted(current.hostname, sourceHosts)) throw new Error('WEB_IMAGE_SOURCE_UNTRUSTED')
    visited.push(current.href)
    if (fetcher === fetch) {
      const addresses = await lookup(current.hostname, { all: true })
      if (!addresses.length || addresses.some(a => privateHost(a.address))) throw new Error('WEB_IMAGE_URL_INVALID')
    }
    const response = await fetcher(current, { redirect: 'manual', signal, headers: { 'User-Agent': 'PreDesign-ImageEvidence/1.0' } })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      const location = response.headers.get('location'); if (!location) throw new Error('WEB_IMAGE_REDIRECT_INVALID')
      current = url(new URL(location, current).href); continue
    }
    if (!response.ok || !response.body) throw new Error(`WEB_IMAGE_DOWNLOAD_FAILED: HTTP ${response.status}`)
    if (Number(response.headers.get('content-length')) > maximum) { await response.body.cancel(); throw new Error('WEB_IMAGE_TOO_LARGE') }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
    try {
      for (;;) { signal.throwIfAborted(); const next = await reader.read(); if (next.done) break; size += next.value.length
        if (size > maximum) throw new Error('WEB_IMAGE_TOO_LARGE'); chunks.push(next.value) }
    } finally { await reader.cancel(); reader.releaseLock() }
    return { bytes: Buffer.concat(chunks), contentType: response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '', finalUrl: current.href, redirects: visited }
  }
  throw new Error('WEB_IMAGE_REDIRECT_LIMIT')
}
function textOfHtml(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/gu, ' ').replace(/<(head|title|script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ').replace(/&#(x[0-9a-f]+|[0-9]+);/giu, (_match, code: string) => {
      const point = code.toLowerCase().startsWith('x') ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10)
      return Number.isSafeInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' '
    }).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/giu, entity => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' })[entity.toLowerCase()]!)
}
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '').toLowerCase()
function corroboratedClaims(candidate: WebImageCandidate, pageText: string): z.infer<typeof sourceClaimsSchema> {
  const visible = normalize(pageText)
  return Object.fromEntries(claimNames.map(name => {
    const value = candidate[name].trim(), evidenceExcerpt = candidate[`${name}Evidence`] ?? candidate.evidenceExcerpt
    const evidence = normalize(evidenceExcerpt), claim = normalize(value)
    const supported = claim.length > 0 && !/^(unknown|n\/a|none|未知|不详|未说明|待核实|待查)$/iu.test(claim)
      && evidence.includes(claim) && visible.includes(evidence)
    return [name, { value, status: supported ? 'supported' : 'unverified', ...(supported ? { evidenceExcerpt } : {}) }]
  })) as z.infer<typeof sourceClaimsSchema>
}
function checkPage(candidate: WebImageCandidate, bytes: Buffer, finalUrl: string): z.infer<typeof sourceClaimsSchema> {
  const html = bytes.toString('utf8').replace(/&amp;/gu, '&'), text = textOfHtml(html)
  const links = [...html.matchAll(/(?:src|href|data-src|content)\s*=\s*["']([^"']+)["']/giu)].flatMap(match => {
    try { return new URL(match[1]!, finalUrl).href } catch { return [] }
  })
  const original = url(candidate.imageUrl).href
  if ((!links.includes(original) && !publicationBodies(html, finalUrl).some(body => body.images.has(original)))
    || !normalize(text).includes(normalize(candidate.evidenceExcerpt))) throw new Error('WEB_IMAGE_SOURCE_UNVERIFIED')
  return corroboratedClaims(candidate, text)
}
function materialFrom(candidate: WebImageCandidate, provenance: z.infer<typeof provenanceSchema>, bytes: Buffer, directory: string, mimeType: 'image/png' | 'image/jpeg'): PresentationAdoptedAssetInput {
  const dimensions = verifiedRasterImageDimensions(mimeType, bytes)
  if (Math.min(dimensions.width, dimensions.height) < 640 || Math.max(dimensions.width, dimensions.height) < 1024) throw new Error('WEB_IMAGE_RESOLUTION: 原图分辨率不足，搜索缩略图不能作为正式素材')
  const digest = hash(bytes), name = `${digest}.${mimeType === 'image/png' ? 'png' : 'jpg'}`, path = join(directory, name)
  return { sourceKey: `web-image:${digest}`, sourcePath: path, originalFileName: name, displayName: candidate.description,
    mimeType, semanticRole: 'source_evidence', widthPx: dimensions.width, heightPx: dimensions.height, createdAt: provenance.retrievedAt, adoptedAt: provenance.retrievedAt,
    objectIds: [], evidenceIds: [], pageBindingOnly: true, pageBindings: [], role: 'primary',
    imageIdentity: { originalId: digest, fileSha256: digest, verification: 'file-hash' },
    imageQuality: provenance.sourceClaims.sourceLocation.status === 'supported' ? { sourceLocation: provenance.sourceClaims.sourceLocation.value } : {},
    origin: { type: 'human_added', sourceMaterialKeys: [], parentAssetKeys: [], sourceTool: { name: 'pre-design-web-images', version: '2' }, method: JSON.stringify(provenanceSchema.parse(provenance)) } }
}
/** Archives source page and original; decoded pixels and later visual review are separate checks. */
export async function acquireWebImage(candidateInput: WebImageCandidate, options: { root: string; signal: AbortSignal; trustedHosts?: readonly string[]; fetch?: typeof fetch; cacheOnly?: boolean }): Promise<PresentationAdoptedAssetInput> {
  options.signal.throwIfAborted()
  const parsedCandidate = webImageCandidateSchema.safeParse(candidateInput)
  if (!parsedCandidate.success) throw new Error('WEB_IMAGE_CANDIDATE_INVALID')
  const candidate = parsedCandidate.data, source = url(candidate.sourcePageUrl), original = url(candidate.imageUrl)
  const hosts = options.trustedHosts ?? DEFAULT_IMAGE_SOURCE_HOSTS
  if (!trusted(source.hostname, hosts)) throw new Error('WEB_IMAGE_SOURCE_UNTRUSTED')
  const directory = join(options.root, '.pre-design', 'web-images'), key = hash(JSON.stringify(candidate)), receiptPath = join(directory, `${key}.json`)
  try {
    const receipt = z.object({ sourcePath: z.string(), mimeType: z.enum(['image/png', 'image/jpeg']), origin: z.object({ method: z.string() }) }).safeParse(JSON.parse(await readFile(receiptPath, { encoding: 'utf8', signal: options.signal })))
    const saved = receipt.success ? provenanceSchema.safeParse(JSON.parse(receipt.data.origin.method)) : undefined
    if (receipt.success && saved?.success) {
      const provenance = saved.data
      const storedCandidate = webImageCandidateSchema.parse(Object.fromEntries(Object.keys(webImageCandidateSchema.shape).map(name => [name, provenance[name as keyof typeof provenance]])))
      const path = join(directory, `${provenance.fileSha256}.${receipt.data.mimeType === 'image/png' ? 'png' : 'jpg'}`), pagePath = join(directory, `${key}.source.html`)
      const trustedHistory = provenance.sourcePageRedirects.every(address => trusted(url(address).hostname, hosts))
        && provenance.sourcePageRedirects[0] === source.href && provenance.sourcePageRedirects.at(-1) === provenance.finalSourcePageUrl
      const validImageHistory = provenance.imageRedirects.every(address => Boolean(url(address))) && provenance.imageRedirects[0] === original.href
        && provenance.imageRedirects.at(-1) === provenance.finalImageUrl
      if (hash(JSON.stringify(storedCandidate)) === key && resolve(receipt.data.sourcePath) === resolve(path) && trustedHistory && validImageHistory
        && (await stat(path)).size <= IMAGE_LIMIT && (await stat(pagePath)).size <= PAGE_LIMIT) {
        const bytes = await readFile(path, { signal: options.signal }), pageBytes = await readFile(pagePath, { signal: options.signal })
        if (hash(bytes) === provenance.fileSha256 && hash(pageBytes) === provenance.sourcePageSha256) {
          const claims = checkPage(candidate, pageBytes, provenance.finalSourcePageUrl)
          if (JSON.stringify(claims) === JSON.stringify(provenance.sourceClaims)) {
            options.signal.throwIfAborted()
            return materialFrom(candidate, provenance, bytes, directory, receipt.data.mimeType)
          }
        }
      }
    }
  } catch (error) { options.signal.throwIfAborted(); if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
  options.signal.throwIfAborted()
  if (options.cacheOnly) throw new Error('WEB_IMAGE_CACHE_INVALID')
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]), fetcher = options.fetch ?? fetch
  const page = await boundedFetch(source.href, fetcher, signal, PAGE_LIMIT, hosts)
  const sourceClaims = checkPage(candidate, page.bytes, page.finalUrl)
  const image = await boundedFetch(original.href, fetcher, signal, IMAGE_LIMIT)
  if (!['image/jpeg','image/png'].includes(image.contentType)) throw new Error('WEB_IMAGE_FORMAT_UNSUPPORTED: 请获取 JPEG/PNG 原图')
  const provenance = { kind: 'web-reference' as const, schemaVersion: 'pre-design.web-image.v2' as const, ...candidate, sourceClaims,
    retrievedAt: new Date().toISOString(), fileSha256: hash(image.bytes), sourcePageSha256: hash(page.bytes), finalSourcePageUrl: page.finalUrl,
    finalImageUrl: image.finalUrl, sourcePageRedirects: [...page.redirects], imageRedirects: [...image.redirects] }
  const material = materialFrom(candidate, provenance, image.bytes, directory, image.contentType as 'image/png' | 'image/jpeg')
  signal.throwIfAborted()
  await mkdir(directory, { recursive: true }); await writeFile(material.sourcePath, image.bytes); await writeFile(join(directory, `${key}.source.html`), page.bytes)
  await writeFile(receiptPath, JSON.stringify(material, null, 2) + '\n')
  return material
}

/** Rebuild from verified archive proof; receipt paths, labels and approvals grant no authority. */
export async function validateCachedWebImage(material: PresentationAdoptedAssetInput, options: { root: string; signal: AbortSignal }): Promise<PresentationAdoptedAssetInput | undefined> {
  options.signal.throwIfAborted()
  try {
    const provenance = provenanceSchema.parse(JSON.parse(material.origin.method))
    const candidate = webImageCandidateSchema.parse(Object.fromEntries(Object.keys(webImageCandidateSchema.shape)
      .map(name => [name, provenance[name as keyof typeof provenance]])))
    const verified = await acquireWebImage(candidate, { ...options, cacheOnly: true })
    const currentProof = provenanceSchema.parse(JSON.parse(verified.origin.method))
    // A saved final plan may outlive the canonical receipt. Any source text or
    // claim change invalidates that plan's review, even if image pixels match.
    if (resolve(material.sourcePath) !== resolve(verified.sourcePath) || JSON.stringify(currentProof) !== JSON.stringify(provenance)) return undefined
    options.signal.throwIfAborted()
    return verified
  } catch (error) {
    options.signal.throwIfAborted()
    if ((error as Error)?.name === 'AbortError' || (error as NodeJS.ErrnoException)?.code === 'ABORT_ERR') throw error
    return undefined
  }
}

export interface CasePublicationSource { readonly sourcePageUrl: string; readonly evidenceExcerpt: string; readonly registeredImageUrl: string }
function rasterFamilyUrl(value: string) {
  try { const address = url(value); return `${address.host}${address.pathname.replace(/-\d+x\d+(?=\.(?:png|jpe?g)$)/iu, '')}${address.search}` }
  catch { return undefined }
}
/** Keep a publication's own images/text separate from nested recommendations. */
function publicationBodies(html: string, sourceUrl: string): { text: string; images: Set<string>; hints: Map<string, string> }[] {
  type Node = DefaultTreeAdapterMap['node']
  type Element = DefaultTreeAdapterMap['element']
  const element = (node: Node): node is Element => 'tagName' in node
  const attr = (node: Element, name: string) => node.attrs.find(item => item.name === name)?.value ?? ''
  const excluded = (node: Element) => ['head', 'script', 'style', 'template', 'noscript', 'aside', 'nav', 'footer'].includes(node.tagName)
    || node.attrs.some(item => item.name === 'hidden') || attr(node, 'aria-hidden') === 'true'
    || ['complementary', 'navigation'].includes(attr(node, 'role'))
    || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(attr(node, 'style'))
    || /(?:^|[\s_-])(?:related|recommended|recommendations|comments?|sidebar|ads?|advertisement|advertising|recruitment)(?:$|[\s_-])/iu.test(`${attr(node, 'id')} ${attr(node, 'class')}`)
  const document = parseHtml(html), originals = new Set<string>()
  // Inert publication data often carries full-size originals while article HTML
  // carries only thumbnails. Never execute scripts or borrow text from them.
  const collectJsonUrls = (value: unknown, depth = 0) => {
    if (depth > 64) return
    if (typeof value === 'string') {
      try { const address = url(new URL(value, sourceUrl).href); if (/\.(?:png|jpe?g)$/iu.test(address.pathname)) originals.add(address.href) } catch { /* Not a public raster URL. */ }
    } else if (value && typeof value === 'object') for (const item of Object.values(value)) collectJsonUrls(item, depth + 1)
  }
  const scanData = (node: Node) => {
    if (element(node) && node.tagName === 'script' && /^application\/(?:ld\+)?json$/iu.test(attr(node, 'type'))) {
      try { collectJsonUrls(JSON.parse(node.childNodes.filter(child => child.nodeName === '#text').map(child => (child as DefaultTreeAdapterMap['textNode']).value).join(''))) } catch { /* Non-JSON scripts are never evidence. */ }
    }
    if ('childNodes' in node) for (const child of node.childNodes) scanData(child)
  }
  scanData(document)
  const bodies: { text: string; images: Set<string>; hints: Map<string, string> }[] = []
  const collect = (root: Element) => {
    const text: string[] = [], images = new Set<string>(), hints = new Map<string, string>()
    const shortText = (node: Node): string => {
      if (element(node) && excluded(node)) return ''
      if (node.nodeName === '#text') return (node as DefaultTreeAdapterMap['textNode']).value
      return 'childNodes' in node ? node.childNodes.map(shortText).join(' ') : ''
    }
    const captionOf = (node: Element) => {
      let container = node
      while (container !== root && !['p', 'figure'].includes(container.tagName) && container.parentNode && element(container.parentNode)) container = container.parentNode
      if (!['p', 'figure'].includes(container.tagName) || !container.parentNode) return ''
      const siblings = container.parentNode.childNodes, offset = siblings.indexOf(container)
      const previous = siblings.slice(0, offset).reverse().find(element)
      const caption = previous ? shortText(previous).trim() : ''
      return caption.length <= 200 ? caption : ''
    }
    const walk = (node: Node) => {
      if (element(node)) {
        if (excluded(node) || node !== root && node.tagName === 'article') return
        if (['img', 'a', 'source'].includes(node.tagName)) for (const name of ['src', 'data-src', 'data-original', 'href']) {
          const value = attr(node, name)
          if (value) try {
            const address = url(new URL(value, sourceUrl).href).href; images.add(address)
            const hint = [attr(node, 'alt'), attr(node, 'title'), captionOf(node)].filter(Boolean).join(' ')
            if (hint) hints.set(address, hint)
          } catch { /* Invalid links provide no proof. */ }
        }
      }
      if (node.nodeName === '#text') text.push((node as DefaultTreeAdapterMap['textNode']).value)
      if ('childNodes' in node) for (const child of node.childNodes) walk(child)
    }
    walk(root)
    const visibleFamilies = new Map([...images].flatMap(address => { const key = rasterFamilyUrl(address); return key ? [[key, address] as const] : [] }))
    for (const address of originals) {
      const key = rasterFamilyUrl(address), visible = key && visibleFamilies.get(key)
      if (visible) { images.add(address); if (hints.has(visible)) hints.set(address, hints.get(visible)!) }
    }
    bodies.push({ text: normalize(text.join(' ')), images, hints })
  }
  const visit = (node: Node, inArticle = false) => {
    if (element(node)) {
      if (excluded(node)) return
      if (node.tagName === 'article' && inArticle) return
      if (['article', 'main'].includes(node.tagName) || attr(node, 'itemprop').split(/\s+/u).includes('articleBody')
        || /(?:^|\s)(?:(?:entry|article|post)[-_]content(?:[-_]shell)?|prose|content-body)(?:\s|$)/iu.test(attr(node, 'class'))) collect(node)
      inArticle ||= node.tagName === 'article'
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child, inArticle)
  }
  visit(document)
  return bodies
}
function ownedPublicationBodies(bodies: ReturnType<typeof publicationBodies>, reference: CasePublicationSource) {
  const own = bodies.filter(body => body.text.includes(normalize(reference.evidenceExcerpt)) && body.images.has(url(reference.registeredImageUrl).href))
  const minimum = Math.min(...own.map(body => body.text.length))
  const narrow = own.filter(body => body.text.length === minimum)
  const imageCount = Math.min(...narrow.map(body => body.images.size))
  return narrow.filter(body => body.images.size === imageCount)
}
function publicationImageScore(imageUrl: string, caption: string, mediaPurpose: string): number {
  const address = url(imageUrl)
  let name = address.pathname; try { name = decodeURIComponent(name) } catch { /* Preserve the published spelling. */ }
  const analysis = /平面|总图|流线|鸟瞰|鸟览|俯瞰|轴侧|plan|circulation|aerial|axon/iu.test(`${caption} ${name}`)
  const wantsAnalysis = /circulation|area-overview|diagram|plan|map/iu.test(mediaPurpose)
  return (analysis === wantsAnalysis ? 100 : 0) - (/-\d+x\d+\.(?:png|jpe?g)$/iu.test(address.pathname) ? 20 : 0)
}
/** The model supplies publication evidence; only fetched HTML supplies image URLs. */
export async function discoverPublicationImages(publications: readonly WebPublicationDescriptor[],
  options: { signal: AbortSignal; fetch?: typeof fetch; mediaPurpose?: string }): Promise<WebImageCandidate[]> {
  const descriptors = z.array(webPublicationDescriptorSchema).max(3).parse(publications)
  const candidates: { value: WebImageCandidate; score: number }[] = []
  for (const descriptor of descriptors) {
    options.signal.throwIfAborted()
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
    const page = await boundedFetch(descriptor.sourcePageUrl, options.fetch ?? fetch, signal, PAGE_LIMIT, DEFAULT_IMAGE_SOURCE_HOSTS)
    const excerpt = normalize(descriptor.evidenceExcerpt), location = normalize(descriptor.sourceLocationEvidence)
    const claimedLocation = normalize(descriptor.sourceLocation)
    const bodies = publicationBodies(page.bytes.toString('utf8'), page.finalUrl).filter(body =>
      excerpt.length >= 8 && location.length >= 8 && claimedLocation.length > 0 && location.includes(claimedLocation)
      && !/^(unknown|n\/a|none|未知|不详|未说明|待核实|待查)$/iu.test(claimedLocation)
      && body.text.includes(excerpt) && body.text.includes(location))
    if (!bodies.length) throw new Error('WEB_IMAGE_SOURCE_UNVERIFIED: 发布页正文未同时证明描述与地点')
    const shortest = Math.min(...bodies.map(body => body.text.length))
    const narrow = bodies.filter(body => body.text.length === shortest)
    const fewestImages = Math.min(...narrow.map(body => body.images.size))
    for (const body of narrow.filter(body => body.images.size === fewestImages)) for (const imageUrl of body.images) {
      if (!/\.(?:png|jpe?g)$/iu.test(url(imageUrl).pathname)) continue
      candidates.push({ value: { ...descriptor, imageUrl },
        score: publicationImageScore(imageUrl, body.hints.get(imageUrl) ?? '', options.mediaPurpose ?? 'scene') })
    }
    options.signal.throwIfAborted()
  }
  const unique = new Map<string, WebImageCandidate>()
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const family = rasterFamilyUrl(candidate.value.imageUrl)!
    if (!unique.has(family)) unique.set(family, candidate.value)
  }
  return [...unique.values()].slice(0, 6)
}
/** Discover originals from an already established case publication, without
 * paying a language model to rediscover links lost by a text-only web reader. */
export async function discoverCasePublicationImages(requested: { name: string; mediaPurpose: string; publicationSources?: readonly CasePublicationSource[] },
  options: { signal: AbortSignal; fetch?: typeof fetch }): Promise<WebImageCandidate[]> {
  const candidates: { value: WebImageCandidate; score: number }[] = [], visited = new Set<string>()
  for (const reference of requested.publicationSources ?? []) {
    options.signal.throwIfAborted()
    if (visited.has(reference.sourcePageUrl) || visited.size >= 6) continue
    visited.add(reference.sourcePageUrl)
    try {
      const signal = AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
      const page = await boundedFetch(reference.sourcePageUrl, options.fetch ?? fetch, signal, PAGE_LIMIT, DEFAULT_IMAGE_SOURCE_HOSTS)
      const excerpt = reference.evidenceExcerpt.trim()
      if (normalize(excerpt).length < 8) continue
      const location = excerpt.match(/(?:项目地点|项目地址|地点|地址|location)\s*[:：]\s*([^。;；\n]+)/iu)?.[1]?.trim() ?? excerpt
      for (const body of ownedPublicationBodies(publicationBodies(page.bytes.toString('utf8'), page.finalUrl), reference)) {
        for (const imageUrl of body.images) {
          const address = url(imageUrl)
          if (!/\.(?:png|jpe?g)$/iu.test(address.pathname)) continue
          const caption = body.hints.get(imageUrl) ?? ''
          const score = publicationImageScore(imageUrl, caption, requested.mediaPurpose)
          candidates.push({ score, value: { imageUrl, sourcePageUrl: reference.sourcePageUrl, publisher: new URL(page.finalUrl).hostname,
            author: '未说明', usageRights: '未说明', sourceLocation: location, description: [requested.name, caption].filter(Boolean).join('：'),
            evidenceExcerpt: excerpt, sourceLocationEvidence: excerpt } })
        }
      }
    } catch (error) { options.signal.throwIfAborted(); if ((error as Error)?.name === 'AbortError' && !String((error as Error).message).includes('timeout')) throw error }
  }
  const unique = new Map<string, { value: WebImageCandidate; score: number }>()
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const key = rasterFamilyUrl(candidate.value.imageUrl)!
    if (!unique.has(key)) unique.set(key, candidate)
  }
  return [...unique.values()].slice(0, 6).map(item => item.value)
}
/** A selected case's verified publication can use a different display name/address format. */
export async function validateWebImageCase(material: PresentationAdoptedAssetInput, requested: { name: string; location: string; publicationSources?: readonly CasePublicationSource[] },
  options: { root: string; signal: AbortSignal }): Promise<PresentationAdoptedAssetInput | undefined> {
  const verified = await validateCachedWebImage(material, options)
  if (!verified) return undefined
  const provenance = provenanceSchema.parse(JSON.parse(verified.origin.method))
  const name = normalize(requested.name), location = normalize(requested.location), claim = provenance.sourceClaims.sourceLocation
  if (!name || !location || claim.status !== 'supported' || !normalize(claim.value)) return undefined
  const literalIdentity = normalize(provenance.evidenceExcerpt).includes(name) && normalize(claim.value) === location
  const samePublication = (value: string) => {
    try { const reference = url(value), actual = url(provenance.finalSourcePageUrl); reference.hash = ''; actual.hash = ''; return reference.href === actual.href }
    catch { return false }
  }
  const publications = requested.publicationSources?.filter(reference => samePublication(reference.sourcePageUrl)) ?? []
  // Matching display labels cannot bypass ownership on a selected publication.
  if (!literalIdentity || publications.length) {
    const candidate = webImageCandidateSchema.parse(Object.fromEntries(Object.keys(webImageCandidateSchema.shape)
      .map(key => [key, provenance[key as keyof typeof provenance]])))
    const sourcePath = join(options.root, '.pre-design', 'web-images', `${hash(JSON.stringify(candidate))}.source.html`)
    const page = await readFile(sourcePath, { signal: options.signal })
    if (hash(page) !== provenance.sourcePageSha256) return undefined
    const bodies = publicationBodies(page.toString('utf8'), provenance.finalSourcePageUrl)
    const established = publications.some(reference => typeof reference.evidenceExcerpt === 'string'
      && normalize(reference.evidenceExcerpt).length >= 8
      && normalize(reference.evidenceExcerpt).includes(normalize(claim.value))
      && ownedPublicationBodies(bodies, reference).some(body => body.text.includes(normalize(reference.evidenceExcerpt))
        && body.text.includes(normalize(provenance.evidenceExcerpt)) && body.text.includes(normalize(claim.evidenceExcerpt ?? ''))
        && body.images.has(url(provenance.imageUrl).href) && body.images.has(reference.registeredImageUrl)))
    if (!established) return undefined
  }
  options.signal.throwIfAborted()
  return verified
}
