// @vitest-environment jsdom
import { cleanup, fireEvent, render, within, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentClassPanel } from '../src/client/AgentClassPanel.tsx'
import { LiquidGlassShell } from '../src/client/LiquidGlassShell.tsx'
import { ClassExecutionPanel } from '../src/client/ClassExecutionPanel.tsx'
import type { AgentClassView, ModelRoute } from '../src/agent-classes/types.ts'

const llm = { provider:'p', model:'llm' }
const direct = { provider:'p', model:'image' }
const paired: ModelRoute = { provider:'Comfyui-PIC', model:'Klein', llm }
const value = (route: ModelRoute) => JSON.stringify([route.provider, route.model])
const data = (): AgentClassView => ({projectId:'project',settings:{revision:7,routes:{image:direct,web:llm,review:llm,text:llm}},catalog:[
  {provider:'p',name:'DSH',available:true,models:[{id:'image',name:'Image API'},{id:'llm',name:'Tool LLM'}]},
  // The canonical Klein identity must also be protected for older catalogs without imageTool metadata.
  {provider:'Comfyui-PIC',name:'ComfyUI',available:true,models:[{id:'Klein',name:'Klein'}]},
],executions:[]})
afterEach(() => {cleanup(); localStorage.clear(); vi.restoreAllMocks()})

