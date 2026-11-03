#!/usr/bin/env node
// Explicit live validation: at most one generation and one edit per durable run.
// Resume a run after interruption; never start a replacement for an unknown POST.
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, readFile, rename } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import sharp from 'sharp'
import { ComfyUIClient, compileFlux3Workflow } from './comfyui-client.mjs'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const now = () => new Date().toISOString()
const { values } = parseArgs({ options: {
  'base-url': { type: 'string' }, resume: { type: 'string' },
  'timeout-ms': { type: 'string', default: '1200000' }, help: { type: 'boolean' },
} })
if (values.help) {
  console.log('Usage: node web/worker/probe-comfy-live.mjs --base-url http://host:port [--timeout-ms 1200000]\nResume (never re-submit): node web/worker/probe-comfy-live.mjs --resume .cache/comfy-live-<run>\nThe address may also come from COMFYUI_BASE_URL. Results and receipts are private files under .cache/.')
  process.exit(0)
}

const timeoutMs = Number(values['timeout-ms'])
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 86_400_000) throw new Error('timeout-ms 必须为 1000 至 86400000 的整数')
const cache = resolve('.cache')
await mkdir(cache, { recursive: true, mode: 0o700 })
if (!(await lstat(cache)).isDirectory()) throw new Error('.cache 必须是实际目录')
const runDirectory = values.resume ? resolve(values.resume) : resolve(cache, `comfy-live-${now().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`)
if (dirname(runDirectory) !== cache || !/^comfy-live-[A-Za-z0-9_.:-]+$/u.test(basename(runDirectory))) throw new Error('收执目录必须位于当前工作目录的 .cache/comfy-live-*')
if (!values.resume) await mkdir(runDirectory, { mode: 0o700 })
if (!(await lstat(runDirectory)).isDirectory()) throw new Error('收执目录不能是符号链接')
await chmod(runDirectory, 0o700)

async function durableWrite(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { await file.writeFile(value); await file.sync() } finally { await file.close() }
  await rename(temporary, path)
  const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try { await directory.sync() } finally { await directory.close() }
}
async function claimPost(path, value) {
  // Cross-process admission: a stale receipt can never cause a second POST.
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync() } finally { await file.close() }
  const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try { await directory.sync() } finally { await directory.close() }
}
const receiptFile = resolve(runDirectory, 'receipt.json')
let run = values.resume ? JSON.parse(await readFile(receiptFile, 'utf8')) : {
  version: 1, runId: randomUUID(), createdAt: now(), baseURL: values['base-url'] ?? process.env.COMFYUI_BASE_URL,
  parameters: { width: 512, height: 512, steps: 16 }, postJournal: [], modes: {},
}
if (run.version !== 1 || !Array.isArray(run.postJournal) || !run.modes) throw new Error('收执结构无效')
if (values.resume && values['base-url'] && values['base-url'].replace(/\/+$/u, '') !== run.baseURL) throw new Error('恢复必须使用原服务地址')
const endpoint = new ComfyUIClient({ baseURL: run.baseURL }).baseURL
run.baseURL = endpoint
const save = async () => {
  run.updatedAt = now()
  await durableWrite(receiptFile, `${JSON.stringify(run, null, 2)}\n`)
}
await save()
const abort = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => abort.abort(new Error(`本地等待收到 ${signal}；远端请求保留`)))
const signal = () => AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)])
let activeMode

