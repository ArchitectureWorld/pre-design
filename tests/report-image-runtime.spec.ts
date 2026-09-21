import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'
import { afterEach, expect, it, vi } from 'vitest'
import { createNativeReportImagePipeline, reportImageDimensions } from '../src/presentation/report-image-runtime.ts'
import { checkVisualQuality } from '../src/visual/quality.ts'
import { ReportImagePipeline, type ReportImageDemand } from '../src/presentation/report-image-pipeline.ts'
import { acquireWebImage } from '../src/visual/web-image-source.ts'
import { imageBriefHash } from '../src/visual/image-policy.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'
import type { PresentationAdoptedAssetInput } from '../src/presentation/standard-project-types.ts'
import { WebRetrievalExhaustedError, type WebQueryAgent } from '../src/agent-classes/web-query.ts'
import { VisualAgentService } from '../src/visual/agent.ts'

// Network boundaries are local fixtures; the cache reader, downloader, parser,
// pixel validation and filesystem are the real production implementations.
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '203.0.113.10', family: 4 }] }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it.each([0.2, 0.5333333333, 0.8888888667, 1.7777777778, 2.2222221667, 3.3869601185, 5])('generates quality-qualified dimensions for a %f slot while retaining at least 80 percent', ratio => {
  const dimensions = reportImageDimensions(ratio)
  expect(checkVisualQuality({ ...dimensions, mimeType: 'image/png', bytes: 400_000 }).accepted).toBe(true)
  expect(dimensions.width % 16).toBe(0); expect(dimensions.height % 16).toBe(0)
  expect(Math.max(dimensions.width, dimensions.height)).toBeLessThanOrEqual(2048)
  const relative = dimensions.width / dimensions.height / ratio
  expect(Math.min(relative, 1 / relative)).toBeGreaterThanOrEqual(0.8)
})
it('never forwards a technically rejected generated image for pixel review or adoption', async () => {
  const rejected = { assetId: 'rejected-image', status: 'rejected', quality: { accepted: false, issues: ['图片文件为空'] } }
  const generate = vi.fn(async () => rejected), adopt = vi.fn()
  const runtime = callbacks(undefined, { generate: generate as never, adopt })
  const requested = { ...demand, brief: { ...demand.brief, allowedSources: ['generated' as const] } }
  const project = { ...input, stateObjects: [{ objectId: 'o', chapterId: 'spatial', workItemId: 's', title: '公园', summary: '公园', facts: [] }] }
  await expect(runtime.generate!(requested, {} as never, AbortSignal.timeout(1000), project, 'unused')).rejects.toThrow('VISUAL_IMAGE_QUALITY_REJECTED')
  expect(adopt).not.toHaveBeenCalled()
})
it.each([0.5333333333, 1.7777777778, 2.2222221667])('keeps pending and successful task identities regardless of the requested ratio %f', async ratio => {
  const project = { ...input, stateObjects: [{ objectId: 'o', chapterId: 'spatial', workItemId: 's', title: '公园', summary: '公园', facts: [] }] }
  const requested = { ...demand, brief: { ...demand.brief, allowedSources: ['generated' as const] },
    slot: { image: { targetAspectRatio: ratio } } } as unknown as ReportImageDemand
  const dimensions = reportImageDimensions(ratio)
  const previous = `report-image-${createHash('sha256').update(JSON.stringify([project.projectId, project.revision, imageBriefHash(requested.brief), 'stable-slot-v1', dimensions])).digest('hex')}`
  const asset = { assetId: 'new-qualified-image', status: 'candidate', quality: { accepted: true }, fileName: 'new.png' }
  const generate = vi.fn(async () => asset), findCandidate = vi.fn<VisualAgentService['findCandidate']>(() => undefined)
  const runtime = callbacks(undefined, { generate: generate as never, findCandidate })
  await runtime.generate!(requested, {} as never, AbortSignal.timeout(1000), project, 'unused')
  const taskId = findCandidate.mock.calls[0]![1]
  expect(taskId).toBe(previous)
  // Restarting uses the identical new identity; failed native history is never overwritten.
  await runtime.generate!(requested, {} as never, AbortSignal.timeout(1000), project, 'unused')
  expect(findCandidate.mock.calls[1]![1]).toBe(taskId)
})
it.each(['图片宽度低于 1024px', '图像语义不符'])('revises only an actual legacy dimension rejection: %s', async issue => {
  const project = { ...input, stateObjects: [{ objectId: 'o', chapterId: 'spatial', workItemId: 's', title: '公园', summary: '公园', facts: [] }] }
  const requested = { ...demand, brief: { ...demand.brief, allowedSources: ['generated' as const] } }
  const previous = `report-image-${createHash('sha256').update(JSON.stringify([project.projectId, project.revision, imageBriefHash(requested.brief)])).digest('hex')}`
  const old = { taskId: previous, status: 'rejected', quality: { accepted: false, issues: [issue] } }
  const visual = new VisualAgentService({ governance: { readProject: () => ({ visualAssets: [old] }) } } as never)
  const findCandidate = vi.fn<VisualAgentService['findCandidate']>(() => undefined), generate = vi.fn(async () => ({ status: 'candidate', quality: { accepted: true }, fileName: 'new.png' }))
  const runtime = callbacks(undefined, { findCandidate, generate: generate as never, hasLegacyDimensionRejection: visual.hasLegacyDimensionRejection.bind(visual) })
  await runtime.generate!(requested, {} as never, AbortSignal.timeout(1000), project, 'unused')
  const id = findCandidate.mock.calls[0]![1]
  if (issue.startsWith('图片宽度')) expect(id).not.toBe(previous)
  else expect(id).toBe(previous)
  await runtime.generate!(requested, {} as never, AbortSignal.timeout(1000), project, 'unused')
  expect(findCandidate.mock.calls[1]![1]).toBe(id)
  expect(old).toEqual({ taskId: previous, status: 'rejected', quality: { accepted: false, issues: [issue] } })
})
it.each(['candidate', 'adopted', 'rejected', 'missing'] as const)('recovers only the matching saved %s without launching or adopting a model task', async status => {
  const requested: ReportImageDemand = { findingId: 'scene', brief: { id: 'scene:main', pageId: 'scene', version: 'fixture',
    conclusion: '日间游憩', subjects: ['林下步道'], activities: ['散步'], environment: '公园', scale: 'scene',
    allowedKinds: ['render'], allowedSources: ['generated'], locale: 'domestic' } }
  const project = { ...input, stateObjects: [{ objectId: 'o', chapterId: 'spatial', workItemId: 's', title: '公园', summary: '公园', facts: [] }] }
  const taskId = `report-image-${createHash('sha256').update(JSON.stringify([project.projectId, project.revision, imageBriefHash(requested.brief)])).digest('hex')}`
  const asset = { projectId: input.projectId, taskId, assetId: 'saved-image', status, quality: { accepted: true }, kind: 'concept',
    fileName: 'saved.jpg', mimeType: 'image/jpeg', width: 1024, height: 1024, createdAt: '2026-09-20' }
  const visual = new VisualAgentService({ governance: { readProject: () => ({ visualAssets: status === 'missing' ? [] : [asset] }) } } as never)
  const generate = vi.spyOn(visual, 'generate'), adopt = vi.spyOn(visual, 'adopt')
  const runtime = callbacks(undefined, { findCandidate: visual.findCandidate.bind(visual), generate: visual.generate.bind(visual), adopt: visual.adopt.bind(visual) })
  const recovered = await runtime.recover!(requested, {} as never, AbortSignal.timeout(1000), project, 'unused')
  if (status === 'candidate' || status === 'adopted') expect(recovered?.material).toMatchObject({ sourceKey: asset.assetId, sourcePath: 'saved.jpg' })
  else expect(recovered).toBeUndefined()
  expect(await runtime.recover!(requested, {} as never, AbortSignal.timeout(1000), { ...project, revision: 2 }, 'unused')).toBeUndefined()
  expect(generate).not.toHaveBeenCalled(); expect(adopt).not.toHaveBeenCalled()
})
const input: FrozenProjectInput = { projectId: 'runtime-cache', projectName: '公共公园', revision: 1, generatedAt: '2026-09-19',
  recommendation: '林下日常休闲', decisionItems: [], gates: [], visualAssets: [], stateObjects: [] }
