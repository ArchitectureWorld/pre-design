import { useEffect, useRef, useState } from 'react'

/** Local appearance only: no model-route payload, project attachment or network upload. */
export const BACKGROUND_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const BACKGROUND_MAX_BYTES = 20 * 1024 * 1024
const MAX_PIXELS = 48_000_000
const MAX_EDGE = 2560
const DB_NAME = 'pre-design:glass-background:v1'
interface BackgroundImage { readonly name: string; readonly blob: Blob }

async function bytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取图片。'))
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.readAsArrayBuffer(blob)
  })
}
export async function validateBackground(blob: Blob): Promise<void> {
  if (!BACKGROUND_TYPES.some(type => type === blob.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。')
  if (!blob.size || blob.size > BACKGROUND_MAX_BYTES) throw new Error('图片不能为空，且不能超过 20 MB。')
  const head = await bytes(blob.slice(0, 16))
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to))
  const valid = blob.type === 'image/jpeg' ? head[0] === 255 && head[1] === 216 && head[2] === 255
    : blob.type === 'image/png' ? [137,80,78,71,13,10,26,10].every((n, i) => head[i] === n)
      : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
  if (!valid) throw new Error('图片内容与格式不符，请选择有效图片。')
}
async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
  }
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) }
  } catch (cause) { URL.revokeObjectURL(url); throw cause }
}
export async function prepareBackground(file: File): Promise<BackgroundImage> {
  await validateBackground(file)
  let image: Awaited<ReturnType<typeof decode>>
  try { image = await decode(file) } catch { throw new Error('图片无法解码，请换一张图片。') }
  try {
    if (!image.width || !image.height || image.width * image.height > MAX_PIXELS) throw new Error('图片尺寸过大，请使用不超过 4800 万像素的图片。')
    const ratio = Math.min(1, MAX_EDGE / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法处理背景图片。')
    context.drawImage(image.source, 0, 0, canvas.width, canvas.height)
    // Normalize to a static raster and omit original metadata. Aspect ratio is preserved.
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('背景图片处理失败。')), 'image/webp', .9))
    if (blob.size > 8 * 1024 * 1024) throw new Error('处理后的图片仍过大，请换一张较小的图片。')
    return { name: file.name.slice(0, 160), blob }
  } finally { image.release() }
}
function storage<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('背景存储不可用')); return }
    let settled = false, database: IDBDatabase | undefined
    const finish = (error?: unknown, value?: T) => {
      if (settled) return
      settled = true; clearTimeout(timer); database?.close()
      if (error) reject(error); else resolve(value as T)
    }
    const timer = setTimeout(() => finish(new Error('背景存储响应超时')), 5000)
    let opening: IDBOpenDBRequest
    try { opening = indexedDB.open(DB_NAME, 1) } catch (cause) { finish(cause); return }
    opening.onupgradeneeded = () => { if (!opening.result.objectStoreNames.contains('images')) opening.result.createObjectStore('images') }
    opening.onerror = () => finish(opening.error ?? new Error('背景存储不可用'))
    opening.onblocked = () => finish(new Error('背景存储被占用'))
    opening.onsuccess = () => {
      database = opening.result
      if (settled) { database.close(); return }
      database.onversionchange = () => database?.close()
      try {
        const transaction = database.transaction('images', mode)
        const request = operation(transaction.objectStore('images'))
        transaction.oncomplete = () => finish(undefined, request.result)
        transaction.onerror = () => finish(transaction.error ?? request.error ?? new Error('背景保存失败'))
        transaction.onabort = () => finish(transaction.error ?? new Error('背景保存已中止'))
      } catch (cause) { finish(cause) }
    }
  })
}
export const backgroundStore = {
  load: () => storage<BackgroundImage | undefined>('readonly', store => store.get('current')),
  save: (image: BackgroundImage) => storage('readwrite', store => store.put(image, 'current')),
  clear: () => storage('readwrite', store => store.delete('current')),
}
export function useGlassBackground() {
  const [image, setImage] = useState<{ name: string; url: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const generation = useRef(0), alive = useRef(true), currentURL = useRef<string>()
  const writes = useRef<Promise<unknown>>(Promise.resolve()), persistence = useRef(0)
  const show = (next?: BackgroundImage) => {
    const old = currentURL.current
    const url = next ? URL.createObjectURL(next.blob) : undefined
    currentURL.current = url
    setImage(next && url ? { name: next.name, url } : undefined)
    if (old) URL.revokeObjectURL(old)
  }
  const persist = (next: BackgroundImage | undefined, token: number) => {
    // Serialize writes so replacement/reset cannot be undone by an older asynchronous put.
    const write = ++persistence.current
    writes.current = writes.current.catch(() => undefined).then(async () => {
      if (write !== persistence.current) return
      try {
        if (next) await backgroundStore.save(next); else await backgroundStore.clear()
        if (alive.current && token === generation.current) setNotice('')
      } catch {
        if (alive.current && token === generation.current) setNotice(next ? '背景已应用，但浏览器未允许保存；关闭后可能丢失。' : '已恢复默认，但浏览器未允许清除记录；下次打开可能仍显示旧背景。')
      }
    })
  }
  useEffect(() => {
    alive.current = true
    const token = ++generation.current
    void backgroundStore.load().then(async saved => {
      if (!saved) return
      if (!(saved.blob instanceof Blob) || typeof saved.name !== 'string') throw new Error('背景记录损坏')
      await validateBackground(saved.blob)
      const decoded = await decode(saved.blob)
      try { if (!decoded.width || !decoded.height || decoded.width * decoded.height > MAX_PIXELS) throw new Error('背景尺寸无效') }
      finally { decoded.release() }
      if (alive.current && token === generation.current) show(saved)
    }).catch(() => { if (alive.current && token === generation.current) setNotice('未能恢复本地背景，可重新选择图片。') })
    return () => { alive.current = false; ++generation.current; if (currentURL.current) URL.revokeObjectURL(currentURL.current); currentURL.current = undefined }
  }, [])
  const choose = async (file?: File) => {
    if (!file) return
    const token = ++generation.current
    setBusy(true); setError('')
    try {
      const prepared = await prepareBackground(file)
      if (!alive.current || token !== generation.current) return
      show(prepared); setNotice(''); persist(prepared, token)
    } catch (cause) {
      if (alive.current && token === generation.current) setError(cause instanceof Error ? cause.message : '图片读取失败。')
    } finally { if (alive.current && token === generation.current) setBusy(false) }
  }
  const reset = () => {
    const token = ++generation.current
    setBusy(false); setError(''); setNotice(''); show(); persist(undefined, token)
  }
  return { image, busy, error, notice, choose, reset }
}
