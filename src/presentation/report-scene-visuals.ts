import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import type { FrozenProjectInput } from '../report/types.ts'
import { sceneRequirements, sceneSemanticTopic, requiresSourceSceneImage, REPORT_SCENE_POLICY_VERSION, type ReportSceneRequirement } from '../report/manuscript/visual-scenes.ts'
import { verifiedRasterImageDimensions } from '../governance/site-boundary-asset-store.ts'
import { readPageVisualState, type PageVisualRequest } from './page-visual-state.ts'
import type { PresentationAdoptedAssetInput } from './standard-project-types.ts'

type Binding = NonNullable<PresentationAdoptedAssetInput['pageBindings']>[number]
export interface ReportSceneCoverage { readonly sceneKey: string; readonly assetSourceKey: string; readonly assetId: string }
interface SceneMetadata {
  policyVersion: string; projectId: string; sourceRevision: number; sourceFingerprint: string
  sceneKeys: string[]; baseBindings: readonly Binding[]
}
function originMethod(asset: PresentationAdoptedAssetInput): Record<string, unknown> {
  try { const value = JSON.parse(asset.origin.method); if (value && typeof value === 'object' && !Array.isArray(value)) return value } catch { /* legacy plain-text provenance */ }
  return { originalMethod: asset.origin.method }
}
function mergeBindings(bindings: readonly Binding[]): Binding[] {
  const merged = new Map<string, Binding>()
  for (const binding of bindings) {
    const before = merged.get(binding.findingId)
    const nodeIds = [...new Set([...(before?.nodeIds ?? []), ...(binding.nodeIds ?? [])])].sort()
    merged.set(binding.findingId, { findingId: binding.findingId, role: before?.role ?? binding.role ?? 'primary', ...(nodeIds.length ? { nodeIds } : {}) })
  }
  return [...merged.values()].sort((a, b) => a.findingId.localeCompare(b.findingId))
}
function clearSceneBindings(asset: PresentationAdoptedAssetInput): PresentationAdoptedAssetInput {
  const method = originMethod(asset), old = method.reportScenes as SceneMetadata | undefined
  if (!old) return asset
  const { reportScenes: _previousSceneBinding, ...original } = method
  return { ...asset, pageBindingOnly: true, pageBindings: old.baseBindings, origin: { ...asset.origin, method: JSON.stringify(original) } }
}

