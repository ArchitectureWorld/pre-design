// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from './support/dsh-client-runtime.ts'
import * as BrowserPlugin from '../src/client/index.tsx'
import type { AgentClassView } from '../src/agent-classes/types.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('loads the existing session binding before offering start and clears it when switching sessions', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as unknown as SlotRegistry
  let current = 'existing'
  const listeners = new Set<() => void>()
  let resolveRead!: (value: unknown) => void
  const pending = new Promise(resolve => { resolveRead = resolve })
  const existing: AgentClassView = {
    projectId: 'project-existing', settings: { revision: 6, routes: { image: null, text: null, web: null } },
    catalog: [], executions: [],
  }
  const request = vi.fn(async (_url: string, options: RequestInit) => {
    const payload = JSON.parse(String(options.body))
    expect(payload.action).toBe('read')
    if (payload.sessionId === 'existing') return pending
    return { ok: true, json: async () => ({ ...existing, projectId: undefined }) }
  })
  vi.stubGlobal('fetch', request)
  const execute = vi.fn()
  const connectWorkspace = vi.fn()
  ctx.provide('uiConversation', { events: { register: () => () => undefined } } as never)
  ctx.provide('remote', { commands: { execute } } as never)
  ctx.provide('remote.commands', { execute } as never)
  ctx.provide('sessions', { list: {
    getSnapshot: () => ({ current, ids: ['existing', 'new'], byId: {
      existing: { id: 'existing', cwd: 'D:\\project' }, new: { id: 'new', cwd: 'D:\\project' },
    } }),
    subscribe: (callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback) },
  } } as never)
  ctx.provide('workspaces', { list: {
    getSnapshot: () => ({ items: [{ workspaceId: 'workspace', path: 'D:\\project', title: 'project', sessionIds: ['existing', 'new'], updatedAt: '' }] }),
    subscribe: () => () => undefined,
  } } as never)
  ctx.provide('uiWorkspace', { connectWorkspace } as never)
  ctx.provide('layout', { selectPanel: vi.fn() } as never)
  slots.register({ name: 'root', children: {
    main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' },
    'conversation.session.header.actions': { kind: 'list', scope: 'session' },
    'conversation.chat.node': { kind: 'keyed', scope: 'session' },
  } } as never, () => null)
  const fiber = ctx.plugin({ inject: [...BrowserPlugin.inject], apply: BrowserPlugin.apply })
  await fiber.await()
  try {
    const MainPanel = slots.entries('main').find(row => row.options.key === 'preplanning')!.component as ComponentType
    const view = render(<MainPanel />)
    expect((view.getByRole('button', { name: '正在读取项目状态…' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => resolveRead({ ok: true, json: async () => existing }))
    expect(await view.findByText('当前会话已关联前期策划项目。')).toBeTruthy()
    const boundButton = view.getByRole('button', { name: '已关联项目' }) as HTMLButtonElement
    expect(boundButton.disabled).toBe(true)
    fireEvent.click(boundButton)
    expect(execute).not.toHaveBeenCalled()
    expect(connectWorkspace).not.toHaveBeenCalled()
    act(() => { current = 'new'; listeners.forEach(callback => callback()) })
    await waitFor(() => expect((view.getByRole('button', { name: '开始前期策划' }) as HTMLButtonElement).disabled).toBe(false))
    expect(view.queryByText('当前会话已关联前期策划项目。')).toBeNull()
    expect(execute).not.toHaveBeenCalled()
    view.unmount()
  } finally { await fiber.dispose(); await ctx.fiber.dispose() }
})