async function queueCounts() {
  const response = await fetch(`${endpoint}/queue`, { signal: signal(), redirect: 'error' })
  if (!response.ok) throw new Error(`队列读取失败：HTTP ${response.status}`)
  const queue = await response.json()
  if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) throw new Error('队列格式无效')
  // Never retain other users' prompts, workflow contents or identifiers.
  return { at: now(), running: queue.queue_running.length, pending: queue.queue_pending.length }
}
async function boundedText(response) {
  if (!response.body) return ''
  const reader = response.body.getReader(), chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 16 * 1024 * 1024) throw new Error('诊断响应超过 16MB')
      chunks.push(Buffer.from(value))
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}
const client = new ComfyUIClient({ baseURL: endpoint, pollIntervalMs: 2000, timeoutMs: 45_000,
  fetchImpl: async (url, options = {}) => {
    if ((options.method ?? 'GET') !== 'POST') return fetch(url, options)
    const path = new URL(url).pathname
    if (!activeMode || !['/prompt', '/upload/image'].some(suffix => path.endsWith(suffix))) throw new Error('探针禁止此 POST')
    const operation = path.endsWith('/prompt') ? 'submit' : 'upload'
    if (operation === 'upload' && activeMode !== 'edit') throw new Error('仅编辑可上传已生成参考图')
    if (run.postJournal.some(row => row.mode === activeMode && row.operation === operation)) throw new Error('已有 POST 收执，禁止再次提交')
    const queue = await queueCounts()
    const entry = { mode: activeMode, operation, path, startedAt: now(), state: 'dispatching', queue }
    await claimPost(resolve(runDirectory, `${activeMode}-${operation}.post-once.json`), entry)
    run.postJournal.push(entry)
    run.modes[activeMode].state = operation === 'submit' ? 'dispatching' : 'uploading'
    // fsync settles before any POST bytes can be sent.
    await save()
    console.log(JSON.stringify({ event: 'post', mode: activeMode, operation, queue }))
    let response
    try { response = await fetch(url, options) }
    catch (error) {
      entry.state = 'unknown'
      entry.error = { name: error.name, message: error.message }
      run.modes[activeMode].state = operation === 'submit' ? 'submission_unknown' : 'upload_unknown'
      await save()
      throw error
    }
    entry.httpStatus = response.status
    entry.respondedAt = now()
    entry.state = response.ok ? 'acknowledged' : 'rejected-or-unknown'
    try {
      const raw = await boundedText(response.clone())
      await durableWrite(resolve(runDirectory, `${activeMode}-${operation}-response.txt`), raw)
      const result = JSON.parse(raw)
      if (response.ok && operation === 'submit' && /^[A-Za-z0-9_-]{1,128}$/u.test(result.prompt_id ?? '')) {
        run.modes[activeMode].promptId = result.prompt_id
        run.modes[activeMode].state = 'submitted'
        entry.promptId = result.prompt_id
      }
    } catch (error) { entry.diagnosticError = error.message }
    await save()
    return response
  },
})

async function historyFor(mode) {
  const row = run.modes[mode]
  if (!row?.promptId) return undefined
  const history = await client._request(`/history/${encodeURIComponent(row.promptId)}`, { signal: abort.signal })
  const record = history[row.promptId]
  if (record) await durableWrite(resolve(runDirectory, `${mode}-history.json`), `${JSON.stringify(record, null, 2)}\n`)
  return record
}
async function verifyImage(bytes, expected) {
  const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 512 * 512 })
  const metadata = await image.metadata()
  if (!['png', 'jpeg'].includes(metadata.format) || metadata.width !== 512 || metadata.height !== 512 || (metadata.pages ?? 1) !== 1) throw new Error('真实输出必须是 512×512 单帧 PNG/JPEG')
  const pixels = await image.removeAlpha().toColourspace('srgb').raw().toBuffer()
  const info = { sha256: sha256(bytes), pixelSha256: sha256(pixels), format: metadata.format, width: metadata.width, height: metadata.height, bytes: bytes.length }
  if (expected && (info.sha256 !== expected.sha256 || info.pixelSha256 !== expected.pixelSha256)) throw new Error('已保存图片与收执哈希不匹配')
  return info
}
async function verifyHistoryWorkflow(mode, historical) {
  const row = run.modes[mode]
  const submitted = JSON.parse(await readFile(resolve(runDirectory, `${mode}-workflow.json`), 'utf8'))
  if (sha256(JSON.stringify(submitted)) !== row.compiledWorkflowSha256) throw new Error('已保存工作流与提交收执不匹配')
  const unwrapped = structuredClone(submitted)
  for (const node of Object.values(unwrapped)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      // ComfyUI unwraps literal API values before retaining the execution graph.
      if (value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).length === 1 && Object.hasOwn(value, '__value__')) node.inputs[key] = value.__value__
    }
  }
  if (!isDeepStrictEqual(historical, submitted) && !isDeepStrictEqual(historical, unwrapped)) throw new Error('真实 history 工作流与提交内容不匹配')
  row.historyWorkflowSha256 = sha256(JSON.stringify(historical))
  row.historyNormalization = isDeepStrictEqual(historical, submitted) ? 'none' : 'ComfyUI __value__ literal unwrapping'
}
async function finishMode(mode) {
  const row = run.modes[mode], began = Date.now(), deadline = began + timeoutMs
  while (Date.now() < deadline) {
    try {
      const result = await client.wait(row.promptId, { signal: abort.signal })
      if (result.images.length !== 1 || result.images[0].type !== 'output') throw new Error('工作流必须恰好返回一张 output 图片')
      const image = result.images[0], info = await verifyImage(image.data)
      if (mode === 'edit' && (info.sha256 === row.reference.sha256 || info.pixelSha256 === row.reference.pixelSha256)) throw new Error('编辑输出与参考图相同')
      const file = resolve(runDirectory, `${mode}.${info.format}`)
      await durableWrite(file, image.data)
      const history = await historyFor(mode)
      if (!history || history.prompt?.[1] !== row.promptId || history.status?.completed !== true || history.status?.status_str !== 'success') throw new Error('真实 history 成功记录与 promptId 不匹配')
      const historyWorkflow = history.prompt?.[2]
      await verifyHistoryWorkflow(mode, historyWorkflow)
      const messages = history.status.messages ?? []
      const started = messages.find(message => message[0] === 'execution_start')?.[1]?.timestamp
      const finished = messages.find(message => message[0] === 'execution_success')?.[1]?.timestamp
      row.state = 'completed'
      row.completedAt = now()
      row.output = { ...info, file, descriptor: { filename: image.filename, subfolder: image.subfolder, type: image.type, nodeId: image.nodeId } }
      row.elapsedMs = Date.parse(row.completedAt) - Date.parse(row.submittedAt ?? row.createdAt)
      if (Number.isFinite(started) && Number.isFinite(finished)) row.serverExecutionMs = finished - started
      delete row.error
      await save()
      console.log(JSON.stringify({ event: 'completed', mode, promptId: row.promptId, ...info, elapsedMs: row.elapsedMs, serverExecutionMs: row.serverExecutionMs }))
      return
    } catch (error) {
      if (error.code === 'TIMEOUT' && !abort.signal.aborted && Date.now() < deadline) {
        console.log(JSON.stringify({ event: 'waiting', mode, promptId: row.promptId, elapsedMs: Date.now() - began }))
        continue
      }
      throw error
    }
  }
  throw Object.assign(new Error('等待达到上限；保留收执，使用 --resume 查询，禁止重发'), { code: 'WAIT_TIMEOUT' })
}

