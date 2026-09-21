import type { LlmRoute, ModelRoute } from './types.ts'

// Bridge to the DSH ComfyUI plugin already installed by the user. Endpoints,
// workflow files and credentials remain owned by that plugin's DSH settings.
export const COMFYUI_IMAGE_TOOL = 'comfyui_pic'
export function imageToolForRoute(route: LlmRoute | null | undefined): string | undefined {
  return route?.provider === 'Comfyui-PIC' && route.model === 'Klein' ? COMFYUI_IMAGE_TOOL : undefined
}
export function executionModelRoute(route: ModelRoute): LlmRoute {
  if (!imageToolForRoute(route)) return { provider: route.provider, model: route.model }
  if (!route.llm) throw new Error('MODEL_COMPANION_REQUIRED: ComfyUI 是生图工具，请同时选择配套 LLM。')
  return { provider: route.llm.provider, model: route.llm.model }
}
