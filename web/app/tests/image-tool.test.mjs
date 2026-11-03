import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import sharp from 'sharp'
import { tsImport } from 'tsx/esm/api'

const module = await import('../../worker/image-tool.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('/worker/image-tool.mjs')) return {}
  throw error
})
const { SessionImageCollector } = await tsImport('../../../src/visual/session-image-collector.ts', import.meta.url)
const digest = data => createHash('sha256').update(data).digest('hex')
const request = { mode: 'generate', prompt: '自然材料构成的公共空间概念图，无文字。' }
const llm = { provider: 'companion', model: 'text-model' }
async function json(file, value) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value)) }
async function receipts(root) {
  const dir = join(root, '.pre-design/image-requests/receipts')
  return Promise.all((await readdir(dir).catch(error => { if (error.code === 'ENOENT') return []; throw error }))
    .filter(name => /^[a-f0-9]{64}$/u.test(name)).map(async name => ({ file: join(dir, name, 'receipt.json'), ...JSON.parse(await readFile(join(dir, name, 'receipt.json'), 'utf8')) })))
}
async function fixture(t, { root, client = {} } = {}) {
  assert.equal(typeof module.installImageTool, 'function', '应实现原生 comfyui_pic 注册入口')
  root ??= await mkdtemp(join(tmpdir(), 'image-tool-test-'))
  const ctx = new Context()
  ctx.provide('systemPrompt', { tools: () => () => {} })
  const tools = new ToolRuntime(ctx)
  const output = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#24816b' } }).png().toBuffer()
  const input = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#164266' } }).png().toBuffer()
  const events = [
    { seq: 0, type: 'subagent/descriptor', data: { version: 3, provider: 'spawn', mode: 'continuable', label: 'preplanning_visual_tool_task:project-a:task-a:1' } },
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'request/header', data: { turn: 1, step: 1, header: { config: { ...llm } } } },
    { seq: 3, type: 'tool/call', data: { turn: 1, step: 1, name: 'comfyui_pic', callId: 'call-a' } },
  ]
  const parent = { id: 'parent', session: { header: { id: 'parent', cwd: root }, snapshotEvents: () => [] } }
  const child = { id: 'child', session: { header: { id: 'child', cwd: root, origin: 'subagent', parentSession: 'parent', delegationDepth: 1 }, snapshotEvents: () => events }, options: { ...llm } }
  const agents = new Map([['parent', parent], ['child', child]])
  const execution = { id: 'execution-a', childId: 'child', parentId: 'parent', classId: 'image', projectId: 'project-a', status: 'running', selected: { provider: 'Comfyui-PIC', model: 'Klein', llm } }
  const task = { taskId: 'task-a', childId: 'child', executionId: execution.id, projectId: 'project-a', chapterId: '03', status: 'running', attempts: 1 }
  const binding = { preDesignProjectId: 'project-a', presentationProjectId: 'project_standard_a', workspaceRoot: root, directoryRoot: root, state: 'ready' }
  const policy = { snapshot: { models: [
    { provider: 'Comfyui-PIC', model: 'Klein', runtimeProvider: 'Comfyui-PIC', status: 'verified', capabilities: { image: true } },
    { ...llm, runtimeProvider: llm.provider, status: 'verified', capabilities: { text: true, tools: true } },
  ], routes: { image: { primary: { provider: 'Comfyui-PIC', model: 'Klein' }, fallbacks: [] }, imageLlm: { primary: llm, fallbacks: [] } } }, classRoutes: { image: { ...execution.selected } }, classFallbacks: { image: [] } }
  const images = new Map(), calls = []
  const attachments = {
    async saveImage({ data, mediaType }) {
      const bytes = Buffer.from(data), info = await sharp(bytes).metadata()
      const ref = { attachmentId: digest(bytes), mediaType, bytes: bytes.length, width: info.width, height: info.height }
      images.set(ref.attachmentId, { ref, data: bytes }); return ref
    },
    async readImage(ref) { assert.ok(images.has(ref.attachmentId)); return images.get(ref.attachmentId) },
  }
  ctx.provide('agents', agents)
  ctx.provide('attachments', attachments)
  ctx.provide('preplanning', {
    repository: { readContext: () => ({ project: { projectId: 'project-a' } }) },
    agentClasses: { executions: async () => [execution] },
    governance: { readProject: () => ({ visualTasks: [task] }) },
    standardProjects: { findByPreDesignProjectId: id => id === 'project-a' ? binding : undefined },
  })
  const backend = {
    compileWorkflow: async input => {
      calls.push({ op: 'compile', input })
      return { workflow: { '1': { class_type: 'SaveImage', inputs: {} } }, metadata: { workflowId: 'flux3-generate', workflowVersion: '1', workflowSha256: 'a'.repeat(64), mode: input.mode, model: 'Flux3Klein', requestId: input.requestId, seed: 123 } }
    },
    client: {
      async probe() { calls.push({ op: 'probe' }); return { ready: true, missingNodes: [], missingModels: [] } },
      async uploadImage(image) { calls.push({ op: 'upload', image }); return { name: 'reference.png', subfolder: '', type: 'input', referenceImage: 'reference.png' } },
      async submit(compiled, options) {
        calls.push({ op: 'submit', compiled, options, receipts: await receipts(root) })
        return { promptId: 'prompt-a', number: 1, metadata: compiled.metadata }
      },
      async wait(promptId) { calls.push({ op: 'wait', promptId }); return { promptId, status: { status_str: 'success', completed: true }, images: [{ data: output, contentType: 'image/png', format: 'png', width: 32, height: 32, filename: 'result.png', subfolder: '', type: 'output', nodeId: '1' }] } },
      async cancelQueued(promptId) { calls.push({ op: 'cancel', promptId }); return { promptId, cancelled: true } },
      ...client,
    },
  }
  await module.installImageTool(ctx, { workspace: root, sessionId: 'parent', policy, backend })
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const call = (args = request, options = {}) => tools.execute({ name: 'comfyui_pic', arguments: args, agent: child, callId: 'call-a', signal: new AbortController().signal, ...options })
  return { root, ctx, tools, child, parent, agents, events, execution, task, binding, policy, output, input, backend, calls, attachments, images, call }
}
function failure(result, code) { assert.equal(result.isError, true); assert.match(JSON.stringify(result), new RegExp(code)); assert.equal(result.content.some(block => block.type === 'image'), false) }
async function asset(f, patch = {}) {
  await mkdir(join(f.root, 'assets/images'), { recursive: true })
  await writeFile(join(f.root, 'assets/images/reference.png'), f.input)
  const row = { assetId: 'asset-a', mediaType: 'image', category: 'image', relativePath: 'assets/images/reference.png', mimeType: 'image/png', sha256: digest(f.input), sizeBytes: f.input.length, adoptionStatus: 'adopted', metadata: { widthPx: 32, heightPx: 32 }, ...patch }
  await json(join(f.root, 'assets/manifest.json'), { projectId: 'project_standard_a', assets: [row] })
  return row
}

