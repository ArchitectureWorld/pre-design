// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ComponentProps, ComponentType } from 'react'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from './support/dsh-client-runtime.ts'
import * as BrowserPlugin from '../src/client/index.tsx'
import { PreplanningProjectForm } from '../src/client/PreplanningProjectForm.tsx'
import { PreplanningStatusCard } from '../src/client/PreplanningStatusCard.tsx'

afterEach(cleanup)

const fullStatus = {
  mode: 'automatic' as const,
  reportDepth: 'standard' as const,
  chapters: Array.from({ length: 8 }, (_, index) => ({
    id: String(index + 1).padStart(2, '0'), completed: 0,
    total: [7, 8, 6, 6, 7, 7, 8, 8][index]!, gateStatus: 'pending',
  })),
  blocked: 0,
  visual: { candidates: 0, adopted: 0, blocked: 0 },
  boundary: { kind: 'not_provided' as const, label: '尚未提供场地边界', nextAction: '请提供总平图、红线图或闭合红线坐标。' },
  modelRoute: { primary: '当前 DSH Session 所选模型', visual: 'antigravity / gemini-3.1-flash-image' },
}

describe('preplanning Browser plugin', () => {
  it('注册 Workspace root 主入口，同时保留 Session 快捷入口和状态卡', async () => {
    expect(BrowserPlugin.inject).toEqual([
      'conversationEvents',
      'layout',
      'remote',
      'remote.commands',
      'sessions',
      'slots',
      'uiWorkspace',
      'workspaces',
    ])

    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as unknown as SlotRegistry
    const eventDefinitions: Array<{ kind: string }> = []
    const selectPanel = vi.fn()
    ctx.provide('conversationEvents', {
      register: (definition: { kind: string }) => { eventDefinitions.push(definition); return () => undefined },
    } as never)
    const commandsRemote = {
      execute: async () => ({ ok: true, value: { result: { kind: 'success', text: 'PRE_DESIGN_WORKSPACE_PROJECT_ATTACHED' } } }),
    }
    ctx.provide('remote', { commands: commandsRemote } as never)
    ctx.provide('remote.commands', commandsRemote as never)
    ctx.provide('sessions', {
      list: {
        getSnapshot: () => ({
          ids: ['session-1'],
          byId: { 'session-1': { id: 'session-1', cwd: 'C:\\Projects\\鄂州体育中心项目' } },
          current: 'session-1',
        }),
        subscribe: () => () => undefined,
      },
    } as never)
    ctx.provide('workspaces', {
      list: {
        getSnapshot: () => ({ items: [{
          workspaceId: 'workspace-1', path: 'C:\\Projects\\鄂州体育中心项目', title: '鄂州体育中心项目',
          sessionIds: ['session-1'], updatedAt: '2026-09-15T00:00:00.000Z',
        }] }),
        subscribe: () => () => undefined,
      },
    } as never)
    ctx.provide('uiWorkspace', { connectWorkspace: vi.fn(async () => 'session-1') } as never)
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

    expect(slots.entries('main').find(row => row.options.key === 'preplanning')).toBeTruthy()
    expect(slots.entries('sidebar.panellist').find(row => row.options.id === 'preplanning')?.options)
      .toMatchObject({ id: 'preplanning', order: 60, label: '前期策划' })

    const header = slots.entries('conversation.session.header.actions')
      .find(row => row.options.id === 'preplanning-agent')
    expect(header).toBeTruthy()
    const HeaderEntry = header?.component as ComponentType<{ sessionId: string }>
    const shortcut = render(<HeaderEntry sessionId="session-1" />)
    fireEvent.click(shortcut.getByRole('button', { name: '前期策划' }))
    expect(selectPanel).toHaveBeenCalledWith('preplanning')

    const statusEntry = slots.entries('conversation.chat.node')[0]
    expect(statusEntry?.options).toMatchObject({ key: 'preplanning-status' })
    expect(eventDefinitions.map(definition => definition.kind)).toContain('preplanning-status')
    const cardProps = {
      node: { data: {
        projectId: 'project-1', projectName: '验收项目', revision: 2, stage: '01-01',
        status: 'pending_review', pendingProposalCount: 1, pendingProposalId: 'proposal-1',
        openQuestionCount: 0, time: 1, ...fullStatus,
      } },
    } as unknown as ComponentProps<typeof PreplanningStatusCard>
    const card = render(<PreplanningStatusCard {...cardProps} />)
    expect(card.getByText('验收项目')).toBeTruthy()
    expect(card.getByText(/系统正在自动处理/)).toBeTruthy()
    expect(card.queryByText(/待人工确认/)).toBeNull()
    expect(card.queryByRole('button', { name: '人工确认提案' })).toBeNull()

    await fiber.dispose()
    expect(slots.entries('main')).toHaveLength(0)
    expect(slots.entries('sidebar.panellist')).toHaveLength(0)
    expect(slots.entries('conversation.session.header.actions')).toHaveLength(0)
    expect(slots.entries('conversation.chat.node')).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('零输入启动失败时显示错误并允许重试', async () => {
    const start = vi.fn(async () => { throw new Error('项目创建失败') })
    const view = render(
      <PreplanningProjectForm
        embedded
        start={start}
        workspacePath="/workspace/project"
        workspaceTitle="project"
      />,
    )
    expect(view.queryByRole('textbox')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '开始前期策划' }))

    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('项目创建失败'))
    expect((view.getByRole('button', { name: '开始前期策划' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('自动模式的 pending proposal 只展示系统处理状态，不暴露人工审批动作', () => {
    const view = render(<PreplanningStatusCard {...({
      node: { data: {
        projectId: 'project-1', projectName: '验收项目', revision: 3, stage: '02-03',
        status: 'pending_review', pendingProposalCount: 2, pendingProposalId: 'proposal-2',
        openQuestionCount: 1, time: 1, ...fullStatus,
      } },
    } as unknown as ComponentProps<typeof PreplanningStatusCard>)} />)

    expect(view.getByText(/系统正在自动处理/)).toBeTruthy()
    expect(view.getByText(/自动处理 2 项/)).toBeTruthy()
    expect(view.getByText(/开放问题 1 项/)).toBeTruthy()
    expect(view.queryByText(/人工确认/)).toBeNull()
    expect(view.queryByRole('button', { name: '人工确认提案' })).toBeNull()
  })

  it('自动模式出现 workflow block 时明确展示受阻，而不是仍显示自动推进中', () => {
    const view = render(<PreplanningStatusCard {...({
      node: { data: {
        projectId: 'project-1', projectName: '受阻项目', revision: 4, stage: '03-02',
        status: 'active', pendingProposalCount: 0, openQuestionCount: 0, time: 1,
        ...fullStatus,
        blocked: 2,
      } },
    } as unknown as ComponentProps<typeof PreplanningStatusCard>)} />)

    expect(view.getByText(/自动推进受阻/)).toBeTruthy()
    expect(view.queryByText(/自动推进中/)).toBeNull()
    expect(view.getByText(/阻断 2/)).toBeTruthy()
    expect(view.queryByText(/人工确认/)).toBeNull()
  })
})
