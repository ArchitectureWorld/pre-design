import test from 'node:test'
import assert from 'node:assert/strict'

const ddg = await import('../../worker/ddg-search.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}
  throw error
})

// Synthetic DDG HTML markup matching the inspected 0.4.22 protocol, not live search evidence.
const fixture = `<!doctype html><html><body>
<div class="result results_links results_links_deep web-result"><h2 class="result__title">
  <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fguide%3Fa%3D1%26b%3D2&amp;rut=ignored" class="result__a">Open &amp; <b>public</b> &#x1F310;</a>
</h2><div class="result__extras"><span>2026-11-01</span></div>
<a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fguide">A <b>source</b> &amp; its original snippet.</a></div>
<div class="result results_links"><a class="result__a" href="https://example.org/guide?a=1&amp;b=2">Duplicate</a></div>
<div class="result results_links"><a class='result__a' href='https://example.net/report'>Second source</a>
<a class='result__snippet'>CAPTCHA research is a legitimate topic.</a></div>
<div class="result results_links"><a class="result__a" href="https://example.com/third">Third source</a></div>
</body></html>`

function transport(body = fixture, init = {}) {
  const requests = []
  return {
    requests,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' }, ...init })
    },
  }
}

test('DDG HTML 仅提取真实结果字段，解开 DDG 跳转并去重，保留来源归属与截断状态', async () => {
  assert.equal(typeof ddg.createDdgSearchProvider, 'function')
  const http = transport(), provider = ddg.createDdgSearchProvider({ maxResults: 2 }, http)
  const result = await provider.search({ query: '  public query  ', originalQuestion: 'private full prompt', engine: 'bing', baseURL: 'http://127.0.0.1/' })
  assert.equal(provider.id, 'ddg')
  assert.equal(provider.available(), true)
  assert.equal(ddg.DDG_SEARCH_ENDPOINT, 'https://html.duckduckgo.com/html/')
  assert.deepEqual(result, {
    query: 'public query', provider: 'ddg', engine: 'ddg', truncated: true,
    sources: [
      { url: 'https://example.org/guide?a=1&b=2', title: 'Open & public 🌐', snippet: 'A source & its original snippet.', publishedAt: '2026-11-01' },
      { url: 'https://example.net/report', title: 'Second source', snippet: 'CAPTCHA research is a legitimate topic.' },
    ],
  })
  assert.equal(http.requests.length, 1)
  const request = http.requests[0], url = new URL(request.url)
  assert.equal(url.origin + url.pathname, ddg.DDG_SEARCH_ENDPOINT)
  assert.deepEqual([...url.searchParams], [['q', 'public query'], ['adlt', '-1']])
  assert.equal(request.options.method, 'GET')
  assert.equal(request.options.redirect, 'manual')
  assert.equal(request.options.credentials, 'omit')
  assert.equal(new Headers(request.options.headers).has('authorization'), false)
  assert.equal(JSON.stringify(request).includes('private full prompt'), false)
})

test('空查询、超长查询、控制字符和非法结果数量在网络请求前失败', async () => {
  const http = transport(), provider = ddg.createDdgSearchProvider({}, http)
  for (const request of [undefined, {}, { query: ' ' }, { query: 'x'.repeat(2001) }, { query: 'public\0query' },
    ...[0, -1, 1.2, '3', Infinity].map(maxResults => ({ query: 'public query', maxResults }))]) {
    await assert.rejects(provider.search(request), { code: 'WEB_SEARCH_INVALID_QUERY' })
  }
  assert.equal(http.requests.length, 0)
})

test('任务快照的条数与超时配置校验，调用参数不能扩大条数或替换搜索地址', async () => {
  for (const config of [{ maxResults: 0 }, { maxResults: 51 }, { timeoutMs: 0 }, { timeoutMs: 120001 }, { timeoutMs: NaN }]) {
    assert.throws(() => ddg.createDdgSearchProvider(config), { code: 'WEB_SEARCH_INVALID_CONFIG' })
  }
  const http = transport(), config = { maxResults: 2 }, provider = ddg.createDdgSearchProvider(config, http)
  config.maxResults = 50
  const capped = await provider.search({ query: 'public query', maxResults: 500, endpoint: 'http://localhost/' })
  assert.equal(capped.sources.length, 2)
  assert.equal(capped.truncated, true)
  const smaller = await provider.search({ query: 'public query', maxResults: 1 })
  assert.equal(smaller.sources.length, 1)
  assert.equal(smaller.truncated, true)
  assert.ok(http.requests.every(row => row.url.startsWith('https://html.duckduckgo.com/html/?')))
})

