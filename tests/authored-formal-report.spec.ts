import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SiteBoundaryRecord, VisualAssetRecord } from '../src/governance/types.ts'
import { caseStudyPhotos, selectCaseStudies } from '../src/report/case-studies/index.ts'
import { assertClientReportPolicy, validateClientReportPolicy } from '../src/report/client-policy.ts'
import { createClientReportBundle, isAuthenticClientReportBundle } from '../src/report/client-projection.ts'
import type { ClientAssetBinding, ClientProjectProfile, ClientReport, ClientRenderContext } from '../src/report/client-types.ts'
import { isConditionalReport, type ConditionalReportMaterial } from '../src/report/conditional-report.ts'
import { makeSourceIndex, manuscriptSourceFingerprint } from '../src/report/manuscript/source.ts'
import { planClientPages, assertClientPagePlan, validateClientPagePlan } from '../src/report/page-plan.ts'
import { ReportPackageService } from '../src/report/package-service.ts'
import { assertRegularPagePlan } from '../src/report/regular/plan.ts'
import type { FrozenProjectInput, ReportAsset } from '../src/report/types.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const analysisKinds = ['regional-context', 'existing-condition', 'accessibility', 'circulation', 'constraints'] as const
const chartTopics = ['existing-condition', 'audience-demand', 'accessibility', 'operation-investment', 'implementation-phasing', 'product-value'] as const

function material(key: string, pageId: string, hash = sha(key)): ConditionalReportMaterial {
  return { sourceKey: key, sourcePath: `C:/fixtures/${key.replace(/:/g, '-')}.png`, displayName: key, originalFileName: 'scene.png',
    mimeType: 'image/png', semanticRole: 'concept_visual', widthPx: 1200, heightPx: 800,
    createdAt: REPORT_INPUT.generatedAt, adoptedAt: REPORT_INPUT.generatedAt, objectIds: [], evidenceIds: [], role: 'primary',
    pageBindingOnly: true, pageBindings: [{ findingId: `manuscript:${pageId}`, role: 'primary' }],
    origin: { type: 'generated_by_tool', sourceMaterialKeys: [], parentAssetKeys: [], method: 'concept', sourceTool: null }, sha256: hash }
}

