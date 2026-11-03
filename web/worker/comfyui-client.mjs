import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import sharp from 'sharp'

const MODEL = 'flux3-image-klein-bf16.safetensors'
const VERSION = '2026-11-03.1'
const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const MAX_IMAGE_PIXELS = 16 * 1024 * 1024
const MAX_JSON_BYTES = 16 * 1024 * 1024
const FORMATS = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' })
const EXTENSIONS = Object.freeze({ png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' })

export const FLUX3_WORKFLOWS = Object.freeze(Object.fromEntries([
  ['generate', 't2i'], ['edit', 'i2i'],
].map(([mode, suffix]) => [mode, Object.freeze({
  id: `flux3-klein-${suffix}`, version: VERSION, model: MODEL,
  templateFile: `flux3-klein-${suffix}-v1.json`, outputNodeIds: Object.freeze(['9']),
})])))

export class ComfyUIError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ComfyUIError'
    this.code = code
    this.details = details
  }
}

function fail(code, message, details) { throw new ComfyUIError(code, message, details) }
function sha256(data) { return createHash('sha256').update(data).digest('hex') }
function modeInfo(mode) {
  if (!Object.hasOwn(FLUX3_WORKFLOWS, mode)) fail('INVALID_INPUT', '图像模式必须是 generate 或 edit')
  return FLUX3_WORKFLOWS[mode]
}
function nonempty(value, label, maxLength = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail('INVALID_INPUT', `${label}无效`)
  }
  return value
}
function safePath(value, { allowEmpty = false, filename = false, code = 'INVALID_INPUT' } = {}) {
  if (typeof value !== 'string' || (!value && !allowEmpty) || value.length > (filename ? 255 : 1024)
    || /[\\:%?#\[\]\u0000-\u001f\u007f]/u.test(value)
    || value.startsWith('/') || (filename && value.includes('/'))
    || (value && value.split('/').some(part => !part || part === '.' || part === '..'))) {
    fail(code, '图片路径不是安全的相对路径')
  }
  return value
}
function fileFormat(filename, code = 'INVALID_INPUT') {
  const extension = filename.split('.').at(-1).toLowerCase()
  const format = Object.hasOwn(EXTENSIONS, extension) ? EXTENSIONS[extension] : undefined
  if (!format) fail(code, '只支持 PNG、JPEG 或 WebP 图片')
  return format
}
async function loadTemplate(mode) {
  const info = modeInfo(mode)
  const source = await readFile(new URL(`./workflows/${info.templateFile}`, import.meta.url))
  return { info, workflow: JSON.parse(source.toString('utf8')), workflowSha256: sha256(source) }
}

/** Compile only the task inputs; the supplied graph and prompt-upsample instructions stay versioned. */
export async function compileFlux3Workflow({ mode, prompt, width, height, seed, referenceImage, requestId = randomUUID() } = {}) {
  modeInfo(mode)
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000 || prompt.includes('\0')) fail('INVALID_INPUT', '图像提示词不能为空或过长')
  nonempty(requestId, '图像请求标识')
  if (width !== undefined || height !== undefined) {
    if (![width, height].every(value => Number.isInteger(value) && value >= 16 && value <= 8192 && value % 16 === 0)
      || width * height > MAX_IMAGE_PIXELS) fail('INVALID_INPUT', '宽高必须同时提供、为 16 的整数倍，且画布不超过 16MP')
  }
  if (seed !== undefined && (!Number.isSafeInteger(seed) || seed < 0)) fail('INVALID_INPUT', '图像种子必须是非负安全整数')
  if (mode === 'edit') {
    safePath(referenceImage)
    fileFormat(referenceImage)
  } else if (referenceImage !== undefined) fail('INVALID_INPUT', '生成模式不接受参考图')
  const { workflow, info, workflowSha256 } = await loadTemplate(mode)
  const taskSeed = seed ?? randomBytes(6).readUIntBE(0, 6)
  workflow['28'].inputs.value = prompt
  workflow['128:107'].inputs.seed = taskSeed
  workflow['9'].inputs.filename_prefix = `pre-design/flux3_${mode}_${sha256(requestId).slice(0, 24)}`
  if (mode === 'edit') workflow['133'].inputs.image = referenceImage
  if (width !== undefined) {
    const latentId = mode === 'generate' ? '128:106' : '128:139'
    Object.assign(workflow[latentId].inputs, { width, height })
    Object.assign(workflow['128:132'].inputs, { width, height })
    Object.assign(workflow['25'].inputs, { width, height })
  }
  return { workflow, metadata: {
    workflowId: info.id, workflowVersion: info.version, workflowSha256,
    model: info.model, mode, requestId, seed: taskSeed,
    ...(width !== undefined ? { width, height } : {}),
  } }
}

