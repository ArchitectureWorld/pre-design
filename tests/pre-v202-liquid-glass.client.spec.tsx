// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentClassPanel } from '../src/client/AgentClassPanel.tsx'
import type { AgentClassView } from '../src/agent-classes/types.ts'

const snapshot = (): AgentClassView => ({
  projectId: 'p1',
  settings: { revision: 3, routes: { image: { provider: 'p', model: 'a' }, web: null, text: null } },
  catalog: [{ provider: 'p', name: 'Provider', available: true, models: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }],
  executions: [],
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('renders four independent glass model cards without replacing the live DSH catalog', async () => {
  const request = vi.fn(async () => snapshot())
  const view = render(<AgentClassPanel sessionId="s1" request={request} />)
  await view.findByLabelText('生成图像模型')
  expect(view.container.querySelectorAll('.role-card')).toHaveLength(4)
  expect(view.getAllByRole('combobox')).toHaveLength(4)
  expect(view.queryByText(/Gemini 3/u)).toBeNull()
})

it('provides a retry action after the first configuration read fails', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('读取连接失败')).mockResolvedValue(snapshot())
  const view = render(<AgentClassPanel request={request} />)
  await view.findByRole('alert')
  fireEvent.click(view.getByRole('button', { name: '重试读取配置' }))
  await view.findByLabelText('生成图像模型')
  expect(request).toHaveBeenCalledTimes(2)
})

it('shows unsaved changes until the server acknowledges the save', async () => {
  const data = snapshot()
  const request = vi.fn(async (payload: any) => payload.action === 'save'
    ? { ...data, settings: { revision: 4, routes: payload.routes } } : data)
  const view = render(<AgentClassPanel request={request} />)
  await view.findByLabelText('文本生成模型')
  fireEvent.change(view.getByLabelText('文本生成模型'), { target: { value: '["p","b"]' } })
  expect(view.getByText('未保存')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '保存配置' }))
  await view.findByText('已保存，将用于后续新任务。')
  expect(view.queryByText('未保存')).toBeNull()
  await waitFor(() => expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ action: 'save', revision: 3 }))
})

it('displays actual execution outcomes separately from live child activity', async () => {
  const data = snapshot()
  const request = vi.fn(async () => ({ ...data, executions: [{
    id: 'r1', projectId: 'p1', classId: 'image' as const, task: '现场概念图', parentId: 's1',
    configurationRevision: 2, selected: { provider: 'p', model: 'a' },
    status: 'running' as const, activity: 'idle' as const,
    startedAt: '2026-09-23T00:00:00Z', updatedAt: '2026-09-23T00:01:00Z',
  }] }))
  const view = render(<AgentClassPanel sessionId="s1" request={request} />)
  expect(await view.findByRole('region', { name: '当前项目执行记录' })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: /执行记录/u }))
  expect(view.getByText('现场概念图')).toBeTruthy()
  expect(view.getByText('子会话空闲')).toBeTruthy()
  expect(view.queryByText('已完成')).toBeNull()
})
