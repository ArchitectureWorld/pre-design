import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODEL_CATALOG, defaultPolicy, validatePolicy, validateSnapshot } from '../src/model-policy.mjs'

const sense = model => ({ provider: 'SenseNova', model })
const official = model => ({ provider: 'deepseek-official', model })
const find = (policy, key) => policy.models.find(item => item.provider === key.provider && item.model === key.model)
const invalid = action => assert.throws(action, error => error.statusCode === 400)
const ready = () => {
  const policy = defaultPolicy()
  const primary = find(policy, sense('sensenova-6.8-flash-lite'))
  primary.status = 'verified'
  primary.capabilities = { text: true, tools: true, vision: true, image: false }
  return policy
}

test('normalizes the fourteen allowed identities without merging independent budgets', () => {
  const policy = validatePolicy(defaultPolicy())
  assert.deepEqual(policy.models.map(({ provider, model }) => [provider, model]), [
    ['SenseNova', 'sensenova-6.7-flash-lite'], ['SenseNova', 'sensenova-6.8-flash-lite'],
    ['SenseNova', 'deepseek-v4-flash'], ['SenseNova', 'deepseek-v4-pro'],
    ['SenseNova', 'glm-5.2'], ['SenseNova', 'kimi-k3'],
    ['deepseek-official', 'deepseek-flash'], ['deepseek-official', 'deepseek-v4-flash'],
    ['deepseek-official', 'deepseek-v4-pro'], ['deepseek-official', 'deepseek-v4-flash-vision-exp'],
    ['Comfyui-PIC', 'Klein'], ['启航引擎AIGC组', 'tt-image-2.5'],
    ['启航引擎AIGC组', 'tt-image-2.5-flare'], ['启航引擎AIGC组', 'tt-image-2.5-sunburst'],
  ])
  assert.deepEqual(policy.models.slice(0, 6).map(({ contextWindow, maxOutputTokens }) => [contextWindow, maxOutputTokens]), [
    [262144, 65536], [262144, 65536], [1048576, 65536], [1048576, 65536], [1048576, 131072], [1048576, 131072],
  ])
  assert.deepEqual(policy.models.slice(6, 10).map(({ contextWindow, maxOutputTokens }) => [contextWindow, maxOutputTokens]), [
    [undefined, 393216], [undefined, 393216], [undefined, 393216], [undefined, 393216],
  ])
  assert.equal(find(policy, sense('kimi-k3')).compat.maxTokensField, 'max_completion_tokens')
  assert.equal(find(policy, { provider: 'Comfyui-PIC', model: 'Klein' }).imageConfig.modelFile, 'Flux2-Klein-9B-True-v2-bf16.safetensors')
  assert.ok(MODEL_CATALOG.every(item => item.source && item.declaredCapabilities && item.status === 'unverified'))
  assert.equal(find(policy, official('deepseek-v4-flash-vision-exp')).capabilities.vision, false)
  find(policy, sense('deepseek-v4-pro')).maxOutputTokens = 32000
  const normalized = validatePolicy(policy)
  assert.equal(find(normalized, official('deepseek-v4-pro')).maxOutputTokens, 393216)
})

test('default routes keep suggested primaries unverified and do not invent fallbacks', () => {
  const first = defaultPolicy(), second = defaultPolicy()
  for (const role of ['parent', 'text', 'web', 'vision', 'imageLlm']) {
    assert.deepEqual(first.routes[role], { primary: sense('sensenova-6.8-flash-lite'), fallbacks: [] })
  }
  assert.deepEqual(first.routes.image, { primary: { provider: 'Comfyui-PIC', model: 'Klein' }, fallbacks: [] })
  assert.deepEqual(first.limits, { globalConcurrency: 2, perUserConcurrency: 1, maxQueuedPerUser: 10, maxDailyJobsPerUser: 20 })
  assert.ok(first.models.every(item => item.status === 'unverified'))
  first.models[0].capabilities.text = false
  assert.equal(second.models[0].capabilities.text, true)
  assert.equal(MODEL_CATALOG[0].declaredCapabilities.text, true)
})

test('rejects missing, duplicated or foreign model identities and excluded runtime providers', () => {
  const cases = [
    policy => policy.models.pop(),
    policy => { policy.models[1] = structuredClone(policy.models[0]) },
    policy => { policy.models[0].provider = 'OpenAI' },
    policy => { policy.models[0].model = 'gpt-6-astra' },
  ]
  for (const change of cases) { const policy = defaultPolicy(); change(policy); invalid(() => validatePolicy(policy)) }
  for (const provider of ['openai-codex', 'windows-ollama', 'remote-Ollama', 'Antigravity', 'yaoguang02-gpt-6-astra', 'with-chatgpt', '瑶光Codex', 'OPENAI', 'ＯｐｅｎＡＩ']) {
    const policy = defaultPolicy(); policy.models[0].runtimeProvider = provider
    invalid(() => validatePolicy(policy))
  }
  const mapped = defaultPolicy()
  mapped.models[0].runtimeProvider = 'sensenova-linux'
  mapped.models[0].compat = { protocol: 'openai-completions', maxTokensField: 'max_tokens' }
  assert.equal(validatePolicy(mapped).models[0].runtimeProvider, 'sensenova-linux')
})

