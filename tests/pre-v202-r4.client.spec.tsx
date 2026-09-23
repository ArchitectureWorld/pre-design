// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentClassPanel } from '../src/client/AgentClassPanel.tsx'
import { ClassExecutionPanel } from '../src/client/ClassExecutionPanel.tsx'
import { LiquidGlassShell } from '../src/client/LiquidGlassShell.tsx'
import { SESSION_GLASS_STYLES } from '../src/client/glass-session-styles.ts'
import type { AgentClassView, ClassExecution } from '../src/agent-classes/types.ts'

const llm = { provider: 'p', model: 'llm' }
const klein = { provider: 'Comfyui-PIC', model: 'Klein', llm }
const value = (r: { provider: string; model: string }) => JSON.stringify([r.provider, r.model])
const data = (): AgentClassView => ({ projectId: 'p1', settings: { revision: 7, routes: { image: klein, text: llm, web: llm, review: llm } },
  catalog: [{ provider: 'p', name: 'Provider', available: true, models: [{ id: 'llm', name: 'LLM' }, { id: 'image', name: 'Image' }] },
    { provider: 'Comfyui-PIC', name: 'ComfyUI', available: true, models: [{ id: 'Klein', name: 'Klein', imageTool: 'comfyui_pic' }] }], executions: [] })
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks() })

