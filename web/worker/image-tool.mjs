import { defineTool } from '@deepseek-ai/dsh-tools'
import { createHash, randomUUID } from 'node:crypto'
import { constants, realpathSync } from 'node:fs'
import { mkdir, open, rename, rm, rmdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path'
import sharp from 'sharp'
import { safeProjectPath } from './project-boundary.mjs'
import { readBoundFile } from './research-artifacts.mjs'
import { REPORT_CHAPTERS } from '../app/src/research-contract.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
const stamp = () => new Date().toISOString()
const formatTypes = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
const text = (value, max = 4096) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0')
const sameRoute = (a, b) => a?.provider === b?.provider && a?.model === b?.model
const comfyRoute = row => row?.provider === 'Comfyui-PIC' && row?.model === 'Klein'
const identity = value => text(value, 1024) && !/[\x00-\x1f\x7f]/u.test(value)
const imageError = code => Object.assign(new Error(`${code}: 图像请求未取得可确认结果；保留原请求收执，不重复生成。`), { code })
function fail(code) { throw imageError(code) }
function signalCheck(signal) { signal?.throwIfAborted() }

function checkedArguments(args) {
  // Structured tool callers can fill an optional string with "". Only a
  // reference-free generation treats that exact value as an omitted field.
  const referenceImage = args?.mode === 'generate' && args.referenceImage === '' ? undefined : args?.referenceImage
  if (!args || !['generate', 'edit'].includes(args.mode) || !text(args.prompt, 16000)
    || Object.keys(args).some(key => !['mode', 'prompt', 'width', 'height', 'seed', 'referenceImage'].includes(key))
    || (args.width === undefined) !== (args.height === undefined)
    || [args.width, args.height].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 16 || value > 8192 || value % 16 !== 0))
    || (args.width !== undefined && args.width * args.height > 16 * 1024 * 1024)
    || (args.seed !== undefined && (!Number.isSafeInteger(args.seed) || args.seed < 0))
    || (args.mode === 'edit' ? !text(referenceImage) : referenceImage !== undefined)) fail('IMAGE_ARGUMENT_INVALID')
  return { mode: args.mode, prompt: args.prompt, ...(args.width === undefined ? {} : { width: args.width, height: args.height }),
    ...(args.seed === undefined ? {} : { seed: args.seed }), ...(referenceImage === undefined ? {} : { referenceImage }) }
}

