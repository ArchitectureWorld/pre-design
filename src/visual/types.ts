import type { ContentBlock } from '@deepseek-ai/dsh-llm'

export const VISUAL_SUBAGENT_PROVIDER = 'spawn' as const
export const VISUAL_MODEL_PROVIDER = 'antigravity' as const
export const VISUAL_MODEL_ID = 'gemini-3.1-flash-image' as const

export interface VisualGenerationTask {
  readonly taskId: string
  readonly projectId: string
  readonly chapterId: string
  readonly workItemId: string
  readonly kind: 'concept'
  readonly required: boolean
  readonly prompt: string
  readonly projectStyle?: string
  readonly referenceAssetIds?: readonly string[]
  readonly referenceContent?: readonly ContentBlock[]
}

export interface VisualImageData {
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  readonly data: string | Uint8Array
  readonly width?: number
  readonly height?: number
  readonly attachmentId?: string
}

export interface VisualQualityInput {
  readonly mimeType: string
  readonly width: number
  readonly height: number
  readonly bytes: number
}