const candidate = { imageUrl: 'https://www.gooood.cn/runtime-original.png', sourcePageUrl: 'https://www.gooood.cn/runtime-article',
  publisher: '项目发布平台', author: '项目摄影作者', usageRights: '经署名使用', sourceLocation: '中国浙江', description: '林下步行空间', evidenceExcerpt: '建成后的林下步道向公众开放。' }
const pageHtml = `<img src="${candidate.imageUrl}"><article>${candidate.evidenceExcerpt}项目地点：中国浙江。</article>`
const bytes = PNG.sync.write(new PNG({ width: 1200, height: 800 }))
const imageResponse = () => new Response(Uint8Array.from(bytes).buffer, { headers: { 'content-type': 'image/png' } })
const demand: ReportImageDemand = { findingId: 'page-walk', brief: { id: 'walk:main', pageId: 'walk', version: 'fixture', conclusion: '林下休闲', subjects: ['步道'],
  activities: ['步行'], environment: '中国城市公园', scale: 'scene', allowedKinds: ['photo'], allowedSources: ['web'], locale: 'domestic' } }
const caseDemand = { ...demand, sourceMaterialKey: 'case-source:forest-park:experience',
  caseSource: { caseId: 'forest-park', name: '青林公共公园', location: '中国浙江杭州', mediaPurpose: 'representative-point' as const } }
const caseCandidate = { ...candidate, description: '青林公共公园的林下步道', sourceLocation: '中国浙江杭州',
  evidenceExcerpt: '青林公共公园建成后的林下步道向公众开放。', sourceLocationEvidence: '项目地点：中国浙江杭州。' }
