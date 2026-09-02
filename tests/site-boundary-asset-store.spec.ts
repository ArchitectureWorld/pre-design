import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ImageBlock } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SiteBoundaryAssetStore } from '../src/governance/site-boundary-asset-store.ts'

const roots: string[] = []
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')
const JPEG_1X1 = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=', 'base64')
const WEBP_1X1 = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA=', 'base64').subarray(0, 42)
const owner = { actorId: 'owner-1', name: '项目负责人', role: 'decision_owner' }
const now = () => '2026-08-30T12:00:00.000Z'

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function imageRef(overrides: Partial<ImageAttachmentRef> = {}): ImageAttachmentRef {
  return {
    attachmentId: 'attachment-1' as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: PNG_1X1.length,
    width: 1,
    height: 1,
    name: '../../hostile-name.png',
    originalDimensions: { width: 1, height: 1 },
    ...overrides,
  }
}

function imageBlock(ref = imageRef()): ImageBlock {
  return { type: 'image', attachment: ref }
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}

function largePng(): Buffer {
  const iend = PNG_1X1.subarray(-12)
  const payload = Buffer.alloc(16 * 1024 * 1024)
  const length = Buffer.alloc(4)
  const crc = Buffer.alloc(4)
  length.writeUInt32BE(payload.length)
  const chunk = Buffer.concat([Buffer.from('tEXt'), payload])
  crc.writeUInt32BE(crc32(chunk))
  return Buffer.concat([PNG_1X1.subarray(0, -12), length, chunk, crc, iend])
}

function pngChunks(data: Buffer): { readonly type: string; readonly offset: number; readonly end: number }[] {
  const chunks: { type: string; offset: number; end: number }[] = []
  for (let offset = 8; offset < data.length;) {
    const length = data.readUInt32BE(offset)
    const end = offset + 12 + length
    chunks.push({ type: data.toString('ascii', offset + 4, offset + 8), offset, end })
    offset = end
  }
  return chunks
}

function pngWithoutIdat(): Buffer {
  const chunks = pngChunks(PNG_1X1)
  return Buffer.concat([PNG_1X1.subarray(0, 8), ...chunks.filter(chunk => chunk.type !== 'IDAT').map(chunk => PNG_1X1.subarray(chunk.offset, chunk.end))])
}

function pngWithBadIdatCrc(): Buffer {
  const copy = Buffer.from(PNG_1X1)
  const chunk = pngChunks(copy).find(candidate => candidate.type === 'IDAT')
  if (chunk === undefined) throw new Error('fixture PNG has no IDAT')
  copy[chunk.end - 1] = copy[chunk.end - 1]! ^ 0xff
  return copy
}

function jpegWithIllegalScanMarker(): Buffer {
  const sos = JPEG_1X1.indexOf(Buffer.from([0xff, 0xda]))
  if (sos < 0) throw new Error('fixture JPEG has no SOS')
  return Buffer.concat([
    JPEG_1X1.subarray(0, sos),
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7f, 0xff, 0xc4, 0xff, 0xd9]),
  ])
}

function webpWithOnlyVp8Header(): Buffer {
  const bytes = Buffer.alloc(30)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(22, 4)
  bytes.write('WEBPVP8 ', 8, 'ascii')
  bytes.writeUInt32LE(10, 16)
  bytes.set([0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00], 20)
  return bytes
}

async function makeStore(stored: { readonly ref: ImageAttachmentRef; readonly data: Uint8Array } = { ref: imageRef(), data: PNG_1X1 }) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-boundary-assets-'))
  roots.push(root)
  const readImage = vi.fn(async () => stored)
  return { root, readImage, store: new SiteBoundaryAssetStore(root, { readImage } as never, now) }
}

function imageInput(block = imageBlock()) {
  return {
    projectId: 'project-1',
    source: 'approved_redline' as const,
    block,
    actor: owner,
    submittedRevision: 7,
    signal: AbortSignal.timeout(1_000),
  }
}

