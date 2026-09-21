import { describe, expect, it } from 'vitest'
import { checkVisualQuality } from '../src/visual/quality.ts'

describe('visual quality', () => {
  it('rejects tiny or empty images and accepts a report-ready raster', () => {
    expect(checkVisualQuality({ mimeType: 'image/png', width: 64, height: 64, bytes: 12 })).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining(['图片总像素低于 786432px']),
    })
    expect(checkVisualQuality({ mimeType: 'image/png', width: 1600, height: 900, bytes: 400_000 })).toEqual({
      accepted: true, score: 1, issues: [],
    })
  })
  it.each([[896, 1680], [1600, 720], [2048, 608]])('accepts a full-resolution %i by %i original without imposing landscape orientation', (width, height) => {
    expect(checkVisualQuality({ mimeType: 'image/png', width, height, bytes: 400_000 }).accepted).toBe(true)
  })
  it.each([[1280, 480], [320, 4096], [900, 900], [NaN, 1024]])('rejects insufficient or invalid %i by %i originals', (width, height) => {
    expect(checkVisualQuality({ mimeType: 'image/png', width, height, bytes: 400_000 }).accepted).toBe(false)
  })
  it('preserves explicitly supplied fixed-axis limits', () => {
    expect(checkVisualQuality({ mimeType: 'image/png', width: 896, height: 1680, bytes: 400_000 }, {
      minWidth: 1024, minHeight: 768, allowedMimeTypes: ['image/png'],
    })).toMatchObject({ accepted: false, issues: ['图片宽度低于 1024px'] })
  })
})
