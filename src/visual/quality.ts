import type { VisualQualityRecord } from '../governance/types.ts'
import type { VisualQualityInput } from './types.ts'

export interface VisualQualityPolicy {
  readonly minWidth: number
  readonly minHeight: number
  readonly allowedMimeTypes: readonly string[]
}

const DEFAULT_POLICY: VisualQualityPolicy = {
  minWidth: 1024,
  minHeight: 768,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
}

export function checkVisualQuality(
  input: VisualQualityInput,
  policy: VisualQualityPolicy = DEFAULT_POLICY,
): VisualQualityRecord {
  const issues: string[] = []
  if (!policy.allowedMimeTypes.includes(input.mimeType)) issues.push(`不支持的图片格式：${input.mimeType}`)
  if (input.bytes <= 0) issues.push('图片文件为空')
  if (input.width < policy.minWidth) issues.push(`图片宽度低于 ${policy.minWidth}px`)
  if (input.height < policy.minHeight) issues.push(`图片高度低于 ${policy.minHeight}px`)
  return {
    accepted: issues.length === 0,
    score: Math.max(0, 1 - issues.length * 0.25),
    issues,
  }
}
