import test from 'node:test'
import assert from 'node:assert/strict'
import {createLayoutRequest, readReferenceBase64} from '../src/layout-library/upload-request.js'

function xhrHarness() {
  const instances = []
  class ControlledXHR {
    constructor() {
      this.upload = {}
      this.headers = {}
      this.responseHeaders = {}
      this.status = 0
      instances.push(this)
    }
    open(method, url, async) { Object.assign(this, {method, url, async}) }
    setRequestHeader(name, value) { this.headers[name] = value }
    getResponseHeader(name) { return this.responseHeaders[name.toLowerCase()] ?? null }
    send(body) { this.sentBody = body }
    abort() { this.aborted = true; this.onabort?.() }
    respond(status, body, headers = {}) {
      this.status = status
      this.responseHeaders = headers
      this.responseText = typeof body === 'string' ? body : JSON.stringify(body)
      this.response = this.responseType === 'blob' ? new Blob([this.responseText]) : this.responseText
      this.onload?.()
    }
  }
  return {instances, XMLHttpRequestCtor: ControlledXHR}
}

function observeAbortListeners(signal) {
  const add = signal.addEventListener.bind(signal)
  const remove = signal.removeEventListener.bind(signal)
  const listeners = new Set()
  signal.addEventListener = (type, listener, options) => {
    if (type === 'abort') listeners.add(listener)
    return add(type, listener, options)
  }
  signal.removeEventListener = (type, listener, options) => {
    if (type === 'abort') listeners.delete(listener)
    return remove(type, listener, options)
  }
  return listeners
}

function fileReaderHarness(t) {
  const instances = []
  class ControlledFileReader {
    constructor() { instances.push(this) }
    readAsArrayBuffer(file) { this.file = file }
    abort() { this.aborted = true; this.onabort?.() }
    complete(bytes) {
      this.result = Uint8Array.from(bytes).buffer
      this.onload?.()
    }
  }
  useFileReader(t, ControlledFileReader)
  return instances
}

function useFileReader(t, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'FileReader')
  Object.defineProperty(globalThis, 'FileReader', {value, configurable: true, writable: true})
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'FileReader', descriptor) : delete globalThis.FileReader)
}

test('ordinary requests retain JSON, authentication and the latest token', async () => {
  let token = 'first-token'
  const calls = []
  const request = createLayoutRequest({
    getToken: () => token,
    fetchImpl: async (...args) => { calls.push(args); return Response.json({saved: true}) },
  })
  const controller = new AbortController()
  assert.deepEqual(await request('/layouts', {method: 'POST', body: {name: '版式'}, signal: controller.signal}), {saved: true})
  token = 'refreshed-token'
  await request('/layouts')
  assert.equal(calls[0][0], '/api/layouts')
  assert.deepEqual(calls[0][1], {
    method: 'POST', headers: {Authorization: 'Bearer first-token', 'Content-Type': 'application/json'},
    body: '{"name":"版式"}', signal: controller.signal,
  })
  assert.equal(calls[1][1].method, 'GET')
  assert.deepEqual(calls[1][1].headers, {Authorization: 'Bearer refreshed-token'})
  assert.equal(Object.hasOwn(calls[1][1], 'body'), false)
})

test('download requests return the blob and Content-Disposition filename', async () => {
  const request = createLayoutRequest({
    getToken: () => 'token',
    fetchImpl: async () => new Response('downloaded layout', {headers: {'Content-Disposition': 'attachment; filename="sample.pptx"'}}),
  })
  const result = await request('/layouts/export', {download: true})
  assert.equal(result.filename, 'sample.pptx')
  assert.equal(await result.blob.text(), 'downloaded layout')
  const fallback = createLayoutRequest({getToken: () => 'token', fetchImpl: async () => new Response('{}')})
  assert.equal((await fallback('/layouts/export', {download: true})).filename, 'layout.json')
})

test('downloads decode UTF-8 filename* and prefer it over the ASCII filename', async () => {
  for (const disposition of [
    "attachment; filename*=UTF-8''%E5%8F%82%E8%80%83%E7%89%88%E5%BC%8F.pdf",
    "attachment; filename=\"reference.pdf\"; filename*=UTF-8''%E5%8F%82%E8%80%83%E7%89%88%E5%BC%8F.pdf",
  ]) {
    const request = createLayoutRequest({getToken: () => 'token',
      fetchImpl: async () => new Response('original document', {headers: {'Content-Disposition': disposition}}),
    })
    const result = await request('/layouts/references/original', {download: true})
    assert.equal(result.filename, '参考版式.pdf')
    assert.equal(await result.blob.text(), 'original document')
  }
})

