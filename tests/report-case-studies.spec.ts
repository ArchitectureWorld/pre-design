import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrozenProjectInput } from '../src/report/types.ts'
import { manuscriptSourceFingerprint, makeSourceIndex } from '../src/report/manuscript/source.ts'
import { BUNDLED_CASE_STUDY_IMAGES } from '../src/report/case-studies/catalog-images.ts'
import { CASE_STUDIES_CATALOG_VERSION, VERIFIED_CASE_STUDIES, caseStudyEvidenceMarkdown, caseStudyPages, caseStudyPhotoKey, caseStudyPhotos,
  caseStudySources, caseStudySourceGaps, prepareCaseStudies, selectCaseStudies, validateCaseStudies, validateCatalogCase } from '../src/report/case-studies/index.ts'

const roots: string[] = []
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const sourceText = '现状茶园、水库和存量建筑构成场地资源。建议以茶饮品茶、茶园慢行步道、观景平台形成日间休闲，并在既有建筑配置游客中心和集散接待。'
function input(text = sourceText): FrozenProjectInput {
  return { projectId: 'case-test', projectName: '山水茶旅项目', revision: 103, generatedAt: '2026-09-18T10:00:00Z',
    recommendation: '以现状山水与茶园组织日间游览', decisionItems: [], gates: [], visualAssets: [],
    stateObjects: [{ objectId: 'PG04', chapterId: '06', title: '资源与产品', summary: text, facts: [], reportSections: [
      { key: 'products', title: '资源与产品', entries: [{ key: 'basis', fieldPath: 'data.products[0]', text, basis: '项目资料与策划建议', evidenceRefs: [{ evidenceId: 'site-source' }] }] },
    ] }] }
}
async function workspace() { const root = await mkdtemp(join(tmpdir(), 'report-case-studies-')); roots.push(root); return root }

// Structural fixture: source verification itself remains the real catalogue's responsibility.
function spatialFixture() {
  const row = structuredClone(VERIFIED_CASE_STUDIES[0]!) as any
  const ids = (name: string) => [`case-evidence:damushan:${name}`]
  row.spatial = {
    scope: { kind: 'building-site', statement: '大木山茶室及其相邻室外场地', evidenceIds: ids('scale'),
      measurements: [{ label: '建筑面积', value: 477.75, unit: 'm2', evidenceIds: ids('scale') }] },
    area: { evidenceIds: ids('site'), imageIds: ['site'] },
    line: { evidenceIds: ids('walk'), imageIds: ['organization'], routes: [{ mode: 'visitor',
      claim: '开放公共走道与茶室构成八字回路。', evidenceIds: ids('walk'),
      sourceQuote: row.evidence.find((e: any) => e.evidenceId === ids('walk')[0]).excerpt }] },
    point: { evidenceIds: ids('program'), imageIds: ['experience'] },
    sourceGaps: [{ scale: 'line', mode: 'vehicle', reason: '发布资料没有交代车辆交通组织。', blocking: false }],
  }
  row.gallery.forEach((image: any) => {
    image.mediaPurpose = { site: 'area-overview', organization: 'circulation', experience: 'representative-point', application: 'application' }[image.imageId as string]
    image.analysisScale = { site: 'area', organization: 'line', experience: 'point', application: 'point' }[image.imageId as string]
    image.imageQuality = { contentKind: ['site', 'organization'].includes(image.imageId) ? 'plan' : 'photo' }
  })
  row.analysis.forEach((section: any) => { section.scales = [{ site: 'area', organization: 'line', experience: 'point' }[section.focus as string]] })
  const { imageId: _id, evidenceIds: _refs, ...primary } = row.gallery[0]
  row.image = primary
  return row
}