async function imageInfo(data, { contentType, filename, code }) {
  if (!(data instanceof Uint8Array) || !data.byteLength || data.byteLength > MAX_IMAGE_BYTES) fail(code, '图片为空或超过 50MB')
  const expected = fileFormat(filename, code)
  const declared = contentType?.split(';')[0].trim().toLowerCase()
  if (declared && declared !== 'application/octet-stream' && !Object.values(FORMATS).includes(declared)) fail(code, '图片响应格式不受支持')
  try {
    const decoder = sharp(data, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS })
    const metadata = await decoder.metadata()
    if (!Object.hasOwn(FORMATS, metadata.format) || metadata.format !== expected
      || (declared && declared !== 'application/octet-stream' && declared !== FORMATS[metadata.format])
      || !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS
      || (metadata.pages ?? 1) > 1) fail(code, '图片实际格式、尺寸或帧数不符合要求')
    // Metadata alone accepts some truncated inputs; decode every pixel before trusting an asset.
    await decoder.raw().toBuffer()
    return { contentType: FORMATS[metadata.format], format: metadata.format, width: metadata.width, height: metadata.height }
  } catch (error) {
    if (error instanceof ComfyUIError) throw error
    fail(code, '图片无法完整解码')
  }
}

async function readBounded(response, limit, code) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel()
    fail(code, 'ComfyUI 响应超过大小限制')
  }
  const chunks = []
  let size = 0
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); fail(code, 'ComfyUI 响应超过大小限制') }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks, size)
}
function interruption(signal, details = {}) {
  if (signal?.aborted) fail(signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'ABORTED', signal.reason?.name === 'TimeoutError' ? '等待 ComfyUI 超时，可凭收执继续查询' : '已停止等待 ComfyUI', details)
}
function combinedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}
function promptIdentifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) fail('INVALID_INPUT', 'ComfyUI 收执标识无效')
  return value
}

