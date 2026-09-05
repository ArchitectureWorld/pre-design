import { lstat, readFile, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, win32 } from 'node:path'
import type { AssetRecord, SourceMaterialRecord } from '@architectureworld/presentation-contracts'
import type { FrozenProjectInput } from '../report/types.ts'
import { classifySourceMaterial } from './material-plan.ts'
import type { PresentationAdoptedAssetInput, PresentationSourceMaterialInput } from './standard-project-types.ts'

export const PRESENTATION_MATERIAL_REGISTRY_PATH = '.pre-design/materials.json'
type PageRole = NonNullable<PresentationAdoptedAssetInput['role']>
export interface RegisteredPresentationMaterial {
  readonly sourceKey: string
  readonly sourcePath: string
  readonly originalFileName?: string
  readonly displayName?: string
  readonly semanticRole?: string
  readonly mimeType: string
  readonly importedAt: string
  readonly aliases?: readonly string[]
  readonly evidenceIds?: readonly string[]
  readonly objectIds?: readonly string[]
  readonly role?: PageRole
  readonly metadata?: {
    readonly widthPx?: number; readonly heightPx?: number; readonly durationMs?: number
    readonly pageCount?: number; readonly rowCount?: number; readonly columnCount?: number
  }
  readonly pageBindings?: PresentationAdoptedAssetInput['pageBindings']
}
export interface PresentationMaterialRegistry {
  readonly version: 1
  readonly projectId: string
  readonly materials: readonly RegisteredPresentationMaterial[]
}
export interface PreparePresentationMaterialsInput {
  readonly frozenProject: FrozenProjectInput
  readonly workspaceRoot?: string
  readonly assets?: readonly PresentationAdoptedAssetInput[]
  readonly previous?: {
    readonly stableIds?: Readonly<Record<string, string>>
    readonly lastExportedFileHashes?: Readonly<Record<string, string>>
  }
}
export interface PreparedPresentationMaterials {
  readonly sourceMaterials: readonly PresentationSourceMaterialInput[]
  readonly assets: readonly PresentationAdoptedAssetInput[]
  readonly materialWarnings: readonly string[]
}

function fail(detail: string): never { throw new Error(`PRESENTATION_MATERIAL_REGISTRY_INVALID: ${detail}`) }
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('登记项必须是对象')
  return value as Record<string, unknown>
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '' || /[\u0000-\u001f]/u.test(value)) fail(`${name} 必须是有效非空文字`)
  return value.normalize('NFC').trim()
}
function strings(value: unknown, name: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail(`${name} 必须是数组`)
  return [...new Set(value.map(item => text(item, name)))]
}
function role(value: unknown): PageRole {
  if (!['primary', 'supporting', 'background', 'reference'].includes(String(value))) fail(`无效素材角色 ${String(value)}`)
  return value as PageRole
}
async function readOptional(path: string): Promise<unknown | undefined> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) fail(`登记或清单必须为普通文件：${path}`)
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
function within(root: string, path: string): boolean {
  const suffix = relative(root, path)
  return suffix !== '..' && !suffix.startsWith(`..${win32.sep}`) && !suffix.startsWith('../') && !isAbsolute(suffix)
}
async function registeredPath(root: string, value: string): Promise<string | undefined> {
  const absoluteInput = isAbsolute(value) || win32.isAbsolute(value)
  if (!absoluteInput && /^[a-z]+:/iu.test(value)) fail('原件路径必须是本地路径，不能使用 URL')
  const path = absoluteInput ? resolve(value) : resolve(root, value)
  if (!absoluteInput && !within(root, path)) fail(`相对原件路径越出工作区：${value}`)
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) fail(`原件必须为普通文件：${value}`)
    if (!absoluteInput && !within(await realpath(root), await realpath(path))) fail(`原件链接越出工作区：${value}`)
    return path
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
function metadataOf(value: unknown): NonNullable<RegisteredPresentationMaterial['metadata']> {
  if (value === undefined) return {}
  const record = object(value)
  const metadata: Record<string, number> = {}
  for (const key of ['widthPx', 'heightPx', 'durationMs', 'pageCount', 'rowCount', 'columnCount']) {
    if (record[key] === undefined) continue
    const number = record[key]
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0
      || (key !== 'durationMs' && !Number.isSafeInteger(number))
      || (key !== 'rowCount' && key !== 'columnCount' && number === 0)) fail(`${key} 必须是有效正数`)
    metadata[key] = number
  }
  return metadata
}
function ownedPath(root: string, path: string): string {
  const resolved = resolve(root, path)
  if (!within(root, resolved)) fail(`已有清单路径越出工作区：${path}`)
  return resolved
}
function keysByIdentity(keys: Readonly<Record<string, string>>, prefix: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const [key, id] of Object.entries(keys)) {
    if (!key.startsWith(prefix)) continue
    const aliases = result.get(id) ?? []
    aliases.push(key.slice(prefix.length))
    result.set(id, aliases)
  }
  return result
}