/** Rebinds verified, adopted concepts to real manuscript pages; never creates a synthetic standard page. */
export async function prepareReportSceneVisuals(input: { frozenProject: FrozenProjectInput; assets: readonly PresentationAdoptedAssetInput[];
  workspaceRoot?: string; requests?: readonly PageVisualRequest[] }): Promise<{
    assets: PresentationAdoptedAssetInput[]; requirements: readonly ReportSceneRequirement[]; coveredSceneKeys: string[];
    coverage: ReportSceneCoverage[]; warnings: string[];
  }> {
  const project = input.frozenProject, requirements = sceneRequirements(project), warnings: string[] = [], coverage: ReportSceneCoverage[] = []
  const pages = new Map((project.manuscript?.chapters.flatMap(chapter => chapter.pages) ?? []).map(page => [`manuscript:${page.id}`, page]))
  const protectSourceImages = (asset: PresentationAdoptedAssetInput): PresentationAdoptedAssetInput => asset.semanticRole !== 'concept_visual' || !asset.pageBindings ? asset : {
    ...asset, pageBindings: asset.pageBindings.filter(binding => {
      const page = pages.get(binding.findingId)
      return !page || !requiresSourceSceneImage(page) || (page.visual.kind !== 'source' && !!binding.nodeIds?.length)
    }),
  }
  if (!requirements.length) return { assets: input.assets.map(clearSceneBindings).map(protectSourceImages), requirements, coveredSceneKeys: [], coverage, warnings }
  const requests = input.requests ?? (input.workspaceRoot ? (await readPageVisualState(input.workspaceRoot, project.projectId)).requests : [])
  const adopted = new Set(project.adoptedAssetIds ?? project.visualAssets.map(asset => asset.assetId))
  const matches: { asset: PresentationAdoptedAssetInput; assetId: string; topics: Set<string>; exact: Set<string>; baseBindings: readonly Binding[]; method: Record<string, unknown> }[] = []
  for (const asset of input.assets) {
    if (!/^image\/(?:png|jpeg|webp)$/u.test(asset.mimeType) || asset.semanticRole !== 'concept_visual') continue
    const identities = new Set([asset.sourceKey, ...(asset.aliases ?? [])])
    const snapshot = project.visualAssets.find(item => identities.has(item.assetId) && item.kind === 'concept' && adopted.has(item.assetId))
    if (!snapshot) continue
    const ownRequests = requests.filter(request => request.status === 'adopted' && request.assetId === snapshot.assetId && !request.target)
    const method = originMethod(asset), prior = method.reportScenes as SceneMetadata | undefined
    const baseBindings = prior?.baseBindings ?? asset.pageBindings ?? []
    const topics = new Set<string>(), exact = new Set<string>()
    for (const request of ownRequests) {
      if (request.scene) {
        const expected = requirements.find(item => item.sceneKey === request.scene!.sceneKey)
        if (expected && request.scene.projectId === project.projectId && request.scene.sourceRevision === project.revision
          && request.scene.sourceFingerprint === expected.sourceFingerprint && request.scene.contentHash === expected.contentHash) exact.add(expected.sceneKey)
      } else {
        const page = pages.get(request.findingId ?? '')
        if (page?.visual.kind === 'concept' && !requiresSourceSceneImage(page)) topics.add(sceneSemanticTopic(project, page).topic)
      }
    }
    // Preserved material origins retain the original explicit page link if the sidecar is unavailable.
    if (!ownRequests.length && !requests.some(request => request.assetId === snapshot.assetId)) {
      for (const binding of baseBindings) {
        const page = pages.get(binding.findingId)
        if (page?.visual.kind === 'concept' && !requiresSourceSceneImage(page) && asset.origin.type.startsWith('generated_')) topics.add(sceneSemanticTopic(project, page).topic)
      }
    }
    if (!topics.size && !exact.size) continue
    try {
      const info = await lstat(asset.sourcePath)
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error('素材不是有效普通文件')
      const bytes = await readFile(asset.sourcePath), dimensions = verifiedRasterImageDimensions(asset.mimeType as 'image/png' | 'image/jpeg' | 'image/webp', bytes)
      if (snapshot.sha256 && createHash('sha256').update(bytes).digest('hex') !== snapshot.sha256) throw new Error('图像来源哈希不匹配')
      if ((asset.widthPx !== undefined && dimensions.width !== asset.widthPx) || (asset.heightPx !== undefined && dimensions.height !== asset.heightPx)) throw new Error('图像尺寸不匹配')
      matches.push({ asset, assetId: snapshot.assetId, topics, exact, baseBindings, method })
    } catch (error) { warnings.push(`REPORT_SCENE_IMAGE_UNAVAILABLE: ${asset.sourceKey}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  const selected = new Map<string, { item: typeof matches[number]; requirements: ReportSceneRequirement[] }>()
  const originalUses = new Map<string, number>(), originalPages = new Map<string, Set<string>>()
  for (const requirement of requirements) {
    // A broad topic suggests candidates; it never authorizes binding to another
    // page or to every node. Pixel inspection is handled by the report pipeline.
    const item = matches.find(item => {
      const original = item.asset.imageIdentity?.originalId ?? project.visualAssets.find(a => a.assetId === item.assetId)?.sha256 ?? item.asset.sourceKey
      return (item.exact.has(requirement.sceneKey) || (!requirement.brief.nodeId && item.baseBindings.some(b => b.findingId === `manuscript:${requirement.brief.pageId}` && !b.nodeIds?.length)))
        && (originalUses.get(original) ?? 0) < 2 && !originalPages.get(original)?.has(requirement.brief.pageId)
    })
    if (!item) continue
    const original = item.asset.imageIdentity?.originalId ?? project.visualAssets.find(a => a.assetId === item.assetId)?.sha256 ?? item.asset.sourceKey
    originalUses.set(original, (originalUses.get(original) ?? 0) + 1)
    const usedPages = originalPages.get(original) ?? new Set<string>(); usedPages.add(requirement.brief.pageId); originalPages.set(original, usedPages)
    const group = selected.get(item.asset.sourceKey) ?? { item, requirements: [] }
    group.requirements.push(requirement); selected.set(item.asset.sourceKey, group)
    coverage.push({ sceneKey: requirement.sceneKey, assetSourceKey: item.asset.sourceKey, assetId: item.assetId })
  }
  const assets = input.assets.map(asset => {
    const chosen = selected.get(asset.sourceKey)
    if (!chosen) return clearSceneBindings(asset)
    const bindings = chosen.requirements.flatMap(requirement => requirement.bindings.map(binding => ({ findingId: binding.findingId, role: 'primary' as const,
      ...(binding.nodeIds ? { nodeIds: binding.nodeIds } : {}) })))
    const reportScenes: SceneMetadata = { policyVersion: REPORT_SCENE_POLICY_VERSION, projectId: project.projectId, sourceRevision: project.revision,
      sourceFingerprint: chosen.requirements[0]!.sourceFingerprint, sceneKeys: chosen.requirements.map(item => item.sceneKey).sort(), baseBindings: chosen.item.baseBindings }
    return { ...asset, pageBindingOnly: true, pageBindings: mergeBindings([...chosen.item.baseBindings, ...bindings]),
      origin: { ...asset.origin, method: JSON.stringify({ ...chosen.item.method, pageBindingOnly: true, reportScenes }) } }
  })
  return { assets: assets.map(protectSourceImages), requirements, coveredSceneKeys: coverage.map(item => item.sceneKey), coverage, warnings }
}
