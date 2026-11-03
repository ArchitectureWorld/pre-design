import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

const adapter = await import('../../worker/comfyui-client.mjs').catch(() => ({}))
const promptId = '43d0140d-4aac-468d-850b-3f656a44ab92'
const requestId = 'flux3-fixture-request'
const png = await sharp({ create: { width: 32, height: 16, channels: 3, background: '#387955' } }).png().toBuffer()

function requireCompiler() {
  assert.equal(typeof adapter.compileFlux3Workflow, 'function', '缺少 Flux3 工作流编译器')
  return adapter.compileFlux3Workflow
}
function createClient(baseURL, options = {}) {
  assert.equal(typeof adapter.ComfyUIClient, 'function', '缺少 ComfyUI 客户端')
  return new adapter.ComfyUIClient({ baseURL, pollIntervalMs: 5, timeoutMs: 500, ...options })
}
async function fixture(t, handler) {
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const url = new URL(req.url, 'http://fixture.invalid')
    requests.push({ method: req.method, path: url.pathname, url, body, headers: req.headers })
    try {
      await handler({ req, res, body, url, requests, json(value, status = 200) {
        res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
      } })
    } catch (error) {
      res.writeHead(500).end(String(error))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  return { baseURL: `http://127.0.0.1:${server.address().port}`, requests }
}
function history(images = [{ filename: 'result.png', subfolder: 'pre-design', type: 'output' }], status = {}) {
  return { [promptId]: { prompt: [1, promptId, {}, {}, ['9']], outputs: { 9: { images } }, status: { status_str: 'success', completed: true, messages: [], ...status } } }
}

test('编译生成工作流注入当前提示词，保留 4MP 画布和扩写默认且各任务互不污染', async () => {
  const compile = requireCompiler()
  const first = await compile({ mode: 'generate', prompt: '本次任务：一张蓝色几何图', requestId, seed: 123 })
  assert.equal(first.workflow['28'].inputs.value, '本次任务：一张蓝色几何图')
  assert.equal(first.workflow['128:107'].inputs.seed, 123)
  assert.equal(first.workflow['128:101'].inputs.unet_name, 'flux3-image-klein-bf16.safetensors')
  assert.equal(first.workflow['127:116'].inputs.switch, true)
  assert.equal(first.workflow['19'].inputs.megapixels, 4)
  assert.equal(first.workflow['19'].inputs.aspect_ratio, '2:3 (Portrait Photo)')
  assert.deepEqual(first.workflow['128:106'].inputs.width, ['19', 0])
  assert.deepEqual(first.workflow['128:106'].inputs.height, ['19', 1])
  assert.equal(first.metadata.model, 'flux3-image-klein-bf16.safetensors')
  assert.equal(first.metadata.mode, 'generate')
  assert.equal(first.metadata.requestId, requestId)
  assert.match(first.metadata.workflowSha256, /^[a-f0-9]{64}$/)
  assert.match(first.metadata.workflowVersion, /\S/)
  assert.equal(first.metadata.width, undefined)
  const second = await compile({ mode: 'generate', prompt: '另一个任务', requestId: 'request-2', seed: 456 })
  assert.equal(first.workflow['28'].inputs.value, '本次任务：一张蓝色几何图')
  assert.equal(second.workflow['28'].inputs.value, '另一个任务')
  assert.notEqual(first.workflow['9'].inputs.filename_prefix, second.workflow['9'].inputs.filename_prefix)
})

test('编辑工作流使用本次上传图并保留参考图比例、4MP 与关闭扩写默认', async () => {
  const compile = requireCompiler()
  const result = await compile({ mode: 'edit', prompt: '把画面变成蓝色', referenceImage: 'pre-design/new-reference.png', requestId, seed: 7 })
  assert.equal(result.workflow['133'].inputs.image, 'pre-design/new-reference.png')
  assert.equal(result.workflow['127:116'].inputs.switch, false)
  assert.equal(result.workflow['145:138'].inputs.megapixels, 4)
  assert.equal(result.workflow['145:143'].inputs.switch, true)
  assert.deepEqual(result.workflow['128:139'].inputs.width, ['145:143', 0])
  assert.deepEqual(result.workflow['128:139'].inputs.height, ['145:144', 0])
  assert.equal(result.metadata.mode, 'edit')
})

test('只有显式尺寸才覆盖最终画布，生成和编辑均得到请求的宽高', async () => {
  const compile = requireCompiler()
  for (const mode of ['generate', 'edit']) {
    const result = await compile({ mode, prompt: '横幅构图', width: 1600, height: 896, requestId, referenceImage: mode === 'edit' ? 'reference.png' : undefined })
    const latentId = mode === 'generate' ? '128:106' : '128:139'
    assert.equal(result.workflow[latentId].inputs.width, 1600)
    assert.equal(result.workflow[latentId].inputs.height, 896)
    assert.equal(result.workflow['128:132'].inputs.width, 1600)
    assert.equal(result.workflow['128:132'].inputs.height, 896)
    assert.equal(result.metadata.width, 1600)
    assert.equal(result.metadata.height, 896)
  }
})

test('生产模板无示例用户内容，系统扩写与模型图仍完整', async () => {
  const compile = requireCompiler()
  for (const mode of ['generate', 'edit']) {
    const info = adapter.FLUX3_WORKFLOWS[mode]
    const template = JSON.parse(await readFile(new URL(`../../worker/workflows/${info.templateFile}`, import.meta.url), 'utf8'))
    assert.equal(template['28'].inputs.value, '')
    if (mode === 'edit') assert.equal(template['133'].inputs.image, '')
    assert.match(template['127:114'].inputs.value, /^You are the prompt upsampler/)
    assert.equal(template['127:112'].inputs.clip_name, 'qwen3.5_9b_flux3_prompt_upsampler_bf16.safetensors')
    const result = await compile({ mode, prompt: '新请求', referenceImage: mode === 'edit' ? 'new.png' : undefined, requestId })
    assert.equal(result.workflow['127:114'].inputs.value, template['127:114'].inputs.value)
    assert.deepEqual(Object.keys(result.workflow), Object.keys(template))
  }
})

test('空提示、无参考图、路径逃逸、非法尺寸和种子在提交前被拒绝', async () => {
  const compile = requireCompiler()
  const bad = [
    { prompt: '  ' }, { mode: 'other' }, { mode: 'edit' },
    ...['../other.png', '/tmp/other.png', 'sub/../other.png', 'other.png [output]', 'C:\\other.png', 'https://evil/a.png', '%2e%2e/other.png', 'x.svg'].map(referenceImage => ({ mode: 'edit', referenceImage })),
    { width: 1600 }, { width: 1601, height: 896 }, { width: 0, height: 896 },
    { width: 8192, height: 8192 }, { seed: -1 }, { seed: 1.5 }, { seed: Number.MAX_SAFE_INTEGER + 1 },
  ]
  for (const value of bad) await assert.rejects(compile({ mode: 'generate', prompt: '新请求', requestId, ...value }), { code: 'INVALID_INPUT' })
})

test('HTTP 流程只提交一次，等到指定历史完成后下载真实输出像素并忽略预览', async t => {
  const compile = requireCompiler()
  let polls = 0
  const server = await fixture(t, ({ url, json, res }) => {
    if (url.pathname === '/prompt') return json({ prompt_id: promptId, number: 4, node_errors: {} })
    if (url.pathname === `/history/${promptId}`) {
      if (++polls === 1) return json({})
      const result = history()
      result[promptId].outputs['113'] = { images: [{ filename: 'preview.png', subfolder: '', type: 'temp' }] }
      return json(result)
    }
    if (url.pathname === '/view') return res.writeHead(200, { 'Content-Type': 'image/png' }).end(png)
    return json({}, 404)
  })
  const client = createClient(server.baseURL, { headers: { Authorization: 'Bearer fixture-secret' } })
  const compiled = await compile({ mode: 'generate', prompt: '这次实际生成', requestId, seed: 21 })
  const submitted = await client.submit(compiled, { clientId: requestId })
  assert.equal(submitted.promptId, promptId)
  assert.equal(submitted.number, 4)
  const result = await client.wait(submitted.promptId)
  assert.equal(result.promptId, promptId)
  assert.equal(result.images.length, 1)
  assert.deepEqual(result.images[0].data, png)
  assert.equal(result.images[0].contentType, 'image/png')
  assert.equal(result.images[0].format, 'png')
  assert.equal(result.images[0].width, 32)
  assert.equal(result.images[0].height, 16)
  assert.equal(result.images[0].nodeId, '9')
  const post = server.requests.filter(row => row.method === 'POST')
  assert.equal(post.length, 1)
  const sent = JSON.parse(post[0].body)
  assert.equal(sent.client_id, requestId)
  assert.equal(sent.prompt['28'].inputs.value, '这次实际生成')
  assert.equal(sent.extra_data.pre_design.requestId, requestId)
  assert.equal(post[0].headers.authorization, 'Bearer fixture-secret')
  const view = server.requests.find(row => row.path === '/view')
  assert.equal(view.url.searchParams.get('filename'), 'result.png')
  assert.equal(view.url.searchParams.get('type'), 'output')
})

test('上传使用真实 multipart 像素且不覆盖已有图片，远端返回名用于编辑图', async t => {
  requireCompiler()
  let uploaded
  const server = await fixture(t, async ({ req, body, json, url }) => {
    if (url.pathname !== '/upload/image') return json({}, 404)
    const request = new Request('http://fixture.invalid/upload/image', { method: 'POST', headers: req.headers, body })
    uploaded = await request.formData()
    json({ name: 'reference (1).png', subfolder: uploaded.get('subfolder'), type: 'input' })
  })
  const client = createClient(server.baseURL)
  const result = await client.uploadImage({ data: png, contentType: 'image/png', filename: 'reference.png' })
  assert.equal(result.name, 'reference (1).png')
  assert.equal(result.type, 'input')
  assert.equal(result.referenceImage, `${result.subfolder}/reference (1).png`)
  assert.equal(uploaded.get('overwrite'), 'false')
  assert.equal(uploaded.get('type'), 'input')
  assert.deepEqual(Buffer.from(await uploaded.get('image').arrayBuffer()), png)
  const compiled = await adapter.compileFlux3Workflow({ mode: 'edit', prompt: '改成紫色', referenceImage: result.referenceImage, requestId })
  assert.equal(compiled.workflow['133'].inputs.image, result.referenceImage)
})

test('上传拒绝伪装扩展名、SVG、损坏图片和远端路径逃逸', async t => {
  const server = await fixture(t, ({ json }) => json({ name: '../foreign.png', subfolder: '', type: 'input' }))
  const client = createClient(server.baseURL)
  for (const input of [
    { data: png, contentType: 'image/jpeg', filename: 'x.jpg' },
    { data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), contentType: 'image/svg+xml', filename: 'x.svg' },
    { data: png.subarray(0, 32), contentType: 'image/png', filename: 'x.png' },
    { data: png, contentType: 'image/png', filename: '../x.png' },
  ]) await assert.rejects(client.uploadImage(input), { code: 'INVALID_INPUT' })
  assert.equal(server.requests.length, 0)
  await assert.rejects(client.uploadImage({ data: png, contentType: 'image/png', filename: 'x.png' }), { code: 'INVALID_RESPONSE' })
})

