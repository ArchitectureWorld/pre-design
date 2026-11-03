import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../worker/package.json', import.meta.url))
const [{ Context }, { default: WebRuntime }, direct, httpFetch, toolWeb, { default: ToolRuntime }, { default: SystemPrompt }, launch] = await Promise.all([
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-web', '@deepseek-ai/dsh-web-deepseek-api', '@deepseek-ai/dsh-web-fetch-http',
  '@deepseek-ai/dsh-tool-web', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-launch-environment',
].map(name => import(require.resolve(name))))
const runtime = await import('../../worker/search-runtime.mjs').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error })
const secret = 'fixture-search-key-only'
const policyFor = baseURL => ({ enabled: true, provider: 'deepseek-search-api', baseURL, credentialRef: 'credential:SEARCH_TEST', maxResults: 8, maxQueries: 4, timeoutMs: 30000 })
const credentials = { refs: { SEARCH_TEST: secret, OTHER: 'must-not-copy' } }
const volatile = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, { get: () => object[key] }]))
const results = [
  { url: 'https://example.org/official?a=1&b=2', title: '原始标题', snippet: '原始摘要，不允许生成补充来源。', date: '2026-11-02' },
  { url: 'https://example.net/source', title: '', snippet: '', date: null },
]
const expectedSources = [
  { url: 'https://example.org/official?a=1&b=2', title: '原始标题', snippet: '原始摘要，不允许生成补充来源。', publishedAt: '2026-11-02' },
  { url: 'https://example.net/source' },
]

async function fixture(t) {
  const requests = [], pending = new Map()
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk
    const body = text ? JSON.parse(text) : {}
    requests.push({ path: req.url, method: req.method, authorization: req.headers.authorization, body })
    pending.get(body.query)?.(); pending.delete(body.query)
    if (body.query === 'wait') return
    res.setHeader('content-type', 'application/json')
    if (body.query === 'unauthorized') { res.statusCode = 401; res.end(JSON.stringify({ error: secret })); return }
    if (body.query === 'server-error') { res.statusCode = 503; res.end(JSON.stringify({ error: 'service unavailable' })); return }
    if (body.query === 'redirect') { res.statusCode = 302; res.setHeader('location', '/must-not-follow'); res.end('{}'); return }
    if (body.query === 'malformed') { res.end(JSON.stringify({ results: [{ url: 'invented', title: 'missing fields' }] })); return }
    res.end(JSON.stringify({ results: body.query === 'empty' ? [] : results }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  return { baseURL: `http://127.0.0.1:${server.address().port}/api/v1/tools`, requests,
    received: query => new Promise(resolve => pending.set(query, resolve)) }
}

function mounted(t, policy, { environment, boundary = true, materialized, onAudit } = {}) {
  const output = materialized ?? runtime.materializeSearchRuntime(policy, credentials)
  const ctx = new Context(), audits = [], sessionEvents = []
  ctx.provide('launchEnvironment', launch.createLaunchEnvironmentSnapshot([
    { source: 'process', values: environment ?? output.env },
    { source: 'project-env', values: { DEEPSEEK_API_KEY: 'ambient-key', PRE_WEB_SEARCH_CREDENTIAL: 'project-key' } },
  ]))
  let credentialReads = 0, accountReads = 0
  ctx.provide('credentials', { resolve: async () => { credentialReads += 1; return { value: 'stored-ambient-key' } } })
  ctx.provide('deepseekAccount', { resolveToken: async () => { accountReads += 1; return 'account-ambient-key' } })
  ctx.provide('agents', { currentInitiator: () => ({ session: {
    requestContext: () => ({ provider: 'deepseek-account' }),
    deriveMessages: () => [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '完整用户问题绝不能随查询隐式发送' }] }],
    append: (name, data) => sessionEvents.push({ name, data }),
  } }) })
  const webConfig = { ...output.patches.find(patch => patch.id === 'web').config }
  const apiPatch = output.patches.find(patch => patch.id === 'web-deepseek-api')
  const apiConfig = { ...apiPatch.config }
  new WebRuntime(ctx, volatile(webConfig))
  if (!apiPatch.disabled) direct.apply(ctx, volatile(apiConfig))
  httpFetch.apply(ctx, httpFetch.Config({}))
  new SystemPrompt(ctx, {})
  new ToolRuntime(ctx)
  toolWeb.apply(ctx, toolWeb.Config(output.patches.find(patch => patch.id === 'tool-web').config))
  if (boundary) runtime.installSearchBoundary(ctx, { searchPolicy: policy, availability: output.availability,
    onAudit: onAudit ?? (entry => audits.push(entry)) })
  t.after(() => ctx.fiber.dispose())
  return { ctx, output, audits, sessionEvents, webConfig, apiConfig,
    credentialReads: () => credentialReads, accountReads: () => accountReads,
    search: (queries, signal = new AbortController().signal) => ctx.tools.get('web_search').execute({ queries }, { signal }) }
}

