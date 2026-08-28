import { describe, expect, it } from 'vitest'
import { checkVisualQuality } from '../src/visual/quality.ts'

describe('visual quality', () => {
  it('rejects tiny or empty images and accepts a report-ready raster', () => {
    expect(checkVisualQuality({ mimeType: 'image/png', width: 64, height: 64, bytes: 12 })).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining(['图片宽度低于 1024px', '图片高度低于 768px']),
    })
    expect(checkVisualQuality({ mimeType: 'image/png', width: 1600, height: 900, bytes: 400_000 })).toEqual({
      accepted: true, score: 1, issues: [],
    })
  })
})