const casePage = (source = caseCandidate) => `<article><img src="${source.imageUrl}">${source.evidenceExcerpt}${source.sourceLocationEvidence}</article>`
const queryResult = (candidates: readonly unknown[]): Awaited<ReturnType<WebQueryAgent['query']>> => ({
  executionId: 'case-image-search', childId: 'web-child', summary: JSON.stringify(candidates), retrievals: [], verifiedEvidence: false, guidance: 'fixture',
})
type Callbacks = Omit<ConstructorParameters<typeof ReportImagePipeline>[0], 'candidates'> & {
  candidates: (input: FrozenProjectInput, root: string, signal: AbortSignal) => Promise<readonly PresentationAdoptedAssetInput[]>
}
function callbacks(query: WebQueryAgent['query'] = vi.fn(async () => { throw new Error('UNEXPECTED_MODEL_CALL') }),
  visual: Partial<Pick<VisualAgentService, 'generate' | 'adopt' | 'findCandidate' | 'hasLegacyDimensionRejection'>> = {}) {
  const pipeline = createNativeReportImagePipeline({ classes: {} as never, inspection: {} as never, web: { query } as never,
    sceneSpecs: { resolve: vi.fn(async () => { throw new Error('UNEXPECTED_SCENE_PLANNING') }) }, visual: { findCandidate: () => undefined, ...visual } as never, resolveAsset: name => name })
  // Exercise the registered native callbacks without invoking orchestration,
  // which would otherwise require unrelated authorization and review fixtures.
  return (pipeline as unknown as { dependencies: Callbacks }).dependencies
}
async function seed(root: string) {
  const material = await acquireWebImage(candidate, { root, signal: new AbortController().signal,
    fetch: async source => String(source).endsWith('.png') ? imageResponse() : new Response(pageHtml) })
  const directory = join(root, '.pre-design', 'web-images'), entries = await readdir(directory)
  return { material, receipt: join(directory, entries.find(name => name.endsWith('.json'))!), archive: join(directory, entries.find(name => name.endsWith('.source.html'))!) }
}
async function searchCache(root: string, value: unknown, requested: ReportImageDemand = demand) {
  const directory = join(root, '.pre-design', 'image-searches')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, `${imageBriefHash(requested.brief)}.json`), JSON.stringify(value))
  return directory
}