test('提交后连接断开只返回结果未知，绝不再次 POST /prompt', async t => {
  const compile = requireCompiler()
  const server = await fixture(t, ({ req }) => req.socket.destroy())
  const client = createClient(server.baseURL)
  await assert.rejects(client.submit(await compile({ mode: 'generate', prompt: '新任务', requestId }), { clientId: requestId }), error => {
    assert.equal(error.code, 'SUBMISSION_UNKNOWN')
    assert.equal(error.details.requestId, requestId)
    return true
  })
  assert.equal(server.requests.length, 1)
  assert.equal(server.requests[0].path, '/prompt')
})

test('缺收执的成功响应与服务器错误均为未知，不以失败名义触发重复生成', async t => {
  const compile = requireCompiler()
  for (const status of [200, 503]) {
    const server = await fixture(t, ({ json }) => json({}, status))
    const client = createClient(server.baseURL)
    await assert.rejects(client.submit(await compile({ mode: 'generate', prompt: '新任务', requestId })), { code: 'SUBMISSION_UNKNOWN' })
    assert.equal(server.requests.length, 1)
  }
})

test('Comfy 节点校验拒绝保留明确失败状态，且不重发请求', async t => {
  const compile = requireCompiler()
  const server = await fixture(t, ({ json }) => json({ error: { type: 'prompt_outputs_failed_validation', message: 'failed' }, node_errors: { '128:101': {} } }, 400))
  const client = createClient(server.baseURL)
  await assert.rejects(client.submit(await compile({ mode: 'generate', prompt: '新任务', requestId })), { code: 'SUBMISSION_REJECTED' })
  assert.equal(server.requests.length, 1)
})

