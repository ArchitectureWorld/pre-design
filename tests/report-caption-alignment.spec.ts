import { expect, it } from 'vitest'
import { displayedImageRect, captionAnchor } from '../src/report/caption-alignment.ts'

it('anchors captions to the visible contained image rather than its wider slot', () => {
  const image = displayedImageRect({ x: 100, y: 200, width: 800, height: 400 }, 400, 800, 'contain')
  expect(image).toEqual({ x: 400, y: 200, width: 200, height: 400 })
  expect(captionAnchor(image, 'left')).toBe(400)
  expect(captionAnchor(image, 'right')).toBe(600)
  expect(captionAnchor(image, 'center')).toBe(500)
})
it('uses the cropped display boundary for a cover image and rejects invalid dimensions', () => {
  expect(displayedImageRect({ x: 10, y: 20, width: 600, height: 300 }, 400, 800, 'cover')).toEqual({ x: 10, y: 20, width: 600, height: 300 })
  expect(() => displayedImageRect({ x: 0, y: 0, width: 1, height: 1 }, 0, 0, 'contain')).toThrow()
})
