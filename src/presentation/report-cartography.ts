import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { ClientEvidence } from '../report/client-types.ts'
import type { FrozenProjectInput } from '../report/types.ts'
import { makeSourceIndex, manuscriptSourceFingerprint } from '../report/manuscript/source.ts'
import { createPublicMapProviders, planningLocationEvidenceFromSources, preparePlanningAnalysis, resolvePlanningLocation } from '../report/cartography/index.ts'
import type { AnalysisEvidence, AnalysisGap, AnalysisNode, PlanningAnalysisDependencies, PlanningLocationEvidence, PlanningLocationResolution, PlanningLocationResolverDependencies } from '../report/cartography/types.ts'
import type { ReportImageDemand } from './report-image-pipeline.ts'
import type { PresentationAdoptedAssetInput } from './standard-project-types.ts'
import { sha256CanonicalJson } from './canonical-json.ts'

const VERSION = 'report-cartography-2026-09-21.4'
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
type Dependencies = PlanningAnalysisDependencies & PlanningLocationResolverDependencies
type Prepare = (demand: ReportImageDemand, input: FrozenProjectInput, root: string, signal: AbortSignal) => Promise<readonly PresentationAdoptedAssetInput[]>
interface CacheRecord {
  readonly version: string
  readonly projectId: string
  readonly sourceFingerprint: string
  readonly demandHash: string
  readonly createdAt: string
  readonly files: readonly { readonly path: string; readonly sha256: string }[]
  readonly materials: readonly PresentationAdoptedAssetInput[]
}
interface LocationCache {
  readonly result: PlanningLocationResolution
  readonly files: readonly { readonly path: string; readonly sha256: string }[]
}

