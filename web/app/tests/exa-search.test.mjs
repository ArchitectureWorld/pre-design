import test from 'node:test'
import assert from 'node:assert/strict'

const exa = await import('../../worker/exa-search.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}
  throw error
})

// Synthetic labels mirror the single, real Exa MCP response captured on this host.
const sourceText = `Title: 城市更新公开文件
URL: https://example.gov.cn/update?a=1&b=2
Published: 2026-03-26T00:00:00.000Z
Author: N/A
Highlights:
这是来源返回的原始摘要。

Title: 重复来源
URL: https://example.gov.cn/update?a=1&b=2
Highlights:
重复摘要。

Title: 第二条公开来源
URL: https://example.org/second
Published: N/A
Highlights:
第二条来源原文。

Title: 第三条公开来源
URL: https://example.net/third
Highlights:
第三条来源原文。`

const packetFor = (id, text = sourceText) => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text, _meta: { searchTime: 100 } }] } })
function transport(reply) {
  const requests = []
  return { requests, fetchImpl: async (url, options) => {
    const request = { url: String(url), options, body: JSON.parse(options.body) }
    requests.push(request)
    return reply ? reply(request) : new Response(JSON.stringify(packetFor(request.body.id)), { headers: { 'content-type': 'application/json' } })
  } }
}

test('Exa 固定匿名 tools/call 只发送受限查询，返回真实标题、来源、摘要及截断信息', async () => {
  assert.equal(typeof exa.createExaSearchProvider, 'function')
  const http = transport(), config = { maxResults: 2 }, provider = exa.createExaSearchProvider(config, http)
  config.maxResults = 50
  const result = await provider.search({ query: '  住房和城乡建设部 城市更新 官方  ', maxResults: 99,
    originalQuestion: 'private full prompt', baseURL: 'http://localhost/private', engine: 'bing', apiKey: 'private-key' })
  assert.equal(provider.id, 'exa')
  assert.equal(provider.available(), true)
  assert.equal(exa.EXA_SEARCH_ENDPOINT, 'https://mcp.exa.ai/mcp')
  assert.deepEqual(result, { query: '住房和城乡建设部 城市更新 官方', provider: 'exa', engine: 'exa', truncated: true, sources: [
    { url: 'https://example.gov.cn/update?a=1&b=2', title: '城市更新公开文件', publishedAt: '2026-03-26T00:00:00.000Z', snippet: '这是来源返回的原始摘要。' },
    { url: 'https://example.org/second', title: '第二条公开来源', snippet: '第二条来源原文。' },
  ] })
  assert.equal(http.requests.length, 1)
  const request = http.requests[0]
  assert.equal(request.url, exa.EXA_SEARCH_ENDPOINT)
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.redirect, 'manual')
  assert.equal(request.options.credentials, 'omit')
  assert.ok(request.body.id)
  assert.deepEqual(request.body, { jsonrpc: '2.0', id: request.body.id, method: 'tools/call',
    params: { name: 'web_search_exa', arguments: { query: '住房和城乡建设部 城市更新 官方', numResults: 2 } } })
  assert.equal(new Headers(request.options.headers).get('accept'), 'application/json, text/event-stream')
  assert.equal(new Headers(request.options.headers).has('authorization'), false)
  assert.doesNotMatch(request.options.body, /private full prompt|private-key|localhost/u)
})

test('Exa 接受已观察 SSE，正确组合多行 data 并忽略无 id 的进度通知', async () => {
  const http = transport(request => {
    const packet = packetFor(request.body.id, 'Title: 原始标题\nURL: https://example.org/source\nHighlights:\n原始摘要。')
    const body = `: keep-alive\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":${JSON.stringify(packet.id)},"result":${JSON.stringify(packet.result)}}\r\n\r\n`
    return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
  })
  const result = await exa.createExaSearchProvider({}, http).search({ query: '公开查询' })
  assert.deepEqual(result.sources, [{ url: 'https://example.org/source', title: '原始标题', snippet: '原始摘要。' }])
  assert.equal(result.truncated, false)
  assert.equal(http.requests.length, 1)
})

