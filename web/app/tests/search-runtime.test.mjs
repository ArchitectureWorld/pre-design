import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as createTlsServer } from 'node:tls'
import { connect } from 'node:net'
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

const ddgPolicy = () => ({ enabled: true, provider: 'ddg', maxResults: 8, maxQueries: 2, timeoutMs: 1000 })
const ddgHtml = '<html><body><div class="result results_links"><a class="result__a" href="https://example.org/source">真实来源标题</a><a class="result__snippet" href="https://example.org/source">服务返回摘要</a></div></body></html>'
test('DDG 直接挂接原生搜索工具，不需要或读取任何模型、账户、Search API 凭据', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), options })
    return new Response(ddgHtml, { headers: { 'content-type': 'text/html' } })
  })
  const policy = ddgPolicy(), output = runtime.materializeSearchRuntime(policy)
  assert.equal(output.availability.status, 'ready')
  assert.equal(output.availability.provider, 'ddg')
  assert.equal(output.availability.endpoint, 'https://html.duckduckgo.com/html/')
  assert.deepEqual(output.env, {})
  assert.equal(output.patches.find(row => row.id === 'web-deepseek-api').disabled, true)
  const host = mounted(t, policy, { materialized: output })
  policy.provider = 'deepseek-search-api'; policy.baseURL = 'http://127.0.0.1:1/other'
  host.webConfig.searchProvider = 'deepseek-official'
  assert.deepEqual(await host.search(['通用测试']), {
    sources: [{ url: 'https://example.org/source', title: '真实来源标题', snippet: '服务返回摘要' }], truncated: false,
  })
  assert.equal(requests.length, 1)
  const url = new URL(requests[0].url)
  assert.equal(url.origin + url.pathname, 'https://html.duckduckgo.com/html/')
  assert.equal(url.searchParams.get('q'), '通用测试')
  assert.equal(requests[0].options.headers.authorization, undefined)
  assert.equal(host.accountReads(), 0); assert.equal(host.credentialReads(), 0)
  assert.ok(host.audits.every(row => row.provider === 'ddg'))
  await assert.rejects(host.search(['one', 'two', 'three']), /at most/u)
})

test('DDG 验证码与空白页保留准确失败原因，不记录成功或泄漏上游正文', async t => {
  let response = new Response('secret from upstream', { status: 202 })
  t.mock.method(globalThis, 'fetch', async () => response)
  const host = mounted(t, ddgPolicy())
  await assert.rejects(host.search(['first']), error => error.code === 'WEB_SEARCH_CHALLENGE' && !error.message.includes('secret'))
  response = new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
  await assert.rejects(host.search(['second']), { code: 'WEB_SEARCH_EMPTY_UNCONFIRMED' })
  assert.deepEqual(host.audits.map(row => row.phase), ['started', 'failed', 'started', 'failed'])
  assert.equal(JSON.stringify(host.audits).includes('secret'), false)
})

test('搜索网络代理只能由服务端显式配置，不能从模型或环境凭据继承', () => {
  const proxyURL = 'http://127.0.0.1:17890'
  const output = runtime.materializeSearchRuntime(ddgPolicy(), { refs: { HTTPS_PROXY: 'http://ambient:secret@proxy/' } }, { proxyURL })
  assert.deepEqual(output.env, { PRE_WEB_SEARCH_PROXY_URL: proxyURL })
  assert.equal(JSON.stringify(output.patches).includes(proxyURL), false)
  assert.equal(JSON.stringify(output.availability).includes(proxyURL), false)
  for (const value of ['http://user:secret@proxy:80', 'file:///tmp/proxy', 'http://proxy/path', 'http://proxy/?key=secret']) {
    const invalid = runtime.materializeSearchRuntime(ddgPolicy(), {}, { proxyURL: value })
    assert.equal(invalid.availability.status, 'not_ready')
    assert.deepEqual(invalid.env, {})
  }
  assert.deepEqual(runtime.materializeSearchRuntime(ddgPolicy()).env, {})
})