it('moves explanatory copy into accessible on-demand help, keeping four class labels', async () => {
  const view=render(<LiquidGlassShell><AgentClassPanel request={async()=>data()} /></LiquidGlassShell>)
  await view.findByLabelText('生成图像模型')
  expect(view.container.querySelectorAll('.role-card')).toHaveLength(4)
  expect(view.queryByText('生成 AI 概念表现图，沿用视觉质量与采用流程。')).toBeNull()
  const help=view.getByRole('button',{name:'生成图像说明'})
  fireEvent.click(help)
  expect(view.getByText('生成 AI 概念表现图，沿用视觉质量与采用流程。')).toBeTruthy()
  fireEvent.keyDown(view.getByRole('region',{name:'生成图像说明'}),{key:'Escape'})
  expect(view.queryByRole('region',{name:'生成图像说明'})).toBeNull()
  expect(document.activeElement).toBe(help)
})
it('uses named icon-only secondary controls and short model names instead of duplicated identifiers', async () => {
  const view=render(<LiquidGlassShell><AgentClassPanel request={async()=>data()} /></LiquidGlassShell>)
  const select=await view.findByLabelText('生成图像模型') as HTMLSelectElement
  expect(select.selectedOptions[0]?.textContent).toBe('Image API')
  for (const name of ['外观','生成图像添加备用模型','刷新配置']) {
    const button=view.getByRole('button',{name})
    expect(button.textContent).toBe(''); expect(button.getAttribute('title')).toBeTruthy()
  }
  expect(view.getByRole('button',{name:'C · 深色克制'}).textContent).toBe('C')
  expect(view.getAllByText('Pre 2.0.2 · Project Format 0.1.0')).toHaveLength(1)
})
it('preserves the explicitly paired LLM when promoting a configured Klein fallback to primary', async () => {
  const initial=data()
  const request=vi.fn(async(payload:any)=>({...initial,settings:payload.action==='save'
    ? {revision:8,routes:payload.routes,fallbacks:payload.fallbacks}
    : {...initial.settings,fallbacks:{image:[paired]}}}))
  const view=render(<AgentClassPanel request={request}/>)
  fireEvent.change(await view.findByLabelText('生成图像模型'),{target:{value:value(paired)}})
  expect((view.getByLabelText('生成图像配套 LLM') as HTMLSelectElement).value).toBe(value(llm))
  fireEvent.click(view.getByRole('button',{name:'保存配置'}))
  await waitFor(()=>expect(request.mock.calls.at(-1)?.[0]).toMatchObject({action:'save',revision:7,routes:{image:paired},fallbacks:{image:[]}}))
})
it('never offers the known ComfyUI tool for text, web, review or a companion even without catalog metadata', async () => {
  const view=render(<AgentClassPanel request={async()=>data()}/>)
  await view.findByLabelText('生成图像模型')
  for (const title of ['网络查询','素材审图','文本生成']) {
    const select=view.getByLabelText(`${title}模型`) as HTMLSelectElement
    expect([...select.options].some(o=>o.value===value(paired))).toBe(false)
    fireEvent.click(view.getByRole('button',{name:`${title}添加备用模型`}))
    const backup=view.getByLabelText(`${title}选择备用模型`) as HTMLSelectElement
    expect([...backup.options].some(o=>o.value===value(paired))).toBe(false)
    fireEvent.click(view.getByRole('button',{name:'取消添加'}))
  }
})
it('shows a visible required companion field, not hidden behind help, and never borrows another class route', async () => {
  const view=render(<AgentClassPanel request={async()=>data()}/>)
  fireEvent.change(await view.findByLabelText('生成图像模型'),{target:{value:value(paired)}})
  const companion=view.getByLabelText('生成图像配套 LLM') as HTMLSelectElement
  expect(companion.required).toBe(true); expect(companion.value).toBe('')
  expect(companion.getAttribute('aria-invalid')).toBe('true')
  expect(view.getByText('选择配套 LLM')).toBeTruthy()
  expect((view.getByRole('button',{name:'保存配置'}) as HTMLButtonElement).disabled).toBe(true)
  expect([...companion.options].some(o=>o.value===value(paired))).toBe(false)
})
it('keeps independent primary/backup companions through theme switches and saves the complete routes', async () => {
  const initial=data()
  const request=vi.fn(async(payload:any)=>({...initial,settings:payload.action==='save' ? {revision:8,routes:payload.routes,fallbacks:payload.fallbacks}:initial.settings}))
  const view=render(<LiquidGlassShell><AgentClassPanel request={request}/></LiquidGlassShell>)
  await view.findByLabelText('生成图像模型')
  fireEvent.click(view.getByRole('button',{name:'生成图像添加备用模型'}))
  fireEvent.change(view.getByLabelText('生成图像选择备用模型'),{target:{value:value(paired)}})
  const companion=view.getByLabelText('生成图像备用模型1配套 LLM') as HTMLSelectElement
  expect(companion.value).toBe('')
  fireEvent.change(companion,{target:{value:value(llm)}})
  fireEvent.click(view.getByRole('button',{name:'A · 浅色克制'}))
  fireEvent.click(view.getByRole('button',{name:'D · 深色强液态'}))
  expect(view.getByLabelText('生成图像备用模型1配套 LLM')).toBe(companion)
  fireEvent.click(view.getByRole('button',{name:'保存配置'}))
  await waitFor(()=>expect(request.mock.calls.at(-1)?.[0]).toMatchObject({routes:{image:direct},fallbacks:{image:[paired]}}))
})
it('opens execution history on demand in a dialog while preserving actual companion evidence in details', () => {
  const view=render(<ClassExecutionPanel projectId="project" executions={[{
    id:'r1',projectId:'project',classId:'image',task:'概念图',parentId:'s',configurationRevision:7,selected:paired,actual:paired,
    routeChain:[paired,direct],status:'running',activity:'idle',startedAt:'2026-09-23T00:00:00Z',updatedAt:'2026-09-23T00:01:00Z'
  }]}/>)
  expect(view.queryByRole('dialog')).toBeNull()
  fireEvent.click(view.getByRole('button',{name:/执行记录/u}))
  const history=view.getByRole('dialog',{name:'执行记录'})
  const detail=within(history).getByText('执行详情').closest('details')!
  fireEvent.click(within(detail).getByText('执行详情'))
  expect(within(detail).getByText('启动时配套 LLM')).toBeTruthy()
  expect(within(detail).getAllByText('p / llm').length).toBeGreaterThan(0)
  expect(view.getByText('子会话空闲')).toBeTruthy()
  expect(view.queryByText('已完成')).toBeNull()
})
it('shows save and labelled discard only when there are changes, not a permanent status paragraph', async () => {
  const view=render(<AgentClassPanel request={async()=>data()}/>)
  await view.findByLabelText('文本生成模型')
  expect(view.queryByRole('button',{name:'保存配置'})).toBeNull()
  fireEvent.change(view.getByLabelText('文本生成模型'),{target:{value:value(direct)}})
  expect(view.getByRole('button',{name:'保存配置'})).toBeTruthy()
  expect(view.getByRole('button',{name:'重新载入（放弃修改）'}).textContent).toBe('放弃修改')
})
it('opens help upward when the control is near the visible bottom edge', async () => {
  const view=render(<LiquidGlassShell><AgentClassPanel request={async()=>data()}/></LiquidGlassShell>)
  await view.findByLabelText('生成图像模型')
  const help=view.getByRole('button',{name:'生成图像说明'})
  const bounds=(top:number,bottom:number)=>({x:200,y:top,top,bottom,left:200,right:230,width:30,height:bottom-top,toJSON(){return {}}})
  vi.spyOn(help,'getBoundingClientRect').mockReturnValue(bounds(650,686))
  vi.spyOn(view.container.querySelector('.pre-glass')!,'getBoundingClientRect').mockReturnValue(bounds(0,740))
  fireEvent.click(help)
  expect(help.parentElement?.getAttribute('data-above')).toBe('true')
})