test('Exa 验证 JSON-RPC id、版本、结果形状与工具错误，不能把错误文本当作来源', async () => {
  const cases = [
    { mutate: packet => ({ ...packet, id: 'different-request' }), code: 'WEB_SEARCH_INVALID_RESPONSE' },
    { mutate: packet => ({ ...packet, jsonrpc: '1.0' }), code: 'WEB_SEARCH_INVALID_RESPONSE' },
    { mutate: packet => ({ ...packet, result: null }), code: 'WEB_SEARCH_INVALID_RESPONSE' },
    { mutate: packet => ({ ...packet, result: { content: 'wrong shape' } }), code: 'WEB_SEARCH_INVALID_RESPONSE' },
    { mutate: packet => ({ ...packet, result: { content: [] } }), code: 'WEB_SEARCH_EMPTY_UNCONFIRMED' },
    { mutate: packet => ({ ...packet, result: { ...packet.result, isError: true } }), code: 'WEB_PROVIDER_ERROR' },
    { mutate: packet => ({ jsonrpc: '2.0', id: packet.id, error: { code: -32000, message: 'upstream-private-secret' } }), code: 'WEB_PROVIDER_ERROR' },
    { mutate: () => null, code: 'WEB_SEARCH_INVALID_RESPONSE' },
  ]
  for (const row of cases) {
    const http = transport(request => new Response(JSON.stringify(row.mutate(packetFor(request.body.id))), { headers: { 'content-type': 'application/json' } }))
    await assert.rejects(exa.createExaSearchProvider({}, http).search({ query: 'private-query' }), error => {
      assert.equal(error.code, row.code); assert.equal(error.cause, undefined)
      assert.doesNotMatch(String(error), /upstream-private-secret|private-query/u)
      return true
    })
    assert.equal(http.requests.length, 1)
  }
  for (const body of ['data: not-json\n\n', ': heartbeat\n\n']) {
    const http = transport(() => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    await assert.rejects(exa.createExaSearchProvider({}, http).search({ query: 'query' }), { code: 'WEB_SEARCH_INVALID_RESPONSE' })
  }
  const duplicate = transport(request => new Response(`data: ${JSON.stringify(packetFor(request.body.id))}\n\ndata: ${JSON.stringify(packetFor(request.body.id))}\n\n`, { headers: { 'content-type': 'text/event-stream' } }))
  await assert.rejects(exa.createExaSearchProvider({}, duplicate).search({ query: 'query' }), { code: 'WEB_SEARCH_INVALID_RESPONSE' })
})

test('Exa HTTP 失败与不支持的响应格式不重试、不跳转且不泄露正文', async () => {
  for (const row of [
    { status: 302, headers: { location: 'http://localhost/private' }, code: 'WEB_SEARCH_REDIRECT' },
    { status: 429, code: 'WEB_SEARCH_RATE_LIMITED' },
    { status: 503, code: 'WEB_PROVIDER_ERROR' },
    { status: 200, headers: { 'content-type': 'text/html' }, code: 'WEB_SEARCH_INVALID_RESPONSE' },
    { status: 200, headers: { 'content-type': 'application/json' }, code: 'WEB_SEARCH_INVALID_RESPONSE' },
  ]) {
    const http = transport(() => new Response('upstream-private-secret', row))
    await assert.rejects(exa.createExaSearchProvider({}, http).search({ query: 'query' }), error => error.code === row.code && error.cause === undefined && !String(error).includes('upstream-private-secret'))
    assert.equal(http.requests.length, 1)
  }
})

test('Exa 只取来源元数据的 HTTP(S) 链接，摘要限长但不会总结或补造缺失来源', async () => {
  const text = `Title: 原始标题\nURL: https://example.org/real\nHighlights:\n${'原'.repeat(1600)}\n\nTitle: 认证链接\nURL: https://user:secret@example.org/\nHighlights:\n不能使用\n\nTitle: 脚本链接\nURL: javascript:alert(1)\nHighlights:\n不能使用`
  const http = transport(request => new Response(JSON.stringify(packetFor(request.body.id, text)), { headers: { 'content-type': 'application/json' } }))
  const result = await exa.createExaSearchProvider({}, http).search({ query: 'query' })
  assert.deepEqual(result.sources, [{ url: 'https://example.org/real', title: '原始标题', snippet: '原'.repeat(1200) }])
  assert.equal(http.requests.length, 1)
  const missing = transport(request => new Response(JSON.stringify(packetFor(request.body.id, 'Title: 缺失链接\nHighlights:\nURL: https://example.org/not-source-metadata')), { headers: { 'content-type': 'application/json' } }))
  await assert.rejects(exa.createExaSearchProvider({}, missing).search({ query: 'query' }), { code: 'WEB_SEARCH_EMPTY_UNCONFIRMED' })
})

test('Exa 查询与配置校验在请求前完成，响应声明和实际字节都受 1 MiB 限制', async () => {
  for (const config of [{ timeoutMs: 0 }, { maxResults: 51 }]) assert.throws(() => exa.createExaSearchProvider(config), { code: 'WEB_SEARCH_INVALID_CONFIG' })
  const http = transport(), provider = exa.createExaSearchProvider({}, http)
  for (const request of [undefined, { query: ' ' }, { query: 'x'.repeat(2001) }, { query: 'x\0y' }, { query: 'q', maxResults: 0 }]) {
    await assert.rejects(provider.search(request), { code: 'WEB_SEARCH_INVALID_QUERY' })
  }
  assert.equal(http.requests.length, 0)
  const declared = transport(() => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1048577' } }))
  await assert.rejects(exa.createExaSearchProvider({}, declared).search({ query: 'query' }), { code: 'WEB_RESPONSE_TOO_LARGE' })
  let cancelled = false
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(700000)); controller.enqueue(new Uint8Array(700000)) }, cancel() { cancelled = true } })
  const actual = transport(() => new Response(stream, { headers: { 'content-type': 'application/json' } }))
  await assert.rejects(exa.createExaSearchProvider({}, actual).search({ query: 'query' }), { code: 'WEB_RESPONSE_TOO_LARGE' })
  assert.equal(cancelled, true)
})