test('Bing 经原生工具保留真实来源和服务身份，不调用模型或隐藏回退', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(String(url))
    return new Response('<html><body><ol id="b_results"><li class="b_algo"><h2><a href="https://example.org/source">原始标题</a></h2><div class="b_caption"><p>原始摘要</p></div></li></ol></body></html>', { headers: { 'content-type': 'text/html' } })
  })
  const host = mounted(t, { ...ddgPolicy(), provider: 'bing' })
  assert.equal(host.output.availability.status, 'ready')
  assert.deepEqual(await host.search(['通用查询']), { sources: [{ url: 'https://example.org/source', title: '原始标题', snippet: '原始摘要' }], truncated: false })
  assert.equal(requests.length, 1)
  assert.equal(new URL(requests[0]).hostname, 'www.bing.com')
  assert.ok(host.audits.every(row => row.provider === 'bing'))
  assert.equal(host.accountReads(), 0); assert.equal(host.credentialReads(), 0)
})

test('专用代理使用兼容的 fetch，CONNECT 和 TLS SNI 均指向固定搜索主机', async t => {
  const tunnels = [], names = [], sockets = new Set()
  // Reject the handshake after observing SNI: no external network or test CA,
  // and no certificate-verification exception is needed for this regression.
  const tls = createTlsServer({ SNICallback(name, done) { names.push(name); done(new Error('fixture handshake stop')) } })
  tls.on('tlsClientError', () => {})
  await new Promise(resolve => tls.listen(0, '127.0.0.1', resolve))
  const proxy = createServer()
  proxy.on('connect', (request, socket, head) => {
    tunnels.push(request.url); sockets.add(socket)
    const upstream = connect(tls.address().port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection established\r\n\r\n')
      if (head.length) upstream.write(head)
      socket.pipe(upstream); upstream.pipe(socket)
    })
    sockets.add(upstream)
    socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy())
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  t.after(async () => { for (const socket of sockets) socket.destroy(); await Promise.all([proxy, tls].map(server => new Promise(resolve => server.close(resolve)))) })
  const policy = { ...ddgPolicy(), provider: 'bing', timeoutMs: 5000 }
  const materialized = runtime.materializeSearchRuntime(policy, {}, { proxyURL: `http://127.0.0.1:${proxy.address().port}` })
  const host = mounted(t, policy, { materialized })
  await assert.rejects(host.search(['transport regression']), { code: 'WEB_PROVIDER_ERROR' })
  assert.deepEqual(tunnels, ['www.bing.com:443'])
  assert.deepEqual(names, ['www.bing.com'])
  assert.deepEqual(host.audits.map(row => row.phase), ['started', 'failed'])
})

test('Exa 经原生搜索工具仅发送固定 MCP 调用，返回真实来源且不继承凭据', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url: String(url), options, body })
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text:
      'Title: 公开原始标题\nURL: https://example.gov.cn/source\nHighlights:\n公开原始摘要。' }] } }), { headers: { 'content-type': 'application/json' } })
  })
  const host = mounted(t, { ...ddgPolicy(), provider: 'exa' })
  assert.equal(host.output.availability.status, 'ready'); assert.deepEqual(host.output.env, {})
  const result = await host.search(['公共查询'])
  assert.equal(result.sources.length, 1); assert.equal(result.sources[0].url, 'https://example.gov.cn/source')
  assert.equal(requests.length, 1); assert.equal(requests[0].url, 'https://mcp.exa.ai/mcp')
  assert.equal(requests[0].body.method, 'tools/call'); assert.equal(requests[0].body.params.name, 'web_search_exa')
  assert.equal(requests[0].body.params.arguments.query, '公共查询')
  assert.equal(new Headers(requests[0].options.headers).has('authorization'), false)
  assert.equal(host.accountReads(), 0); assert.equal(host.credentialReads(), 0)
  assert.ok(host.audits.every(row => row.provider === 'exa'))
})
