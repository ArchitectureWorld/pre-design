import { z } from 'zod'
import { FLUX3_IMAGE_CONFIG, DEFAULT_SEARCH_POLICY } from './service-defaults.mjs'

const fail = (statusCode, message, details = {}) => Object.assign(new Error(message), { statusCode, ...details })
const clone = value => JSON.parse(JSON.stringify(value))
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item)
    Object.freeze(value)
  }
  return value
}
const keyOf = ({ provider, model }) => JSON.stringify([provider, model])
const capabilities = (text, vision = false, image = false) => ({ text, tools: false, vision, image })
const yaoguang = { provider: 'yaoguang-codex', model: 'yaoguang02-gpt-6-astra' }
const yaoguangKey = keyOf(yaoguang)
const sources = { SenseNova: 'SenseNova', 'deepseek-official': 'DeepSeek 官方', 'Comfyui-PIC': 'ComfyUI', '启航引擎AIGC组': '启航引擎 AIGC 组', 'yaoguang-codex': '瑶光' }
function entry(provider, model, declaredCapabilities, extra = {}) {
  return { source: sources[provider], provider, model, runtimeProvider: provider, status: 'unverified', declaredCapabilities,
    capabilities: { ...declaredCapabilities }, ...extra }
}

// These are the handed-over declarations, not successful capability probes.
export const MODEL_CATALOG = freeze([
  entry('SenseNova', 'sensenova-6.7-flash-lite', capabilities(true, true), { contextWindow: 262144, maxOutputTokens: 65536 }),
  entry('SenseNova', 'sensenova-6.8-flash-lite', capabilities(true, true), { contextWindow: 262144, maxOutputTokens: 65536 }),
  entry('SenseNova', 'deepseek-v4-flash', capabilities(true), { contextWindow: 1048576, maxOutputTokens: 65536 }),
  entry('SenseNova', 'deepseek-v4-pro', capabilities(true), { contextWindow: 1048576, maxOutputTokens: 65536 }),
  entry('SenseNova', 'glm-5.2', capabilities(true), { contextWindow: 1048576, maxOutputTokens: 131072 }),
  entry('SenseNova', 'kimi-k3', capabilities(true), { contextWindow: 1048576, maxOutputTokens: 131072, compat: { maxTokensField: 'max_completion_tokens' } }),
  entry('deepseek-official', 'deepseek-flash', capabilities(true), { maxOutputTokens: 393216 }),
  entry('deepseek-official', 'deepseek-v4-flash', capabilities(true), { maxOutputTokens: 393216 }),
  entry('deepseek-official', 'deepseek-v4-pro', capabilities(true), { maxOutputTokens: 393216 }),
  entry('deepseek-official', 'deepseek-v4-flash-vision-exp', capabilities(true), { maxOutputTokens: 393216 }),
  entry('Comfyui-PIC', 'Klein', capabilities(false, false, true), { imageConfig: { ...FLUX3_IMAGE_CONFIG } }),
  entry('启航引擎AIGC组', 'tt-image-2.5', capabilities(false, false, true)),
  entry('启航引擎AIGC组', 'tt-image-2.5-flare', capabilities(false, false, true)),
  entry('启航引擎AIGC组', 'tt-image-2.5-sunburst', capabilities(false, false, true)),
  entry(yaoguang.provider, yaoguang.model, capabilities(true), { maxOutputTokens: 8192, compat: { protocol: 'openai-responses' } }),
])
const catalogByKey = new Map(MODEL_CATALOG.map(item => [keyOf(item), item]))
const historicalCatalogKeys = MODEL_CATALOG.filter(item => keyOf(item) !== yaoguangKey).map(keyOf)
const roles = ['parent', 'text', 'web', 'vision', 'image', 'imageLlm']
const roleCapabilities = {
  // Research and chapter text agents submit through the native structured_output tool.
  parent: ['text', 'tools'], text: ['text', 'tools'], web: ['text', 'tools'],
  vision: ['text', 'vision'], image: ['image'], imageLlm: ['text', 'tools'],
}
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const capabilitiesSchema = z.object({ text: z.boolean(), tools: z.boolean(), vision: z.boolean(), image: z.boolean() }).strict()
const identifier = z.string().min(1).max(160).regex(/^[\p{L}\p{N}_.:@/-]+$/u)
const modelKeySchema = z.object({ provider: identifier, model: identifier }).strict()
const routeSchema = z.object({ primary: modelKeySchema.nullable(), fallbacks: z.array(modelKeySchema).max(MODEL_CATALOG.length - 1) }).strict()
const workflowRef = z.string().min(1).max(512).regex(/^[^\x00-\x1f\x7f]+$/u)
const credentialRef = z.string().regex(/^credential:[\p{L}\p{N}][\p{L}\p{N}_.-]{0,127}$/u)
const serviceURL = z.string().min(1).max(2048).refine(value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && !/\s/u.test(value) }
  catch { return false }
})
const modelSchema = z.object({
  source: z.string().min(1).max(80).optional(),
  provider: identifier, model: identifier, runtimeProvider: identifier,
  status: z.enum(['unverified', 'verified', 'unavailable']),
  declaredCapabilities: capabilitiesSchema.optional(), capabilities: capabilitiesSchema,
  contextWindow: positiveInteger.optional(), maxOutputTokens: positiveInteger.optional(),
  compat: z.object({ maxTokensField: z.enum(['max_tokens', 'max_completion_tokens']).optional(),
    protocol: z.enum(['openai-completions', 'openai-responses']).optional() }).strict().optional(),
  credentialRef: credentialRef.optional(),
  // Legacy metadata remains readable in immutable historical task snapshots.
  // The runtime accepts only the pinned Flux3 workflows for new image execution.
  imageConfig: z.object({ modelFile: z.enum(['flux3-image-klein-bf16.safetensors', 'Flux2-Klein-9B-True-v2-bf16.safetensors']),
    textToImageWorkflow: workflowRef.optional(), referenceImageWorkflow: workflowRef.optional(),
    baseURL: serviceURL.optional(), timeoutMs: z.number().int().min(1000).max(3600000).optional(),
    pollIntervalMs: z.number().int().min(100).max(10000).optional() }).strict().optional(),
}).strict()
const searchLimits = { enabled: z.boolean(), maxResults: z.number().int().min(1).max(50),
  maxQueries: z.number().int().min(1).max(8), timeoutMs: z.number().int().min(1000).max(120000) }
