// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentClassPanel } from '../src/client/AgentClassPanel.tsx'
import { LiquidGlassShell } from '../src/client/LiquidGlassShell.tsx'
import type { AgentClassView, ModelRoute } from '../src/agent-classes/types.ts'

const tool = { provider: 'Comfyui-PIC', model: 'Klein' }
const llm = { provider: 'p', model: 'llm-a' }
const llmB = { provider: 'p', model: 'llm-b' }
const native = { provider: 'p', model: 'image-api' }
function snapshot(image: ModelRoute = { ...tool, llm }): AgentClassView {
  return {
    projectId: 'p1', settings: { revision: 6, routes: { image, web: llm, review: llm, text: llm } }, executions: [],
    catalog: [
      { provider: 'p', name: 'DSH Provider', available: true, models: [{ id: 'llm-a', name: 'LLM A' }, { id: 'llm-b', name: 'LLM B' }, { id: 'image-api', name: 'Native Image' }] },
      { provider: 'Comfyui-PIC', name: 'ComfyUI', available: true, models: [{ id: 'Klein', name: 'Klein', imageTool: 'comfyui_pic' }] },
    ],
  }
}
function api(data: AgentClassView) {
  return vi.fn(async (payload: any) => {
    if (payload.action === 'save') data = { ...data, settings: { revision: data.settings.revision + 1, routes: payload.routes, fallbacks: payload.fallbacks } }
    return data
  })
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

it('puts the tool and its required companion inside one inline pair', async () => {
  const view = render(<AgentClassPanel request={api(snapshot())} />)
  const main = await view.findByLabelText('生成图像模型') as HTMLSelectElement
  const companion = view.getByLabelText('生成图像配套 LLM') as HTMLSelectElement
  const pair = main.closest('.route-pair')
  expect(pair).not.toBeNull()
  expect(companion.closest('.route-pair')).toBe(pair)
  expect(pair?.getAttribute('data-paired')).toBe('true')
  expect(companion.required).toBe(true)
  expect(main.selectedOptions[0].textContent).toBe('Klein · ComfyUI')
  expect(companion.selectedOptions[0].textContent).toBe('LLM A')
})
it('uses plus-only add buttons and icon-only secondary actions with accessible names', async () => {
  const view = render(<AgentClassPanel request={api(snapshot())} />)
  await view.findByLabelText('生成图像模型')
  for (const name of ['生成图像', '网络查询', '素材审图', '文本生成']) {
    const button = view.getByRole('button', { name: `${name}添加备用模型` })
    expect(button.textContent).toBe('')
    expect(button.getAttribute('title')).toContain('添加备用模型')
    expect(button.querySelector('svg')).not.toBeNull()
  }
  fireEvent.click(view.getByRole('button', { name: '生成图像添加备用模型' }))
  fireEvent.change(view.getByLabelText('生成图像选择备用模型'), { target: { value: JSON.stringify(['p','image-api']) } })
  for (const action of ['上移', '下移', '删除']) {
    expect(view.getByRole('button', { name: `生成图像备用模型1${action}` }).textContent).toBe('')
  }
})
it('pairs each backup separately and preserves its own LLM through reorder and save', async () => {
  const data = snapshot(native)
  const request = api({ ...data, settings: { ...data.settings, fallbacks: { image: [{ ...tool, llm }, llmB] } } })
  const view = render(<AgentClassPanel request={request} />)
  const companion = await view.findByLabelText('生成图像备用模型1配套 LLM') as HTMLSelectElement
  const pair = companion.closest('.route-pair')
  expect(pair?.querySelector('.fallback-name')?.textContent).toContain('Klein')
  expect(pair?.getAttribute('data-paired')).toBe('true')
  fireEvent.change(companion, { target: { value: JSON.stringify(['p','llm-b']) } })
  fireEvent.click(view.getByRole('button', { name: '生成图像备用模型1下移' }))
  expect((view.getByLabelText('生成图像备用模型2配套 LLM') as HTMLSelectElement).value).toBe(JSON.stringify(['p','llm-b']))
  fireEvent.click(view.getByRole('button', { name: '保存配置' }))
  await waitFor(() => expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ action: 'save', revision: 6, routes: { image: native }, fallbacks: { image: [llmB, { ...tool, llm: llmB }] } }))
})
it('exposes explanation on demand and supports Escape and click outside', async () => {
  const view = render(<AgentClassPanel request={api(snapshot())} />)
  await view.findByLabelText('生成图像模型')
  expect(view.queryByText(/配套 LLM 负责理解需求/)).toBeNull()
  const button = view.getByRole('button', { name: '生成图像说明' })
  button.focus()
  fireEvent.click(button)
  const help = view.getByRole('region', { name: '生成图像说明' })
  expect(help.textContent).toContain('LLM 负责理解需求')
  expect(button.getAttribute('aria-expanded')).toBe('true')
  fireEvent.keyDown(button, { key: 'Escape' })
  expect(view.queryByRole('region', { name: '生成图像说明' })).toBeNull()
  expect(document.activeElement).toBe(button)
  fireEvent.click(button)
  fireEvent.pointerDown(document.body)
  expect(view.queryByRole('region', { name: '生成图像说明' })).toBeNull()
})
it('uses four letter-only theme controls and an icon-only appearance toggle', () => {
  const view = render(<LiquidGlassShell><p>内容</p></LiquidGlassShell>)
  expect(view.getByRole('button', { name: '外观' }).textContent).toBe('')
  for (const [letter, name] of [['A','A · 浅色克制'],['B','B · 浅色强液态'],['C','C · 深色克制'],['D','D · 深色强液态']]) {
    expect(view.getByRole('button', { name }).textContent).toBe(letter)
  }
})
it('keeps missing companion visible and cannot save it after simplifying copy', async () => {
  const request = api(snapshot(tool))
  const view = render(<AgentClassPanel request={request} />)
  const companion = await view.findByLabelText('生成图像配套 LLM') as HTMLSelectElement
  expect(companion.getAttribute('aria-invalid')).toBe('true')
  expect(view.getAllByRole('alert').some(row => row.textContent?.includes('配套 LLM'))).toBe(true)
  expect(view.queryByRole('button', { name: '保存配置' })).toBeNull()
  expect([...companion.options].some(option => option.value.includes('Comfyui-PIC'))).toBe(false)
  fireEvent.change(companion, { target: { value: JSON.stringify(['p','llm-a']) } })
  expect(companion.getAttribute('aria-invalid')).toBe('false')
  fireEvent.click(view.getByRole('button', { name: '保存配置' }))
  await waitFor(() => expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ routes: { image: { ...tool, llm } } }))
})
it('removes the companion only when switching to a native route and preserves unsaved inputs across themes', async () => {
  const request = api(snapshot())
  const view = render(<LiquidGlassShell><AgentClassPanel request={request} /></LiquidGlassShell>)
  const main = await view.findByLabelText('生成图像模型')
  fireEvent.change(main, { target: { value: JSON.stringify(['p','image-api']) } })
  expect(view.queryByLabelText('生成图像配套 LLM')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: 'D · 深色强液态' }))
  expect(view.getByLabelText('生成图像模型')).toBe(main)
  expect((main as HTMLSelectElement).value).toBe(JSON.stringify(['p','image-api']))
  expect(request.mock.calls.some(([payload]) => payload.action === 'save')).toBe(false)
})
it('keeps model input semantics when errors are shown rather than hiding required fields', async () => {
  const view = render(<AgentClassPanel request={api(snapshot(tool))} />)
  const companion = await view.findByLabelText('生成图像配套 LLM') as HTMLSelectElement
  const pair = companion.closest('.route-pair')
  expect(pair).not.toBeNull()
  expect(pair?.querySelectorAll('select')).toHaveLength(2)
  expect(companion.required).toBe(true)
  expect(view.queryByRole('region', {name:'生成图像说明'})).toBeNull()
})
