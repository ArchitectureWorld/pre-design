import type { VisualQualityRecord } from '../governance/types.ts'
import type { VisualQualityInput } from './types.ts'

export interface VisualQualityPolicy {
  readonly minWidth: number
  readonly minHeight: number
  readonly allowedMimeTypes: readonly string[]
  readonly dimensionMode?: 'fixed' | 'equivalent-area'
}

export const VISUAL_RASTER_QUALITY_VERSION = 'equivalent-area-v1'
const DEFAULT_POLICY: VisualQualityPolicy = {
  minWidth: 1024,
  minHeight: 768,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  dimensionMode: 'equivalent-area',
}

export function checkVisualQuality(
  input: VisualQualityInput,
  policy: VisualQualityPolicy = DEFAULT_POLICY,
): VisualQualityRecord {
  const issues: string[] = []
  if (!policy.allowedMimeTypes.includes(input.mimeType)) issues.push(`不支持的图片格式：${input.mimeType}`)
  if (input.bytes <= 0) issues.push('图片文件为空')
  if (!Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height) || input.width <= 0 || input.height <= 0) {
    issues.push('图片尺寸无效')
  } else if (policy.dimensionMode === 'equivalent-area') {
    // A portrait or panoramic original must retain the same pixel budget as a
    // 1024 × 768 landscape. Placement DPI and subject/crop checks remain separate.
    const longEdge = Math.max(policy.minWidth, policy.minHeight)
    const shortEdge = Math.ceil(Math.min(policy.minWidth, policy.minHeight) / 2)
    if (Math.max(input.width, input.height) < longEdge) issues.push(`图片长边低于 ${longEdge}px`)
    if (Math.min(input.width, input.height) < shortEdge) issues.push(`图片短边低于 ${shortEdge}px`)
    if (input.width * input.height < policy.minWidth * policy.minHeight) issues.push(`图片总像素低于 ${policy.minWidth * policy.minHeight}px`)
  } else {
    if (input.width < policy.minWidth) issues.push(`图片宽度低于 ${policy.minWidth}px`)
    if (input.height < policy.minHeight) issues.push(`图片高度低于 ${policy.minHeight}px`)
  }
  return {
    accepted: issues.length === 0,
    score: Math.max(0, 1 - issues.length * 0.25),
    issues,
  }
}
