import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { startDirectPreplanning } from './direct-start.ts'
import { PreplanningLauncher } from './PreplanningLauncher.tsx'
import { PreplanningStatusCard } from './PreplanningStatusCard.tsx'
import { preplanningStatusDefinition } from './status-definition.ts'

export const inject = ['conversationEvents', 'remote', 'remote.commands', 'sessions', 'slots']

export function apply(ctx: ClientContext): void {
  const sessions = ctx.get('sessions') as unknown as ISessions
  ctx.conversationEvents.register(preplanningStatusDefinition)
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'preplanning-agent',
    order: 60,
    label: '前期策划',
  }, ({ sessionId }: PropsRuntime<'conversation.session.header.actions'>) => (
    <PreplanningLauncher start={input => startDirectPreplanning({
      executeCommand: async line => {
        const result = await ctx.remote.commands.execute(sessionId, line, [])
        if (!result.ok) return { kind: 'error', text: `${result.error.code}: ${result.error.message}` }
        if (result.value === undefined) return { kind: 'unmatched' }
        return result.value.result.kind === 'error'
          ? { kind: 'error', text: result.value.result.text }
          : { kind: 'success' }
      },
      prompt: async text => {
        const binding = sessions.binding(sessionId)
        if (binding === undefined) return { ok: false, message: '当前 DSH Session 不可用。' }
        const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
        return result.ok
          ? { ok: true }
          : { ok: false, message: `${result.error.code}: ${result.error.message}` }
      },
    }, input)} />
  )))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'preplanning-status',
  }, (props: PropsRuntime<'conversation.chat.node', 'preplanning-status'>) => (
    <PreplanningStatusCard {...props} confirm={async proposalId => {
      const line = `/preplan-confirm ${proposalId}`
      const result = await ctx.remote.commands.execute(props.sessionId, line, [])
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      if (result.value === undefined) throw new Error('DSH 未找到 /preplan-confirm，请确认前期策划插件已加载。')
      if (result.value.result.kind === 'error') throw new Error(result.value.result.text)
    }} />
  )))
}