test('真实 DSH ToolRuntime 返回生成像素，Collector 仅采集匹配工具收据', async t => {
  const f = await fixture(t), result = await f.call()
  assert.equal(result.isError, false, JSON.stringify(result))
  const block = result.content.find(block => block.type === 'image')
  assert.deepEqual((await f.attachments.readImage(block.attachment)).data, f.output)
  const submitted = f.calls.find(call => call.op === 'submit')
  assert.equal(submitted.receipts[0].state, 'dispatching')
  assert.equal(submitted.receipts[0].promptId, undefined)
  assert.equal(submitted.options.clientId, result.value.requestId)
  assert.equal(f.calls.find(call => call.op === 'compile').input.width, undefined)
  const ledger = (await receipts(f.root))[0]
  assert.equal(ledger.state, 'completed'); assert.equal(ledger.promptId, 'prompt-a')
  assert.equal(ledger.output.sha256, digest(f.output))
  assert.equal(JSON.stringify(result.content).includes(f.root), false)
  f.events.push({ seq: 4, type: 'tool/result', data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'call-a', isError: false, content: result.content } } },
    { seq: 5, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  const collector = new SessionImageCollector({ sessions: { get: () => ({ snapshotEvents: () => f.events }) }, attachments: f.attachments, waitForEvent: async () => {} })
  assert.deepEqual(Buffer.from((await collector.findExistingImage('child', 0)).data), f.output)
  f.events[4].data.message.toolCallId = 'foreign-call'
  assert.equal(await collector.findExistingImage('child', 0), undefined)
})

