import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { verifiedSourceImageDimensions } from '../src/materials/source-image-validation.ts'
import { verifiedRasterImageDimensions } from '../src/governance/site-boundary-asset-store.ts'

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const jpeg = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#527876' } }).jpeg().toBuffer()
const trailer = Buffer.from('camera-private-data\x00\x03\x07')

describe('source photograph stream validation', () => {
  it('fully decodes a JPEG with trailing camera data without trimming the source or relaxing boundary uploads', async () => {
    const bytes = Buffer.concat([await jpeg(), trailer]), before = hash(bytes)
    expect(() => verifiedRasterImageDimensions('image/jpeg', bytes)).toThrow()
    await expect(verifiedSourceImageDimensions('image/jpeg', bytes)).resolves.toEqual({ width: 40, height: 30 })
    expect(hash(bytes)).toBe(before)
  })
  it('rejects a truncated scan even when it has an end marker and camera suffix', async () => {
    const bytes = await jpeg(), sos = bytes.indexOf(Buffer.from([0xff, 0xda]))
    const damaged = Buffer.concat([bytes.subarray(0, sos + 12), Buffer.from([0xff, 0xd9]), trailer])
    await expect(verifiedSourceImageDimensions('image/jpeg', damaged)).rejects.toThrow()
  })
  it('rejects missing end markers and false image types', async () => {
    const bytes = await jpeg()
    await expect(verifiedSourceImageDimensions('image/jpeg', bytes.subarray(0, -2))).rejects.toThrow()
    await expect(verifiedSourceImageDimensions('image/png', Buffer.concat([bytes, trailer]))).rejects.toThrow()
  })
  it('keeps ordinary raster dimensions and rejects PNG suffixes', async () => {
    const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#abc' } }).png().toBuffer()
    await expect(verifiedSourceImageDimensions('image/png', bytes)).resolves.toEqual({ width: 20, height: 10 })
    await expect(verifiedSourceImageDimensions('image/png', Buffer.concat([bytes, trailer]))).rejects.toThrow()
  })
})
