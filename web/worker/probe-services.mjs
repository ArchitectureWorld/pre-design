// Real Worker/DSH integration probe. All model, search and ComfyUI endpoints are local fixtures.
// The test-only control socket is installed in a disposable DSH home, never in the production bridge.
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash, randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import sharp from 'sharp'
import { ProjectWorkers } from './runtime.mjs'
import { defaultPolicy } from '../app/src/model-policy.mjs'

const repo = fileURLToPath(new URL('../../', import.meta.url))
await mkdir(join(repo, '.cache'), { recursive: true })
const root = await mkdtemp(join(repo, '.cache/service-probe-'))
const workspace = join(root, 'project')
await mkdir(join(workspace, '原始资料'), { recursive: true })
const digest = data => createHash('sha256').update(data).digest('hex')
const referencePath = '原始资料/service-probe-reference.png'
const reference = await sharp({ create: { width: 32, height: 16, channels: 3, background: '#2b5e74' } }).png().toBuffer()
const pixels = {
  generate: await sharp({ create: { width: 1024, height: 768, channels: 3, background: '#315d47' } }).png().toBuffer(),
  edit: await sharp({ create: { width: 1024, height: 768, channels: 3, background: '#67376e' } }).png().toBuffer(),
}
await writeFile(join(workspace, referencePath), reference)
const catalog = {}
for (const file of ['flux3-klein-t2i-v1.json', 'flux3-klein-i2i-v1.json']) {
  const template = JSON.parse(await readFile(new URL(`./workflows/${file}`, import.meta.url), 'utf8'))
  for (const node of Object.values(template)) catalog[node.class_type] ??= { input: { required: {} } }
}
catalog.UNETLoader.input.required.unet_name = [['flux3-image-klein-bf16.safetensors'], {}]
catalog.CLIPLoader.input.required.clip_name = [['qwen3.5_9b_flux3_prompt_upsampler_bf16.safetensors', 'qwen3vl_4b_bf16.safetensors'], {}]
catalog.VAELoader.input.required.vae_name = [['flux2-vae.safetensors'], {}]
const source = { url: 'https://example.org/service-probe-source', title: '本地协议验证来源', snippet: '这是本地 Search API fixture 返回的原始摘要。', date: '2026-11-03' }
const observations = [], submissions = new Map(), downloads = new Map(), fixtureErrors = []
let uploadedReference, activeImageMode, modelCalls = 0
const fixture = createServer(async (req, res) => {
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const bytes = Buffer.concat(chunks)
    const url = new URL(req.url, 'http://local-fixture.invalid')
    const entry = { method: req.method, path: url.pathname }
    observations.push(entry)
    const json = (value, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
    if (url.pathname === '/llm/v1/chat/completions') {
      const body = JSON.parse(bytes)
      modelCalls++
      assert.equal(body.model, 'sensenova-6.8-flash-lite')
      assert.equal(req.headers.authorization, 'Bearer service-probe-model-key')
      const toolNames = (body.tools ?? []).map(tool => tool.function?.name)
      Object.assign(entry, { model: body.model, tools: toolNames, mode: activeImageMode ?? 'parent', maxTokens: body.max_tokens ?? body.max_completion_tokens })
      await writeFile(join(root, `model-request-${modelCalls}.json`), JSON.stringify(body, null, 2))
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: `service-probe-${modelCalls}`, object: 'chat.completion.chunk', created: 1,
        model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
      const priorResult = body.messages.some(message => message.role === 'tool')
      if (activeImageMode && !priorResult) {
        assert.deepEqual(toolNames, ['comfyui_pic'])
        const args = { mode: activeImageMode, prompt: `SERVICE_PROBE_${activeImageMode.toUpperCase()} 单幅纯色抽象概念画面`, width: 1024, height: 768, seed: activeImageMode === 'generate' ? 41 : 42,
          ...(activeImageMode === 'edit' ? { referenceImage: referencePath } : {}) }
        chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `service-probe-${activeImageMode}-call`, type: 'function', function: { name: 'comfyui_pic', arguments: JSON.stringify(args) } }] })
        chunk({}, 'tool_calls')
      } else {
        if (!activeImageMode) {
          assert(!toolNames.includes('comfyui_pic'))
          assert(!toolNames.includes('web_search'))
          assert(toolNames.includes('preplanning_get_context'))
        }
        chunk({ role: 'assistant', content: activeImageMode ? '本次图像工具调用结束。' : 'SERVICE_PROBE_PARENT_OK' })
        chunk({}, 'stop')
      }
      res.end('data: [DONE]\n\n')
      return
    }
    if (url.pathname === '/api/v1/tools/search') {
      assert.equal(req.headers.authorization, 'Bearer service-probe-search-key')
      const body = JSON.parse(bytes)
      assert.deepEqual(body, { query: 'SERVICE_PROBE_SEARCH', count: 3, need_content: false })
      entry.body = body
      return json({ results: [source] })
    }
    if (url.pathname === '/comfy/object_info') return json(catalog)
    if (url.pathname === '/comfy/upload/image') {
      const form = await new Request('http://fixture.invalid/upload', { method: 'POST', headers: req.headers, body: bytes }).formData()
      const image = form.get('image')
      assert.deepEqual(Buffer.from(await image.arrayBuffer()), reference)
      assert.equal(form.get('overwrite'), 'false')
      assert.equal(form.get('type'), 'input')
      uploadedReference = `${form.get('subfolder')}/${image.name}`
      entry.uploadSha256 = digest(reference)
      return json({ name: image.name, subfolder: form.get('subfolder'), type: 'input' })
    }
    if (url.pathname === '/comfy/prompt') {
      const body = JSON.parse(bytes), mode = body.prompt['133'] ? 'edit' : 'generate'
      assert.equal(body.prompt['128:101'].inputs.unet_name, 'flux3-image-klein-bf16.safetensors')
      assert.match(body.prompt['28'].inputs.value, new RegExp(`^SERVICE_PROBE_${mode.toUpperCase()}`))
      assert.equal(body.prompt[mode === 'generate' ? '128:106' : '128:139'].inputs.width, 1024)
      assert.equal(body.prompt[mode === 'generate' ? '128:106' : '128:139'].inputs.height, 768)
      if (mode === 'edit') assert.equal(body.prompt['133'].inputs.image, uploadedReference)
      const promptId = randomUUID(), filename = `service-probe-${mode}.png`
      submissions.set(promptId, { mode, body, filename })
      downloads.set(filename, pixels[mode])
      Object.assign(entry, { mode, promptId, requestId: body.extra_data.pre_design.requestId })
      return json({ prompt_id: promptId, number: submissions.size, node_errors: {} })
    }
    if (url.pathname.startsWith('/comfy/history/')) {
      const promptId = url.pathname.slice('/comfy/history/'.length), submitted = submissions.get(promptId)
      return json(submitted ? { [promptId]: { prompt: [1, promptId, submitted.body.prompt, {}, ['9']],
        outputs: { 9: { images: [{ filename: submitted.filename, subfolder: 'service-probe', type: 'output' }] } },
        status: { completed: true, status_str: 'success', messages: [] } } } : {})
    }
    if (url.pathname === '/comfy/view') {
      const data = downloads.get(url.searchParams.get('filename'))
      assert.equal(url.searchParams.get('type'), 'output')
      assert.equal(url.searchParams.get('subfolder'), 'service-probe')
      assert(data)
      return res.writeHead(200, { 'Content-Type': 'image/png' }).end(data)
    }
    if (url.pathname === '/comfy/queue') return json({ queue_pending: [], queue_running: [] })
    throw new Error(`Unexpected fixture route: ${req.method} ${url.pathname}`)
  } catch (error) {
    fixtureErrors.push({ message: error.message, stack: error.stack })
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'service-probe-fixture-failed' }))
  }
})
await new Promise(done => fixture.listen(0, '127.0.0.1', done))
const baseURL = `http://127.0.0.1:${fixture.address().port}`
const settings = join(root, 'settings.json'), credentials = join(root, 'credentials.json')
await writeFile(settings, JSON.stringify({ 'llm-pi-ai': { providers: { 'service-probe-sensenova': {
  api: 'openai-completions', baseURL: `${baseURL}/llm/v1`, apiKeyEnv: 'credential:SERVICE_PROBE_MODEL',
} } } }), { mode: 0o600 })
await writeFile(credentials, JSON.stringify({ refs: { SERVICE_PROBE_MODEL: 'service-probe-model-key', SERVICE_PROBE_SEARCH: 'service-probe-search-key' } }), { mode: 0o600 })
const policy = defaultPolicy()
const llm = policy.models.find(row => row.provider === 'SenseNova' && row.model === 'sensenova-6.8-flash-lite')
Object.assign(llm, { status: 'verified', runtimeProvider: 'service-probe-sensenova', credentialRef: 'credential:SERVICE_PROBE_MODEL', capabilities: { text: true, tools: true, vision: true, image: false } })
const imageModel = policy.models.find(row => row.provider === 'Comfyui-PIC' && row.model === 'Klein')
imageModel.status = 'verified'
Object.assign(imageModel.imageConfig, { baseURL: `${baseURL}/comfy`, timeoutMs: 15000, pollIntervalMs: 100 })
policy.search = { enabled: true, provider: 'deepseek-search-api', baseURL: `${baseURL}/api/v1/tools`, credentialRef: 'credential:SERVICE_PROBE_SEARCH', maxResults: 3, maxQueries: 2, timeoutMs: 5000 }
const privateRoot = join(root, 'private')
const project = { id: randomUUID(), session_id: `web-${randomUUID()}`, owner_id: randomUUID(), task_id: randomUUID(), workspace }
const probeToken = randomBytes(24).toString('hex'), pluginPath = join(root, 'service-probe-plugin.mjs')
const pluginSource = `import { createServer } from 'node:http'
import { chmod, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
export const name = 'temporary-service-probe'
export const inject = ['preplanningWebBridgeReady', 'preplanning', 'agents', 'sessions', 'web']
export async function apply(ctx) {
  const events = new Map()
  ctx.on('session/event', (session, event) => {
    const id = String(session.id)
    if (!events.has(id)) events.set(id, [])
    if (['subagent/descriptor','request/header','tool/call','tool/result','turn/start','turn/end'].includes(event.type)) events.get(id).push(event)
  })
  const socket = join(dirname(process.env.PRE_WEB_SOCKET), 'service-probe.sock')
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.headers.authorization !== ${JSON.stringify(`Bearer ${probeToken}`)}) { res.writeHead(401).end('{}'); return }
    try {
      let body = ''; for await (const chunk of req) body += chunk
      const input = JSON.parse(body), parent = ctx.agents.get(process.env.PRE_WEB_SESSION_ID)
      if (!parent) throw new Error('PROBE_PARENT_MISSING')
      const projectId = ctx.preplanning.repository.readContext(String(parent.id)).project.projectId
      if (input.operation === 'search') {
        res.end(JSON.stringify(await ctx.web.search({ query: 'SERVICE_PROBE_SEARCH', maxResults: 3 }, AbortSignal.timeout(10000)))); return
      }
      if (!['generate','edit'].includes(input.operation)) throw new Error('PROBE_OPERATION_FORBIDDEN')
      const taskId = 'service-probe-' + input.operation
      const asset = await ctx.preplanning.visual.generate(parent, { taskId, projectId, chapterId: 'site', workItemId: 'site-01', kind: 'concept', required: true,
        prompt: 'SERVICE_PROBE_' + input.operation.toUpperCase() + ' 单幅抽象概念图，明确尺寸 1024×768。' + (input.operation === 'edit' ? '编辑已核验参考图。' : '独立生成。'),
        ...(input.operation === 'edit' ? { referenceAssetIds: [${JSON.stringify(referencePath)}] } : {}) }, AbortSignal.timeout(45000), { preserveUncertain: true })
      const task = ctx.preplanning.governance.readProject(projectId).visualTasks.find(row => row.taskId === taskId)
      const execution = (await ctx.preplanning.agentClasses.executions(projectId, { all: true })).find(row => row.id === task.executionId)
      // The native descriptor is a seed event and is deliberately not published on session/event.
      // Read the actual session log so ownership evidence includes its establishing descriptor.
      const child = ctx.sessions.get(String(task.childId))
      let childEvents = child?.snapshotEvents()
      if (!childEvents) {
        const handle = await ctx.get('sessionPersistence').open(String(task.childId), 'read')
        try { childEvents = (await handle.read(0)).events } finally { await handle.close() }
      }
      res.end(JSON.stringify({ asset, task, execution, events: childEvents }))
    } catch (error) {
      res.writeHead(500).end(JSON.stringify({ error: error.message, code: error.code, stack: error.stack, cause: error.cause?.message, events: Object.fromEntries(events) }))
    }
  })
  await new Promise((done, reject) => { server.once('error', reject); server.listen(socket, done) })
  await chmod(socket, 0o600)
  ctx.effect(() => async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); await unlink(socket).catch(() => {}) })
}
`
await writeFile(pluginPath, pluginSource, { mode: 0o600 })
const dshHome = join(privateRoot, project.id, 'dsh')
await mkdir(dshHome, { recursive: true, mode: 0o700 })
await writeFile(join(dshHome, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'temporary-service-probe', name: pluginPath }] }]), { mode: 0o600 })
const workers = new ProjectWorkers({ privateRoot, settings, credentials, pollIntervalMs: 50 })
const socketCall = (socketPath, body) => new Promise((done, reject) => {
  const req = request({ socketPath, path: '/', method: 'POST', headers: { authorization: `Bearer ${probeToken}`, 'Content-Type': 'application/json' }, timeout: 55000 }, res => {
    let text = ''
    res.on('data', chunk => { text += chunk })
    res.on('end', () => {
      try {
        const value = JSON.parse(text)
        if (res.statusCode !== 200) reject(Object.assign(new Error(value.error ?? 'PROBE_SOCKET_FAILURE'), { details: value }))
        else done(value)
      } catch (error) { reject(error) }
    })
  })
  req.on('error', reject); req.on('timeout', () => req.destroy(new Error('PROBE_SOCKET_TIMEOUT')))
  req.end(JSON.stringify(body))
})
try {
  console.log(JSON.stringify({ phase: 'starting-real-worker', root }))
  const report = await workers.withTask(project, policy, AbortSignal.timeout(150000), async instance => {
    const socketPath = join(instance.temp, 'service-probe.sock')
    for (let attempt = 0; !(await stat(socketPath).catch(() => undefined)); attempt++) {
      if (attempt >= 100) throw new Error('PROBE_PLUGIN_NOT_READY')
      await delay(50)
    }
    const created = await instance.rpc({ operation: 'create', name: '服务链路隔离验证' })
    const parent = await instance.session.run('SERVICE_PROBE_PARENT：回复验证标识。')
    assert.equal(parent.finalResponse, 'SERVICE_PROBE_PARENT_OK')
    assert.equal(parent.events.findLast(event => event.type === 'turn/end')?.data?.reason?.kind, 'completed')
    const callsBeforeSearch = modelCalls
    const search = await socketCall(socketPath, { operation: 'search' })
    assert.equal(modelCalls, callsBeforeSearch, '独立 Search API 不得隐式调用聊天模型')
    assert.deepEqual(search, { sources: [{ url: source.url, title: source.title, snippet: source.snippet, publishedAt: source.date }], truncated: false })
    console.log(JSON.stringify({ phase: 'parent-and-search-passed', modelCalls }))
    await instance.rpc({ operation: 'chapter-prepare', chapterId: 'site', message: '仅供隔离集成验证使用。', feedback: '', assets: [{ id: 'service-probe-reference', path: referencePath,
      sha256: digest(reference), width: 32, height: 16, label: '本地测试像素', sourceNote: '本机生成的测试文件，不是真实项目资料。' }] })
    const images = []
    for (const mode of ['generate', 'edit']) {
      activeImageMode = mode
      const result = await socketCall(socketPath, { operation: mode })
      await writeFile(join(root, `${mode}-native-result.json`), JSON.stringify(result, null, 2))
      assert.equal(result.asset.status, 'candidate')
      assert.equal(result.asset.quality.accepted, true)
      assert.equal(result.asset.provider, 'Comfyui-PIC')
      assert.equal(result.asset.model, 'Klein')
      assert.equal(result.asset.sha256, digest(pixels[mode]))
      assert.equal(result.asset.width, 1024)
      assert.equal(result.asset.height, 768)
      assert.equal(result.task.status, 'candidate_ready')
      assert.equal(result.execution.classId, 'image')
      assert.equal(result.execution.status, 'completed')
      assert.equal(result.execution.actual.provider, 'service-probe-sensenova')
      assert.equal(result.execution.actual.model, 'sensenova-6.8-flash-lite')
      assert(result.events.some(event => event.type === 'subagent/descriptor' && event.data.label.startsWith('preplanning_visual_tool_task:')))
      assert(result.events.some(event => event.type === 'tool/call' && event.data.name === 'comfyui_pic'))
      assert(result.events.some(event => event.type === 'tool/result' && event.data.message?.role === 'tool'
        && event.data.message.isError === false && event.data.message.content?.some(block => block.type === 'image')))
      assert.equal(result.events.findLast(event => event.type === 'turn/end')?.data?.reason?.kind, 'completed')
      const manifest = JSON.parse(await readFile(join(workspace, 'assets/manifest.json'), 'utf8'))
      const savedAsset = manifest.assets.find(row => row.origin?.type === 'generated_by_plugin'
        && JSON.parse(row.origin.method).visualAssetId === result.asset.assetId)
      assert(savedAsset, 'Collector 的候选图像必须进入标准项目资产清单')
      assert.equal(savedAsset.adoptionStatus, 'candidate')
      assert.equal(savedAsset.origin.sourceTool.name, 'pre-design')
      assert.equal(savedAsset.sha256, digest(pixels[mode]))
      assert.deepEqual(await readFile(join(workspace, savedAsset.relativePath)), pixels[mode])
      images.push({ mode, taskId: result.task.taskId, childId: result.task.childId, executionId: result.task.executionId, sha256: result.asset.sha256, width: result.asset.width, height: result.asset.height })
      console.log(JSON.stringify({ phase: `${mode}-native-collector-passed`, childId: result.task.childId }))
    }
    activeImageMode = undefined
    assert.equal(submissions.size, 2)
    const receipts = []
    const receiptsRoot = join(workspace, '.pre-design/image-requests/receipts')
    for (const folder of await readdir(receiptsRoot)) {
      const receipt = JSON.parse(await readFile(join(receiptsRoot, folder, 'receipt.json'), 'utf8'))
      assert.equal(receipt.state, 'completed')
      assert(submissions.has(receipt.promptId))
      assert.equal(receipt.output.sha256, digest(pixels[receipt.mode]))
      assert.equal(digest(await readFile(join(workspace, receipt.output.path))), receipt.output.sha256)
      assert.equal(receipt.workflow.model, 'flux3-image-klein-bf16.safetensors')
      receipts.push({ mode: receipt.mode, state: receipt.state, promptId: receipt.promptId, requestId: receipt.requestId, sha256: receipt.output.sha256, workflowId: receipt.workflow.workflowId })
    }
    assert.equal(receipts.length, 2)
    assert.equal(observations.filter(row => row.path === '/api/v1/tools/search').length, 1)
    assert.equal(observations.filter(row => row.path === '/comfy/upload/image').length, 1)
    assert(!observations.some(row => /interrupt|messages|clear/u.test(row.path)))
    assert.deepEqual(fixtureErrors, [])
    const audit = (await readFile(join(privateRoot, project.id, 'search-audit.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(audit.map(row => row.phase), ['started', 'succeeded'])
    assert.equal(audit[1].sourceCount, 1)
    const trace = await instance.rpc({ operation: 'execution-trace' })
    await writeFile(join(root, 'execution-trace.json'), JSON.stringify(trace, null, 2))
    return { scope: 'real-worker-and-dsh-host-with-local-http-fixtures-only', coreProjectId: created.project.projectId,
      parentToolBoundary: true, independentSearch: true, implicitSearchModelCalls: 0, imageToolRegistered: true,
      collectorVerified: true, generatedAssetCount: images.length, modelCalls, images, receipts, realComfyVerified: false, realSearchProviderVerified: false }
  }, ['parent', 'web', 'image'])
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile(join(repo, '.cache/service-probe-latest.json'), JSON.stringify({ root, ...report }, null, 2))
  console.log(JSON.stringify({ phase: 'passed', root, ...report }))
} catch (error) {
  await writeFile(join(root, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, details: error.details, fixtureErrors }, null, 2))
  console.error(JSON.stringify({ phase: 'failed', root, message: error.message, fixtureErrors }))
  throw error
} finally {
  await writeFile(join(root, 'http-observations.json'), JSON.stringify(observations, null, 2))
  await workers.closeAll()
  fixture.closeAllConnections()
  await new Promise(done => fixture.close(done))
}