test('父会话、伪造 agent 对象、错误归属与非图像执行不能触发后端', async t => {
  for (const variant of ['parent', 'cloned-agent', 'other-root', 'loop', 'descriptor', 'project', 'class', 'execution-child', 'selected', 'companion', 'actual', 'unverified']) {
    await t.test(variant, async t => {
      const f = await fixture(t)
      let agent = f.child
      if (variant === 'parent') agent = f.parent
      if (variant === 'cloned-agent') agent = { ...f.child }
      if (variant === 'other-root') f.child.session.header.cwd = dirname(f.root)
      if (variant === 'loop') f.child.session.header.parentSession = 'child'
      if (variant === 'descriptor') f.events[0].data.label = 'preplanning_web:project-a'
      if (variant === 'project') f.execution.projectId = 'project-b'
      if (variant === 'class') f.execution.classId = 'text'
      if (variant === 'execution-child') f.execution.childId = 'other-child'
      if (variant === 'selected') f.execution.selected = { provider: 'other', model: 'image-model', llm }
      if (variant === 'companion') f.execution.selected = { ...f.execution.selected, llm: { provider: 'other', model: 'text-model' } }
      if (variant === 'actual') f.events[2].data.header.config.provider = 'other'
      if (variant === 'unverified') f.policy.snapshot.models[1].status = 'unverified'
      failure(await f.call(request, { agent }), 'IMAGE_.*FORBIDDEN')
      assert.deepEqual(f.calls, [])
    })
  }
})

test('generate/edit 参数、种子和成对尺寸在真实 schema 与执行边界校验', async t => {
  for (const args of [{ ...request, mode: 'delete' }, { ...request, prompt: ' ' }, { ...request, prompt: 'x\0y' }, { ...request, width: 1600 }, { ...request, width: 17, height: 16 }, { ...request, seed: -1 }, { ...request, referenceImage: 'asset-a' }, { ...request, mode: 'edit' }, { ...request, server: 'http://foreign/' }]) {
    const f = await fixture(t)
    assert.equal((await f.call(args)).isError, true); assert.deepEqual(f.calls, [])
  }
})

