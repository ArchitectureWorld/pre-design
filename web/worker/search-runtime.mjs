import { randomUUID } from 'node:crypto'
import { WebError } from '@deepseek-ai/dsh-web'
import { DeepSeekSearchApiProvider } from '@deepseek-ai/dsh-web-deepseek-api'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'

const PROVIDER = 'deepseek-search-api'
const CREDENTIAL_ENV = 'PRE_WEB_SEARCH_CREDENTIAL'
const defaults = Object.freeze({ maxResults: 8, maxQueries: 4, timeoutMs: 30000 })

function searchConfiguration(policy) {
  if (policy?.enabled === false) return { status: 'disabled', code: 'WEB_SEARCH_DISABLED', reason: '管理员已关闭独立网页搜索。' }
  const unavailable = reason => ({ status: 'not_ready', code: 'WEB_SEARCH_NOT_READY', reason })
  if (!policy || policy.enabled !== true) return unavailable('尚未配置独立网页搜索。')
  if (policy.provider !== PROVIDER) return unavailable('搜索服务必须使用已适配的独立 Search API。')
  if (typeof policy.credentialRef !== 'string' || !/^credential:[\p{L}\p{N}][\p{L}\p{N}_.-]{0,127}$/u.test(policy.credentialRef)) return unavailable('尚未配置有效的搜索凭据引用。')
  let url
  try { url = new URL(policy.baseURL) } catch { return unavailable('尚未配置有效的搜索服务地址。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return unavailable('搜索服务地址必须为不含凭据、查询参数或片段的 HTTP(S) 地址。')
  const baseURL = url.href.replace(/\/+$/u, '')
  if (/\/(?:search|fetch)$/u.test(url.pathname.replace(/\/+$/u, ''))) return unavailable('搜索服务地址应包含 API 路径前缀，不包含末尾的 search 或 fetch 操作名。')
  const limits = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, policy[key] ?? fallback]))
  if (!Object.entries({ maxResults: 50, maxQueries: 8, timeoutMs: 120000 }).every(([key, max]) => Number.isInteger(limits[key]) && limits[key] >= 1 && limits[key] <= max)) return unavailable('搜索条数、查询数量或超时超出允许范围。')
  return { status: 'ready', code: 'WEB_SEARCH_READY', reason: '搜索配置已就绪；远端服务可用性以实际请求结果为准。',
    config: Object.freeze({ baseURL, credentialRef: policy.credentialRef, ...limits }) }
}

/** Project only the task's selected search configuration and private credential into DSH. */
export function materializeSearchRuntime(searchPolicy, credentials = {}) {
  let state = searchConfiguration(searchPolicy), credential
  if (state.status === 'ready') {
    const ref = state.config.credentialRef
    credential = credentials?.refs?.[ref] ?? credentials?.refs?.[ref.slice('credential:'.length)]
    if (typeof credential !== 'string' || !credential.trim()) state = {
      status: 'not_ready', code: 'WEB_SEARCH_NOT_READY', reason: '指定搜索凭据不存在；未使用账户或其他环境凭据。',
    }
  }
  const ready = state.status === 'ready', config = state.config ?? defaults
  return {
    patches: [
      { id: 'web-search-deepseek', disabled: true },
      { id: 'web', config: { searchProvider: PROVIDER, fetchProvider: 'http' } },
      { id: 'web-deepseek-api', disabled: !ready, config: {
        apiKey: '', apiKeyEnv: CREDENTIAL_ENV, baseURL: ready ? config.baseURL : '', count: config.maxResults, sendOriginalQuestion: false,
      } },
      { id: 'tool-web', config: { search: ready, fetch: true, searchMaxResults: config.maxResults,
        searchMaxQueries: config.maxQueries, searchTimeoutMs: config.timeoutMs } },
    ],
    env: ready ? { [CREDENTIAL_ENV]: credential } : {},
    availability: { status: state.status, code: state.code, reason: state.reason, provider: PROVIDER,
      ...(ready ? { endpoint: `${config.baseURL}/search` } : {}) },
  }
}