test('验证码、空结果、格式变化、HTTP 错误和重定向均明确失败且不重试或跨引擎回退', async () => {
  const cases = [
    { body: fixture, init: { status: 202 }, code: 'WEB_SEARCH_CHALLENGE' },
    // The marker names match the real 202 response observed on this host; no challenge identifiers are retained.
    { body: `<html><body>${' '.repeat(5000)}<form id="challenge-form"><div class="anomaly-modal">Please complete the challenge</div></form>${fixture}</body></html>`, code: 'WEB_SEARCH_CHALLENGE' },
    { body: '<html><body>No results found.</body></html>', code: 'WEB_SEARCH_EMPTY_UNCONFIRMED' },
    { body: '<html><body>Unexpected markup with no result anchors.</body></html>', code: 'WEB_SEARCH_EMPTY_UNCONFIRMED' },
    { body: '{"secret":"private-upstream-content"}', init: { headers: { 'content-type': 'application/json' } }, code: 'WEB_SEARCH_INVALID_RESPONSE' },
    { body: 'private-upstream-content', init: { status: 302, headers: { location: 'http://127.0.0.1/private' } }, code: 'WEB_SEARCH_REDIRECT' },
    { body: 'private-upstream-content', init: { status: 403 }, code: 'WEB_PROVIDER_ERROR' },
    { body: 'private-upstream-content', init: { status: 429 }, code: 'WEB_SEARCH_RATE_LIMITED' },
    { body: 'private-upstream-content', init: { status: 503 }, code: 'WEB_PROVIDER_ERROR' },
  ]
  for (const row of cases) {
    const http = transport(row.body, row.init), provider = ddg.createDdgSearchProvider({}, http)
    await assert.rejects(provider.search({ query: 'private-query-content' }), error => {
      assert.equal(error.code, row.code)
      assert.equal(error.cause, undefined)
      assert.doesNotMatch(String(error), /private-upstream-content|private-query-content|127\.0\.0\.1/u)
      return true
    })
    assert.equal(http.requests.length, 1)
  }
})

test('无效、带认证信息或未解开的跳转链接不会成为引用来源', async () => {
  const body = `<html><body>
    <a class="result__a" href="javascript:alert(1)">Script</a>
    <a class="result__a" href="data:text/html,test">Data</a>
    <a class="result__a" href="https://user:secret@example.org/">Credentials</a>
    <a class="result__a" href="/settings">Relative link</a>
    <a class="result__a" href="//duckduckgo.com/l/?rut=missing-target">Missing target</a>
    <a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Advertisement redirect</a>
    <a class="result__a" href="https://example.org/source?a=1&amp;b=2"></a>
  </body></html>`
  const http = transport(body), result = await ddg.createDdgSearchProvider({}, http).search({ query: 'public query' })
  assert.deepEqual(result.sources, [{ url: 'https://example.org/source?a=1&b=2' }])
  assert.equal(result.truncated, false)
  const invalidOnly = transport('<a class="result__a" href="javascript:alert(1)">Invalid</a>')
  await assert.rejects(ddg.createDdgSearchProvider({}, invalidOnly).search({ query: 'query' }), { code: 'WEB_SEARCH_EMPTY_UNCONFIRMED' })
})

test('声明超长和实际超长响应都停止读取，禁止用截断 HTML 伪造成功', async () => {
  const declared = transport(fixture, { headers: { 'content-type': 'text/html', 'content-length': '1048577' } })
  await assert.rejects(ddg.createDdgSearchProvider({}, declared).search({ query: 'query' }), { code: 'WEB_RESPONSE_TOO_LARGE' })
  let cancelled = false
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(700000)); controller.enqueue(new Uint8Array(700000)) },
    cancel() { cancelled = true },
  })
  const fetchImpl = async () => new Response(stream, { headers: { 'content-type': 'text/html' } })
  await assert.rejects(ddg.createDdgSearchProvider({}, { fetchImpl }).search({ query: 'query' }), { code: 'WEB_RESPONSE_TOO_LARGE' })
  assert.equal(cancelled, true)
})

