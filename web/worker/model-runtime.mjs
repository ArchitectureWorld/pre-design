import { validateSnapshot } from '../app/src/model-policy.mjs'
import { researchError } from '../app/src/research-contract.mjs'
import { materializeImageRuntime } from './image-runtime.mjs'

const keyOf = row => `${row.provider}\0${row.model}`
const classRoles = { text: 'text', web: 'web', review: 'vision' }
export function isolatedEnvironment(source = process.env) {
  return Object.fromEntries(['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'FONTCONFIG_PATH'].filter(key => typeof source[key] === 'string').map(key => [key, source[key]]))
}
export function materializeModelRuntime(snapshot, settings = {}, credentials = {}, requiredRoles = ['parent']) {
  const result = { providers: {}, env: {}, parent: null, classRoutes: { text: null, web: null, review: null, image: null },
    classFallbacks: { text: [], web: [], review: [], image: [] }, imageAvailability: { status: 'not_ready', code: 'IMAGE_POLICY_NOT_READY', reason: '本次任务未配置图像服务。' }, imageBackend: null }
  if (!snapshot) return result
  const policy = validateSnapshot(snapshot, requiredRoles)
  if (requiredRoles.includes('image')) {
    const image = materializeImageRuntime(policy, credentials, { required: true })
    result.imageAvailability = image.imageAvailability; result.imageBackend = image.imageBackend
    Object.assign(result.env, image.env)
  }
  const models = new Map(policy.models.map(row => [keyOf(row), row]))
  const configured = Array.isArray(settings) ? settings.find(row => row.id === 'llm-pi-ai')?.config?.providers : settings?.['llm-pi-ai']?.providers
  const active = new Map()
  const chain = role => {
    const route = policy.routes[role]
    if (!route.primary) return []
    const rows = [route.primary, ...route.fallbacks].map(ref => models.get(keyOf(ref)))
    if (rows.some(row => row.status !== 'verified')) return []
    return rows.map(row => { active.set(keyOf(row), row); return { provider: row.runtimeProvider, model: row.model } })
  }
  const parents = chain('parent'); result.parent = parents[0] ?? null
  for (const [classId, role] of Object.entries(classRoles)) {
    const routes = requiredRoles.includes(role) ? chain(role) : []
    result.classRoutes[classId] = routes[0] ?? null; result.classFallbacks[classId] = routes.slice(1)
  }
  if (requiredRoles.includes('image')) {
    const companions = chain('imageLlm')
    result.classRoutes.image = { provider: 'Comfyui-PIC', model: 'Klein', llm: companions[0] }
  }
  let credentialIndex = 0
  const runtimeIdentities = new Set()
  for (const row of active.values()) {
    const identity = `${row.runtimeProvider}\0${row.model}`
    if (runtimeIdentities.has(identity)) throw researchError('MODEL_RUNTIME_IDENTITY_COLLISION', '不同模型身份不能映射到同一个实际路由。')
    runtimeIdentities.add(identity)
    const source = configured?.[row.runtimeProvider]
    if (!source?.apiKeyEnv || !source.api || !source.baseURL) throw researchError('MODEL_NOT_READY', 'MODEL_NOT_READY: 目标模型路由尚未配置协议、地址或凭据引用。', 503)
    const ref = row.credentialRef ?? source.apiKeyEnv
    const bare = String(ref).replace(/^credential:/u, '')
    if (bare !== String(source.apiKeyEnv).replace(/^credential:/u, '')) throw researchError('MODEL_NOT_READY', 'MODEL_NOT_READY: 目标模型凭据引用与配置不一致。', 503)
    const credential = credentials?.refs?.[ref] ?? credentials?.refs?.[bare]
    if (typeof credential !== 'string' || !credential.trim()) throw researchError('MODEL_NOT_READY', 'MODEL_NOT_READY: 指定凭据不存在。', 503)
    let provider = result.providers[row.runtimeProvider]
    const protocol = row.compat?.protocol ?? source.api
    if (!['openai-completions', 'openai-responses', 'anthropic-messages'].includes(protocol)) throw researchError('MODEL_NOT_READY', 'MODEL_NOT_READY: 模型协议尚未适配。', 503)
    if (!provider) {
      const envKey = `PRE_WEB_MODEL_CREDENTIAL_${credentialIndex++}`
      result.env[envKey] = credential
      provider = result.providers[row.runtimeProvider] = { api: protocol, baseURL: source.baseURL, apiKeyEnv: envKey, models: [], ...(source.headers ? { headers: source.headers } : {}) }
    } else if (provider.api !== protocol) throw researchError('MODEL_NOT_READY', 'MODEL_NOT_READY: 同一实际路由的协议不一致。', 503)
    const original = source.models?.find(model => model.id === row.model) ?? {}
    const { protocol: _protocol, ...compat } = row.compat ?? {}
    provider.models.push({ id: row.model, ...(row.contextWindow ? { contextWindow: row.contextWindow } : {}),
      ...(row.maxOutputTokens ? { maxTokens: row.maxOutputTokens } : {}), input: row.capabilities.vision ? ['text', 'image'] : ['text'],
      ...(original.reasoningEfforts === undefined ? {} : { reasoningEfforts: original.reasoningEfforts }),
      ...((source.compat || original.compat || Object.keys(compat).length) ? { compat: { ...source.compat, ...original.compat, ...compat } } : {}) })
  }
  return result
}

export async function installModelBoundary(ctx, { sessionId, snapshot, classRoutes, classFallbacks }) {
  const policy = snapshot ? validateSnapshot(snapshot, ['parent']) : undefined
  const models = new Map(policy?.models.map(row => [keyOf(row), row]) ?? [])
  const allowed = new Map()
  const classReferences = Object.entries(classRoutes ?? {}).flatMap(([classId, route]) => route ? [route, ...(classFallbacks?.[classId] ?? [])] : [])
  const activeIdentities = new Set(classReferences.map(row => row.llm ?? row).map(row => `${row.provider}\0${row.model}`))
  for (const ref of policy ? [policy.routes.parent.primary, ...policy.routes.parent.fallbacks] : []) {
    const row = models.get(keyOf(ref)); activeIdentities.add(`${row.runtimeProvider}\0${row.model}`)
  }
  for (const role of ['parent', 'text', 'web', 'vision', 'imageLlm']) {
    const route = policy?.routes[role]
    if (!route?.primary) continue
    const rows = [route.primary, ...route.fallbacks].map(ref => models.get(keyOf(ref)))
    if (rows.some(row => row.status !== 'verified')) continue
    for (const row of rows) if (activeIdentities.has(`${row.runtimeProvider}\0${row.model}`)) allowed.set(`${row.runtimeProvider}\0${row.model}`, row)
  }
  const parents = policy ? [policy.routes.parent.primary, ...policy.routes.parent.fallbacks].map(ref => models.get(keyOf(ref))) : []
  let parentIndex = 0
  const deny = () => { throw researchError('MODEL_ROUTE_FORBIDDEN', 'MODEL_ROUTE_FORBIDDEN: 任务模型调用不属于固定快照。', 503) }
  ctx.on('agent/request', async ({ agent }, next) => {
    if (!policy) throw researchError('MODEL_NOT_READY', 'MODEL_NOT_READY: 只读 Worker 未配置模型任务。', 503)
    const previous = await next()
    const row = String(agent.id) === sessionId ? parents[parentIndex] : allowed.get(`${previous.provider}\0${previous.model}`)
    if (!row) return deny()
    // Replace the entire controls object: a restored session must not retain old effort/output overrides.
    return { provider: row.runtimeProvider, model: row.model, ...(row.maxOutputTokens ? { maxTokens: row.maxOutputTokens } : {}) }
  }, { prepend: true })
  ctx.on('agent/request-error', async ({ agent, provider, failure }, next) => {
    const current = parents[parentIndex]
    if (String(agent.id) === sessionId && current?.runtimeProvider === provider && parentIndex + 1 < parents.length
      && ['AUTH', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL', 'NO_ADAPTER', 'MODEL_NOT_FOUND', 'PROVIDER_NOT_FOUND', 'QUOTA', 'TRANSPORT', 'NETWORK', 'CONNECTION', 'RATE_LIMIT', 'SERVER'].includes(failure?.code)) {
      parentIndex += 1
      return { kind: 'retry' }
    }
    return next()
  }, { prepend: true })
  ctx.on('llm/stream', async function* (options, next) {
    const row = allowed.get(`${options.provider}\0${options.model}`)
    if (!row || row.status !== 'verified') deny()
    if (row.maxOutputTokens && options.maxTokens > row.maxOutputTokens) deny()
    yield* next()
  }, { prepend: true })
  const classes = ctx.preplanning.agentClasses
  await classes.save(classes.settings().revision, classRoutes ?? { text: null, web: null, review: null, image: null }, classFallbacks ?? { text: [], web: [], review: [], image: [] })
}
