import type { Context } from '@deepseek-ai/cordis'
import { registerPreplanningChildToolBoundary } from '../agent-classes/child-tool-boundary.ts'

interface Event { readonly type: string; readonly data: unknown }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
const VISUAL_NATIVE_IMAGE_ONLY = 'PREPLANNING_VISUAL_NATIVE_IMAGE_ONLY: 视觉子会话必须由所选模型直接输出图片，禁止调用工具、再委派或换用其他生图模型；模型不具备直接生图能力时结束并报告能力不足。'

function visualToolDenial(events: readonly Event[]): string | undefined {
  const label = object(events.findLast(event => event.type === 'subagent/descriptor')?.data).label
  return typeof label === 'string' && (label.startsWith('preplanning_visual_task:') || label.startsWith('preplanning_review:')) ? VISUAL_NATIVE_IMAGE_ONLY : undefined
}

export function preplanningCancellationReason(events: readonly Event[]): string | undefined {
  const latest = events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
  if (latest?.type !== 'turn/end') return undefined
  const reason = object(object(latest.data).reason)
  const cause = object(reason.reason)
  return reason.kind === 'aborted' && cause.kind === 'hook' && typeof cause.reason === 'string' && cause.reason.startsWith('PREPLANNING_')
    ? cause.reason.slice(0, 4096) : undefined
}

/** Inspect only the current turn. Historical errors never consume a new turn's budget. */
export function preplanningExecutionStop(events: readonly Event[], boundProject: boolean): string | undefined {
  const current = events.slice(Math.max(0, events.findLastIndex(event => event.type === 'turn/start')))
  const visualDenial = visualToolDenial(events)
  if (visualDenial && current.some(event => event.type === 'tool/call')) return visualDenial
  const label = object(events.find(event => event.type === 'subagent/descriptor')?.data).label
  const managedChild = typeof label === 'string' && /^preplanning_(?:workflow|web|visual_task|visual_tool_task|review):/u.test(label)
  const engaged = boundProject && current.some(event => event.type === 'tool/call' && String(object(event.data).name).startsWith('preplanning_'))
  if (!managedChild && !engaged) return undefined
  if (current.filter(event => event.type === 'step/start').length >= 40) {
    return 'PREPLANNING_STEP_LIMIT: 本轮已达到 40 步执行上限，已停止；请检查任务和资料后再重试。'
  }
  const calls = new Map<string, string>()
  const failures = new Map<string, { signature: string; count: number }>()
  let totalFailures = 0
  let placeholders = 0
  for (const event of current) {
    const data = object(event.data)
    if (event.type === 'tool/call') calls.set(String(data.callId), String(data.name))
    if (event.type !== 'tool/result') continue
    const content = object(data.message).content
    if (!Array.isArray(content)) continue
    for (const value of content) {
      const block = object(value)
      if (block.type !== 'tool-result') continue
      const name = calls.get(String(block.toolCallId))
      if (!name) continue
      const text = Array.isArray(block.content) ? block.content.filter(row => object(row).type === 'text').map(row => String(object(row).text ?? '')).join('\n') : ''
      if (block.isError) {
        totalFailures++
        const signature = text.slice(0, 2000)
        const previous = failures.get(name)
        const count = previous?.signature === signature ? previous.count + 1 : 1
        failures.set(name, { signature, count })
        if (count >= 3) return `PREPLANNING_REPEATED_TOOL_FAILURE: 工具 ${name} 连续 3 次返回相同错误，已停止本轮；请根据工具参数要求修正后重试。`
        if (totalFailures >= 8) return 'PREPLANNING_TOOL_FAILURE_LIMIT: 本轮累计 8 次工具失败，已停止；请检查子会话错误后重试。'
      } else {
        failures.delete(name)
        if ((name === 'pwsh' || name === 'bash') && /\[OK: Action logged -/u.test(text)) placeholders++
        if (placeholders >= 3) return 'PREPLANNING_NO_PROGRESS: 命令反复只回显操作描述，没有执行对应操作，已停止；文件是否存在须以实际读取结果为准。'
      }
    }
  }
  return undefined
}

export function registerPreplanningExecutionGuard(ctx: Context, boundProject: (id: string) => boolean): void {
  // SDK toolFilter limits inherited tools, but agent-local registrations can remain.
  // This monotonic guard also blocks local subagent/tools before their bodies run.
  ctx.tools.guard(exec => exec.agent ? visualToolDenial(exec.agent.session.snapshotEvents()) : undefined)
  registerPreplanningChildToolBoundary(ctx)
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const reason = preplanningExecutionStop(agent.session.snapshotEvents(), boundProject(String(agent.id)))
    if (!reason) return next()
    // Rejecting a step alone may leave queued work; cancellation closes the turn as aborted.
    agent.cancel({ kind: 'hook', reason })
    return { kind: 'reject' }
  })
}
