import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
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

  constructor(
    root: string,
    private readonly createId: () => string = randomUUID,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.root = resolve(root)
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
    const absolute = resolve(this.root, ...fileName.split('/'))
    const boundary = relative(this.root, absolute)
    if (boundary.startsWith('..') || isAbsolute(boundary)) throw new Error('image output escaped asset root')
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, bytes, { flag: 'wx' })
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

  resolveAsset(fileName: string): string {
    const absolute = resolve(this.root, ...fileName.split('/'))
    const boundary = relative(this.root, absolute)
    if (boundary.startsWith('..') || isAbsolute(boundary)) throw new Error('asset path escaped root')
    return absolute
  }
}