function operationError(error, signal, timeout) {
  if (signal?.aborted) return new WebError('网页搜索已取消。', 'WEB_ABORTED')
  if (timeout.aborted) return new WebError('独立网页搜索已超时。', 'WEB_TIMEOUT')
  if (error?.code === 'WEB_PROVIDER_CREDENTIAL_MISSING') return new WebError('本次任务的专用搜索凭据不可用。', 'WEB_PROVIDER_CREDENTIAL_MISSING')
  // Upstream bodies can echo credentials or arbitrary text. Preserve the failure,
  // never expose that body (or a cause containing it) to tools or the audit log.
  const status = /HTTP (\d{3})/u.exec(String(error?.message ?? ''))?.[1]
  return new WebError(`独立搜索服务请求失败${status ? `（HTTP ${status}）` : ''}；请检查管理员配置或稍后重试。`, 'WEB_PROVIDER_ERROR')
}

/**
 * Fix the native Search API provider to one task snapshot. DSH rc.5's provider
 * reads live settings and prioritizes account/stored credentials, so the service
 * entry uses the same installed provider class with a process-only resolver.
 * No headers, credential values, full prompts, or upstream error bodies are audited.
 */
export function installSearchBoundary(ctx, { searchPolicy, availability, onAudit } = {}) {
  const state = searchConfiguration(searchPolicy), config = state.config
  const ready = state.status === 'ready' && availability?.status === 'ready'
  const unavailableReason = state.status === 'ready' ? availability?.reason ?? '本次任务的搜索配置未就绪。' : state.reason
  const endpoint = ready ? `${config.baseURL}/search` : undefined
  if (ready && (availability.provider !== PROVIDER || availability.endpoint !== endpoint)) throw new WebError('搜索可用性与任务快照不一致。', 'WEB_SEARCH_SNAPSHOT_MISMATCH')
  const web = ctx.web, originalSearch = web.search, originalFetch = web.fetch
  // The launch snapshot is immutable. Its process layer is supplied by the
  // parent Worker, and excludes managed credentials and project/user .env files.
  const environment = launchEnvironmentOf(ctx)
  const provider = ready ? new DeepSeekSearchApiProvider(() => ({
    baseURL: config.baseURL, count: config.maxResults, apiKeyEnv: CREDENTIAL_ENV,
    resolveApiKey: async () => environment.getFrom(CREDENTIAL_ENV, ['process'])?.value,
  })) : undefined
  const audit = onAudit ?? (entry => ctx.get('agents')?.currentInitiator()?.session.append('web/search-operation', entry))
  const search = async (request, signal) => {
    if (!ready) throw new WebError(unavailableReason, state.status === 'disabled' ? 'WEB_SEARCH_DISABLED' : 'WEB_SEARCH_NOT_READY')
    if (signal?.aborted) throw new WebError('网页搜索已取消。', 'WEB_ABORTED')
    if (typeof request?.query !== 'string' || !request.query.trim() || request.maxResults !== undefined && (!Number.isInteger(request.maxResults) || request.maxResults < 1)) throw new WebError('搜索查询或结果数量无效。', 'WEB_SEARCH_INVALID_QUERY')
    const maxResults = Math.min(config.maxResults, request.maxResults ?? config.maxResults)
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), config.timeoutMs)
    const operationSignal = AbortSignal.any([timeout.signal, ...(signal ? [signal] : [])])
    const id = randomUUID(), started = Date.now()
    const record = (phase, details = {}) => audit({ id, at: new Date().toISOString(), phase, provider: PROVIDER, endpoint, ...details })
    try {
      // "started" is an operation attempt, never proof that a network request
      // was sent or accepted; credential resolution and cancellation may stop it.
      await record('started', { maxResults })
      const result = await provider.search({ query: request.query, maxResults }, operationSignal)
      const capped = result.sources.length > maxResults ? { ...result, sources: result.sources.slice(0, maxResults), truncated: true } : result
      await record('succeeded', { sourceCount: capped.sources.length, truncated: capped.truncated, durationMs: Date.now() - started })
      return capped
    } catch (error) {
      const safe = operationError(error, signal, timeout.signal)
      await record('failed', { code: safe.code, durationMs: Date.now() - started })
      throw safe
    } finally { clearTimeout(timer) }
  }
  const fetch = async (request, signal) => {
    if (web.config.fetchProvider.get() !== 'http') throw new WebError('网页原文读取仅允许本地受控 HTTP provider。', 'WEB_FETCH_ROUTE_FORBIDDEN')
    return originalFetch.call(web, request, signal)
  }
  return ctx.effect(function* () {
    web.search = search; web.fetch = fetch
    yield () => { web.search = originalSearch; web.fetch = originalFetch }
  }, 'pre-web.search-boundary')
}
