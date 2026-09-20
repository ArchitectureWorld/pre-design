import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import { caseStudyPhotos, validateCaseStudies } from './case-studies/index.ts'
import { createConditionalReportBundle, type ConditionalReportMaterial } from './conditional-report.ts'
import { clientCopyText } from './manuscript/client-copy.ts'
import { manuscriptSourceFingerprint } from './manuscript/source.ts'
import { createClientTheme } from './theme.ts'
import type {
  ClientAssetBinding,
  ClientChapter,
  ClientProjectProfile,
  ClientResearchPreviewBundle,
  ClientReportBundle,
  ClientVisualAsset,
  ClientReport,
} from './client-types.ts'
import type { FrozenProjectInput, ReportAsset } from './types.ts'

type ClientReportBundleData = Pick<ClientReportBundle, 'report' | 'identity' | 'governanceAppendix'>
const formalBundles = new WeakSet<object>()
const researchPreviewBundles = new WeakSet<object>()

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function sourceKind(asset: ReportAsset): ClientVisualAsset['sourceKind'] {
  if (asset.kind === 'concept') return 'ai-concept'
  if (asset.kind === 'deterministic') return 'deterministic'
  return 'project-source'
}

function clientCaption(value: string): string {
  return value
    .replace(/\s*[（(]\s*AI\s*生成\s*[）)]/giu, '')
    .replace(/\s*[｜|·]\s*AI\s*生成/giu, '')
    .trim()
}

function boundarySourceLabel(source: Extract<FrozenProjectInput['siteBoundary'], { status: 'confirmed' }>['source']): string {
  if (source === 'approved_site_plan') return '项目总平图'
  if (source === 'approved_redline') return '项目红线图'
  return '闭合坐标派生图'
}

function governedBoundaryBinding(
  input: FrozenProjectInput,
  profile: ClientProjectProfile,
): ClientAssetBinding | undefined {
  const boundary = input.siteBoundary
  if (boundary?.status !== 'confirmed') return undefined
  const asset = input.visualAssets.find(candidate => candidate.assetId === boundary.assetId)
  if (asset === undefined || asset.sha256 !== boundary.assetSha256 || asset.width === undefined || asset.height === undefined
    || asset.kind === 'concept') throw new Error('SITE_BOUNDARY_PROFILE_CONFLICT：治理边界资产不可由 profile 创建或替换。')
  const chapterId = profile.chapters.some(chapter => chapter.id === asset.chapterId)
    ? asset.chapterId!
    : profile.chapters.some(chapter => chapter.id === `chapter-${asset.chapterId}`)
      ? `chapter-${asset.chapterId}`
      : profile.chapters.find(chapter => chapter.role === 'spatial')?.id
  if (chapterId === undefined) throw new Error('SITE_BOUNDARY_PROFILE_CONFLICT：治理边界缺少客户报告空间章节。')
  return {
    assetId: boundary.assetId,
    role: 'map',
    chapterId,
    sha256: boundary.assetSha256,
    width: asset.width,
    height: asset.height,
    analysisKind: 'site-boundary',
    provenance: {
      sourceLabel: boundarySourceLabel(boundary.source),
      sourceDate: input.generatedAt.slice(0, 10),
      locator: '项目资料',
      sourceFileSha256: boundary.assetSha256,
      evidenceIds: profile.evidence[0] === undefined ? [] : [profile.evidence[0].evidenceId],
    },
    cartography: {
      boundary: 'confirmed',
      ...(boundary.sourceSha256 === undefined ? {} : { boundarySourceSha256: boundary.sourceSha256 }),
      ...(boundary.geometrySha256 === undefined ? {} : { boundaryGeometrySha256: boundary.geometrySha256 }),
      legend: 'present',
      northArrow: 'present',
      scale: { kind: 'nts' },
    },
  }
}