test('缺搜索配置或目标凭据时明确未就绪，且不会启用 Messages 搜索或复制环境凭据', t => {
  assert.equal(typeof runtime.materializeSearchRuntime, 'function')
  for (const policy of [undefined, policyFor(''), { ...policyFor('https://example.org/tools'), provider: 'deepseek-official' },
    { ...policyFor('https://example.org/tools'), maxQueries: 9 }, { ...policyFor('https://example.org/tools'), timeoutMs: Infinity },
    policyFor('https://user:secret@example.org/tools'), policyFor('https://example.org/tools?key=secret')]) {
    const output = runtime.materializeSearchRuntime(policy, credentials)
    assert.equal(output.availability.status, 'not_ready')
    assert.deepEqual(output.env, {})
    assert.equal(output.patches.find(patch => patch.id === 'web-search-deepseek').disabled, true)
    const host = mounted(t, policy, { materialized: output })
    assert.equal(host.ctx.tools.get('web_search'), undefined)
    assert.ok(host.ctx.tools.get('web_fetch'))
  }
  const missing = runtime.materializeSearchRuntime(policyFor('https://example.org/tools'), { refs: { DEEPSEEK_API_KEY: 'ambient' } })
  assert.equal(missing.availability.status, 'not_ready'); assert.deepEqual(missing.env, {})
  assert.equal(runtime.materializeSearchRuntime({ enabled: false }, credentials).availability.status, 'disabled')
})

test('仅将选中凭据注入专用环境，配置和可用性不包含密钥', () => {
  const output = runtime.materializeSearchRuntime(policyFor('https://example.org/api/v1/tools/'), credentials)
  assert.equal(output.availability.status, 'ready')
  assert.equal(output.availability.endpoint, 'https://example.org/api/v1/tools/search')
  assert.deepEqual(Object.values(output.env), [secret])
  assert.equal(JSON.stringify({ patches: output.patches, availability: output.availability }).includes(secret), false)
  assert.deepEqual(runtime.materializeSearchRuntime(policyFor('https://example.org/tools'), { refs: { 'credential:SEARCH_TEST': secret } }).env, output.env)
})

test('平台凭据引用中的中文、数字起始、点和短横线映射为合法专用环境名', () => {
  for (const key of ['检索密钥', '3search', 'team.search-key']) {
    for (const refKey of [key, `credential:${key}`]) {
      const output = runtime.materializeSearchRuntime({ ...policyFor('https://example.org/tools'), credentialRef: `credential:${key}` }, { refs: { [refKey]: secret } })
      assert.equal(output.availability.status, 'ready')
      assert.deepEqual(output.env, { PRE_WEB_SEARCH_CREDENTIAL: secret })
    }
  }
})

test('真实 DSH 工具和 provider 只 POST 专用 search 端点，保留来源并关闭账户及完整问题附送', async t => {
  const http = await fixture(t), host = mounted(t, policyFor(http.baseURL))
  const output = await host.search(['真实查询'])
  assert.deepEqual(output, { sources: expectedSources, truncated: false })
  assert.deepEqual(http.requests, [{ path: '/api/v1/tools/search', method: 'POST', authorization: `Bearer ${secret}`,
    body: { query: '真实查询', count: 8, need_content: false } }])
  assert.equal(host.credentialReads(), 0); assert.equal(host.accountReads(), 0)
  assert.equal(host.sessionEvents.some(event => /llm/u.test(event.name)), false)
  assert.deepEqual(host.audits.map(entry => entry.phase), ['started', 'succeeded'])
  assert.equal(host.audits[1].sourceCount, 2)
  assert.equal(JSON.stringify(host.audits).includes(secret), false)
})

test('空结果保持成功空来源，不生成补充链接；工具参数和结果数量受限', async t => {
  const http = await fixture(t), host = mounted(t, { ...policyFor(http.baseURL), maxResults: 1, maxQueries: 2 })
  assert.deepEqual(await host.search(['empty']), { sources: [], truncated: false })
  assert.deepEqual(await host.search(['one']), { sources: expectedSources.slice(0, 1), truncated: true })
  assert.equal(http.requests[1].body.count, 1)
  await assert.rejects(host.search(['one', 'two', 'three']), /at most/u)
  await assert.rejects(host.search([' ']), /non-empty/u)
  assert.equal(http.requests.length, 2)
  await host.search(['same', 'same'])
  assert.equal(http.requests.length, 3)
})

test('任务启动后策略和 DSH 设置变化不能将搜索端点或账户凭据带到另一条路由', async t => {
  const http = await fixture(t), policy = policyFor(http.baseURL), host = mounted(t, policy)
  policy.baseURL = 'http://127.0.0.1:1/stolen'
  host.webConfig.searchProvider = 'deepseek-official'
  host.apiConfig.baseURL = 'http://127.0.0.1:1/stolen'
  host.apiConfig.apiKey = 'later-key'
  host.apiConfig.sendOriginalQuestion = true
  assert.deepEqual(await host.search(['frozen']), { sources: expectedSources, truncated: false })
  assert.equal(http.requests.length, 1)
  assert.equal(http.requests[0].authorization, `Bearer ${secret}`)
  assert.equal(host.credentialReads(), 0); assert.equal(host.accountReads(), 0)
})