/** Isolated report helper: failures are recorded here and do not abort unrelated images. */
export function createReportCartographyPreparer(dependencies: Dependencies = {}): Prepare {
  const providers = createPublicMapProviders(dependencies)
  const running = new Map<string, Promise<readonly PresentationAdoptedAssetInput[]>>()
  const resolved = new Map<string, Promise<LocationCache>>()
  const now = dependencies.now ?? (() => new Date())

  const prepare: Prepare = async (demand, input, root, signal) => {
    signal.throwIfAborted()
    if (!demand.analysis) return []
    const directory = join(resolve(root), '.pre-design', 'report-cartography')
    const fingerprint = manuscriptSourceFingerprint(input)
    const demandHash = sha256CanonicalJson(JSON.parse(JSON.stringify({ version: VERSION, analysis: demand.analysis, findingId: demand.findingId, brief: demand.brief, slot: demand.slot })))
    const cacheKey = hash(`${input.projectId}:${fingerprint}:${demandHash}`), runningKey = `${directory}:${cacheKey}`
    const existing = running.get(runningKey)
    if (existing) return existing
    const work = (async (): Promise<readonly PresentationAdoptedAssetInput[]> => {
      const issues = join(directory, 'issues')
      const record = async (stage: string, gaps: readonly AnalysisGap[], evidencePath?: string) => {
        await mkdir(issues, { recursive: true })
        await writeFile(join(issues, `${cacheKey}-${randomUUID()}.json`), JSON.stringify({ version: VERSION, projectId: input.projectId,
          sourceFingerprint: fingerprint, demandHash, findingId: demand.findingId, stage, at: now().toISOString(), gaps, evidencePath }, null, 2), { flag: 'wx' })
      }
      try {
        await mkdir(directory, { recursive: true })
        const cachePath = join(directory, `${cacheKey}.cache.json`)
        const cached = await loadCache(cachePath, directory, input.projectId, fingerprint, demandHash, demand, now(), signal)
        if (cached) return cached
        const sourceIndex = makeSourceIndex(input)
        const locationSources = sourceIndex.filter(source => isProjectLocationPath(source.fieldPath)
          || (/^facts\[\d+\]$/.test(source.fieldPath) && /^(?:项目位置|地理位置|项目区位|项目所在地|建设地址|空间位置|所在地|项目地址)[：:]/.test(source.text)))
        if (!locationSources.length) {
          await record('source-location', [{ code: 'LOCATION_EVIDENCE_MISSING', message: '正式来源字段中未找到项目位置；生成场景、资源与竞品的地点不作为项目位置', blocking: true }])
          return []
        }
        const nameSources = sourceIndex.filter(source => /^(?:data\.)?(?:canonical_?name|project_?name|project\.name|site_?name)$/i.test(source.fieldPath))
        const canonicalRows = nameSources.filter(source => /canonical_?name$/i.test(source.fieldPath))
        const preferredNames = canonicalRows.length ? canonicalRows : nameSources
        const names = [...new Set(preferredNames.map(source => sourceName(source.text)).filter(Boolean))]
        if (names.length > 1) {
          await record('source-name', [{ code: 'PROJECT_NAME_CONFLICT', message: '正式项目名称字段存在冲突，未用工作区标识或排序猜测地名', blocking: true }])
          return []
        }
        const canonicalName = names[0] ?? input.projectName
        const snapshot = JSON.stringify({ projectId: input.projectId, projectName: input.projectName, canonicalName, sourceFingerprint: fingerprint, names: nameSources, locations: locationSources }, null, 2)
        const snapshotHash = hash(snapshot), snapshotPath = join(directory, `source-${snapshotHash}.json`)
        await writeImmutable(snapshotPath, snapshot, snapshotHash)
        const locationEvidence = planningLocationEvidenceFromSources(locationSources.map(source => ({ role: 'project-location' as const,
          text: `项目名称：${canonicalName}。${source.text}`, placeName: canonicalName, contextTerms: administrativeTerms(source.text),
          source: { label: `项目正式位置资料 ${source.objectId} / ${source.fieldPath}`, locator: `${snapshotPath}#${encodeURIComponent(source.id)}`, sha256: snapshotHash,
            observedAt: input.generatedAt, methodology: source.basis || '来源于冻结项目正式位置字段' } })))
        const resolutionKey = `${directory}:${fingerprint}`
        const acquireLocation = async (): Promise<LocationCache> => {
          const result = await resolvePlanningLocation({ projectName: canonicalName, evidence: locationEvidence, outputDirectory: directory, signal }, dependencies)
          const paths = [...result.receiptPaths, ...(result.manifestPath ? [result.manifestPath] : [])]
          return { result, files: await Promise.all(paths.map(async path => ({ path, sha256: hash(await readFile(path, { signal })) }))) }
        }
        let locationWork = resolved.get(resolutionKey)
        if (!locationWork) {
          locationWork = acquireLocation()
          resolved.set(resolutionKey, locationWork)
          locationWork.catch(() => resolved.delete(resolutionKey))
        }
        let locationCache = await locationWork
        const receiptsIntact = await Promise.all(locationCache.files.map(async file => {
          try { return hash(await readFile(file.path, { signal })) === file.sha256 } catch (error) { if (signal.aborted) throw error; return false }
        }))
        if (receiptsIntact.some(valid => !valid)) {
          const refreshed = acquireLocation()
          resolved.set(resolutionKey, refreshed)
          refreshed.catch(() => resolved.delete(resolutionKey))
          locationCache = await refreshed
        }
        const location = locationCache.result
        if (!location.location) {
          resolved.delete(resolutionKey)
          await record('resolve-location', location.gaps, location.manifestPath)
          return []
        }
        const geographicFiles = [...location.receiptPaths, ...(location.manifestPath ? [location.manifestPath] : [])]
        const nodes: AnalysisNode[] = []
        // Only administrative places named in the original position statement become
        // contextual nodes. They are not presumed customers, attractions or competitors.
        const primaryEvidence = locationEvidence[0]
        const terms = primaryEvidence.contextTerms ?? []
        const candidates = terms.map((name, index) => ({ name, index })).filter(({ name }) => /市$|区$|县$|county$|city$/i.test(name)).reverse()
        const closeScale = demand.analysis!.scale === 'site' || demand.analysis!.scale === 'node' || demand.analysis!.scale === 'scene'
        const nodeCandidates = closeScale ? [] : demand.analysis!.kind === 'accessibility' ? candidates.slice(0, 1) : candidates.slice(0, 2)
        for (const { name, index } of nodeCandidates) {
          if (name === canonicalName) continue
          const contextTerms = terms.slice(0, index)
          if (!contextTerms.length) continue
          const nodeEvidence: PlanningLocationEvidence = { text: primaryEvidence.text, placeName: name, contextTerms, source: primaryEvidence.source }
          const node = await resolvePlanningLocation({ projectName: name, evidence: [nodeEvidence], outputDirectory: directory, signal }, dependencies)
          geographicFiles.push(...node.receiptPaths, ...(node.manifestPath ? [node.manifestPath] : []))
          if (node.location && node.location.id !== location.location.id) nodes.push({ ...node.location, label: `${node.location.label}（公开地图代表点）`, role: /市$/.test(name) ? 'city' : 'settlement' })
          else if (node.gaps.length) await record('resolve-context-node', node.gaps, node.manifestPath)
        }
        const analysis = await preparePlanningAnalysis({ projectId: input.projectId, pageId: demand.findingId, title: demand.analysis!.title,
          question: demand.brief.subjects.join('；'), kind: demand.analysis!.kind, outputDirectory: directory, location: location.location, nodes,
          requiredEvidence: demand.analysis!.requiredEvidence, signal,
          minimumExtentKm: demand.analysis!.scale === 'node' || demand.analysis!.scale === 'scene' ? 1 : 3,
          routeRequests: demand.analysis!.kind === 'accessibility' ? nodes.map(node => ({ fromId: node.id, toId: location.location!.id })) : [],
        }, { ...providers, ...dependencies })
        if (analysis.gaps.length) await record('analysis-evidence', analysis.gaps, analysis.manifestPath)
        // A geographical backdrop must not close an unsupported audience/competitor or
        // driving claim. Other imagery continues; the issue receipt exposes the gap.
        if (analysis.status !== 'ready') return []
        const clientEvidence = toClientEvidence(analysis.evidence, now().toISOString())
        const materials: PresentationAdoptedAssetInput[] = []
        const files: { path: string; sha256: string }[] = [{ path: snapshotPath, sha256: snapshotHash }]
        for (const path of geographicFiles) files.push({ path, sha256: hash(await readFile(path, { signal })) })
        for (const asset of analysis.assets) {
          const metadataBytes = await readFile(asset.metadataPath, { signal }), metadataHash = hash(metadataBytes), metadata = JSON.parse(metadataBytes.toString('utf8'))
          files.push({ path: asset.adoptedAsset.sourcePath, sha256: asset.sha256 }, { path: asset.metadataPath, sha256: metadataHash },
            { path: metadata.attributionHtmlPath, sha256: hash(await readFile(metadata.attributionHtmlPath, { signal })) },
            ...metadata.receipts.map((receipt: { path: string; sha256: string }) => ({ path: receipt.path, sha256: receipt.sha256 })))
          materials.push({ ...asset.adoptedAsset, origin: { ...asset.adoptedAsset.origin, method: verifiedMapMethod(asset.metadataPath, metadataHash, metadata) },
            pageBindings: [{ findingId: demand.findingId, role: 'primary' }], analysisKind: asset.analysisKind, cartography: asset.cartography,
            analysisEvidence: clientEvidence, analysisEvidencePath: asset.metadataPath,
            provenance: { sourceLabel: '真实地图 / 位置 / 路网分析证据', sourceDate: now().toISOString().slice(0, 10), locator: asset.metadataPath, sourceFileSha256: metadataHash,
              evidenceIds: clientEvidence.map(item => item.evidenceId) },
            imageQuality: { contentKind: 'map', sourceLocation: location.location.label, essentialBounds: [{ x: 0, y: 0, width: 1, height: 1 }], requirement: demand.brief } })
        }
        signal.throwIfAborted()
        const saved: CacheRecord = { version: VERSION, projectId: input.projectId, sourceFingerprint: fingerprint, demandHash, createdAt: now().toISOString(), files, materials }
        const temporaryPath = `${cachePath}.${randomUUID()}.tmp`
        await writeFile(temporaryPath, JSON.stringify(saved, null, 2), { flag: 'wx' }); await rename(temporaryPath, cachePath)
        return materials
      } catch (error) {
        if (signal.aborted) throw error
        await record('cartography-helper', [{ code: 'CARTOGRAPHY_PREPARATION_FAILED', message: error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : '真实地图获取或证据校验失败', blocking: true }]).catch(() => {})
        return []
      }
    })()
    running.set(runningKey, work)
    try { return await work } finally { running.delete(runningKey) }
  }
  return prepare
}

