import { createHash } from 'node:crypto'
import { decode } from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { BUNDLED_CASE_STUDY_IMAGES } from '../src/report/case-studies/catalog-images.ts'
import { ImageIdentityIndex, type ImageIdentityInput } from '../src/visual/image-identity.ts'
import { annotated, crop, jpeg, noise, png, resize, scene, solid } from './support/image-identity/fixtures.ts'

describe('decoded original image identity', () => {
  it('does not mistake shared white paper in different drawings for a crop or a resized original', () => {
    const drawing = (kind: number) => {
      const width = 512, height = 384, data = Buffer.alloc(width * height * 4, 255)
      const line = (x: number, y: number, value = 160) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return
        const p = (Math.floor(y) * width + Math.floor(x)) * 4
        data[p] = data[p + 1] = data[p + 2] = value
      }
      if (kind === 0) {
        // Sparse site contours on white paper, with generous margins.
        for (let band = 0; band < 7; band++) for (let x = 24; x < 460; x++)
          line(x, 80 + band * 22 + 32 * Math.sin(x / 74 + band / 3))
      } else {
        // Independent room arrangements with the same white background.
        for (let room = 0; room < 4; room++) {
          const left = 35 + room * 92, top = 40 + (room % 2) * 30 + kind * 21
          for (let x = left; x < left + 73; x++) for (let d = 0; d < 3; d++) {
            line(x, top + d, 70); line(x, top + 145 + d, 70)
          }
          for (let y = top; y < top + 145; y++) for (let d = 0; d < 3; d++) {
            line(left + d, y, 70); line(left + 73 + d, y, 70)
          }
        }
      }
      return { width, height, data }
    }
    const index = new ImageIdentityIndex(), site = drawing(0), plan = drawing(1)
    const first = index.identify({ bytes: png(site), mimeType: 'image/png' })
    const second = index.identify({ bytes: png(plan), mimeType: 'image/png' })
    expect(first.status).toBe('identified')
    expect(second.status).toBe('identified')
    expect(second.identity?.originalId).not.toBe(first.identity?.originalId)
    const resized = index.identify({ bytes: jpeg(resize(plan, 768, 576), 92), mimeType: 'image/jpeg' })
    expect(resized.status).toBe('identified')
    expect(resized.identity?.originalId).toBe(second.identity?.originalId)
  })

  it('keeps recognizing new originals and old derivatives after more than 256 retained references', async () => {
    const index = new ImageIdentityIndex(), bytes = jpeg(scene(7, 128, 96)), signal = AbortSignal.timeout(20000)
    const original = await index.identifyAsync({ bytes, mimeType: 'image/jpeg' }, signal)
    for (let variant = 1; variant <= 300; variant++) {
      const result = await index.identifyAsync({ bytes: Buffer.concat([bytes, Buffer.alloc(variant)]), mimeType: 'image/jpeg' }, signal)
      expect(result.status, `reference ${variant + 1}: ${result.reason}`).toBe('identified')
      expect(result.identity?.originalId).toBe(original.identity?.originalId)
    }
    const independent = await index.identifyAsync({ bytes: png(scene(81, 128, 96)), mimeType: 'image/png' }, signal)
    expect(independent.status).toBe('identified')
    expect(independent.identity?.originalId).not.toBe(original.identity?.originalId)
    const pixels = decode(bytes, { useTArray: true })
    const excerpt = crop({ ...pixels, data: Buffer.from(pixels.data) }, 17, 13, 91, 65)
    const derivative = await index.identifyAsync({ bytes: png(excerpt), mimeType: 'image/png' }, signal)
    expect(derivative.status).toBe('identified')
    expect(derivative.identity?.originalId).toBe(original.identity?.originalId)
  }, 25000)

  it('keeps asynchronous results identical for originals, derivatives, ambiguity and rejection', async () => {
    const sync = new ImageIdentityIndex(), asynchronous = new ImageIdentityIndex(), raster = scene()
    const original = png(raster)
    const inputs: ImageIdentityInput[] = [
      { bytes: original, mimeType: 'image/png' },
      { bytes: Buffer.from(original), mimeType: 'image/png' },
      { bytes: png(raster, 0), mimeType: 'image/png' },
      { bytes: jpeg(resize(crop(raster, 41, 29, 157, 119), 314, 238)), mimeType: 'image/jpeg' },
      { bytes: jpeg(annotated(raster)), mimeType: 'image/jpeg' },
      { bytes: png(scene(81)), mimeType: 'image/png' },
      { bytes: png(solid(230)), mimeType: 'image/png' },
      { bytes: png(solid(232)), mimeType: 'image/png' },
      { bytes: Buffer.from('not an image'), mimeType: 'image/png' },
    ]
    const expected = inputs.map(input => sync.identify(input))
    expect(expected.map(result => result.status)).toEqual([
      'identified', 'identified', 'identified', 'identified', 'identified', 'identified', 'identified', 'ambiguous', 'rejected',
    ])
    const actual = []
    for (const input of inputs) actual.push(await asynchronous.identifyAsync(input))
    expect(actual).toEqual(expected)
  })

  it('yields between reference comparisons and never retains a cancelled input', async () => {
    const index = new ImageIdentityIndex(), controller = new AbortController()
    for (const seed of [7, 81, 139]) expect(index.identify({ bytes: png(scene(seed)), mimeType: 'image/png' }).status).toBe('identified')
    const input: ImageIdentityInput = { bytes: png(scene(241)), mimeType: 'image/png' }
    const pending = index.identifyAsync(input, controller.signal)
    let turns = 0
    const abort = () => { if (++turns === 2) controller.abort(); else setImmediate(abort) }
    setImmediate(abort)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(turns).toBe(2)
    const afterCancellation = index.identify(input)
    expect(afterCancellation.status).toBe('identified')
    expect(afterCancellation.identity?.verification).toBe('decoded-pixels')
  })

  it('honours an already cancelled request without inserting its exact pixels', async () => {
    const index = new ImageIdentityIndex(), controller = new AbortController()
    const input: ImageIdentityInput = { bytes: png(scene()), mimeType: 'image/png' }
    controller.abort()
    await expect(index.identifyAsync(input, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(index.identify(input).identity?.verification).toBe('decoded-pixels')
  })

  it('recognizes renamed bytes without depending on names or asset ids', () => {
    const index = new ImageIdentityIndex(), bytes = png(scene())
    const first = index.identify({ bytes, mimeType: 'image/png' })
    const renamed = index.identify({ bytes: Buffer.from(bytes), mimeType: 'image/png' })
    expect(first.status).toBe('identified')
    expect(renamed.identity?.originalId).toBe(first.identity?.originalId)
    expect(renamed.identity?.verification).toBe('file-hash')
    expect(first.identity?.fileSha256).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('unifies independently encoded PNG streams with the same decoded pixels', () => {
    const index = new ImageIdentityIndex(), raster = scene()
    const first = index.identify({ bytes: png(raster, 0), mimeType: 'image/png' })
    const reencoded = index.identify({ bytes: png(raster, 9), mimeType: 'image/png' })
    expect(reencoded.identity?.fileSha256).not.toBe(first.identity?.fileSha256)
    expect(reencoded.identity?.originalId).toBe(first.identity?.originalId)
    expect(reencoded.identity?.verification).toBe('decoded-pixels')
    expect(reencoded.identity?.pixelFingerprint).toBe(first.identity?.pixelFingerprint)
  })

  it('confirms resized and JPEG-recompressed derivatives from spatial pixel agreement', () => {
    const index = new ImageIdentityIndex(), raster = scene()
    const first = index.identify({ bytes: png(raster), mimeType: 'image/png' })
    const derivative = index.identify({ bytes: jpeg(resize(raster, 384, 288), 68), mimeType: 'image/jpeg' })
    expect(derivative.status).toBe('identified')
    expect(derivative.identity?.originalId).toBe(first.identity?.originalId)
    expect(derivative.identity?.derivedFromSha256).toBe(first.identity?.fileSha256)
    expect(derivative.identity?.verification).toBe('verified-derivative')
  })

  it('finds an off-centre crop, including after scaling and JPEG encoding', () => {
    const index = new ImageIdentityIndex(), raster = scene()
    const first = index.identify({ bytes: png(raster), mimeType: 'image/png' })
    const derivative = index.identify({ bytes: jpeg(resize(crop(raster, 41, 29, 157, 119), 314, 238)), mimeType: 'image/jpeg' })
    expect(derivative.status).toBe('identified')
    expect(derivative.identity?.originalId).toBe(first.identity?.originalId)
    expect(derivative.candidates.some(candidate => candidate.kind === 'crop' && candidate.confirmed)).toBe(true)
    expect(derivative.identity?.derivedFromSha256).toBe(first.identity?.fileSha256)
  })

  it('recognizes a downscaled photograph without requiring the same sampling filter', () => {
    const index = new ImageIdentityIndex(), raster = scene()
    const first = index.identify({ bytes: png(raster), mimeType: 'image/png' })
    const derivative = index.identify({ bytes: jpeg(resize(raster, 160, 120), 72), mimeType: 'image/jpeg' })
    expect(derivative.status).toBe('identified')
    expect(derivative.identity?.originalId).toBe(first.identity?.originalId)
  })

  it('confirms a crop of an actual bundled photograph and keeps another real photograph independent', () => {
    const index = new ImageIdentityIndex()
    const records = Object.values(BUNDLED_CASE_STUDY_IMAGES)
    const bytes = Buffer.from(records[0]!, 'base64'), decoded = decode(bytes, { useTArray: true })
    const raster = { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) }
    const first = index.identify({ bytes, mimeType: 'image/jpeg' })
    const derivative = index.identify({ bytes: jpeg(resize(crop(raster, 97, 63, 691, 411), 830, 493), 64), mimeType: 'image/jpeg' })
    expect(first.status).toBe('identified')
    expect(derivative.status).toBe('identified')
    expect(derivative.identity?.originalId).toBe(first.identity?.originalId)
    const independent = index.identify({ bytes: Buffer.from(records[1]!, 'base64'), mimeType: 'image/jpeg' })
    expect(independent.status).toBe('identified')
    expect(independent.identity?.originalId).not.toBe(first.identity?.originalId)
  })

  it('recognizes the full original after an earlier crop without inventing reverse derivation provenance', () => {
    const index = new ImageIdentityIndex(), raster = scene()
    const earlierCrop = index.identify({ bytes: png(crop(raster, 41, 29, 157, 119)), mimeType: 'image/png' })
    const original = index.identify({ bytes: png(raster), mimeType: 'image/png' })
    expect(original.status).toBe('identified')
    expect(original.identity?.originalId).toBe(earlierCrop.identity?.originalId)
    expect(original.identity?.derivedFromSha256).toBeUndefined()
    expect(original.candidates.some(candidate => candidate.inputBounds !== undefined)).toBe(true)
  })

  it('holds a very small excerpt for review rather than inventing a new allocatable family', () => {
    const index = new ImageIdentityIndex(), raster = scene()
    index.identify({ bytes: png(raster), mimeType: 'image/png' })
    const excerpt = index.identify({ bytes: png(crop(raster, 44, 40, 32, 24)), mimeType: 'image/png' })
    expect(excerpt.status).toBe('ambiguous')
    expect(excerpt.identity).toBeUndefined()
    expect(excerpt.reason).toBe('insufficient-detail')
  })

  it('does not choose an arbitrary family when a shared excerpt fits two otherwise independent images', () => {
    const index = new ImageIdentityIndex(), firstRaster = scene(), secondRaster = scene(81)
    const shared = crop(firstRaster, 41, 29, 128, 80)
    for (let row = 0; row < shared.height; row++) shared.data.copy(secondRaster.data,
      ((row + 77) * secondRaster.width + 101) * 4, row * shared.width * 4, (row + 1) * shared.width * 4)
    const first = index.identify({ bytes: png(firstRaster), mimeType: 'image/png' })
    const second = index.identify({ bytes: png(secondRaster), mimeType: 'image/png' })
    expect(second.status).toBe('identified')
    expect(second.identity?.originalId).not.toBe(first.identity?.originalId)
    const excerpt = index.identify({ bytes: png(shared), mimeType: 'image/png' })
    expect(excerpt.status).toBe('ambiguous')
    expect(excerpt.reason).toBe('conflicting-families')
    expect(excerpt.identity).toBeUndefined()
    expect(new Set(excerpt.candidates.filter(candidate => candidate.confirmed).map(candidate => candidate.originalId)).size).toBe(2)
  })

  it('counts an added caption as a derivative when most distinctive image content is unchanged', () => {
    const index = new ImageIdentityIndex(), raster = scene()
    const first = index.identify({ bytes: png(raster), mimeType: 'image/png' })
    const derivative = index.identify({ bytes: jpeg(annotated(raster)), mimeType: 'image/jpeg' })
    expect(derivative.status).toBe('identified')
    expect(derivative.identity?.originalId).toBe(first.identity?.originalId)
    expect(derivative.candidates.some(candidate => candidate.kind === 'annotation' && candidate.confirmed)).toBe(true)
  })

  it('keeps independently composed scenes separate despite the same palette and subject vocabulary', () => {
    const index = new ImageIdentityIndex()
    const first = index.identify({ bytes: png(scene(7)), mimeType: 'image/png' })
    const independent = index.identify({ bytes: png(scene(81)), mimeType: 'image/png' })
    expect(independent.identity?.originalId).not.toBe(first.identity?.originalId)
    expect(independent.candidates.some(candidate => candidate.confirmed)).toBe(false)
  })

  it('reports low-information similarity as ambiguous instead of merging uniform placeholders', () => {
    const index = new ImageIdentityIndex()
    index.identify({ bytes: png(solid(230)), mimeType: 'image/png' })
    const candidate = index.identify({ bytes: png(solid(232)), mimeType: 'image/png' })
    expect(candidate.status).toBe('ambiguous')
    expect(candidate.identity).toBeUndefined()
    expect(candidate.candidates).toHaveLength(1)
    expect(candidate.candidates[0]?.confirmed).toBe(false)
  })

  it('still holds a structurally matching but unconfirmed tonal change for review', () => {
    const index = new ImageIdentityIndex(), raster = scene(), changed = { ...raster, data: Buffer.from(raster.data) }
    for (let p = 0; p < changed.data.length; p++) if (p % 4 !== 3) changed.data[p] = Math.min(255, changed.data[p]! + 5)
    index.identify({ bytes: png(raster), mimeType: 'image/png' })
    const candidate = index.identify({ bytes: png(changed), mimeType: 'image/png' })
    expect(candidate.status).toBe('ambiguous')
    expect(candidate.reason).toBe('similarity-requires-review')
    expect(candidate.candidates.some(match => !match.confirmed)).toBe(true)
  })

  it.each([[1024, 768], [768, 1024]])('never confirms independent %i by %i noise images from their near-identical area averages', (width, height) => {
    const index = new ImageIdentityIndex()
    const first = index.identify({ bytes: png(noise(0, width, height)), mimeType: 'image/png' })
    const independent = index.identify({ bytes: png(noise(1, width, height)), mimeType: 'image/png' })
    expect(first.status).toBe('identified')
    expect(independent.identity?.originalId).not.toBe(first.identity?.originalId)
    expect(independent.candidates.some(candidate => candidate.confirmed)).toBe(false)
  })

  it('still recognizes exact decoded noise pixels after lossless re-encoding', () => {
    const index = new ImageIdentityIndex(), raster = noise()
    const first = index.identify({ bytes: png(raster, 0), mimeType: 'image/png' })
    const reencoded = index.identify({ bytes: png(raster, 9), mimeType: 'image/png' })
    expect(reencoded.identity?.fileSha256).not.toBe(first.identity?.fileSha256)
    expect(reencoded.identity?.originalId).toBe(first.identity?.originalId)
    expect(reencoded.identity?.verification).toBe('decoded-pixels')
  })

  it('does not allow declared lineage to force an unrelated image into a family', () => {
    const index = new ImageIdentityIndex()
    const first = index.identify({ bytes: png(scene()), mimeType: 'image/png' })
    const unrelated = index.identify({ bytes: png(scene(81)), mimeType: 'image/png', derivedFromSha256: first.identity!.fileSha256 })
    expect(unrelated.status).toBe('ambiguous')
    expect(unrelated.identity).toBeUndefined()
    expect(unrelated.reason).toBe('unverified-derivation')
  })

  it('rejects truncated or corrupt streams even when their headers expose plausible dimensions', () => {
    const bytes = png(scene()), index = new ImageIdentityIndex()
    const corrupt = Buffer.from(bytes); corrupt[Math.floor(corrupt.length / 2)]! ^= 0xff
    for (const candidate of [bytes.subarray(0, bytes.length - 12), corrupt, Buffer.from('not an image')]) {
      const result = index.identify({ bytes: candidate, mimeType: 'image/png' })
      expect(result.status).toBe('rejected')
      expect(result.identity).toBeUndefined()
      expect(result.reason).toBe('invalid-image')
    }
  })

  it('rejects MIME mismatches, excessive byte length and oversized pixel headers before decoding', () => {
    const index = new ImageIdentityIndex()
    expect(index.identify({ bytes: png(scene()), mimeType: 'image/jpeg' }).reason).toBe('invalid-image')
    expect(index.identify({ bytes: Buffer.alloc(32 * 1024 * 1024 + 1), mimeType: 'image/png' }).reason).toBe('image-too-large')
    const huge = png(scene()); huge.writeUInt32BE(1000000, 16)
    expect(index.identify({ bytes: huge, mimeType: 'image/png' }).reason).toBe('image-too-large')
  })

  it('requires a real pixel decoder for WebP rather than certifying a header or a file hash', () => {
    const result = new ImageIdentityIndex().identify({ bytes: Buffer.from('RIFFplaceholderWEBP'), mimeType: 'image/webp' })
    expect(result.status).toBe('rejected')
    expect(result.reason).toBe('decoder-required')
    expect(result.identity).toBeUndefined()
  })
})