test('strict schemas reject secret values, extra fields and invalid budgets without mutating input', () => {
  const changes = [
    policy => { policy.reasoningEffort = 'xhigh' },
    policy => { policy.models[0].apiKey = 'not-a-real-secret' },
    policy => { policy.models[0].capabilities.network = true },
    policy => { policy.models[0].compat = { unknown: true } },
    policy => { policy.models[0].credentialRef = 'not-a-credential-reference' },
    policy => { policy.models[0].contextWindow = 0 },
    policy => { policy.models[0].maxOutputTokens = 262145 },
    policy => { find(policy, sense('kimi-k3')).compat.maxTokensField = 'max_tokens' },
    policy => { policy.routes.text.extra = true },
    policy => { policy.routes.reasoning = { primary: null, fallbacks: [] } },
    policy => { policy.limits.maxDailyJobsPerUser = -1 },
    policy => { policy.limits.unlimited = true },
    policy => { policy.revision = 1.5 },
  ]
  for (const change of changes) { const policy = defaultPolicy(); change(policy); invalid(() => validatePolicy(policy)) }
  const policy = defaultPolicy()
  policy.models[0].credentialRef = 'credential:sensenova-linux'
  const before = JSON.stringify(policy), normalized = validatePolicy(policy)
  assert.equal(normalized.models[0].credentialRef, 'credential:sensenova-linux')
  normalized.models[0].maxOutputTokens = 20
  assert.equal(JSON.stringify(policy), before)
})

test('normalization cannot drop handed-over budgets or collapse different sources into one runtime provider', () => {
  const changes = [
    policy => { delete policy.models[0].contextWindow },
    policy => { delete policy.models[0].maxOutputTokens },
    policy => { delete find(policy, official('deepseek-v4-pro')).maxOutputTokens },
    policy => { policy.models[0].runtimeProvider = 'shared-adapter'; policy.models[6].runtimeProvider = 'shared-adapter' },
    policy => { policy.models[6].runtimeProvider = 'sensenova' },
  ]
  for (const change of changes) { const policy = defaultPolicy(); change(policy); invalid(() => validatePolicy(policy)) }
})

test('routes reject excluded keys, duplicate candidates and incompatible verified models', () => {
  const changes = [
    policy => { policy.routes.parent.primary = { provider: 'OpenAI', model: 'gpt-6-astra' } },
    policy => { policy.routes.imageLlm.primary = { provider: 'Comfyui-PIC', model: 'Klein' } },
    policy => { policy.routes.vision.primary = sense('deepseek-v4-pro') },
    policy => { policy.routes.text.fallbacks = [sense('sensenova-6.8-flash-lite')] },
    policy => { policy.routes.text.fallbacks = [sense('deepseek-v4-pro')] },
    policy => { find(policy, sense('sensenova-6.8-flash-lite')).capabilities.tools = false },
    policy => { const entry = find(policy, official('deepseek-v4-pro')); entry.status = 'verified'; policy.routes.vision.fallbacks = [official('deepseek-v4-pro')] },
  ]
  for (const change of changes) { const policy = ready(); change(policy); invalid(() => validatePolicy(policy)) }
  const policy = ready(), entry = find(policy, official('deepseek-v4-pro'))
  entry.status = 'verified'; entry.capabilities.tools = true
  policy.routes.text.fallbacks = [official('deepseek-v4-pro')]
  assert.deepEqual(validatePolicy(policy).routes.text.fallbacks, [official('deepseek-v4-pro')])
  policy.routes.text.fallbacks.push(official('deepseek-v4-pro'))
  invalid(() => validatePolicy(policy))
})

test('text primary and fallback require tool capability for native structured submissions', () => {
  for (const placement of ['primary', 'fallback']) {
    const policy = ready(), textOnly = find(policy, official('deepseek-v4-pro'))
    textOnly.status = 'verified'
    assert.deepEqual(textOnly.capabilities, { text: true, tools: false, vision: false, image: false })
    if (placement === 'primary') policy.routes.text.primary = official('deepseek-v4-pro')
    else policy.routes.text.fallbacks = [official('deepseek-v4-pro')]
    invalid(() => validatePolicy(policy))
    invalid(() => validateSnapshot(policy, ['text']))
    textOnly.capabilities.tools = true
    assert.doesNotThrow(() => validateSnapshot(policy, ['text']))
  }
})

