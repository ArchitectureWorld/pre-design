import test from 'node:test'
import assert from 'node:assert/strict'

const bing = await import('../../worker/bing-search.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}
  throw error
})

// Synthetic result cards follow the live Bing HTML inspected on this host.
const fixture = `<!doctype html><html><body><ol id="b_results">
<li class="b_algo"><div class="b_tpcn"><a href="https://unrelated.example.org/icon">Site icon</a></div>
  <h2><a href="https://example.org/source?a=1&amp;b=2">First <strong>source</strong></a></h2>
  <div class="b_caption"><p>The source's original &amp; <b>public</b> snippet.</p></div></li>
<li class="b_algo"><h2><a href="https://example.org/source?a=1&amp;b=2">Duplicate</a></h2><p>Duplicate snippet</p></li>
<li class="b_algo b_algoBorder"><h2><a href="https://example.net/second">Second source</a></h2><p>CAPTCHA research is a legitimate topic.</p></li>
<li class="b_algo"><h2><a href="https://example.com/third">Third source</a></h2></li>
<li class="b_ad"><h2><a href="https://ads.example.org/">Advertisement</a></h2></li>
</ol></body></html>`

function transport(body = fixture, init = {}) {
  const requests = []
  return { requests, fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' }, ...init })
  } }
}

test('Bing 提取每张真实结果卡的标题链接和摘要，排除广告、去重并遵守条数上限', async () => {
  assert.equal(typeof bing.createBingSearchProvider, 'function')
  const http = transport(), provider = bing.createBingSearchProvider({ maxResults: 2 }, http)
  const result = await provider.search({ query: '  public query  ', engine: 'ddg', endpoint: 'http://localhost/', originalQuestion: 'private full prompt', maxResults: 99 })
  assert.equal(provider.id, 'bing')
  assert.equal(provider.available(), true)
  assert.equal(bing.BING_SEARCH_ENDPOINT, 'https://www.bing.com/search')
  assert.deepEqual(result, { query: 'public query', provider: 'bing', engine: 'bing', truncated: true, sources: [
    { url: 'https://example.org/source?a=1&b=2', title: 'First source', snippet: "The source's original & public snippet." },
    { url: 'https://example.net/second', title: 'Second source', snippet: 'CAPTCHA research is a legitimate topic.' },
  ] })
  assert.equal(http.requests.length, 1)
  const request = http.requests[0], url = new URL(request.url)
  assert.equal(url.origin + url.pathname, bing.BING_SEARCH_ENDPOINT)
  assert.deepEqual([...url.searchParams], [['q', 'public query'], ['mkt', 'zh-CN'], ['adlt', 'off']])
  assert.equal(request.options.method, 'GET')
  assert.equal(request.options.redirect, 'manual')
  assert.equal(request.options.credentials, 'omit')
  assert.equal(new Headers(request.options.headers).has('authorization'), false)
  assert.equal(JSON.stringify(request).includes('private full prompt'), false)
})

test('Bing 验证码、空页面、格式错误、限流和重定向保持失败且不跨服务回退', async () => {
  for (const row of [
    { body: fixture, init: { status: 202 }, code: 'WEB_SEARCH_CHALLENGE' },
    { body: '<html><body><div id="b_captcha">Verify you are human</div></body></html>', code: 'WEB_SEARCH_CHALLENGE' },
    { body: '<html><body>No results.</body></html>', code: 'WEB_SEARCH_EMPTY_UNCONFIRMED' },
    { body: '{"private":"upstream-secret"}', init: { headers: { 'content-type': 'application/json' } }, code: 'WEB_SEARCH_INVALID_RESPONSE' },
    { body: 'upstream-secret', init: { status: 302, headers: { location: 'http://localhost/private' } }, code: 'WEB_SEARCH_REDIRECT' },
    { body: 'upstream-secret', init: { status: 429 }, code: 'WEB_SEARCH_RATE_LIMITED' },
    { body: 'upstream-secret', init: { status: 503 }, code: 'WEB_PROVIDER_ERROR' },
  ]) {
    const http = transport(row.body, row.init)
    await assert.rejects(bing.createBingSearchProvider({}, http).search({ query: 'private-query' }), error => {
      assert.equal(error.code, row.code)
      assert.equal(error.cause, undefined)
      assert.doesNotMatch(String(error), /upstream-secret|private-query|localhost/u)
      return true
    })
    assert.equal(http.requests.length, 1)
  }
})

test('Bing 不把未解析的跳转、脚本链接、认证链接或隐藏卡片当成可引用原文', async () => {
  const body = `<html><body><ol>
    <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9leGFtcGxlLm9yZy8=">Unresolved redirect</a></h2></li>
    <li class="b_algo"><h2><a href="javascript:alert(1)">Script</a></h2></li>
    <li class="b_algo"><h2><a href="https://user:secret@example.org/">Authenticated URL</a></h2></li>
    <li class="b_algo"><h2><a href="/settings">Relative navigation</a></h2></li>
    <!-- <li class="b_algo"><h2><a href="https://example.org/comment-only">Hidden</a></h2></li> -->
    <template><li class="b_algo"><h2><a href="https://example.org/template-only">Hidden</a></h2></li></template>
    <li class="b_algo"><h2><a title="a > b" href="https://example.org/visible">Visible</a></h2></li>
  </ol></body></html>`
  const result = await bing.createBingSearchProvider({}, transport(body)).search({ query: 'query' })
  assert.deepEqual(result.sources, [{ url: 'https://example.org/visible', title: 'Visible' }])
  assert.equal(result.truncated, false)
})

test('Bing 复用查询、响应大小和提前取消边界，不接受请求级覆盖', async () => {
  const http = transport(), provider = bing.createBingSearchProvider({}, http)
  await assert.rejects(provider.search({ query: 'x'.repeat(2001) }), { code: 'WEB_SEARCH_INVALID_QUERY' })
  const controller = new AbortController(); controller.abort(new Error('private-reason'))
  await assert.rejects(provider.search({ query: 'query' }, controller.signal), { code: 'WEB_ABORTED' })
  assert.equal(http.requests.length, 0)
  const large = transport(fixture, { headers: { 'content-type': 'text/html', 'content-length': '1048577' } })
  await assert.rejects(bing.createBingSearchProvider({}, large).search({ query: 'query' }), { code: 'WEB_RESPONSE_TOO_LARGE' })
  assert.throws(() => bing.createBingSearchProvider({ timeoutMs: 0 }), { code: 'WEB_SEARCH_INVALID_CONFIG' })
})

test('Bing 超时终止连接等待并隐藏底层错误', async () => {
  const provider = bing.createBingSearchProvider({ timeoutMs: 10 }, { fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('private-network-error')), { once: true })
  }) })
  await assert.rejects(provider.search({ query: 'query', timeoutMs: 999999 }), { code: 'WEB_TIMEOUT' })
})