export function injectGovernedSiteBoundaryBinding(
  input: FrozenProjectInput,
  profile: ClientProjectProfile,
): ClientProjectProfile {
  const profileBoundaryClaims = profile.assetBindings.filter(binding => binding.analysisKind === 'site-boundary'
    || binding.cartography?.boundary === 'research'
    || binding.cartography?.boundary === 'confirmed')
  if (input.siteBoundary?.status !== 'confirmed') {
    if (profileBoundaryClaims.length > 0) {
      throw new Error('SITE_BOUNDARY_PROFILE_CONFLICT：profile 不得创建或伪造治理边界。')
    }
    return profile
  }
  const governed = governedBoundaryBinding(input, profile)
  if (governed === undefined) throw new Error('SITE_BOUNDARY_PROFILE_CONFLICT：治理边界 binding 缺失。')
  const governedAssetBindings = profile.assetBindings.filter(binding => binding.assetId === governed.assetId)
  if (profileBoundaryClaims.length === 0 && governedAssetBindings.length === 0) {
    return { ...profile, assetBindings: [...profile.assetBindings, governed] }
  }
  if (profileBoundaryClaims.length !== 1 || governedAssetBindings.length !== 1
    || profileBoundaryClaims[0] !== governedAssetBindings[0]
    || !isDeepStrictEqual(profileBoundaryClaims[0], governed)) {
    throw new Error('SITE_BOUNDARY_PROFILE_CONFLICT：profile 场地边界与治理确认记录不一致。')
  }
  return profile
}

function bindAsset(
  asset: ReportAsset,
  binding: ClientAssetBinding,
  boundary: FrozenProjectInput['siteBoundary'],
): ClientVisualAsset {
  if (asset.sha256 !== undefined && (binding.sha256 !== asset.sha256 || binding.width !== asset.width || binding.height !== asset.height)) {
    throw new Error('client asset binding does not match frozen asset')
  }
  if (binding.analysisKind === 'site-boundary' && boundary?.status === 'confirmed') {
    if (boundary.sourceSha256 !== undefined) {
      if (asset.sha256 !== boundary.sourceSha256) throw new Error('SITE_BOUNDARY_SOURCE_MISMATCH')
    } else if (boundary.geometrySha256 !== undefined) {
      if ((asset.kind !== 'evidence' && asset.kind !== 'deterministic')
        || asset.boundaryGeometrySha256 !== boundary.geometrySha256) throw new Error('SITE_BOUNDARY_SOURCE_MISMATCH')
    } else {
      throw new Error('SITE_BOUNDARY_SOURCE_MISMATCH')
    }
  }
  const cartography = binding.analysisKind !== 'site-boundary' || binding.cartography === undefined || boundary === undefined
    ? binding.cartography
    : boundary.status === 'confirmed'
      ? { ...binding.cartography, boundary: 'confirmed' as const, ...(boundary.sourceSha256 === undefined ? {} : { boundarySourceSha256: boundary.sourceSha256 }), ...(boundary.geometrySha256 === undefined ? {} : { boundaryGeometrySha256: boundary.geometrySha256 }) }
      : boundary.status === 'synthetic_research'
        ? { ...binding.cartography, boundary: 'research' as const, disclosures: boundary.declarations }
        : binding.cartography
  return {
    assetId: asset.assetId,
    role: binding.role,
    chapterId: binding.chapterId,
    ...(binding.productId === undefined ? {} : { productId: binding.productId }),
    caption: clientCaption(asset.caption),
    sourceKind: sourceKind(asset),
    sourcePath: asset.sourcePath,
    sha256: asset.sha256 ?? binding.sha256,
    width: asset.width ?? binding.width,
    height: asset.height ?? binding.height,
    ...(binding.analysisKind === undefined ? {} : { analysisKind: binding.analysisKind }),
    ...(binding.chartTopic === undefined ? {} : { chartTopic: binding.chartTopic }),
    ...(binding.provenance === undefined ? {} : { provenance: binding.provenance }),
    ...(cartography === undefined ? {} : { cartography }),
    ...(binding.chartContract === undefined ? {} : { chartContract: binding.chartContract }),
  }
}

