// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentClassPanel } from '../src/client/AgentClassPanel.tsx'
import type { AgentClassView } from '../src/agent-classes/types.ts'

const a = { provider: 'p', model: 'a' }
const b = { provider: 'p', model: 'b' }
const tool = { provider: 'Comfyui-PIC', model: 'Klein', llm: a }
function snapshot(): AgentClassView {
  return { projectId: 'p1', settings: { revision: 1, routes: { image: tool, web: a, review: a, text: a } }, executions: [],
    catalog: [{ provider: 'p', name: 'Provider', available: true, models: [{ id: 'a', name: 'Model A' }, { id: 'b', name: 'Model B' }] },
      { provider: 'Comfyui-PIC', name: 'ComfyUI', available: true, models: [{ id: 'Klein', name: 'Klein', imageTool: 'comfyui_pic' }] }] }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = () => act(async () => {})
const tick = (ms = 5000) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
beforeEach(() => vi.useFakeTimers())
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

it('does not lock any selector while a passive read is pending', async () => {
  const read = deferred<AgentClassView>()
  const request = vi.fn((_payload: unknown, _signal: AbortSignal) => request.mock.calls.length === 1 ? Promise.resolve(snapshot()) : read.promise)
  const view = render(<AgentClassPanel request={request} />)
  await settle()
  await tick()
  expect(request).toHaveBeenCalledTimes(2)
  for (const select of view.getAllByRole('combobox')) expect((select as HTMLSelectElement).disabled).toBe(false)
  expect(view.getByRole('region', { name: '子 Agent 类配置' }).getAttribute('aria-busy')).toBe('false')
})

it.each(['primary', 'companion', 'backup-picker', 'backup-companion'])('keeps %s focused and does not poll or reload on window focus during selection', async kind => {
  const base = snapshot()
  const data: AgentClassView = kind === 'backup-companion' ? { ...base, settings: { ...base.settings, routes: { ...base.settings.routes, image: a }, fallbacks: { image: [tool] } } } : base
  const request = vi.fn(async (_payload: unknown, _signal: AbortSignal) => structuredClone(data))
  const view = render(<AgentClassPanel request={request} />)
  await settle()
  if (kind === 'backup-picker') fireEvent.click(view.getByRole('button', { name: '文本生成添加备用模型' }))
  const label = { primary: '生成图像模型', companion: '生成图像配套 LLM', 'backup-picker': '文本生成选择备用模型', 'backup-companion': '生成图像备用模型1配套 LLM' }[kind]!
  const select = view.getByLabelText(label) as HTMLSelectElement
  act(() => select.focus())
  const markup = select.innerHTML
  await tick(11000)
  await act(async () => { fireEvent.focus(window) })
  expect(request).toHaveBeenCalledTimes(1)
  expect(select.disabled).toBe(false)
  expect(document.activeElement).toBe(select)
  expect(select.innerHTML).toBe(markup)
  await act(async () => { select.blur() })
  expect(request).toHaveBeenCalledTimes(2)
})

it('defers an already-running response until selection ends without losing edits', async () => {
  const read = deferred<AgentClassView>()
  const base = snapshot()
  const updated: AgentClassView = { ...base, settings: { ...base.settings, revision: 2 }, catalog: [{ ...base.catalog[0]!, models: [{ id: 'a', name: 'Changed A' }, { id: 'b', name: 'Model B' }] }, base.catalog[1]!] }
  const request = vi.fn((_payload: unknown, _signal: AbortSignal) => {
    const count = request.mock.calls.length
    return count === 1 ? Promise.resolve(snapshot()) : count === 2 ? read.promise : Promise.resolve(updated)
  })
  const view = render(<AgentClassPanel request={request} />)
  await settle(); await tick()
  const select = view.getByLabelText('文本生成模型') as HTMLSelectElement
  act(() => select.focus())
  await act(async () => { read.resolve(updated) })
  expect(select.options[1]!.textContent).toBe('Model A')
  expect(select.value).toBe(JSON.stringify(['p', 'a']))
  fireEvent.change(select, { target: { value: JSON.stringify(['p', 'b']) } })
  await act(async () => { select.blur() })
  expect(select.value).toBe(JSON.stringify(['p', 'b']))
  expect(select.options[1]!.textContent).toBe('Changed A')
  expect(view.getByText('配置已在其他页面更新。请重新载入后编辑。')).toBeTruthy()
  expect((view.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(true)
})

it('preempts a passive read when saving and ignores its late response', async () => {
  const read = deferred<AgentClassView>(), save = deferred<AgentClassView>()
  const request = vi.fn((payload: any, _signal: AbortSignal) => payload.action === 'save' ? save.promise : request.mock.calls.length === 1 ? Promise.resolve(snapshot()) : read.promise)
  const view = render(<AgentClassPanel request={request} />)
  await settle()
  fireEvent.change(view.getByLabelText('文本生成模型'), { target: { value: JSON.stringify(['p', 'b']) } })
  await tick()
  const readSignal = request.mock.calls[1]![1]
  fireEvent.click(view.getByRole('button', { name: '保存配置' }))
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ action: 'save', revision: 1, routes: { text: b } })
  expect(readSignal.aborted).toBe(true)
  await act(async () => { read.resolve(snapshot()) })
  expect((view.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(true)
  const base = snapshot(); const saved = { ...base, settings: { revision: 2, routes: { ...base.settings.routes, text: b } } }
  await act(async () => { save.resolve(saved) })
  expect((view.getByLabelText('文本生成模型') as HTMLSelectElement).value).toBe(JSON.stringify(['p', 'b']))
  expect(view.getByText('已保存，将用于后续新任务。')).toBeTruthy()
})

it('lets an explicit reload replace a passive read without applying its obsolete result', async () => {
  const read = deferred<AgentClassView>(), explicit = deferred<AgentClassView>()
  const request = vi.fn((_payload: any, _signal: AbortSignal) => request.mock.calls.length === 1 ? Promise.resolve(snapshot()) : request.mock.calls.length === 2 ? read.promise : explicit.promise)
  const view = render(<AgentClassPanel request={request} />)
  await settle()
  fireEvent.change(view.getByLabelText('文本生成模型'), { target: { value: JSON.stringify(['p', 'b']) } })
  await tick()
  fireEvent.click(view.getByRole('button', { name: '重新载入（放弃修改）' }))
  expect(request).toHaveBeenCalledTimes(3)
  expect(request.mock.calls[1]![1].aborted).toBe(true)
  await act(async () => { read.resolve(snapshot()) })
  expect((view.getByLabelText('文本生成模型') as HTMLSelectElement).disabled).toBe(true)
  await act(async () => { explicit.resolve(snapshot()) })
  expect((view.getByLabelText('文本生成模型') as HTMLSelectElement).value).toBe(JSON.stringify(['p', 'a']))
  expect(view.queryByRole('button', { name: '保存配置' })).toBeNull()
})

it('does not apply delayed old-session or deferred picker data after switching sessions', async () => {
  const old = deferred<AgentClassView>()
  const base = snapshot(); const next = { ...base, settings: { ...base.settings, routes: { ...base.settings.routes, text: b } } }
  const request = vi.fn((payload: any, _signal: AbortSignal) => payload.sessionId === 'new' ? Promise.resolve(next) : request.mock.calls.length === 1 ? Promise.resolve(snapshot()) : old.promise)
  const view = render(<AgentClassPanel sessionId="old" request={request} />)
  await settle(); await tick()
  const signal = request.mock.calls[1]![1]
  act(() => (view.getByLabelText('文本生成模型') as HTMLSelectElement).focus())
  view.rerender(<AgentClassPanel sessionId="new" request={request} />)
  await settle()
  expect(signal.aborted).toBe(true)
  await act(async () => { old.resolve(snapshot()) })
  expect((view.getByLabelText('文本生成模型') as HTMLSelectElement).value).toBe(JSON.stringify(['p', 'b']))
})

it('defers an in-flight background error until the picker is left, then shows it', async () => {
  const read = deferred<AgentClassView>()
  const request = vi.fn((_payload: unknown, _signal: AbortSignal) => request.mock.calls.length === 1 ? Promise.resolve(snapshot()) : read.promise)
  const view = render(<AgentClassPanel request={request} />)
  await settle(); await tick()
  const select = view.getByLabelText('生成图像模型') as HTMLSelectElement
  act(() => select.focus())
  await act(async () => { read.reject(new Error('目录暂不可用')) })
  expect(view.queryByText('目录暂不可用')).toBeNull()
  expect(select.disabled).toBe(false)
  await act(async () => { select.blur() })
  expect(view.getByText('目录暂不可用')).toBeTruthy()
})
