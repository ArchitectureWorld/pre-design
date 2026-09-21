import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { Domain, DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { agentClassDomain, fallbacksSchema, routesSchema } from './domain.ts'
import { AGENT_CLASSES, type AgentClassId, type AgentClassView, type AvailabilityFailure, type CatalogProvider, type ClassExecution, type ClassFallbacks, type ClassRoutes, type ClassSettings, type ExecutionStatus, type ModelRoute } from './types.ts'
import { VISUAL_MODEL_ID, VISUAL_MODEL_PROVIDER } from '../visual/types.ts'
import { preplanningCancellationReason } from '../runtime/preplanning-execution-guard.ts'
import { retryDurableWrite } from '../state/durable-write.ts'

export interface ExecutionSession {
  snapshotEvents(): readonly { readonly type: string; readonly data: unknown }[]
}
interface Dependencies {
  readonly llm: Pick<LlmRuntime, 'listProviders' | 'listConfigurableProviders' | 'listModels'>
  readonly sessions: { get(id: string): ExecutionSession | undefined }
  readonly activity?: (id: string) => 'running' | 'idle' | undefined
  readonly modelTurnAuthorization?: (projectId: string, parentId: string) => {
    readonly authorizationId: string
    readonly grantedAt: string
    /** null explicitly authorizes tasks without a numeric cap; history is retained. */
    readonly maxModelTurns: number | null
    readonly visualBudgetMode?: 'bounded' | 'on_demand'
    readonly maxVisualGenerations?: number
    readonly projectVisualBudget?: number
  } | undefined
}
const sameRoute = (a: ModelRoute, b: ModelRoute) => a.provider === b.provider && a.model === b.model
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
export function modelRoute(value: unknown): ModelRoute | undefined {
  const config = object(value)
  return typeof config?.provider === 'string' && config.provider && typeof config.model === 'string' && config.model
    ? { provider: config.provider, model: config.model } : undefined
}
export function parentRoute(parent: Agent): ModelRoute | undefined {
  return modelRoute(parent.session?.requestHeader?.()?.config) ?? modelRoute(parent.options)
}
interface RouteAttempt {
  readonly configurationRevision: number
  readonly routeChain: readonly ModelRoute[]
  readonly routeIndex: number
  readonly chainId: string
  readonly fallbackFromExecutionId?: string
}
/** No message matching: a model can emit provider-looking prose or fail JSON validation. */
function availabilityFailure(reason: Record<string, unknown> | undefined): AvailabilityFailure | undefined {
  if (reason?.kind !== 'error') return undefined
  const failure = object(reason.error), code = failure?.code
  if (typeof code !== 'string') return undefined
  // These describe content/configuration failures even if a provider adds an HTTP status.
  if (['CONTEXT_WINDOW_EXCEEDED', 'INVALID_ARGS', 'EMPTY_RESPONSE', 'ABORTED', 'CANCELLED'].includes(code)) return undefined
  // QUOTA is the provider account balance, not this project's authorization budget.
  if (['AUTH', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL', 'NO_ADAPTER', 'MODEL_NOT_FOUND', 'PROVIDER_NOT_FOUND', 'QUOTA'].includes(code)) return 'provider'
  if (['TRANSPORT', 'NETWORK', 'CONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'transport'
  if (code === 'RATE_LIMIT') return 'rate-limit'
  if (code === 'SERVER') return 'server'
  if (failure?.status === 429) return 'rate-limit'
  if (Number.isInteger(failure?.status) && Number(failure?.status) >= 500 && Number(failure?.status) <= 599) return 'server'
  return undefined
}
/** Legacy/test executions with no recorded route chain have no authorized next model. */
export async function nextAgentClassAttempt(classes: Partial<Pick<AgentClassService, 'fallback'>> | undefined, execution: ClassExecution | undefined,
  parent: Agent, signal?: AbortSignal): Promise<ClassExecution | undefined> {
  signal?.throwIfAborted()
  if (!classes?.fallback || !execution?.routeChain || (execution.routeIndex ?? 0) + 1 >= execution.routeChain.length) return undefined
  return classes.fallback(execution.id, parent, signal)
}

export class AgentClassService {
  private chain: Promise<unknown> = Promise.resolve()
  private constructor(private readonly domain: Domain<typeof agentClassDomain>, private readonly dependencies: Dependencies) {}

  static async open(facility: DomainFacility, dependencies: Dependencies): Promise<AgentClassService> {
    const service = new AgentClassService(await facility.open(agentClassDomain), dependencies)
    // A process restart cannot prove that an earlier paid request stopped. Keep its identity.
    for (const [, run] of service.domain.table('executions').entries()) {
      if (run.status === 'starting' || run.status === 'running') {
        await service.update(run.id, { status: 'recovery_required', error: '宿主已重启，原任务状态待恢复。' })
      }
    }
    return service
  }
  async close(): Promise<void> { await this.chain; await this.domain.close() }
  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const next = this.chain.then(job)
    this.chain = next.catch(() => undefined)
    return next
  }
  settings(): ClassSettings {
    return structuredClone(this.domain.table('settings').get('global')
      ?? { revision: 0, routes: { image: { provider: VISUAL_MODEL_PROVIDER, model: VISUAL_MODEL_ID }, web: null, text: null } })
  }
  private async initialize(route?: ModelRoute): Promise<void> {
    if (!route) return
    await this.serialize(async () => {
      if (this.domain.table('settings').get('global')) return
      // Migrate the previous inherited route once. Later projects never change it.
      const settings: ClassSettings = { revision: 0, routes: {
        image: { provider: VISUAL_MODEL_PROVIDER, model: VISUAL_MODEL_ID }, web: route, text: route,
      } }
      await retryDurableWrite(() => this.domain.table('settings').put('global', settings))
    })
  }
  async catalog(): Promise<CatalogProvider[]> {
    const live = this.dependencies.llm.listProviders()
    const declared = this.dependencies.llm.listConfigurableProviders()
    const providers = new Map(live.map(row => [row.id, { provider: row.id, name: row.name, available: true }]))
    for (const row of declared) {
      if (!providers.has(row.provider)) providers.set(row.provider, { provider: row.provider, name: row.displayName, available: false })
    }
    return Promise.all([...providers.values()].map(async provider => {
      if (!provider.available) return { ...provider, models: [], error: '请先在 DSH 设置中启用此 Provider。' }
      try {
        const models = await this.dependencies.llm.listModels(provider.provider)
        return { ...provider, models: models.map(({ id, name }) => ({ id, name })) }
      } catch {
        return { ...provider, available: false, models: [], error: '模型目录读取失败，请检查 DSH 设置。' }
      }
    }))
  }
  private async validate(route: ModelRoute): Promise<void> {
    const live = this.dependencies.llm.listProviders().some(row => row.id === route.provider)
    const models = live ? await this.dependencies.llm.listModels(route.provider).catch(() => []) : []
    if (!models.some(row => row.id === route.model)) throw new Error(`MODEL_UNAVAILABLE: ${route.provider} / ${route.model} 已不可用，请在 DSH 设置和子 Agent 类配置中检查。`)
  }
  async save(revision: number, input: ClassRoutes, inputFallbacks?: ClassFallbacks): Promise<ClassSettings> {
    const requestedRoutes = routesSchema.parse(input)
    const requested = inputFallbacks === undefined ? undefined : fallbacksSchema.parse(inputFallbacks)
    return this.serialize(async () => {
      const current = this.settings()
      if (current.revision !== revision) throw new Error('CONFIG_CONFLICT: 全局配置已由其他页面更新，请重新载入后保存。')
      const routes = { ...current.routes, ...requestedRoutes }
      const fallbacks = { ...current.fallbacks, ...requested }
      for (const { id } of AGENT_CLASSES) {
        const backups = fallbacks[id] ?? [], primary = routes[id]
        if (backups.length && !primary) throw new Error('MODEL_PRIMARY_REQUIRED: 添加备用模型前请先选择主模型。')
        const chain = [...(primary ? [primary] : []), ...backups]
        if (new Set(chain.map(route => JSON.stringify([route.provider, route.model]))).size !== chain.length) {
          throw new Error('MODEL_ROUTE_DUPLICATE: 同一功能类的主模型与备用模型不能重复。')
        }
      }
      await Promise.all(Object.values(routes).filter((route): route is ModelRoute => route !== null).map(route => this.validate(route)))
      // Old clients cannot edit backups. Preserve their stored lists even when a
      // provider was removed later; the runtime skips unavailable catalog routes.
      if (requested) await Promise.all(Object.values(requested).flat().map(route => this.validate(route)))
      const settings = { revision: revision + 1, routes, ...(current.fallbacks || requested ? { fallbacks } : {}) }
      await retryDurableWrite(() => this.domain.table('settings').put('global', settings))
      return structuredClone(settings)
    })
  }
  async begin(projectId: string, classId: AgentClassId, task: string, parent: Agent, signal?: AbortSignal): Promise<ClassExecution> {
    signal?.throwIfAborted()
    await this.initialize(parentRoute(parent))
    const settings = this.settings()
    const selected = settings.routes[classId]
    if (!selected) throw new Error('MODEL_UNAVAILABLE: 请先在前期策划全局设置中为此类选择模型。')
    return this.beginRoute(projectId, classId, task, parent, { configurationRevision: settings.revision,
      routeChain: [selected, ...(settings.fallbacks?.[classId] ?? [])], routeIndex: 0, chainId: randomUUID() }, signal)
  }
  private async beginRoute(projectId: string, classId: AgentClassId, task: string, parent: Agent, plan: RouteAttempt, signal?: AbortSignal): Promise<ClassExecution> {
    signal?.throwIfAborted()
    const selected = plan.routeChain[plan.routeIndex]!
    const run = await this.serialize(async () => {
      signal?.throwIfAborted()
      const authorization = this.dependencies.modelTurnAuthorization?.(projectId, String(parent.id))
      const table = this.domain.table('executions')
      if (plan.fallbackFromExecutionId && [...table.entries()].some(([, row]) => row.fallbackFromExecutionId === plan.fallbackFromExecutionId)) {
        throw new Error('MODEL_FALLBACK_ALREADY_STARTED: 此次备用调用已预留，不能重复派发。')
      }
      if (authorization) {
        const grantedAt = Date.parse(authorization.grantedAt)
        if (!Number.isFinite(grantedAt) || (authorization.maxModelTurns !== null
          && (!Number.isSafeInteger(authorization.maxModelTurns) || authorization.maxModelTurns < 1))) {
          throw new Error('PREPLANNING_MODEL_BUDGET_INVALID: 自动策划轮数授权无效，已停止派发。')
        }
        // Each class dispatch owns one one-shot child/model turn. Reserve before
        // spawn, across every class, using the full durable table (not the UI's
        // last 100 rows). Failed/cancelled starts conservatively keep their slot.
        // Older rows lack a grant id: include those since this grant, and unknown
        // timestamps, so installing the guard never resets an existing budget.
        const onDemandImages = authorization.visualBudgetMode === 'on_demand'
        const used = [...table.entries()].filter(([, row]) => row.projectId === projectId && !(onDemandImages && row.classId === 'image')
          && (row.automationAuthorizationId === authorization.authorizationId
            || (row.automationAuthorizationId === undefined
              && (!Number.isFinite(Date.parse(row.startedAt)) || Date.parse(row.startedAt) >= grantedAt)))).length
        if (authorization.maxModelTurns !== null && !(onDemandImages && classId === 'image') && used >= authorization.maxModelTurns) {
          throw new Error(`PREPLANNING_MODEL_TURN_LIMIT: 已使用或预留 ${used}/${authorization.maxModelTurns} 轮自动策划模型任务，已停止新派发；失败重试也计入，原授权上限未改变。`)
        }
        if (classId === 'image' && !onDemandImages) {
          const images = [...table.entries()].filter(([, row]) => row.projectId === projectId && row.classId === 'image')
          const grantedImages = images.filter(([, row]) => row.automationAuthorizationId === authorization.authorizationId
            || (row.automationAuthorizationId === undefined && (!Number.isFinite(Date.parse(row.startedAt)) || Date.parse(row.startedAt) >= grantedAt)))
          if ((authorization.maxVisualGenerations !== undefined && grantedImages.length >= authorization.maxVisualGenerations)
            || (authorization.projectVisualBudget !== undefined && images.length >= authorization.projectVisualBudget)) {
            throw new Error('PREPLANNING_VISUAL_BUDGET_LIMIT: 生图授权额度已用尽，已停止新派发。')
          }
        }
      }
      const now = new Date().toISOString()
      const record: ClassExecution = { id: randomUUID(), projectId, classId, task: task.slice(0, 300), parentId: String(parent.id),
        ...plan, selected, status: 'starting', startedAt: now, updatedAt: now,
        ...(authorization ? { automationAuthorizationId: authorization.authorizationId } : {}) }
      await retryDurableWrite(() => table.put(record.id, record))
      return record
    })
    try { await this.validate(selected); signal?.throwIfAborted() } catch (error) {
      if (signal?.aborted) {
        await this.update(run.id, { status: 'cancelled', error: '模型派发已取消，未启动子会话。' })
        throw signal.reason
      }
      await this.update(run.id, { status: 'failed', availabilityFailure: 'catalog', error: error instanceof Error ? error.message : 'MODEL_UNAVAILABLE' })
      const next = await this.fallback(run.id, parent, signal)
      if (next) return next
      throw error
    }
    return structuredClone(run)
  }
  async fallback(id: string, parent: Agent, signal?: AbortSignal): Promise<ClassExecution | undefined> {
    signal?.throwIfAborted()
    const previous = this.execution(id)
    if (!previous || previous.parentId !== String(parent.id) || previous.status !== 'failed'
      || !previous.availabilityFailure || !previous.routeChain || !previous.chainId
      || previous.error?.startsWith('MODEL_ROUTE_MISMATCH') || this.dependencies.activity?.(previous.childId ?? '') === 'running') return undefined
    if (previous.availabilityFailure !== 'catalog' && previous.childStopReason !== 'error') return undefined
    // Persisted evidence survives disposal, but cannot authorize a switch once a
    // still-visible child has started another turn or changed its actual route.
    const events = previous.childId ? this.dependencies.sessions.get(previous.childId)?.snapshotEvents() : undefined
    if (events?.length && (object(this.terminal(previous)?.reason)?.kind !== 'error' || this.observed(previous).status === 'failed')) return undefined
    const index = (previous.routeIndex ?? 0) + 1
    if (index >= previous.routeChain.length) return undefined
    return this.beginRoute(previous.projectId, previous.classId, previous.task, parent, {
      configurationRevision: previous.configurationRevision, routeChain: previous.routeChain, routeIndex: index,
      chainId: previous.chainId, fallbackFromExecutionId: previous.id,
    }, signal)
  }
  execution(id: string): ClassExecution | undefined {
    const run = this.domain.table('executions').get(id)
    return run ? structuredClone(run) : undefined
  }
  private update(id: string, patch: Partial<ClassExecution>): Promise<ClassExecution> {
    return this.serialize(async () => {
      const run = this.execution(id)
      if (!run) throw new Error('EXECUTION_NOT_FOUND')
      const next = { ...run, ...patch, updatedAt: new Date().toISOString() }
      await retryDurableWrite(() => this.domain.table('executions').put(id, next))
      return structuredClone(next)
    })
  }
  async attach(id: string, childId: string): Promise<void> {
    const run = this.execution(id)
    if (run?.childId && run.childId !== childId) throw new Error('CHILD_IDENTITY_CHANGED')
    await this.update(id, { childId, status: 'running', childStopReason: undefined })
  }
  private observed(run: ClassExecution): Partial<ClassExecution> {
    const events = run.childId ? this.dependencies.sessions.get(run.childId)?.snapshotEvents() ?? [] : []
    const reason = object(this.terminal(run)?.reason)?.kind
    const lifecycle = events.length ? { childStopReason: typeof reason === 'string' ? reason : undefined } : {}
    const routes = events.filter(event => event.type === 'request/header')
      .map(event => modelRoute(object(object(event.data)?.header)?.config)).filter((route): route is ModelRoute => !!route)
    const actual = routes.at(-1)
    if (!actual) return lifecycle
    if (routes.some(route => !sameRoute(route, run.selected))) return { ...lifecycle, actual, status: 'failed', error: 'MODEL_ROUTE_MISMATCH: 子会话实际请求模型与派发配置不一致。' }
    return { ...lifecycle, actual }
  }
  private terminal(run: ClassExecution): Record<string, unknown> | undefined {
    const events = run.childId ? this.dependencies.sessions.get(run.childId)?.snapshotEvents() ?? [] : []
    const latest = events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
    return latest?.type === 'turn/end' ? object(latest.data) : undefined
  }
  private terminalModelFailure(run: ClassExecution): string | undefined {
    const reason = object(this.terminal(run)?.reason)
    if (reason?.kind !== 'error') return undefined
    const failure = object(reason.error), code = failure?.code
    // Classify only the native terminal envelope. Never copy raw provider text,
    // request URLs, credentials or assistant output into the project/UI error.
    const message = typeof failure?.message === 'string' ? failure.message.slice(0, 8000) : ''
    if (code === 'MISSING_CREDENTIAL') return 'MODEL_CREDENTIAL_MISSING: 模型服务缺少凭据，请在 DSH 设置中配置。'
    if (code === 'AUTH') return /refresh_token_(?:invalidated|expired)|session has ended|token refresh failed/iu.test(message)
      ? 'MODEL_LOGIN_EXPIRED: 模型登录已失效，请在 DSH 设置中重新登录。'
      : 'MODEL_AUTH_FAILED: 模型身份验证失败，请检查 DSH 设置中的凭据。'
    if (code === 'SERVER' && /\bno_healthy_account\b/u.test(message)) return 'MODEL_ACCOUNT_UNAVAILABLE: 模型服务没有可用账户，请检查服务账户状态；本次任务已停止。'
    const availability = availabilityFailure(reason)
    if (availability) return `MODEL_${availability.toUpperCase().replace('-', '_')}_UNAVAILABLE: 所选模型服务暂不可用，请检查 DSH 设置或服务状态。`
    return undefined
  }
  private activity(run: ClassExecution): ClassExecution['activity'] {
    if (!run.childId) return 'unknown'
    return this.dependencies.activity?.(run.childId) ?? (this.terminal(run) || run.childStopReason ? 'idle' : 'unknown')
  }
  async finish(id: string, status: ExecutionStatus, error?: string): Promise<void> {
    const run = this.execution(id)
    if (!run) throw new Error('EXECUTION_NOT_FOUND')
    const observed = this.observed(run)
    const failure = availabilityFailure(object(this.terminal(run)?.reason))
    const proof = { availabilityFailure: status === 'failed' && !preplanningCancellationReason(run.childId ? this.dependencies.sessions.get(run.childId)?.snapshotEvents() ?? [] : []) ? failure : undefined }
    if (status !== 'completed' && run.childId) error = preplanningCancellationReason(this.dependencies.sessions.get(run.childId)?.snapshotEvents() ?? [])
      ?? this.terminalModelFailure(run) ?? error
    const reason = object(this.terminal(run)?.reason)?.kind
    if (status === 'completed' && typeof reason === 'string' && reason !== 'completed') {
      const message = this.terminalModelFailure(run) ?? `CHILD_EXECUTION_FAILED: 子会话以 ${reason} 结束，任务不能标为完成。`
      await this.update(id, { ...observed, status: 'failed', error: message, availabilityFailure: failure })
      throw new Error(message)
    }
    if (status === 'completed' && (observed.status === 'failed' || !(observed.actual ?? run.actual))) {
      const reason = observed.error ?? 'MODEL_EXECUTION_UNVERIFIED: 尚无子会话模型请求记录。'
      await this.update(id, { ...observed, status: 'failed', error: reason })
      throw new Error(reason)
    }
    await this.update(id, { status, error, ...observed, ...proof })
  }
  async executions(projectId: string): Promise<ClassExecution[]> {
    const runs = [...this.domain.table('executions').entries()].map(([, row]) => row)
      .filter(row => row.projectId === projectId).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 100)
    const result: ClassExecution[] = []
    for (const run of runs) {
      const patch = this.observed(run)
      if ((patch.actual && JSON.stringify(patch.actual) !== JSON.stringify(run.actual)) || (patch.status && patch.status !== run.status)
        || ('childStopReason' in patch && patch.childStopReason !== run.childStopReason)) {
        const updated = await this.update(run.id, patch)
        result.push({ ...updated, activity: this.activity(updated) })
      } else result.push({ ...structuredClone(run), activity: this.activity(run) })
    }
    return result
  }
  async view(projectId?: string, route?: ModelRoute): Promise<AgentClassView> {
    await this.initialize(route)
    const [catalog, executions] = await Promise.all([this.catalog(), projectId ? this.executions(projectId) : Promise.resolve([])])
    return { settings: this.settings(), ...(projectId ? { projectId } : {}), catalog, executions }
  }
}