function bindClientAssets(
  assets: readonly ReportAsset[],
  bindings: readonly ClientAssetBinding[],
  boundary: FrozenProjectInput['siteBoundary'],
): ClientVisualAsset[] {
  const assetsById = new Map(assets.map(asset => [asset.assetId, asset]))
  const bindingsById = new Map(bindings.map(binding => [binding.assetId, binding]))

  for (const binding of bindings) {
    if (!assetsById.has(binding.assetId)) throw new Error('missing frozen visual asset ' + binding.assetId)
  }

  return assets.map(asset => {
    const binding = bindingsById.get(asset.assetId)
    if (binding === undefined) throw new Error('missing client asset binding ' + asset.assetId)
    return bindAsset(asset, binding, boundary)
  })
}

function clientChapters(profile: ClientProjectProfile): ClientChapter[] {
  return profile.chapters.map(chapter => ({
    id: chapter.id,
    role: chapter.role,
    headline: chapter.headline,
    claim: chapter.claim,
    blocks: chapter.blocks,
  }))
}

export function createClientReportBundle(
  input: FrozenProjectInput,
  profile: ClientProjectProfile,
  materials?: readonly ConditionalReportMaterial[],
): ClientReportBundle {
  if (input.manuscript !== undefined && input.siteBoundary?.status !== 'confirmed') throw new Error('SITE_BOUNDARY_CONFIRMATION_REQUIRED')
  const governedProfile = injectGovernedSiteBoundaryBinding(input, profile)
  const legacy = createClientReportBundleFromProfile(input, governedProfile)
  const data = input.manuscript === undefined ? legacy : authoredFormalReport(input, governedProfile, legacy, materials)
  const bundle = deepFreeze({ kind: 'formal', publishable: true, ...data }) as ClientReportBundle
  formalBundles.add(bundle)
  return bundle
}

