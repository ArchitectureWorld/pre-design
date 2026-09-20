import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { allocateReportImages } from '../src/presentation/report-image-allocation.ts'
import { ImageIdentityIndex } from '../src/visual/image-identity.ts'
import { imageBriefHash, type ImageSlotBrief } from '../src/visual/image-policy.ts'
import { normalizeReportRaster } from '../src/visual/report-raster.ts'
import { verifiedRasterImageDimensions } from '../src/governance/site-boundary-asset-store.ts'
import { jpeg, png, scene } from './support/image-identity/fixtures.ts'

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

describe('report raster normalization', () => {
  it('preserves already suitable JPEG and PNG bytes and their actual source hashes', async () => {
    for (const [bytes, mimeType] of [[jpeg(scene()), 'image/jpeg'], [png(scene()), 'image/png']] as const) {
      const source = Buffer.concat([Buffer.from('prefix'), bytes, Buffer.from('suffix')]).subarray(6, 6 + bytes.length)
      const result = await normalizeReportRaster({ bytes: source, mimeType })
      expect(result).toMatchObject({ mimeType, width: 256, height: 192, sourceSha256: sha(bytes), normalized: false })
      expect(Buffer.from(result.bytes)).toEqual(bytes)
    }
  })

  it('removes JPEG container padding losslessly so identity and native inspection accept the same bytes', async () => {
    const encoded = jpeg(scene()), bytes = Buffer.concat([encoded, Buffer.alloc(16)]), originalHash = sha(bytes), index = new ImageIdentityIndex()
    const original = index.identify({ bytes, mimeType: 'image/jpeg' })
    expect(original.status).toBe('identified')
    const result = await normalizeReportRaster({ bytes, mimeType: 'image/jpeg' })
    expect(verifiedRasterImageDimensions(result.mimeType, result.bytes)).toEqual({ width: 256, height: 192 })
    expect(result.normalized).toBe(true)
    expect(Buffer.from(result.bytes)).toEqual(encoded)
    expect(result.sourceSha256).toBe(originalHash)
    expect(sha(bytes)).toBe(originalHash)
    expect(index.identify({ bytes: result.bytes, mimeType: result.mimeType }).identity?.originalId).toBe(original.identity?.originalId)
  })

  it('reduces an oversized complete image proportionally and preserves all four corners', async () => {
    const source = await sharp(Buffer.from('<svg width="3000" height="2000"><rect width="1500" height="1000" fill="#ff0000"/><rect x="1500" width="1500" height="1000" fill="#00ff00"/><rect y="1000" width="1500" height="1000" fill="#0000ff"/><rect x="1500" y="1000" width="1500" height="1000" fill="#ffffff"/></svg>')).removeAlpha().png().toBuffer()
    const digest = sha(source), result = await normalizeReportRaster({ bytes: source, mimeType: 'image/png' })
    expect(result).toMatchObject({ width: 2508, height: 1672, sourceSha256: digest, normalized: true })
    expect(result.bytes.byteLength).toBeLessThanOrEqual(4 * 1024 * 1024)
    expect(sha(source)).toBe(digest)
    const { data, info } = await sharp(result.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const color = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)]
    for (const [x, y, expected] of [[0, 0, [255, 0, 0]], [2507, 0, [0, 255, 0]], [0, 1671, [0, 0, 255]], [2507, 1671, [255, 255, 255]]] as const) {
      expect(color(x, y).every((value, channel) => Math.abs(value - expected[channel]!) <= 4)).toBe(true)
    }
  })

  it('compresses an excessive encoded stream without shrinking a raster already inside the pixel budget', async () => {
    const source = await sharp({ create: { width: 1280, height: 960, channels: 4, background: '#336699ff' } }).png({ compressionLevel: 0 }).toBuffer()
    expect(source.length).toBeGreaterThan(4 * 1024 * 1024)
    const result = await normalizeReportRaster({ bytes: source, mimeType: 'image/png' })
    expect(result).toMatchObject({ width: 1280, height: 960, normalized: true, sourceSha256: sha(source) })
    expect(result.bytes.byteLength).toBeLessThanOrEqual(4 * 1024 * 1024)
  })

  it('applies EXIF orientation even when pixels and encoded bytes are already small', async () => {
    const source = await sharp(jpeg(scene())).withMetadata({ orientation: 6 }).jpeg().toBuffer()
    const result = await normalizeReportRaster({ bytes: source, mimeType: 'image/jpeg' })
    expect(result).toMatchObject({ width: 192, height: 256, normalized: true, sourceSha256: sha(source) })
    expect((await sharp(result.bytes).metadata()).orientation).toBeUndefined()
    const expected = await sharp(source).rotate().raw().toBuffer(), actual = await sharp(result.bytes).raw().toBuffer()
    const meanError = actual.reduce((sum, value, index) => sum + Math.abs(value - expected[index]!), 0) / actual.length
    expect(meanError).toBeLessThan(5)
  })

  it('keeps transparent content in PNG instead of silently flattening it', async () => {
    const source = await sharp({ create: { width: 2080, height: 2080, channels: 4, background: { r: 240, g: 50, b: 30, alpha: 0.25 } } }).png().toBuffer()
    const result = await normalizeReportRaster({ bytes: source, mimeType: 'image/png' })
    expect(result).toMatchObject({ mimeType: 'image/png', width: 2048, height: 2048, normalized: true })
    const { data, info } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(4)
    expect(data[3]).toBeGreaterThanOrEqual(63)
    expect(data[3]).toBeLessThanOrEqual(64)
  })

  it('rejects invalid pixel data and MIME mismatches before returning usable bytes', async () => {
    const bytes = png(scene()), corrupt = Buffer.from(bytes)
    corrupt[Math.floor(corrupt.length / 2)]! ^= 255
    for (const input of [
      { bytes: jpeg(scene()).subarray(0, 400), mimeType: 'image/jpeg' as const },
      { bytes: bytes.subarray(0, bytes.length - 12), mimeType: 'image/png' as const },
      { bytes: corrupt, mimeType: 'image/png' as const },
      { bytes, mimeType: 'image/jpeg' as const },
    ]) await expect(normalizeReportRaster(input)).rejects.toThrow('REPORT_RASTER_INVALID')
  })

  it('refuses oversized source bytes, per-side dimensions and pixel headers before decode', async () => {
    await expect(normalizeReportRaster({ bytes: Buffer.alloc(32 * 1024 * 1024 + 1), mimeType: 'image/png' })).rejects.toThrow('REPORT_RASTER_SOURCE_LIMIT')
    const tooWide = await sharp({ create: { width: 8193, height: 2, channels: 3, background: '#000' } }).png().toBuffer()
    await expect(normalizeReportRaster({ bytes: tooWide, mimeType: 'image/png' })).rejects.toThrow('REPORT_RASTER_SOURCE_LIMIT')
    const tooManyPixels = png(scene()); tooManyPixels.writeUInt32BE(8192, 16); tooManyPixels.writeUInt32BE(8192, 20)
    tooManyPixels.writeUInt32BE(crc32(tooManyPixels.subarray(12, 29)), 29)
    await expect(normalizeReportRaster({ bytes: tooManyPixels, mimeType: 'image/png' })).rejects.toThrow('REPORT_RASTER_SOURCE_LIMIT')
  })

  it('explicitly refuses a transparent stream that cannot meet the output-byte cap', async () => {
    const data = Buffer.alloc(1536 * 1024 * 4)
    let state = 91783
    for (let i = 0; i < data.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; data[i] = state >>> 24 }
    const source = await sharp(data, { raw: { width: 1536, height: 1024, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer()
    await expect(normalizeReportRaster({ bytes: source, mimeType: 'image/png' })).rejects.toThrow('REPORT_RASTER_OUTPUT_LIMIT')
  })

  it('uses a private source snapshot so caller mutation cannot forge the provenance hash', async () => {
    const bytes = png(scene()), expected = Buffer.from(bytes), expectedSha = sha(bytes)
    const pending = normalizeReportRaster({ bytes, mimeType: 'image/png' })
    bytes.fill(0)
    const result = await pending
    expect(result.sourceSha256).toBe(expectedSha)
    expect(Buffer.from(result.bytes)).toEqual(expected)
  })

  it('rejects both pre-cancelled and in-flight normalization without returning a result', async () => {
    const bytes = png(scene()), before = new AbortController()
    before.abort()
    await expect(normalizeReportRaster({ bytes, mimeType: 'image/png', signal: before.signal })).rejects.toMatchObject({ name: 'AbortError' })
    const during = new AbortController(), pending = normalizeReportRaster({ bytes, mimeType: 'image/png', signal: during.signal })
    during.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('keeps a normalized derivative in the source family and inside its two-use budget', async () => {
    const source = await sharp(png(scene())).resize(2560, 1920).removeAlpha().jpeg({ quality: 96 }).toBuffer()
    const normalized = await normalizeReportRaster({ bytes: source, mimeType: 'image/jpeg' })
    const repeated = await normalizeReportRaster({ bytes: source, mimeType: 'image/jpeg' })
    expect(normalized.normalized).toBe(true)
    expect(sha(repeated.bytes)).toBe(sha(normalized.bytes))
    expect(repeated.sourceSha256).toBe(sha(source))
    const index = new ImageIdentityIndex()
    const original = index.identify({ bytes: source, mimeType: 'image/jpeg' })
    const derivative = index.identify({ bytes: normalized.bytes, mimeType: normalized.mimeType, derivedFromSha256: original.identity!.fileSha256 })
    expect(derivative.status).toBe('identified')
    expect(derivative.identity?.originalId).toBe(original.identity?.originalId)
    const briefs: ImageSlotBrief[] = ['cover', 'p1', 'p2'].map(id => ({ id, pageId: id, version: '1', conclusion: '空间', subjects: ['场地'], activities: [], environment: '项目场地', scale: 'area', allowedKinds: ['photo'], allowedSources: ['project'], locale: 'domestic' }))
    const identities = [original.identity!, derivative.identity!, derivative.identity!]
    const candidates = briefs.map((brief, i) => ({ usageId: brief.id, source: 'project' as const,
      material: { sourceKey: brief.id, imageIdentity: identities[i], imageQuality: { requirement: brief,
        inspection: { usageId: brief.id, imageSha256: identities[i]!.fileSha256, requirementHash: imageBriefHash(brief), actualImageInput: true, decision: 'approved' } } } as any }))
    const allocation = allocateReportImages(briefs, candidates)
    expect(allocation.assigned).toHaveLength(2)
    expect(allocation.gaps).toHaveLength(1)
  })
})
