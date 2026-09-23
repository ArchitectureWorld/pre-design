// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LiquidGlassShell } from '../src/client/LiquidGlassShell.tsx'
import { themeAppearance, restoreAppearance } from '../src/client/glass-appearance.ts'
import { executionStatusLabel, childActivityLabel } from '../src/client/ClassExecutionPanel.tsx'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('pairs A/C and B/D by exactly the same optical settings', () => {
  const { theme: _a, ...a } = themeAppearance('a')
  const { theme: _c, ...c } = themeAppearance('c')
  const { theme: _b, ...b } = themeAppearance('b')
  const { theme: _d, ...d } = themeAppearance('d')
  expect(a).toEqual(c); expect(b).toEqual(d)
  expect(b.refraction).toBeGreaterThan(a.refraction)
})
it('restores only bounded appearance values and defaults corrupted storage to C', () => {
  expect(restoreAppearance('invalid')).toEqual(themeAppearance('c'))
  expect(restoreAppearance(JSON.stringify({ theme: 'c', blur: -9, refraction: 999, gloss: 'bad' }))).toMatchObject({theme:'c', blur:0,refraction:100,gloss:86})
})
it('switches themes without remounting or losing the live form and never writes model configuration', () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  const view = render(<LiquidGlassShell><input aria-label="保留中的输入" defaultValue="草稿" /></LiquidGlassShell>)
  const input = view.getByLabelText('保留中的输入') as HTMLInputElement
  fireEvent.change(input, {target:{value:'尚未保存'}})
  expect(view.container.querySelector('.pre-glass')?.getAttribute('data-theme')).toBe('dark')
  for (const name of ['B · 浅色强液态', 'D · 深色强液态', 'A · 浅色克制', 'C · 深色克制']) {
    fireEvent.click(view.getByRole('button', {name}))
    expect(view.getByLabelText('保留中的输入')).toBe(input)
    expect(input.value).toBe('尚未保存')
  }
  expect(fetch).not.toHaveBeenCalled()
})
it('persists the chosen appearance across remounts and exposes keyboard-accessible controls', () => {
  let view = render(<LiquidGlassShell><p>内容</p></LiquidGlassShell>)
  fireEvent.click(view.getByRole('button', {name:'D · 深色强液态'}))
  fireEvent.click(view.getByRole('button', {name:'外观'}))
  fireEvent.change(view.getByLabelText('折射强度'), {target:{value:'65'}})
  fireEvent.keyDown(view.getByRole('region', {name:'外观设置'}), {key:'Escape'})
  expect(view.queryByRole('region', {name:'外观设置'})).toBeNull()
  view.unmount()
  view = render(<LiquidGlassShell><p>内容</p></LiquidGlassShell>)
  expect(view.getByRole('button', {name:'D · 深色强液态'}).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(view.getByRole('button', {name:'外观'}))
  expect((view.getByLabelText('折射强度') as HTMLInputElement).value).toBe('65')
})
it('separates native child activity from durable execution outcome', () => {
  expect(executionStatusLabel('running')).not.toBe('已完成')
  expect(childActivityLabel('idle')).toBe('子会话空闲')
  expect(executionStatusLabel('completed')).toBe('已完成')
})
it('keeps pointer highlights within the current shell and disables them with reduced motion', () => {
  const view = render(<LiquidGlassShell><button className="pre-button" type="button">真实控件</button></LiquidGlassShell>)
  const button = view.getByRole('button', {name:'真实控件'})
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ x:0,y:0,left:0,top:0,right:100,bottom:40,width:100,height:40,toJSON:()=>({}) })
  fireEvent.mouseMove(button, {clientX:20,clientY:10})
  expect(button.style.getPropertyValue('--px')).toBe('20%')
  vi.stubGlobal('matchMedia', () => ({matches:true}))
  fireEvent.mouseMove(button, {clientX:60,clientY:10})
  expect(button.style.getPropertyValue('--px')).toBe('20%')
  vi.unstubAllGlobals()
})