function fixture(architectural = true) {
  const boundaryAsset: ReportAsset = { assetId: 'formal-redline', chapterId: '07', kind: 'evidence', caption: '场地边界',
    sourcePath: 'C:/fixtures/redline.png', mimeType: 'image/png', sha256: sha('redline'), width: 1200, height: 800 }
  const professionalAssets: ReportAsset[] = [...analysisKinds, ...chartTopics].map((key, i) => ({
    assetId: `professional-${i}`, kind: 'evidence', chapterId: '02', caption: i < analysisKinds.length ? `场地条件分析 ${i + 1}` : `项目实施测算 ${i + 1}`,
    sourcePath: `C:/fixtures/professional-${i}.png`, mimeType: 'image/png', sha256: sha(`${key}:${i}`), width: 1200, height: 800,
  }))
  const provenance = { sourceLabel: '项目调查资料', sourceDate: '2026-08-28', locator: '场地与市场调查', sourceFileSha256: sha('source'), evidenceIds: ['evidence-1'] }
  const bindings: ClientAssetBinding[] = professionalAssets.map((asset, i) => ({ assetId: asset.assetId, role: i < analysisKinds.length ? 'map' : 'chart',
    chapterId: 'chapter-02', sha256: asset.sha256!, width: 1200, height: 800, provenance,
    ...(i < analysisKinds.length ? { analysisKind: analysisKinds[i], cartography: { boundary: 'not-applicable' as const, legend: 'present' as const, northArrow: 'present' as const, scale: { kind: 'nts' as const } } }
      : { chartTopic: chartTopics[i - analysisKinds.length], chartContract: { unit: '人次/日', methodology: '按场地承载和日间开放时间测算' } }) }))
  const input: FrozenProjectInput = { ...REPORT_INPUT,
    stateObjects: REPORT_INPUT.stateObjects.map((object, i) => i ? object : { ...object,
      facts: [{ label: '场地资源', value: '现状茶园、水库和存量建筑构成场地资源。建议以茶饮品茶、茶园慢行步道、观景平台形成日间休闲，并在既有建筑配置游客中心和集散接待。', basis: 'Gate G1，现场资料 C:/private/source.png' }] }),
    siteBoundary: { status: 'confirmed', boundaryId: 'boundary-1', assetId: boundaryAsset.assetId, confirmedRevision: 3,
      source: 'approved_redline', sourceSha256: boundaryAsset.sha256!, assetSha256: boundaryAsset.sha256!, integrityDigest: sha('integrity') },
    visualAssets: [...REPORT_INPUT.visualAssets, boundaryAsset, ...professionalAssets],
    adoptedAssetIds: ['concept-1', boundaryAsset.assetId, ...professionalAssets.map(asset => asset.assetId)],
  }
  const sourceId = makeSourceIndex(input)[0]!.id
  const cases = selectCaseStudies(input)
  const caseStudies = { ...cases, cases: cases.cases.map(row => ({ ...row,
    image: { ...row.image!, sourcePath: `C:/fixtures/${row.caseId}-site.jpg` },
    gallery: row.gallery!.map(image => ({ ...image, sourcePath: `C:/fixtures/${row.caseId}-${image.imageId}.jpg` })),
  })) }
  const authored: FrozenProjectInput = { ...input, caseStudies,
    manuscript: { schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: 'test', projectId: input.projectId,
      sourceRevision: input.revision, sourceFingerprint: manuscriptSourceFingerprint(input), generatedAt: input.generatedAt, title: '茶湖慢游｜前期策划汇报',
      chapters: [{ id: 'products', title: '日间休闲产品', thesis: '以茶园与水岸串联日间游线', pages: [{ id: 'tea-route', kind: 'product', title: '茶湖慢游',
        claim: '以茶饮、漫步和临水停留形成完整的日间游线。', body: ['从茶室出发，串联茶园步道与临水平台，形成可停留、可体验的半日游程。'], sourceRefs: [sourceId],
        product: { name: '茶湖慢游', audience: '家庭及城市访客', experience: '品茶与临水漫步', location: '既有建筑与现状步道', scale: '结合既有路径组织小组游览', operations: '统一预约与日间服务' },
        visual: { kind: 'concept', subject: '茶园漫步', purpose: '组织慢游体验', caption: '茶园漫步' }, notes: ['Gate G1 · C:/private/source.png'] }] }] } }
  const materials: ConditionalReportMaterial[] = [material('concept-1', 'tea-route', 'a'.repeat(64)), ...caseStudyPhotos(caseStudies).map(photo => ({
    ...material(photo.sourceKey, photo.pageIds[0]!, photo.image.sha256), sourcePath: photo.image.sourcePath!,
    widthPx: photo.image.width, heightPx: photo.image.height, mimeType: photo.image.mimeType, semanticRole: 'source_evidence' as const,
  }))]
  const profile: ClientProjectProfile = { ...CLIENT_PROFILE, assetBindings: [...CLIENT_PROFILE.assetBindings, ...bindings],
    ...(architectural ? { visualContractVersion: 'architectural-v1' } : {}) }
  return { input: authored, profile, materials, boundaryAsset, sourceId }
}