test('空历史保持等待直到超时，恢复已有收执只读历史而不重新提交', async t => {
  const server = await fixture(t, ({ json }) => json({}))
  const client = createClient(server.baseURL, { timeoutMs: 40 })
  await assert.rejects(client.wait(promptId), error => {
    assert.equal(error.code, 'TIMEOUT')
    assert.equal(error.details.promptId, promptId)
    return true
  })
  assert(server.requests.length >= 1)
  assert(server.requests.every(row => row.method === 'GET' && row.path === `/history/${promptId}`))
})

test('轮询收到执行错误或已完成却没有 SaveImage 输出时不能报告成功', async t => {
  for (const [result, code] of [
    [history([], { status_str: 'error', completed: false, messages: [['execution_error', { prompt_id: promptId, node_id: '9', exception_type: 'RuntimeError' }]] }), 'EXECUTION_FAILED'],
    [history([]), 'INVALID_OUTPUT'],
  ]) {
    const server = await fixture(t, ({ json }) => json(result))
    await assert.rejects(createClient(server.baseURL).wait(promptId), { code })
    assert.equal(server.requests.length, 1)
  }
})

test('恶意输出路径、类型和伪造图片在任何资产被接受前拒绝', async t => {
  for (const output of [
    { filename: '../foreign.png', subfolder: '', type: 'output' },
    { filename: 'foreign.png', subfolder: '../../other', type: 'output' },
    { filename: '/etc/passwd', subfolder: '', type: 'output' },
    { filename: 'foreign.png [input]', subfolder: '', type: 'output' },
    { filename: 'foreign.svg', subfolder: '', type: 'output' },
    { filename: 'reference.png', subfolder: '', type: 'input' },
  ]) {
    const server = await fixture(t, ({ json }) => json(history([output])))
    await assert.rejects(createClient(server.baseURL).wait(promptId), { code: 'INVALID_OUTPUT' })
    assert.equal(server.requests.filter(row => row.path === '/view').length, 0)
  }
  for (const bytes of [Buffer.from('<html>service unavailable</html>'), png.subarray(0, 40)]) {
    const server = await fixture(t, ({ url, json, res }) => url.pathname === '/view'
      ? res.writeHead(200, { 'Content-Type': 'image/png' }).end(bytes) : json(history()))
    await assert.rejects(createClient(server.baseURL).wait(promptId), { code: 'INVALID_OUTPUT' })
  }
})

