// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentClassPanel } from '../src/client/AgentClassPanel.tsx'
import type { AgentClassView } from '../src/agent-classes/types.ts'
afterEach(cleanup)
const a = { provider: 'p', model: 'a' }
const b = { provider: 'p', model: 'b' }
function snapshot(projectId = 'project', revision = 0): AgentClassView {
  return { projectId, settings: { revision, routes: { image: a, web: a, text: a } }, catalog: [{ provider: 'p', name: 'DSH Provider', available: true, models: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }], executions: [] }
}
it('shows three original presets plus image inspection, preserves edits during refresh and saves a versioned global config', async () => {
  const request = vi.fn(async (payload: any) => payload.action === 'save' ? { ...snapshot('project', 1), settings: { revision: 1, routes: payload.routes } } : snapshot())
  const view = render(<AgentClassPanel sessionId="s1" request={request} />)
  const select = await view.findByLabelText('文本生成模型') as HTMLSelectElement
  expect(view.getAllByRole('combobox')).toHaveLength(4)
  fireEvent.change(select, { target: { value: JSON.stringify(['p', 'b']) } })
  fireEvent.focus(window)
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  await waitFor(() => expect((view.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(false))
  expect(select.value).toBe(JSON.stringify(['p', 'b']))
  fireEvent.click(view.getByRole('button', { name: '保存配置' }))
  expect(await view.findByText('已保存，将用于后续新任务。')).toBeTruthy()
  expect(request.mock.calls.at(-1)?.[0]).toEqual({ action: 'save', sessionId: 's1', revision: 0, routes: { image: a, web: a, text: b } })
})
it('does not allow an old session response to overwrite the newly selected session', async () => {
  let resolveOld!: (value: AgentClassView) => void
  const old = new Promise<AgentClassView>(resolve => { resolveOld = resolve })
  const request = vi.fn(async (payload: any) => payload.sessionId === 'old' ? old : snapshot('new'))
  const view = render(<AgentClassPanel sessionId="old" request={request} />)
  view.rerender(<AgentClassPanel sessionId="new" request={request} />)
  await view.findByLabelText('文本生成模型')
  await act(async () => resolveOld(snapshot('old')))
  fireEvent.change(view.getByLabelText('文本生成模型'), { target: { value: JSON.stringify(['p', 'b']) } })
  fireEvent.click(view.getByRole('button', { name: '保存配置' }))
  await waitFor(() => expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ action: 'save', sessionId: 'new' }))
})
it('allows global configuration before selecting or creating any project', async () => {
  const request = vi.fn(async (_payload: unknown) => ({ ...snapshot(), projectId: undefined }))
  const view = render(<AgentClassPanel request={request} />)
  await view.findByLabelText('文本生成模型')
  fireEvent.change(view.getByLabelText('文本生成模型'), { target: { value: JSON.stringify(['p', 'b']) } })
  fireEvent.click(view.getByRole('button', { name: '保存配置' }))
  await waitFor(() => expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ action: 'save', revision: 0, routes: { text: b } }))
  expect(request.mock.calls.at(-1)?.[0]).not.toHaveProperty('projectId')
})
it('distinguishes dispatch model from actual model and exposes a removed selection', async () => {
  const data = snapshot()
  const request = vi.fn(async () => ({ ...data, catalog: [{ ...data.catalog[0], models: [{ id: 'b', name: 'B' }] }], executions: [{ id: 'r', projectId: 'project', classId: 'text' as const, task: '独立分析', parentId: 's', childId: 'child', configurationRevision: 0, selected: a, status: 'running' as const, startedAt: '2026-09-16T08:00:00Z', updatedAt: '2026-09-16T08:00:00Z' }] }))
  const view = render(<AgentClassPanel sessionId="s" request={request} />)
  expect(await view.findByText('实际模型：尚无模型请求记录')).toBeTruthy()
  expect(view.getByText('派发模型：p / a')).toBeTruthy()
  expect(view.getAllByText('已不可用 · p / a')).toHaveLength(3)
})
it('counts active child execution separately from historical and pending task results', async () => {
  const data = snapshot()
  const executions = ['running', 'idle', 'unknown'].map((activity, i) => ({ id: String(i), projectId: 'project', classId: 'text' as const, task: 'task', parentId: 's', childId: `child-${i}`, configurationRevision: 0, selected: a, status: 'running' as const, activity: activity as 'running' | 'idle' | 'unknown', startedAt: '2026-09-16T08:00:00Z', updatedAt: '2026-09-16T08:00:00Z' }))
  const view = render(<AgentClassPanel request={async () => ({ ...data, executions })} />)
  expect(await view.findByText('子会话运行中 1 · 已空闲 1 · 状态待核实 1')).toBeTruthy()
  expect(view.getByText('子会话：已空闲')).toBeTruthy()
})
it('adds, orders and deletes backups from the same directory and saves their explicit order', async () => {
  const c = { provider: 'p', model: 'c' }
  const data = snapshot()
  const request = vi.fn(async (payload: any) => ({ ...data, settings: { ...data.settings, ...(payload.action === 'save' ? { fallbacks: payload.fallbacks } : {}) },
    catalog: [{ ...data.catalog[0], models: [...data.catalog[0].models, { id: 'c', name: 'C' }] }] }))
  const view = render(<AgentClassPanel request={request} />)
  await view.findByLabelText('文本生成模型')
  fireEvent.click(view.getByRole('button', { name: '文本生成添加备用模型' }))
  fireEvent.change(view.getByLabelText('文本生成选择备用模型'), { target: { value: JSON.stringify(['p','b']) } })
  fireEvent.click(view.getByRole('button', { name: '文本生成添加备用模型' }))
  fireEvent.change(view.getByLabelText('文本生成选择备用模型'), { target: { value: JSON.stringify(['p','c']) } })
  fireEvent.click(view.getByRole('button', { name: '文本生成备用模型2上移' }))
  fireEvent.click(view.getByRole('button', { name: '保存配置' }))
  await waitFor(() => expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ fallbacks: { text: [c,b] } }))
  await waitFor(() => expect((view.getByRole('button', { name: '文本生成备用模型2删除' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(view.getByRole('button', { name: '文本生成备用模型2删除' }))
  fireEvent.click(view.getByRole('button', { name: '保存配置' }))
  await waitFor(() => expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ fallbacks: { text: [c] } }))
})
it('keeps an open backup picker across polling and focus refreshes, and closes it on save or explicit refresh', async () => {
  vi.useFakeTimers()
  try {
    let data = snapshot()
    const request = vi.fn(async (payload: any) => {
      if (payload.action === 'save') data = { ...data, settings: { revision: data.settings.revision + 1, routes: payload.routes, fallbacks: payload.fallbacks } }
      return data
    })
    const view = render(<AgentClassPanel request={request} />)
    await act(async () => {})
    fireEvent.click(view.getByRole('button', { name: '文本生成添加备用模型' }))
    expect(view.getByLabelText('文本生成选择备用模型')).toBeTruthy()

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(request.mock.calls.filter(([payload]) => payload.action === 'read')).toHaveLength(2)
    expect((view.getByLabelText('文本生成选择备用模型') as HTMLSelectElement).disabled).toBe(false)
    await act(async () => { fireEvent.focus(window) })
    expect(request.mock.calls.filter(([payload]) => payload.action === 'read')).toHaveLength(3)
    fireEvent.change(view.getByLabelText('文本生成选择备用模型'), { target: { value: JSON.stringify(['p', 'b']) } })

    // A different open picker must still close when the edited configuration is saved.
    fireEvent.click(view.getByRole('button', { name: '网络查询添加备用模型' }))
    await act(async () => { fireEvent.click(view.getByRole('button', { name: '保存配置' })) })
    expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ action: 'save', revision: 0, fallbacks: { text: [b] } })
    expect(view.queryByLabelText('网络查询选择备用模型')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: '网络查询添加备用模型' }))
    await act(async () => { fireEvent.click(view.getByRole('button', { name: '刷新配置与状态' })) })
    expect(view.queryByLabelText('网络查询选择备用模型')).toBeNull()
  } finally { vi.useRealTimers() }
})