async function preserveImportedMaterials(
  input: PreparePresentationMaterialsInput,
  sources: Map<string, PresentationSourceMaterialInput>,
  assets: Map<string, PresentationAdoptedAssetInput>,
): Promise<void> {
  const root = input.workspaceRoot
  const hashes = input.previous?.lastExportedFileHashes
  if (root === undefined || hashes === undefined || Object.keys(hashes).length === 0) return
  const keys = input.previous?.stableIds ?? {}
  const sourceKeys = keysByIdentity(keys, 'sourceMaterial:source:')
  const assetKeys = keysByIdentity(keys, 'asset:asset:')
  const findingKeys = new Map(Object.entries(keys).filter(([key]) => key.startsWith('page:finding:')).map(([key, id]) => [id, key.slice('page:finding:'.length)]))
  const sourceDoc = await readOptional(join(root, 'source-materials/manifest.json')) as { materials?: SourceMaterialRecord[] } | undefined
  const assetDoc = await readOptional(join(root, 'assets/manifest.json')) as { assets?: AssetRecord[] } | undefined
  const pageDoc = await readOptional(join(root, 'pages/manifest.json')) as { pages?: { pageId: string; draftPath: string | null }[] } | undefined
  const pageBindings = new Map<string, { findingId: string; role: PageRole }[]>()
  for (const page of pageDoc?.pages ?? []) {
    const findingId = findingKeys.get(page.pageId)
    if (!findingId || !page.draftPath || hashes[page.draftPath] === undefined) continue
    const draft = await readOptional(ownedPath(root, page.draftPath)) as { pageAssets?: { pageAssetId: string; assetId: string; role: PageRole }[] } | undefined
    for (const link of draft?.pageAssets ?? []) {
      const candidates = assetKeys.get(link.assetId) ?? []
      if (candidates.length === 0) continue
      // Binary deduplication may share assetId, but each page link keeps its source-key identity.
      const sourceKey = candidates.find(candidate => keys[`pageAsset:finding:${findingId}:asset:${candidate}`] === link.pageAssetId)
        ?? (candidates.length === 1 ? candidates[0] : undefined)
      if (sourceKey === undefined) fail(`无法恢复页面素材 ${link.pageAssetId} 的原始来源键`)
      const bindings = pageBindings.get(sourceKey) ?? []
      bindings.push({ findingId, role: link.role })
      pageBindings.set(sourceKey, bindings)
    }
  }
  for (const record of sourceDoc?.materials ?? []) {
    if (hashes[record.relativePath] === undefined) continue
    for (const sourceKey of sourceKeys.get(record.sourceMaterialId) ?? []) {
      sources.set(sourceKey, { sourceKey, sourcePath: ownedPath(root, record.relativePath), originalFileName: record.originalFileName,
        mimeType: record.mimeType, importedAt: record.importedAt, status: record.status })
    }
  }
  for (const record of assetDoc?.assets ?? []) {
    if (hashes[record.relativePath] === undefined || record.adoptionStatus !== 'adopted') continue
    const refs = record.sourceRefs?.filter(ref => ref.provider === 'pre-design' && ref.sourceProjectId === input.frozenProject.projectId) ?? []
    for (const sourceKey of assetKeys.get(record.assetId) ?? []) {
      assets.set(sourceKey, { sourceKey, sourcePath: ownedPath(root, record.relativePath), originalFileName: basename(record.relativePath),
        displayName: record.displayName, mimeType: record.mimeType, semanticRole: record.semanticRole, ...record.metadata,
        createdAt: record.createdAt, adoptedAt: record.adoptedAt,
        objectIds: [...new Set(refs.flatMap(ref => ref.objectIds))], evidenceIds: [...new Set(refs.flatMap(ref => ref.evidenceIds))],
        aliases: [record.assetId], pageBindings: pageBindings.get(sourceKey) ?? [],
        origin: { ...record.origin, sourceMaterialKeys: record.origin.sourceMaterialIds.flatMap(id => sourceKeys.get(id) ?? fail(`无法恢复原件 ${id}`)),
          parentAssetKeys: record.origin.parentAssetIds.flatMap(id => assetKeys.get(id) ?? fail(`无法恢复父素材 ${id}`)) },
      })
    }
  }
}