it.each(['source archive', 'original bytes', 'source claim', 'obsolete provenance', 'redirected local path'] as const)('excludes cached web imagery after tampering with %s', async change => {
  const root = await mkdtemp(join(tmpdir(), 'native-image-cache-'))
  try {
    const saved = await seed(root)
    if (change === 'source archive') await writeFile(saved.archive, '<p>Changed publisher page, no evidence.</p>')
    else if (change === 'original bytes') await writeFile(saved.material.sourcePath, Buffer.from('not the archived original'))
    else {
      const receipt = JSON.parse(await readFile(saved.receipt, 'utf8')), method = JSON.parse(receipt.origin.method)
      if (change === 'source claim') method.sourceClaims.sourceLocation = { value: '中国浙江', status: 'supported', evidenceExcerpt: '不存在的地点依据：中国浙江。' }
      else if (change === 'obsolete provenance') method.schemaVersion = 'pre-design.web-image.v1'
      else receipt.sourcePath = join(root, 'unrelated-local-image.png')
      receipt.origin.method = JSON.stringify(method)
      await writeFile(saved.receipt, JSON.stringify(receipt))
    }
    const results = await callbacks().candidates(input, root, new AbortController().signal)
    expect(results.filter(asset => asset.sourceKey.startsWith('web-image:'))).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('rebuilds a valid cached candidate without trusting cached approval, bindings or location', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-image-cache-'))
  try {
    const saved = await seed(root), receipt = JSON.parse(await readFile(saved.receipt, 'utf8'))
    receipt.imageQuality = { sourceLocation: '缓存自称已确认的地点', inspection: { decision: 'approved', actualImageInput: true } }
    receipt.pageBindings = [{ findingId: 'unrelated-page' }]
    await writeFile(saved.receipt, JSON.stringify(receipt))
    const results = await callbacks().candidates(input, root, new AbortController().signal)
    const material = results.find(asset => asset.sourceKey === saved.material.sourceKey)!
    expect(material).toBeDefined()
    expect(material.imageQuality?.inspection).toBeUndefined()
    expect(material.imageQuality?.sourceLocation).toBeUndefined()
    expect(material.pageBindings).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('propagates candidate cancellation even when valid cached originals exist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-image-cache-')), controller = new AbortController(), reason = new Error('USER_CANCELLED')
  try {
    await seed(root); controller.abort(reason)
    await expect(callbacks().candidates(input, root, controller.signal)).rejects.toBe(reason)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('propagates cancellation from source downloads instead of reporting an empty successful search', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-image-search-')), controller = new AbortController(), reason = new Error('USER_CANCELLED')
  try {
    await searchCache(root, { status: 'completed', candidates: [candidate] })
    vi.stubGlobal('fetch', async () => { controller.abort(reason); throw reason })
    await expect(callbacks().search!(demand, {} as never, controller.signal, input, root)).rejects.toBe(reason)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('records a normal download gap and continues another candidate without retrying the failed source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-image-search-'))
  try {
    const bad = { ...candidate, sourcePageUrl: 'https://www.gooood.cn/failed-article' }
    const directory = await searchCache(root, { status: 'completed', candidates: [bad, candidate] }), calls: string[] = []
    vi.stubGlobal('fetch', async (source: URL | RequestInfo) => { const address = String(source); calls.push(address)
      return address === bad.sourcePageUrl ? new Response('unavailable', { status: 503 }) : address.endsWith('.png') ? imageResponse() : new Response(pageHtml) })
    const results = await callbacks().search!(demand, {} as never, new AbortController().signal, input, root)
    expect(results).toHaveLength(1)
    expect(results[0]!.sourceKey).toMatch(/^web-image:/u)
    expect(calls.filter(source => source === bad.sourcePageUrl)).toHaveLength(1)
    const record = JSON.parse(await readFile(join(directory, `${imageBriefHash(demand.brief)}.downloads.json`), 'utf8'))
    expect(record.map((entry: { status: string }) => entry.status)).toEqual(['rejected', 'acquired'])
  } finally { await rm(root, { recursive: true, force: true }) }
})
it.each(['PREPLANNING_MODEL_TURN_LIMIT: 已停止新派发', 'PREPLANNING_MODEL_BUDGET_INVALID: 预算无效', 'MODEL_UNAVAILABLE: 模型未配置'])(
  'permits a later invocation after a clearly undispatched query fails with %s', async message => {
  const root = await mkdtemp(join(tmpdir(), 'native-image-search-'))
  try {
    const query = vi.fn<WebQueryAgent['query']>().mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce({
      executionId: 'search-after-configuration-change', childId: 'web-child', summary: '[]', retrievals: [], verifiedEvidence: false, guidance: 'fixture',
    })
    const runtime = callbacks(query)
    await expect(runtime.search!(demand, {} as never, new AbortController().signal, input, root)).rejects.toThrow(message)
    expect(query).toHaveBeenCalledTimes(1)
    const path = join(root, '.pre-design', 'image-searches', `${imageBriefHash(demand.brief)}.json`)
    expect(JSON.parse(await readFile(path, 'utf8')).status).toBe('not-started')
    await expect(runtime.search!(demand, {} as never, new AbortController().signal, input, root)).resolves.toEqual([])
    expect(query).toHaveBeenCalledTimes(2)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ status: 'completed', executionId: 'search-after-configuration-change' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
it.each(['WEB_QUERY_FAILED: 子会话失败 MODEL_UNAVAILABLE: 上游不可用', 'network connection was lost'])(
  'blocks redispatch after an executed or uncertain query fails with %s', async message => {
  const root = await mkdtemp(join(tmpdir(), 'native-image-search-')), query = vi.fn(async () => { throw new Error(message) })
  try {
    const runtime = callbacks(query)
    await expect(runtime.search!(demand, {} as never, new AbortController().signal, input, root)).rejects.toThrow(message)
    const path = join(root, '.pre-design', 'image-searches', `${imageBriefHash(demand.brief)}.json`)
    expect(JSON.parse(await readFile(path, 'utf8')).status).toBe('failed-or-unknown')
    await expect(runtime.search!(demand, {} as never, new AbortController().signal, input, root)).rejects.toThrow('WEB_IMAGE_SEARCH_REQUIRES_ATTENTION')
    expect(query).toHaveBeenCalledTimes(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('keeps a proved terminal web-tool failure as a source gap and never repeats its model task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-image-exhausted-search-'))
  const failure = new WebRetrievalExhaustedError('failed-web-run', 'failed-web-child', 'PREPLANNING_REPEATED_TOOL_FAILURE: 工具 web_fetch 连续 3 次返回相同错误')
  const query = vi.fn<WebQueryAgent['query']>(async () => { throw failure })
  try {
    const runtime = callbacks(query)
    await expect(runtime.search!(demand, {} as never, new AbortController().signal, input, root)).resolves.toEqual([])
    const saved = JSON.parse(await readFile(join(root, '.pre-design', 'image-searches', `${imageBriefHash(demand.brief)}.json`), 'utf8'))
    expect(saved).toMatchObject({ status: 'completed', candidates: [], executionId: 'failed-web-run', childId: 'failed-web-child', retrievalFailure: failure.reason })
    await expect(runtime.search!(demand, {} as never, new AbortController().signal, input, root)).resolves.toEqual([])
    expect(query).toHaveBeenCalledTimes(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it.each(['unverified error', 'parent cancellation'])('keeps %s closed instead of accepting an exhausted search', async variation => {
  const root = await mkdtemp(join(tmpdir(), 'native-image-uncertain-search-')), controller = new AbortController()
  const proved = new WebRetrievalExhaustedError('failed-run', 'failed-child', 'PREPLANNING_REPEATED_TOOL_FAILURE: 工具 web_fetch 连续 3 次返回相同错误')
  const failure = variation === 'unverified error' ? new Error(proved.message) : proved
  const query = vi.fn<WebQueryAgent['query']>(async () => { if (variation === 'parent cancellation') controller.abort(); throw failure })
  try {
    const runtime = callbacks(query)
    await expect(runtime.search!(demand, {} as never, controller.signal, input, root)).rejects.toBe(failure)
    const saved = JSON.parse(await readFile(join(root, '.pre-design', 'image-searches', `${imageBriefHash(demand.brief)}.json`), 'utf8'))
    expect(saved.status).toBe('failed-or-unknown')
    await expect(runtime.search!(demand, {} as never, new AbortController().signal, input, root)).rejects.toThrow('WEB_IMAGE_SEARCH_REQUIRES_ATTENTION')
    expect(query).toHaveBeenCalledTimes(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('keeps an ordinary project source gap without querying for an unrelated substitute', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-image-search-')), query = vi.fn<WebQueryAgent['query']>(async () => queryResult([candidate]))
  try {
    vi.stubGlobal('fetch', async (source: URL | RequestInfo) => String(source).endsWith('.png') ? imageResponse() : new Response(pageHtml))
    const results = await callbacks(query).search!({ ...demand, sourceMaterialKey: 'project-source:site-survey' }, {} as never, new AbortController().signal, input, root)
    expect(results).toEqual([])
    expect(query).not.toHaveBeenCalled()
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('queries the exact case and aliases only an original with visible case and location evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-image-search-')), query = vi.fn<WebQueryAgent['query']>(async () => queryResult([caseCandidate]))
  try {
    vi.stubGlobal('fetch', async (source: URL | RequestInfo) => String(source).endsWith('.png') ? imageResponse() : new Response(casePage()))
    const results = await callbacks(query).search!(caseDemand, {} as never, new AbortController().signal, input, root)
    expect(results).toHaveLength(1)
    expect(results[0]!.aliases).toEqual(['case-source:forest-park:experience'])
    expect(results[0]!.imageQuality?.sourceLocation).toBe('中国浙江杭州')
    const prompt = query.mock.calls[0]![2]
    for (const value of ['forest-park', '青林公共公园', '中国浙江杭州', 'representative-point']) expect(prompt).toContain(value)
    expect(JSON.parse(results[0]!.origin.method).sourceClaims.sourceLocation.status).toBe('supported')
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('collects full-size article originals before asking a model to rediscover known publication URLs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-published-originals-'))
  const locationEvidence = '项目地点：中国浙江杭州。'
  const requested = { ...caseDemand, caseSource: { ...caseDemand.caseSource, mediaPurpose: 'circulation', publicationSources: [{
    sourcePageUrl: caseCandidate.sourcePageUrl, evidenceExcerpt: locationEvidence, registeredImageUrl: caseCandidate.imageUrl,
  }] } }
  const fullPlan = 'https://www.gooood.cn/uploads/park-plan.png'
  const html = `<article>${locationEvidence}<img src="${caseCandidate.imageUrl}">
    <img src="/uploads/park-plan-640x360.png" alt="公园总平面与流线">
    <aside><img src="/unrelated.png"></aside></article><script type="application/json">${JSON.stringify([fullPlan])}</script>`
  try {
    vi.stubGlobal('fetch', async (source: URL | RequestInfo) => String(source).endsWith('.png') ? imageResponse() : new Response(html))
    const results = await callbacks().search!(requested, {} as never, new AbortController().signal, input, root)
    expect(results.length).toBeGreaterThan(0)
    expect(JSON.parse(results[0]!.origin.method)).toMatchObject({ imageUrl: fullPlan, sourceLocation: '中国浙江杭州' })
    expect(results[0]!.aliases).toEqual([requested.sourceMaterialKey])
    expect(results[0]!.imageQuality?.inspection).toBeUndefined()
    expect(results.every(asset => !JSON.parse(asset.origin.method).imageUrl.includes('unrelated'))).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('does not turn a directly acquired original cancellation into a new paid search', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-original-cancel-')), reason = new DOMException('download cancelled', 'AbortError')
  const requested = { ...caseDemand, caseSource: { ...caseDemand.caseSource, publicationSources: [{
    sourcePageUrl: caseCandidate.sourcePageUrl, evidenceExcerpt: caseCandidate.sourceLocationEvidence, registeredImageUrl: caseCandidate.imageUrl,
  }] } }
  try {
    vi.stubGlobal('fetch', async (source: URL | RequestInfo) => { if (String(source).endsWith('.png')) throw reason; return new Response(casePage()) })
    await expect(callbacks().search!(requested, {} as never, new AbortController().signal, input, root)).rejects.toBe(reason)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('uses selected publication evidence for case retrieval and invalidates a search when that evidence changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-case-publication-'))
  const locationEvidence = '项目地点：浙江省杭州市青林村。'
  const published = { ...caseCandidate, sourceLocation: '浙江省杭州市', sourceLocationEvidence: locationEvidence,
    evidenceExcerpt: '公共公园位于青林，建成后的林下步道向公众开放。' }
  const requested = { ...caseDemand, caseSource: { ...caseDemand.caseSource, location: '浙江·杭州·青林',
    publicationSources: [{ sourcePageUrl: published.sourcePageUrl, evidenceExcerpt: locationEvidence, registeredImageUrl: published.imageUrl }] } }
  const query = vi.fn<WebQueryAgent['query']>(async () => queryResult([published]))
  try {
    vi.stubGlobal('fetch', async (source: URL | RequestInfo) => String(source).endsWith('.png') ? imageResponse() : new Response(casePage(published)))
    const runtime = callbacks(query)
    const results = await runtime.search!(requested, {} as never, new AbortController().signal, input, root)
    expect(results[0]?.aliases).toEqual([requested.sourceMaterialKey])
    expect(results[0]?.imageQuality?.sourceLocation).toBe('浙江省杭州市青林村')
    expect(query).not.toHaveBeenCalled()
    expect(await runtime.search!(requested, {} as never, new AbortController().signal, input, root)).toHaveLength(1)
    expect(query).not.toHaveBeenCalled()
    expect(await runtime.search!({ ...requested, caseSource: { ...requested.caseSource,
      publicationSources: [{ ...requested.caseSource.publicationSources[0]!, evidenceExcerpt: '项目地点：另一处未获核验的公园。' }] } },
      {} as never, new AbortController().signal, input, root)).toEqual([])
    expect(query).toHaveBeenCalledOnce()
  } finally { await rm(root, { recursive: true, force: true }) }
})
it.each(['different case', 'alternate case name', 'wrong location', 'unsupported location', 'country only', 'name only in script', 'name only in metadata'] as const)(
  'leaves a case image gap when the source has %s', async failure => {
  const root = await mkdtemp(join(tmpdir(), 'native-image-search-'))
  try {
    let suggested = { ...caseCandidate }, html: string
    if (failure === 'different case') suggested.evidenceExcerpt = '其他公共公园建成后的林下步道向公众开放。'
    if (failure === 'alternate case name') suggested.evidenceExcerpt = '青林公园又名绿林公园，建成后的林下步道向公众开放。'
    if (failure === 'wrong location') { suggested.sourceLocation = '中国江苏南京'; suggested.sourceLocationEvidence = '项目地点：中国江苏南京。' }
    if (failure === 'country only') { suggested.sourceLocation = '中国'; suggested.sourceLocationEvidence = '项目所在地是中国境内。' }
    if (failure === 'name only in script' || failure === 'name only in metadata') suggested.evidenceExcerpt = '项目建成后的林下步道向公众开放。'
    html = casePage(suggested)
    if (failure === 'unsupported location') html = html.replace(suggested.sourceLocationEvidence, '项目地点未予公布。')
    if (failure === 'name only in script') html += `<script>const name = "青林公共公园"</script>`
    if (failure === 'name only in metadata') html += '<meta name="project" content="青林公共公园">'
    const directory = await searchCache(root, { status: 'completed', candidates: [suggested] }, caseDemand)
    vi.stubGlobal('fetch', async (source: URL | RequestInfo) => String(source).endsWith('.png') ? imageResponse() : new Response(html))
    const results = await callbacks().search!(caseDemand, {} as never, new AbortController().signal, input, root)
    expect(results).toEqual([])
    const downloads = JSON.parse(await readFile(join(directory, `${imageBriefHash(caseDemand.brief)}.downloads.json`), 'utf8'))
    expect(downloads[0]).toMatchObject({ status: 'rejected', reason: expect.stringContaining('WEB_IMAGE_CASE_UNVERIFIED') })
  } finally { await rm(root, { recursive: true, force: true }) }
})
it.each(['case identity', 'location evidence'] as const)('does not use document head/title metadata as visible %s', async hidden => {
  const root = await mkdtemp(join(tmpdir(), 'native-image-search-'))
  try {
    const hiddenText = hidden === 'case identity' ? caseCandidate.evidenceExcerpt : caseCandidate.sourceLocationEvidence
    const visibleText = hidden === 'case identity' ? caseCandidate.sourceLocationEvidence : caseCandidate.evidenceExcerpt
    const html = `<html><head><title>${hiddenText}</title></head><body><img src="${caseCandidate.imageUrl}"><article>${visibleText}</article></body></html>`
    await searchCache(root, { status: 'completed', candidates: [caseCandidate] }, caseDemand)
    vi.stubGlobal('fetch', async (source: URL | RequestInfo) => String(source).endsWith('.png') ? imageResponse() : new Response(html))
    expect(await callbacks().search!(caseDemand, {} as never, new AbortController().signal, input, root)).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})
it.each([
  { label: 'case identity even with a generated source allowed', requested: { ...caseDemand, brief: { ...demand.brief, allowedSources: ['generated'] as const } } },
  { label: 'project source identity', requested: { ...demand, sourceMaterialKey: 'project-source:survey' } },
  { label: 'source policy excluding generation', requested: demand },
])('does not generate a replacement for $label', async ({ requested }) => {
  const generate = vi.fn<VisualAgentService['generate']>(async () => { throw new Error('UNEXPECTED_GENERATION') })
  const project = { ...input, stateObjects: [{ objectId: 's', chapterId: '01', workItemId: '01-01', title: '案例资料', summary: '案例空间', facts: [] }] }
  await expect(callbacks(undefined, { generate }).generate!(requested, {} as never, new AbortController().signal, project, 'unused'))
    .rejects.toThrow('REPORT_IMAGE_SOURCE_REQUIRED')
  expect(generate).not.toHaveBeenCalled()
})
it('passes the same grounded scene and supporting manuscript to web acquisition and generation', async () => {
  const root = await mkdtemp(join(tmpdir(),'image-scene-context-'))
  const query = vi.fn<WebQueryAgent['query']>(async () => queryResult([]))
  const generate = vi.fn<VisualAgentService['generate']>(async () => { throw new Error('GENERATION_BOUNDARY_REACHED') })
  const requested: ReportImageDemand = { ...demand, brief: { ...demand.brief, allowedSources: ['web','generated'] },
    sceneContext: { usageId: demand.brief.id, pageTitle: '建设投入', intent: '先建设公共服务空间',
      sources: [{ path: 'body[0]', text: '林下步道连接遮雨廊亭，分段开放。' }] } }
  const project = { ...input, stateObjects: [{ objectId: 's', chapterId: '01', workItemId: '01-01', title: '空间', summary: '空间依据', facts: [] }] }
  try {
    const runtime = callbacks(query, { generate })
    await runtime.search!(requested, {} as never, new AbortController().signal, project, root)
    await expect(runtime.generate!(requested, {} as never, new AbortController().signal, project, root)).rejects.toThrow('GENERATION_BOUNDARY_REACHED')
    for (const prompt of [query.mock.calls[0]![2], generate.mock.calls[0]![1].prompt]) {
      expect(prompt).toContain('林下步道连接遮雨廊亭，分段开放。')
      expect(prompt).toContain(JSON.stringify(requested.brief))
    }
  } finally { await rm(root,{recursive:true,force:true}) }
})

it('asks only for publication pages and caches programmatically extracted originals for reuse', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-publication-search-'))
  const { imageUrl: _unused, ...publication } = { ...candidate, sourceLocationEvidence: '项目地点：中国浙江杭州。' }
  const query = vi.fn<WebQueryAgent['query']>(async () => queryResult([publication]))
  const html = `<article>${publication.evidenceExcerpt}${publication.sourceLocationEvidence}<img src="${candidate.imageUrl}"></article>`
  try {
    vi.stubGlobal('fetch', async (source: URL | RequestInfo) => String(source).endsWith('.png') ? imageResponse() : new Response(html))
    const runtime = callbacks(query)
    const result = await runtime.search!(demand, {} as never, new AbortController().signal, input, root)
    expect(result).toHaveLength(1)
    expect(query.mock.calls[0]![4]).toEqual({ maxToolCalls: 6 })
    expect(query.mock.calls[0]![2]).toContain('最多3个')
    expect(query.mock.calls[0]![2]).toContain('不超过6次')
    expect(query.mock.calls[0]![2]).toContain('无需查找imageUrl')
    const cached = JSON.parse(await readFile(join(root, '.pre-design', 'image-searches', `${imageBriefHash(demand.brief)}.json`), 'utf8'))
    expect(cached).toMatchObject({ status: 'completed', candidates: [{ imageUrl: candidate.imageUrl }] })
    expect(await runtime.search!(demand, {} as never, new AbortController().signal, input, root)).toHaveLength(1)
    expect(query).toHaveBeenCalledTimes(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('caches a normally completed search with all publications rejected and never redispatches it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-publication-failure-'))
  const { imageUrl: _unused, ...publication } = { ...candidate, sourceLocationEvidence: '项目地点：中国浙江杭州。' }
  const query = vi.fn<WebQueryAgent['query']>(async () => queryResult([publication]))
  try {
    vi.stubGlobal('fetch', async () => new Response('<article>不支持描述与地点<img src="/other.png"></article>'))
    const runtime = callbacks(query)
    await expect(runtime.search!(demand, {} as never, new AbortController().signal, input, root)).resolves.toEqual([])
    const saved = JSON.parse(await readFile(join(root, '.pre-design', 'image-searches', `${imageBriefHash(demand.brief)}.json`), 'utf8'))
    expect(saved).toMatchObject({ status: 'completed', candidates: [], publications: [{ sourcePageUrl: publication.sourcePageUrl,
      status: 'rejected', reason: expect.stringContaining('WEB_IMAGE_SOURCE_UNVERIFIED') }] })
    await expect(runtime.search!(demand, {} as never, new AbortController().signal, input, root)).resolves.toEqual([])
    expect(query).toHaveBeenCalledTimes(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('propagates cancellation during publication extraction and preserves its uncertain search receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-publication-cancel-')), controller = new AbortController(), reason = new Error('USER_CANCELLED')
  const { imageUrl: _unused, ...publication } = { ...candidate, sourceLocationEvidence: '项目地点：中国浙江杭州。' }
  const query = vi.fn<WebQueryAgent['query']>(async () => queryResult([publication, { ...publication, sourcePageUrl: 'https://www.gooood.cn/next-page' }]))
  const fetcher = vi.fn(async () => { controller.abort(reason); throw reason })
  try {
    vi.stubGlobal('fetch', fetcher)
    const runtime = callbacks(query)
    await expect(runtime.search!(demand, {} as never, controller.signal, input, root)).rejects.toBe(reason)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const saved = JSON.parse(await readFile(join(root, '.pre-design', 'image-searches', `${imageBriefHash(demand.brief)}.json`), 'utf8'))
    expect(saved.status).toBe('failed-or-unknown')
    await expect(runtime.search!(demand, {} as never, new AbortController().signal, input, root)).rejects.toThrow('WEB_IMAGE_SEARCH_REQUIRES_ATTENTION')
    expect(query).toHaveBeenCalledTimes(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})



it.each(['HTTP failure', 'invalid evidence'])('retains a valid publication when another has %s', async failure => {
  const root = await mkdtemp(join(tmpdir(), 'native-publication-partial-'))
  const { imageUrl: _unused, ...publication } = { ...candidate, sourceLocationEvidence: '项目地点：中国浙江杭州。' }
  const bad = { ...publication, sourcePageUrl: 'https://www.gooood.cn/bad-article' }
  const query = vi.fn<WebQueryAgent['query']>(async () => queryResult([bad, publication]))
  const html = `<article>${publication.evidenceExcerpt}${publication.sourceLocationEvidence}<img src="${candidate.imageUrl}"></article>`
  try {
    vi.stubGlobal('fetch', async (source: URL | RequestInfo) => String(source) === bad.sourcePageUrl
      ? failure === 'HTTP failure' ? new Response('unavailable', { status: 503 }) : new Response('<article>不匹配的正文</article>')
      : String(source).endsWith('.png') ? imageResponse() : new Response(html))
    const runtime = callbacks(query)
    expect(await runtime.search!(demand, {} as never, new AbortController().signal, input, root)).toHaveLength(1)
    const saved = JSON.parse(await readFile(join(root, '.pre-design', 'image-searches', `${imageBriefHash(demand.brief)}.json`), 'utf8'))
    expect(saved.status).toBe('completed')
    expect(saved.publications).toEqual([
      { sourcePageUrl: bad.sourcePageUrl, status: 'rejected', reason: expect.stringContaining(failure === 'HTTP failure' ? 'HTTP 503' : 'WEB_IMAGE_SOURCE_UNVERIFIED') },
      { sourcePageUrl: publication.sourcePageUrl, status: 'discovered', imageUrls: [candidate.imageUrl] },
    ])
    expect(await runtime.search!(demand, {} as never, new AbortController().signal, input, root)).toHaveLength(1)
    expect(query).toHaveBeenCalledTimes(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('omits unusable optional proof without granting the claim or losing a completed search', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-publication-optional-proof-'))
  const { imageUrl: _unused, ...publication } = { ...candidate, sourceLocationEvidence: '项目地点：中国浙江杭州。',
    usageRightsEvidence: '未说明', publisherEvidence: '', authorEvidence: null }
  const query = vi.fn<WebQueryAgent['query']>(async () => queryResult([publication]))
  const html = `<article>${publication.evidenceExcerpt}${publication.sourceLocationEvidence}<img src="${candidate.imageUrl}"></article>`
  try {
    vi.stubGlobal('fetch', async (source: URL | RequestInfo) => String(source).endsWith('.png') ? imageResponse() : new Response(html))
    const runtime = callbacks(query)
    const assets = await runtime.search!(demand, {} as never, new AbortController().signal, input, root)
    expect(assets).toHaveLength(1)
    expect(JSON.parse(assets[0]!.origin.method).sourceClaims.usageRights.status).toBe('unverified')
    const cached = JSON.parse(await readFile(join(root, '.pre-design', 'image-searches', `${imageBriefHash(demand.brief)}.json`), 'utf8'))
    expect(cached.status).toBe('completed')
    expect(cached.candidates[0]).not.toHaveProperty('usageRightsEvidence')
    expect(cached.omittedEvidence).toEqual([{ index: 0, fields: ['authorEvidence', 'usageRightsEvidence', 'publisherEvidence'] }])
    expect(await runtime.search!(demand, {} as never, new AbortController().signal, input, root)).toHaveLength(1)
    expect(query).toHaveBeenCalledTimes(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it.each([true, false])('rejects malformed required evidence per candidate while caching a completed result (valid sibling %s)', async withValid => {
  const root = await mkdtemp(join(tmpdir(), 'native-publication-required-proof-'))
  const { imageUrl: _unused, ...publication } = { ...candidate, sourceLocationEvidence: '项目地点：中国浙江杭州。' }
  const invalid = { ...publication, sourceLocationEvidence: '短' }
  const query = vi.fn<WebQueryAgent['query']>(async () => queryResult([invalid, ...(withValid ? [publication] : [])]))
  const html = `<article>${publication.evidenceExcerpt}${publication.sourceLocationEvidence}<img src="${candidate.imageUrl}"></article>`
  try {
    vi.stubGlobal('fetch', async (source: URL | RequestInfo) => String(source).endsWith('.png') ? imageResponse() : new Response(html))
    const runtime = callbacks(query)
    expect(await runtime.search!(demand, {} as never, new AbortController().signal, input, root)).toHaveLength(withValid ? 1 : 0)
    const cached = JSON.parse(await readFile(join(root, '.pre-design', 'image-searches', `${imageBriefHash(demand.brief)}.json`), 'utf8'))
    expect(cached.status).toBe('completed')
    expect(cached.rejectedCandidates).toEqual([{ index: 0, reason: expect.any(String) }])
    expect(await runtime.search!(demand, {} as never, new AbortController().signal, input, root)).toHaveLength(withValid ? 1 : 0)
    expect(query).toHaveBeenCalledTimes(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