test('调用方提前取消不派发，连接期间取消不会泄露取消原因', async () => {
  const http = transport(), provider = ddg.createDdgSearchProvider({}, http), before = new AbortController()
  before.abort(new Error('private-cancel-reason'))
  await assert.rejects(provider.search({ query: 'query' }, before.signal), { code: 'WEB_ABORTED' })
  assert.equal(http.requests.length, 0)
  let sent
  const arrived = new Promise(resolve => { sent = resolve }), active = new AbortController()
  const waiting = ddg.createDdgSearchProvider({}, { fetchImpl: async (_url, { signal }) => {
    sent()
    return await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  } })
  const request = waiting.search({ query: 'query' }, active.signal)
  await arrived
  active.abort(new Error('private-cancel-reason'))
  await assert.rejects(request, error => error.code === 'WEB_ABORTED' && !String(error).includes('private-cancel-reason') && error.cause === undefined)
})

test('超时覆盖连接及读取响应正文，取消正文时释放流', async () => {
  const connection = ddg.createDdgSearchProvider({ timeoutMs: 10 }, { fetchImpl: async (_url, { signal }) => {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('private-network-error')), 100)
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
    })
  } })
  await assert.rejects(connection.search({ query: 'query' }), { code: 'WEB_TIMEOUT' })
  for (const cancelByUser of [false, true]) {
    let cancelled = false, release, arrived
    const received = new Promise(resolve => { arrived = resolve }), controller = new AbortController()
    const stream = new ReadableStream({
      start(destination) {
        release = setTimeout(() => { destination.enqueue(new TextEncoder().encode(fixture)); destination.close() }, 100)
      },
      cancel() { cancelled = true; clearTimeout(release) },
    })
    const provider = ddg.createDdgSearchProvider({ timeoutMs: cancelByUser ? 500 : 10 }, { fetchImpl: async () => {
      arrived()
      return new Response(stream, { headers: { 'content-type': 'text/html' } })
    } })
    const pending = provider.search({ query: 'query' }, controller.signal)
    await received
    if (cancelByUser) controller.abort(new Error('private-body-cancel'))
    await assert.rejects(pending, { code: cancelByUser ? 'WEB_ABORTED' : 'WEB_TIMEOUT' })
    assert.equal(cancelled, true)
  }
})

test('底层网络错误不把原始原因、URL 或凭据带回模型', async () => {
  const provider = ddg.createDdgSearchProvider({}, { fetchImpl: async () => { throw new Error('Authorization: private-secret at https://private.example/') } })
  await assert.rejects(provider.search({ query: 'query' }), error => error.code === 'WEB_PROVIDER_ERROR' && error.cause === undefined && !/private-secret|private\.example/u.test(String(error)))
})

test('HTML 注释与脚本中的伪结果不会进入来源，属性中的尖括号不破坏真实结果解析', async () => {
  const http = transport(`<html><body>
    <!-- <a class="result__a" href="https://example.org/comment-only">Invisible comment</a> -->
    <script>const data = '<a class="result__a" href="https://example.org/script-only">Invisible script</a>';</script>
    <template><a class="result__a" href="https://example.org/template-only">Invisible template</a></template>
    <a title="A > B" href="https://example.org/visible" class="result__a">Visible <b>source</b></a>
    <a class="result__snippet">Source <b>snippet</b> <!-- hidden --> with &#x110000; invalid entity.</a>
  </body></html>`)
  const result = await ddg.createDdgSearchProvider({}, http).search({ query: 'query' })
  assert.deepEqual(result.sources, [{ url: 'https://example.org/visible', title: 'Visible source', snippet: 'Source snippet with � invalid entity.' }])
})

test('同步响应处理已耗尽超时预算时也不得返回成功', async () => {
  const provider = ddg.createDdgSearchProvider({ timeoutMs: 5 }, { fetchImpl: async () => {
    // A busy transport/decoder can prevent the timeout callback from running.
    const end = performance.now() + 15
    while (performance.now() < end) { /* keep the timer pending */ }
    return new Response(fixture, { headers: { 'content-type': 'text/html' } })
  } })
  await assert.rejects(provider.search({ query: 'query' }), { code: 'WEB_TIMEOUT' })
})
