import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { reportImageDimensions } from '../src/report/regular/image-dimensions.ts'
import { verifiedRasterImageDimensions } from '../src/governance/site-boundary-asset-store.ts'
import { BUNDLED_CASE_STUDY_IMAGES } from '../src/report/case-studies/catalog-images.ts'

describe('public report photograph dimensions', () => {
  const paddedEntry = Object.entries(BUNDLED_CASE_STUDY_IMAGES).find(([, encoded]) => Buffer.from(encoded, 'base64').at(-1) === 0)!
  const bytes = Buffer.from(paddedEntry[1], 'base64')

  it('reads a verified photograph with trailing NUL padding without changing its evidence bytes', () => {
    const dimensions = reportImageDimensions('image/jpeg', bytes)
    expect(dimensions.width).toBeGreaterThan(500)
    expect(dimensions.height).toBeGreaterThan(300)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(paddedEntry[0])
    expect(bytes.at(-1)).toBe(0)
    expect(() => verifiedRasterImageDimensions('image/jpeg', bytes)).toThrow('invalid image/jpeg')
  })

  it('still rejects truncated streams, non-NUL suffixes and an incorrect media type', () => {
    let end = bytes.length
    while (bytes[end - 1] === 0) end--
    expect(() => reportImageDimensions('image/jpeg', bytes.subarray(0, end - 2))).toThrow('invalid image/jpeg')
    expect(() => reportImageDimensions('image/jpeg', Buffer.concat([bytes, Buffer.from('invalid')]))).toThrow('invalid image/jpeg')
    expect(() => reportImageDimensions('image/png', bytes)).toThrow('invalid image/png')
  })
})
