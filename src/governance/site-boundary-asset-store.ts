import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ImageBlock } from '@deepseek-ai/dsh-llm'
import type { ActorRef } from '../state/types.ts'
import type { SiteBoundaryAttachmentEvidence, VisualAssetRecord } from './types.ts'

const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const

const SIDECAR_SUFFIX = '.record.json'

type BoundaryImageSource = 'approved_site_plan' | 'approved_redline'
type BoundaryGeometrySource = 'closed_coordinates' | 'geojson'
type BoundaryMimeType = keyof typeof EXTENSIONS

export interface IngestBoundaryImageInput {
  readonly projectId: string
  readonly source: BoundaryImageSource
  readonly block: ImageBlock
  readonly actor: ActorRef
  readonly submittedRevision: number
  readonly signal: AbortSignal
}

export interface SaveBoundarySvgInput {
  readonly projectId: string
  readonly source: BoundaryGeometrySource
  readonly geometrySha256: string
  readonly svg: string
}

export interface VerifiedVisualAssetSnapshot {
  readonly record: VisualAssetRecord
  readonly bytes: Buffer
  readonly sha256: string
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function safeSegment(name: string, value: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(value) || value === '.' || value === '..') {
    throw new Error(`${name} contains unsafe path characters`)
  }
  return value
}

function assertSha256(name: string, value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(`${name} must be a lowercase SHA-256 digest`)
  return value
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return value >>> 0
})

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) {
    value = CRC32_TABLE[(value ^ bytes[index]!) & 0xff]! ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

function dimensionsFromPng(bytes: Buffer): { readonly width: number; readonly height: number } | undefined {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return undefined
  let offset = 8
  let dimensions: { readonly width: number; readonly height: number } | undefined
  let first = true
  let sawIdat = false
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return undefined
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (!Number.isSafeInteger(end) || end > bytes.length) return undefined
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (bytes.readUInt32BE(end - 4) !== crc32(bytes.subarray(offset + 4, end - 4))) return undefined
    if (first && (type !== 'IHDR' || length !== 13)) return undefined
    first = false
    if (type === 'IHDR') dimensions = { width: bytes.readUInt32BE(offset + 8), height: bytes.readUInt32BE(offset + 12) }
    if (type === 'IDAT' && length > 0) sawIdat = true
    if (type === 'IEND') return length === 0 && end === bytes.length && sawIdat ? dimensions : undefined
    offset = end
  }
  return undefined
}

function dimensionsFromJpeg(bytes: Buffer): { readonly width: number; readonly height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return undefined
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  let dimensions: { readonly width: number; readonly height: number } | undefined
  while (offset < bytes.length - 1) {
    if (bytes[offset] !== 0xff) return undefined
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    if (marker === undefined) return undefined
    if (marker === 0xd9) return offset === bytes.length - 1 ? dimensions : undefined
    if (marker === 0xda) {
      if (offset + 2 >= bytes.length) return undefined
      const length = bytes.readUInt16BE(offset + 1)
      if (length < 8 || offset + length + 1 > bytes.length) return undefined
      const components = bytes[offset + 3]
      if (components === undefined || components < 1 || length !== 6 + 2 * components) return undefined
      const scanStart = offset + length + 1
      let entropyBytes = 0
      let scan = scanStart
      for (; scan < bytes.length - 1; scan += 1) {
        if (bytes[scan] !== 0xff) { entropyBytes += 1; continue }
        const markerInScan = bytes[scan + 1]
        if (markerInScan === 0x00) { entropyBytes += 1; scan += 1; continue }
        if (markerInScan !== undefined && markerInScan >= 0xd0 && markerInScan <= 0xd7) { scan += 1; continue }
        break
      }
      if (entropyBytes === 0 || scan >= bytes.length - 1) return undefined
      offset = scan
      continue
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 1; continue }
    if (offset + 2 >= bytes.length) return undefined
    const length = bytes.readUInt16BE(offset + 1)
    if (length < 2 || offset + length + 1 > bytes.length) return undefined
    if (startOfFrame.has(marker)) {
      if (length < 8) return undefined
      dimensions = { height: bytes.readUInt16BE(offset + 4), width: bytes.readUInt16BE(offset + 6) }
    }
    offset += length + 1
  }
  return undefined
}

