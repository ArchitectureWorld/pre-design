import { lstat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { sha256File } from './filesystem.ts'
import type { PresentationAdoptedAssetInput, PresentationSourceMaterialInput } from './standard-project-types.ts'

export type SourceVisualDerivationKind = 'archive' | 'pdf' | 'cad'

export interface SourceVisualMaterial extends PresentationSourceMaterialInput {
  /** A known contract ID may be supplied before projection; sourceKey is used otherwise. */
  readonly sourceMaterialId?: string
}

export interface SourceVisualDerivationPlan {
  readonly key: string
  readonly displayName: string
  readonly semanticRole: string
  readonly method: string
  readonly objectIds?: readonly string[]
  readonly evidenceIds?: readonly string[]
  readonly role?: PresentationAdoptedAssetInput['role']
  readonly pageBindings?: PresentationAdoptedAssetInput['pageBindings']
}

export interface SourceVisualDerivationOutput {
  readonly sourcePath: string
  readonly originalFileName: string
  readonly mimeType: string
  readonly widthPx: number
  readonly heightPx: number
  readonly durationMs?: number
}

export interface SourceVisualDerivationAdapter {
  readonly tool: { readonly name: string; readonly version: string }
  plan(input: { readonly kind: SourceVisualDerivationKind; readonly source: SourceVisualMaterial }): Promise<readonly SourceVisualDerivationPlan[]>
  derive(input: { readonly kind: SourceVisualDerivationKind; readonly source: SourceVisualMaterial; readonly plan: SourceVisualDerivationPlan }): Promise<SourceVisualDerivationOutput>
}

export interface DerivedVisualAssetRecord {
  /** Contract sourceMaterialIds when known; projection maps sourceMaterialKeys to final IDs. */
  readonly sourceMaterialIds: readonly string[]
  readonly mimeType: string
  readonly widthPx: number
  readonly heightPx: number
  readonly sha256: string
  readonly asset: PresentationAdoptedAssetInput
  readonly reused: boolean
}

export interface SourceVisualBlocker {
  readonly code: 'SOURCE_VISUAL_TOOL_UNAVAILABLE'
  readonly sourceMaterialId: string
  readonly sourceKey: string
  readonly kind: SourceVisualDerivationKind
  readonly message: string
}

export interface DeriveVisualAssetsFromSourcesInput {
  readonly sourceMaterials: readonly SourceVisualMaterial[]
  readonly existingAssets?: readonly PresentationAdoptedAssetInput[]
  readonly adapters?: Partial<Record<SourceVisualDerivationKind, SourceVisualDerivationAdapter>>
  readonly now?: () => string
}

export interface DeriveVisualAssetsFromSourcesResult {
  readonly assets: readonly PresentationAdoptedAssetInput[]
  readonly records: readonly DerivedVisualAssetRecord[]
  readonly blockers: readonly SourceVisualBlocker[]
}

const VISUAL_MIME_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/svg+xml': ['.svg'],
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov'],
}

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`)
}

function extension(value: string): string {
  return extname(value).toLowerCase()
}

function sourceKind(source: SourceVisualMaterial): SourceVisualDerivationKind | undefined {
  const sourceExtension = extension(source.originalFileName)
  const mimeType = source.mimeType.trim().toLowerCase()
  if (sourceExtension === '.pdf' || mimeType === 'application/pdf') return 'pdf'
  if (['.dwg', '.dxf'].includes(sourceExtension) || ['image/vnd.dwg', 'image/vnd.dxf', 'application/acad', 'application/dxf', 'application/x-dxf'].includes(mimeType)) return 'cad'
  if (['.rar', '.zip', '.7z'].includes(sourceExtension) || ['application/vnd.rar', 'application/x-rar-compressed', 'application/zip', 'application/x-7z-compressed'].includes(mimeType)) return 'archive'
  return undefined
}

function unavailableBlocker(source: SourceVisualMaterial, kind: SourceVisualDerivationKind): SourceVisualBlocker {
  const sourceMaterialId = source.sourceMaterialId ?? source.sourceKey
  const message = kind === 'cad'
    ? 'CAD source requires an injected renderer.'
    : kind === 'archive'
      ? 'Archive source requires an injected extractor/renderer.'
      : 'PDF source requires an injected renderer.'
  return { code: 'SOURCE_VISUAL_TOOL_UNAVAILABLE', sourceMaterialId, sourceKey: source.sourceKey, kind, message }
}

function validPlanKey(value: string): string {
  const normalized = value.normalize('NFC').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(normalized)) fail('SOURCE_VISUAL_PLAN_INVALID', 'plan key must be a portable identifier')
  return normalized
}

function uniqueStrings(values: readonly string[] | undefined): readonly string[] {
  return [...new Set((values ?? []).map(value => value.normalize('NFC').trim()).filter(Boolean))]
}

function derivedSourceKey(sourceKey: string, planKey: string): string {
  return `derived-source:${sourceKey.normalize('NFC').trim()}:${planKey}`
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail('SOURCE_VISUAL_OUTPUT_INVALID', `${field} must be a positive integer`)
}

async function inspectedOutput(output: SourceVisualDerivationOutput): Promise<{ readonly sha256: string }> {
  const mimeType = output.mimeType.trim().toLowerCase()
  const extensions = VISUAL_MIME_EXTENSIONS[mimeType]
  if (extensions === undefined || !extensions.includes(extension(output.originalFileName)) || !extensions.includes(extension(basename(output.sourcePath)))) {
    fail('SOURCE_VISUAL_OUTPUT_NOT_RENDERABLE', `output '${output.originalFileName}' is not a real image/video artifact`)
  }
  assertPositiveInteger(output.widthPx, 'widthPx')
  assertPositiveInteger(output.heightPx, 'heightPx')
  if (mimeType.startsWith('video/')) {
    const durationMs = output.durationMs
    if (!Number.isSafeInteger(durationMs) || durationMs === undefined || durationMs < 0) fail('SOURCE_VISUAL_OUTPUT_INVALID', 'video durationMs must be a non-negative integer')
  }
  const info = await lstat(output.sourcePath)
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0) fail('SOURCE_VISUAL_OUTPUT_INVALID', 'output must be a non-empty regular file')
  return { sha256: await sha256File(output.sourcePath) }
}

async function recordForExisting(asset: PresentationAdoptedAssetInput, source: SourceVisualMaterial): Promise<DerivedVisualAssetRecord> {
  if (asset.origin.type !== 'derived_source_material' || !asset.origin.sourceMaterialKeys.includes(source.sourceKey)) {
    fail('SOURCE_VISUAL_EXISTING_ASSET_CONFLICT', `existing asset '${asset.sourceKey}' does not belong to source '${source.sourceKey}'`)
  }
  const inspected = await inspectedOutput({ sourcePath: asset.sourcePath, originalFileName: asset.originalFileName, mimeType: asset.mimeType,
    widthPx: asset.widthPx ?? Number.NaN, heightPx: asset.heightPx ?? Number.NaN, durationMs: asset.durationMs })
  return { sourceMaterialIds: [source.sourceMaterialId ?? source.sourceKey], mimeType: asset.mimeType, widthPx: asset.widthPx!, heightPx: asset.heightPx!,
    sha256: inspected.sha256, asset, reused: true }
}

/**
 * Produces presentation-ready image/video inputs only through caller-provided extract/render tools.
 * Original PDFs, CAD files, archives, and data remain source materials; no fallback rasterization is attempted.
 */
export async function deriveVisualAssetsFromSources(input: DeriveVisualAssetsFromSourcesInput): Promise<DeriveVisualAssetsFromSourcesResult> {
  const existing = new Map((input.existingAssets ?? []).map(asset => [asset.sourceKey, asset]))
  const assets: PresentationAdoptedAssetInput[] = []
  const records: DerivedVisualAssetRecord[] = []
  const blockers: SourceVisualBlocker[] = []
  const createdAt = input.now?.() ?? new Date().toISOString()

  for (const source of input.sourceMaterials) {
    const kind = sourceKind(source)
    if (kind === undefined) continue
    const adapter = input.adapters?.[kind]
    if (adapter === undefined) {
      blockers.push(unavailableBlocker(source, kind))
      continue
    }
    const plans = await adapter.plan({ kind, source })
    const seenPlanKeys = new Set<string>()
    for (const plan of plans) {
      const planKey = validPlanKey(plan.key)
      if (seenPlanKeys.has(planKey)) fail('SOURCE_VISUAL_PLAN_INVALID', `duplicate plan key '${planKey}' for '${source.sourceKey}'`)
      seenPlanKeys.add(planKey)
      const key = derivedSourceKey(source.sourceKey, planKey)
      const prior = existing.get(key)
      if (prior !== undefined) {
        const record = await recordForExisting(prior, source)
        assets.push(prior)
        records.push(record)
        continue
      }
      const output = await adapter.derive({ kind, source, plan })
      const inspected = await inspectedOutput(output)
      const mimeType = output.mimeType.trim().toLowerCase()
      const asset: PresentationAdoptedAssetInput = {
        sourceKey: key,
        sourcePath: output.sourcePath,
        displayName: plan.displayName.normalize('NFC').trim(),
        originalFileName: output.originalFileName.normalize('NFC').trim(),
        mimeType,
        semanticRole: plan.semanticRole.normalize('NFC').trim(),
        widthPx: output.widthPx,
        heightPx: output.heightPx,
        ...(output.durationMs === undefined ? {} : { durationMs: output.durationMs }),
        createdAt,
        adoptedAt: createdAt,
        origin: { type: 'derived_source_material', sourceMaterialKeys: [source.sourceKey], parentAssetKeys: [], method: plan.method.normalize('NFC').trim(), sourceTool: adapter.tool },
        objectIds: uniqueStrings(plan.objectIds),
        evidenceIds: uniqueStrings(plan.evidenceIds),
        ...(plan.role === undefined ? {} : { role: plan.role }),
        ...(plan.pageBindings === undefined ? {} : { pageBindings: plan.pageBindings }),
      }
      assets.push(asset)
      records.push({ sourceMaterialIds: [source.sourceMaterialId ?? source.sourceKey], mimeType, widthPx: output.widthPx, heightPx: output.heightPx,
        sha256: inspected.sha256, asset, reused: false })
    }
  }
  return { assets, records, blockers }
}