async function runMode(mode) {
  activeMode = mode
  let row = run.modes[mode]
  if (row?.state === 'completed') {
    await verifyImage(await readFile(row.output.file), row.output)
    return
  }
  if (row?.promptId) return finishMode(mode)
  if (run.postJournal.some(entry => entry.mode === mode && (entry.operation === 'submit' || !row?.upload))) throw new Error(`${mode} 已有未恢复的 POST；结果未知，禁止重发`)
  row = run.modes[mode] ??= { mode, requestId: `${run.runId}-${mode}`, state: 'preparing', createdAt: now(),
    prompt: mode === 'generate'
      ? 'A studio photograph of three separate matte geometric solids: a red cube on the left, a blue sphere in the middle, and a yellow cone on the right. All rest on a simple light gray tabletop against a neutral gray background. Soft even lighting, visible soft shadows, centered composition, no people, no text, no labels.'
      : 'Change the red cube on the left to a vivid green cube. Preserve the blue sphere in the middle, the yellow cone on the right, their shapes and positions, the gray tabletop, background, camera viewpoint, lighting and shadows. Do not add text, labels, people or new objects.',
    seed: mode === 'generate' ? 2026110301 : 2026110302,
  }
  await save()
  const ready = await client.probe({ mode, signal: abort.signal })
  row.probe = ready
  await save()
  if (!ready.ready) throw Object.assign(new Error(`${mode} 节点或模型未就绪`), { code: 'BACKEND_NOT_READY' })
  let uploaded = row.upload
  if (mode === 'edit' && !uploaded) {
    const source = run.modes.generate.output, data = await readFile(source.file)
    await verifyImage(data, source)
    row.reference = { file: source.file, sha256: source.sha256, pixelSha256: source.pixelSha256, width: source.width, height: source.height }
    await save()
    uploaded = await client.uploadImage({ data, contentType: source.format === 'png' ? 'image/png' : 'image/jpeg', filename: `probe-reference-${run.runId}.${source.format}` }, abort.signal)
    row.upload = uploaded
    row.state = 'uploaded'
    await save()
  }
  const compiled = await compileFlux3Workflow({ mode, prompt: row.prompt, width: 512, height: 512, seed: row.seed,
    ...(uploaded ? { referenceImage: uploaded.referenceImage } : {}), requestId: row.requestId })
  if (compiled.workflow['128:107'].inputs.steps !== 16) throw new Error('探针要求保持原工作流的 16 steps')
  row.workflow = compiled.metadata
  row.compiledWorkflowSha256 = sha256(JSON.stringify(compiled.workflow))
  row.sampler = { steps: 16, cfg: compiled.workflow['128:107'].inputs.cfg, sampler: compiled.workflow['128:107'].inputs.sampler_name, scheduler: compiled.workflow['128:107'].inputs.scheduler }
  await durableWrite(resolve(runDirectory, `${mode}-workflow.json`), `${JSON.stringify(compiled.workflow, null, 2)}\n`)
  await save()
  const submitted = await client.submit(compiled, { clientId: row.requestId, signal: abort.signal })
  row.promptId = submitted.promptId
  row.submittedAt = now()
  row.state = 'submitted'
  await save()
  await finishMode(mode)
}

