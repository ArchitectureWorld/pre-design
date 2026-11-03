// Offline end-to-end probe: the only model endpoint is an ephemeral local fixture.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import sharp from 'sharp'
import { ProjectWorkers } from './runtime.mjs'
import { defaultPolicy } from '../app/src/model-policy.mjs'

const root = await mkdtemp(join(resolve('.cache'), 'research-offline-probe-'))
const workspace = join(root, 'project')
await mkdir(workspace); await mkdir(join(workspace, '原始资料'))
await writeFile(join(workspace, '原始资料', '任务书.md'), '项目名称：隔离验证。任务：整理已有资料；面积、边界和业主目标均未知。')
await writeFile(join(root, 'foreign.md'), 'FOREIGN_PROJECT_SECRET_MUST_NOT_APPEAR')
let mode = 'guard', parentCalls = 0, researchCalls = 0, blocked = false
const observations = []
const endpoint = createServer(async (req, res) => {
  try {
    let body = ''; for await (const chunk of req) body += chunk
    const data = JSON.parse(body)
    observations.push({ model: data.model, maxTokens: data.max_tokens ?? data.max_completion_tokens })
    assert.equal(data.model, 'sensenova-6.8-flash-lite')
    assert.equal(data.max_tokens ?? data.max_completion_tokens, 65536)
    assert.doesNotMatch(body, /FOREIGN_PROJECT_SECRET_MUST_NOT_APPEAR/)
    if (mode === 'failure') {
      researchCalls++
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'offline-fixture-rejection', type: 'authentication_error', code: 'invalid_api_key' } }))
      return
    }
    parentCalls++
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = (delta, finish_reason) => res.write(`data: ${JSON.stringify({ id: 'offline-probe', object: 'chat.completion.chunk', created: 1, model: data.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    if (parentCalls === 1) {
      chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'probe-call', type: 'function', function: { name: 'preplanning_read_material', arguments: JSON.stringify({ path: '../foreign.md' }) } }] }, null)
      chunk({}, 'tool_calls')
    } else {
      blocked = data.messages.some(message => message.role === 'tool' && /WEB_/.test(JSON.stringify(message.content)))
      chunk({ role: 'assistant', content: '离线工具边界验证结束。' }, null)
      chunk({}, 'stop')
    }
    res.end('data: [DONE]\n\n')
  } catch { res.writeHead(500).end('{}') }
})
await new Promise(done => endpoint.listen(0, '127.0.0.1', done))
const settings = join(root, 'settings.yaml'), credentials = join(root, 'credentials.yaml')
await writeFile(settings, JSON.stringify({ 'llm-pi-ai': { providers: { 'sensenova-offline-probe': {
  api: 'openai-completions', baseURL: `http://127.0.0.1:${endpoint.address().port}/v1`, apiKeyEnv: 'credential:OFFLINE_PROBE',
} } } }), { mode: 0o600 })
await writeFile(credentials, JSON.stringify({ refs: { 'credential:OFFLINE_PROBE': 'offline-fixture-no-real-key' } }), { mode: 0o600 })
const policy = defaultPolicy(), model = policy.models.find(row => row.provider === 'SenseNova' && row.model === 'sensenova-6.8-flash-lite')
// This fixture status is local to this probe; it does not verify or save any real model.
Object.assign(model, { status: 'verified', runtimeProvider: 'sensenova-offline-probe', credentialRef: 'credential:OFFLINE_PROBE', capabilities: { text: true, tools: true, vision: true, image: false } })
const workers = new ProjectWorkers({ privateRoot: join(root, 'private'), settings, credentials, pollIntervalMs: 50 })
const project = { id: randomUUID(), session_id: `web-${randomUUID()}`, owner_id:randomUUID(), task_id:randomUUID(), workspace }
try {
  const created = await workers.call(project, { operation: 'create', name: '离线研究边界验证' })
  const catalog = await workers.call(project, { operation: 'research-plan' })
  assert.equal(catalog.catalog.modules.length, 62)
  assert.equal(catalog.plan.flags.marketing, 'unknown')
  const photo=await sharp({create:{width:12,height:8,channels:3,background:'#334455'}}).png().toBuffer()
  await writeFile(join(workspace,'原始资料','边界探针.png'),photo)
  const prepared=await workers.call(project,{operation:'chapter-prepare',chapterId:'site',message:'依据本项目已上传资料编排场地章。',feedback:'',
    assets:[{id:'fixture-photo',path:'原始资料/边界探针.png',sha256:createHash('sha256').update(photo).digest('hex'),width:12,height:8,label:'离线测试图片',sourceNote:'本机生成的边界测试图，不代表真实现场'}]})
  assert.equal(prepared.status,'configured')
  assert.equal(prepared.readiness.ready,false)
  const preflight=await workers.call(project,{operation:'report-preflight',selection:{chapterId:'site',stage:'production-plan'}})
  assert.equal(preflight.ready,false)
  assert(preflight.blockers.some(row=>row.code.startsWith('REPORT_MODULES_')))
  assert(!(preflight.blockers.some(row=>row.code==='CHAPTER_PRODUCTION_REQUEST_REQUIRED')))
  await workers.close(project.id)
  assert.equal((await workers.call(project, { operation: 'state' })).project.projectId, created.project.projectId)
  const reply = await workers.run(project, '执行离线工具边界验证。', undefined, policy, AbortSignal.timeout(45000))
  assert.equal(reply.response, '离线工具边界验证结束。')
  assert.equal(blocked, true, 'The actual DSH tool dispatch must reject the escaped material path')
  mode = 'failure'
  const result = await workers.runResearch(project, { moduleIds: ['1.01'], flags: { industryPlanning: false, existingBuildings: false, externalPartners: false, marketing: false } }, policy, undefined, AbortSignal.timeout(45000))
  if (!researchCalls) console.error(JSON.stringify({ nativeFailureBeforeTransport: result }))
  assert.ok(['partial', 'failed'].includes(result.status), `Native failure must remain failed/partial: ${result.status}`)
  assert.ok(researchCalls > 0, 'The real native module must reach the local fixture endpoint')
  assert.ok(result.modules.every(row => row.status !== 'completed'))
  const trace = await workers.executionTrace(project)
  assert.ok(trace.parent.requests.some(row => row.provider === 'sensenova-offline-probe'))
  assert.ok(trace.executions.some(row => row.actual?.provider === 'sensenova-offline-probe'))
  assert.equal(trace.usage, null)
  console.log(JSON.stringify({ probe: 'offline-only', catalog: 62, resumed: true, actualToolGuard: blocked, parentCalls, researchCalls,
    status: result.status, modules: result.modules.map(row => ({ itemId: row.itemId, status: row.status })), chapterPrepared:true, reportPreflightBlocked:true, actualModelTrace: true, modelBudgetObserved: observations.every(row => row.maxTokens === 65536) }))
} finally {
  await workers.closeAll()
  await new Promise(done => endpoint.close(done))
  await rm(root, { recursive: true, force: true })
}