export const prepareReportCartography: Prepare = createReportCartographyPreparer()

function isProjectLocationPath(path: string): boolean {
  return /^(?:data\.)?(?:location|project_?location|site_?location|geographical_?location|project_?address|site_?address|address)(?:\.(?:text|description|address))?$/i.test(path)
}

function sourceName(text: string): string {
  const value = text.replace(/^(?:项目规范名称|项目名称|规范名称|项目名|场地名称|canonical\s+name|project\s+name)\s*[:：]\s*/i, '').split(/[；;\n]/u)[0].replace(/[。\s]+$/u, '').trim()
  return value.length <= 100 ? value : ''
}

function verifiedMapMethod(metadataPath: string, metadataHash: string, metadata: { kind: string; locations: { label: string; source: { locator: string }; wgs84: { longitude: number; latitude: number } }[]; attributionHtmlPath: string }): string {
  const location = metadata.locations[0]
  return JSON.stringify({ kind: 'verified-geographic-analysis', analysisKind: metadata.kind, evidencePath: metadataPath, evidenceSha256: metadataHash,
    attributionHtmlPath: metadata.attributionHtmlPath,
    sourceClaims: { sourceLocation: { status: 'supported', value: location.label, evidencePath: metadataPath, evidenceSha256: metadataHash,
      sourceLocator: location.source.locator, coordinate: location.wgs84, coordinateSystem: 'EPSG:4326',
      method: '正式项目名称与位置资料共同检索并核验公开地理要素；原始响应及地图证据已归档校验' } } })
}