test('malformed filename* encoding falls back without rejecting the download', async () => {
  for (const [disposition, filename] of [
    ["attachment; filename=\"reference.pdf\"; filename*=UTF-8''%E0%A4%A", 'reference.pdf'],
    ["attachment; filename*=UTF-8''%E0%A4%A", 'layout.json'],
  ]) {
    const request = createLayoutRequest({getToken: () => 'token',
      fetchImpl: async () => new Response('original document', {headers: {'Content-Disposition': disposition}}),
    })
    const result = await request('/layouts/references/original', {download: true})
    assert.equal(result.filename, filename)
    assert.equal(await result.blob.text(), 'original document')
  }
})

test('fetch HTTP failures preserve server errors and 401/413 status', async () => {
  for (const status of [401, 413]) {
    const request = createLayoutRequest({getToken: () => 'token', fetchImpl: async () => Response.json({error: '上传被拒绝'}, {status})})
    await assert.rejects(request('/layouts'), error => error.status === status && error.message === '上传被拒绝')
  }
  const malformed = createLayoutRequest({getToken: () => 'token', fetchImpl: async () => new Response('upstream limit', {status: 413})})
  await assert.rejects(malformed('/layouts'), error => error.status === 413)
})

test('XHR uses authenticated JSON and reports only actual upload events before parsing completes', async () => {
  const harness = xhrHarness()
  const progress = []
  const controller = new AbortController()
  const abortListeners = observeAbortListeners(controller.signal)
  const request = createLayoutRequest({getToken: () => 'upload-token', ...harness,
    fetchImpl: async () => assert.fail('uploads with progress must use XHR'),
  })
  let resolved = false
  const pending = request('/layout-library/references', {
    method: 'POST', body: {filename: 'reference.pdf', contentBase64: 'YWJj'},
    onUploadProgress: event => progress.push(event), signal: controller.signal,
  }).then(result => { resolved = true; return result })
  const xhr = harness.instances[0]
  assert.equal(xhr.url, '/api/layout-library/references')
  assert.equal(xhr.method, 'POST')
  assert.equal(xhr.async, true)
  assert.equal(xhr.timeout, 180000)
  assert.deepEqual(xhr.headers, {Authorization: 'Bearer upload-token', 'Content-Type': 'application/json'})
  assert.equal(xhr.sentBody, '{"filename":"reference.pdf","contentBase64":"YWJj"}')
  assert.deepEqual(progress, [])
  const lateProgress = xhr.upload.onprogress
  xhr.upload.onprogress({lengthComputable: true, loaded: 120, total: 480})
  xhr.upload.onprogress({lengthComputable: true, loaded: 480, total: 480})
  xhr.upload.onload()
  await Promise.resolve()
  assert.deepEqual(progress, [
    {phase: 'uploading', loaded: 120, total: 480},
    {phase: 'uploading', loaded: 480, total: 480},
    {phase: 'parsing'},
  ])
  assert.equal(resolved, false, 'sending all bytes must not resolve while the server is parsing')
  xhr.respond(200, {pages: [{title: '解析结果'}]})
  assert.deepEqual(await pending, {pages: [{title: '解析结果'}]})
  lateProgress({lengthComputable: true, loaded: 480, total: 480})
  assert.equal(progress.length, 3)
  assert.equal(abortListeners.size, 0)
  for (const event of ['onload', 'onerror', 'onabort', 'ontimeout']) assert.equal(xhr[event], null)
  assert.equal(xhr.upload.onprogress, null)
  assert.equal(xhr.upload.onload, null)
})

test('a progress callback without a body still uses fetch', async () => {
  let fetched = false
  const request = createLayoutRequest({getToken: () => 'token',
    fetchImpl: async () => { fetched = true; return Response.json({ok: true}) },
    XMLHttpRequestCtor: class { constructor() { assert.fail('GET should use fetch') } },
  })
  assert.deepEqual(await request('/layouts', {onUploadProgress: () => assert.fail('no upload occurred')}), {ok: true})
  assert.equal(fetched, true)
})

