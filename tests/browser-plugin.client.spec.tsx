// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ComponentProps, ComponentType } from 'react'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from './support/dsh-client-runtime.ts'
import * as BrowserPlugin from '../src/client/index.tsx'
import { PreplanningLauncher } from '../src/client/PreplanningLauncher.tsx'
import { PreplanningStatusCard } from '../src/client/PreplanningStatusCard.tsx'

afterEach(cleanup)

const SLOT = 'conversation.session.header.actions'
const fullStatus = {
  mode: 'manual' as const,
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
  it('按 Session Workspace 创建或恢复 Pre 项目，并启动当前 Session 任务', async () => {
    expect(BrowserPlugin.inject).toEqual([
      'conversationEvents',
      'remote',
      'remote.commands',
      'sessions',
      'slots',
    ])
    expect(typeof BrowserPlugin.apply).toBe('function')

    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as unknown as SlotRegistry
    const eventDefinitions: Array<{ kind: string }> = []
    ctx.provide('conversationEvents', {
      register: (definition: { kind: string }) => { eventDefinitions.push(definition); return () => undefined },
    } as never)
    const commandLines: string[] = []
    const prompts: string[] = []
    const commandsRemote = {
      execute: async (_sessionId: string, line: string) => {
        commandLines.push(line)
        const text = line === '/preplan-presentation-sync --probe'
          ? 'PRE_DESIGN_WORKSPACE_EMPTY\n工作区：C:\\Projects\\鄂州体育中心项目'
          : '命令执行成功。'
        return { ok: true, value: { result: { kind: 'success', text } } }
      },
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
      binding: (sessionId: string) => sessionId === 'session-1' ? {
        sessionId,
        ctx,
        session: {
          prompt: async (content: Array<{ type: string; text: string }>) => {
            prompts.push(content[0]?.text ?? '')
            return { ok: true, value: { accepted: true } }
          },
        },
      } : undefined,
    } as never)
    ctx.provide('workspaces', { openPath: vi.fn(async () => undefined) } as never)
    slots.register({
      name: 'root',
      children: {
        [SLOT]: { kind: 'list', scope: 'session' },
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
      },
    } as never, () => null)

    const fiber = ctx.plugin({
      inject: [...BrowserPlugin.inject],
      apply: BrowserPlugin.apply,
    })
    await fiber.await()

    const entries = slots.entries(SLOT)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.options).toMatchObject({ id: 'preplanning-agent', order: 60 })

    const HeaderEntry = entries[0]?.component as ComponentType<{ sessionId: string }>
    const view = render(<HeaderEntry sessionId="session-1" />)
    fireEvent.click(view.getByRole('button', { name: '前期策划' }))
    expect(view.getByText('前期策划项目')).toBeTruthy()
    expect(view.queryByText('主流程使用当前会话所选模型')).toBeNull()
    expect(view.getByText('Pre 2.0.0 · Project Format 0.1.0')).toBeTruthy()
    expect(view.getByText(/项目总文件夹：C:\\Projects\\鄂州体育中心项目/u)).toBeTruthy()
    expect(view.queryByText(/Qwen/)).toBeNull()
    fireEvent.change(view.getByLabelText('一句话描述项目和目标'), {
      target: { value: '新建鄂州体育中心项目并完成 01-01 身份校准' },
    })
    expect((view.getByLabelText('识别的项目名称') as HTMLInputElement).value).toBe('鄂州体育中心项目')
    fireEvent.click(view.getByRole('button', { name: '创建或继续全流程' }))
    await view.findByText('项目与 Presentation 标准目录已创建，前期策划全流程已经启动。')
    expect(commandLines).toEqual([
      '/preplan-presentation-sync --probe',
      '/preplan-new 鄂州体育中心项目',
      '/preplan-presentation-sync',
      '/preplan-mode manual 8 standard',
      '/preplan-run',
    ])
    expect(prompts).toHaveLength(0)
    expect(view.getByRole('button', { name: '打开项目文件夹' })).toBeTruthy()

    const statusEntry = slots.entries('conversation.chat.node')[0]
    expect(statusEntry?.options).toMatchObject({ key: 'preplanning-status' })
    expect(eventDefinitions.map(definition => definition.kind)).toContain('preplanning-status')
    const confirm = vi.fn(async () => undefined)
    const cardProps = {
      node: { data: {
        projectId: 'project-1', projectName: '验收项目', revision: 2, stage: '01-01',
        status: 'pending_review', pendingProposalCount: 1, pendingProposalId: 'proposal-1',
        openQuestionCount: 0, time: 1, ...fullStatus,
      } },
      confirm,
    } as unknown as ComponentProps<typeof PreplanningStatusCard>
    const card = render(<PreplanningStatusCard {...cardProps} />)
    expect(card.getByText('验收项目')).toBeTruthy()
    expect(card.getByText(/待人工确认/)).toBeTruthy()
    expect(card.container.textContent).toContain('Pre 2.0.0 · Project Format 0.1.0')
    fireEvent.click(card.getByRole('button', { name: '人工确认提案' }))
    await card.findByText('提案已确认，正在刷新项目状态。')
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm).toHaveBeenCalledWith('proposal-1')

    await fiber.dispose()
    expect(slots.entries(SLOT)).toHaveLength(0)
    expect(slots.entries('conversation.chat.node')).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('快速启动失败时在面板显示错误并允许重试', async () => {
    const start = vi.fn(async () => { throw new Error('当前会话没有可用模型') })
    const view = render(<PreplanningLauncher start={start} workspacePath="/workspace/project" />)
    fireEvent.click(view.getByRole('button', { name: '前期策划' }))
    fireEvent.change(view.getByLabelText('一句话描述项目和目标'), {
      target: { value: '创建测试项目，然后完成身份校准' },
    })
    fireEvent.submit(view.getByRole('form', { name: '新建前期策划项目' }))

    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('当前会话没有可用模型'))
    expect((view.getByRole('button', { name: '创建或继续全流程' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('人工确认失败时保留待确认状态并显示命令错误', async () => {
    const view = render(<PreplanningStatusCard {...({
      node: { data: {
        projectId: 'project-1', projectName: '验收项目', revision: 0, stage: '01-01',
        status: 'pending_review', pendingProposalCount: 1, pendingProposalId: 'proposal-1',
        openQuestionCount: 1, time: 1, ...fullStatus,
      } },
      confirm: async () => { throw new Error('revision 冲突') },
    } as unknown as ComponentProps<typeof PreplanningStatusCard>)} />)

    fireEvent.click(view.getByRole('button', { name: '人工确认提案' }))
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('revision 冲突'))
    expect(view.getByText(/待人工确认/)).toBeTruthy()
  })
})
