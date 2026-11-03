export const FLUX3_IMAGE_CONFIG = Object.freeze({
  modelFile: 'flux3-image-klein-bf16.safetensors',
  textToImageWorkflow: 'flux3-klein-t2i@2026-11-03.1',
  referenceImageWorkflow: 'flux3-klein-i2i@2026-11-03.1',
  timeoutMs: 600000, pollIntervalMs: 1000,
})
export const DEFAULT_SEARCH_POLICY = Object.freeze({
  enabled: false, provider: 'deepseek-search-api', baseURL: 'https://api.deepseek.com/v1/tools',
  maxResults: 8, maxQueries: 4, timeoutMs: 30000,
})