it('does not disable or replace model controls while a five-second refresh is pending', async () => {
  vi.useFakeTimers()
  let finish!: (d: AgentClassView) => void
  const request = vi.fn().mockResolvedValueOnce(data()).mockImplementation(() => new Promise(r => { finish = r }))
  const ui = render(<AgentClassPanel request={request} />)
  await act(async () => { await Promise.resolve() })
  const picker = ui.getByLabelText('生成图像模型') as HTMLSelectElement
  await act(async () => { vi.advanceTimersByTime(5000) })
  expect(request).toHaveBeenCalledTimes(2)
  expect(picker.disabled).toBe(false)
  expect(ui.getByLabelText('生成图像模型')).toBe(picker)
  await act(async () => { finish(data()) })
})
it('keeps a focused picker enabled on window refocus and defers changed options until blur', async () => {
  let finish!: (d: AgentClassView) => void
  const request = vi.fn().mockResolvedValueOnce(data()).mockImplementation(() => new Promise(r => { finish = r }))
  const ui = render(<AgentClassPanel request={request} />)
  const picker = await ui.findByLabelText('生成图像模型') as HTMLSelectElement
  fireEvent.focus(window)
  act(() => picker.focus())
  expect(picker.disabled).toBe(false)
  const current = data(); const next = { ...current, catalog: [{ ...current.catalog[0]!, models: [...current.catalog[0]!.models, { id:'new', name:'New model' }] }, current.catalog[1]!] }
  await act(async () => { finish(next) })
  expect([...picker.options].some(o => o.textContent === 'New model')).toBe(false)
  expect(document.activeElement).toBe(picker)
  act(() => picker.blur())
  await waitFor(() => expect([...picker.options].some(o => o.textContent === 'New model')).toBe(true))
})
it('lets an explicit save supersede an in-flight background read instead of silently ignoring it', async () => {
  let finish!: (d: AgentClassView) => void; let readSignal!: AbortSignal
  let reads = 0
  const request = vi.fn(async (payload: any, signal: AbortSignal) => {
    if (payload.action === 'save') return { ...data(), settings: { revision: 8, routes: payload.routes, fallbacks: payload.fallbacks } }
    if (++reads === 1) return data()
    readSignal = signal
    return await new Promise<AgentClassView>(r => { finish = r })
  })
  const ui = render(<AgentClassPanel request={request} />)
  fireEvent.change(await ui.findByLabelText('文本生成模型'), { target: { value: value({ provider:'p', model:'image' }) } })
  fireEvent.focus(window)
  fireEvent.click(ui.getByRole('button', { name: '保存配置' }))
  await ui.findByText('已保存，将用于后续新任务。')
  expect(readSignal.aborted).toBe(true)
  await act(async () => { finish(data()) })
  expect((ui.getByLabelText('文本生成模型') as HTMLSelectElement).value).toBe('["p","image"]')
})
it('uses the same inline route pair for the primary and each tool-backed fallback', async () => {
  const ui = render(<AgentClassPanel request={async () => data()} />)
  const primary = await ui.findByLabelText('生成图像模型')
  expect(primary.closest('.route-pair')).toBeTruthy()
  expect(primary.closest('.route-pair')).toBe(ui.getByLabelText('生成图像配套 LLM').closest('.route-pair'))
  fireEvent.change(primary, { target: { value:'["p","image"]' } })
  fireEvent.click(ui.getByRole('button', { name:'生成图像添加备用模型' }))
  fireEvent.change(ui.getByLabelText('生成图像选择备用模型'), { target: { value:value(klein) } })
  const backup = ui.getByLabelText('生成图像备用模型1配套 LLM')
  expect(backup.closest('.route-pair')?.querySelector('.fallback-name')).toBeTruthy()
  expect(ui.getByRole('button', { name:'生成图像添加备用模型' }).textContent).toBe('')
})
it('keeps glass cards stationary regardless of the dynamic-light preference', () => {
  expect(SESSION_GLASS_STYLES).toContain('.role-card:focus-within {transform:none!important;}')
})
function run(i: number): ClassExecution { return { id:`run-${i}`, projectId:'p1', parentId:'s', classId:'image', task:`Task ${i}`, configurationRevision:7, selected:klein, actual:klein, status:'running', activity:'idle', startedAt:new Date(Date.UTC(2026,8,23,0,i)).toISOString(), updatedAt:new Date(Date.UTC(2026,8,23,0,i)).toISOString() } }
it('opens execution history in a separate dialog, showing all received records newest first', () => {
  const rows = Array.from({ length:35 }, (_, i) => run(i)); rows[0] = { ...rows[0]!, updatedAt:'2026-09-24T00:00:00Z' }
  const ui = render(<LiquidGlassShell><ClassExecutionPanel projectId="p1" executions={rows} /></LiquidGlassShell>)
  expect(ui.queryByText('Task 34')).toBeNull()
  fireEvent.click(ui.getByRole('button', { name:/执行记录/u }))
  const dialog = ui.getByRole('dialog', { name:'执行记录' })
  const articles = dialog.querySelectorAll('.execution-row')
  expect(articles).toHaveLength(35)
  expect(articles[0]?.textContent).toContain('Task 34')
  expect(articles[34]?.textContent).toContain('Task 0')
  expect(dialog.querySelector('.execution-scroll')).toBeTruthy()
  expect(within(dialog).queryByText('已完成')).toBeNull()
  fireEvent.click(within(dialog).getByRole('button', { name:'关闭执行记录' }))
  expect(ui.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(ui.getByRole('button', { name:/执行记录/u }))
})
it('does not leak history from another project or lose actual companion evidence', () => {
  const ui = render(<ClassExecutionPanel projectId="p1" executions={[run(1), { ...run(2), projectId:'other' }]} />)
  fireEvent.click(ui.getByRole('button', { name:/执行记录/u }))
  const dialog = ui.getByRole('dialog', { name:'执行记录' })
  expect(within(dialog).queryByText('Task 2')).toBeNull()
  fireEvent.click(within(dialog).getByText('执行详情'))
  expect(within(dialog).getByText('实际配套 LLM')).toBeTruthy()
})
it('exposes local image selection in appearance without adding any model-configuration field', async () => {
  const request = vi.fn(async () => data())
  const ui = render(<LiquidGlassShell><AgentClassPanel request={request} /></LiquidGlassShell>)
  await ui.findByLabelText('生成图像模型')
  fireEvent.click(ui.getByRole('button', { name:'外观' }))
  expect(ui.getByRole('button', { name:'选择背景图片' })).toBeTruthy()
  const file = ui.getByLabelText('背景图片文件') as HTMLInputElement
  expect(file.type).toBe('file')
  expect(file.accept).toBe('image/jpeg,image/png,image/webp')
  expect(request).toHaveBeenCalledTimes(1)
})