test('取消只删除本次排队项，保留另一任务且不调用 interrupt 或清空队列', async t => {
  let pending = [[2, promptId, {}, {}, ['9']], [3, 'other-task', {}, {}, ['9']]]
  const server = await fixture(t, ({ req, url, body, json, res }) => {
    if (url.pathname === `/history/${promptId}`) return json({})
    if (url.pathname === '/queue' && req.method === 'GET') return json({ queue_running: [], queue_pending: pending })
    if (url.pathname === '/queue' && req.method === 'POST') {
      const value = JSON.parse(body)
      pending = pending.filter(row => !value.delete.includes(row[1]))
      return res.writeHead(200).end()
    }
    return json({}, 404)
  })
  const result = await createClient(server.baseURL).cancelQueued(promptId)
  assert.equal(result.cancelled, true)
  assert.deepEqual(pending.map(row => row[1]), ['other-task'])
  const posts = server.requests.filter(row => row.method === 'POST')
  assert.equal(posts.length, 1)
  assert.equal(posts[0].path, '/queue')
  assert.deepEqual(JSON.parse(posts[0].body), { delete: [promptId] })
})

test('运行中任务或排队到运行的竞态不声称取消成功，不中止共享执行器', async t => {
  for (const race of [false, true]) {
    let reads = 0
    const server = await fixture(t, ({ req, json, res }) => {
      if (req.method === 'POST') return res.writeHead(200).end()
      reads++
      json({ queue_running: !race || reads > 1 ? [[1, promptId, {}, {}, ['9']]] : [], queue_pending: race && reads === 1 ? [[1, promptId, {}, {}, ['9']]] : [] })
    })
    const result = await createClient(server.baseURL).cancelQueued(promptId)
    assert.equal(result.cancelled, false)
    assert.equal(result.reason, 'running')
    assert(server.requests.every(row => row.path === '/queue'))
  }
})

