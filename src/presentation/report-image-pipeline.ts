import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AgentClassService } from '../agent-classes/service.ts'
import type { FrozenProjectInput } from '../report/types.ts'
import { manuscriptSourceFingerprint } from '../report/manuscript/source.ts'
import { sceneRequirements } from '../report/manuscript/visual-scenes.ts'
import { SCENE_SPEC_VERSION, sceneSpecContext, type SceneSpecContext } from '../report/manuscript/scene-spec.ts'
import { compileClientReportOutline } from './projector/client-outline.ts'
import type { PresentationAdoptedAssetInput } from './standard-project-types.ts'
import { createConditionalReportBundle, planConditionalPages, type ConditionalReportMaterial } from '../report/conditional-report.ts'
import { auditRegularVisuals, assertRegularVisuals } from '../report/regular/visual-audit.ts'
import { regularImageGeometry } from '../report/regular/layout.ts'
import { caseStudyPhotos } from '../report/case-studies/pages.ts'
import { allocateReportImages, type ReviewedImageCandidate } from './report-image-allocation.ts'
import { ImageIdentityIndex } from '../visual/image-identity.ts'
import { normalizeReportRaster } from '../visual/report-raster.ts'
import { projectImageSourceContext } from './project-image-provenance.ts'
import { validateCachedWebImage, type CasePublicationSource } from '../visual/web-image-source.ts'
import { ImageInspectionAgent, readImageInspection, saveImageInspection, imageSourceContextHash, type ImageInspectionSourceContext } from '../visual/image-inspection.ts'
import { imageBriefHash, imagePlacementHash, permitsInternationalImages, MAX_ORIGINAL_IMAGE_USES, REPORT_IMAGE_POLICY_VERSION, type ImageInspection, type ImageSlotBrief } from '../visual/image-policy.ts'

const sha = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')
const FULL_IMAGE = `${REPORT_IMAGE_POLICY_VERSION}:full-original`
export interface ReportImageDemand {
  readonly brief: ImageSlotBrief; readonly findingId: string; readonly sceneKey?: string; readonly sourceMaterialKey?: string
  readonly sceneContext?: SceneSpecContext
  readonly caseSource?: { readonly caseId: string; readonly name: string; readonly location: string; readonly mediaPurpose: string; readonly publicationSources?: readonly CasePublicationSource[] }
}
export function reportImageDemands(input: FrozenProjectInput): ReportImageDemand[] {
  const scenes = sceneRequirements(input), locale = permitsInternationalImages(input) ? 'international' : 'domestic'
  const demands: ReportImageDemand[] = [], casePhotos = input.caseStudies ? caseStudyPhotos(input.caseStudies) : []
  for (const finding of compileClientReportOutline(input)) {
    const page = finding.manuscriptPage
    if (!page) continue
    const sourcePage = input.manuscript?.chapters.flatMap(chapter => chapter.pages).find(original => original.id === page.id) ?? page
    const matches = scenes.filter(scene => scene.brief.pageId === page.id)
    if (matches.length) { demands.push(...matches.map(scene => ({ brief: scene.brief, findingId: finding.findingId, sceneKey: scene.sceneKey,
      sceneContext: sceneSpecContext(sourcePage, scene.brief.id, scene.brief.nodeId) }))); continue }
    const casePhoto = casePhotos.find(photo => photo.sourceKey === page.visual.sourceMaterialKey)
    const scale = casePhoto?.analysisScale ?? 'scene'
    const caseRow = casePhoto ? input.caseStudies?.cases.find(row => row.caseId === casePhoto.caseId) : undefined
    demands.push({ findingId: finding.findingId, sourceMaterialKey: page.visual.sourceMaterialKey,
      ...(caseRow && casePhoto ? { caseSource: { caseId: caseRow.caseId, name: caseRow.name, location: caseRow.location, mediaPurpose: casePhoto.mediaPurpose,
        publicationSources: casePhoto.locationEvidence.filter(evidence => evidence.sourceUrl === casePhoto.image.sourcePageUrl)
          .map(evidence => ({ sourcePageUrl: evidence.sourceUrl, evidenceExcerpt: evidence.excerpt, registeredImageUrl: casePhoto.image.sourceUrl })) } } : {}), brief: {
      id: `${page.id}:main`, pageId: page.id, version: REPORT_IMAGE_POLICY_VERSION, conclusion: page.claim, subjects: [page.visual.subject],
      activities: [page.visual.purpose], environment: page.title, scale,
      allowedKinds: scale === 'line' ? ['plan','map','composite'] : ['photo','plan','map','section','diagram','composite'],
      allowedSources: ['project','web'], locale,
    } })
  }
  const coverPage = input.manuscript?.chapters.find(ch => ch.id === 'positioning')?.pages.find(p => p.visual.kind === 'concept')
    ?? input.manuscript?.chapters.flatMap(ch => ch.pages).find(page => scenes.some(scene => scene.brief.pageId === page.id && !scene.brief.nodeId))
  const coverScene = coverPage?.visual.subject
    ?? scenes.find(s => !s.brief.nodeId)?.brief.subjects[0] ?? input.projectName
  demands.push({ findingId: 'report:cover', ...(coverPage ? { sceneContext: sceneSpecContext(coverPage, 'cover:main') } : {}),
    brief: { id: 'cover:main', pageId: 'cover', version: REPORT_IMAGE_POLICY_VERSION, conclusion: input.recommendation,
    subjects: [coverScene], activities: [input.recommendation], environment: input.projectName, scale: 'area',
    allowedKinds: ['photo','render'], allowedSources: ['project','web','generated'], locale } })
  return demands
}
function fingerprint(input: FrozenProjectInput) { return sha(JSON.stringify({ policy: REPORT_IMAGE_POLICY_VERSION, scenePolicy: SCENE_SPEC_VERSION, source: manuscriptSourceFingerprint(input),
  caseStudies: input.caseStudies?.caseStudiesFingerprint, demands: reportImageDemands(input) })) }