describe('verified built-project case selection', () => {
  it('does not certify a historical photo gallery as sourced area, circulation and point coverage', () => {
    const row = structuredClone(VERIFIED_CASE_STUDIES[0]!) as any
    delete row.spatial
    expect(() => validateCatalogCase(row)).toThrow(/CASE_STUDY_COVERAGE/)
  })
  it('rejects a gallery whose renamed derivatives exceed the original-image allowance', () => {
    const row = spatialFixture()
    row.gallery.forEach((image: any) => {
      image.imageIdentity = { originalId: 'one-original-with-many-filenames', fileSha256: image.sha256,
        derivedFromSha256: row.gallery[0].sha256, verification: 'verified-derivative' }
    })
    row.image.imageIdentity = row.gallery[0].imageIdentity
    expect(() => validateCatalogCase(row)).toThrow(/CASE_STUDY_GALLERY_REUSE/)
  })
  it.each(['area', 'line'])('returns a source replenishment requirement when %s evidence is missing', scale => {
    const row = spatialFixture()
    row.spatial[scale].evidenceIds = []
    expect(() => validateCatalogCase(row)).toThrow(/CASE_STUDY_COVERAGE.*补充来源|CASE_STUDY_COVERAGE.*replenish/)
  })
  it('rejects a visitor passage being certified as a vehicle route', () => {
    const row = spatialFixture()
    row.spatial.line.routes.push({ ...row.spatial.line.routes[0], mode: 'vehicle', claim: '旅游巴士沿内部环路分流。' })
    expect(() => validateCatalogCase(row)).toThrow(/CASE_STUDY_ROUTE/)
  })
  it('rejects a flow claim citing a source quote that was never in the source', () => {
    const row = spatialFixture()
    row.spatial.line.routes[0].sourceQuote = '后勤车道独立设置在项目南侧。'
    expect(() => validateCatalogCase(row)).toThrow(/CASE_STUDY_ROUTE/)
  })
  it('does not use a tea-room photograph as an overall project plan', () => {
    const row = spatialFixture()
    row.spatial.area.imageIds = ['experience']
    expect(() => validateCatalogCase(row)).toThrow(/CASE_STUDY_COVERAGE/)
  })
  it('rejects a building area being inflated into an unsupported district extent', () => {
    const row = spatialFixture()
    row.spatial.scope.kind = 'district'
    row.spatial.scope.measurements[0] = { label: '片区占地', value: 200, unit: 'ha', evidenceIds: ['case-evidence:damushan:scale'] }
    expect(() => validateCatalogCase(row)).toThrow(/CASE_STUDY_SCALE/)
  })
  it('does not combine a route length with the unit from a different building measurement', () => {
    const row = structuredClone(VERIFIED_CASE_STUDIES.find(row => row.caseId === 'tianhu-lodge')) as any
    row.spatial.scope.measurements[0] = { label: '建筑面积', value: 2.5, unit: 'm2',
      evidenceIds: ['case-evidence:tianhu-lodge:scale', 'case-evidence:tianhu-lodge:route'] }
    expect(() => validateCatalogCase(row)).toThrow(/CASE_STUDY_SCALE/)
  })
  it('keeps gallery scale metadata consistent with its area purpose', () => {
    const row = spatialFixture()
    row.gallery[0].analysisScale = 'point'
    row.image.analysisScale = 'point'
    expect(() => validateCatalogCase(row)).toThrow(/CASE_STUDY_COVERAGE/)
  })
  it('selects three complete real cases and supports every match with both source sets', () => {
    const project = input(), bundle = selectCaseStudies(project)
    expect(bundle.cases).toHaveLength(3)
    expect(bundle.cases.map(row => row.caseId)).not.toContain('anji-tea')
    expect(bundle.catalogVersion).toBe(CASE_STUDIES_CATALOG_VERSION)
    expect(bundle.baseSourceFingerprint).toBe(manuscriptSourceFingerprint(project))
    const projectSources = new Set(makeSourceIndex(project).map(source => source.id))
    for (const row of bundle.cases) {
      expect(['completed', 'operating']).toContain(row.delivery.status)
      expect(row.similarities.length).toBeGreaterThanOrEqual(2)
      expect(row.image?.width).toBeGreaterThan(500)
      expect(caseStudySourceGaps(row).every(gap => !gap.blocking)).toBe(true)
      expect(row.spatial?.scope.measurements.length).toBeGreaterThan(0)
      for (const item of row.similarities) {
        expect(item.projectSourceRefs.every(id => projectSources.has(id))).toBe(true)
        expect(item.caseEvidenceIds.every(id => row.evidence.some(evidence => evidence.evidenceId === id))).toBe(true)
      }
    }
    expect(validateCaseStudies(bundle, project)).toBe(bundle)
  })
  it('keeps the incomplete Anji candidate visible to source replenishment', () => {
    const row = VERIFIED_CASE_STUDIES.find(row => row.caseId === 'anji-tea')!
    expect(caseStudySourceGaps(row)).toEqual(expect.arrayContaining([expect.objectContaining({ scale: 'line', mode: 'visitor', blocking: true })]))
    expect(() => validateCatalogCase(row)).toThrow(/CASE_STUDY_COVERAGE/)
    try { selectCaseStudies(input('本项目有茶园、茶饮和闲置建筑。')) } catch (error) {
      expect(error).toMatchObject({ code: 'CASE_STUDIES_INSUFFICIENT', sourceGaps: expect.arrayContaining([expect.objectContaining({ caseId: 'anji-tea' })]) })
      return
    }
    throw new Error('An incomplete case must not satisfy the minimum by hiding its source gap')
  })
  it('carries exact published location passages into photo review instead of inferring location from people', () => {
    for (const photo of caseStudyPhotos(selectCaseStudies(input())) as any[]) {
      expect(photo.locationEvidence?.length ?? 0).toBeGreaterThan(0)
      expect(photo.locationEvidence.map((evidence: any) => evidence.evidenceId)).toEqual(photo.image.locationEvidenceIds)
      for (const evidence of photo.locationEvidence) {
        expect(evidence.excerpt).toMatch(/项目地点|项目地址|福建省福鼎市|Address :/)
        expect(evidence.excerptHash).toBe(createHash('sha256').update(evidence.excerpt).digest('hex'))
        expect(evidence.sourceUrl).toMatch(/^https:\/\//)
      }
    }
  })
  it('accepts two distinct common points within one dimension', () => {
    const project = input('现状茶园与水库。闲置建筑用于游客中心。')
    const bundle = selectCaseStudies(project)
    const teaHouse = bundle.cases.find(row => row.caseId === 'damushan')!
    expect(teaHouse.similarities.map(row => row.featureId)).toEqual(['tea-landscape', 'waterfront'])
    expect(new Set(teaHouse.similarities.map(row => row.dimension)).size).toBe(1)
    expect(validateCaseStudies(bundle, project)).toBe(bundle)
  })
  it.each(['城市办公楼', '只有茶园。', '没有茶园，不设茶饮，禁止滨水和慢行，也没有存量建筑。'])('fails clearly instead of inventing cases for insufficient project support: %s', text => {
    expect(() => selectCaseStudies(input(text))).toThrow(/CASE_STUDIES_INSUFFICIENT/)
  })
  it('does not treat a cited reservoir regulation as evidence that the project has a waterfront', () => {
    const bundle = selectCaseStudies(input('本项目有茶园、茶饮和闲置建筑，设置步道和游客中心。规划依据：《水库大坝安全管理条例》。'))
    expect(bundle.cases).toHaveLength(3)
    expect(bundle.cases.flatMap(row => row.similarities).some(row => row.featureId === 'waterfront')).toBe(false)
  })
  it('rejects a planned or unknown project even if its title looks authentic', () => {
    for (const status of ['planned', 'unknown']) {
      const row = structuredClone(VERIFIED_CASE_STUDIES[0]!) as any
      row.delivery.status = status
      expect(() => validateCatalogCase(row)).toThrow(/CASE_STUDY_DELIVERY/)
    }
  })
  it('requires an actual completion or operating excerpt, not an unsupported status string', () => {
    const row = structuredClone(VERIFIED_CASE_STUDIES[0]!) as any
    row.delivery.evidenceIds = [row.features[0].evidenceIds[0]]
    expect(() => validateCatalogCase(row)).toThrow(/CASE_STUDY_DELIVERY/)
  })
  it('rejects broken or altered evidence and unverified substitutes', () => {
    const project = input(), bundle = structuredClone(selectCaseStudies(project)) as any
    bundle.cases[0].evidence[0].excerpt = '项目据称已经建成'
    expect(() => validateCaseStudies(bundle, project)).toThrow(/CASE_STUDY_EVIDENCE/)
    const substitute = structuredClone(selectCaseStudies(project)) as any
    substitute.cases[0].name = '虚构的同类茶园'
    expect(() => validateCaseStudies(substitute, project)).toThrow(/CASE_STUDY_UNVERIFIED/)
  })
  it('requires independent analytical sections and a distinct real photograph for every section', () => {
    for (const change of [
      (row: any) => { row.gallery = row.gallery.slice(0, 2) },
      (row: any) => { row.gallery[1].imageId = row.gallery[0].imageId },
      (row: any) => { row.gallery[1].sha256 = row.gallery[0].sha256 },
      (row: any) => { row.gallery[1].sourcePageUrl = 'https://example.org/unverified' },
      (row: any) => { row.gallery[1].evidenceIds = ['missing-photo-source'] },
      (row: any) => { row.analysis[1].body = row.analysis[0].body },
      (row: any) => { row.analysis[1].evidenceIds = ['missing-analysis-source'] },
    ]) {
      const row = structuredClone(VERIFIED_CASE_STUDIES[0]!) as any
      change(row)
      expect(() => validateCatalogCase(row)).toThrow(/CASE_STUDY_(?:GALLERY|ANALYSIS|EVIDENCE)/)
    }
  })
  it('does not accept a substituted photograph or altered analytical copy in a saved bundle', () => {
    const photo = structuredClone(selectCaseStudies(input())) as any
    photo.cases[0].gallery[1].sourceUrl = 'https://example.org/generated.jpg'
    expect(() => validateCaseStudies(photo)).toThrow(/CASE_STUDY_UNVERIFIED/)
    const analysis = structuredClone(selectCaseStudies(input())) as any
    analysis.cases[0].analysis[1].body[0] = '每年接待百万游客，创造亿元营收。'
    expect(() => validateCaseStudies(analysis)).toThrow(/CASE_STUDY_UNVERIFIED/)
  })
  it('rejects duplicate projects, fewer than three and more than five cases', () => {
    const base = selectCaseStudies(input())
    expect(() => validateCaseStudies({ ...base, cases: base.cases.slice(0, 2) })).toThrow(/CASE_STUDIES_COUNT/)
    expect(() => validateCaseStudies({ ...base, cases: [...base.cases, ...base.cases] })).toThrow(/CASE_STUDIES_COUNT/)
    expect(() => validateCaseStudies({ ...base, cases: [base.cases[0]!, base.cases[0]!, base.cases[1]!] })).toThrow(/CASE_STUDIES_DUPLICATE/)
  })
  it('rejects a single, repeated, or unsupported similarity', () => {
    const base = selectCaseStudies(input())
    for (const similarities of [base.cases[0]!.similarities.slice(0, 1), [base.cases[0]!.similarities[0]!, base.cases[0]!.similarities[0]!]]) {
      const bundle = structuredClone(base) as any
      bundle.cases[0].similarities = similarities
      expect(() => validateCaseStudies(bundle)).toThrow(/CASE_STUDY_SIMILARITIES/)
    }
    const unknown = structuredClone(base) as any
    unknown.cases[0].similarities[0].caseEvidenceIds = ['evidence-does-not-exist']
    expect(() => validateCaseStudies(unknown)).toThrow(/CASE_STUDY_UNSUPPORTED_MATCH/)
    const falseProjectLink = structuredClone(base) as any
    falseProjectLink.cases[0].similarities[0].projectExcerpts = ['现状茶园并未出现在当前项目来源中']
    expect(() => validateCaseStudies(falseProjectLink, input())).toThrow(/CASE_STUDY_UNSUPPORTED_MATCH/)
  })
  it('keeps photo/clock changes separate from source identity and rejects changed professional sources', () => {
    const project = input(), bundle = selectCaseStudies(project)
    expect(() => validateCaseStudies(bundle, { ...project, visualAssets: [], generatedAt: '2026-09-20T00:00:00Z' })).not.toThrow()
    expect(() => validateCaseStudies(bundle, { ...project, revision: 104 })).toThrow(/CASE_STUDIES_STALE/)
    expect(() => validateCaseStudies(bundle, { ...project, projectId: 'another-project' })).toThrow(/CASE_STUDIES_STALE/)
    expect(() => validateCaseStudies(bundle, input('茶园与品茶空间。'))).toThrow(/CASE_STUDIES_STALE/)
  })
})

describe('case-study preparation and client source projection', () => {
  it('prepares and reuses evidence without network or text-model dispatch and preserves the original manuscript', async () => {
    const root = await workspace(), network = vi.fn(() => { throw new Error('network or model dispatch is forbidden') })
    vi.stubGlobal('fetch', network)
    const project = { ...input(), manuscript: { original: true } as never }
    const before = JSON.stringify(project)
    const first = await prepareCaseStudies(project, root, { downloadImages: false })
    const second = await prepareCaseStudies({ ...project, generatedAt: '2026-09-19T00:00:00Z' }, root, { downloadImages: false })
    expect(second.generatedAt).toBe(first.generatedAt)
    expect(second.caseStudiesFingerprint).toBe(first.caseStudiesFingerprint)
    expect(JSON.stringify(project)).toBe(before)
    expect(network).not.toHaveBeenCalled()
    const saved = JSON.parse(await readFile(join(root, '.pre-design/report-case-studies.json'), 'utf8'))
    expect(saved.cases).toHaveLength(3)
    const sources = await readFile(join(root, '.pre-design/report-case-studies.evidence.md'), 'utf8')
    expect(sources).toContain('https://www.gooood.cn/')
    expect(sources).toContain('来源快照 SHA-256')
    expect(sources).toContain('摄影／图片来源')
  })
  it('rebuilds a corrupt optional cache from verified facts instead of adopting its claims', async () => {
    const root = await workspace(), bundle = await prepareCaseStudies(input(), root, { downloadImages: false })
    const corrupt = structuredClone(bundle) as any
    corrupt.cases[0].name = '虚构案例'
    await writeFile(join(root, '.pre-design/report-case-studies.json'), JSON.stringify(corrupt))
    const recovered = await prepareCaseStudies(input(), root, { downloadImages: false })
    expect(recovered.cases.map(row => row.name)).not.toContain('虚构案例')
  })
  it('rejects changed remote photograph bytes without dispatching a model or publishing partial evidence', async () => {
    const root = await workspace(), fetcher = vi.fn(async () => new Response('unverified image', { status: 200 }))
    await expect(prepareCaseStudies(input(), root, { fetch: fetcher as typeof fetch, refreshImages: true })).rejects.toThrow(/CASE_STUDY_IMAGE_HASH/)
    expect(fetcher).toHaveBeenCalled()
    await expect(readFile(join(root, '.pre-design/report-case-studies.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    for (const [url] of fetcher.mock.calls as unknown as [string][]) expect(url).not.toMatch(/chat\/completions|\/responses|ollama/)
  })
  it('materializes all real catalog photographs even when the network is unavailable', async () => {
    const root = await workspace(), network = vi.fn(() => { throw new Error('network unavailable') })
    vi.stubGlobal('fetch', network)
    const bundle = await prepareCaseStudies(input(), root)
    expect(caseStudyPhotos(bundle)).toHaveLength(12)
    for (const row of bundle.cases) {
      expect(row.image?.sourcePath).toBeTruthy()
      expect(row.gallery).toHaveLength(4)
      expect(row.image?.sourcePath).toBe(row.gallery?.find(image => image.imageId === 'site')?.sourcePath)
      for (const image of row.gallery!) {
        const bytes = await readFile(image.sourcePath!)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(image.sha256)
        expect(bytes.length).toBeGreaterThan(10_000)
        expect(image.imageIdentity?.fileSha256).toBe(image.sha256)
        expect(image.imageQuality?.inspection).toBeUndefined()
      }
    }
    expect(bundle.caseStudiesFingerprint).toBe(selectCaseStudies(input()).caseStudiesFingerprint)
    expect(network).not.toHaveBeenCalled()
  })
  it('materializes a shared source once while preserving both page captions and purposes', async () => {
    const root = await workspace(), requested = new Set<string>()
    const published = new Map(caseStudyPhotos(selectCaseStudies(input())).map(photo => [photo.image.sourceUrl, photo.image.sha256]))
    const fetcher: typeof fetch = async url => {
      const source = String(url)
      // A bounded source acquisition must not request the same published bytes twice in one preparation.
      if (requested.has(source)) throw new Error('REPEATED_SOURCE_ACQUISITION')
      requested.add(source)
      return new Response(new Uint8Array(Buffer.from(BUNDLED_CASE_STUDY_IMAGES[published.get(source)!]!, 'base64')))
    }
    const bundle = await prepareCaseStudies(input(), root, { fetch: fetcher, refreshImages: true })
    const shared = bundle.cases.find(row => row.caseId === 'xiangshan')!.gallery!
    const area = shared.find(image => image.imageId === 'site')!, line = shared.find(image => image.imageId === 'organization')!
    expect(area.sourcePath).toBe(line.sourcePath)
    expect(area.description).not.toBe(line.description)
    expect([area.mediaPurpose, line.mediaPurpose]).toEqual(['area-overview', 'circulation'])
    expect(createHash('sha256').update(await readFile(area.sourcePath!)).digest('hex')).toBe(area.sha256)
  })
  it('emits area, line, point and application pages with source media and separate provenance', () => {
    const bundle = selectCaseStudies(input())
    const pages = caseStudyPages(bundle), sources = caseStudySources(bundle), photos = caseStudyPhotos(bundle)
    expect(pages).toHaveLength(12)
    expect(sources).toHaveLength(15)
    expect(photos).toHaveLength(12)
    const sourceIds = new Set(sources.map(source => source.id))
    for (const row of bundle.cases) {
      const casePages = pages.filter(page => photos.filter(photo => photo.caseId === row.caseId).some(photo => photo.pageIds.includes(page.id)))
      expect(casePages).toHaveLength(4)
      expect(new Set(casePages.map(page => page.title)).size).toBe(4)
      expect(new Set(casePages.map(page => JSON.stringify(page.body))).size).toBe(4)
      expect(casePages.map(page => photos.find(photo => photo.pageIds.includes(page.id))?.analysisScale)).toEqual(['area', 'line', 'point', 'point'])
      expect(casePages.at(-1)?.body).toContain(row.boundary.applicationLimit)
      expect(photos.find(photo => photo.caseId === row.caseId && photo.imageId === 'site')?.sourceKey).toBe(caseStudyPhotoKey(row.caseId))
    }
    pages.forEach(page => {
      expect(page.kind).toBe('comparison')
      expect(page.sourceRefs.every(id => sourceIds.has(id))).toBe(true)
      expect(page.visual.kind).toBe('source')
      const photo = photos.find(photo => photo.sourceKey === page.visual.sourceMaterialKey)
      expect(photo?.pageIds).toContain(page.id)
      expect(page.body?.length).toBe(page.id.endsWith('-application') ? 3 : 2)
      const visible = JSON.stringify({ title: page.title, claim: page.claim, body: page.body, table: page.table, caption: page.visual.caption })
      expect(visible).not.toMatch(/意向|拟议|非现场|不表示|不代表|https?:\/\/|少潭河/)
    })
    const evidence = caseStudyEvidenceMarkdown(bundle)
    expect(evidence).toContain('竣工时间：2015.08')
    photos.forEach(photo => {
      expect(evidence).toContain(photo.image.sha256)
      expect(evidence).toContain(photo.image.sourceUrl)
      expect(evidence).toContain(photo.image.credit)
    })
  })
  it('rebuilds a one-photo catalogue cache without changing the manuscript identity', async () => {
    const root = await workspace(), project = input(), baseline = JSON.stringify(project)
    const old = await prepareCaseStudies(project, root, { downloadImages: false })
    const stale = { ...old, catalogVersion: 'verified-built-projects-2026-09-18.1', cases: old.cases.map(({ gallery: _gallery, analysis: _analysis, ...row }) => row) }
    await writeFile(join(root, '.pre-design/report-case-studies.json'), JSON.stringify(stale))
    const network = vi.fn(() => { throw new Error('model dispatch is forbidden') })
    const current = await prepareCaseStudies(project, root, { fetch: network })
    expect(caseStudyPages(current)).toHaveLength(12)
    expect(current.baseSourceFingerprint).toBe(old.baseSourceFingerprint)
    expect(JSON.stringify(project)).toBe(baseline)
    expect(network).not.toHaveBeenCalled()
  })
  it('uses the same three-to-four-page contract for a newly verified catalogue entry', async () => {
    // The additional entry exists only in this isolated test registry. Production still requires exact catalogue identity.
    const additional = structuredClone(VERIFIED_CASE_STUDIES[0]!) as any
    additional.caseId = 'additional-verified-fixture'
    additional.name = '独立案例结构测试'
    // A three-page case combines whole-building layout and circulation on the real first-floor plan.
    const lineImage = additional.gallery.find((image: any) => image.imageId === 'organization')
    additional.gallery[0] = { ...lineImage, imageId: 'site', analysisScale: 'area', mediaPurpose: 'area-circulation',
      evidenceIds: [...new Set([...lineImage.evidenceIds, ...additional.spatial.area.evidenceIds])] }
    additional.gallery = additional.gallery.filter((image: any) => image.imageId !== 'organization')
    additional.analysis = additional.analysis.filter((section: any) => section.focus !== 'organization')
    additional.analysis[0].scales = ['area', 'line']
    additional.analysis[0].body[1] = additional.spatial.line.routes[0].claim
    additional.analysis[0].evidenceIds = [...new Set([...additional.analysis[0].evidenceIds, ...additional.spatial.line.evidenceIds])]
    additional.spatial.line.imageIds = ['site']
    const { imageId: _focus, evidenceIds: _evidence, ...primary } = additional.gallery[0]
    additional.image = primary
    validateCatalogCase(additional)
    vi.resetModules()
    vi.doMock('../src/report/case-studies/catalog.ts', () => ({ VERIFIED_CASE_STUDIES: [...VERIFIED_CASE_STUDIES, additional] }))
    try {
      const generic = await import('../src/report/case-studies/index.ts')
      const project = { ...input('茶园和水库构成场地资源，茶饮、步道和既有建筑配置游客中心。'), projectId: 'another-client', projectName: '第二个独立项目' }
      const bundle = generic.selectCaseStudies(project)
      expect(bundle.cases).toHaveLength(4)
      const photos = generic.caseStudyPhotos(bundle).filter(photo => photo.caseId === additional.caseId)
      expect(photos).toHaveLength(3)
      const pages = generic.caseStudyPages(bundle).filter(page => photos.some(photo => photo.pageIds.includes(page.id)))
      expect(pages).toHaveLength(3)
      const sources = new Set(generic.caseStudySources(bundle).map(source => source.id))
      for (const page of pages) {
        expect(page.title).toContain(additional.name)
        expect(page.sourceRefs.every(id => sources.has(id))).toBe(true)
        expect(page.visual.kind).toBe('source')
        expect(photos.some(photo => photo.sourceKey === page.visual.sourceMaterialKey)).toBe(true)
      }
      expect(JSON.stringify(pages)).not.toMatch(/少潭河|shaotanhe/i)
    } finally {
      vi.doUnmock('../src/report/case-studies/catalog.ts')
      vi.resetModules()
    }
  })
})