test('主动取消轮询只终止本地等待，不发送任何全局取消请求', async t => {
  const controller = new AbortController()
  const server = await fixture(t, ({ json }) => { json({}); controller.abort() })
  await assert.rejects(createClient(server.baseURL).wait(promptId, { signal: controller.signal }), { code: 'ABORTED' })
  assert(server.requests.every(row => row.method === 'GET'))
})

test('探测按真实 object_info 检查两个模板的节点与模型，不把在线当作就绪', async t => {
  const compile = requireCompiler()
  const result = await compile({ mode: 'edit', prompt: '修改', referenceImage: 'ref.png', requestId })
  const objectInfo = Object.fromEntries(Object.values(result.workflow).map(node => [node.class_type, { input: { required: {} } }]))
  objectInfo.UNETLoader.input.required.unet_name = [['flux3-image-klein-bf16.safetensors'], {}]
  objectInfo.CLIPLoader.input.required.clip_name = [['qwen3.5_9b_flux3_prompt_upsampler_bf16.safetensors', 'qwen3vl_4b_bf16.safetensors'], {}]
  objectInfo.VAELoader.input.required.vae_name = [['flux2-vae.safetensors'], {}]
  const server = await fixture(t, ({ url, json }) => url.pathname === '/object_info' ? json(objectInfo) : json({}, 404))
  const client = createClient(server.baseURL)
  const first = await client.probe({ mode: 'edit' })
  assert.equal(first.ready, true)
  assert.deepEqual(first.missingNodes, [])
  assert.deepEqual(first.missingModels, [])
  delete objectInfo.LoadImage
  objectInfo.UNETLoader.input.required.unet_name = [['old-model.safetensors'], {}]
  const second = await client.probe({ mode: 'edit' })
  assert.equal(second.ready, false)
  assert(second.missingNodes.includes('LoadImage'))
  assert(second.missingModels.some(item => item.value === 'flux3-image-klein-bf16.safetensors'))
  assert(server.requests.every(row => row.method === 'GET'))
})

test('收执下返回另一任务的历史或损坏状态会明确报错，不能使用别人的输出', async t => {
  const foreign = history()
  foreign[promptId].prompt[1] = 'another-task'
  const broken = history()
  broken[promptId].status = { completed: true, status_str: 'success', messages: { some: 'invalid' } }
  for (const value of [foreign, broken, { [promptId]: 'not-a-record' }]) {
    const server = await fixture(t, ({ json }) => json(value))
    await assert.rejects(createClient(server.baseURL).wait(promptId), { code: 'INVALID_RESPONSE' })
    assert.equal(server.requests.length, 1)
  }
})

test('删除排队项期间已执行完成不能被误报为取消成功', async t => {
  let reads = 0
  const server = await fixture(t, ({ url, req, json, res }) => {
    if (req.method === 'POST') return res.writeHead(200).end()
    if (url.pathname === '/history/' + promptId) return json(history())
    json({ queue_running: [], queue_pending: ++reads === 1 ? [[1, promptId, {}, {}, ['9']]] : [] })
  })
  const result = await createClient(server.baseURL).cancelQueued(promptId)
  assert.equal(result.cancelled, false)
  assert.equal(result.reason, 'completed')
  assert(server.requests.every(row => row.path !== '/interrupt'))
})