/** Authored copy is shared with the preview; formal boundary and visual contracts are retained. */
function authoredFormalReport(
  input: FrozenProjectInput,
  profile: ClientProjectProfile,
  legacy: ClientReportBundleData,
  materials: readonly ConditionalReportMaterial[] | undefined,
): ClientReportBundleData {
  if (input.siteBoundary?.status !== 'confirmed') throw new Error('SITE_BOUNDARY_CONFIRMATION_REQUIRED')
  const manuscript = input.manuscript!
  if (manuscript.projectId !== input.projectId || manuscript.sourceRevision !== input.revision
    || manuscript.sourceFingerprint !== manuscriptSourceFingerprint(input)) throw new Error('MANUSCRIPT_SOURCE_STALE')
  if (input.caseStudies === undefined) throw new Error('CASE_STUDIES_REQUIRED: authored formal reports require 3–5 verified cases')
  validateCaseStudies(input.caseStudies, input)
  if (materials === undefined) throw new Error('AUTHORED_REPORT_MATERIALS_REQUIRED')
  if (materials.some(material => !/^[a-f0-9]{64}$/iu.test(material.sha256) || !material.sourcePath.trim()
    || !Number.isFinite(material.widthPx) || (material.widthPx ?? 0) <= 0
    || !Number.isFinite(material.heightPx) || (material.heightPx ?? 0) <= 0)) throw new Error('AUTHORED_REPORT_MATERIAL_INVALID')
  for (const entry of caseStudyPhotos(input.caseStudies)) {
    const photo = materials.find(material => material.sourceKey === entry.sourceKey || material.aliases?.includes(entry.sourceKey))
    if (!entry.image.sourcePath || !photo || photo.sha256 !== entry.image.sha256
      || photo.widthPx !== entry.image.width || photo.heightPx !== entry.image.height
      || photo.semanticRole !== 'source_evidence') throw new Error(`CASE_STUDY_PHOTO_REQUIRED: ${entry.caseId}/${entry.imageId}`)
  }
  const authored = createConditionalReportBundle(input, materials).report
  for (const chapter of authored.chapters) {
    for (const block of chapter.blocks) {
      if (block.type !== 'planning-page') throw new Error('AUTHORED_REPORT_PLANNING_PAGE_REQUIRED')
      const images = authored.assets.filter(asset => asset.chapterId === chapter.id)
      if (block.page.visual.kind !== 'none' && images.length === 0) throw new Error(`AUTHORED_REPORT_VISUAL_REQUIRED: ${block.page.id}`)
      if (images.some(asset => !/^[a-f0-9]{64}$/iu.test(asset.sha256) || !asset.sourcePath.trim()
        || !Number.isFinite(asset.width) || asset.width <= 0 || !Number.isFinite(asset.height) || asset.height <= 0)) {
        throw new Error(`AUTHORED_REPORT_MATERIAL_INVALID: ${block.page.id}`)
      }
    }
  }

  const professional = legacy.report.assets.filter(asset => ['map', 'diagram', 'chart'].includes(asset.role) || asset.analysisKind !== undefined)
  const professionalHashes = new Set(professional.map(asset => asset.sha256))
  const assets: ClientVisualAsset[] = authored.assets.filter(asset => !professionalHashes.has(asset.sha256)).map(asset => {
    const frozen = legacy.report.assets.find(candidate => candidate.sha256 === asset.sha256)
    // Preserve an explicitly required visual role, without reviving legacy product bindings.
    return frozen && profile.requiredVisualRoles.includes(frozen.role) ? { ...asset, role: frozen.role } : asset
  })
  const additions = new Map<string, ClientChapter[]>()
  const manuscriptPageIds = new Set(manuscript.chapters.flatMap(chapter => chapter.pages.map(page => page.id)))
  const authoredProjectChapters = authored.chapters.filter(chapter => chapter.blocks.some(block => block.type === 'planning-page' && manuscriptPageIds.has(block.page.id)))
  for (const asset of professional) {
    const oldChapter = legacy.report.chapters.find(chapter => chapter.id === asset.chapterId)
    const anchor = authoredProjectChapters.find(chapter => chapter.role === oldChapter?.role) ?? authoredProjectChapters.at(-1)
    if (!anchor) throw new Error('AUTHORED_REPORT_CHAPTERS_REQUIRED')
    const chapterId = `professional-${createHash('sha256').update(asset.assetId).digest('hex').slice(0, 16)}`
    const title = clientCopyText(asset.caption)
    if (!title) throw new Error(`AUTHORED_REPORT_VISUAL_TITLE_REQUIRED: ${asset.assetId}`)
    const sourceRefs = [...new Set([
      ...asset.provenance?.evidenceIds ?? [],
      ...anchor.blocks.flatMap(block => block.type === 'planning-page' ? block.page.sourceRefs : []),
    ])]
    const chapterTitle = asset.role === 'chart' ? '项目判断与实施测算' : '场地条件与空间组织'
    const page = {
      id: chapterId, kind: asset.role === 'chart' ? 'financial' as const : 'spatial' as const,
      title, claim: anchor.claim, body: [], sourceRefs,
      visual: { kind: 'diagram' as const, subject: title, purpose: anchor.claim, caption: title, sourceMaterialKey: asset.assetId },
      notes: [],
    }
    const chapter: ClientChapter = { id: chapterId, role: anchor.role, headline: title, claim: anchor.claim,
      blocks: [{ type: 'planning-page', page, chapterTitle }] }
    additions.set(anchor.id, [...additions.get(anchor.id) ?? [], chapter])
    const { productId: _legacyProductId, ...preserved } = asset
    assets.push({ ...preserved, caption: title, chapterId })
  }
  // Project source references are the authored evidence IDs. Raw evidence IDs from
  // workflow findings belong to a different namespace and cannot replace them.
  const products = authored.products.map(product => {
    const block = authored.chapters.flatMap(chapter => chapter.blocks).find(block => block.type === 'planning-page' && block.page.id === product.productId)
    if (block?.type !== 'planning-page') throw new Error(`AUTHORED_PRODUCT_PAGE_MISSING: ${product.productId}`)
    return { ...product, evidenceIds: block.page.sourceRefs }
  })
  const evidence = [...legacy.report.evidence]
  for (const record of authored.evidence) {
    const existing = evidence.find(candidate => candidate.evidenceId === record.evidenceId)
    if (existing && !isDeepStrictEqual(existing, record)) throw new Error(`AUTHORED_EVIDENCE_CONFLICT: ${record.evidenceId}`)
    if (!existing) evidence.push(record)
  }
  const report: ClientReport = {
    ...authored,
    chapters: authored.chapters.flatMap(chapter => [chapter, ...additions.get(chapter.id) ?? []]),
    products, evidence, assets, theme: legacy.report.theme,
    ...(legacy.report.visualContractVersion === undefined ? {} : { visualContractVersion: legacy.report.visualContractVersion }),
  }
  for (const chapter of authored.chapters) {
    if (chapter.blocks.some(block => block.type === 'planning-page' && block.page.visual.kind !== 'none')
      && !assets.some(asset => asset.chapterId === chapter.id)) throw new Error(`AUTHORED_REPORT_VISUAL_REQUIRED: ${chapter.id}`)
  }
  for (const role of profile.requiredVisualRoles) {
    if (!assets.some(asset => asset.role === role)) throw new Error(`missing required client visual role ${role}`)
  }
  return {
    report,
    identity: { ...legacy.identity, adoptedAssetIds: [...new Set([...legacy.identity.adoptedAssetIds, ...assets.map(asset => asset.assetId)])] },
    governanceAppendix: legacy.governanceAppendix,
  }
}

