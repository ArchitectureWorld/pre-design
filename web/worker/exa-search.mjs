/** Fixed, anonymous Exa MCP search. Protocol verified against one real response
 * and dsh-free-search@0.4.22; https://exa.ai/mcp documents the public endpoint. */
import { randomUUID } from 'node:crypto'
import { WebError } from '@deepseek-ai/dsh-web'
import { readSearchBody } from './search-html.mjs'

export const EXA_SEARCH_ENDPOINT = 'https://mcp.exa.ai/mcp'
class ExaError extends WebError {}
const invalidResponse = () => new ExaError('Exa 返回了无法确认的 MCP 响应。', 'WEB_SEARCH_INVALID_RESPONSE')

function responseText(body, contentType, requestId) {
  let packets
  try {
    if (contentType === 'application/json') packets = [JSON.parse(body.replace(/^\uFEFF/u, ''))]
    else {
      packets = []
      let data = []
      const flush = () => { if (data.length) packets.push(JSON.parse(data.join('\n'))); data = [] }
      for (const line of body.replace(/^\uFEFF/u, '').split(/\r\n|\r|\n/u)) {
        if (!line) flush()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /u, ''))
      }
      flush()
    }
  } catch { throw invalidResponse() }
  const responses = packets.filter(packet => {
    if (!packet || typeof packet !== 'object' || Array.isArray(packet) || packet.jsonrpc !== '2.0') throw invalidResponse()
    return !(!Object.hasOwn(packet, 'id') && typeof packet.method === 'string' && !Object.hasOwn(packet, 'result') && !Object.hasOwn(packet, 'error'))
  })
  if (responses.length !== 1 || responses[0].id !== requestId) throw invalidResponse()
  const packet = responses[0]
  if (Object.hasOwn(packet, 'error')) {
    if (Object.hasOwn(packet, 'result')) throw invalidResponse()
    throw new ExaError('Exa MCP 搜索服务返回错误。', 'WEB_PROVIDER_ERROR')
  }
  const result = packet.result
  if (!result || typeof result !== 'object' || !Array.isArray(result.content) ||
    result.isError !== undefined && typeof result.isError !== 'boolean') throw invalidResponse()
  if (result.isError) throw new ExaError('Exa 搜索工具未能完成请求。', 'WEB_PROVIDER_ERROR')
  const blocks = []
  for (const block of result.content) {
    if (!block || typeof block !== 'object' || typeof block.type !== 'string') throw invalidResponse()
    if (block.type === 'text') {
      if (typeof block.text !== 'string') throw invalidResponse()
      blocks.push(block.text)
    }
  }
  return blocks.join('\n')
}

function parseSources(text) {
  const sources = [], seen = new Set()
  for (const block of text.replace(/\r\n?/gu, '\n').split(/\n(?=Title:)/u)) {
    const highlights = block.indexOf('\nHighlights:')
    const metadata = (highlights < 0 ? block : block.slice(0, highlights)).trim()
    const title = /^Title:[ \t]*(.*)$/mu.exec(metadata)?.[1]?.trim()
    const target = /^URL:[ \t]*(\S+)[ \t]*$/mu.exec(metadata)?.[1]
    if (!metadata.startsWith('Title:') || !target || !/^https?:\/\//iu.test(target)) continue
    let url
    try {
      const parsed = new URL(target)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) continue
      url = parsed.href
    } catch { continue }
    if (seen.has(url)) continue
    seen.add(url)
    const snippet = highlights < 0 ? '' : block.slice(highlights + '\nHighlights:'.length).replace(/\s+/gu, ' ').trim().slice(0, 1200)
    const published = /^Published:[ \t]*(.*)$/mu.exec(metadata)?.[1]?.trim()
    const publishedAt = published && /^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/u.test(published) && Number.isFinite(Date.parse(published)) ? published : undefined
    sources.push({ url, ...(title ? { title: title.slice(0, 1000) } : {}), ...(snippet ? { snippet } : {}), ...(publishedAt ? { publishedAt } : {}) })
  }
  return sources
}

/** Host-owned proxy transport; no environment, account or credential reads. */
export function createExaSearchProvider({ maxResults = 8, timeoutMs = 30000 } = {}, { fetchImpl = globalThis.fetch } = {}) {
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || typeof fetchImpl !== 'function') {
    throw new ExaError('Exa 搜索数量或超时配置无效。', 'WEB_SEARCH_INVALID_CONFIG')
  }
  return {
    id: 'exa', available: () => true,
    async search(request, signal) {
      if (signal?.aborted) throw new ExaError('网页搜索已取消。', 'WEB_ABORTED')
      if (typeof request?.query !== 'string' || request.query.length > 2000 || !request.query.trim() || /[\u0000-\u001f\u007f]/u.test(request.query) ||
        request.maxResults !== undefined && (!Number.isInteger(request.maxResults) || request.maxResults < 1)) {
        throw new ExaError('搜索查询或结果数量无效；查询最多允许 2000 个字符。', 'WEB_SEARCH_INVALID_QUERY')
      }
      const query = request.query.trim(), limit = Math.min(maxResults, request.maxResults ?? maxResults), id = randomUUID()
      const deadline = performance.now() + timeoutMs, timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), timeoutMs)
      const operationSignal = AbortSignal.any([timeout.signal, ...(signal ? [signal] : [])])
      const checkDeadline = () => { if (performance.now() >= deadline) timeout.abort(); operationSignal.throwIfAborted() }
      let response
      try {
        response = await fetchImpl(EXA_SEARCH_ENDPOINT, { method: 'POST', redirect: 'manual', credentials: 'omit', signal: operationSignal,
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'web_search_exa', arguments: { query, numResults: limit } } }),
        })
        checkDeadline()
        if (response.redirected || response.status >= 300 && response.status < 400) throw new ExaError('Exa 返回重定向；未访问跳转目标。', 'WEB_SEARCH_REDIRECT')
        if (response.status === 429) throw new ExaError('Exa 暂时限制搜索请求；请稍后重试。', 'WEB_SEARCH_RATE_LIMITED')
        if (!response.ok) throw new ExaError(`Exa 搜索请求失败（HTTP ${response.status}）。`, 'WEB_PROVIDER_ERROR')
        const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
        if (!['application/json', 'text/event-stream'].includes(contentType)) throw invalidResponse()
        const body = await readSearchBody(response, operationSignal, 'Exa')
        checkDeadline()
        const sources = parseSources(responseText(body, contentType, id))
        checkDeadline()
        if (!sources.length) throw new ExaError('Exa 未返回可确认的搜索来源；未将空响应记为成功。', 'WEB_SEARCH_EMPTY_UNCONFIRMED')
        return { query, provider: 'exa', engine: 'exa', sources: sources.slice(0, limit), truncated: sources.length > limit }
      } catch (error) {
        if (performance.now() >= deadline) timeout.abort()
        if (signal?.aborted) throw new ExaError('网页搜索已取消。', 'WEB_ABORTED')
        if (timeout.signal.aborted) throw new ExaError('Exa 搜索已超时。', 'WEB_TIMEOUT')
        if (error instanceof ExaError) throw error
        if (error?.code === 'WEB_RESPONSE_TOO_LARGE') throw new ExaError('Exa 响应超过允许大小。', 'WEB_RESPONSE_TOO_LARGE')
        throw new ExaError('Exa 搜索连接失败；请检查服务网络或稍后重试。', 'WEB_PROVIDER_ERROR')
      } finally {
        clearTimeout(timer)
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {})
      }
    },
  }
}