const policySchema = z.object({
  revision: positiveInteger.optional(), models: z.array(modelSchema).min(historicalCatalogKeys.length).max(MODEL_CATALOG.length),
  routes: z.object(Object.fromEntries(roles.map(role => [role, routeSchema]))).strict(),
  limits: z.object({ globalConcurrency: positiveInteger, perUserConcurrency: positiveInteger,
    maxQueuedPerUser: positiveInteger, maxDailyJobsPerUser: positiveInteger }).strict(),
  search: z.discriminatedUnion('provider', [
    z.object({ ...searchLimits, provider: z.literal('deepseek-search-api'), baseURL: serviceURL, credentialRef: credentialRef.optional() }).strict(),
    z.object({ ...searchLimits, provider: z.literal('ddg') }).strict(),
    z.object({ ...searchLimits, provider: z.literal('bing') }).strict(),
    z.object({ ...searchLimits, provider: z.literal('exa') }).strict(),
  ]).optional(),
}).strict()

export function defaultPolicy() {
  const main = { provider: 'SenseNova', model: 'sensenova-6.8-flash-lite' }
  return {
    revision: 1, models: clone(MODEL_CATALOG),
    routes: Object.fromEntries(roles.map(role => [role, {
      primary: role === 'image' ? { provider: 'Comfyui-PIC', model: 'Klein' } : { ...main }, fallbacks: [],
    }])),
    limits: { globalConcurrency: 2, perUserConcurrency: 1, maxQueuedPerUser: 10, maxDailyJobsPerUser: 20 },
    search: { ...DEFAULT_SEARCH_POLICY },
  }
}

// Called only while creating a new policy revision, never while reading a task.
export function migrateServicePolicy(input) {
  const next = clone(input)
  let changed = false
  if (!next.search) { next.search = { ...DEFAULT_SEARCH_POLICY }; changed = true }
  const image = next.models.find(row => row.provider === 'Comfyui-PIC' && row.model === 'Klein')
  if (image?.imageConfig?.modelFile === 'Flux2-Klein-9B-True-v2-bf16.safetensors') {
    image.imageConfig = { ...FLUX3_IMAGE_CONFIG }
    image.status = 'unverified'
    // A previous Flux2 verification cannot qualify as a Flux3 fallback.
    next.routes.image.fallbacks = next.routes.image.fallbacks.filter(row => row.provider !== 'Comfyui-PIC')
    changed = true
  }
  if (!next.models.some(row => keyOf(row) === yaoguangKey)) {
    next.models.push(clone(catalogByKey.get(yaoguangKey)))
    changed = true
  }
  return changed ? validatePolicy(next) : null
}

function invalid(message) { throw fail(400, message, { code: 'INVALID_MODEL_POLICY' }) }
function parsePolicy(input) {
  const parsed = policySchema.safeParse(input)
  if (!parsed.success) invalid('模型策略字段、凭据引用或预算格式不合法')
  return parsed.data
}