function dimensionsFromWebp(bytes: Buffer): { readonly width: number; readonly height: number } | undefined {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) !== bytes.length - 8) return undefined
  let offset = 12
  let dimensions: { readonly width: number; readonly height: number } | undefined
  let extendedDimensions: { readonly width: number; readonly height: number } | undefined
  let sawImagePayload = false
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return undefined
    const chunk = bytes.toString('ascii', offset, offset + 4)
    const length = bytes.readUInt32LE(offset + 4)
    const data = offset + 8
    const end = data + length
    const paddedEnd = end + length % 2
    if (!Number.isSafeInteger(paddedEnd) || paddedEnd > bytes.length) return undefined
    if (chunk === 'VP8X') {
      if (length !== 10) return undefined
      extendedDimensions = { width: 1 + bytes.readUIntLE(data + 4, 3), height: 1 + bytes.readUIntLE(data + 7, 3) }
    } else if (chunk === 'VP8 ') {
      if (length < 10 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return undefined
      const frameTag = bytes.readUIntLE(data, 3)
      const partitionLength = frameTag >>> 5
      if ((frameTag & 1) !== 0 || ((frameTag >>> 1) & 0x7) > 3 || (frameTag & 0x10) === 0 || partitionLength < 1 || length < 10 + partitionLength) return undefined
      dimensions = { width: bytes.readUInt16LE(data + 6) & 0x3fff, height: bytes.readUInt16LE(data + 8) & 0x3fff }
      sawImagePayload = true
    } else if (chunk === 'VP8L') {
      if (length <= 5 || bytes[data] !== 0x2f) return undefined
      const bits = bytes.readUInt32LE(data + 1)
      dimensions = { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }
      sawImagePayload = true
    }
    offset = paddedEnd
  }
  if (extendedDimensions !== undefined && dimensions !== undefined
    && (extendedDimensions.width !== dimensions.width || extendedDimensions.height !== dimensions.height)) return undefined
  return offset === bytes.length && sawImagePayload ? dimensions : undefined
}

function intrinsicDimensions(mimeType: BoundaryMimeType, data: Uint8Array): { readonly width: number; readonly height: number } {
  const bytes = Buffer.from(data)
  const dimensions = mimeType === 'image/png'
    ? dimensionsFromPng(bytes)
    : mimeType === 'image/jpeg'
      ? dimensionsFromJpeg(bytes)
      : dimensionsFromWebp(bytes)
  if (dimensions === undefined || dimensions.width < 1 || dimensions.height < 1) throw new Error(`invalid ${mimeType} image bytes`)
  return dimensions
}

function attachmentRefsMatch(expected: ImageAttachmentRef, actual: ImageAttachmentRef): boolean {
  return expected.attachmentId === actual.attachmentId
    && expected.mediaType === actual.mediaType
    && expected.bytes === actual.bytes
    && expected.width === actual.width
    && expected.height === actual.height
    && expected.name === actual.name
    && expected.originalDimensions?.width === actual.originalDimensions?.width
    && expected.originalDimensions?.height === actual.originalDimensions?.height
}

function boundaryMimeType(mediaType: string): BoundaryMimeType {
  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp') {
    throw new Error(`unsupported boundary image MIME type: ${mediaType}`)
  }
  return mediaType
}

function boundaryEvidence(ref: ImageAttachmentRef, storageSha256: string, actor: ActorRef, submittedRevision: number): SiteBoundaryAttachmentEvidence {
  if (!Number.isSafeInteger(submittedRevision) || submittedRevision < 0) throw new Error('submittedRevision must be a non-negative integer')
  const mediaType = boundaryMimeType(ref.mediaType)
  return {
    origin: 'user_image',
    attachmentId: String(ref.attachmentId),
    mediaType,
    ...(ref.name === undefined || ref.name.trim() === '' ? {} : { displayName: ref.name }),
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    storageSha256,
    submittedBy: cloneActor(actor),
    submittedRevision,
  }
}

