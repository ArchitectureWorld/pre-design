// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { backgroundStore, prepareBackground, useGlassBackground, validateBackground } from '../src/client/glass-background.ts'
const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])
const file = (name='test.png') => new File([png], name, {type:'image/png'})
const saved = (name='saved.png') => ({ name, blob:new Blob([png], {type:'image/png'}) })
let serial=0
beforeEach(() => {
  serial=0
  vi.spyOn(backgroundStore, 'load').mockResolvedValue(undefined)
  vi.spyOn(backgroundStore, 'save').mockResolvedValue('current')
  vi.spyOn(backgroundStore, 'clear').mockResolvedValue(undefined)
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({width:5000,height:3000,close:vi.fn()})))
  vi.stubGlobal('URL', class extends URL { static createObjectURL=vi.fn(()=>`blob:test-${++serial}`);static revokeObjectURL=vi.fn() })
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({ drawImage:vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback => callback(new Blob([png],{type:'image/png'})))
})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('rejects unsupported, empty, oversized and MIME-spoofed image input', async () => {
  await expect(validateBackground(new Blob(['<svg/>'],{type:'image/svg+xml'}))).rejects.toThrow('JPG')
  await expect(validateBackground(new Blob([],{type:'image/png'}))).rejects.toThrow('20 MB')
  await expect(validateBackground(new Blob([new Uint8Array(21*1024*1024)],{type:'image/png'}))).rejects.toThrow('20 MB')
  await expect(validateBackground(new Blob(['<svg/>'],{type:'image/png'}))).rejects.toThrow('内容与格式不符')
})
it('normalizes to a bounded raster without changing aspect ratio and releases the decoded image', async () => {
  const close=vi.fn();vi.mocked(createImageBitmap).mockResolvedValue({width:5000,height:3000,close} as unknown as ImageBitmap)
  let dimensions:number[]=[]
  vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(function(this: HTMLCanvasElement, callback) {dimensions=[this.width,this.height];callback(new Blob([png],{type:'image/png'}))})
  const result=await prepareBackground(file())
  expect(dimensions).toEqual([2560,1536]);expect(result.name).toBe('test.png');expect(close).toHaveBeenCalledTimes(1)
})
it('rejects excessive pixel dimensions and releases bitmap resources', async () => {
  const close=vi.fn();vi.mocked(createImageBitmap).mockResolvedValue({width:10000,height:10000,close} as unknown as ImageBitmap)
  await expect(prepareBackground(file())).rejects.toThrow('4800 万像素');expect(close).toHaveBeenCalledTimes(1)
})
function Harness() {
  const bg=useGlassBackground()
  return <><input type="file" aria-label="上传" onChange={e=>void bg.choose(e.target.files?.[0])}/><button onClick={bg.reset}>还原</button><span data-testid="url">{bg.image?.url??''}</span><span data-testid="name">{bg.image?.name??''}</span><span role="alert">{bg.error}</span><span role="status">{bg.notice}</span></>
}
it('restores the browser-local background without uploading a network request', async () => {
  vi.mocked(backgroundStore.load).mockResolvedValue(saved())
  const fetch=vi.spyOn(globalThis,'fetch')
  const ui=render(<Harness/>);await ui.findByText('saved.png')
  expect(fetch).not.toHaveBeenCalled();expect(backgroundStore.save).not.toHaveBeenCalled()
})
it('retains a valid image when a later selection fails', async () => {
  const ui=render(<Harness/>);fireEvent.change(ui.getByLabelText('上传'),{target:{files:[file()]}})
  await ui.findByText('test.png');const before=ui.getByTestId('url').textContent
  fireEvent.change(ui.getByLabelText('上传'),{target:{files:[new File(['x'],'bad.svg',{type:'image/svg+xml'})]}})
  await ui.findByText('请选择 JPG、PNG 或 WebP 图片。')
  expect(ui.getByTestId('url').textContent).toBe(before)
})
it('does not let an old persisted load overwrite a newer user-selected image', async () => {
  let resolve!: (v: ReturnType<typeof saved>)=>void
  vi.mocked(backgroundStore.load).mockImplementation(()=>new Promise(r=>{resolve=r}))
  const ui=render(<Harness/>);fireEvent.change(ui.getByLabelText('上传'),{target:{files:[file('new.png')]}})
  await ui.findByText('new.png');await act(async()=>resolve(saved('old.png')))
  expect(ui.getByTestId('name').textContent).toBe('new.png')
})
it('cancels an in-progress decode on reset so the image cannot reappear', async () => {
  let resolve!:(v:ImageBitmap)=>void
  vi.mocked(createImageBitmap).mockImplementation(()=>new Promise(r=>{resolve=r}))
  const ui=render(<Harness/>);fireEvent.change(ui.getByLabelText('上传'),{target:{files:[file()]}})
  await waitFor(()=>expect(createImageBitmap).toHaveBeenCalled())
  fireEvent.click(ui.getByRole('button',{name:'还原'}))
  await act(async()=>resolve({width:100,height:50,close:vi.fn()} as unknown as ImageBitmap))
  expect(ui.getByTestId('url').textContent).toBe('');expect(backgroundStore.save).not.toHaveBeenCalled()
  expect(backgroundStore.clear).toHaveBeenCalledTimes(1)
})
it('serializes replacement and reset and revokes old object URLs', async () => {
  let finish!:()=>void
  vi.mocked(backgroundStore.save).mockImplementationOnce(()=>new Promise(r=>{finish=()=>r('current')}))
  const ui=render(<Harness/>);fireEvent.change(ui.getByLabelText('上传'),{target:{files:[file()]}})
  await ui.findByText('test.png');await waitFor(()=>expect(backgroundStore.save).toHaveBeenCalled())
  fireEvent.click(ui.getByRole('button',{name:'还原'}));expect(backgroundStore.clear).not.toHaveBeenCalled()
  await act(async()=>finish());await waitFor(()=>expect(backgroundStore.clear).toHaveBeenCalledTimes(1))
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1')
})
it('keeps the image usable and discloses persistence failure', async () => {
  vi.mocked(backgroundStore.save).mockRejectedValue(new Error('quota'))
  const ui=render(<Harness/>);fireEvent.change(ui.getByLabelText('上传'),{target:{files:[file()]}})
  await ui.findByText('test.png');await ui.findByText(/浏览器未允许保存/u)
  expect(ui.getByTestId('url').textContent).toBe('blob:test-1')
})