export function validatePolicy(input) {
  const policy = parsePolicy(input)
  const models = new Map(), runtimeSources = new Map()
  for (const item of policy.models) {
    const key = keyOf(item), registered = catalogByKey.get(key)
    if (!registered || models.has(key)) invalid('模型目录必须保留历史 14 项与已授权的瑶光02身份，不能重复或引入其他来源')
    const exactYaoguang = key === yaoguangKey
    if (exactYaoguang && (item.runtimeProvider !== registered.runtimeProvider || item.compat?.protocol !== 'openai-responses')) {
      invalid('瑶光02必须保留精确运行提供方与 openai-responses 协议')
    }
    if (!exactYaoguang && /(?:antigravity|ollama|openai|chatgpt|codex|yaoguang|gpt|gemini|qwen|瑶光)/iu.test(item.runtimeProvider.normalize('NFKC'))) {
      invalid('运行提供方映射不能指向被排除的来源')
    }
    const runtimeIdentity = item.runtimeProvider.normalize('NFKC').toLowerCase()
    const knownSource = Object.keys(sources).find(provider => provider.normalize('NFKC').toLowerCase() === runtimeIdentity)
    const previousSource = runtimeSources.get(runtimeIdentity)
    if ((knownSource && knownSource !== item.provider) || (previousSource && previousSource !== item.provider)) invalid('运行提供方映射不能改变或合并模型来源身份')
    runtimeSources.set(runtimeIdentity, item.provider)
    if (item.source !== undefined && item.source !== registered.source) invalid('模型来源不能被改写')
    if (item.declaredCapabilities && Object.keys(registered.declaredCapabilities).some(capability => item.declaredCapabilities[capability] !== registered.declaredCapabilities[capability])) {
      invalid('交接声明不可改写；实际验证能力应保存在 capabilities')
    }
    item.source = registered.source
    item.declaredCapabilities = { ...registered.declaredCapabilities }
    if ((registered.contextWindow !== undefined && item.contextWindow === undefined) || (registered.maxOutputTokens !== undefined && item.maxOutputTokens === undefined)) invalid('已交接的模型预算不能被删除')
    if (item.contextWindow !== undefined && item.maxOutputTokens !== undefined && item.maxOutputTokens > item.contextWindow) invalid('模型输出预算不能超过其上下文预算')
    if (item.provider === 'SenseNova' && item.model === 'kimi-k3' && item.compat?.maxTokensField !== 'max_completion_tokens') invalid('Kimi 必须保留 max_completion_tokens 兼容字段')
    if (item.provider === 'Comfyui-PIC' && !item.imageConfig) invalid('Klein 必须保留图像模型文件配置')
    if (item.provider !== 'Comfyui-PIC' && item.imageConfig) invalid('该模型不接受 Klein 工作流配置')
    models.set(key, item)
  }
  // Legacy task snapshots keep their complete fourteen identities without mutation.
  if (historicalCatalogKeys.some(key => !models.has(key))) invalid('模型目录不能删除或替换历史 14 项来源和模型身份')
  for (const role of roles) {
    const route = policy.routes[role], seen = new Set()
    if (!route.primary && route.fallbacks.length) invalid('未选择主模型时不能配置备用链')
    for (const [index, reference] of [route.primary, ...route.fallbacks].entries()) {
      if (!reference) continue
      const key = keyOf(reference), model = models.get(key)
      if (!model) invalid('角色路由只能引用允许目录中的模型')
      if (seen.has(key)) invalid('同一角色的主备模型不能重复')
      seen.add(key)
      // Draft primaries may await tool probes, but image and text roles must not be mixed.
      const required = roleCapabilities[role].filter(capability => capability !== 'tools' || model.status === 'verified' || index > 0)
      if (required.some(capability => !model.capabilities[capability])) invalid('角色路由与模型能力不匹配')
      if (index > 0 && model.status !== 'verified') invalid('备用模型必须已验证，不能自动启用待验证或不可用模型')
    }
  }
  return clone(policy)
}

export function validateSnapshot(input, requiredRoles = ['parent']) {
  if (!Array.isArray(requiredRoles) || requiredRoles.some(role => !roles.includes(role)) || new Set(requiredRoles).size !== requiredRoles.length) invalid('任务要求的模型角色不合法')
  if (!Number.isSafeInteger(input?.revision) || input.revision < 1) invalid('任务模型快照缺少有效配置版本')
  const policy = validatePolicy(input)
  const required = new Set(requiredRoles), models = new Map(policy.models.map(item => [keyOf(item), item]))
  if (required.has('image') && [policy.routes.image.primary, ...policy.routes.image.fallbacks].some(item => item?.provider === 'Comfyui-PIC' && item.model === 'Klein')) required.add('imageLlm')
  const notReady = []
  for (const role of required) {
    const route = policy.routes[role]
    if (!route.primary) { notReady.push({ role, reason: 'missing_primary' }); continue }
    for (const reference of [route.primary, ...route.fallbacks]) {
      const model = models.get(keyOf(reference))
      if (model.status !== 'verified') notReady.push({ role, reason: model.status })
      else if (roleCapabilities[role].some(capability => !model.capabilities[capability])) notReady.push({ role, reason: 'missing_capability' })
    }
  }
  if (notReady.length) throw fail(503, `模型策略未就绪：${[...new Set(notReady.map(item => item.role))].join('、')}`, { code: 'MODEL_POLICY_NOT_READY', notReady })
  return freeze(clone(policy))
}