test('edit 只上传当前项目登记且哈希相符的图片，支持资产 ID 及绝对相对路径', async t => {
  for (const kind of ['assetId', 'relative', 'absolute', 'source', 'chapter']) await t.test(kind, async t => {
    const f = await fixture(t), row = await asset(f)
    let referenceImage = kind === 'absolute' ? join(f.root, row.relativePath) : kind === 'relative' ? row.relativePath : row.assetId
    if (kind === 'source') {
      await mkdir(join(f.root, 'source-materials/images'), { recursive: true }); await writeFile(join(f.root, 'source-materials/images/source.png'), f.input)
      await json(join(f.root, 'source-materials/manifest.json'), { projectId: 'project_standard_a', materials: [{ sourceMaterialId: 'source-a', category: 'image', relativePath: 'source-materials/images/source.png', mimeType: 'image/png', sizeBytes: f.input.length, sha256: digest(f.input), status: 'available' }] })
      referenceImage = 'source-a'
    }
    if (kind === 'chapter') {
      await mkdir(join(f.root, '原始资料'), { recursive: true }); await writeFile(join(f.root, '原始资料/reference.png'), f.input)
      await json(join(f.root, '.pre-design/chapter-production-assets/positioning.json'), [{ id: 'chapter-ref', path: join(f.root, '原始资料/reference.png'), sha256: digest(f.input), width: 32, height: 32 }])
      referenceImage = 'chapter-ref'
    }
    const result = await f.call({ mode: 'edit', prompt: '保留空间比例，改用自然材料。', referenceImage })
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.deepEqual(f.calls.find(row => row.op === 'upload').image.data, f.input)
    assert.equal(f.calls.find(row => row.op === 'compile').input.referenceImage, 'reference.png')
    assert.deepEqual((await f.attachments.readImage(result.value.attachment)).data, f.output)
  })
})

test('Core 与标准目录使用不同项目ID时，已绑定章节参考图仍可编辑', async t => {
  const f = await fixture(t)
  assert.notEqual(f.binding.preDesignProjectId, f.binding.presentationProjectId)
  await asset(f)
  await json(join(f.root, 'source-materials/manifest.json'), { projectId: 'project_standard_a', materials: [] })
  await mkdir(join(f.root, '原始资料'), { recursive: true })
  await writeFile(join(f.root, '原始资料/reference.png'), f.input)
  await json(join(f.root, '.pre-design/chapter-production-assets/positioning.json'), [{ id: 'chapter-ref', path: join(f.root, '原始资料/reference.png'), sha256: digest(f.input), width: 32, height: 32 }])
  const result = await f.call({ mode: 'edit', prompt: request.prompt, referenceImage: 'chapter-ref' })
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.deepEqual(f.calls.find(row => row.op === 'upload').image.data, f.input)
})

test('标准目录绑定必须属于本Core项目和本工作区且处于ready状态', async t => {
  for (const variant of ['missing', 'wrong-core', 'wrong-standard', 'wrong-workspace', 'wrong-directory', 'not-ready', 'relative-root', 'symlink-root']) await t.test(variant, async t => {
    const f = await fixture(t)
    await asset(f)
    if (variant === 'missing') f.ctx.preplanning.standardProjects.findByPreDesignProjectId = () => undefined
    if (variant === 'wrong-core') f.binding.preDesignProjectId = 'other-core'
    if (variant === 'wrong-standard') f.binding.presentationProjectId = 'other-standard'
    if (variant === 'wrong-workspace') f.binding.workspaceRoot = dirname(f.root)
    if (variant === 'wrong-directory') f.binding.directoryRoot = dirname(f.root)
    if (variant === 'not-ready') f.binding.state = 'creating'
    if (variant === 'relative-root') f.binding.workspaceRoot = '.'
    if (variant === 'symlink-root') { await symlink(f.root, join(f.root, 'root-alias')); f.binding.workspaceRoot = join(f.root, 'root-alias') }
    failure(await f.call({ mode: 'edit', prompt: request.prompt, referenceImage: 'asset-a' }), 'IMAGE_REFERENCE_')
    assert.equal(f.calls.some(row => ['upload', 'submit'].includes(row.op)), false)
  })
})

