import { createClientTheme } from './theme.ts'
import type {
  ClientAssetBinding,
  ClientChapter,
  ClientProjectProfile,
  ClientReportBundle,
  ClientVisualAsset,
} from './client-types.ts'
import type { FrozenProjectInput, ReportAsset } from './types.ts'

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

function bindAsset(asset: ReportAsset, binding: ClientAssetBinding): ClientVisualAsset {
  return {
    assetId: asset.assetId,
    role: binding.role,
    chapterId: binding.chapterId,
    ...(binding.productId === undefined ? {} : { productId: binding.productId }),
    caption: asset.caption,
    sourceKind: sourceKind(asset),
    sourcePath: asset.sourcePath,
    sha256: binding.sha256,
    width: binding.width,
    height: binding.height,
    ...(binding.disclosure === undefined ? {} : { disclosure: binding.disclosure }),
  }
}

function bindClientAssets(
  assets: readonly ReportAsset[],
  bindings: readonly ClientAssetBinding[],
): ClientVisualAsset[] {
  const assetsById = new Map(assets.map(asset => [asset.assetId, asset]))
  const bindingsById = new Map(bindings.map(binding => [binding.assetId, binding]))

  for (const binding of bindings) {
    if (!assetsById.has(binding.assetId)) throw new Error('missing frozen visual asset ' + binding.assetId)
  }

  return assets.map(asset => {
    const binding = bindingsById.get(asset.assetId)
    if (binding === undefined) throw new Error('missing client asset binding ' + asset.assetId)
    return bindAsset(asset, binding)
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
): ClientReportBundle {
  if (input.projectId !== profile.identity.projectId) {
    throw new Error('client profile project does not match frozen project')
  }

  const sourceObjects = new Set(input.stateObjects.map(object => object.objectId))
  for (const chapter of profile.chapters) {
    for (const objectId of chapter.sourceObjectIds) {
      if (!sourceObjects.has(objectId)) throw new Error('missing frozen object ' + objectId)
    }
  }

  const assets = bindClientAssets(input.visualAssets, profile.assetBindings)
  const presentRoles = new Set(assets.map(asset => asset.role))
  for (const role of profile.requiredVisualRoles) {
    if (!presentRoles.has(role)) throw new Error('missing required client visual role ' + role)
  }

  return deepFreeze({
    report: {
      schemaVersion: 'preplan.client-report.v1',
      identity: profile.identity,
      proposition: profile.proposition,
      chapters: clientChapters(profile),
      products: profile.products,
      evidence: profile.evidence,
      assets,
      theme: createClientTheme(profile.themeOverrides),
    },
    identity: {
      projectId: input.projectId,
      sourceRevision: input.revision,
      recommendationId: input.recommendationId ?? 'recommendation-r' + input.revision,
      adoptedAssetIds: [...(input.adoptedAssetIds ?? input.visualAssets.map(asset => asset.assetId))],
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