/** Reads only the explicit registry and previously managed project files; it never scans originals. */
export async function preparePresentationMaterials(input: PreparePresentationMaterialsInput): Promise<PreparedPresentationMaterials> {
  const sources = new Map<string, PresentationSourceMaterialInput>()
  const assets = new Map<string, PresentationAdoptedAssetInput>()
  const warnings: string[] = []
  await preserveImportedMaterials(input, sources, assets)
  for (const asset of input.assets ?? []) assets.set(asset.sourceKey, asset)
  const root = input.workspaceRoot === undefined ? undefined : resolve(input.workspaceRoot)
  const raw = root === undefined ? undefined : await readOptional(join(root, PRESENTATION_MATERIAL_REGISTRY_PATH))
  if (raw !== undefined) {
    const registry = object(raw)
    if (registry.version !== 1 || registry.projectId !== input.frozenProject.projectId || !Array.isArray(registry.materials)) fail('登记版本、项目 ID 或 materials 无效')
    const seen = new Set<string>()
    for (const candidate of registry.materials) {
      const entry = object(candidate)
      const sourceKey = text(entry.sourceKey, 'sourceKey')
      if (seen.has(sourceKey)) fail(`sourceKey 重复：${sourceKey}`)
      seen.add(sourceKey)
      const path = text(entry.sourcePath, 'sourcePath')
      const currentOriginal = await registeredPath(root!, path)
      const previousSource = sources.get(sourceKey)
      const retainedCopy = currentOriginal === undefined && previousSource !== undefined
        ? await registeredPath(root!, previousSource.sourcePath) : undefined
      if (currentOriginal === undefined && previousSource !== undefined && retainedCopy === undefined) fail(`资料 ${sourceKey} 的登记原件和已导入副本均缺失，无法继续同步`)
      if (currentOriginal === undefined) {
        warnings.push(`资料“${sourceKey}”原件未找到：${path}${retainedCopy !== undefined ? '；保留此前导入的副本' : '；尚未进入项目及当页素材库'}`)
      }
      const sourcePath = currentOriginal ?? retainedCopy
      if (sourcePath === undefined) continue
      const mimeType = text(entry.mimeType, 'mimeType')
      const originalFileName = entry.originalFileName === undefined ? basename(sourcePath) : text(entry.originalFileName, 'originalFileName')
      const sourceCategory = classifySourceMaterial(originalFileName, mimeType)
      const importedAt = text(entry.importedAt, 'importedAt')
      if (!Number.isFinite(Date.parse(importedAt))) fail(`importedAt 无效：${sourceKey}`)
      const metadata = metadataOf(entry.metadata)
      if (mimeType.startsWith('image/') && sourceCategory !== 'drawings' && (metadata.widthPx === undefined || metadata.heightPx === undefined)) fail(`图片 ${sourceKey} 需要 widthPx 和 heightPx`)
      if ((mimeType.startsWith('video/') || mimeType.startsWith('audio/')) && metadata.durationMs === undefined) fail(`视频或音频 ${sourceKey} 需要 durationMs`)
      const pageBindings = entry.pageBindings === undefined ? undefined : (() => {
        if (!Array.isArray(entry.pageBindings)) fail('pageBindings 必须是数组')
        return entry.pageBindings.map(binding => { const record = object(binding); return {
          findingId: text(record.findingId, 'pageBindings.findingId'), ...(record.role === undefined ? {} : { role: role(record.role) }),
        } })
      })()
      const assetRole = entry.role === undefined ? 'reference' : role(entry.role)
      if ((assetRole === 'background' || pageBindings?.some(binding => binding.role === 'background'))
        && (!mimeType.startsWith('image/') || sourceCategory === 'drawings')) fail(`只有图像素材可以作背景：${sourceKey}`)
      sources.set(sourceKey, { sourceKey, sourcePath, originalFileName, mimeType, importedAt })
      assets.set(sourceKey, { sourceKey, sourcePath, originalFileName, mimeType, ...metadata,
        displayName: entry.displayName === undefined ? originalFileName : text(entry.displayName, 'displayName'),
        semanticRole: entry.semanticRole === undefined ? 'source_evidence' : text(entry.semanticRole, 'semanticRole'), createdAt: importedAt, adoptedAt: importedAt,
        aliases: strings(entry.aliases, 'aliases'), evidenceIds: strings(entry.evidenceIds, 'evidenceIds'), objectIds: strings(entry.objectIds, 'objectIds'),
        role: assetRole, ...(pageBindings === undefined ? {} : { pageBindings }),
        origin: { type: 'source_material', sourceMaterialKeys: [sourceKey], parentAssetKeys: [], method: '项目资料明确登记并采用', sourceTool: null },
      })
    }
  }
  const declared = new Set([...assets.values()].flatMap(asset => [asset.sourceKey, ...(asset.aliases ?? []), ...asset.evidenceIds]))
  const internalObjects = new Set(input.frozenProject.stateObjects.map(object => object.objectId))
  const unresolved = new Set<string>()
  for (const object of input.frozenProject.stateObjects) for (const section of object.reportSections ?? []) for (const entry of section.entries) {
    for (const ref of entry.evidenceRefs ?? []) {
      if (!declared.has(ref.evidenceId) && ref.assetId !== undefined && !declared.has(ref.assetId)
        && !internalObjects.has(ref.assetId) && !ref.assetId.startsWith('dsh-session-')) unresolved.add(ref.assetId)
    }
  }
  for (const id of [...unresolved].sort()) warnings.push(`成果引用“${id}”尚未关联已登记的可读取原件`)
  return { sourceMaterials: [...sources.values()], assets: [...assets.values()], materialWarnings: warnings }
}