async function authorize(ctx, root, sessionId, policy, exec) {
  try {
    const agent = exec.agent, ancestors = new Set()
    if (!agent || String(agent.id) === sessionId || !identity(exec.callId)) fail('IMAGE_AGENT_FORBIDDEN')
    let current = agent, foundRoot = false
    while (current && ancestors.size < 32) {
      const id = String(current.id), header = current.session?.header
      if (ancestors.has(id) || ctx.agents.get(id) !== current || String(header?.id) !== id || realpathSync(header.cwd) !== root) fail('IMAGE_AGENT_FORBIDDEN')
      ancestors.add(id)
      if (id === sessionId) { foundRoot = true; break }
      if (header.origin !== 'subagent' || !header.parentSession || !Number.isSafeInteger(header.delegationDepth) || header.delegationDepth < 1) fail('IMAGE_AGENT_FORBIDDEN')
      current = ctx.agents.get(String(header.parentSession))
    }
    if (!foundRoot) fail('IMAGE_AGENT_FORBIDDEN')
    const projectId = ctx.preplanning.repository.readContext(sessionId).project.projectId
    if (!identity(projectId)) fail('IMAGE_PROJECT_FORBIDDEN')
    const rows = await ctx.preplanning.agentClasses.executions(projectId, { all: true })
    const owned = rows.filter(row => row.childId === String(agent.id) && row.projectId === projectId && row.classId === 'image')
    if (owned.length !== 1) fail('IMAGE_EXECUTION_FORBIDDEN')
    const execution = owned[0], selected = execution.selected
    if (!ancestors.has(execution.parentId) || execution.parentId === String(agent.id) || !comfyRoute(selected) || !selected.llm) fail('IMAGE_ROUTE_FORBIDDEN')
    const routes = [policy?.classRoutes?.image, ...(policy?.classFallbacks?.image ?? [])]
    if (!routes.some(route => comfyRoute(route) && sameRoute(route.llm, selected.llm))) fail('IMAGE_ROUTE_FORBIDDEN')
    const snapshot = policy?.snapshot, modelRows = snapshot?.models ?? []
    const verified = role => [snapshot?.routes?.[role]?.primary, ...(snapshot?.routes?.[role]?.fallbacks ?? [])].filter(Boolean)
      .map(ref => modelRows.find(row => sameRoute(row, ref))).filter(row => row?.status === 'verified')
    if (!verified('image').some(row => comfyRoute(row) && row.capabilities?.image)
      || !verified('imageLlm').some(row => row.capabilities?.text && row.capabilities?.tools && sameRoute({ provider: row.runtimeProvider, model: row.model }, selected.llm))) fail('IMAGE_ROUTE_FORBIDDEN')
    const tasks = ctx.preplanning.governance.readProject(projectId).visualTasks
      .filter(row => row.projectId === projectId && row.childId === String(agent.id) && row.executionId === execution.id)
    if (tasks.length !== 1) fail('IMAGE_EXECUTION_FORBIDDEN')
    const task = tasks[0], events = agent.session.snapshotEvents()
    if (!identity(task.taskId) || !Number.isSafeInteger(task.attempts) || task.attempts < 1) fail('IMAGE_EXECUTION_FORBIDDEN')
    const descriptor = events.find(row => row.type === 'subagent/descriptor')?.data
    if (descriptor?.version !== 3 || descriptor.provider !== 'spawn' || descriptor.mode !== 'continuable'
      || descriptor.label !== `preplanning_visual_tool_task:${projectId}:${task.taskId}:${task.attempts}`) fail('IMAGE_DESCRIPTOR_FORBIDDEN')
    const active = events.slice(Math.max(0, events.findLastIndex(row => row.type === 'turn/start')))
    const calls = active.filter(row => row.type === 'tool/call' && row.data?.name === 'comfyui_pic')
    if (!calls.some(row => row.data.callId === exec.callId)) fail('IMAGE_TOOL_CALL_FORBIDDEN')
    const requestHeaders = events.filter(row => row.type === 'request/header')
    if (!active.some(row => row.type === 'request/header') || requestHeaders.some(row => !sameRoute(row.data?.header?.config, selected.llm))) fail('IMAGE_MODEL_ROUTE_FORBIDDEN')
    signalCheck(exec.signal)
    return { projectId, executionId: execution.id, agentId: String(agent.id), task, execution }
  } catch (error) {
    if (exec.signal?.aborted) throw exec.signal.reason
    if (error?.code?.startsWith('IMAGE_')) throw error
    throw imageError('IMAGE_AGENT_FORBIDDEN')
  }
}