const RESEARCH_DECLARATIONS = ['研究范围（待核）', '非法定红线', '非测绘成果'] as const

export function createClientResearchPreviewBundle(
  input: FrozenProjectInput,
  profile: ClientProjectProfile,
): ClientResearchPreviewBundle {
  const boundary = input.siteBoundary
  const claims = profile.assetBindings.filter(binding => binding.analysisKind === 'site-boundary'
    || binding.cartography?.boundary === 'research'
    || binding.cartography?.boundary === 'confirmed')
  const assetId = boundary?.status === 'synthetic_research' ? boundary.assetId : undefined
  const assetSha256 = boundary?.status === 'synthetic_research' ? boundary.assetSha256 : undefined
  const frozenBoundaryAssets = assetId === undefined ? [] : input.visualAssets.filter(candidate => candidate.assetId === assetId)
  const asset = frozenBoundaryAssets[0]
  const binding = claims[0]
  const assetBindings = assetId === undefined ? [] : profile.assetBindings.filter(candidate => candidate.assetId === assetId)
  const valid = boundary?.status === 'synthetic_research'
    && isDeepStrictEqual(boundary.declarations, RESEARCH_DECLARATIONS)
    && typeof assetId === 'string' && assetId !== ''
    && typeof assetSha256 === 'string' && /^[a-f0-9]{64}$/iu.test(assetSha256)
    && frozenBoundaryAssets.length === 1 && asset !== undefined && asset.kind !== 'concept' && asset.sha256 === assetSha256
    && asset.width !== undefined && asset.height !== undefined
    && input.adoptedAssetIds !== undefined && !input.adoptedAssetIds.includes(assetId)
    && claims.length === 1 && assetBindings.length === 1 && binding === assetBindings[0]
    && binding.analysisKind === 'site-boundary' && binding.assetId === assetId
    && binding.sha256 === assetSha256 && binding.width === asset.width && binding.height === asset.height
    && binding.provenance?.sourceFileSha256 === assetSha256
    && binding.cartography?.boundary === 'research'
    && isDeepStrictEqual(binding.cartography.disclosures, RESEARCH_DECLARATIONS)
  if (!valid) throw new Error('SITE_BOUNDARY_RESEARCH_PREVIEW_CONFLICT：研究预览边界资产与冻结 synthetic 记录不一致。')
  const data = createClientReportBundleFromProfile(input, profile)
  const projectedBoundaries = data.report.assets.filter(candidate => candidate.analysisKind === 'site-boundary')
  if (projectedBoundaries.length !== 1 || projectedBoundaries[0]?.assetId !== assetId) {
    throw new Error('SITE_BOUNDARY_RESEARCH_PREVIEW_CONFLICT：研究预览必须且只能投影一个 synthetic 边界资产。')
  }
  const bundle = deepFreeze({
    kind: 'research_preview',
    publishable: false,
    researchBoundary: { boundaryId: boundary.boundaryId, assetId, assetSha256 },
    ...data,
  }) as ClientResearchPreviewBundle
  researchPreviewBundles.add(bundle)
  return bundle
}