test('unknown upload totals remain unknown and upload completion is reported once', async () => {
  const harness = xhrHarness()
  const progress = []
  const request = createLayoutRequest({getToken: () => 'token', ...harness})
  const pending = request('/layouts', {method: 'POST', body: null, onUploadProgress: event => progress.push(event)})
  const xhr = harness.instances[0]
  xhr.upload.onprogress({lengthComputable: false, loaded: 20, total: 0})
  xhr.upload.onload()
  xhr.upload.onload()
  xhr.respond(200, {ok: true})
  await pending
  assert.deepEqual(progress, [{phase: 'uploading', loaded: 20, total: 0}, {phase: 'parsing'}])
})

test('XHR HTTP failures preserve 401/413 status even when the error body is not JSON', async () => {
  for (const [status, response] of [[401, {error: '登录已失效'}], [413, {error: '文件过大'}], [413, '<html>Payload too large</html>']]) {
    const harness = xhrHarness()
    const request = createLayoutRequest({getToken: () => 'token', ...harness})
    const pending = request('/layouts', {method: 'POST', body: {}, onUploadProgress() {}})
    const rejected = assert.rejects(pending, error => error.status === status && (typeof response === 'string' || error.message === response.error))
    harness.instances[0].respond(status, response)
    await rejected
  }
})

test('XHR network errors, timeout and malformed success JSON reject cleanly', async () => {
  for (const kind of ['network', 'timeout', 'invalid-json']) {
    const harness = xhrHarness()
    const controller = new AbortController()
    const listeners = observeAbortListeners(controller.signal)
    const request = createLayoutRequest({getToken: () => 'token', ...harness})
    const pending = request('/layouts', {method: 'POST', body: {}, onUploadProgress() {}, signal: controller.signal})
    const rejected = assert.rejects(pending, error => error instanceof Error && (kind !== 'timeout' || error.name === 'TimeoutError'))
    const xhr = harness.instances[0]
    if (kind === 'network') xhr.onerror()
    else if (kind === 'timeout') xhr.ontimeout()
    else xhr.respond(200, 'not json')
    await rejected
    assert.equal(listeners.size, 0)
    assert.equal(xhr.onload, null)
  }
})

test('XHR cancellation aborts promptly and ignores later progress and success', async () => {
  const harness = xhrHarness()
  const controller = new AbortController()
  const listeners = observeAbortListeners(controller.signal)
  const progress = []
  const request = createLayoutRequest({getToken: () => 'token', ...harness})
  const pending = request('/layouts', {method: 'POST', body: {}, onUploadProgress: event => progress.push(event), signal: controller.signal})
  const rejected = assert.rejects(pending, {name: 'AbortError'})
  const xhr = harness.instances[0]
  const lateLoad = xhr.onload
  const lateProgress = xhr.upload.onprogress
  controller.abort()
  lateProgress({lengthComputable: true, loaded: 10, total: 10})
  xhr.status = 200
  xhr.responseText = '{"tooLate":true}'
  lateLoad()
  await rejected
  assert.equal(xhr.aborted, true)
  assert.deepEqual(progress, [])
  assert.equal(listeners.size, 0)
})

test('already cancelled requests never invoke a transport', async () => {
  const controller = new AbortController()
  controller.abort()
  const request = createLayoutRequest({getToken: () => 'token',
    fetchImpl: () => assert.fail('fetch must not run'),
    XMLHttpRequestCtor: class { constructor() { assert.fail('XHR must not run') } },
  })
  await assert.rejects(request('/layouts', {signal: controller.signal}), {name: 'AbortError'})
  await assert.rejects(request('/layouts', {body: {}, onUploadProgress() {}, signal: controller.signal}), {name: 'AbortError'})
})