async function json(root, path) {
  try { return JSON.parse((await readBoundFile(root, path)).toString('utf8')) }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
}
async function imageBytes(bytes, claimedType, errorCode) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > 64 * 1024 * 1024) fail(errorCode)
  try {
    const data = Buffer.from(bytes), image = sharp(data, { limitInputPixels: 40_000_000, failOn: 'warning' })
    const info = await image.metadata(), mediaType = formatTypes[info.format]
    if (!mediaType || info.pages > 1 || (claimedType && mediaType !== claimedType)) fail(errorCode)
    // Metadata alone accepts truncated containers. Decode every pixel before attaching.
    await image.raw().toBuffer()
    return { data, mediaType, format: info.format, width: info.width, height: info.height, bytes: data.length, sha256: digest(data) }
  } catch { throw imageError(errorCode) }
}
async function reference(ctx, root, name, owner) {
  try {
    if (!text(name) || name.includes('\\') || win32.isAbsolute(name) && !isAbsolute(name)
      || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(name)) fail('IMAGE_REFERENCE_FORBIDDEN')
    const path = isAbsolute(name) ? relative(root, name) : name
    if (path.split('/').some(part => !part || part === '.' || part === '..')) fail('IMAGE_REFERENCE_FORBIDDEN')
    // Core and the standard directory intentionally have distinct project IDs.
    // Only the host-owned binding can authorize the standard manifest identity.
    const binding = ctx.preplanning.standardProjects?.findByPreDesignProjectId(owner.projectId)
    if (!binding || binding.state !== 'ready' || binding.preDesignProjectId !== owner.projectId
      || !identity(binding.presentationProjectId)) fail('IMAGE_REFERENCE_BINDING_FORBIDDEN')
    const boundRoot = binding.workspaceRoot ?? binding.directoryRoot
    const roots = binding.directoryRoot === undefined ? [boundRoot] : [boundRoot, binding.directoryRoot]
    for (const value of roots) if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== root || await realpath(value) !== root) fail('IMAGE_REFERENCE_BINDING_FORBIDDEN')
    const standardProjectId = binding.presentationProjectId
    const matches = []
    for (const [file, field, id] of [['assets/manifest.json', 'assets', 'assetId'], ['source-materials/manifest.json', 'materials', 'sourceMaterialId']]) {
      const manifest = await json(root, file)
      if (manifest === undefined) continue
      if (manifest.projectId !== standardProjectId || !Array.isArray(manifest[field])) fail('IMAGE_REFERENCE_PROJECT_MISMATCH')
      for (const row of manifest[field]) if (row[id] === name || row.relativePath === path) {
        if (row.category !== 'image' || (field === 'assets' ? row.mediaType !== 'image' || !['candidate', 'adopted'].includes(row.adoptionStatus) : row.status !== 'available')
          || !row.relativePath.startsWith(field === 'assets' ? 'assets/' : 'source-materials/')) fail('IMAGE_REFERENCE_FORBIDDEN')
        matches.push({ id: row[id], path: row.relativePath, sha256: row.sha256, size: row.sizeBytes, mediaType: row.mimeType,
          width: row.metadata?.widthPx, height: row.metadata?.heightPx })
      }
    }
    // Core chapterProfile.code is the 1-based, two-digit index of REPORT_CHAPTERS.
    const chapterId = owner.task.chapterId
    const chapter = /^0[1-7]$/u.test(chapterId) ? REPORT_CHAPTERS[Number(chapterId) - 1] : chapterId
    if (REPORT_CHAPTERS.includes(chapter)) {
      const rows = await json(root, `.pre-design/chapter-production-assets/${chapter}.json`)
      if (rows !== undefined && !Array.isArray(rows)) fail('IMAGE_REFERENCE_INVALID')
      for (const row of rows ?? []) {
        if (typeof row.path !== 'string') continue
        const local = isAbsolute(row.path) ? relative(root, row.path) : row.path
        if (row.id === name || local === path) {
          if (!/^(?:原始资料|source-materials)\//u.test(local)) fail('IMAGE_REFERENCE_FORBIDDEN')
          matches.push({ id: row.id, path: local, sha256: row.sha256, width: row.width, height: row.height })
        }
      }
    }
    if (!matches.length || matches.some(row => row.path !== matches[0].path || row.sha256 !== matches[0].sha256)) fail('IMAGE_REFERENCE_NOT_VERIFIED')
    const ref = matches[0]
    if (!/^[a-f0-9]{64}$/u.test(ref.sha256)) fail('IMAGE_REFERENCE_NOT_VERIFIED')
    const data = await readBoundFile(root, ref.path)
    if (digest(data) !== ref.sha256 || (ref.size !== undefined && ref.size !== data.length)) fail('IMAGE_REFERENCE_CHANGED')
    const image = await imageBytes(data, ref.mediaType, 'IMAGE_REFERENCE_INVALID')
    if ((ref.width !== undefined && ref.width !== image.width) || (ref.height !== undefined && ref.height !== image.height)) fail('IMAGE_REFERENCE_CHANGED')
    return { ...image, id: ref.id, path: ref.path }
  } catch (error) {
    if (error?.code?.startsWith('IMAGE_REFERENCE_')) throw error
    throw imageError('IMAGE_REFERENCE_INVALID')
  }
}

