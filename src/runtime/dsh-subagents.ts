import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import type { SubagentRuntime, SubagentStartRequest, SubagentResult, SubagentInterruptAuthority } from '@deepseek-ai/dsh-subagent'

export interface PlanningChildRequest extends SubagentStartRequest {
  readonly persona?: string
  readonly toolFilter?: ToolRestriction
}
interface ChildPolicy {
  version: 1
  childId: string
  parentId: string
  persona: string
  allow: string[]
}
export interface PlanningChildRun {
  readonly id: SessionId
  readonly localAgent?: Agent
  readonly result: Promise<SubagentResult>
  dispose(): Promise<void>
}
/** Project-owned call contract. Only the new DSH activation API is used underneath. */
export class PreplanningSubagents {
  private readonly running = new Set<() => Promise<void>>()
  constructor(private readonly ctx: Context, private readonly runtime: Pick<SubagentRuntime, 'startActivation' | 'interrupt' | 'getProvider'>, private readonly root: string) {
    ctx.on('agent/created', async ({ agent }) => {
      const id = String(agent.id)
      if (!/^preplanning-(?:child|visual)-[a-zA-Z0-9-]+$/.test(id)) return
      let policy: ChildPolicy
      try { policy = JSON.parse(await readFile(this.policyPath(id), 'utf8')) as ChildPolicy }
      catch (error) { throw new Error('CHILD_POLICY_MISSING: managed child cannot start without its durable policy', { cause: error }) }
      if (policy.version !== 1 || policy.childId !== id || typeof policy.persona !== 'string'
        || !Array.isArray(policy.allow) || policy.allow.some(name => typeof name !== 'string')) throw new Error('CHILD_POLICY_INVALID')
      if (policy.parentId !== String(agent.session.header.parentSession)) throw new Error('CHILD_POLICY_PARENT_MISMATCH')
      // agent/created is awaited before queued model work, including cold resume.
      agent.ctx.tools.restrict({ allow: policy.allow })
      agent.ctx.systemPrompt.section({ name: 'deployment:persona-prefix', order: 0, text: policy.persona })
    })
    ctx.effect(() => async () => {
      const results = await Promise.allSettled([...this.running].map(dispose => dispose()))
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
      if (failures.length) throw new AggregateError(failures, 'CHILD_CLEANUP_FAILED')
    })
  }
  private policyPath(id: string): string { return join(this.root, `${createHash('sha256').update(id).digest('hex')}.json`) }
  getProvider(name: string) { return this.runtime.getProvider(name) }
  interrupt(id: SessionId, authority: SubagentInterruptAuthority): void { this.runtime.interrupt(id, authority) }
  private async activate(provider: string, request: PlanningChildRequest, childId?: SessionId): Promise<PlanningChildRun> {
    request.signal.throwIfAborted()
    if (provider !== 'spawn') throw new Error('PREPLANNING_CHILD_PROVIDER_UNSUPPORTED')
    const id = childId ?? `preplanning-child-${randomUUID()}` as SessionId
    if (!/^preplanning-(?:child|visual)-[a-zA-Z0-9-]+$/.test(String(id))) throw new Error('CHILD_POLICY_ID_INVALID')
    if (!request.toolFilter?.allow || request.toolFilter.deny) throw new Error('CHILD_POLICY_ALLOWLIST_REQUIRED')
    const policy: ChildPolicy = { version: 1, childId: String(id), parentId: String(request.parent.id), persona: request.persona ?? '', allow: [...request.toolFilter.allow] }
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    try { await writeFile(this.policyPath(String(id)), JSON.stringify(policy), { flag: 'wx', mode: 0o600 }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (await readFile(this.policyPath(String(id)), 'utf8') !== JSON.stringify(policy)) throw new Error('CHILD_POLICY_CONFLICT')
    }
    request.signal.throwIfAborted()
    const { persona: _persona, toolFilter: _filter, label, signal, ...nativeRequest } = request
    let localAgent: Agent | undefined
    const unlisten = this.ctx.on('agent/created', ({ agent }) => { if (String(agent.id) === String(id)) localAgent = agent; return undefined })
    const activation = await this.runtime.startActivation({ provider, childId: id, label: label ?? 'preplanning-child', request: nativeRequest, signal, delivery: 'caller' }).finally(unlisten)
    if (activation.childId !== id) {
      void activation.result.catch(() => {})
      await activation.dispose()
      throw new Error('CHILD_ID_MISMATCH')
    }
    let disposal: Promise<void> | undefined
    const dispose = () => disposal ??= (async () => {
      try { await activation.dispose() } finally { signal.removeEventListener('abort', cancel); this.running.delete(dispose) }
    })()
    const cancel = () => { void dispose().catch(() => {}) }
    this.running.add(dispose)
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) { await dispose(); signal.throwIfAborted() }
    const result = activation.result.finally(() => { signal.removeEventListener('abort', cancel); this.running.delete(dispose) })
    // A caller may first persist the accepted child identity before awaiting result.
    void result.catch(() => {})
    return { id: activation.childId, localAgent, result, dispose }
  }
  start(provider: string, request: PlanningChildRequest): Promise<PlanningChildRun> { return this.activate(provider, request) }
  async startContinuable(spec: { provider: string; label: string; childId?: SessionId; request: Omit<PlanningChildRequest, 'signal' | 'label'>; signal: AbortSignal }): Promise<{ childId: SessionId }> {
    const run = await this.activate(spec.provider, { ...spec.request, signal: spec.signal, label: spec.label }, spec.childId)
    return { childId: run.id }
  }
}