function administrativeTerms(text: string): string[] {
  const statement = text.split(/[。；;\n]/u)[0].replace(/^[^：:]{0,12}[：:]/u, '').replace(/^(?:项目)?(?:位于|位处|坐落于)/u, '')
  const chinese = statement.match(/[\p{Script=Han}]{2,8}?(?:特别行政区|自治区|自治州|省|市|区|县)/gu) ?? []
  if (chinese.length) return [...new Set(chinese)].slice(0, 4)
  // A comma-separated international address remains explicit source text. No inferred
  // country, geocoder bias or default-China coordinate is inserted.
  const international = statement.split(/[,，]/).map(value => value.trim()).filter(value => /^[A-Za-zÀ-ž][A-Za-zÀ-ž .'-]{1,60}$/.test(value))
  return [...new Set(international)].slice(-3)
}

async function writeImmutable(path: string, text: string, expectedHash: string): Promise<void> {
  try { await writeFile(path, text, { flag: 'wx' }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if (hash(await readFile(path)) !== expectedHash) throw new Error('CARTOGRAPHY_SOURCE_SNAPSHOT_MISMATCH')
  }
}

function toClientEvidence(evidence: readonly AnalysisEvidence[], fallbackDate: string): ClientEvidence[] {
  return evidence.map(item => ({ evidenceId: item.evidenceId, kind: item.kind === 'distance' || item.kind === 'route' ? 'calculation' : 'fact',
    statement: item.statement, sourceLabel: item.source.label, sourceDate: item.source.observedAt ?? fallbackDate.slice(0, 10), locator: item.rawPath ?? item.source.locator,
    ...(item.source.methodology ? { assumption: item.source.methodology } : {}) }))
}

async function loadCache(path: string, directory: string, projectId: string, fingerprint: string, demandHash: string, demand: ReportImageDemand, now: Date, signal: AbortSignal): Promise<readonly PresentationAdoptedAssetInput[] | undefined> {
  try {
    const saved: CacheRecord = JSON.parse(await readFile(path, { encoding: 'utf8', signal }))
    const age = now.getTime() - Date.parse(saved.createdAt)
    if (saved.version !== VERSION || saved.projectId !== projectId || saved.sourceFingerprint !== fingerprint || saved.demandHash !== demandHash
      || !Number.isFinite(age) || age < -120000 || age > MAX_CACHE_AGE_MS || !Array.isArray(saved.files) || !Array.isArray(saved.materials) || !saved.materials.length) return
    const realDirectory = await realpath(directory)
    for (const file of saved.files) {
      if (!file || typeof file.path !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) return
      const actual = await realpath(file.path), inside = relative(realDirectory, actual)
      if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside) || hash(await readFile(actual, { signal })) !== file.sha256) return
    }
    for (const material of saved.materials) {
      const image = saved.files.find(file => file.path === material.sourcePath), evidence = saved.files.find(file => file.path === material.analysisEvidencePath)
      if (!image || !evidence || material.provenance?.sourceFileSha256 !== evidence.sha256 || !material.analysisKind || !material.cartography || !material.analysisEvidence?.length) return
      const metadata = JSON.parse(await readFile(evidence.path, { encoding: 'utf8', signal }))
      if (metadata.projectId !== projectId || metadata.pageId !== demand.findingId || metadata.title !== demand.analysis?.title || metadata.kind !== demand.analysis?.kind
        || metadata.sha256 !== image.sha256 || metadata.status !== 'ready' || metadata.gaps.length || material.semanticRole !== 'map'
        || material.pageBindingOnly !== true || !isDeepStrictEqual(material.pageBindings, [{ findingId: demand.findingId, role: 'primary' }])
        || !isDeepStrictEqual(material.analysisEvidence, toClientEvidence(metadata.evidence, metadata.createdAt))
        || !isDeepStrictEqual(material.cartography, metadata.cartography) || material.imageQuality?.contentKind !== 'map'
        || material.imageQuality.sourceLocation !== metadata.locations?.[0]?.label
        || material.origin.method !== verifiedMapMethod(evidence.path, evidence.sha256, metadata)
        || !isDeepStrictEqual(material.imageQuality?.requirement, demand.brief)) return
    }
    return saved.materials
  } catch (error) { if (signal.aborted) throw error; return }
}