test('JPEG 和 WebP 输出由真实像素决定格式尺寸，MIME 或扩展名不匹配必须拒绝', async t => {
  for (const [format, extension, contentType] of [['jpeg', 'jpg', 'image/jpeg'], ['webp', 'webp', 'image/webp']]) {
    const data = await sharp(png).toFormat(format).toBuffer()
    const server = await fixture(t, ({ url, json, res }) => url.pathname === '/view'
      ? res.writeHead(200, { 'Content-Type': contentType }).end(data)
      : json(history([{ filename: `result.${extension}`, subfolder: '', type: 'output' }])))
    const result = await createClient(server.baseURL).wait(promptId)
    assert.deepEqual(result.images[0].data, data)
    assert.equal(result.images[0].format, format)
    assert.equal(result.images[0].width, 32)
    assert.equal(result.images[0].height, 16)
  }
  for (const contentType of ['image/jpeg', 'image/svg+xml']) {
    const server = await fixture(t, ({ url, json, res }) => url.pathname === '/view'
      ? res.writeHead(200, { 'Content-Type': contentType }).end(png) : json(history()))
    await assert.rejects(createClient(server.baseURL).wait(promptId), { code: 'INVALID_OUTPUT' })
  }
})

test('图片下载不跟随重定向，凭据不会转交到远端返回的新地址', async t => {
  const destination = await fixture(t, ({ res }) => res.writeHead(200, { 'Content-Type': 'image/png' }).end(png))
  const server = await fixture(t, ({ url, json, res }) => url.pathname === '/view'
    ? res.writeHead(302, { Location: `${destination.baseURL}/view` }).end() : json(history()))
  await assert.rejects(createClient(server.baseURL, { headers: { Authorization: 'Bearer secret' } }).wait(promptId), { code: 'NETWORK_ERROR' })
  assert.equal(destination.requests.length, 0)
})

test('提交前已取消不会发送请求，提交中取消只能标为结果未知', async t => {
  const compile = requireCompiler()
  const firstController = new AbortController()
  const secondController = new AbortController()
  const server = await fixture(t, ({ req }) => { secondController.abort(); req.socket.destroy() })
  const client = createClient(server.baseURL)
  const compiled = await compile({ mode: 'generate', prompt: '本次请求', requestId })
  firstController.abort()
  await assert.rejects(client.submit(compiled, { signal: firstController.signal }), { code: 'ABORTED' })
  assert.equal(server.requests.length, 0)
  await assert.rejects(client.submit(compiled, { signal: secondController.signal }), { code: 'SUBMISSION_UNKNOWN' })
  assert.equal(server.requests.length, 1)
})

test('服务收到生成请求但迟迟不回应会标为未知，历史请求超时仍保留收执', async t => {
  const compile = requireCompiler()
  const server = await fixture(t, () => {})
  const client = createClient(server.baseURL, { timeoutMs: 40 })
  const compiled = await compile({ mode: 'generate', prompt: '当前任务', requestId })
  await assert.rejects(client.submit(compiled), error => {
    assert.equal(error.code, 'SUBMISSION_UNKNOWN')
    assert.equal(error.details.requestId, requestId)
    return true
  })
  await assert.rejects(client.wait(promptId), error => {
    assert.equal(error.code, 'TIMEOUT')
    assert.equal(error.details.promptId, promptId)
    return true
  })
  assert.deepEqual(server.requests.map(row => `${row.method} ${row.path}`), ['POST /prompt', `GET /history/${promptId}`])
})

test('不可达服务的只读探测明确未就绪，不调用生成端点', async t => {
  const server = await fixture(t, ({ req }) => req.socket.destroy())
  const result = await createClient(server.baseURL).probe({ mode: 'generate' })
  assert.equal(result.ready, false)
  assert.equal(result.error.code, 'NETWORK_ERROR')
  assert.deepEqual(server.requests.map(row => `${row.method} ${row.path}`), ['GET /object_info'])
})
