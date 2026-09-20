import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

type ChildRole = 'web' | 'scene_spec' | 'review' | 'visual_task'
const allowedTools: Readonly<Record<ChildRole, readonly string[]>> = {
  web: ['web_search', 'web_fetch'], scene_spec: [], review: [], visual_task: [],
}

/** The same capability policy drives dispatch, model schemas and execution. */
export function preplanningChildToolFilter(role: ChildRole): { allow: string[] } {
  return { allow: [...allowedTools[role]] }
}

function nativeChildPolicy(agent: Agent | undefined): { allow: readonly string[]; retrievalBudget?: number } | undefined {
  if (!agent) return undefined
  const header = agent.session.header
  if (!header || header.origin !== 'subagent' || !header.parentSession || String(header.id) !== String(agent.id)
    || !Number.isSafeInteger(header.delegationDepth) || header.delegationDepth! < 1) return undefined
  // The runtime's establishing descriptor is authoritative. User messages,
  // tool output and later text that resembles a descriptor are never policy.
  const event = agent.session.snapshotEvents().find(row => row.type === 'subagent/descriptor')
  const value: unknown = event?.data
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const descriptor = value as Record<string, unknown>
  if (descriptor.version !== 3 || descriptor.provider !== 'spawn' || typeof descriptor.label !== 'string') return undefined
  const role = /^preplanning_(web|scene_spec|review|visual_task):.+/u.exec(descriptor.label)?.[1] as ChildRole | undefined
  if (!role || descriptor.mode !== (role === 'visual_task' ? 'continuable' : 'one-shot')) return undefined
  const budget = role === 'web' ? /:retrieval=([1-9]|1\d|20)$/u.exec(descriptor.label)?.[1] : undefined
  return { allow: allowedTools[role], ...(budget ? { retrievalBudget: Number(budget) } : {}) }
}

function currentRetrievalCalls(agent: Agent): { callId: unknown; name: unknown }[] {
  const events = agent.session.snapshotEvents()
  const start = events.findLastIndex(event => event.type === 'turn/start')
  if (start < 0) return []
  return events.slice(start + 1).flatMap(event => {
    if (event.type !== 'tool/call' || !event.data || typeof event.data !== 'object') return []
    const data = event.data as { callId?: unknown; name?: unknown }
    return typeof data.name === 'string' && allowedTools.web.includes(data.name) ? [{ callId: data.callId, name: data.name }] : []
  })
}

/** DSH toolFilter masks inherited tools; agent-local tools need both boundaries. */
export function registerPreplanningChildToolBoundary(ctx: Context): void {
  const pending = new WeakMap<Agent, PromptAssembly>()
  const restrict = (assembled: PromptAssembly, agent: Agent | undefined): void => {
    const policy = nativeChildPolicy(agent)
    if (!policy) return
    const exhausted = policy.retrievalBudget !== undefined && currentRetrievalCalls(agent!).length >= policy.retrievalBudget
    const allow = exhausted ? [] : policy.allow
    const removedGuidance = new Set(assembled.tools.filter(tool => !allow.includes(tool.name)).map(tool => `tool:${tool.name}`))
    // SystemPrompt may shallow-copy the envelope when enforcing a complete
    // prompt or suppressed runtime context; retain its shared array identities.
    assembled.tools.splice(0, assembled.tools.length, ...assembled.tools.filter(tool => allow.includes(tool.name)))
    assembled.sections.splice(0, assembled.sections.length, ...assembled.sections.filter(section => !removedGuidance.has(section.name)))
    if (exhausted && !assembled.sections.some(section => section.name === 'preplanning:web-retrieval-limit')) assembled.sections.push({
      name: 'preplanning:web-retrieval-limit',
      text: `本轮已达到 ${policy.retrievalBudget} 次检索上限，检索工具已关闭。请立即根据已有结果返回所要求的最终 JSON；证据不足的项目省略，无结果返回 []。不得继续检索或委派。`,
    })
  }
  ctx.tools.guard(exec => {
    const policy = nativeChildPolicy(exec.agent)
    if (!policy) return undefined
    if (!policy.allow.includes(exec.name)) return 'PREPLANNING_CHILD_TOOL_DENIED: 此子会话仅可使用其已声明的工具，禁止继续委派或调用其他能力。'
    if (policy.retrievalBudget !== undefined && exec.agent) {
      // The native loop logs tool/call BEFORE tools.execute. Its zero-based
      // position, not the total batch size, admits exactly the first N calls.
      const calls = currentRetrievalCalls(exec.agent)
      const own = calls.findLastIndex(call => call.callId === exec.callId && call.name === exec.name)
      if ((own < 0 ? calls.length : own) >= policy.retrievalBudget) return 'PREPLANNING_WEB_RETRIEVAL_LIMIT: 检索次数已达上限，请根据已有结果立即返回最终 JSON。'
    }
    return undefined
  })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    restrict(assembled, context.agent)
    if (context.agent) pending.set(context.agent, assembled)
    return assembled
  }, { prepend: true })
  // The native one-shot driver appends its descriptor in pre-step, AFTER the
  // loop has assembled the first request. Wrap that hook and finalize the same
  // assembly object before the loop renders its prompt and builds the request.
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    try {
      const decision = await next()
      const assembled = pending.get(agent)
      if (assembled && decision.kind === 'enter') restrict(assembled, agent)
      return decision
    } finally { pending.delete(agent) }
  }, { prepend: true })
}
