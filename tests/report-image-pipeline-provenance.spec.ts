import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ReportImagePipeline, reportImageDemands, type ReportImageDemand } from '../src/presentation/report-image-pipeline.ts'
import type { PresentationAdoptedAssetInput } from '../src/presentation/standard-project-types.ts'
import { selectCaseStudies } from '../src/report/case-studies/service.ts'
import { createConditionalReportBundle, planConditionalPages } from '../src/report/conditional-report.ts'
import { manuscriptSourceFingerprint } from '../src/report/manuscript/source.ts'
import { auditRegularVisuals } from '../src/report/regular/visual-audit.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'
import { imageSourceContextHash, type InspectImageInput } from '../src/visual/image-inspection.ts'
import { imageBriefHash, REPORT_IMAGE_POLICY_VERSION, type ImageInspection } from '../src/visual/image-policy.ts'
import { acquireWebImage } from '../src/visual/web-image-source.ts'
import { png, resize, scene } from './support/image-identity/fixtures.ts'

const roots: string[] = []
const route = { provider: 'fixture', model: 'fixture-vision' }
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const imageBytes = png(resize(scene(7), 1600, 900))
const fullImage = `${REPORT_IMAGE_POLICY_VERSION}:full-original`

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}image-pipeline-provenance-`)) throw new Error('UNSAFE_TEST_CLEANUP')
    await rm(root, { recursive: true, force: true })
  }
})

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'image-pipeline-provenance-'))
  roots.push(root)
  return root
}

function project(withCases = false): FrozenProjectInput {
  const source = '现状茶园、水库和存量建筑构成场地资源。建议以茶饮品茶、茶园慢行步道、观景平台形成日间休闲，并在既有建筑配置游客中心和集散接待。'
  const base: FrozenProjectInput = { projectId: 'provenance-pipeline', projectName: '山水茶旅项目', revision: 1, generatedAt: '2026-09-19T00:00:00Z',
    recommendation: '林下座椅休憩', decisionItems: [], gates: [], visualAssets: [], stateObjects: [{ objectId: 'PG04', chapterId: '06', workItemId: '06-01',
      title: '资源与产品', summary: source, facts: [], reportSections: [{ key: 'products', title: '资源与产品', entries: [{ key: 'basis',
        fieldPath: 'data.products[0]', text: source, basis: '项目资料与策划建议', evidenceRefs: [{ evidenceId: 'site-source' }] }] }] }] }
  return { ...base, ...(withCases ? { caseStudies: selectCaseStudies(base) } : {}), manuscript: {
    schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: 'fixture', sourceFingerprint: manuscriptSourceFingerprint(base), sourceRevision: 1,
    projectId: base.projectId, generatedAt: base.generatedAt, title: '山水茶旅汇报', chapters: [{ id: 'spatial', title: '空间组织', thesis: base.recommendation,
      pages: [{ id: 'scene-0', kind: 'argument', title: '林下座椅休憩', claim: '林下座椅休憩构成日间游览体验', body: ['保留完整的休憩空间。'],
        sourceRefs: [], notes: [], editorialSummary: true, visual: { kind: 'concept', subject: '林下座椅休憩', purpose: '林下座椅休憩', caption: '林下座椅休憩' } }] }] } }
}

// Download/source validation and archived receipts are real. Only the external
// HTTP boundary is replaced, and every test uses this same original raster.
async function webOriginal(root: string, options: { name?: string; location?: string; edition?: string } = {}) {
  const name = options.name ?? '林下座椅休憩', location = options.location ?? '中国浙江', edition = options.edition ?? '第一版'
  const candidate = { imageUrl: 'https://www.gooood.cn/provenance-original.png', sourcePageUrl: 'https://www.gooood.cn/provenance-project',
    publisher: '项目发布平台', author: '项目摄影作者', usageRights: '经署名使用', sourceLocation: location, description: name,
    evidenceExcerpt: `${name}已经建成并向公众开放，资料为${edition}。`, sourceLocationEvidence: `项目地点：${location}。`,
    publisherEvidence: '发布者：项目发布平台。', authorEvidence: '摄影者：项目摄影作者。', usageRightsEvidence: '图片使用：经署名使用。' }
  const page = `<img src="${candidate.imageUrl}"><article>${candidate.evidenceExcerpt}${candidate.sourceLocationEvidence}${candidate.publisherEvidence}${candidate.authorEvidence}${candidate.usageRightsEvidence}</article>`
  return acquireWebImage(candidate, { root, signal: new AbortController().signal,
    fetch: async address => String(address) === candidate.imageUrl
      ? new Response(Uint8Array.from(imageBytes).buffer, { headers: { 'content-type': 'image/png' } }) : new Response(page) })
}

function reviews(request: InspectImageInput, approved: boolean): ImageInspection[] {
  return request.slots.map(({ brief, placementHash }) => ({ schemaVersion: 'pre-design.image-inspection.v1', imageSha256: digest(request.bytes),
    requirementHash: imageBriefHash(brief), usageId: brief.id, placementHash, inspectedAt: '2026-09-19T00:00:00Z', actualImageInput: true,
    actualModel: route, executionId: `fixture-${imageSourceContextHash(request).slice(0, 16)}`, contentKind: 'photo', relevant: true,
    matchedSubjects: brief.subjects, mismatches: approved ? [] : ['SOURCE_LOCATION_UNVERIFIED'], domesticContext: approved ? 'supported' : 'unverified',
    textLanguages: [], textLegible: true, watermark: 'none', quality: 'pass', essentialBounds: [{ x: 0, y: 0, width: 1, height: 1 }],
    decision: approved ? 'approved' : 'rejected', sourceContextHash: imageSourceContextHash(request) }))
}

type Dependencies = ConstructorParameters<typeof ReportImagePipeline>[0]
function pipeline(dependencies: Pick<Dependencies, 'candidates' | 'search'>, inspect: (_parent: unknown, request: InspectImageInput) => Promise<ImageInspection[]>) {
  return new ReportImagePipeline({ ...dependencies, classes: {
    settings: () => ({ routes: { review: route } }), execution: () => ({ classId: 'review', status: 'completed', actual: route }),
  } as never, inspection: { inspect } as never })
}

function caseDemand(input: FrozenProjectInput, purpose: string) {
  const demand = reportImageDemands(input).find(row => row.caseSource?.caseId === 'damushan' && row.caseSource.mediaPurpose === purpose)
  if (!demand?.sourceMaterialKey || !demand.caseSource) throw new Error(`MISSING_CASE_FIXTURE: ${purpose}`)
  return demand as ReportImageDemand & { sourceMaterialKey: string; caseSource: NonNullable<ReportImageDemand['caseSource']> }
}

it('reviews verified web evidence after rejecting the same project pixels without granting a second original quota', async () => {
  const root = await workspace(), input = project(), web = await webOriginal(root)
  const local: PresentationAdoptedAssetInput = { ...web, sourceKey: 'project-original', imageQuality: undefined,
    origin: { type: 'source_material', sourceMaterialKeys: ['project-photo'], parentAssetKeys: [], sourceTool: null, method: '项目原始照片，地点尚无依据' } }
  const requests: InspectImageInput[] = []
  const inspect = vi.fn(async (_parent: unknown, request: InspectImageInput) => {
    requests.push(request)
    return reviews(request, request.sourceType === 'web')
  })
  const service = pipeline({ candidates: async () => [local, web] }, inspect)
  const materials = await service.prepare(input, root, {} as never, AbortSignal.timeout(20_000), () => {})
  expect(requests.map(request => request.sourceType)).toEqual(['project', 'web'])
  expect(requests.map(request => request.sourceLocationVerified)).toEqual([false, true])
  expect(new Set(requests.map(request => digest(request.bytes))).size).toBe(1)
  expect(new Set(requests.map(imageSourceContextHash)).size).toBe(2)

  const bundle = createConditionalReportBundle(input, materials)
  const audit = auditRegularVisuals(planConditionalPages(bundle, 'html'), bundle.report, { requireInspectedImages: true })
  expect(audit.originalImageUses).toHaveLength(1)
  expect(audit.originalImageUses[0]!.count).toBe(2)
  expect(audit.repeatedOriginals).toEqual([])
  expect(audit.samePageDuplicates).toEqual([])
  expect(audit.unreviewedImages).toEqual([])

  const directory = join(root, '.pre-design', 'image-inspections')
  const receipts = await Promise.all((await readdir(directory)).map(async name => JSON.parse(await readFile(join(directory, name), 'utf8')) as ImageInspection))
  for (const usageId of ['cover:main', 'scene-0:main']) {
    const fullReviews = receipts.filter(receipt => receipt.usageId === usageId && receipt.placementHash === fullImage)
    expect(fullReviews.map(receipt => receipt.decision).sort()).toEqual(['approved', 'rejected'])
    expect(new Set(fullReviews.map(receipt => receipt.sourceContextHash)).size).toBe(2)
  }
  expect(await service.load(input, root)).toEqual(materials)
  expect(inspect).toHaveBeenCalledTimes(2)
})

it('reviews a cached original when a later same-case search adds its verified source alias', async () => {
  const root = await workspace(), input = project(true), target = caseDemand(input, 'representative-point')
  const cached = await webOriginal(root, target.caseSource)
  const reached = new Error('VERIFIED_CASE_ALIAS_REACHED_REVIEW'), requests: InspectImageInput[] = []
  const search = vi.fn(async (demand: ReportImageDemand) => demand.brief.id === target.brief.id
    ? [{ ...cached, aliases: [target.sourceMaterialKey] }] : [])
  const service = pipeline({ candidates: async () => [cached], search }, async (_parent, request) => {
    requests.push(request)
    throw reached
  })

  await expect(service.prepare(input, root, {} as never, AbortSignal.timeout(20_000), () => {})).rejects.toThrow(reached.message)
  expect(requests).toHaveLength(1)
  expect(requests[0]!.slots.map(slot => slot.brief.id)).toEqual([target.brief.id])
  expect(requests[0]!.sourceLocationVerified).toBe(true)
  expect(requests[0]!.sourceEvidenceHash).toBe(digest(cached.origin.method))
  expect(search.mock.calls.some(([demand]) => demand.brief.id === target.brief.id)).toBe(true)
})

it('drops old aliases and approved bindings when the same source key receives changed evidence', async () => {
  const root = await workspace(), input = project(true), previousDemand = caseDemand(input, 'area-overview'), nextDemand = caseDemand(input, 'representative-point')
  const previous = await webOriginal(root, previousDemand.caseSource)
  const updated = await webOriginal(root, { ...nextDemand.caseSource, edition: '地点与项目关系重新核验版' })
  expect(updated.sourceKey).toBe(previous.sourceKey)
  expect(updated.origin.method).not.toBe(previous.origin.method)
  const requests: InspectImageInput[] = []
  const search = async (demand: ReportImageDemand) => demand.brief.id === nextDemand.brief.id ? [{ ...updated,
    aliases: [nextDemand.sourceMaterialKey], pageBindings: [{ findingId: nextDemand.findingId, role: 'primary' as const }] }] : []
  const service = pipeline({ candidates: async () => [{ ...previous, aliases: [previousDemand.sourceMaterialKey],
    pageBindings: [{ findingId: previousDemand.findingId, role: 'primary' }] }], search }, async (_parent, request) => {
    requests.push(request)
    return reviews(request, true)
  })

  await expect(service.prepare(input, root, {} as never, AbortSignal.timeout(20_000), () => {})).rejects.toThrow('REPORT_IMAGE_GAPS')
  const priorReviews = requests.filter(request => request.sourceEvidenceHash === digest(previous.origin.method))
  const currentReviews = requests.filter(request => request.sourceEvidenceHash === digest(updated.origin.method))
  expect(priorReviews.flatMap(request => request.slots.map(slot => slot.brief.id))).toEqual([previousDemand.brief.id])
  expect(currentReviews.flatMap(request => request.slots.map(slot => slot.brief.id))).toEqual([nextDemand.brief.id])
  const gaps = JSON.parse(await readFile(join(root, '.pre-design', 'report-image-gaps.json'), 'utf8')) as { gaps: { id: string }[] }
  expect(gaps.gaps.some(gap => gap.id === previousDemand.brief.id)).toBe(true)
  expect(gaps.gaps.some(gap => gap.id === nextDemand.brief.id)).toBe(false)
})
