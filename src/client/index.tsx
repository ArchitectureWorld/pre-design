import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useReducer } from 'react'
import { startDirectPreplanning, type DirectStartPort } from './direct-start.ts'
import { PreplanningLauncher } from './PreplanningLauncher.tsx'
import { PreplanningProjectForm } from './PreplanningProjectForm.tsx'
import { PreplanningStatusCard } from './PreplanningStatusCard.tsx'
import { preplanningStatusDefinition } from './status-definition.ts'

export const inject = [
  'conversationEvents',
  'layout',
  'remote',
  'remote.commands',
  'sessions',
  'slots',
  'uiWorkspace',
  'workspaces',
]

interface WorkspaceView {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
  readonly updatedAt?: string
}

interface WorkspaceControllerPort {
  readonly list: {
    getSnapshot(): { readonly items: readonly WorkspaceView[] }
    subscribe(listener: () => void): () => void
  }
}

interface UiWorkspacePort {
  connectWorkspace(workspaceId: string): Promise<string>
}

interface LayoutPort {
  selectPanel(panelId: string | null): void
}

interface UntypedSlots {
  inject(name: string, callback: () => (() => void)): () => void
  register(options: Record<string, unknown> & { name: string }, component: unknown): () => void
}

function servicePorts(ctx: ClientContext): {
  readonly layout: LayoutPort
  readonly uiWorkspace: UiWorkspacePort
  readonly workspaces: WorkspaceControllerPort
} {
  return ctx as unknown as {
    readonly layout: LayoutPort
    readonly uiWorkspace: UiWorkspacePort
    readonly workspaces: WorkspaceControllerPort
  }
}

export function currentWorkspaceOf(
  workspaces: WorkspaceControllerPort,
  sessions: ISessions,
): WorkspaceView | undefined {
  const workspaceRows = workspaces.list.getSnapshot().items
  if (workspaceRows.length === 0) return undefined

  const sessionSnapshot = sessions.list.getSnapshot()
  const currentId = sessionSnapshot.current === undefined ? undefined : String(sessionSnapshot.current)
  if (currentId !== undefined) {
    const current = sessionSnapshot.byId[currentId as keyof typeof sessionSnapshot.byId]
    const byMembership = workspaceRows.find(row => row.sessionIds.some(id => String(id) === currentId))
    if (byMembership !== undefined) return byMembership
    if (current?.cwd !== undefined) {
      const byPath = workspaceRows.find(row => row.path === current.cwd)
      if (byPath !== undefined) return byPath
    }
  }

  // A root/global panel can exist before a formal Conversation is mounted.
  // In that blank state use the most recently updated Workspace as DSH itself does
  // for New Session fallback. A later Session selection immediately takes priority.
  return [...workspaceRows].sort((left, right) =>
    (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))[0]
}

function useCurrentWorkspace(
  workspaces: WorkspaceControllerPort,
  sessions: ISessions,
): WorkspaceView | undefined {
  const [, refresh] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    const unsubscribeWorkspaces = workspaces.list.subscribe(refresh)
    const unsubscribeSessions = sessions.list.subscribe(refresh)
    return () => {
      unsubscribeWorkspaces()
      unsubscribeSessions()
    }
  }, [sessions, workspaces])
  return currentWorkspaceOf(workspaces, sessions)
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

async function openWorkspaceFolder(sessionId: string): Promise<void> {
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

function PreplanningSidebarIcon({ size, active }: { readonly size: number; readonly active: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        alignItems: 'center',
        border: '1px solid currentColor',
        borderRadius: Math.max(5, Math.round(size * 0.24)),
        boxSizing: 'border-box',
        display: 'inline-flex',
        fontSize: Math.max(10, Math.round(size * 0.42)),
        fontWeight: 700,
        height: size,
        justifyContent: 'center',
        opacity: active ? 1 : 0.74,
        width: size,
      }}
    >
      P
    </span>
  )
}

export function apply(ctx: ClientContext): void {
  const sessions = ctx.get('sessions') as unknown as ISessions
  const { layout, uiWorkspace, workspaces } = servicePorts(ctx)
  const slots = ctx.slots as unknown as UntypedSlots
  ctx.conversationEvents.register(preplanningStatusDefinition)

  slots.inject('main', () => slots.register({
    name: 'main',
    key: 'preplanning',
  }, function PreplanningWorkspacePanel() {
    const workspace = useCurrentWorkspace(workspaces, sessions)
    const start = async () => {
      if (workspace === undefined) throw new Error('请先选择或创建 DSH 工作区。')
      const sessionId = await uiWorkspace.connectWorkspace(workspace.workspaceId)
      await startDirectPreplanning({
        executeCommand: line => executeCommand(ctx, String(sessionId), line),
      }, { workspacePath: workspace.path })
    }
    const openProjectFolder = workspace === undefined
      ? undefined
      : async () => {
          const sessionId = await uiWorkspace.connectWorkspace(workspace.workspaceId)
          await openWorkspaceFolder(String(sessionId))
        }

    return (
      <PreplanningProjectForm
        key={workspace?.workspaceId ?? 'workspace-unavailable'}
        embedded
        openProjectFolder={openProjectFolder}
        start={start}
        workspacePath={workspace?.path}
        workspaceTitle={workspace?.title}
      />
    )
  }))

  slots.inject('sidebar.panellist', () => slots.register({
    name: 'sidebar.panellist',
    id: 'preplanning',
    order: 60,
    label: '前期策划',
  }, PreplanningSidebarIcon))

  slots.inject('conversation.session.header.actions', () => slots.register({
    name: 'conversation.session.header.actions',
    id: 'preplanning-agent',
    order: 60,
    label: '前期策划',
  }, () => (
    <PreplanningLauncher openPanel={() => layout.selectPanel('preplanning')} />
  )))

  slots.inject('conversation.chat.node', () => slots.register({
    name: 'conversation.chat.node',
    key: 'preplanning-status',
  }, (props: PropsRuntime<'conversation.chat.node', 'preplanning-status'>) => (
    <PreplanningStatusCard
      {...props}
      openProjectFolder={() => openWorkspaceFolder(String(props.sessionId))}
    />
  )))
}