describe('SiteBoundaryAssetStore', () => {
  it('reads one verified DSH image and stores a stable evidence asset', async () => {
    const { root, store } = await makeStore()

    const first = await store.ingestImage(imageInput())
    const second = await store.ingestImage(imageInput())

    expect(second).toEqual(first)
    expect(first).toMatchObject({
      taskId: first.assetId,
      projectId: 'project-1',
      kind: 'evidence',
      required: true,
      status: 'candidate',
      mimeType: 'image/png',
      width: 1,
      height: 1,
      sha256: createHash('sha256').update(PNG_1X1).digest('hex'),
      boundaryEvidence: {
        origin: 'user_image', attachmentId: 'attachment-1', mediaType: 'image/png',
        displayName: '../../hostile-name.png', bytes: PNG_1X1.length, width: 1, height: 1,
        storageSha256: createHash('sha256').update(PNG_1X1).digest('hex'),
        submittedBy: owner, submittedRevision: 7,
      },
    })
    expect(first.boundaryEvidence?.storageSha256).toBe(first.sha256)
    expect(first.assetId).toMatch(/^boundary-evidence-[a-f0-9]{24}$/u)
    expect(first.fileName).toBe(`project-1/evidence/${first.assetId}.png`)
    expect(first.fileName).not.toContain('hostile')
    expect(first.adoptedRevision).toBeUndefined()
    expect(await readFile(join(root, ...first.fileName.split('/')))).toEqual(PNG_1X1)
  })

  it('is idempotent when the same evidence arrives concurrently', async () => {
    const { store } = await makeStore()

    const records = await Promise.all(Array.from({ length: 4 }, () => store.ingestImage(imageInput())))

    expect(records).toEqual([records[0], records[0], records[0], records[0]])
  })

  it('atomically reuses a large evidence asset across independent stores sharing one root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-boundary-assets-'))
    roots.push(root)
    const data = largePng()
    const ref = imageRef({ bytes: data.length })
    const attachments = { readImage: vi.fn(async () => ({ ref, data })) } as never
    const left = new SiteBoundaryAssetStore(root, attachments, now)
    const right = new SiteBoundaryAssetStore(root, attachments, now)

    const records = await Promise.all(Array.from({ length: 3 }, () => Promise.all([
      left.ingestImage(imageInput(imageBlock(ref))),
      right.ingestImage(imageInput(imageBlock(ref))),
    ])))

    expect(records.flat()).toEqual(Array.from({ length: 6 }, () => records[0]![0]))
    await expect(left.verifyVisualAsset(records[0]![0])).resolves.toBeUndefined()
  })

  it('persists the first evidence record across retries, stores, and caller mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-boundary-assets-'))
    roots.push(root)
    const ref = imageRef({ name: 'redline.png' })
    const attachments = { readImage: vi.fn(async () => ({ ref, data: PNG_1X1 })) } as never
    const firstStore = new SiteBoundaryAssetStore(root, attachments, () => '2026-08-30T12:00:00.000Z')
    const laterStore = new SiteBoundaryAssetStore(root, attachments, () => '2026-08-30T12:05:00.000Z')
    const firstActor = { ...owner }

    const first = await firstStore.ingestImage({ ...imageInput(imageBlock(ref)), actor: firstActor, submittedRevision: 7 })
    firstActor.name = '调用方篡改后的名字'
    const retried = await laterStore.ingestImage({
      ...imageInput(imageBlock(ref)),
      actor: { actorId: 'owner-2', name: '后续负责人', role: 'decision_owner' },
      submittedRevision: 8,
    })
    const restarted = await new SiteBoundaryAssetStore(root, attachments, () => '2026-08-30T12:10:00.000Z')
      .ingestImage(imageInput(imageBlock(ref)))

    expect(retried).toEqual(first)
    expect(restarted).toEqual(first)
    expect(first.boundaryEvidence?.submittedBy).toEqual(owner)
    expect(first.createdAt).toBe('2026-08-30T12:00:00.000Z')
  })

  it('omits blank display names and freezes submitted actor metadata', async () => {
    const ref = imageRef({ name: '  ' })
    const { store } = await makeStore({ ref, data: PNG_1X1 })
    const actor = { ...owner }

    const asset = await store.ingestImage({ ...imageInput(imageBlock(ref)), actor })
    actor.role = 'mutated'

    expect(asset.boundaryEvidence).toMatchObject({ submittedBy: owner })
    expect(asset.boundaryEvidence).not.toHaveProperty('displayName')
  })

  it('binds verification to the canonical sidecar, identity, lineage, and exact file path', async () => {
    const { root, store } = await makeStore()
    const asset = await store.ingestImage(imageInput())

    await expect(store.verifyVisualAsset({ ...asset, projectId: 'project-2' })).rejects.toThrow(/canonical|identity|project/i)
    await expect(store.verifyVisualAsset({ ...asset, assetId: `${asset.assetId}-other`, taskId: `${asset.assetId}-other` })).rejects.toThrow(/canonical|identity/i)
    await expect(store.verifyVisualAsset({ ...asset, kind: 'deterministic', mimeType: 'image/svg+xml', boundaryEvidence: undefined, boundaryGeometrySha256: 'a'.repeat(64), width: 1600, height: 1000 })).rejects.toThrow(/canonical|identity|path/i)
    await expect(store.verifyVisualAsset({ ...asset, fileName: asset.fileName.replace(/\.png$/u, '.jpg') })).rejects.toThrow(/canonical|identity|path/i)
    await writeFile(`${join(root, ...asset.fileName.split('/'))}.record.json`, '{"corrupt":true}')
    await expect(store.verifyVisualAsset(asset)).rejects.toThrow(/sidecar|canonical/i)
  })

  it.each([
    ['PNG', 'image/png' as const, PNG_1X1, 1, 1],
    ['JPEG', 'image/jpeg' as const, JPEG_1X1, 1, 1],
    ['WebP', 'image/webp' as const, WEBP_1X1, 1, 1],
  ])('accepts a structurally complete %s image returned by DSH', async (_label, mediaType, data, width, height) => {
    const ref = imageRef({ mediaType, bytes: data.length, width, height, name: 'evidence-image' })
    const { store } = await makeStore({ ref, data })

    await expect(store.ingestImage(imageInput(imageBlock(ref)))).resolves.toMatchObject({ mimeType: mediaType, width, height })
  })

  it.each([
    ['truncated PNG', imageRef({ bytes: 24 }), PNG_1X1.subarray(0, 24)],
    ['JPEG without EOI', imageRef({ mediaType: 'image/jpeg', bytes: JPEG_1X1.length - 2 }), JPEG_1X1.subarray(0, -2)],
    ['WebP with a forged RIFF length', imageRef({ mediaType: 'image/webp', bytes: WEBP_1X1.length }), Buffer.from([...WEBP_1X1.subarray(0, 4), 0xff, 0xff, 0xff, 0x7f, ...WEBP_1X1.subarray(8)])],
  ])('rejects a structurally incomplete %s image', async (_label, ref, data) => {
    const { store } = await makeStore({ ref, data })

    await expect(store.ingestImage(imageInput(imageBlock(ref)))).rejects.toThrow(/invalid|image|bytes/i)
  })

  it.each([
    ['PNG without IDAT', 'image/png' as const, pngWithoutIdat()],
    ['PNG with a bad IDAT CRC', 'image/png' as const, pngWithBadIdatCrc()],
    ['JPEG with an illegal marker in entropy scan', 'image/jpeg' as const, jpegWithIllegalScanMarker()],
    ['WebP with only the minimal VP8 header', 'image/webp' as const, webpWithOnlyVp8Header()],
  ])('rejects forged %s bytes that only satisfy superficial headers', async (_label, mediaType, data) => {
    const ref = imageRef({ mediaType, bytes: data.length, width: 1, height: 1 })
    const { store } = await makeStore({ ref, data })

    await expect(store.ingestImage(imageInput(imageBlock(ref)))).rejects.toThrow(/invalid|image|bytes/i)
  })

  it('fails closed during ingest when a structurally valid evidence sidecar has a different content SHA', async () => {
    const { root, store } = await makeStore()
    const asset = await store.ingestImage(imageInput())
    const forged = {
      ...asset,
      sha256: 'b'.repeat(64),
      boundaryEvidence: { ...asset.boundaryEvidence!, storageSha256: 'b'.repeat(64) },
    }
    await writeFile(`${join(root, ...asset.fileName.split('/'))}.record.json`, JSON.stringify(forged))

    await expect(store.ingestImage(imageInput())).rejects.toThrow(/canonical|sidecar|identity/i)
  })

  it('fails closed during SVG save when a structurally valid sidecar has a different geometry lineage', async () => {
    const { root, store } = await makeStore()
    const geometrySha256 = 'a'.repeat(64)
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"></svg>'
    const asset = await store.saveGeometrySvg({ projectId: 'project-1', source: 'geojson', geometrySha256, svg })
    const forged = { ...asset, boundaryGeometrySha256: 'b'.repeat(64) }
    await writeFile(`${join(root, ...asset.fileName.split('/'))}.record.json`, JSON.stringify(forged))

    await expect(store.saveGeometrySvg({ projectId: 'project-1', source: 'geojson', geometrySha256, svg })).rejects.toThrow(/canonical|sidecar|identity/i)
  })

  it.each([
    ['GIF bytes declared as PNG', imageRef(), { ref: imageRef(), data: GIF_1X1 }],
    ['PNG bytes declared as JPEG', imageRef({ mediaType: 'image/jpeg' }), { ref: imageRef({ mediaType: 'image/jpeg' }), data: PNG_1X1 }],
    ['empty bytes', imageRef({ bytes: 0 }), { ref: imageRef({ bytes: 0 }), data: new Uint8Array() }],
    ['stored attachment id differs', imageRef(), { ref: imageRef({ attachmentId: 'attachment-2' as ImageAttachmentRef['attachmentId'] }), data: PNG_1X1 }],
    ['stored byte length differs', imageRef(), { ref: imageRef({ bytes: PNG_1X1.length + 1 }), data: PNG_1X1 }],
    ['stored dimensions differ', imageRef(), { ref: imageRef({ width: 2 }), data: PNG_1X1 }],
  ])('rejects %s instead of accepting unverified image evidence', async (_label, ref, stored) => {
    const { store } = await makeStore(stored)

    await expect(store.ingestImage(imageInput(imageBlock(ref)))).rejects.toThrow(/image|attachment|metadata|bytes|mime/i)
  })

  it('fails closed when an evidence file drifts after it was stored', async () => {
    const { store } = await makeStore()
    const asset = await store.ingestImage(imageInput())
    await writeFile(store.resolveAsset(asset.fileName), Buffer.from('tampered'))

    await expect(store.verifyVisualAsset(asset)).rejects.toThrow(/sha|integrity|drift/i)
    await expect(store.ingestImage(imageInput())).rejects.toThrow(/sha|integrity|existing/i)
  })

  it('stores a fixed-size deterministic SVG with a separate geometry digest', async () => {
    const { root, store } = await makeStore()
    const geometrySha256 = 'a'.repeat(64)
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><path d="M0 0"/></svg>'

    const first = await store.saveGeometrySvg({ projectId: 'project-1', source: 'closed_coordinates', geometrySha256, svg })
    const second = await store.saveGeometrySvg({ projectId: 'project-1', source: 'closed_coordinates', geometrySha256, svg })

    expect(second).toEqual(first)
    expect(first).toMatchObject({
      taskId: first.assetId, projectId: 'project-1', kind: 'deterministic', required: true,
      status: 'candidate', mimeType: 'image/svg+xml', width: 1600, height: 1000,
      boundaryGeometrySha256: geometrySha256,
      sha256: createHash('sha256').update(svg, 'utf8').digest('hex'),
    })
    expect(first.assetId).toMatch(/^boundary-deterministic-[a-f0-9]{24}$/u)
    expect(first.fileName).toBe(`project-1/deterministic/${first.assetId}.svg`)
    expect(first.adoptedRevision).toBeUndefined()
    expect(await readFile(join(root, ...first.fileName.split('/')), 'utf8')).toBe(svg)
  })

  it.each([
    '<svg width="1600" width="1600" height="1000" viewBox="0 0 1600 1000"></svg>',
    '<svg width="1600" height="1000" viewBox="0 0 1600 1000" style="display:none"></svg>',
    '<svg width="1600" height="1000" viewBox="0 0 1600 1000"><script/></svg>',
    '<svg width="1600" height="1000" viewBox="0 0 1600 1000"><image href="https://example.test/map.png"/></svg>',
    '<svg width="1600" height="1000" viewBox="0 0 1600 1000">',
  ])('rejects an unsafe or incomplete fixed-size SVG', async svg => {
    const { store } = await makeStore()

    await expect(store.saveGeometrySvg({ projectId: 'project-1', source: 'geojson', geometrySha256: 'a'.repeat(64), svg })).rejects.toThrow(/SVG/i)
  })

  it('rejects unsafe project and resolved asset paths', async () => {
    const { store } = await makeStore()

    await expect(store.ingestImage({ ...imageInput(), projectId: '../escape' })).rejects.toThrow(/projectId/i)
    await expect(store.ingestImage({ ...imageInput(), projectId: 'C:\\escape' })).rejects.toThrow(/projectId/i)
    expect(() => store.resolveAsset('../escape.png')).toThrow(/asset path/i)
    expect(() => store.resolveAsset('project-1\\evidence\\escape.png')).toThrow(/asset path/i)
    expect(() => store.resolveAsset('C:\\escape.png')).toThrow(/asset path/i)
    expect(() => store.resolveAsset('project-1/candidates/not-a-boundary.png')).toThrow(/asset path/i)
  })
})
