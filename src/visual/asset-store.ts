import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createStableId, validateDocumentWithAjv, type AssetManifest, type AssetRecord } from '@architectureworld/presentation-contracts'
import type { VisualAssetRecord } from '../governance/types.ts'
import type { VisualGenerationTask, VisualImageData } from './types.ts'

const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const

function safeSegment(name: string, value: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(value) || value === '.' || value === '..') {
    throw new Error(`${name} contains unsafe path characters`)
  }
  return value
}

function bytesOf(data: string | Uint8Array): Buffer {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'base64') : Buffer.from(data)
  if (bytes.length === 0) throw new Error('image data is empty')
  return bytes
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return undefined
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    const marker = bytes[offset + 1]
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break
    const length = bytes.readUInt16BE(offset + 2)
    if (length < 2 || offset + length + 2 > bytes.length) break
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
    }
    offset += length + 2
  }
  return undefined
}

function webpDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return undefined
  const chunk = bytes.toString('ascii', 12, 16)
  if (chunk === 'VP8X') {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    }
  }
  return undefined
}

function intrinsicDimensions(mimeType: keyof typeof EXTENSIONS, bytes: Buffer) {
  const dimensions = mimeType === 'image/png'
    ? pngDimensions(bytes)
    : mimeType === 'image/jpeg'
      ? jpegDimensions(bytes)
      : webpDimensions(bytes)
  if (dimensions === undefined || dimensions.width < 1 || dimensions.height < 1) {
    throw new Error(`invalid ${mimeType} image data`)
  }
  return dimensions
}

export class VisualAssetStore {
  private readonly root: string
  private readonly manifestQueues = new Map<string, Promise<void>>()

  constructor(
    root: string,
    private readonly createId: () => string = randomUUID,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly workspaceRootForProject?: (projectId: string) => string | undefined,
    private readonly legacyAssetSha256?: (fileName: string) => string | undefined,
  ) {
    this.root = resolve(root)
  }

  assertWritableProject(projectId: string): void {
    if (this.workspaceRootForProject === undefined) return
    const workspaceRoot = this.workspaceRootForProject(safeSegment('projectId', projectId))
    if (!workspaceRoot || !isAbsolute(workspaceRoot)
      || !statSync(join(workspaceRoot, 'assets', 'images'), { throwIfNoEntry: false })?.isDirectory()
      || !statSync(join(workspaceRoot, 'assets', 'manifest.json'), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`VISUAL_WORKSPACE_REQUIRED: project '${projectId}' has no standard assets/images and assets/manifest.json`)
    }
  }