export function isAuthenticClientReportBundle(value: unknown): value is ClientReportBundle {
  return value !== null && typeof value === 'object'
    && formalBundles.has(value)
    && (value as Partial<ClientReportBundle>).kind === 'formal'
    && (value as Partial<ClientReportBundle>).publishable === true
}

export function isAuthenticClientResearchPreviewBundle(value: unknown): value is ClientResearchPreviewBundle {
  return value !== null && typeof value === 'object'
    && researchPreviewBundles.has(value)
    && (value as Partial<ClientResearchPreviewBundle>).kind === 'research_preview'
    && (value as Partial<ClientResearchPreviewBundle>).publishable === false
}

export function assertPublishableClientReportBundle(value: unknown): asserts value is ClientReportBundle {
  if (!isAuthenticClientReportBundle(value)) {
    throw new Error('SITE_BOUNDARY_RESEARCH_PREVIEW_NOT_PUBLISHABLE：研究预览不得进入正式成果打包或发布。')
  }
}

function createClientReportBundleFromProfile(
  input: FrozenProjectInput,
  governedProfile: ClientProjectProfile,
): ClientReportBundleData {
  if (input.projectId !== governedProfile.identity.projectId) {
    throw new Error('client profile project does not match frozen project')
  }
  const sourceObjects = new Set(input.stateObjects.map(object => object.objectId))
  for (const chapter of governedProfile.chapters) {
    for (const objectId of chapter.sourceObjectIds) {
      if (!sourceObjects.has(objectId)) throw new Error('missing frozen object ' + objectId)
    }
  }

  const assets = bindClientAssets(input.visualAssets, governedProfile.assetBindings, input.siteBoundary)
  if (input.siteBoundary?.status === 'confirmed') {
    const boundaryAssets = assets.filter(asset => asset.analysisKind === 'site-boundary')
    if (boundaryAssets.length !== 1 || boundaryAssets[0]?.assetId !== input.siteBoundary.assetId) {
      throw new Error('SITE_BOUNDARY_PROFILE_CONFLICT：客户报告必须且只能绑定一个治理边界资产。')
    }
  }
  const presentRoles = new Set(assets.map(asset => asset.role))
  for (const role of governedProfile.requiredVisualRoles) {
    if (!presentRoles.has(role)) throw new Error('missing required client visual role ' + role)
  }

  return deepFreeze({
    report: {
      schemaVersion: 'preplan.client-report.v1',
      identity: governedProfile.identity,
      proposition: governedProfile.proposition,
      chapters: clientChapters(governedProfile),
      products: governedProfile.products,
      evidence: governedProfile.evidence,
      assets,
      theme: createClientTheme(governedProfile.themeOverrides),
      ...(governedProfile.visualContractVersion === undefined ? {} : { visualContractVersion: governedProfile.visualContractVersion }),
    },
    identity: {
      projectId: input.projectId,
      sourceRevision: input.revision,
      recommendationId: input.recommendationId ?? 'recommendation-r' + input.revision,
      adoptedAssetIds: [...(input.adoptedAssetIds ?? input.visualAssets.map(asset => asset.assetId))],
      ...(input.siteBoundary?.status === 'confirmed' && input.siteBoundary.integrityDigest !== undefined
        ? {
            siteBoundaryIntegrityDigest: input.siteBoundary.integrityDigest,
            siteBoundaryId: input.siteBoundary.boundaryId,
            siteBoundaryAssetId: input.siteBoundary.assetId,
            siteBoundaryAssetSha256: input.siteBoundary.assetSha256,
            ...(input.siteBoundary.geometrySha256 === undefined ? {} : { siteBoundaryGeometrySha256: input.siteBoundary.geometrySha256 }),
          }
        : {}),
    },
    governanceAppendix: {
      sourceRevision: input.revision,
      gateDecisions: [...input.gates],
      workflowCounts: {
        total: input.stateObjects.length,
        completed: input.stateObjects.length,
        blocked: input.gates.filter(gate => gate.decision === 'blocked').length,
      },
    },
  })
}