test('未登记文件、跨项目、路径穿越、符号链接、变更像素和外部图片全部拒绝', async t => {
  for (const variant of ['unregistered', 'traversal', 'absolute-outside', 'url', 'data', 'symlink', 'hash', 'manifest-project', 'quarantined', 'other-chapter']) await t.test(variant, async t => {
    const f = await fixture(t), row = await asset(f)
    let referenceImage = 'asset-a'
    if (variant === 'unregistered') { await writeFile(join(f.root, 'secret.png'), f.input); referenceImage = 'secret.png' }
    if (variant === 'traversal') referenceImage = '../outside.png'
    if (variant === 'absolute-outside') referenceImage = '/etc/passwd'
    if (variant === 'url') referenceImage = 'https://example.com/a.png'
    if (variant === 'data') referenceImage = 'data:image/png;base64,' + f.input.toString('base64')
    if (variant === 'symlink') { await rm(join(f.root, row.relativePath)); await symlink('/etc/passwd', join(f.root, row.relativePath)) }
    if (variant === 'hash') await writeFile(join(f.root, row.relativePath), f.output)
    if (variant === 'manifest-project') await json(join(f.root, 'assets/manifest.json'), { projectId: 'project-b', assets: [row] })
    if (variant === 'quarantined') await asset(f, { adoptionStatus: 'retired' })
    if (variant === 'other-chapter') { await json(join(f.root, '.pre-design/chapter-production-assets/04.json'), [{ id: 'chapter-ref', path: join(f.root, row.relativePath), sha256: digest(f.input), width: 32, height: 32 }]); referenceImage = 'chapter-ref' }
    failure(await f.call({ mode: 'edit', prompt: request.prompt, referenceImage }), 'IMAGE_REFERENCE_')
    assert.equal(f.calls.some(row => ['upload', 'submit'].includes(row.op)), false)
  })
})

test('网络未知提交保存未知状态，同一请求恢复不再次 POST 或伪装输出', async t => {
  let posts = 0
  const f = await fixture(t, { client: { async submit() { posts++; throw Object.assign(new Error('private backend address'), { code: 'SUBMISSION_UNKNOWN' }) } } })
  failure(await f.call(), 'IMAGE_SUBMISSION_UNKNOWN')
  failure(await f.call(), 'IMAGE_SUBMISSION_UNKNOWN')
  const second = await fixture(t, { root: f.root, client: f.backend.client })
  failure(await second.call(), 'IMAGE_SUBMISSION_UNKNOWN')
  assert.equal(posts, 1)
  assert.equal((await receipts(f.root))[0].state, 'submission_unknown')
})