describe('authored formal reports', () => {
  it('shares authored copy, verified cases and prepared photos while retaining formal identity and all professional visuals', () => {
    const f = fixture(), bundle = createClientReportBundle(f.input, f.profile, f.materials)
    expect(isAuthenticClientReportBundle(bundle)).toBe(true)
    expect(isConditionalReport(bundle.report)).toBe(false)
    expect(bundle.identity.siteBoundaryId).toBe('boundary-1')
    expect(bundle.identity.siteBoundaryAssetSha256).toBe(f.boundaryAsset.sha256)
    expect(bundle.report.visualContractVersion).toBe('architectural-v1')
    expect(bundle.report.identity.reportTitle).toBe(f.input.manuscript!.title)
    expect(bundle.report.proposition.coreValue).toBe(f.input.manuscript!.chapters[0]!.pages[0]!.claim)
    expect(JSON.stringify(bundle.report.chapters)).not.toContain(CLIENT_PROFILE.chapters[0]!.headline)
    expect(bundle.report.products.map(product => product.productId)).toEqual(['tea-route'])
    expect(bundle.report.products[0]!.evidenceIds).toEqual([f.sourceId])
    expect(bundle.report.chapters.filter(chapter => chapter.blocks.some(block => block.type === 'planning-page' && block.page.id.startsWith('case-study-')))).toHaveLength(12)
    for (const photo of caseStudyPhotos(f.input.caseStudies!)) {
      const chapter = bundle.report.chapters.find(chapter => chapter.blocks.some(block => block.type === 'planning-page' && photo.pageIds.includes(block.page.id)))!
      expect(bundle.report.assets.some(asset => asset.chapterId === chapter.id && asset.sha256 === photo.image.sha256)).toBe(true)
    }
    expect(bundle.report.assets.filter(asset => asset.analysisKind !== undefined)).toHaveLength(6)
    expect(bundle.report.assets.filter(asset => asset.role === 'chart')).toHaveLength(6)
    for (const asset of bundle.report.assets.filter(asset => asset.analysisKind !== undefined || asset.role === 'chart')) {
      const chapter = bundle.report.chapters.find(chapter => chapter.id === asset.chapterId)!
      expect(chapter.blocks).toHaveLength(1)
      expect(chapter.blocks[0]!.type).toBe('planning-page')
      expect(bundle.report.assets.filter(candidate => candidate.chapterId === chapter.id)).toHaveLength(1)
    }
    expect(validateClientReportPolicy(bundle.report)).toEqual([])
    expect(() => assertClientReportPolicy(bundle.report)).not.toThrow()
  })

  it('uses identical physical pages and validates complete text, image placement and geometry in all formats', () => {
    const f = fixture(), report = createClientReportBundle(f.input, f.profile, f.materials).report
    const plans = (['html', 'pptx', 'pdf'] as const).map(medium => planClientPages(report, medium))
    expect(plans[0]!.pages).toEqual(plans[1]!.pages)
    expect(plans[0]!.pages).toEqual(plans[2]!.pages)
    for (const plan of plans) {
      expect(plan.visualContractVersion).toBe('architectural-v1')
      expect(() => assertRegularPagePlan(plan, report)).not.toThrow()
      expect(() => assertClientPagePlan(plan, report)).not.toThrow()
    }
    expect(validateClientPagePlan({ ...plans[0]!, visualContractVersion: undefined }, report)).toContainEqual(expect.objectContaining({ code: 'VISUAL_CONTRACT_MISMATCH' }))
    const noVisuals = { ...plans[0]!, pages: plans[0]!.pages.map(page => ({ ...page, assetIds: [], regularLayout: { ...page.regularLayout!, media: [] } })) }
    expect(validateClientPagePlan(noVisuals, report)).toContainEqual(expect.objectContaining({ code: 'REGULAR_ASSET_UNPLACED' }))
    const noCopy = { ...plans[0]!, pages: plans[0]!.pages.map(page => ({ ...page, regularLayout: { ...page.regularLayout!, texts: page.regularLayout!.texts.filter(text => text.role !== 'body') } })) }
    expect(validateClientPagePlan(noCopy, report)).toContainEqual(expect.objectContaining({ code: 'REGULAR_COPY_INCOMPLETE' }))
  })

  it('keeps source metadata separate from visible copy while validating source and product references', () => {
    const f = fixture(), report = createClientReportBundle(f.input, f.profile, f.materials).report
    expect(report.evidence.some(evidence => evidence.sourceLabel.includes('Gate G1'))).toBe(true)
    const mutate = (change: (page: Extract<ClientReport['chapters'][number]['blocks'][number], { type: 'planning-page' }>['page']) => unknown): ClientReport => ({
      ...report, chapters: report.chapters.map((chapter, i) => i ? chapter : { ...chapter, blocks: chapter.blocks.map(block => block.type === 'planning-page' ? { ...block, page: change(block.page) } : block) }),
    } as ClientReport)
    expect(validateClientReportPolicy(mutate(page => ({ ...page, sourceRefs: ['missing-source'] })))).toContainEqual(expect.objectContaining({ code: 'REFERENCE_NOT_FOUND' }))
    expect(validateClientReportPolicy(mutate(page => ({ ...page, body: ['Gate G1 已通过'] })))).toContainEqual(expect.objectContaining({ code: 'CLIENT_FORBIDDEN_TERM' }))
    expect(validateClientReportPolicy(mutate(page => ({ ...page, visual: { ...page.visual, caption: '概念意向，非现场实景' } })))).toContainEqual(expect.objectContaining({ code: 'CLIENT_MATERIAL_EXPLANATION' }))
    expect(validateClientReportPolicy({ ...report, products: report.products.map(product => ({ ...product, evidenceIds: ['missing'] })) })).toContainEqual(expect.objectContaining({ code: 'REFERENCE_NOT_FOUND' }))
  })

  it('rejects incomplete cases, missing prepared images, boundary mismatches and broken professional contracts', () => {
    const f = fixture()
    expect(() => createClientReportBundle({ ...f.input, caseStudies: undefined }, f.profile, f.materials)).toThrow('CASE_STUDIES_REQUIRED')
    expect(() => createClientReportBundle(f.input, f.profile)).toThrow('AUTHORED_REPORT_MATERIALS_REQUIRED')
    expect(() => createClientReportBundle(f.input, f.profile, f.materials.slice(0, 1))).toThrow('CASE_STUDY_PHOTO_REQUIRED')
    expect(() => createClientReportBundle(f.input, f.profile, f.materials.slice(1))).toThrow('AUTHORED_REPORT_VISUAL_REQUIRED')
    expect(() => createClientReportBundle({ ...f.input, siteBoundary: { status: 'not_provided' } }, f.profile, f.materials)).toThrow('SITE_BOUNDARY_CONFIRMATION_REQUIRED')
    const input = { ...f.input, visualAssets: f.input.visualAssets.map(asset => asset.assetId === f.boundaryAsset.assetId ? { ...asset, sha256: sha('different') } : asset) }
    expect(() => createClientReportBundle(input, f.profile, f.materials)).toThrow('SITE_BOUNDARY_PROFILE_CONFLICT')
    const report = createClientReportBundle(f.input, f.profile, f.materials).report
    expect(validateClientReportPolicy({ ...report, assets: report.assets.filter(asset => asset.analysisKind !== 'accessibility') })).toContainEqual(expect.objectContaining({ code: 'SITE_ANALYSIS_SERIES_INCOMPLETE' }))
    expect(validateClientReportPolicy({ ...report, evidence: report.evidence.filter(evidence => evidence.evidenceId !== 'evidence-1') })).toContainEqual(expect.objectContaining({ code: 'VISUAL_PROVENANCE_INVALID' }))
    expect(validateClientReportPolicy({ ...report, assets: report.assets.map(asset => asset.role === 'chart' ? { ...asset, chartContract: undefined } : asset) })).toContainEqual(expect.objectContaining({ code: 'CHART_CONTRACT_INVALID' }))
  })

  it('keeps the legacy path unchanged when manuscript is absent', () => {
    const bundle = createClientReportBundle(REPORT_INPUT, CLIENT_PROFILE)
    expect(bundle.report.chapters.map(chapter => chapter.headline)).toEqual(CLIENT_PROFILE.chapters.map(chapter => chapter.headline))
    expect(bundle.report.products).toEqual(CLIENT_PROFILE.products)
    expect(planClientPages(bundle.report, 'html').canvas).toBeUndefined()
  })

  it('checks every gallery photograph rather than accepting only the site photographs', () => {
    const f = fixture(), photos = caseStudyPhotos(f.input.caseStudies!)
    for (const photo of photos.filter(photo => photo.imageId !== 'site')) {
      const remaining = f.materials.filter(material => material.sourceKey !== photo.sourceKey)
      expect(() => createClientReportBundle(f.input, f.profile, remaining)).toThrow(`CASE_STUDY_PHOTO_REQUIRED: ${photo.caseId}/${photo.imageId}`)
      const altered = f.materials.map(material => material.sourceKey === photo.sourceKey ? { ...material, sha256: sha('substituted photo') } : material)
      expect(() => createClientReportBundle(f.input, f.profile, altered)).toThrow(`CASE_STUDY_PHOTO_REQUIRED: ${photo.caseId}/${photo.imageId}`)
    }
  })

  it('checks gallery dimensions and source role and accepts registered photo aliases', () => {
    const f = fixture(), photo = caseStudyPhotos(f.input.caseStudies!).find(photo => photo.imageId === 'experience')!
    for (const change of [
      { widthPx: photo.image.width + 1 }, { heightPx: photo.image.height + 1 }, { semanticRole: 'concept_visual' as const },
    ]) {
      expect(() => createClientReportBundle(f.input, f.profile, f.materials.map(material => material.sourceKey === photo.sourceKey ? { ...material, ...change } : material)))
        .toThrow(`CASE_STUDY_PHOTO_REQUIRED: ${photo.caseId}/${photo.imageId}`)
    }
    const aliases = f.materials.map(material => material.semanticRole === 'source_evidence'
      ? { ...material, sourceKey: `registered:${material.sourceKey}`, aliases: [material.sourceKey] } : material)
    const bundle = createClientReportBundle(f.input, f.profile, aliases)
    expect(bundle.report.assets.filter(asset => caseStudyPhotos(f.input.caseStudies!).some(photo => photo.image.sha256 === asset.sha256))).toHaveLength(12)
  })

  it('passes the prepared materials through ReportPackageService and renders authored pages without relaxing boundary checks', async () => {
    const f = fixture(false), boundary = f.input.siteBoundary!
    if (boundary.status !== 'confirmed') throw new Error('fixture')
    const root = await mkdtemp(join(tmpdir(), 'authored-formal-')); roots.push(root)
    const owner = { actorId: 'owner', name: '负责人', role: 'decision_owner' as const }
    const record: SiteBoundaryRecord = { boundaryId: boundary.boundaryId, projectId: f.input.projectId, status: 'confirmed_formal_boundary', source: boundary.source,
      origin: 'user_image', submissionChannel: 'dsh_human_command', submittedRevision: 3, submittedBy: owner, submittedAt: f.input.generatedAt,
      sourceAsset: { assetId: boundary.assetId, fileName: 'redline.png', sha256: boundary.sourceSha256!, attachment: {
        storageSha256: boundary.sourceSha256!, origin: 'user_image', attachmentId: 'redline-upload', mediaType: 'image/png', displayName: '场地红线图',
        bytes: 13, width: 1200, height: 800, submittedBy: owner, submittedRevision: 3 } },
      confirmedRevision: boundary.confirmedRevision, confirmedAt: '2026-08-28T09:00:00.000Z', confirmedBy: owner,
      confirmationChannel: 'dsh_human_command', confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界', confirmationSourceSha256: boundary.sourceSha256 }
    const asset: VisualAssetRecord = { assetId: boundary.assetId, taskId: boundary.assetId, projectId: f.input.projectId, kind: 'evidence', mimeType: 'image/png',
      fileName: 'redline.png', sha256: boundary.assetSha256, width: 1200, height: 800, required: true, status: 'adopted', createdAt: f.input.generatedAt }
    const snapshot = { record, asset, integrityDigest: boundary.integrityDigest, bytes: Buffer.from('test snapshot') }
    const received: ClientRenderContext[] = []
    const materials = vi.fn(async () => f.materials)
    const service = new ReportPackageService({ governance: { readProject: () => ({ projectId: f.input.projectId, authorizations: [], workflowRuns: [],
      gateDecisions: [], visualPolicies: [], visualTasks: [], visualAssets: [asset], siteBoundaries: [record], reportPackages: [] }), putReportPackage: async value => value },
      boundaryIntegrity: { captureFormalBoundarySnapshot: async () => snapshot, assertFormalBoundaryIntegrity: async () => snapshot }, packageRoot: root,
      source: async () => f.input, profile: async () => f.profile, materials, browserExecutable: 'unused',
      renderers: { html: async context => { received.push(context) }, printHtml: async (context, output) => { received.push(context); return join(output, 'print.html') },
        pptx: async context => { received.push(context) }, pdf: async () => {} },
      validate: async (_root, identity) => ({ ...identity, artifacts: [] }), createId: () => 'authored-package',
    })
    await service.publish(f.input.projectId, f.input.revision)
    expect(materials).toHaveBeenCalledWith(f.input)
    expect(received).toHaveLength(3)
    for (const context of received) {
      expect(context.report.identity.reportTitle).toBe(f.input.manuscript!.title)
      expect(context.report.assets.filter(asset => asset.sourceKind === 'project-source').length).toBeGreaterThanOrEqual(16)
      expect(context.plan.canvas).toBeDefined()
      expect(() => assertClientPagePlan(context.plan, context.report)).not.toThrow()
    }
  })
})
