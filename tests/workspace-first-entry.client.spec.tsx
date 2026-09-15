// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ComponentType } from 'react'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from './support/dsh-client-runtime.ts'
import * as BrowserPlugin from '../src/client/index.tsx'

afterEach(cleanup)

describe('Workspace-first Pre entry', () => {
  it('在第一条聊天消息之前就从 Workspace root 面板启动 Pre，且不发送伪造 prompt', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as unknown as SlotRegistry
    const selectPanel = vi.fn()
    const connectWorkspace = vi.fn(async () => 'blank-session-1')
    const commandLines: string[] = []

    ctx.provide('conversationEvents', { register: () => () => undefined } as never)
    const commandsRemote = {
      execute: async (sessionId: string, line: string) => {
        expect(sessionId).toBe('blank-session-1')
        commandLines.push(line)
        let text = '命令执行成功。'
        if (line === '/preplan-presentation-sync --probe') {
          text = 'PRE_DESIGN_WORKSPACE_EMPTY'
        } else if (line === '/preplan-presentation-sync') {
          text = [
            'PRE_DESIGN_SOURCE_MATERIAL_COUNT:2',
            'PRE_DESIGN_SOURCE_INBOX_COUNT:2',
          ].join('\n')
        }
        return {
          ok: true,
          value: { result: { kind: 'success', text } },
        }
      },
    }
    ctx.provide('remote', { commands: commandsRemote } as never)
    ctx.provide('remote.commands', commandsRemote as never)
    ctx.provide('sessions', {
      list: {
        getSnapshot: () => ({ ids: [], byId: {}, current: undefined, phase: 'ready' }),
        subscribe: () => () => undefined,
      },
    } as never)
    ctx.provide('workspaces', {
      list: {
        getSnapshot: () => ({
          items: [{
            workspaceId: 'workspace-1',
            path: 'C:\\Projects\\武汉站改造项目',
            title: '武汉站改造项目',
            sessionIds: [],
            createdAt: '2026-09-15T00:00:00.000Z',
            updatedAt: '2026-09-15T00:00:00.000Z',
          }],
          archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
        }),
        subscribe: () => () => undefined,
      },
    } as never)
    ctx.provide('uiWorkspace', { connectWorkspace } as never)
    ctx.provide('layout', { selectPanel } as never)

    slots.register({
      name: 'root',
      children: {
        main: { kind: 'keyed', scope: 'root' },
        'sidebar.panellist': { kind: 'list', scope: 'root' },
        'conversation.session.header.actions': { kind: 'list', scope: 'session' },
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
      },
    } as never, () => null)

    const fiber = ctx.plugin({ inject: [...BrowserPlugin.inject], apply: BrowserPlugin.apply })
    await fiber.await()

    const main = slots.entries('main').find(entry => entry.options.key === 'preplanning')
    const sidebar = slots.entries('sidebar.panellist').find(entry => entry.options.id === 'preplanning')
    expect(main).toBeTruthy()
    expect(sidebar?.options).toMatchObject({ id: 'preplanning', label: '前期策划' })

    const MainPanel = main?.component as ComponentType
    const view = render(<MainPanel />)
    expect(view.getByText('武汉站改造项目')).toBeTruthy()
    expect(view.getByText(/C:\\Projects\\武汉站改造项目/u)).toBeTruthy()
    expect(view.queryByRole('textbox')).toBeNull()
    expect(view.queryByLabelText('一句话描述项目和目标')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: '开始前期策划' }))
    await view.findByText('项目已创建或恢复，系统将自动推进前期策划。')

    expect(connectWorkspace).toHaveBeenCalledWith('workspace-1')
    expect(commandLines).toEqual([
      '/preplan-presentation-sync --probe',
      '/preplan-new 武汉站改造项目',
      '/preplan-presentation-sync',
      '/preplan-mode automatic 20 standard',
      '/preplan-run',
    ])
    expect(commandLines.every(line => line.startsWith('/preplan-'))).toBe(true)

    const header = slots.entries('conversation.session.header.actions')
      .find(entry => entry.options.id === 'preplanning-agent')
    expect(header).toBeTruthy()
    const HeaderEntry = header?.component as ComponentType<{ sessionId: string }>
    const shortcut = render(<HeaderEntry sessionId="blank-session-1" />)
    fireEvent.click(shortcut.getByRole('button', { name: '前期策划' }))
    expect(selectPanel).toHaveBeenCalledWith('preplanning')

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
