import { WebError } from '@deepseek-ai/dsh-web'

const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_QUERY_LENGTH = 2000
class HtmlSearchError extends WebError {}

export function* visibleNodes(root) {
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    if (['script', 'style', 'template'].includes(node.tagName)) continue
    yield node
    for (let index = (node.childNodes?.length ?? 0) - 1; index >= 0; index -= 1) stack.push(node.childNodes[index])
  }
}

export const attribute = (node, name) => node.attrs?.find(attr => attr.name === name)?.value
export const hasClass = (node, name) => (attribute(node, 'class') ?? '').split(/\s+/u).includes(name)
export const textOf = node => [...visibleNodes(node)].filter(child => child.nodeName === '#text').map(child => child.value).join(' ').replace(/\s+/gu, ' ').trim()

/** This validates citation syntax only; it never fetches or resolves a source. */
export function sourceUrl(href) {
  if (typeof href !== 'string' || !/^(?:https?:)?\/\//iu.test(href)) return undefined
  try {
    const url = new URL(href.startsWith('//') ? `https:${href}` : href)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    return url.href
  } catch { return undefined }
}

export async function readSearchBody(response, signal, label) {
  const tooLarge = () => new HtmlSearchError(`${label} 响应超过允许大小。`, 'WEB_RESPONSE_TOO_LARGE')
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw tooLarge()
  if (!response.body) return ''
  const reader = response.body.getReader(), parts = []
  let bytes = 0
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) throw tooLarge()
      parts.push(value)
    }
    return Buffer.concat(parts, bytes).toString('utf8')
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

/**
 * Provider definitions are internal constants, never tool input. The task's
 * limits are captured once; only query/maxResults are read from each request.
 * One request, one fixed origin, no redirects, retries, accounts or fallback.
 * The host's dispatcher owns proxy policy; this module reads no environment.
 */
export function createHtmlSearchProvider({ id, label, endpoint, queryParams, parseSources, isChallenge },
  { maxResults = 8, timeoutMs = 30000 } = {}, { fetchImpl = globalThis.fetch } = {}) {
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || typeof fetchImpl !== 'function') {
    throw new HtmlSearchError(`${label} 搜索数量或超时配置无效。`, 'WEB_SEARCH_INVALID_CONFIG')
  }
  const challenge = () => new HtmlSearchError(`${label} 返回了人工验证页面；独立搜索已停止。`, 'WEB_SEARCH_CHALLENGE')
  return {
    id,
    available: () => true,
    async search(request, signal) {
      if (signal?.aborted) throw new HtmlSearchError('网页搜索已取消。', 'WEB_ABORTED')
      if (typeof request?.query !== 'string' || request.query.length > MAX_QUERY_LENGTH || !request.query.trim() || /[\u0000-\u001f\u007f]/u.test(request.query) ||
        request.maxResults !== undefined && (!Number.isInteger(request.maxResults) || request.maxResults < 1)) {
        throw new HtmlSearchError('搜索查询或结果数量无效；查询最多允许 2000 个字符。', 'WEB_SEARCH_INVALID_QUERY')
      }
      const query = request.query.trim(), limit = Math.min(maxResults, request.maxResults ?? maxResults)
      const url = new URL(endpoint)
      url.search = new URLSearchParams(queryParams(query)).toString()
      const deadline = performance.now() + timeoutMs
      const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), timeoutMs)
      const operationSignal = AbortSignal.any([timeout.signal, ...(signal ? [signal] : [])])
      const checkDeadline = () => {
        if (performance.now() >= deadline) timeout.abort()
        operationSignal.throwIfAborted()
      }
      let response
      try {
        response = await fetchImpl(url, { method: 'GET', redirect: 'manual', credentials: 'omit', signal: operationSignal,
          headers: { accept: 'text/html', 'user-agent': 'pre-design-web/2.1.0', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' } })
        checkDeadline()
        if (response.status === 202) throw challenge()
        if (response.redirected || response.status >= 300 && response.status < 400) throw new HtmlSearchError(`${label} 返回重定向；未访问跳转目标。`, 'WEB_SEARCH_REDIRECT')
        if (response.status === 429) throw new HtmlSearchError(`${label} 暂时限制搜索请求；请稍后重试。`, 'WEB_SEARCH_RATE_LIMITED')
        if (!response.ok) throw new HtmlSearchError(`${label} 搜索请求失败（HTTP ${response.status}）。`, 'WEB_PROVIDER_ERROR')
        if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')) {
          throw new HtmlSearchError(`${label} 返回了无法识别的响应格式。`, 'WEB_SEARCH_INVALID_RESPONSE')
        }
        const html = await readSearchBody(response, operationSignal, label)
        checkDeadline()
        if (isChallenge(html)) throw challenge()
        const sources = parseSources(html)
        checkDeadline()
        if (!sources.length) throw new HtmlSearchError(`${label} 未返回可确认的搜索来源；未将空页面记为搜索成功。`, 'WEB_SEARCH_EMPTY_UNCONFIRMED')
        return { query, provider: id, engine: id, sources: sources.slice(0, limit), truncated: sources.length > limit }
      } catch (error) {
        if (performance.now() >= deadline) timeout.abort()
        if (signal?.aborted) throw new HtmlSearchError('网页搜索已取消。', 'WEB_ABORTED')
        if (timeout.signal.aborted) throw new HtmlSearchError(`${label} 搜索已超时。`, 'WEB_TIMEOUT')
        if (error instanceof HtmlSearchError) throw error
        // Network errors can include proxy URLs, credentials or arbitrary causes.
        throw new HtmlSearchError(`${label} 搜索连接失败；请检查服务网络或稍后重试。`, 'WEB_PROVIDER_ERROR')
      } finally {
        clearTimeout(timer)
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {})
      }
    },
  }
}