test('research cannot enqueue or reserve quota with a persisted verified text model lacking tools', async t => {
  const [{ default: pg }, { createApp }, { mkdtemp, rm }, { tmpdir }, { join }, { randomUUID }] = await Promise.all([
    import('pg'), import('../src/server.mjs'), import('node:fs/promises'), import('node:os'), import('node:path'), import('node:crypto'),
  ])
  const connection = { host: '/tmp/pre-design-pg-1000', port: 55439, database: 'pre_design_web', user: 'zetta' }
  const schema = `text_tools_${randomUUID().replaceAll('-', '')}`, pool = new pg.Pool(connection)
  await pool.query(`CREATE SCHEMA ${schema}`)
  const db = new pg.Pool({ ...connection, options: `-c search_path=${schema}` }), root = await mkdtemp(join(tmpdir(), 'pre-text-tools-'))
  let app, runs = 0
  t.after(async () => {
    try { await app?.close() } finally { await db.end(); await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); await rm(root, { recursive: true, force: true }) }
  })
  const contexts = new Map(), workers = {
    async call(project, body) {
      if (body.operation === 'create') contexts.set(project.id, { project: { projectId: project.id, currentRevision: 0 }, stateObjects: [], proposals: [], revisions: [] })
      if (body.operation === 'research-plan') return { catalog: { chapters: [], modules: [{ id: '1.01', title: '项目基本情况' }] }, plan: { activeModuleIds: ['1.01'], pendingModuleIds: [], blockedModuleIds: [] } }
      return structuredClone(contexts.get(project.id))
    },
    async runResearch() { runs++; return { status: 'partial', selectedModuleIds: ['1.01'], modules: [], limitations: [] } },
    async closeAll() {},
  }
  const token = randomUUID()
  app = await createApp({ db, workers, projectsRoot: root, users: [{ id: 'operator', token, role: 'admin' }] })
  const request = (url, payload) => app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload })
  const created = await request('/api/projects', { requestId: randomUUID(), name: '工具能力边界测试' })
  assert.equal(created.statusCode, 200, created.body)
  const policy = ready(), textOnly = find(policy, official('deepseek-v4-pro'))
  textOnly.status = 'verified'; policy.routes.text.primary = official('deepseek-v4-pro')
  // Simulates a version saved under the previous text-only capability contract.
  await db.query('UPDATE platform_policy_versions SET policy=$1 WHERE revision=1', [policy])
  const response = await request(`/api/projects/${created.json().id}/research`, { requestId: randomUUID(), baseRevision: 0, moduleIds: ['1.01'],
    flags: { industryPlanning: false, existingBuildings: false, externalPartners: false, marketing: false } })
  assert.equal(response.statusCode, 400, response.body)
  assert.equal(response.json().code, 'INVALID_MODEL_POLICY')
  await app.waitForJobs()
  assert.equal((await db.query('SELECT count(*)::int AS count FROM jobs')).rows[0].count, 0)
  assert.equal((await db.query('SELECT count(*)::int AS count FROM job_reservations')).rows[0].count, 0)
  assert.equal(runs, 0)
})

test('execution checks only required roles and returns independent immutable snapshots', () => {
  const draft = defaultPolicy()
  assert.doesNotThrow(() => validatePolicy(draft))
  assert.throws(() => validateSnapshot(draft), error => error.statusCode === 503 && error.code === 'MODEL_POLICY_NOT_READY' && error.notReady[0].role === 'parent')
  const policy = ready(), snapshot = validateSnapshot(policy, ['parent', 'text', 'web', 'vision'])
  policy.limits.globalConcurrency = 10
  assert.equal(snapshot.limits.globalConcurrency, 2)
  assert.throws(() => { snapshot.limits.globalConcurrency = 7 }, TypeError)
  assert.throws(() => { snapshot.routes.parent.primary.model = 'gpt-6-astra' }, TypeError)
  assert.throws(() => validateSnapshot(policy, ['image']), error => error.statusCode === 503 && error.notReady.some(item => item.role === 'image'))
  assert.doesNotThrow(() => validateSnapshot(draft, []))
  invalid(() => validateSnapshot(policy, ['unknown']))
  invalid(() => validateSnapshot(policy, ['parent', 'parent']))
})

test('Klein execution requires a verified companion LLM and preserves workflow references', () => {
  const policy = defaultPolicy(), klein = find(policy, { provider: 'Comfyui-PIC', model: 'Klein' })
  klein.status = 'verified'
  klein.imageConfig.textToImageWorkflow = 'workflows/klein-text.json'
  klein.imageConfig.referenceImageWorkflow = 'workflows/klein-edit.json'
  assert.throws(() => validateSnapshot(policy, ['image']), error => error.statusCode === 503 && error.notReady.some(item => item.role === 'imageLlm'))
  const primary = find(policy, sense('sensenova-6.8-flash-lite'))
  primary.status = 'verified'; primary.capabilities.tools = true
  const snapshot = validateSnapshot(policy, ['image'])
  assert.equal(find(snapshot, { provider: 'Comfyui-PIC', model: 'Klein' }).imageConfig.referenceImageWorkflow, 'workflows/klein-edit.json')
  policy.routes.parent.primary = null
  assert.throws(() => validateSnapshot(policy, ['parent']), error => error.statusCode === 503 && error.notReady[0].reason === 'missing_primary')
})
