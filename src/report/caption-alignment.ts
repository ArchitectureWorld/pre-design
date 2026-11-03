export interface ImageRectangle { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export type CaptionAlignment = 'left' | 'right' | 'center'
export interface CaptionAnchor { readonly figureId: string; readonly align: CaptionAlignment }

export function displayedImageRect(slot: ImageRectangle, naturalWidth: number, naturalHeight: number, fit: 'contain' | 'cover'): ImageRectangle {
  if (![slot.x, slot.y, slot.width, slot.height, naturalWidth, naturalHeight].every(Number.isFinite)
    || Math.min(slot.width, slot.height, naturalWidth, naturalHeight) <= 0) throw new Error('REPORT_IMAGE_GEOMETRY_INVALID')
  if (fit === 'cover') return { ...slot }
  const scale = Math.min(slot.width / naturalWidth, slot.height / naturalHeight)
  const width = naturalWidth * scale, height = naturalHeight * scale
  return { x: slot.x + (slot.width - width) / 2, y: slot.y + (slot.height - height) / 2, width, height }
}
export function captionAnchor(image: ImageRectangle, align: CaptionAlignment): number {
  return image.x + (align === 'right' ? image.width : align === 'center' ? image.width / 2 : 0)
}