async function directory(root, path) {
  let local = ''
  for (const part of path.split('/')) {
    local = local ? `${local}/${part}` : part
    try { await mkdir(join(root, local), { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
    safeProjectPath(root, local)
  }
  return safeProjectPath(root, path)
}
async function syncDirectory(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try { await file.sync() } finally { await file.close() }
}
async function durableWrite(root, path, value, exclusive = false) {
  const parent = await directory(root, dirname(path)), target = join(parent, basename(path))
  const temp = exclusive ? target : join(parent, `.${basename(path)}.${randomUUID()}.tmp`)
  const file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { await file.writeFile(value); await file.sync() } finally { await file.close() }
  try {
    if (safeProjectPath(root, dirname(path)) !== parent) fail('IMAGE_STORAGE_CHANGED')
    if (!exclusive) await rename(temp, target)
    await syncDirectory(parent)
  } finally { if (!exclusive) await rm(temp, { force: true }) }
}
const workflowMetadata = metadata => Object.fromEntries(['workflowId', 'workflowVersion', 'workflowSha256', 'model', 'mode', 'requestId', 'seed', 'width', 'height']
  .filter(key => typeof metadata?.[key] === 'string' || Number.isSafeInteger(metadata?.[key])).map(key => [key, metadata[key]]))

async function claimTask(root, sessionId, owner, requestId) {
  const taskKey = digest(JSON.stringify([root, sessionId, owner.projectId, owner.task.taskId]))
  const folder = `.pre-design/image-requests/tasks/${taskKey}`
  await directory(root, folder)
  const lockPath = join(root, folder, 'lock')
  try { await mkdir(lockPath, { mode: 0o700 }) }
  catch (error) { if (error.code === 'EEXIST') fail('IMAGE_TASK_REQUIRES_RECOVERY'); throw error }
  try {
    safeProjectPath(root, `${folder}/lock`)
    const active = await json(root, `${folder}/active.json`)
    if (active && active.requestId !== requestId) {
      if (!/^[a-f0-9]{64}$/u.test(active.requestId)) fail('IMAGE_TASK_REQUIRES_RECOVERY')
      const previous = await json(root, `.pre-design/image-requests/receipts/${active.requestId}/receipt.json`)
      const mayRetry = previous?.cancellation?.cancelled === true || previous?.state === 'failed'
        && (!previous.promptId || previous.errorCode === 'IMAGE_EXECUTION_FAILED')
      if (!mayRetry || previous.taskId !== owner.task.taskId || previous.projectId !== owner.projectId
        || owner.task.attempts <= previous.attempt) fail('IMAGE_TASK_REQUIRES_RECOVERY')
    }
    await durableWrite(root, `${folder}/active.json`, JSON.stringify({ requestId }))
  } finally { await rmdir(lockPath) }
}

/** Install one native, project-scoped ComfyUI image tool. Backend owns only HTTP/workflow compilation. */
export async function installImageTool(ctx, { workspace, sessionId, policy, backend }) {
  const root = await realpath(workspace), inFlight = new Map()
  if (root !== resolve(workspace) || !text(sessionId) || !ctx.attachments?.saveImage
    || !backend?.client || typeof backend.compileWorkflow !== 'function') fail('IMAGE_BACKEND_UNAVAILABLE')

  async function output(receipt, signal) {
    signalCheck(signal)
    const stored = receipt.output
    if (!stored || !stored.path.startsWith(`.pre-design/image-requests/receipts/${receipt.requestId}/`)) fail('IMAGE_OUTPUT_CHANGED')
    let bytes
    try { bytes = await readBoundFile(root, stored.path) } catch { fail('IMAGE_OUTPUT_CHANGED') }
    if (digest(bytes) !== stored.sha256) fail('IMAGE_OUTPUT_CHANGED')
    const image = await imageBytes(bytes, stored.mediaType, 'IMAGE_OUTPUT_CHANGED')
    if (image.width !== stored.width || image.height !== stored.height) fail('IMAGE_OUTPUT_CHANGED')
    signalCheck(signal)
    const attachment = await ctx.attachments.saveImage({ data: image.data, mediaType: image.mediaType, name: `generated-${receipt.requestId.slice(0, 16)}.${image.format}` })
    signalCheck(signal)
    return { requestId: receipt.requestId, promptId: receipt.promptId, mode: receipt.mode, status: 'completed', workflow: receipt.workflow,
      sha256: image.sha256, width: image.width, height: image.height, attachment }
  }
  async function perform(args, exec, owner, requestId, inputHash) {
    signalCheck(exec.signal)
    const ownerKey = digest(JSON.stringify([root, sessionId, owner.agentId, owner.executionId]))
    const ownerPath = `.pre-design/image-requests/owners/${ownerKey}.json`
    try { await durableWrite(root, ownerPath, JSON.stringify({ requestId }), true) }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      let claim
      try { claim = await json(root, ownerPath) } catch { fail('IMAGE_SUBMISSION_UNKNOWN') }
      if (claim?.requestId !== requestId) fail('IMAGE_REQUEST_ALREADY_EXISTS')
    }
    const folder = `.pre-design/image-requests/receipts/${requestId}`, receiptPath = `${folder}/receipt.json`
    await directory(root, dirname(folder))
    let fresh = false
    try { await mkdir(join(root, folder), { mode: 0o700 }); await syncDirectory(safeProjectPath(root, dirname(folder))); fresh = true }
    catch (error) { if (error.code !== 'EEXIST') throw error }
    safeProjectPath(root, folder)
    let receipt
    if (!fresh) {
      try { receipt = await json(root, receiptPath) } catch { fail('IMAGE_SUBMISSION_UNKNOWN') }
      if (!receipt) fail('IMAGE_SUBMISSION_UNKNOWN')
      if (receipt.requestId !== requestId || receipt.inputHash !== inputHash || receipt.projectId !== owner.projectId
        || receipt.sessionId !== sessionId || receipt.agentId !== owner.agentId || receipt.executionId !== owner.executionId) fail('IMAGE_REQUEST_CONFLICT')
      if (receipt.state === 'completed') return output(receipt, exec.signal)
      if (receipt.cancellation?.cancelled) fail('IMAGE_REQUEST_CANCELLED')
      if (receipt.state === 'failed') fail(receipt.errorCode?.startsWith('IMAGE_') ? receipt.errorCode : 'IMAGE_REQUEST_FAILED')
      if (!receipt.promptId || ['preparing', 'dispatching', 'submission_unknown'].includes(receipt.state)) fail('IMAGE_SUBMISSION_UNKNOWN')
    } else {
      if (!['starting', 'running'].includes(owner.execution.status) || owner.task.status !== 'running') fail('IMAGE_EXECUTION_FORBIDDEN')
      receipt = { version: 1, requestId, sessionId, projectId: owner.projectId, agentId: owner.agentId, toolCallId: exec.callId,
        executionId: owner.executionId, taskId: owner.task.taskId, attempt: owner.task.attempts,
        inputHash, mode: args.mode, state: 'preparing', createdAt: stamp(), updatedAt: stamp() }
      await durableWrite(root, receiptPath, JSON.stringify(receipt))
    }
    const save = async patch => {
      receipt = { ...receipt, ...patch, updatedAt: stamp() }
      await durableWrite(root, receiptPath, JSON.stringify(receipt))
    }
    if (fresh) {
      try {
        await claimTask(root, sessionId, owner, requestId)
        const ref = args.mode === 'edit' ? await reference(ctx, root, args.referenceImage, owner) : undefined
        signalCheck(exec.signal)
        const probe = await backend.client.probe({ mode: args.mode, signal: exec.signal })
        if (probe?.ready !== true) fail('IMAGE_BACKEND_NOT_READY')
        signalCheck(exec.signal)
        let uploaded
        if (ref) {
          uploaded = await backend.client.uploadImage({ data: ref.data, contentType: ref.mediaType, filename: `reference-${requestId}.${ref.format}` }, exec.signal)
          if (!text(uploaded?.referenceImage)) fail('IMAGE_REFERENCE_UPLOAD_INVALID')
        }
        signalCheck(exec.signal)
        const { referenceImage: _reference, ...parameters } = args
        const compiled = await backend.compileWorkflow({ ...parameters, ...(uploaded ? { referenceImage: uploaded.referenceImage } : {}), requestId })
        const workflow = workflowMetadata(compiled.metadata)
        if (workflow.requestId !== requestId || workflow.mode !== args.mode || !text(workflow.workflowId) || !/^[a-f0-9]{64}$/u.test(workflow.workflowSha256)) fail('IMAGE_WORKFLOW_INVALID')
        signalCheck(exec.signal)
        // This fsync must settle before the only generation POST can begin.
        await save({ state: 'dispatching', workflow, ...(ref ? { reference: { id: ref.id, path: ref.path, sha256: ref.sha256 } } : {}) })
        signalCheck(exec.signal)
        let submitted
        try { submitted = await backend.client.submit(compiled, { clientId: requestId, signal: exec.signal }) }
        catch (error) {
          const rejected = error?.code === 'SUBMISSION_REJECTED'
          await save({ state: rejected ? 'failed' : 'submission_unknown', errorCode: rejected ? 'IMAGE_SUBMISSION_REJECTED' : 'IMAGE_SUBMISSION_UNKNOWN' })
          throw imageError(receipt.errorCode)
        }
        if (!identity(submitted?.promptId)) { await save({ state: 'submission_unknown', errorCode: 'IMAGE_SUBMISSION_UNKNOWN' }); fail('IMAGE_SUBMISSION_UNKNOWN') }
        // Persist even if the caller cancelled after ComfyUI acknowledged the POST.
        await save({ state: 'submitted', promptId: submitted.promptId })
      } catch (error) {
        if (receipt.state === 'preparing') await save({ state: 'failed', errorCode: error?.code?.startsWith('IMAGE_') ? error.code : exec.signal.aborted ? 'IMAGE_REQUEST_CANCELLED' : 'IMAGE_BACKEND_UNAVAILABLE' })
        throw error?.code?.startsWith('IMAGE_') ? error : imageError(receipt.errorCode ?? 'IMAGE_SUBMISSION_UNKNOWN')
      }
    }
    try {
      signalCheck(exec.signal)
      const result = await backend.client.wait(receipt.promptId, { signal: exec.signal })
      signalCheck(exec.signal)
      if (result?.promptId !== receipt.promptId || result.status?.completed !== true || result.status?.status_str !== 'success'
        || result.images?.length !== 1 || result.images[0].type !== 'output') fail('IMAGE_INVALID_OUTPUT')
      const received = result.images[0], image = await imageBytes(received.data, received.contentType, 'IMAGE_INVALID_OUTPUT')
      if (image.width !== received.width || image.height !== received.height || image.sha256 === receipt.reference?.sha256) fail('IMAGE_INVALID_OUTPUT')
      const path = `${folder}/output.${image.format}`
      await durableWrite(root, path, image.data)
      await save({ state: 'completed', errorCode: undefined, output: { path, sha256: image.sha256, mediaType: image.mediaType, width: image.width, height: image.height, bytes: image.bytes } })
      return await output(receipt, exec.signal)
    } catch (error) {
      if (exec.signal.aborted) {
        if (receipt.state !== 'completed') {
          let cancellation
          try { cancellation = await backend.client.cancelQueued(receipt.promptId, { signal: AbortSignal.timeout(5000) }) }
          catch { cancellation = { promptId: receipt.promptId, cancelled: false, reason: 'unknown' } }
          await save({ cancellation: { promptId: receipt.promptId, cancelled: cancellation?.promptId === receipt.promptId && cancellation.cancelled === true,
            ...(['running', 'not-queued', 'unknown', 'completed', 'still-queued'].includes(cancellation?.reason) ? { reason: cancellation.reason } : {}) } })
        }
        throw imageError('IMAGE_REQUEST_CANCELLED')
      }
      const code = error?.code?.startsWith('IMAGE_') ? error.code : error?.code === 'TIMEOUT' ? 'IMAGE_WAIT_TIMEOUT' : error?.code === 'EXECUTION_FAILED' ? 'IMAGE_EXECUTION_FAILED'
        : error?.code === 'INVALID_OUTPUT' ? 'IMAGE_INVALID_OUTPUT' : 'IMAGE_HISTORY_UNAVAILABLE'
      if (receipt.state !== 'completed') await save({ errorCode: code, ...(['IMAGE_INVALID_OUTPUT', 'IMAGE_EXECUTION_FAILED'].includes(code) ? { state: 'failed' } : {}) })
      throw imageError(code)
    }
  }
  const definition = defineTool({
    name: 'comfyui_pic',
    description: '用固定 Flux3Klein 工作流生成或编辑一张概念图。generate 无参考图；edit 的 referenceImage 只能是本任务已核验项目图片的资产 ID 或项目路径。省略宽高沿用工作流；错误或提交未知时结束任务，不重复生成。',
    parameters: {
      mode: { type: 'string', enum: ['generate', 'edit'], required: true }, prompt: { type: 'string', required: true },
      referenceImage: { type: 'string', description: '仅 edit：当前项目登记资产 ID、来源图片 ID 或已核验项目图片路径，不能传网址、base64 或附件 ID。' },
      width: { type: 'integer', description: '仅明确要求尺寸时与 height 一起传入，16 的倍数。' }, height: { type: 'integer' }, seed: { type: 'integer' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => {
      const { attachment, ...receipt } = value
      return [{ type: 'text', text: JSON.stringify(receipt) }, { type: 'image', attachment }]
    } },
    isConcurrencySafe: () => true,
    async execute(input, exec) {
      const args = checkedArguments(input), owner = await authorize(ctx, root, sessionId, policy, exec)
      const requestId = digest(JSON.stringify([root, sessionId, owner.agentId, String(exec.callId)]))
      const inputHash = digest(JSON.stringify(args)), active = inFlight.get(requestId)
      if (active) {
        if (active.inputHash !== inputHash) fail('IMAGE_REQUEST_CONFLICT')
        return active.promise
      }
      const promise = perform(args, exec, owner, requestId, inputHash)
      inFlight.set(requestId, { inputHash, promise })
      try { return await promise } finally { if (inFlight.get(requestId)?.promise === promise) inFlight.delete(requestId) }
    },
  })
  ctx.tools.register(definition)
  return definition
}