function sourceKind(asset: PresentationAdoptedAssetInput): 'project' | 'web' | 'generated' {
  if (asset.semanticRole === 'concept_visual') return 'generated'
  return /web-reference|case-reference/u.test(asset.origin.method) ? 'web' : 'project'
}
function inspectionSource(asset: PresentationAdoptedAssetInput & { readonly sha256?: string }, project: FrozenProjectInput): ImageInspectionSourceContext {
  let method: Record<string, any> = {}
  try { method = JSON.parse(asset.origin.method) } catch { /* old provenance is not location proof */ }
  const location = asset.imageQuality?.sourceLocation
  const verified = !!location && ((method.kind === 'case-reference' && Array.isArray(method.locationEvidence) && method.locationEvidence.length > 0)
    || (method.sourceClaims?.sourceLocation?.status === 'supported' && method.sourceClaims.sourceLocation.value === location))
  const projectSource = projectImageSourceContext(asset, project)
  return { sourceType: sourceKind(asset), sourceLocation: projectSource?.sourceLocation ?? location,
    sourceLocationVerified: projectSource?.sourceLocationVerified ?? verified,
    sourceEvidenceHash: sha(asset.imagePreparation ? JSON.stringify([asset.origin.method, asset.imagePreparation]) : asset.origin.method) }
}
function explicitlyBound(asset: PresentationAdoptedAssetInput, demand: ReportImageDemand): boolean {
  return asset.pageBindings?.some(b => b.findingId === demand.findingId && (!demand.brief.nodeId || b.nodeIds?.includes(demand.brief.nodeId))) === true
}
function score(asset: PresentationAdoptedAssetInput, demand: ReportImageDemand): number {
  if (!demand.brief.allowedSources.includes(sourceKind(asset))) return -1
  if (demand.sourceMaterialKey) return [asset.sourceKey, ...(asset.aliases ?? [])].some(key => key === demand.sourceMaterialKey || key === `client-source:${demand.sourceMaterialKey}`) ? 10000 : -1
  const explicit = explicitlyBound(asset, demand)
  // Provenance includes exclusions, unrelated page prose and administrative rules.
  // Only a display label or previously pixel-verified subjects can aid recall.
  const verified = asset.imageQuality?.inspection
  const labels = [asset.displayName, ...(verified?.actualImageInput && verified.decision === 'approved' ? verified.matchedSubjects : [])]
  const haystack = labels.flatMap(label => label.split(/[，,。；;\n]/u)).filter(label => !/禁止|不得|不画|避开|排除|未包含|不包含/u.test(label)).join('；')
  const grams = new Set(demand.brief.subjects.flatMap(value => Array.from(value).slice(0, -1).map((_, i) => value.slice(i, i + 2))).filter(g => /[\p{L}]{2}/u.test(g)))
  const match = [...grams].filter(word => haystack.includes(word)).length
  return (explicit ? 1000 : 0) + match
}
export interface GeneratedReportImage { readonly material: PresentationAdoptedAssetInput; readonly adopt: () => Promise<void> }
interface PipelineDependencies {
  readonly classes: AgentClassService
  readonly inspection: ImageInspectionAgent
  readonly resolveDemands?: (demands: readonly ReportImageDemand[], parent: Agent, signal: AbortSignal, input: FrozenProjectInput, root: string) => Promise<readonly ReportImageDemand[]>
  readonly candidates: (input: FrozenProjectInput, root: string, signal: AbortSignal) => Promise<readonly PresentationAdoptedAssetInput[]>
  readonly search?: (demand: ReportImageDemand, parent: Agent, signal: AbortSignal, input: FrozenProjectInput, root: string) => Promise<readonly PresentationAdoptedAssetInput[]>
  readonly recover?: (demand: ReportImageDemand, parent: Agent, signal: AbortSignal, input: FrozenProjectInput, root: string) => Promise<GeneratedReportImage | undefined>
  readonly generate?: (demand: ReportImageDemand, parent: Agent, signal: AbortSignal, input: FrozenProjectInput, root: string) => Promise<GeneratedReportImage>
}
interface SavedPlan { readonly version: string; readonly fingerprint: string; readonly projectId: string; readonly materials: readonly ConditionalReportMaterial[] }
async function atomicJson(path: string, value: unknown) { const temp = `${path}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2) + '\n'); await rename(temp, path) }

/** Finite source-first replenishment followed by validation of actual physical pages. */
export class ReportImagePipeline {
  private readonly running = new Map<string, Promise<readonly ConditionalReportMaterial[]>>()
  constructor(private readonly dependencies: PipelineDependencies) {}
  async load(input: FrozenProjectInput, root: string, signal: AbortSignal = AbortSignal.timeout(30_000)): Promise<readonly ConditionalReportMaterial[] | undefined> {
    try {
      const saved = JSON.parse(await readFile(join(root, '.pre-design', 'report-image-plan.json'), 'utf8')) as SavedPlan
      if (saved.version !== REPORT_IMAGE_POLICY_VERSION || saved.projectId !== input.projectId || saved.fingerprint !== fingerprint(input)) return undefined
      for (const material of saved.materials) {
        signal.throwIfAborted()
        if (material.imagePreparation && (material.imagePreparation.version !== 'report-raster-v1'
          || sha(await readFile(material.imagePreparation.sourcePath)) !== material.imagePreparation.sourceSha256)) return undefined
        if (sourceKind(material) === 'web' && /web-reference/u.test(material.origin.method)
          && !await validateCachedWebImage({ ...material, sourcePath: material.imagePreparation?.sourcePath ?? material.sourcePath }, { root, signal })) return undefined
        const bytes = await readFile(material.sourcePath)
        if (sha(bytes) !== material.sha256 || material.imageIdentity?.fileSha256 !== material.sha256) return undefined
        const quality = material.imageQuality, review = quality?.inspection
        if (!quality?.requirement || !review) return undefined
        const verified = await readImageInspection(root, material.sha256, quality.requirement, review.placementHash, this.dependencies.classes, inspectionSource(material, input))
        if (!verified || JSON.stringify(verified) !== JSON.stringify(review)) return undefined
      }
      const bundle = createConditionalReportBundle(input, saved.materials), plan = planConditionalPages(bundle, 'html')
      assertRegularVisuals(plan, bundle.report, { requireInspectedImages: true })
      return saved.materials
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined; throw error }
  }
  prepare(input: FrozenProjectInput, root: string, parent: Agent, signal: AbortSignal, assertCurrent: () => void, options: { readonly maxGenerations?: number } = {}): Promise<readonly ConditionalReportMaterial[]> {
    const key = `${root}\0${fingerprint(input)}`
    const existing = this.running.get(key); if (existing) return existing
    const operation = this.prepareOnce(input, root, parent, signal, assertCurrent, options.maxGenerations ?? Infinity).finally(() => this.running.delete(key))
    this.running.set(key, operation); return operation
  }
  private async prepareOnce(input: FrozenProjectInput, root: string, parent: Agent, signal: AbortSignal, assertCurrent: () => void, maxGenerations: number): Promise<readonly ConditionalReportMaterial[]> {
    assertCurrent(); signal.throwIfAborted()
    if (maxGenerations !== Infinity && (!Number.isInteger(maxGenerations) || maxGenerations < 0)) throw new Error('REPORT_IMAGE_GENERATION_LIMIT_INVALID')
    const cached = await this.load(input, root, signal); if (cached) return cached
    if (!this.dependencies.classes.settings().routes.review) throw new Error('IMAGE_REVIEW_MODEL_REQUIRED: 请在全局子Agent设置选择支持图片输入的素材审图模型；未启动补图或新模型任务。')
    const initialDemands = reportImageDemands(input)
    const demands = [...(await this.dependencies.resolveDemands?.(initialDemands, parent, signal, input, root) ?? initialDemands)]
      .sort((a,b) => Number(!!b.sourceMaterialKey) - Number(!!a.sourceMaterialKey) || a.brief.id.localeCompare(b.brief.id))
    assertCurrent(); signal.throwIfAborted()
    const directory = join(root, '.pre-design'), attempts = join(directory, 'image-review-attempts')
    await mkdir(attempts, { recursive: true })
    const index = new ImageIdentityIndex(), decoded = new Map<string, ConditionalReportMaterial>(), candidates: ConditionalReportMaterial[] = [], reviewed: ReviewedImageCandidate[] = []
    const preparedHashes = new Map<string, string>()
    const ingest = async (assets: readonly PresentationAdoptedAssetInput[]) => {
      assertCurrent(); signal.throwIfAborted()
      for (const original of [...assets].sort((a,b) => (b.widthPx ?? 0) * (b.heightPx ?? 0) - (a.widthPx ?? 0) * (a.heightPx ?? 0))) {
        assertCurrent(); signal.throwIfAborted()
        if (!['image/jpeg','image/png'].includes(original.mimeType)) continue
        const originalBytes = await readFile(original.sourcePath)
        let prepared: Awaited<ReturnType<typeof normalizeReportRaster>>
        try { prepared = await normalizeReportRaster({ bytes: originalBytes, mimeType: original.mimeType as 'image/png' | 'image/jpeg', signal }) }
        catch (error) { signal.throwIfAborted(); if (error instanceof Error && error.message.startsWith('REPORT_RASTER_')) continue; throw error }
        const bytes = prepared.bytes, digest = sha(bytes)
        preparedHashes.set(prepared.sourceSha256, digest)
        let asset = original
        if (prepared.normalized) {
          const cacheRoot = join(directory, 'report-rasters'), extension = prepared.mimeType === 'image/png' ? 'png' : 'jpg'
          const name = `${prepared.sourceSha256}-${digest}.${extension}`, sourcePath = join(cacheRoot, name)
          await mkdir(cacheRoot, { recursive: true })
          try { await writeFile(sourcePath, bytes, { flag: 'wx', signal }) }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
          if (sha(await readFile(sourcePath)) !== digest) throw new Error('REPORT_RASTER_CACHE_CHANGED')
          asset = { ...original, sourcePath, originalFileName: name, mimeType: prepared.mimeType,
            imagePreparation: { version: 'report-raster-v1', sourcePath: original.sourcePath, sourceSha256: prepared.sourceSha256 } }
        }
        let known = decoded.get(digest)
        if (!known) {
          const claimedParent = asset.imageIdentity?.derivedFromSha256
          const result = await index.identifyAsync({ bytes, mimeType: asset.mimeType as 'image/png' | 'image/jpeg',
            ...(claimedParent ? { derivedFromSha256: preparedHashes.get(claimedParent) ?? claimedParent } : {}) }, signal)
          if (result.reason === 'index-capacity') throw new Error('REPORT_IMAGE_IDENTITY_CAPACITY: 原图核验容量已满，停止补图以避免产生无法分配的付费素材')
          if (result.status !== 'identified' || !result.identity || Math.min(result.width ?? 0, result.height ?? 0) < 256 || Math.max(result.width ?? 0, result.height ?? 0) < 640) continue
          known = { ...asset, imageIdentity: result.identity, widthPx: result.width, heightPx: result.height, sha256: digest }; decoded.set(digest, known)
        }
        const next = { ...asset, sha256: digest, imageIdentity: known.imageIdentity, widthPx: known.widthPx, heightPx: known.heightPx }
        const position = candidates.findIndex(c => c.sourceKey === asset.sourceKey), previous = candidates[position]
        if (!previous) candidates.push(next)
        else if (previous.sha256 === digest && imageSourceContextHash(inspectionSource(previous, input)) === imageSourceContextHash(inspectionSource(next, input))) {
          candidates[position] = { ...next, aliases: [...new Set([...(previous.aliases ?? []), ...(next.aliases ?? [])])],
            pageBindings: [...new Map([...(previous.pageBindings ?? []), ...(next.pageBindings ?? [])].map(binding => [JSON.stringify(binding), binding])).values()] }
        } else {
          candidates[position] = next
          for (let i = reviewed.length - 1; i >= 0; i--) if (reviewed[i]!.material.sourceKey.startsWith(`${asset.sourceKey}:usage:`)) reviewed.splice(i, 1)
        }
      }
    }
    await ingest(await this.dependencies.candidates(input, root, signal))
    const gaps: { id: string; reason: string }[] = []
    const review = async (asset: ConditionalReportMaterial, requested: readonly ReportImageDemand[]) => {
      const route = this.dependencies.classes.settings().routes.review
      const records = requested.map(demand => ({ demand, attempt: join(attempts, `${sha(JSON.stringify([asset.sha256, imageBriefHash(demand.brief), imageSourceContextHash(inspectionSource(asset, input)), route]))}.json`) }))
      for (const { attempt } of records) {
        try {
          const record = JSON.parse(await readFile(attempt, 'utf8'))
          if (record.status !== 'not-started') throw new Error('IMAGE_REVIEW_ATTEMPT_REQUIRES_ATTENTION: 同一素材和需求的模型请求已有记录，需核查原任务；未自动重试。')
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
      assertCurrent(); signal.throwIfAborted()
      for (const { demand, attempt } of records) await atomicJson(attempt, { status: 'starting', sha256: asset.sha256, requirementHash: imageBriefHash(demand.brief), route, startedAt: new Date().toISOString() })
      try {
        const results = await this.dependencies.inspection.inspect(parent, { projectId: input.projectId, bytes: await readFile(asset.sourcePath), mimeType: asset.mimeType as 'image/png' | 'image/jpeg',
          slots: requested.map(demand => ({ brief: demand.brief, placementHash: FULL_IMAGE })), ...inspectionSource(asset, input), sourceContext: asset.origin.method }, signal)
        for (const { demand, attempt } of records) {
          const result = results.find(result => result.usageId === demand.brief.id)
          if (!result) throw new Error('IMAGE_REVIEW_EMPTY')
          await saveImageInspection(root, demand.brief, result); await atomicJson(attempt, { status: 'completed', executionId: result.executionId })
        }
        return results
      } catch (error) {
        const message = error instanceof Error ? error.message : 'failed'
        const notStarted = /^(?:PREPLANNING_MODEL_(?:TURN_LIMIT|BUDGET_INVALID)|MODEL_UNAVAILABLE):/u.test(message)
        for (const { attempt } of records) await atomicJson(attempt, { status: notStarted ? 'not-started' : 'failed-or-unknown', message })
        throw error
      }
    }
    const tested = new Set<string>(), cachedPairs = new Set<string>()
    const searched = new Set<string>(), generated = new Set<string>()
    const pair = (asset: ConditionalReportMaterial, demand: ReportImageDemand) => `${asset.sha256}:${imageBriefHash(demand.brief)}:${imageSourceContextHash(inspectionSource(asset, input))}`
    const remember = (asset: ConditionalReportMaterial, demand: ReportImageDemand, inspection: ImageInspection) => {
      tested.add(pair(asset, demand))
      if (inspection.decision !== 'approved' || reviewed.some(c => c.usageId === demand.brief.id && c.material.imageIdentity?.fileSha256 === asset.sha256
        && c.material.imageQuality?.inspection?.sourceContextHash === inspection.sourceContextHash)) return
      reviewed.push({ usageId: demand.brief.id, source: sourceKind(asset), material: {
        ...asset, sourceKey: `${asset.sourceKey}:usage:${sha(demand.brief.id).slice(0, 16)}`, pageBindingOnly: true,
        pageBindings: [{ findingId: demand.findingId, role: 'primary', ...(demand.brief.nodeId ? { nodeIds: [demand.brief.nodeId] } : {}) }],
        imageQuality: { ...asset.imageQuality, contentKind: inspection.contentKind, essentialBounds: inspection.essentialBounds, requirement: demand.brief, inspection },
      } })
    }
    const allocation = () => allocateReportImages(demands.map(d => d.brief), reviewed)
    const acquisitionTargets = new Map<string, Set<string>>(), acquisitionWindows = new Map<string, Set<string>>()
    const requestedFor = (asset: ConditionalReportMaterial, demand: ReportImageDemand) => acquisitionTargets.get(asset.sourceKey)?.has(demand.brief.id) === true
    const recallScore = (asset: ConditionalReportMaterial, demand: ReportImageDemand) => {
      const value = score(asset, demand)
      // Explicit acquisition targets survive alternate labels of the same file;
      // a forbidden source or unmatched source-material key still cannot pass.
      return value < 0 ? value : value + (requestedFor(asset, demand) ? 1000 : 0)
    }
    const targetAcquisition = (asset: PresentationAdoptedAssetInput, id: string) => {
      const targets = acquisitionTargets.get(asset.sourceKey) ?? new Set<string>()
      targets.add(id); acquisitionTargets.set(asset.sourceKey, targets)
    }
    const pool = (demand: ReportImageDemand) => {
      const order = { project: 0, web: 1, generated: 2 }
      return candidates.filter(c => recallScore(c, demand) > 0).sort((a,b) => order[sourceKind(a)] - order[sourceKind(b)] || recallScore(b,demand) - recallScore(a,demand))
    }
    const restoreReviews = async () => {
      for (const demand of demands) for (const asset of pool(demand)) {
        const key = pair(asset, demand); if (cachedPairs.has(key)) continue
        cachedPairs.add(key); signal.throwIfAborted()
        const cached = await readImageInspection(root, asset.sha256, demand.brief, FULL_IMAGE, this.dependencies.classes, inspectionSource(asset, input))
        if (cached) remember(asset, demand, cached)
      }
    }
    const considered = new Set<string>(), inFlight = new Set<string>()
    const frontiers = new Map<ReturnType<typeof sourceKind>, Map<ConditionalReportMaterial, ReportImageDemand[]>>()
    // Follow only approved edges that are blocked by original-family or page
    // capacity. An alternative for an unrelated assigned position cannot fill a gap.
    const relocationTargets = (state: ReturnType<typeof allocation>): Set<string> => {
      const parents = new Map<string, string>()
      const rootOf = (key: string): string => {
        const parent = parents.get(key)
        if (!parent) { parents.set(key, key); return key }
        if (parent === key) return key
        const root = rootOf(parent); parents.set(key, root); return root
      }
      const union = (a: string, b: string) => { const x = rootOf(a), y = rootOf(b); if (x !== y) parents.set(y, x) }
      for (const candidate of reviewed) {
        const identity = candidate.material.imageIdentity!
        union(`original:${identity.originalId}`, `sha:${identity.fileSha256}`)
        if (identity.derivedFromSha256 && ['verified-derivative', 'declared-derivative'].includes(identity.verification)) union(`sha:${identity.fileSha256}`, `sha:${identity.derivedFromSha256}`)
      }
      const family = (candidate: ReviewedImageCandidate) => rootOf(`sha:${candidate.material.imageIdentity!.fileSha256}`)
      const page = new Map(demands.map(demand => [demand.brief.id, demand.brief.pageId]))
      const reachable = new Set(state.gaps.map(brief => brief.id)), queue = [...reachable], alternatives = new Set<string>()
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const usageId = queue[cursor]!
        for (const candidate of reviewed.filter(candidate => candidate.usageId === usageId)) {
          const holders = state.assigned.filter(assigned => family(assigned) === family(candidate))
          const blocked = holders.length >= MAX_ORIGINAL_IMAGE_USES ? holders : holders.filter(holder => page.get(holder.usageId) === page.get(usageId))
          for (const holder of blocked) if (!reachable.has(holder.usageId)) {
            reachable.add(holder.usageId); alternatives.add(holder.usageId); queue.push(holder.usageId)
          }
        }
      }
      return alternatives
    }
    const resolveExisting = async () => {
      await restoreReviews()
      let progressed = true
      while (progressed && allocation().gaps.length) {
        progressed = false
        for (const source of ['project', 'web', 'generated'] as const) {
          signal.throwIfAborted(); assertCurrent()
          if (!allocation().gaps.length) return
          const pending = frontiers.get(source) ?? new Map<ConditionalReportMaterial, ReportImageDemand[]>()
          frontiers.set(source, pending)
          for (const demand of demands) {
            const fresh = pool(demand).filter(asset => sourceKind(asset) === source && !considered.has(pair(asset, demand)))
            for (const asset of fresh) considered.add(pair(asset, demand))
            const selected = fresh.filter((asset, index) => index < 6 || requestedFor(asset, demand) || explicitlyBound(asset, demand) || !!demand.sourceMaterialKey)
            for (const asset of selected) {
              if (tested.has(pair(asset, demand))) continue
              const batch = pending.get(asset) ?? []; batch.push(demand); pending.set(asset, batch)
            }
          }
          // A newly acquired image first gets one bounded discovery batch, with
          // its requested target ahead of lexical matches. Explicit bindings are
          // retained; unrelated assigned positions never join this discovery set.
          for (const [asset, remaining] of pending) {
            const target = acquisitionTargets.get(asset.sourceKey)
            const key = `${asset.sha256}:${imageSourceContextHash(inspectionSource(asset, input))}`
            if (!target || acquisitionWindows.has(key)) continue
            const missing = new Set(allocation().gaps.map(brief => brief.id))
            const relevant = remaining.filter(demand => missing.has(demand.brief.id))
              .sort((a, b) => Number(target.has(b.brief.id)) - Number(target.has(a.brief.id))
                || Number(explicitlyBound(asset, b)) - Number(explicitlyBound(asset, a)) || score(asset, b) - score(asset, a))
            acquisitionWindows.set(key, new Set(relevant.filter((demand, index) => index < 8 || target.has(demand.brief.id) || explicitlyBound(asset, demand)).map(demand => demand.brief.id)))
          }
          while (pending.size && allocation().gaps.length) {
            signal.throwIfAborted(); assertCurrent()
            const state = allocation(), missing = new Set(state.gaps.map(brief => brief.id))
            const available = (asset: ConditionalReportMaterial, demand: ReportImageDemand) => !tested.has(pair(asset, demand)) && !inFlight.has(pair(asset, demand))
            const direct = (asset: ConditionalReportMaterial, demand: ReportImageDemand) => {
              const window = acquisitionWindows.get(`${asset.sha256}:${imageSourceContextHash(inspectionSource(asset, input))}`)
              // Continuations are new physical requirements, not a rescan of the
              // original discovery set; late explicit bindings remain eligible too.
              return missing.has(demand.brief.id) && (!window || window.has(demand.brief.id) || requestedFor(asset, demand) || explicitlyBound(asset, demand)
                || demand.brief.id.startsWith(`${demand.brief.pageId}:continuation:`))
            }
            const hasDirect = [...pending].some(([asset, remaining]) => remaining.some(demand => available(asset, demand) && direct(asset, demand)))
            const alternatives = hasDirect ? new Set<string>() : relocationTargets(state)
            const eligible = (asset: ConditionalReportMaterial, demand: ReportImageDemand) => available(asset, demand)
              && (hasDirect ? direct(asset, demand) : alternatives.has(demand.brief.id))
            const entries = [...pending].sort(([a, ar], [b, br]) =>
              Number(br.some(d => eligible(b, d) && requestedFor(b, d))) - Number(ar.some(d => eligible(a, d) && requestedFor(a, d))))
            const wave: { asset: ConditionalReportMaterial; batch: ReportImageDemand[] }[] = []
            for (const [asset, remaining] of entries) {
              const batch = remaining.filter(demand => eligible(asset, demand)).sort((a, b) =>
                Number(requestedFor(asset, b)) - Number(requestedFor(asset, a))
                || Number(explicitlyBound(asset, b)) - Number(explicitlyBound(asset, a))).slice(0, 8)
              const claimed = new Set(batch)
              const rest = remaining.filter(demand => !claimed.has(demand) && available(asset, demand))
              if (rest.length) pending.set(asset, rest); else pending.delete(asset)
              if (!batch.length) continue
              // Synchronous claim before any awaited work prevents overlapping pairs.
              for (const demand of batch) inFlight.add(pair(asset, demand))
              wave.push({ asset, batch })
              if (wave.length === 5) break
            }
            if (!wave.length) break
            progressed = true
            const settled = await Promise.allSettled(wave.map(async ({ asset, batch }) => {
              try { signal.throwIfAborted(); assertCurrent(); return await review(asset, batch) }
              finally { for (const demand of batch) inFlight.delete(pair(asset, demand)) }
            }))
            // Every started call settles before allocation, another wave or error propagation.
            for (const [i, result] of settled.entries()) if (result.status === 'fulfilled') {
              const { asset, batch } = wave[i]!
              for (const inspection of result.value) remember(asset, batch.find(d => d.brief.id === inspection.usageId)!, inspection)
            }
            const failure = settled.find(result => result.status === 'rejected')
            if (failure?.status === 'rejected') throw failure.reason
            signal.throwIfAborted(); assertCurrent()
          }
        }
      }
    }
    const recovered = new Set<string>(), adopted = new Set<string>()
    const ingestGenerated = async (demand: ReportImageDemand, result: GeneratedReportImage) => {
      targetAcquisition(result.material, demand.brief.id)
      await ingest([{ ...result.material, pageBindings: [{ findingId: demand.findingId,
        ...(demand.brief.nodeId ? { nodeIds: [demand.brief.nodeId] } : {}) }] }])
    }
    const adoptAssigned = async (results: readonly GeneratedReportImage[]) => {
      for (const result of results) {
        assertCurrent(); signal.throwIfAborted()
        const digest = sha(await readFile(result.material.sourcePath))
        if (!adopted.has(digest) && allocation().assigned.some(candidate => candidate.material.imageIdentity?.fileSha256 === digest
          || candidate.material.imagePreparation?.sourceSha256 === digest)) {
          await result.adopt(); adopted.add(digest)
        }
      }
    }
    const saveGaps = async (error?: unknown) => atomicJson(join(directory, 'report-image-gaps.json'), {
      version: REPORT_IMAGE_POLICY_VERSION, fingerprint: fingerprint(input),
      gaps: error ? allocation().gaps.map(brief => ({ id: brief.id, reason: '素材准备中断，此位置尚未分配合格素材' })) : gaps,
      ...(error ? { error: error instanceof Error ? error.message : '素材准备失败', status: 'incomplete' } : {}),
    })
    const replenishOnce = async () => {
      // Completed native images survive a failed sibling and are recovered before
      // any new acquisition, including when this export disables new generation.
      const available: GeneratedReportImage[] = []
      if (this.dependencies.recover) for (const demand of demands) {
        assertCurrent(); signal.throwIfAborted()
        if (recovered.has(demand.brief.id)) continue
        recovered.add(demand.brief.id)
        const result = await this.dependencies.recover(demand, parent, signal, input, root)
        if (result) { await ingestGenerated(demand, result); available.push(result) }
      }
      await resolveExisting()
      await adoptAssigned(available)
      const missing = allocation().gaps
      // Retrieval, generation and inspection use separate waves. No wave overlaps
      // another, so the five-child limit also holds across capability classes.
      // Source ingestion and allocation remain serial to preserve identity/capacity.
      for (let offset = 0; offset < missing.length; offset += 5) {
        const openIds = new Set(allocation().gaps.map(brief => brief.id))
        const wave = missing.slice(offset, offset + 5).filter(brief => openIds.has(brief.id))
          .map(brief => demands.find(demand => demand.brief.id === brief.id)!)
        const searches = wave.filter(demand => (!demand.sourceMaterialKey || demand.caseSource)
          && this.dependencies.search && !searched.has(demand.brief.id))
        for (const demand of searches) searched.add(demand.brief.id)
        if (searches.length) {
          const results = await Promise.allSettled(searches.map(async demand => {
            assertCurrent(); signal.throwIfAborted()
            return { demand, assets: await this.dependencies.search!(demand, parent, signal, input, root) }
          }))
          const failure = results.find(result => result.status === 'rejected')
          assertCurrent(); signal.throwIfAborted()
          for (const result of results) if (result.status === 'fulfilled') {
            for (const asset of result.value.assets) targetAcquisition(asset, result.value.demand.brief.id)
            await ingest(result.value.assets)
          }
          await resolveExisting()
          if (failure?.status === 'rejected') throw failure.reason
        }
        const remainingIds = new Set(allocation().gaps.map(brief => brief.id))
        const generation = wave.filter(demand => remainingIds.has(demand.brief.id)
          && demand.brief.allowedSources.includes('generated') && this.dependencies.generate && !generated.has(demand.brief.id))
          .slice(0, Math.max(0, maxGenerations - generated.size))
        // Reserve the whole wave before starting asynchronous calls.
        for (const demand of generation) generated.add(demand.brief.id)
        if (generation.length) {
          const results = await Promise.allSettled(generation.map(async demand => {
            assertCurrent(); signal.throwIfAborted()
            return { demand, result: await this.dependencies.generate!(demand, parent, signal, input, root) }
          }))
          const failure = results.find(result => result.status === 'rejected')
          assertCurrent(); signal.throwIfAborted()
          const completed = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
          for (const { demand, result } of completed) await ingestGenerated(demand, result)
          await resolveExisting()
          await adoptAssigned(completed.map(row => row.result))
          if (failure?.status === 'rejected') throw failure.reason
        }
      }
      for (const brief of allocation().gaps) gaps.push({ id: brief.id, reason: '无满足内容、质量、来源和原图使用次数要求的素材' })
    }
    const replenish = async () => {
      try { await replenishOnce() }
      catch (error) {
        // Retain a diagnostic of unassigned positions before propagating failure.
        if (!signal.aborted) { assertCurrent(); await saveGaps(error) }
        throw error
      }
    }
    const selectedMaterials = () => allocation().assigned.map(c => ({ ...c.material, sha256: c.material.imageIdentity!.fileSha256 }))
    await replenish()
    let materials: ConditionalReportMaterial[] = selectedMaterials()
    if (gaps.length) { await saveGaps(); throw new Error(`REPORT_IMAGE_GAPS: ${gaps.length} 个位置待补充合格素材，详见资料缺口记录。`) }
    // Page overflow is resolved through actual layout, never by duplicating a background.
    for (let round = 0; round < 3; round++) {
      const bundle = createConditionalReportBundle(input, materials), plan = planConditionalPages(bundle, 'html')
      const missing = auditRegularVisuals(plan, bundle.report).materialGaps
      if (!missing.length) break
      for (const gap of missing) {
        const base = demands.find(d => d.brief.pageId === gap.pageId && !d.brief.nodeId) ?? demands.find(d => d.brief.pageId === gap.pageId)
        if (!base) { gaps.push({ id: gap.pageId, reason: gap.reason }); continue }
        if (gap.reason !== 'continuation-image-required') { gaps.push({ id: gap.pageId, reason: gap.reason }); continue }
        const number = demands.filter(d => d.brief.id.startsWith(`${gap.pageId}:continuation:`)).length + 1
        const { nodeId: _node, ...brief } = base.brief
        const demand = { ...base, brief: { ...brief, id: `${gap.pageId}:continuation:${number}` } }
        demands.push(demand)
      }
      if (gaps.length) break
      await replenish(); materials = selectedMaterials()
    }
    if (gaps.length) { await saveGaps(); throw new Error(`REPORT_IMAGE_GAPS: ${gaps.length} 个续页缺少合格素材`) }
    const bundle = createConditionalReportBundle(input, materials), plan = planConditionalPages(bundle, 'html'), placed: ConditionalReportMaterial[] = []
    const pending = auditRegularVisuals(plan, bundle.report).materialGaps
    if (pending.length) {
      gaps.push(...pending.map(gap => ({ id: gap.pageId, reason: gap.reason }))); await saveGaps()
      throw new Error('REPORT_IMAGE_GAPS: 有限补图后仍存在实际页面缺图，未发布不完整结果')
    }
    const physicalUses = new Map<string, number>(), physicalPages = new Map<string, Set<string>>()
    for (const page of plan.pages) for (const [mediaIndex, placement] of (page.regularLayout?.media ?? []).entries()) {
      const asset = bundle.report.assets.find(a => a.assetId === placement.assetId)!
      const material = materials.find(m => m.sha256 === asset.sha256 && m.imageQuality?.requirement?.id === asset.imageQuality?.requirement?.id)
      if (!material?.imageQuality?.inspection || !material.imageQuality.requirement) throw new Error('IMAGE_REVIEW_BINDING_MISSING')
      const original = material.imageIdentity!.originalId, pageOriginals = physicalPages.get(page.pageId) ?? new Set<string>()
      if ((physicalUses.get(original) ?? 0) >= 2 || pageOriginals.has(original)) {
        gaps.push({ id: page.pageId, reason: '实际排版重复使用了已分配原图，需重新分页或分配' }); continue
      }
      const geometry = regularImageGeometry({ ...asset, width: material.widthPx!, height: material.heightPx!, imageQuality: material.imageQuality }, placement)
      if (placement.fit !== 'contain' && (geometry.retainedArea < 0.8 || !geometry.safeSubjects)) throw new Error('REPORT_IMAGE_UNSAFE_CROP')
      if (Math.min(material.widthPx! * geometry.source.width / geometry.visible.w, material.heightPx! * geometry.source.height / geometry.visible.h) < 96) throw new Error('REPORT_IMAGE_DISPLAY_RESOLUTION: 实际展示区域的原生像素不足')
      const fitted = { ...material.imageQuality!.inspection!, placementHash: imagePlacementHash(placement) }
      const originalId = material.imageIdentity!.originalId
      physicalUses.set(originalId, (physicalUses.get(originalId) ?? 0) + 1); pageOriginals.add(originalId); physicalPages.set(page.pageId, pageOriginals)
      await saveImageInspection(root, material.imageQuality!.requirement!, fitted)
      placed.push({ ...material, sourceKey: `${material.sourceKey}:physical:${page.pageId}:${mediaIndex}`, physicalPlacement: { pageId: page.pageId, mediaIndex }, imageQuality: { ...material.imageQuality, inspection: fitted } })
    }
    if (gaps.length) { await saveGaps(); throw new Error('REPORT_IMAGE_GAPS: 物理页面原图重复，需要更多合格素材') }
    const finalMaterials = [...materials, ...placed], finalBundle = createConditionalReportBundle(input, finalMaterials), finalPlan = planConditionalPages(finalBundle, 'html')
    assertRegularVisuals(finalPlan, finalBundle.report, { requireInspectedImages: true })
    assertCurrent(); signal.throwIfAborted()
    await atomicJson(join(directory, 'report-image-plan.json'), { version: REPORT_IMAGE_POLICY_VERSION, fingerprint: fingerprint(input), projectId: input.projectId, materials: finalMaterials } satisfies SavedPlan)
    await atomicJson(join(directory, 'report-image-audit.json'), auditRegularVisuals(finalPlan, finalBundle.report, { requireInspectedImages: true }))
    return finalMaterials
  }
}
