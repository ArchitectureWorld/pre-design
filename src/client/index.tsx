import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useCallback, useEffect, useReducer, useState } from 'react'
import type { AgentClassView } from '../agent-classes/types.ts'
import { startDirectPreplanning, type DirectStartPort } from './direct-start.ts'
import { PreplanningLauncher } from './PreplanningLauncher.tsx'
import { PreplanningProjectForm } from './PreplanningProjectForm.tsx'
import { PreplanningStatusCard } from './PreplanningStatusCard.tsx'
import { preplanningStatusDefinition } from './status-definition.ts'
import { AgentClassPanel } from './AgentClassPanel.tsx'
import { installSubagentSummarySync } from './subagent-summary-sync.ts'

const PREPLANNING_PANEL_ID = 'preplanning' as MainPanelId

export const inject = [
  'layout',
  'remote',
  'remote.commands',
  'sessions',
  'slots',
  'uiConversation',
  'uiWorkspace',
  'workspaces',
]

interface BrowserControllerPorts {
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
}

function browserControllers(ctx: ClientContext): BrowserControllerPorts {
  // Host and browser packages intentionally use the same Cordis service keys.
  // This bundle runs only in the web client, so bind the rc.1 controller faces
  // explicitly instead of letting Host SessionStore augmentations leak into the
  // browser compilation surface.
  const ports = ctx as unknown as BrowserControllerPorts
  return { sessions: ports.sessions, workspaces: ports.workspaces }
}

export function currentWorkspaceOf(
  workspaces: IWorkspaces,
  sessions: ISessions,
): WorkspaceView | undefined {
  const workspaceRows = workspaces.list.getSnapshot().items
  if (workspaceRows.length === 0) return undefined

  const sessionSnapshot = sessions.list.getSnapshot()
  const currentId = sessionSnapshot.current
  if (currentId !== undefined) {
    const current = sessionSnapshot.byId[currentId]
    const byMembership = workspaceRows.find(row => row.sessionIds.includes(currentId))
    if (byMembership !== undefined) return byMembership
    if (current?.cwd !== undefined) {
      const byPath = workspaceRows.find(row => row.path === current.cwd)
      if (byPath !== undefined) return byPath
    }
  }

  // Root panels exist before a Conversation has a first message. Follow DSH's
  // Workspace-first fallback and surface the most recently mutated Workspace.
  return [...workspaceRows].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
}

function useCurrentWorkspace(
  workspaces: IWorkspaces,
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
  sessionId: SessionId,
  line: string,
): Promise<Awaited<ReturnType<DirectStartPort['executeCommand']>>> {
  const result = await ctx.remote.commands.execute(sessionId, line, [])
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

async function openWorkspaceFolder(sessionId: SessionId): Promise<void> {
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

function PreplanningSidebarIcon({ size, active }: PropsRuntime<'sidebar.panellist'>) {
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
  const { sessions, workspaces } = browserControllers(ctx)
  ctx.effect(() => installSubagentSummarySync(sessions), 'preplanning.subagent-summary-sync')
  ctx.uiConversation.events.register(preplanningStatusDefinition)

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PREPLANNING_PANEL_ID,
  }, function PreplanningWorkspacePanel() {
    const workspace = useCurrentWorkspace(workspaces, sessions)
    const sessionSnapshot = sessions.list.getSnapshot()
    const currentId = sessionSnapshot.current
    const configSessionId = currentId && workspace && (workspace.sessionIds.includes(currentId) || sessionSnapshot.byId[currentId]?.cwd === workspace.path) ? String(currentId) : undefined
    const [projectView, setProjectView] = useState<{ sessionId?: string; view: AgentClassView }>()
    const acceptProjectView = useCallback((view: AgentClassView) => {
      setProjectView({ sessionId: configSessionId, view })
    }, [configSessionId])
    const currentProjectView = configSessionId && projectView?.sessionId === configSessionId ? projectView.view : undefined
    const start = async () => {
      if (workspace === undefined) throw new Error('请先选择或创建 DSH 工作区。')
      const sessionId = await ctx.uiWorkspace.connectWorkspace(workspace.workspaceId)
      return startDirectPreplanning({
        executeCommand: line => executeCommand(ctx, sessionId, line),
      }, { workspacePath: workspace.path })
    }
    const openProjectFolder = workspace === undefined
      ? undefined
      : async () => {
          const sessionId = await ctx.uiWorkspace.connectWorkspace(workspace.workspaceId)
          await openWorkspaceFolder(sessionId)
        }

    return (
      <div style={{ overflowY: 'auto', height: '100%' }}>
      <PreplanningProjectForm
        key={`${workspace?.workspaceId ?? 'workspace-unavailable'}:${configSessionId ?? 'no-session'}`}
        embedded
        checkingProject={configSessionId !== undefined && currentProjectView === undefined}
        existingProjectId={currentProjectView?.projectId}
        projectRunning={currentProjectView?.executions.some(run => run.activity === 'running')}
        openProjectFolder={openProjectFolder}
        start={start}
        workspacePath={workspace?.path}
        workspaceTitle={workspace?.title}
      />
      <AgentClassPanel sessionId={configSessionId} onView={acceptProjectView} />
      </div>
    )
  }))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PREPLANNING_PANEL_ID,
    order: 60,
    label: '前期策划',
  }, PreplanningSidebarIcon))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'preplanning-agent',
    order: 60,
    label: '前期策划',
  }, () => (
    <PreplanningLauncher openPanel={() => ctx.layout.selectPanel(PREPLANNING_PANEL_ID)} />
  )))

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'preplanning-status',
  }, (props: PropsRuntime<'conversation.chat.node', 'preplanning-status'>) => (
    <PreplanningStatusCard
      {...props}
      openProjectFolder={() => openWorkspaceFolder(props.sessionId)}
    />
  )))
}