test('Exa 提前取消不派发，等待连接和读取正文时能取消或超时并释放流', async () => {
  const http = transport(), cancelled = new AbortController(); cancelled.abort(new Error('private-reason'))
  await assert.rejects(exa.createExaSearchProvider({}, http).search({ query: 'query' }, cancelled.signal), { code: 'WEB_ABORTED' })
  assert.equal(http.requests.length, 0)
  const connection = exa.createExaSearchProvider({ timeoutMs: 10 }, { fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) })
  await assert.rejects(connection.search({ query: 'query' }), { code: 'WEB_TIMEOUT' })
  for (const byUser of [true, false]) {
    let sent, released = false
    const arrived = new Promise(resolve => { sent = resolve }), controller = new AbortController()
    const provider = exa.createExaSearchProvider({ timeoutMs: byUser ? 1000 : 10 }, { fetchImpl: async () => {
      sent()
      return new Response(new ReadableStream({ cancel() { released = true } }), { headers: { 'content-type': 'application/json' } })
    } })
    const request = provider.search({ query: 'query' }, controller.signal)
    await arrived
    if (byUser) controller.abort(new Error('private-body-reason'))
    await assert.rejects(request, { code: byUser ? 'WEB_ABORTED' : 'WEB_TIMEOUT' })
    assert.equal(released, true)
  }
})

test('Exa 底层错误被脱敏，计时器被同步处理阻塞时仍检查截止时间', async () => {
  const failed = exa.createExaSearchProvider({}, { fetchImpl: async () => { throw new Error('Authorization: private-token at https://proxy.example/') } })
  await assert.rejects(failed.search({ query: 'query' }), error => error.code === 'WEB_PROVIDER_ERROR' && error.cause === undefined && !/private-token|proxy\.example/u.test(String(error)))
  const delayed = transport(request => {
    const end = performance.now() + 15
    while (performance.now() < end) { /* delay the timer callback */ }
    return new Response(JSON.stringify(packetFor(request.body.id)), { headers: { 'content-type': 'application/json' } })
  })
  await assert.rejects(exa.createExaSearchProvider({ timeoutMs: 5 }, delayed).search({ query: 'query' }), { code: 'WEB_TIMEOUT' })
})