  private async updateManifest<T>(workspaceRoot: string, change: (manifest: AssetManifest) => T): Promise<T> {
    const previous = this.manifestQueues.get(workspaceRoot) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>(resolveGate => { release = resolveGate })
    const tail = previous.then(() => gate)
    this.manifestQueues.set(workspaceRoot, tail)
    await previous
    const manifestPath = join(workspaceRoot, 'assets', 'manifest.json')
    const temporary = `${manifestPath}.${randomUUID()}.tmp`
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as AssetManifest
      if (!Array.isArray(manifest.assets)) throw new Error('VISUAL_ASSET_MANIFEST_INVALID: assets must be an array')
      const result = change(manifest)
      const validation = await validateDocumentWithAjv('AssetManifest', manifest)
      if (!validation.valid) throw new Error(`VISUAL_ASSET_MANIFEST_INVALID: ${JSON.stringify(validation.errors)}`)
      await writeFile(temporary, JSON.stringify(manifest), { flag: 'wx' })
      await rename(temporary, manifestPath)
      return result
    } finally {
      await rm(temporary, { force: true })
      release()
      if (this.manifestQueues.get(workspaceRoot) === tail) this.manifestQueues.delete(workspaceRoot)
    }
  }

  private rootForNewAsset(projectId: string): string {
    this.assertWritableProject(projectId)
    const workspaceRoot = this.workspaceRootForProject?.(projectId)
    return workspaceRoot ? resolve(workspaceRoot, 'assets', 'images') : this.root
  }

  async saveCandidate(task: VisualGenerationTask, image: VisualImageData): Promise<VisualAssetRecord> {
    const projectId = safeSegment('projectId', task.projectId)
    safeSegment('taskId', task.taskId)
    const extension = EXTENSIONS[image.mimeType]
    if (extension === undefined) throw new Error(`unsupported image media type: ${image.mimeType}`)
    const bytes = bytesOf(image.data)
    const intrinsic = intrinsicDimensions(image.mimeType, bytes)
    if (image.width !== undefined && image.width !== intrinsic.width) throw new Error('image width metadata mismatch')
    if (image.height !== undefined && image.height !== intrinsic.height) throw new Error('image height metadata mismatch')
    const assetId = safeSegment('assetId', this.createId())
    const fileName = `${projectId}/candidates/${assetId}.${extension}`
    const root = this.rootForNewAsset(projectId)
    const absolute = this.workspaceRootForProject ? resolve(root, `${assetId}.${extension}`) : resolve(root, ...fileName.split('/'))
    const boundary = relative(root, absolute)
    if (boundary.startsWith('..') || isAbsolute(boundary)) throw new Error('image output escaped asset root')
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, bytes, { flag: 'wx' })
    const workspaceRoot = this.workspaceRootForProject?.(projectId)
    if (workspaceRoot) {
      const relativePath = `assets/images/${assetId}.${extension}`
      const createdAt = this.now()
      const record: AssetRecord = {
        assetId: createStableId('asset') as AssetRecord['assetId'],
        displayName: `AI 生图候选 ${assetId}`,
        mediaType: 'image', category: 'image', semanticRole: 'concept_visual',
        relativePath, mimeType: image.mimeType, sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        metadata: { widthPx: intrinsic.width, heightPx: intrinsic.height },
        adoptionStatus: 'candidate',
        origin: { type: 'generated_by_plugin', sourceMaterialIds: [], parentAssetIds: [],
          method: JSON.stringify({ visualAssetId: assetId, taskId: task.taskId }),
          sourceTool: { name: 'pre-design', version: '2.0.2' } },
        createdAt, adoptedAt: null, retiredAt: null,
      }
      try {
        await this.updateManifest(workspaceRoot, manifest => {
          if (manifest.assets.some(row => row.relativePath === relativePath || row.assetId === record.assetId)) {
            throw new Error('VISUAL_ASSET_ALREADY_DECLARED')
          }
          manifest.assets.push(record)
        })
      } catch (error) {
        await rm(absolute, { force: true })
        throw error
      }
    }
    return {
      assetId,
      taskId: task.taskId,
      projectId: task.projectId,
      kind: task.kind,
      required: task.required,
      status: 'candidate',
      ...(task.referenceAssetIds === undefined ? {} : { referenceAssetIds: [...task.referenceAssetIds] }),
      mimeType: image.mimeType,
      fileName,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      width: intrinsic.width,
      height: intrinsic.height,
      createdAt: this.now(),
    }
  }

  async setCandidateStatus(projectId: string, fileName: string, status: 'adopted' | 'retired'): Promise<void> {
    const workspaceRoot = this.workspaceRootForProject?.(safeSegment('projectId', projectId))
    if (!workspaceRoot) return
    const parts = fileName.split('/')
    if (parts.length !== 3 || parts[0] !== projectId || parts[1] !== 'candidates') throw new Error('VISUAL_ASSET_PATH_INVALID')
    const relativePath = `assets/images/${safeSegment('assetFileName', parts[2] ?? '')}`
    await this.updateManifest(workspaceRoot, manifest => {
      const legacyHash = this.legacyAssetSha256?.(fileName)
      const record = manifest.assets.find(row => row.relativePath === relativePath)
        ?? (legacyHash ? manifest.assets.find(row => row.category === 'image' && row.sha256 === legacyHash) : undefined)
      if (!record) throw new Error('VISUAL_CANDIDATE_NOT_DECLARED')
      if (record.adoptionStatus === 'adopted') return
      if (record.adoptionStatus !== 'candidate') throw new Error('VISUAL_CANDIDATE_NOT_DECLARED')
      if (status === 'adopted' && manifest.assets.some(row => row !== record && row.adoptionStatus === 'adopted' && row.sha256 === record.sha256 && row.sizeBytes === record.sizeBytes)) {
        throw new Error('VISUAL_ASSET_DUPLICATES_ADOPTED_CONTENT')
      }
      record.adoptionStatus = status
      if (status === 'adopted') record.adoptedAt = this.now()
      else record.retiredAt = this.now()
    })
  }

  resolveAsset(fileName: string): string {
    const segments = fileName.split('/')
    const projectId = safeSegment('projectId', segments[0] ?? '')
    const workspaceRoot = this.workspaceRootForProject?.(projectId)
    if (workspaceRoot && isAbsolute(workspaceRoot) && segments.length === 3 && segments[1] === 'candidates') {
      const assetFileName = safeSegment('assetFileName', segments[2] ?? '')
      const projectRoot = resolve(workspaceRoot, 'assets', 'images')
      const projectPath = resolve(projectRoot, assetFileName)
      const boundary = relative(projectRoot, projectPath)
      if (boundary.startsWith('..') || isAbsolute(boundary)) throw new Error('asset path escaped root')
      if (existsSync(projectPath)) return projectPath
      const legacyHash = this.legacyAssetSha256?.(fileName)
      if (legacyHash) {
        const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'assets', 'manifest.json'), 'utf8')) as AssetManifest
        const match = manifest.assets.find(row => row.category === 'image' && row.sha256 === legacyHash)
        if (match) {
          const assetPath = resolve(workspaceRoot, ...match.relativePath.split('/'))
          const assetBoundary = relative(resolve(workspaceRoot, 'assets', 'images'), assetPath)
          if (!assetBoundary.startsWith('..') && !isAbsolute(assetBoundary) && existsSync(assetPath)) return assetPath
        }
      }
    }
    const absolute = resolve(this.root, ...fileName.split('/'))
    const boundary = relative(this.root, absolute)
    if (boundary.startsWith('..') || isAbsolute(boundary)) throw new Error('asset path escaped root')
    return absolute
  }
}