test('FileReader returns base64 with the real reading progress and cleans listeners', async t => {
  const readers = fileReaderHarness(t)
  const controller = new AbortController()
  const listeners = observeAbortListeners(controller.signal)
  const progress = []
  const file = new Blob(['hello'])
  const pending = readReferenceBase64(file, {signal: controller.signal, onProgress: event => progress.push(event)})
  const reader = readers[0]
  assert.equal(reader.file, file)
  assert.deepEqual(progress, [])
  reader.onprogress({lengthComputable: true, loaded: 2, total: 5})
  reader.onprogress({lengthComputable: true, loaded: 5, total: 5})
  reader.complete([104, 101, 108, 108, 111])
  assert.equal(await pending, 'aGVsbG8=')
  assert.deepEqual(progress, [{phase: 'reading', loaded: 2, total: 5}, {phase: 'reading', loaded: 5, total: 5}])
  assert.equal(listeners.size, 0)
  for (const event of ['onload', 'onprogress', 'onerror', 'onabort']) assert.equal(reader[event], null)
})

test('FileReader cancellation stops the reader and ignores late events', async t => {
  const readers = fileReaderHarness(t)
  const controller = new AbortController()
  const listeners = observeAbortListeners(controller.signal)
  const progress = []
  const pending = readReferenceBase64(new Blob(['hello']), {signal: controller.signal, onProgress: event => progress.push(event)})
  const rejected = assert.rejects(pending, {name: 'AbortError'})
  const reader = readers[0]
  const lateProgress = reader.onprogress
  const lateLoad = reader.onload
  controller.abort()
  lateProgress({lengthComputable: true, loaded: 5, total: 5})
  reader.result = new ArrayBuffer(5)
  lateLoad()
  await rejected
  assert.equal(reader.aborted, true)
  assert.deepEqual(progress, [])
  assert.equal(listeners.size, 0)
})

test('FileReader failures reject and clean up', async t => {
  const readers = fileReaderHarness(t)
  const controller = new AbortController()
  const listeners = observeAbortListeners(controller.signal)
  const pending = readReferenceBase64(new Blob(['x']), {signal: controller.signal})
  const rejected = assert.rejects(pending, /disk read failed/)
  readers[0].error = new Error('disk read failed')
  readers[0].onerror()
  await rejected
  assert.equal(listeners.size, 0)
  assert.equal(readers[0].onload, null)
})

test('file size is checked before reading and again against actual bytes', async t => {
  const readers = fileReaderHarness(t)
  await assert.rejects(readReferenceBase64({size: 24 * 1024 * 1024 + 1}), /24|大小|上限/)
  await assert.rejects(readReferenceBase64({size: 8 * 1024 * 1024 + 1}, {maxBytes: 8 * 1024 * 1024}), /8|大小|上限/)
  assert.equal(readers.length, 0)
  const pending = readReferenceBase64({size: 1}, {maxBytes: 2})
  const rejected = assert.rejects(pending, /大小|上限/)
  readers[0].complete([1, 2, 3])
  await rejected
})

test('arrayBuffer fallback handles large binary input without fabricated progress or stack overflow', async t => {
  useFileReader(t, undefined)
  const bytes = new Uint8Array(1024 * 1024 + 2)
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 256
  const progress = []
  const encoded = await readReferenceBase64(new Blob([bytes]), {onProgress: event => progress.push(event)})
  assert.deepEqual(Buffer.from(encoded, 'base64'), Buffer.from(bytes))
  assert.deepEqual(progress, [])
  assert.equal(await readReferenceBase64(new Blob([])), '')
})

test('arrayBuffer fallback cancellation rejects before an unfinished read completes', async t => {
  useFileReader(t, undefined)
  const controller = new AbortController()
  const listeners = observeAbortListeners(controller.signal)
  let completeRead
  const file = {size: 3, arrayBuffer: () => new Promise(resolve => { completeRead = resolve })}
  const pending = readReferenceBase64(file, {signal: controller.signal})
  const rejected = assert.rejects(pending, {name: 'AbortError'})
  controller.abort()
  await rejected
  completeRead(new ArrayBuffer(3))
  assert.equal(listeners.size, 0)
})

test('arrayBuffer fallback validates actual size and never reads an already cancelled file', async t => {
  useFileReader(t, undefined)
  await assert.rejects(readReferenceBase64({size: 1, arrayBuffer: async () => new ArrayBuffer(4)}, {maxBytes: 3}), /大小|上限/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(readReferenceBase64({size: 1, arrayBuffer: () => assert.fail('cancelled reads must not start')}, {signal: controller.signal}), {name: 'AbortError'})
})