function cloneActor(actor: ActorRef): ActorRef {
  if (typeof actor.actorId !== 'string' || typeof actor.name !== 'string' || typeof actor.role !== 'string') throw new Error('boundary actor metadata is invalid')
  return { actorId: actor.actorId, name: actor.name, role: actor.role }
}

function validateSvg(svg: string): void {
  const document = /^\s*<svg\b([^>]*)>[\s\S]*<\/svg>\s*$/u.exec(svg)
  const openingTag = document?.[1]
  const attributes = openingTag === undefined ? [] : [...openingTag.matchAll(/(?:^|\s)(width|height|viewBox|style)\s*=/gu)].map(match => match[1]!)
  const count = (name: string) => attributes.filter(attribute => attribute === name).length
  if (openingTag === undefined
    || count('width') !== 1 || count('height') !== 1 || count('viewBox') !== 1 || count('style') !== 0
    || !/\bwidth\s*=\s*(["'])1600\1/u.test(openingTag)
    || !/\bheight\s*=\s*(["'])1000\1/u.test(openingTag)
    || !/\bviewBox\s*=\s*(["'])0 0 1600 1000\1/u.test(openingTag)
    || (svg.match(/<svg\b/gu)?.length ?? 0) !== 1
    || (svg.match(/<\/svg>/gu)?.length ?? 0) !== 1
    || /<(?:script|style|image)\b|\bhref\s*=/iu.test(svg)) {
    throw new Error('boundary SVG must be a 1600x1000 SVG document')
  }
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

function assertCanonicalRecord(value: unknown): VisualAssetRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('canonical sidecar record is invalid')
  const record = value as VisualAssetRecord
  if (typeof record.assetId !== 'string' || record.taskId !== record.assetId || typeof record.projectId !== 'string'
    || record.required !== true || record.status !== 'candidate' || typeof record.createdAt !== 'string') {
    throw new Error('canonical sidecar record identity is invalid')
  }
  const projectId = safeSegment('projectId', record.projectId)
  assertSha256('asset SHA-256', record.sha256)
  if (record.kind === 'evidence') {
    const mimeType = boundaryMimeType(record.mimeType)
    const extension = EXTENSIONS[mimeType]
    if (!/^boundary-evidence-[a-f0-9]{24}$/u.test(record.assetId)
      || record.fileName !== `${projectId}/evidence/${record.assetId}.${extension}`
      || record.boundaryGeometrySha256 !== undefined || record.boundaryEvidence === undefined
      || record.width < 1 || record.height < 1
      || !hasExactKeys(record, ['assetId', 'taskId', 'projectId', 'kind', 'required', 'status', 'mimeType', 'fileName', 'sha256', 'width', 'height', 'boundaryEvidence', 'createdAt'])) {
      throw new Error('canonical sidecar evidence identity is invalid')
    }
    const evidence = record.boundaryEvidence
    if (evidence.origin !== 'user_image' || evidence.mediaType !== mimeType || evidence.storageSha256 !== record.sha256
      || evidence.width !== record.width || evidence.height !== record.height || !Number.isSafeInteger(evidence.bytes) || evidence.bytes < 1
      || !Number.isSafeInteger(evidence.submittedRevision) || evidence.submittedRevision < 0
      || typeof evidence.attachmentId !== 'string' || evidence.attachmentId === ''
      || (evidence.displayName !== undefined && evidence.displayName.trim() === '')
      || !hasExactKeys(evidence, evidence.displayName === undefined
        ? ['origin', 'attachmentId', 'mediaType', 'bytes', 'width', 'height', 'storageSha256', 'submittedBy', 'submittedRevision']
        : ['origin', 'attachmentId', 'mediaType', 'displayName', 'bytes', 'width', 'height', 'storageSha256', 'submittedBy', 'submittedRevision'])
      || !hasExactKeys(evidence.submittedBy, ['actorId', 'name', 'role'])
      || typeof evidence.submittedBy.actorId !== 'string' || typeof evidence.submittedBy.name !== 'string' || typeof evidence.submittedBy.role !== 'string') {
      throw new Error('canonical sidecar evidence lineage is invalid')
    }
  } else if (record.kind === 'deterministic') {
    if (record.mimeType !== 'image/svg+xml' || !/^boundary-deterministic-[a-f0-9]{24}$/u.test(record.assetId)
      || record.fileName !== `${projectId}/deterministic/${record.assetId}.svg`
      || record.boundaryEvidence !== undefined || record.boundaryGeometrySha256 === undefined
      || !/^[a-f0-9]{64}$/u.test(record.boundaryGeometrySha256) || record.width !== 1600 || record.height !== 1000
      || !hasExactKeys(record, ['assetId', 'taskId', 'projectId', 'kind', 'required', 'status', 'mimeType', 'fileName', 'sha256', 'boundaryGeometrySha256', 'width', 'height', 'createdAt'])) {
      throw new Error('canonical sidecar deterministic identity is invalid')
    }
  } else {
    throw new Error('canonical sidecar asset kind is invalid')
  }
  return record
}

function sameImmutableIdentity(candidate: VisualAssetRecord, canonical: VisualAssetRecord): boolean {
  if (candidate.projectId !== canonical.projectId || candidate.assetId !== canonical.assetId || candidate.taskId !== canonical.taskId
    || candidate.fileName !== canonical.fileName || candidate.kind !== canonical.kind || candidate.mimeType !== canonical.mimeType
    || candidate.sha256 !== canonical.sha256 || candidate.width !== canonical.width || candidate.height !== canonical.height) return false
  if (candidate.kind === 'evidence') {
    return candidate.boundaryEvidence?.storageSha256 === canonical.boundaryEvidence?.storageSha256
  }
  return candidate.boundaryGeometrySha256 === canonical.boundaryGeometrySha256
}

export class SiteBoundaryAssetStore {
  private readonly root: string

  constructor(
    root: string,
    private readonly attachments: Pick<AttachmentStore, 'readImage'>,
    private readonly now: () => string,
  ) {
    this.root = resolve(root)
  }

  async ingestImage(input: IngestBoundaryImageInput): Promise<VisualAssetRecord> {
    const projectId = safeSegment('projectId', input.projectId)
    const expectedRef = input.block.attachment
    const stored = await this.attachments.readImage(expectedRef, input.signal)
    if (!attachmentRefsMatch(expectedRef, stored.ref)) throw new Error('attachment metadata does not match the requested image reference')
    const mimeType = boundaryMimeType(stored.ref.mediaType)
    const bytes = Buffer.from(stored.data)
    if (bytes.length === 0 || stored.ref.bytes !== bytes.length) throw new Error('attachment bytes do not match verified metadata')
    const dimensions = intrinsicDimensions(mimeType, bytes)
    if (stored.ref.width !== dimensions.width || stored.ref.height !== dimensions.height) throw new Error('attachment dimensions do not match verified image bytes')
    const storageSha256 = sha256(bytes)
    const assetId = `boundary-evidence-${this.identity(projectId, input.source, storageSha256)}`
    const fileName = `${projectId}/evidence/${assetId}.${EXTENSIONS[mimeType]}`
    await this.writeIdempotent(fileName, bytes, storageSha256)
    return this.persistCanonical({
      assetId,
      taskId: assetId,
      projectId,
      kind: 'evidence',
      required: true,
      status: 'candidate',
      mimeType,
      fileName,
      sha256: storageSha256,
      width: dimensions.width,
      height: dimensions.height,
      boundaryEvidence: boundaryEvidence(stored.ref, storageSha256, input.actor, input.submittedRevision),
      createdAt: this.now(),
    })
  }

  async saveGeometrySvg(input: SaveBoundarySvgInput): Promise<VisualAssetRecord> {
    const projectId = safeSegment('projectId', input.projectId)
    const geometrySha256 = assertSha256('geometrySha256', input.geometrySha256)
    validateSvg(input.svg)
    const bytes = Buffer.from(input.svg, 'utf8')
    const fileSha256 = sha256(bytes)
    const assetId = `boundary-deterministic-${this.identity(projectId, input.source, geometrySha256)}`
    const fileName = `${projectId}/deterministic/${assetId}.svg`
    await this.writeIdempotent(fileName, bytes, fileSha256)
    return this.persistCanonical({
      assetId,
      taskId: assetId,
      projectId,
      kind: 'deterministic',
      required: true,
      status: 'candidate',
      mimeType: 'image/svg+xml',
      fileName,
      sha256: fileSha256,
      boundaryGeometrySha256: geometrySha256,
      width: 1600,
      height: 1000,
      createdAt: this.now(),
    })
  }

  async verifyVisualAsset(asset: VisualAssetRecord): Promise<void> {
    await this.readVerifiedVisualAsset(asset)
  }

  async readVerifiedVisualAsset(asset: VisualAssetRecord): Promise<VerifiedVisualAssetSnapshot> {
    const canonical = await this.readCanonical(asset.fileName)
    if (!isDeepStrictEqual(asset, canonical)) throw new Error('visual asset does not match its canonical sidecar identity')
    const absolute = this.resolveAsset(canonical.fileName)
    const bytes = await readFile(absolute)
    const digest = sha256(bytes)
    if (digest !== canonical.sha256) throw new Error('visual asset integrity SHA-256 drift detected')
    return { record: canonical, bytes, sha256: digest }
  }

  resolveAsset(fileName: string): string {
    if (fileName.includes('\\') || isAbsolute(fileName)) throw new Error('asset path escaped root')
    const segments = fileName.split('/')
    if (segments.length === 0 || segments.some(segment => segment === '')) throw new Error('asset path escaped root')
    for (const segment of segments) safeSegment('asset path', segment)
    if (segments.length !== 3 || (segments[1] !== 'evidence' && segments[1] !== 'deterministic')) {
      throw new Error('asset path is outside the boundary asset directories')
    }
    const absolute = resolve(this.root, ...segments)
    const boundary = relative(this.root, absolute)
    if (boundary.startsWith('..') || isAbsolute(boundary)) throw new Error('asset path escaped root')
    return absolute
  }

  private identity(projectId: string, source: string, contentSha256: string): string {
    return createHash('sha256').update(`${projectId}\u0000${source}\u0000${contentSha256}`).digest('hex').slice(0, 24)
  }

  private async writeIdempotent(fileName: string, bytes: Uint8Array, expectedSha256: string): Promise<void> {
    const published = await this.publishExclusive(fileName, bytes)
    if (sha256(published) !== expectedSha256) throw new Error('existing visual asset failed integrity SHA-256 verification')
  }

  private async persistCanonical(record: VisualAssetRecord): Promise<VisualAssetRecord> {
    assertCanonicalRecord(record)
    const fileName = `${record.fileName}${SIDECAR_SUFFIX}`
    const canonical = this.parseCanonical(await this.publishExclusive(fileName, Buffer.from(JSON.stringify(record), 'utf8')))
    if (!sameImmutableIdentity(record, canonical)) throw new Error('canonical sidecar immutable identity does not match verified asset content')
    return canonical
  }

  private async readCanonical(fileName: string): Promise<VisualAssetRecord> {
    try {
      return this.parseCanonical(await readFile(this.resolveAsset(`${fileName}${SIDECAR_SUFFIX}`)))
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('canonical sidecar')) throw error
      throw new Error('canonical sidecar is missing or unreadable')
    }
  }

  private parseCanonical(bytes: Uint8Array): VisualAssetRecord {
    try {
      return assertCanonicalRecord(JSON.parse(Buffer.from(bytes).toString('utf8')))
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('canonical sidecar')) throw error
      throw new Error('canonical sidecar record is invalid')
    }
  }

  private async publishExclusive(fileName: string, bytes: Uint8Array): Promise<Buffer> {
    const absolute = this.resolveAsset(fileName)
    await mkdir(dirname(absolute), { recursive: true })
    const temporary = `${absolute}.${randomUUID()}.tmp`
    let temporaryWritten = false
    try {
      await writeFile(temporary, bytes, { flag: 'wx' })
      temporaryWritten = true
      await link(temporary, absolute)
      return Buffer.from(bytes)
    } catch (error) {
      if (!temporaryWritten || (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      return readFile(absolute)
    } finally {
      await unlink(temporary).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
    }
  }
}
