import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { createApp } from '../src/server.mjs'
import { createPlatformStore } from '../src/platform-store.mjs'
import {confirmedOutlineFixture} from './fixtures/outline.mjs'
const root = await mkdtemp(join(tmpdir(), 'pre-web-test-'))
const pool = new pg.Pool({ host: '/tmp/pre-design-pg-1000', port: 55439, database: 'pre_design_web', user: 'zetta' })
const schema = `test_${Date.now()}`
await pool.query(`CREATE SCHEMA ${schema}`)
const db = new pg.Pool({ host: '/tmp/pre-design-pg-1000', port: 55439, database: 'pre_design_web', user: 'zetta', options: `-c search_path=${schema}` })
const contexts = new Map()
let runs = 0
const prompts = []
const workers = { async call(p, body) {
  if (body.operation === 'create') contexts.set(p.id, { project: { projectId: p.id, name: p.name, currentRevision: 0 }, stateObjects: [], proposals: [], revisions: [] })
  const context = contexts.get(p.id)
  if (body.operation === 'confirm') { context.project.currentRevision++; context.proposals[0].status = 'confirmed' }
  return structuredClone(context)
}, async run(p, text) { prompts.push(text); runs++; if (runs > 1) contexts.get(p.id).proposals.push({ proposalId: 'revision-proposal', status: 'pending_review' }); return { response: '真实模型的测试替身，非生产成果', eventCount: 2 } }, async closeAll() {} }
const accounts = [{ id: 'alice', token: 'a'.repeat(40) }, { id: 'bob', token: 'b'.repeat(40) }, { id: 'test-admin', role: 'admin', token: 'z'.repeat(40) }]
const policies = await createPlatformStore(db, accounts), configured = await policies.getPolicy()
const model = configured.models.find(m => m.provider === 'SenseNova' && m.model === 'sensenova-6.8-flash-lite')
model.status = 'verified'; model.capabilities.tools = true
await policies.savePolicy(configured, configured.revision, 'test-admin')
const app = await createApp({ db, workers, projectsRoot: root, users: accounts })
const headers = { authorization: `Bearer ${'a'.repeat(40)}` }
const post = (url, payload, more = {}) => app.inject({ method: 'POST', url, headers: { ...headers, ...more }, payload })
after(async () => { await app.close(); await db.end(); await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); await rm(root, { recursive: true, force: true }) })
test('requires identity, creates one isolated project, rejects payload reuse and cross-user access', async () => {
  assert.equal((await app.inject('/api/projects')).statusCode, 401)
  const body = { requestId: 'create-1', name: '测试项目' }
  const first = await post('/api/projects', body); assert.equal(first.statusCode, 200, first.body)
  const p = first.json()
  assert.equal((await post('/api/projects', body)).json().id, p.id)
  assert.equal((await post('/api/projects', { ...body, name: '更名' })).statusCode, 409)
  assert.equal((await app.inject({ url: `/api/projects/${p.id}/state`, headers: { authorization: `Bearer ${'b'.repeat(40)}` } })).statusCode, 404)
  assert.equal((await post(`/api/projects/${p.id}/materials`, { requestId: 'upload-1', baseRevision: 0, filename: '../escape.txt', content: 'eA==' })).statusCode, 400)
  const file = await post(`/api/projects/${p.id}/materials`, { requestId: 'upload-2', baseRevision: 0, filename: '任务书.txt', content: Buffer.from('实际资料').toString('base64') })
  assert.equal(file.statusCode, 200, file.body)
  assert.equal(file.json().sha256.length, 64)
  await confirmedOutlineFixture(db,p.id)
  const task = { requestId: 'task-1', baseRevision: 0, text: '解读资料' }
  const [a, b] = await Promise.all([post(`/api/projects/${p.id}/chat`, task), post(`/api/projects/${p.id}/chat`, task)])
  assert.equal(a.json().id, b.json().id)
  await app.waitForJobs()
  assert.equal(runs, 1)
  assert.match(prompts[0], /asset_id/)
  assert.match(prompts[0], new RegExp(file.json().sha256))
  const issuedAt=/服务器任务时间（UTC）：([^\n]+)/.exec(prompts[0])?.[1]
  assert.ok(issuedAt && Math.abs(Date.now()-Date.parse(issuedAt))<60000, 'model receives current server time instead of guessing metadata dates')
  assert.equal((await post(`/api/projects/${p.id}/chat`, { ...task, requestId: 'stale', baseRevision: 99 })).statusCode, 409)
  const annotation = await post(`/api/projects/${p.id}/annotations`, { requestId: 'note-1', baseRevision: 0, anchor: 'PS01', text: '请补充资料来源' })
  assert.equal(annotation.statusCode, 200, annotation.body)
  assert.equal(runs, 1, 'saving annotation must not run Agent')
  const edited = await post(`/api/projects/${p.id}/annotations/${annotation.json().id}/edit`, { requestId: 'edit-1', baseRevision: 0, text: '请补充可定位的资料来源' })
  assert.equal(edited.statusCode, 200, edited.body)
  const discard = await post(`/api/projects/${p.id}/annotations`, { requestId: 'discard-1', baseRevision: 0, anchor: 'PS01', text: '临时意见' })
  assert.equal((await post(`/api/projects/${p.id}/annotations/${discard.json().id}/delete`, { requestId: 'delete-1', baseRevision: 0 })).statusCode, 200)
  const batch = await post(`/api/projects/${p.id}/annotations/batch-submit`, { requestId: 'batch-1', baseRevision: 0, annotationIds: [annotation.json().id] })
  assert.equal(batch.statusCode, 200, batch.body)
  await app.waitForJobs()
  assert.equal(runs, 2)
  const state = (await app.inject({ url: `/api/projects/${p.id}/state`, headers })).json()
  assert.equal(state.annotations[0].status, 'awaiting_review')
  assert.equal(state.jobs.length, 2)
  // Simulate Core commit followed by loss of the API snapshot write.
  contexts.get(p.id).project.currentRevision = 1
  contexts.get(p.id).proposals[0].status = 'confirmed'
  const crashJob = '93e88f75-2200-4fae-b8b6-7af08f3473a6'
  await db.query("INSERT INTO jobs(id,project_id,request_id,fingerprint,kind,payload,status) VALUES($1,$2,'crash-confirm','receipt','confirm',$3,'interrupted')", [crashJob,p.id,{baseRevision:0,proposalId:'revision-proposal'}])
  await db.query("UPDATE annotations SET status='submitted' WHERE id=$1", [annotation.json().id])
  const recovered = (await app.inject({ url: `/api/projects/${p.id}/state`, headers })).json()
  assert.equal(recovered.revision, 1)
  assert.equal(recovered.annotations[0].status, 'completed')
  assert.equal(recovered.jobs.find(j=>j.id===crashJob).status, 'completed')
  assert.equal((await post(`/api/projects/${p.id}/materials`, { requestId: 'upload-2', baseRevision: 0, filename: '任务书.txt', content: Buffer.from('实际资料').toString('base64') })).json().id, file.json().id)
})
test('binary folder upload filters new CAD and preserves legacy CAD and other files, retains paths, checks ownership and idempotency',async()=>{
 const p=(await post('/api/projects',{requestId:'folder-project',name:'目录上传测试'})).json()
 const data=Buffer.concat([Buffer.from('AC1032'),Buffer.alloc(17*1024*1024,7)])
 const upload=(name,path,id,bytes=data,extra={})=>app.inject({method:'POST',url:`/api/projects/${p.id}/materials?`+new URLSearchParams({filename:name,relativePath:path,requestId:id,baseRevision:'0'}),headers:{...headers,'content-type':'application/octet-stream',...extra},payload:bytes})
 const denied=await upload('原图.DWG','资料/原图.DWG','cad-block');assert.equal(denied.statusCode,415);assert.equal(denied.json().code,'MATERIAL_CAD_CONVERSION_REQUIRED');assert.match(denied.json().error,/PDF/)
 const legacyDenied=await post(`/api/projects/${p.id}/materials`,{requestId:'cad-json',baseRevision:0,filename:'图纸.dxf',content:'eA=='});assert.equal(legacyDenied.statusCode,415)
 const a=await upload('平面.bin','资料/建筑/平面.bin','folder-a');assert.equal(a.statusCode,200,a.body)
 const b=await upload('平面.bin','资料/结构/平面.bin','folder-b');assert.equal(b.statusCode,200,b.body);assert.notEqual(a.json().id,b.json().id)
 assert.equal((await upload('平面.bin','资料/建筑/平面.bin','folder-a')).json().id,a.json().id)
 assert.equal((await upload('平面.bin','资料/建筑/平面.bin','folder-a',Buffer.from('changed'))).statusCode,409)
 assert.equal((await upload('x.dwg','../x.dwg','escape')).statusCode,400)
 assert.equal((await upload('x.dwg','x.dwg','cross',Buffer.from('x'),{authorization:`Bearer ${'b'.repeat(40)}`})).statusCode,404)
 const empty=await upload('README','资料/README','empty',Buffer.alloc(0));assert.equal(empty.statusCode,200,empty.body)
 const odd=await upload('专业模型.rvt','资料/专业模型.rvt','rvt',Buffer.from([0,255,1]));assert.equal(odd.statusCode,200,odd.body)
 await db.query("UPDATE materials SET filename='历史原件.dwg',relative_path='资料/历史原件.dwg' WHERE id=$1",[a.json().id])
 const download=await app.inject({url:`/api/projects/${p.id}/materials/${a.json().id}`,headers});assert.equal(download.statusCode,200);assert.deepEqual(download.rawPayload,data);assert.match(download.headers['content-disposition'],/^attachment/)
 const state=(await app.inject({url:`/api/projects/${p.id}/state`,headers})).json();assert.equal(state.materials.length,4);assert.equal(state.materials.find(m=>m.id===a.json().id).relativePath,'资料/历史原件.dwg');assert.equal(state.materials.find(m=>m.id===a.json().id).processing.status,'conversion_required')
})