async function report() {
  const lines = ['# ComfyUI 真实服务验证', '', `- 更新时间：${now()}`, `- 服务：${endpoint}`, `- 收执目录：${runDirectory}`,
    `- 状态：${run.modes.generate?.state ?? '未执行'}（文生图） / ${run.modes.edit?.state ?? '未执行'}（参考图编辑）`,
    '- 范围：直接使用当前 ComfyUIClient 与已版本化 Flux3 工作流；不证明配套 LLM 或完整平台链路已验证。',
    '- 参数：512×512、16 steps、cfg 1、euler/simple；使用通用几何静物，不包含项目事实。',
    '- 安全记录：每次 POST 前 fsync 收执；最多各提交一张；只查询本次 promptId 的历史；未调用 interrupt/free/delete。', '']
  if (run.system) lines.push(`服务信息：\`${JSON.stringify(run.system)}\``, '')
  for (const mode of ['generate', 'edit']) {
    const row = run.modes[mode]
    lines.push(`## ${mode === 'generate' ? '文生图 generate' : '参考图编辑 edit'}`, '')
    if (!row) { lines.push('未执行。', ''); continue }
    for (const [label, value] of Object.entries({ 状态: row.state, promptId: row.promptId, 模型: row.workflow?.model,
      工作流模板SHA256: row.workflow?.workflowSha256, 已提交工作流SHA256: row.compiledWorkflowSha256,
      历史工作流SHA256: row.historyWorkflowSha256, 历史工作流规范化: row.historyNormalization,
      种子: row.seed, 输出SHA256: row.output?.sha256, 输出像素SHA256: row.output?.pixelSha256,
      输出文件: row.output?.file, 尺寸: row.output ? `${row.output.width}×${row.output.height}` : undefined,
      提交到核验完成耗时ms: row.elapsedMs, 服务执行耗时ms: row.serverExecutionMs,
      参考图SHA256: row.reference?.sha256, 错误: row.error ? JSON.stringify(row.error) : undefined,
    })) if (value !== undefined) lines.push(`- ${label}：${value}`)
    if (row.output) lines.push('- 验证：真实 history success、工作流一致、SaveImage output、完整像素解码通过。')
    if (mode === 'edit' && row.output) lines.push(`- 与参考图不同：文件 SHA256 ${row.output.sha256 !== row.reference.sha256}；像素 SHA256 ${row.output.pixelSha256 !== row.reference.pixelSha256}。`)
    lines.push('')
  }
  const content = `${lines.join('\n')}\n`
  await durableWrite(resolve(runDirectory, 'report.md'), content)
  await durableWrite(resolve(cache, 'comfy-live-report.md'), content)
}

try {
  if (!run.system) {
    const stats = await client._request('/system_stats', { signal: abort.signal })
    run.system = { comfyuiVersion: stats.system?.comfyui_version, pythonVersion: stats.system?.python_version,
      devices: (stats.devices ?? []).map(device => ({ name: device.name, type: device.type, vramTotal: device.vram_total, vramFree: device.vram_free })) }
    run.initialQueue = await queueCounts()
    await save()
  }
  console.log(JSON.stringify({ event: 'start', runDirectory, system: run.system, queue: run.initialQueue, resume: Boolean(values.resume) }))
  await runMode('generate')
  await report()
  await runMode('edit')
} catch (error) {
  const row = run.modes[activeMode]
  const failure = { code: error.code ?? error.name, message: error.message }
  if (row) {
    row.error = failure
    if (['EXECUTION_FAILED', 'SUBMISSION_REJECTED', 'INVALID_OUTPUT', 'BACKEND_NOT_READY'].includes(error.code)) row.state = 'failed'
    else if (!row.promptId && run.postJournal.some(entry => entry.mode === activeMode)) row.state = 'submission_unknown'
    try {
      const history = await historyFor(activeMode)
      const detail = history?.status?.messages?.find(message => message[0] === 'execution_error')?.[1]
      if (detail) row.error.execution = { nodeId: detail.node_id, nodeType: detail.node_type, exceptionType: detail.exception_type, message: String(detail.exception_message ?? '').slice(0, 2000) }
    } catch (diagnostic) { row.error.diagnostic = diagnostic.message }
  } else run.error = failure
  await save()
  console.error(JSON.stringify({ event: 'failed', mode: activeMode, promptId: row?.promptId, error: row?.error ?? failure, runDirectory }))
  process.exitCode = 1
} finally {
  await report()
  console.log(JSON.stringify({ event: 'report', file: resolve(cache, 'comfy-live-report.md'), receiptFile }))
}
