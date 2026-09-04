// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from './support/dsh-client-runtime.ts'
import * as BrowserPlugin from '../src/client/index.tsx'
import { PreplanningProjectForm } from '../src/client/PreplanningProjectForm.tsx'

afterEach(cleanup)

const HEADER_SLOT = 'conversation.session.header.actions'
const WORKSPACE = 'D:\\沙潭河'

function renderProjectForm(openProjectFolder = vi.fn(async () => undefined)) {
  return {
    openProjectFolder,
    view: render(
      <PreplanningProjectForm
        onClose={() => undefined}
        openProjectFolder={openProjectFolder}
        start={async () => undefined}
        workspacePath={WORKSPACE}
      />,
    ),
  }
}

describe('Preplanning Workspace panel polish', () => {
  it('uses a concise panel heading without implementation narration', () => {
    const { view } = renderProjectForm()

    expect(view.getByText('前期策划项目')).toBeTruthy()
    expect(view.queryByText('新建或继续前期策划')).toBeNull()
    expect(view.queryByText('一个 DSH 工作区对应一个 Pre 项目')).toBeNull()
    expect(view.queryByText('主流程使用当前会话所选模型')).toBeNull()

    const closeButton = view.getByRole('button', { name: '关闭前期策划面板' }) as HTMLButtonElement
    expect(closeButton.style.width).toBe('28px')
    expect(closeButton.style.height).toBe('28px')
  })

  it('shows explicit completion feedback after the project folder opens', async () => {
    const { openProjectFolder, view } = renderProjectForm()

    fireEvent.click(view.getByRole('button', { name: '打开项目文件夹' }))

    expect(await view.findByText('项目文件夹已打开。')).toBeTruthy()
    expect(openProjectFolder).toHaveBeenCalledOnce()
  })

  it('uses the DSH native Workspace opener instead of a slash command', async () => {
    expect(BrowserPlugin.inject).toEqual([
      'conversationEvents',
      'remote',
      'remote.commands',
      'sessions',
      'slots',
      'workspaces',
    ])

    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as unknown as SlotRegistry
    const commandLines: string[] = []
    const commandsRemote = {
      execute: async (_sessionId: string, line: string) => {
        commandLines.push(line)
        return { ok: true, value: { result: { kind: 'success', text: '命令执行成功。' } } }
      },
    }
    const openPath = vi.fn(async (_path: string) => undefined)

    ctx.provide('conversationEvents', { register: () => () => undefined } as never)
    ctx.provide('remote', { commands: commandsRemote } as never)
    ctx.provide('remote.commands', commandsRemote as never)
    ctx.provide('sessions', {
      list: {
        getSnapshot: () => ({
          ids: ['session-1'],
          byId: { 'session-1': { id: 'session-1', cwd: WORKSPACE } },
          current: 'session-1',
        }),
        subscribe: () => () => undefined,
      },
      binding: () => undefined,
    } as never)
    ctx.provide('workspaces', { openPath } as never)
    slots.register({
      name: 'root',
      children: {
        [HEADER_SLOT]: { kind: 'list', scope: 'session' },
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
      },
    } as never, () => null)

    const fiber = ctx.plugin({
      inject: [...BrowserPlugin.inject],
      apply: BrowserPlugin.apply,
    })
    await fiber.await()

    const HeaderEntry = slots.entries(HEADER_SLOT)[0]?.component as ComponentType<{ sessionId: string }>
    const view = render(<HeaderEntry sessionId="session-1" />)
    fireEvent.click(view.getByRole('button', { name: '前期策划' }))
    fireEvent.click(view.getByRole('button', { name: '打开项目文件夹' }))

    expect(await view.findByText('项目文件夹已打开。')).toBeTruthy()
    expect(openPath).toHaveBeenCalledWith(WORKSPACE)
    expect(commandLines).toEqual([])

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
