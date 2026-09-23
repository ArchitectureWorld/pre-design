// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { LiquidGlassShell } from '../src/client/LiquidGlassShell.tsx'
import { PreplanningProjectForm } from '../src/client/PreplanningProjectForm.tsx'
import { sampleLens } from '../src/client/glass-optics.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('never starts while the existing session binding could not be read', () => {
  const start = vi.fn()
  const view = render(<PreplanningProjectForm embedded workspacePath="D:\\project" projectReadError="离线" start={start} />)
  const button = view.getByRole('button', { name:'项目状态读取失败' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.submit(view.getByRole('form'))
  expect(start).not.toHaveBeenCalled()
})
it('guards synchronous repeated submits and repeated folder clicks', async () => {
  let done!: () => void
  const pending = new Promise<void>(resolve => { done = resolve })
  const start = vi.fn(async () => { await pending; return {state:'running' as const,sourceMaterialCount:1,sourceInboxFileCount:1} })
  const open = vi.fn(async () => pending)
  const view = render(<PreplanningProjectForm embedded workspacePath="D:\\project" start={start} openProjectFolder={open} />)
  const form = view.getByRole('form')
  act(() => { fireEvent.submit(form); fireEvent.submit(form) })
  expect(start).toHaveBeenCalledTimes(1)
  const button = view.getByRole('button', {name:'打开项目文件夹'})
  act(() => { fireEvent.click(button); fireEvent.click(button) })
  expect(open).toHaveBeenCalledTimes(1)
  await act(async () => { done() })
})
it('keeps appearance usable when storage is denied and survives StrictMode remounts', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  const view = render(<StrictMode><LiquidGlassShell><p>真实组件</p></LiquidGlassShell></StrictMode>)
  fireEvent.click(view.getByRole('button', {name:'D · 深色强液态'}))
  fireEvent.click(view.getByRole('button', {name:'外观'}))
  expect(view.getByText('浏览器未允许保存外观，本次调整仍然有效。')).toBeTruthy()
  expect(view.container.querySelector('.pre-glass')?.getAttribute('data-depth')).toBe('strong')
})
it('only bends the glass rim, never the flat center', () => {
  expect(sampleLens(100,50,200,100,20,13)).toEqual([0,0])
  expect(sampleLens(1,50,200,100,20,13)[0]).toBeGreaterThan(0)
  expect(sampleLens(199,50,200,100,20,13)[0]).toBeLessThan(0)
})
