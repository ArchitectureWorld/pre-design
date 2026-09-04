import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useSyncExternalStore } from 'react'
import { startDirectPreplanning, type DirectStartPort } from './direct-start.ts'
import { PreplanningLauncher } from './PreplanningLauncher.tsx'
import { PreplanningStatusCard } from './PreplanningStatusCard.tsx'
import { preplanningStatusDefinition } from './status-definition.ts'

export const inject = [
  'conversationEvents',
  'remote',
  'remote.commands',
  'sessions',
  'slots',
]

function workspacePathOf(sessions: ISessions, sessionId: string): string | undefined {
  const snapshot = sessions.list.getSnapshot()
  return snapshot.byId[sessionId as keyof typeof snapshot.byId]?.cwd
}

function useWorkspacePath(sessions: ISessions, sessionId: string): string | undefined {
  const read = () => workspacePathOf(sessions, sessionId)
  return useSyncExternalStore(
    listener => sessions.list.subscribe(listener),
    read,
    read,
  )
}

async function executeCommand(
  ctx: ClientContext,
  sessionId: string,
  line: string,
): Promise<Awaited<ReturnType<DirectStartPort['executeCommand']>>> {
  const result = await ctx.remote.commands.execute(sessionId as SessionId, line, [])
  if (!result.ok) return { kind: 'error', text: `${result.error.code}: ${result.error.message}` }
  if (result.value === undefined) return { kind: 'unmatched' }
  const value = result.value.result
  return value.kind === 'error'
    ? { kind: 'error', text: value.text }
    : {
        kind: 'success',
        ...(typeof value.text === 'string' ? { text: value.text } : {}),
      }
}

async function requireSuccessfulCommand(
  ctx: ClientContext,
  sessionId: string,
  line: string,
): Promise<void> {
  const result = await executeCommand(ctx, sessionId, line)
  if (result.kind === 'unmatched') {
    throw new Error(`DSH 未找到 ${line.split(' ', 1)[0]}，请确认前期策划插件已加载。`)
  }
  if (result.kind === 'error') throw new Error(result.text)
}

async function openWorkspaceFolder(
  sessionId: string,
): Promise<void> {
  const response = await fetch('/preplan-open-workspace', {
    body: JSON.stringify({ sessionId }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  if (!response.ok) {
    const message = (await response.text()).trim()
    throw new Error(message || '项目文件夹打开失败，请重试。')
  }
}

export function apply(ctx: ClientContext): void {
  const sessions = ctx.get('sessions') as unknown as ISessions
  ctx.conversationEvents.register(preplanningStatusDefinition)
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'preplanning-agent',
    order: 60,
    label: '前期策划',
  }, ({ sessionId }: PropsRuntime<'conversation.session.header.actions'>) => {
    const workspacePath = useWorkspacePath(sessions, String(sessionId))
    return (
      <PreplanningLauncher
        openProjectFolder={() => openWorkspaceFolder(String(sessionId))}
        start={input => startDirectPreplanning({
          executeCommand: line => executeCommand(ctx, String(sessionId), line),
          prompt: async text => {
            const binding = sessions.binding(sessionId)
            if (binding === undefined) return { ok: false, message: '当前 DSH Session 不可用。' }
            const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
            return result.ok
              ? { ok: true }
              : { ok: false, message: `${result.error.code}: ${result.error.message}` }
          },
        }, input)}
        workspacePath={workspacePath}
      />
    )
  }))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'preplanning-status',
  }, (props: PropsRuntime<'conversation.chat.node', 'preplanning-status'>) => {
    const workspacePath = useWorkspacePath(sessions, String(props.sessionId))
    return (
      <PreplanningStatusCard
        {...props}
        confirm={async proposalId => {
          await requireSuccessfulCommand(ctx, String(props.sessionId), `/preplan-confirm ${proposalId}`)
        }}
        openProjectFolder={() => openWorkspaceFolder(String(props.sessionId))}
      />
    )
  }))
}