export class ComfyUIClient {
  constructor({ baseURL, headers = {}, pollIntervalMs = 1000, timeoutMs = 600000, fetchImpl = globalThis.fetch } = {}) {
    let endpoint
    try { endpoint = new URL(baseURL) } catch { fail('INVALID_INPUT', 'ComfyUI 服务地址无效') }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) fail('INVALID_INPUT', 'ComfyUI 服务地址必须是 HTTP(S) 且不含凭据或查询参数')
    if (![pollIntervalMs, timeoutMs].every(value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647)) fail('INVALID_INPUT', 'ComfyUI 超时或轮询间隔无效')
    if (typeof fetchImpl !== 'function') fail('INVALID_INPUT', 'ComfyUI HTTP 客户端不可用')
    this.baseURL = endpoint.href.replace(/\/+$/u, '')
    this.headers = new Headers(headers)
    this.pollIntervalMs = pollIntervalMs
    this.timeoutMs = timeoutMs
    this.fetchImpl = fetchImpl
  }

  async _request(path, { method = 'GET', body, signal, responseType = 'json', submission = false, details = {} } = {}) {
    interruption(signal, details)
    const requestSignal = combinedSignal(signal, Math.min(this.timeoutMs, 30000))
    const headers = new Headers(this.headers)
    if (typeof body === 'string') headers.set('Content-Type', 'application/json')
    else if (body instanceof FormData) headers.delete('Content-Type')
    let response
    try {
      response = await this.fetchImpl(`${this.baseURL}${path}`, { method, headers, body, signal: requestSignal, redirect: 'error' })
      if (!response.ok) {
        await response.body?.cancel()
        if (submission) {
          // A validation/auth rejection is conclusive; transport/proxy/5xx failures are not.
          const rejected = [400, 401, 403, 404, 405, 413, 415, 422].includes(response.status)
          fail(rejected ? 'SUBMISSION_REJECTED' : 'SUBMISSION_UNKNOWN', rejected ? 'ComfyUI 拒绝了本次工作流' : 'ComfyUI 提交结果未知，禁止自动重发', { ...details, httpStatus: response.status })
        }
        fail('HTTP_ERROR', 'ComfyUI 服务请求失败', { ...details, httpStatus: response.status })
      }
      if (responseType === 'empty') { await response.body?.cancel(); return undefined }
      const bytes = await readBounded(response, responseType === 'image' ? MAX_IMAGE_BYTES : MAX_JSON_BYTES, responseType === 'image' ? 'INVALID_OUTPUT' : 'INVALID_RESPONSE')
      if (responseType === 'image') return { data: bytes, contentType: response.headers.get('content-type') }
      try { return JSON.parse(bytes.toString('utf8')) } catch { fail(submission ? 'SUBMISSION_UNKNOWN' : 'INVALID_RESPONSE', submission ? 'ComfyUI 未返回可核验收执，禁止自动重发' : 'ComfyUI 返回了无效 JSON', details) }
    } catch (error) {
      if (error instanceof ComfyUIError) {
        if (submission && !['SUBMISSION_REJECTED', 'SUBMISSION_UNKNOWN'].includes(error.code)) fail('SUBMISSION_UNKNOWN', 'ComfyUI 提交结果未知，禁止自动重发', details)
        throw error
      }
      if (submission) fail('SUBMISSION_UNKNOWN', 'ComfyUI 提交后连接中断或超时，结果未知，禁止自动重发', details)
      interruption(requestSignal, details)
      fail('NETWORK_ERROR', '无法连接 ComfyUI；已有收执可以继续查询', details)
    }
  }

  async probe({ mode = 'generate', signal } = {}) {
    const { info, workflow, workflowSha256 } = await loadTemplate(mode)
    const metadata = { workflowId: info.id, workflowVersion: info.version, workflowSha256, model: info.model }
    let catalog
    try { catalog = await this._request('/object_info', { signal }) }
    catch (error) {
      if (error.code === 'ABORTED') throw error
      return { ...metadata, ready: false, missingNodes: [], missingModels: [], error: { code: error.code ?? 'NETWORK_ERROR', message: error.message } }
    }
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) fail('INVALID_RESPONSE', 'ComfyUI 节点目录格式无效')
    const missingNodes = [...new Set(Object.values(workflow).map(node => node.class_type))].filter(name => !Object.hasOwn(catalog, name))
    const missingModels = []
    for (const [nodeId, node] of Object.entries(workflow)) {
      for (const input of ['unet_name', 'clip_name', 'vae_name']) {
        const value = node.inputs[input]
        if (value === undefined) continue
        const definition = catalog[node.class_type]?.input?.required?.[input] ?? catalog[node.class_type]?.input?.optional?.[input]
        const choices = Array.isArray(definition?.[0]) ? definition[0] : definition?.[1]?.options
        if (!Array.isArray(choices) || !choices.includes(value)) missingModels.push({ nodeId, classType: node.class_type, input, value })
      }
    }
    return { ...metadata, ready: !missingNodes.length && !missingModels.length, missingNodes, missingModels }
  }

  async uploadImage({ data, contentType, filename }, signal) {
    interruption(signal)
    safePath(filename, { filename: true })
    await imageInfo(data, { contentType, filename, code: 'INVALID_INPUT' })
    const form = new FormData()
    form.set('image', new Blob([data], { type: contentType }), filename)
    form.set('type', 'input')
    form.set('overwrite', 'false')
    form.set('subfolder', `pre-design/${randomUUID()}`)
    const result = await this._request('/upload/image', { method: 'POST', body: form, signal })
    const name = safePath(result?.name, { filename: true, code: 'INVALID_RESPONSE' })
    const subfolder = safePath(result?.subfolder ?? '', { allowEmpty: true, code: 'INVALID_RESPONSE' })
    if (result.type !== 'input' || fileFormat(name, 'INVALID_RESPONSE') !== fileFormat(filename)) fail('INVALID_RESPONSE', 'ComfyUI 上传返回了不匹配的图片类型')
    return { name, subfolder, type: 'input', referenceImage: subfolder ? `${subfolder}/${name}` : name }
  }

  async submit(compiled, { clientId = compiled?.metadata?.requestId, signal } = {}) {
    if (!compiled?.workflow || !compiled.metadata?.requestId) fail('INVALID_INPUT', '缺少编译后的工作流与请求标识')
    nonempty(clientId, 'ComfyUI 客户端标识')
    const details = { requestId: compiled.metadata.requestId, workflowId: compiled.metadata.workflowId }
    const result = await this._request('/prompt', {
      method: 'POST', signal, submission: true, details,
      body: JSON.stringify({ prompt: compiled.workflow, client_id: clientId, extra_data: { pre_design: compiled.metadata } }),
    })
    if (typeof result?.prompt_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(result.prompt_id)) fail('SUBMISSION_UNKNOWN', 'ComfyUI 未返回可核验收执，禁止自动重发', details)
    return { promptId: result.prompt_id, number: result.number, metadata: { ...compiled.metadata } }
  }

  /** Resume by receipt. This method never submits or repeats a workflow. */
  async wait(promptId, { signal } = {}) {
    promptIdentifier(promptId)
    const details = { promptId }
    const waitSignal = combinedSignal(signal, this.timeoutMs)
    while (true) {
      interruption(waitSignal, details)
      const history = await this._request(`/history/${encodeURIComponent(promptId)}`, { signal: waitSignal, details })
      if (!history || typeof history !== 'object' || Array.isArray(history)) fail('INVALID_RESPONSE', 'ComfyUI 历史记录格式无效', details)
      const record = Object.hasOwn(history, promptId) ? history[promptId] : undefined
      if (record) {
        const status = record.status
        if (typeof record !== 'object' || Array.isArray(record)
          || (record.prompt !== undefined && (!Array.isArray(record.prompt) || record.prompt[1] !== promptId))
          || !status || typeof status.status_str !== 'string' || typeof status.completed !== 'boolean'
          || !Array.isArray(status.messages)) fail('INVALID_RESPONSE', 'ComfyUI 历史记录与收执不匹配或状态无效', details)
        const failed = status.status_str === 'error' || status.messages.some(entry => ['execution_error', 'execution_interrupted'].includes(entry?.[0]))
        if (failed) fail('EXECUTION_FAILED', 'ComfyUI 工作流执行失败或已中断', details)
        if (status?.completed === true) {
          if (status.status_str !== 'success') fail('EXECUTION_FAILED', 'ComfyUI 工作流未成功完成', details)
          const outputs = record.outputs?.['9']?.images
          if (!Array.isArray(outputs) || !outputs.length || outputs.length > 8) fail('INVALID_OUTPUT', 'ComfyUI 已完成但缺少可用的 SaveImage 输出', details)
          const descriptors = outputs.map(output => {
            if (output?.type !== 'output') fail('INVALID_OUTPUT', 'ComfyUI 返回的图片不是生成输出', details)
            const filename = safePath(output.filename, { filename: true, code: 'INVALID_OUTPUT' })
            const subfolder = safePath(output.subfolder ?? '', { allowEmpty: true, code: 'INVALID_OUTPUT' })
            fileFormat(filename, 'INVALID_OUTPUT')
            return { filename, subfolder, type: 'output', nodeId: '9' }
          })
          const images = []
          for (const descriptor of descriptors) {
            interruption(waitSignal, details)
            const query = new URLSearchParams({ filename: descriptor.filename, subfolder: descriptor.subfolder, type: descriptor.type })
            const downloaded = await this._request(`/view?${query}`, { signal: waitSignal, responseType: 'image', details })
            const verified = await imageInfo(downloaded.data, { contentType: downloaded.contentType, filename: descriptor.filename, code: 'INVALID_OUTPUT' })
            interruption(waitSignal, details)
            images.push({ ...descriptor, ...verified, data: downloaded.data })
          }
          return { promptId, images, status: { status_str: status.status_str, completed: true } }
        }
      }
      try { await delay(this.pollIntervalMs, undefined, { signal: waitSignal }) }
      catch { interruption(waitSignal, details) }
    }
  }

  async cancelQueued(promptId, { signal } = {}) {
    promptIdentifier(promptId)
    const details = { promptId }
    const readQueue = async () => {
      const queue = await this._request('/queue', { signal, details })
      if (!Array.isArray(queue?.queue_running) || !Array.isArray(queue?.queue_pending)) fail('INVALID_RESPONSE', 'ComfyUI 队列格式无效', details)
      return { running: queue.queue_running.some(row => row?.[1] === promptId), pending: queue.queue_pending.some(row => row?.[1] === promptId) }
    }
    const before = await readQueue()
    if (before.running) return { promptId, cancelled: false, reason: 'running' }
    if (!before.pending) return { promptId, cancelled: false, reason: 'not-queued' }
    // /queue delete is scoped to this id. Never clear the queue or interrupt the shared worker.
    await this._request('/queue', { method: 'POST', body: JSON.stringify({ delete: [promptId] }), responseType: 'empty', signal, details })
    const after = await readQueue()
    if (after.running) return { promptId, cancelled: false, reason: 'running' }
    if (after.pending) return { promptId, cancelled: false, reason: 'still-queued' }
    const history = await this._request(`/history/${encodeURIComponent(promptId)}`, { signal, details })
    if (!history || typeof history !== 'object' || Array.isArray(history)) fail('INVALID_RESPONSE', 'ComfyUI 历史记录格式无效', details)
    if (Object.hasOwn(history, promptId)) return { promptId, cancelled: false, reason: 'completed' }
    return { promptId, cancelled: true }
  }
}