test('上游鉴权、服务器、畸形响应和重定向失败原样保留失败语义，不重试或泄漏上游文本', async t => {
  const http = await fixture(t), host = mounted(t, policyFor(http.baseURL))
  for (const query of ['unauthorized', 'server-error', 'malformed', 'redirect']) {
    await assert.rejects(host.search([query]), error => error.code === 'WEB_PROVIDER_ERROR' && !String(error).includes(secret))
  }
  assert.equal(http.requests.length, 4)
  assert.equal(http.requests.every(row => row.path === '/api/v1/tools/search'), true)
  assert.equal(host.audits.filter(row => row.phase === 'failed').length, 4)
  assert.equal(host.audits.some(row => row.phase === 'succeeded'), false)
  assert.equal(JSON.stringify(host.audits).includes(secret), false)
})

test('取消在请求前阻止派发，在请求中终止等待；独立超时不转为成功', async t => {
  const http = await fixture(t), host = mounted(t, policyFor(http.baseURL)), controller = new AbortController()
  controller.abort(new Error('cancel'))
  await assert.rejects(host.search(['before'], controller.signal), { code: 'WEB_ABORTED' })
  assert.equal(http.requests.length, 0)
  const active = new AbortController(), arrived = http.received('wait'), search = host.search(['wait'], active.signal)
  await arrived; active.abort(new Error('cancel'))
  await assert.rejects(search, { code: 'WEB_ABORTED' })
  assert.equal(http.requests.length, 1)
  const timeoutHost = mounted(t, { ...policyFor(http.baseURL), timeoutMs: 25 })
  await assert.rejects(timeoutHost.search(['wait']), { code: 'WEB_TIMEOUT' })
  assert.equal(timeoutHost.audits.some(row => row.phase === 'succeeded'), false)
})

test('专用进程凭据缺失时不读取项目环境、存储凭据或账户，也不发网络请求', async t => {
  const http = await fixture(t), host = mounted(t, policyFor(http.baseURL), { environment: {} })
  await assert.rejects(host.search(['missing']), { code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  assert.equal(http.requests.length, 0)
  assert.equal(host.credentialReads(), 0); assert.equal(host.accountReads(), 0)
  assert.deepEqual(host.audits.map(row => row.phase), ['started', 'failed'])
})

test('凭据缺失的任务快照保留准确未就绪原因', async t => {
  const http = await fixture(t), policy = policyFor(http.baseURL)
  const output = runtime.materializeSearchRuntime(policy, { refs: {} })
  const host = mounted(t, policy, { materialized: output })
  await assert.rejects(host.ctx.web.search({ query: 'bypass' }), error => error.code === 'WEB_SEARCH_NOT_READY' && /凭据不存在/u.test(error.message))
  assert.equal(http.requests.length, 0)
})

test('服务请求附带 provider、地址或凭据覆盖均不能改变实际派发，取消诊断不保留原因或 headers', async t => {
  const http = await fixture(t), host = mounted(t, policyFor(http.baseURL))
  await host.ctx.web.search({ query: 'override', provider: 'deepseek-official', baseURL: 'http://127.0.0.1:1/messages', apiKey: 'stolen', originalQuestion: 'full prompt', maxResults: 999 })
  assert.deepEqual(http.requests[0].body, { query: 'override', count: 8, need_content: false })
  assert.equal(http.requests[0].authorization, `Bearer ${secret}`)
  const active = new AbortController(), arrived = http.received('wait'), search = host.search(['wait'], active.signal)
  await arrived; active.abort(new Error(`Authorization: Bearer ${secret}`))
  await assert.rejects(search, error => error.code === 'WEB_ABORTED' && !String(error).includes(secret) && error.cause === undefined)
  assert.equal(JSON.stringify(host.audits).includes(secret), false)
  assert.equal(JSON.stringify(host.audits).includes('Authorization'), false)
})

test('未就绪边界禁止服务层绕开工具直接搜索，web_fetch 仍由本地 HTTP 拦截私有地址', async t => {
  const host = mounted(t, undefined)
  await assert.rejects(host.ctx.web.search({ query: 'bypass' }), { code: 'WEB_SEARCH_NOT_READY' })
  await assert.rejects(host.ctx.web.fetch({ url: 'http://127.0.0.1:1/private' }), { code: 'WEB_BLOCKED_URL' })
  await assert.rejects(host.ctx.web.fetch({ url: 'http://127.0.0.1:1/private', provider: 'deepseek-fetch-api', fetchProvider: 'deepseek-fetch-api' }), { code: 'WEB_BLOCKED_URL' })
  host.webConfig.fetchProvider = 'deepseek-fetch-api'
  await assert.rejects(host.ctx.web.fetch({ url: 'https://example.org' }), { code: 'WEB_FETCH_ROUTE_FORBIDDEN' })
})