test('已有 promptId 在超时后只读恢复；已完成结果由持久像素恢复', async t => {
  const f = await fixture(t), originalWait = f.backend.client.wait
  f.backend.client.wait = async () => { throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' }) }
  failure(await f.call(), 'IMAGE_.*TIMEOUT')
  assert.equal((await receipts(f.root))[0].promptId, 'prompt-a')
  f.backend.client.wait = originalWait
  const second = await fixture(t, { root: f.root, client: f.backend.client })
  assert.equal((await second.call()).isError, false)
  assert.equal(f.calls.filter(row => row.op === 'submit').length, 1)
  f.backend.client.wait = async () => { throw new Error('completed outputs must not need network') }
  const third = await fixture(t, { root: f.root, client: f.backend.client })
  assert.equal((await third.call()).isError, false)
  assert.equal(third.calls.some(row => ['probe', 'compile', 'upload', 'submit'].includes(row.op)), false)
})

test('并发相同调用只生成一次，同一子任务换 callId 也不能隐式重复生成', async t => {
  const f = await fixture(t)
  const [one, two] = await Promise.all([f.call(), f.call()])
  assert.equal(one.isError, false); assert.equal(two.isError, false)
  assert.equal(f.calls.filter(row => row.op === 'submit').length, 1)
  assert.equal(one.value.requestId, two.value.requestId)
  f.events[3].data.callId = 'call-b'
  failure(await f.call(request, { callId: 'call-b' }), 'IMAGE_REQUEST_ALREADY_EXISTS')
  assert.equal(f.calls.filter(row => row.op === 'submit').length, 1)
})

test('同一稳定请求ID参数变化不能复用或再次生成', async t => {
  const f = await fixture(t)
  assert.equal((await f.call()).isError, false)
  failure(await f.call({ ...request, prompt: 'different request' }), 'IMAGE_REQUEST_CONFLICT')
  assert.equal(f.calls.filter(row => row.op === 'submit').length, 1)
})

test('崩溃留下 dispatching 收据时禁止重发', async t => {
  const f = await fixture(t)
  assert.equal((await f.call()).isError, false)
  const receipt = (await receipts(f.root))[0], { file, promptId: _promptId, output: _output, ...row } = receipt
  await json(file, { ...row, state: 'dispatching' })
  const restored = await fixture(t, { root: f.root, client: f.backend.client })
  failure(await restored.call(), 'IMAGE_SUBMISSION_UNKNOWN')
  assert.equal(f.calls.filter(row => row.op === 'submit').length, 1)
})

test('取消只删除本请求队列项，保留 promptId 收据且不影响其他任务', async t => {
  const f = await fixture(t), controller = new AbortController()
  f.backend.client.wait = async (_promptId, { signal }) => {
    controller.abort(new Error('user cancelled'))
    signal.throwIfAborted()
  }
  assert.equal((await f.call(request, { signal: controller.signal })).isError, true)
  assert.deepEqual(f.calls.filter(row => row.op === 'cancel').map(row => row.promptId), ['prompt-a'])
  const receipt = (await receipts(f.root))[0]
  assert.equal(receipt.promptId, 'prompt-a'); assert.equal(receipt.cancellation.cancelled, true)
  failure(await f.call(), 'IMAGE_REQUEST_CANCELLED')
  assert.equal(f.calls.filter(row => row.op === 'submit').length, 1)
})

test('伪图片、参考像素冒充、错误 promptId 和多图都不得进入 tool/result 图片块', async t => {
  for (const variant of ['invalid', 'reference', 'wrong-prompt', 'multiple']) await t.test(variant, async t => {
    const f = await fixture(t), row = await asset(f)
    const generated = { data: variant === 'invalid' ? Buffer.from('not an image') : variant === 'reference' ? f.input : f.output, contentType: 'image/png', width: 32, height: 32, type: 'output', nodeId: '1' }
    f.backend.client.wait = async () => ({ promptId: variant === 'wrong-prompt' ? 'other-prompt' : 'prompt-a', status: { status_str: 'success', completed: true }, images: variant === 'multiple' ? [generated, generated] : [generated] })
    const result = await f.call({ mode: 'edit', prompt: request.prompt, referenceImage: row.assetId })
    failure(result, 'IMAGE_.*OUTPUT')
    assert.equal(f.images.size, 0)
  })
})

test('已完成输出文件篡改后不再生成且不能被当作已核验结果', async t => {
  const f = await fixture(t)
  assert.equal((await f.call()).isError, false)
  const row = (await receipts(f.root))[0]
  await writeFile(join(f.root, row.output.path), f.input)
  failure(await f.call(), 'IMAGE_OUTPUT_CHANGED')
  assert.equal(f.calls.filter(row => row.op === 'submit').length, 1)
})

function nextAttempt(f) {
  f.agents.delete('child'); f.child.id = 'child-b'; f.child.session.header.id = 'child-b'; f.agents.set('child-b', f.child)
  f.execution.childId = 'child-b'; f.execution.id = 'execution-b'
  f.task.childId = 'child-b'; f.task.executionId = 'execution-b'; f.task.attempts = 2
  f.events[0].data.label = 'preplanning_visual_tool_task:project-a:task-a:2'
}

test('同一视觉 task 重建 child 时，未知/未终结/已成功请求都阻止再次 POST', async t => {
  for (const state of ['unknown', 'waiting', 'completed']) await t.test(state, async t => {
    const f = await fixture(t)
    if (state === 'unknown') f.backend.client.submit = async () => { f.calls.push({ op: 'submit' }); throw Object.assign(new Error('unknown'), { code: 'SUBMISSION_UNKNOWN' }) }
    if (state === 'waiting') f.backend.client.wait = async () => { throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' }) }
    await f.call()
    const second = await fixture(t, { root: f.root, client: f.backend.client })
    nextAttempt(second)
    failure(await second.call(), 'IMAGE_TASK_REQUIRES_RECOVERY')
    assert.equal(f.calls.filter(row => row.op === 'submit').length, 1)
  })
})

test('明确未执行的提交拒绝允许 Core 后续新 attempt，旧请求不会被重新提交', async t => {
  const f = await fixture(t), submit = f.backend.client.submit
  f.backend.client.submit = async () => { f.calls.push({ op: 'submit-rejected' }); throw Object.assign(new Error('validation rejected'), { code: 'SUBMISSION_REJECTED' }) }
  failure(await f.call(), 'IMAGE_SUBMISSION_REJECTED')
  const second = await fixture(t, { root: f.root, client: { ...f.backend.client, submit } })
  nextAttempt(second)
  assert.equal((await second.call()).isError, false)
  failure(await f.call(), 'IMAGE_SUBMISSION_REJECTED')
  assert.equal(f.calls.filter(row => row.op === 'submit-rejected').length, 1)
  assert.equal(f.calls.filter(row => row.op === 'submit').length, 1)
})

test('真实 ComfyUIClient 经本地 HTTP 服务返回的图片进入原生工具内容', async t => {
  const { ComfyUIClient, compileFlux3Workflow } = await import('../../worker/comfyui-client.mjs')
  for (const mode of ['generate', 'edit']) await t.test(mode, async t => {
    const f = await fixture(t), requests = [], graph = (await compileFlux3Workflow({ mode, prompt: request.prompt, ...(mode === 'edit' ? { referenceImage: 'reference.png' } : {}) })).workflow
    const catalog = {}
    for (const node of Object.values(graph)) {
      const required = {}
      for (const input of ['unet_name', 'clip_name', 'vae_name']) if (node.inputs[input] !== undefined) required[input] = [[...new Set([...(catalog[node.class_type]?.input?.required?.[input]?.[0] ?? []), node.inputs[input]])]]
      catalog[node.class_type] = { input: { required: { ...catalog[node.class_type]?.input?.required, ...required } } }
    }
    const server = createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk
      const url = new URL(req.url, 'http://test.local'); requests.push({ path: url.pathname, method: req.method, body })
      const send = value => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
      if (url.pathname === '/object_info') return send(catalog)
      if (url.pathname === '/upload/image') return send({ name: 'reference.png', subfolder: 'pre-design', type: 'input' })
      if (url.pathname === '/prompt') return send({ prompt_id: 'native-prompt', number: 1 })
      if (url.pathname === '/history/native-prompt') return send({ 'native-prompt': { status: { status_str: 'success', completed: true, messages: [] }, outputs: { 9: { images: [{ filename: 'output.png', subfolder: 'pre-design', type: 'output' }] } } } })
      if (url.pathname === '/view') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(f.output) }
      res.writeHead(404).end()
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
    f.backend.client = new ComfyUIClient({ baseURL: `http://127.0.0.1:${server.address().port}`, pollIntervalMs: 5, timeoutMs: 1000 })
    f.backend.compileWorkflow = compileFlux3Workflow
    if (mode === 'edit') await asset(f)
    const result = await f.call({ ...request, mode, ...(mode === 'edit' ? { referenceImage: 'asset-a' } : {}) })
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.deepEqual((await f.attachments.readImage(result.value.attachment)).data, f.output)
    const posted = JSON.parse(requests.find(row => row.path === '/prompt').body)
    assert.equal(posted.prompt['28'].inputs.value, request.prompt)
    assert.equal(posted.extra_data.pre_design.requestId, result.value.requestId)
    assert.equal(requests.filter(row => row.path === '/prompt').length, 1)
    assert.equal(requests.some(row => row.path === '/interrupt'), false)
  })
})
