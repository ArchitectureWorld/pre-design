import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { createApp } from '../src/server.mjs'
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
const app = await createApp({ db, workers, projectsRoot: root, users: [{ id: 'alice', token: 'a'.repeat(40) }, { id: 'bob', token: 'b'.repeat(40) }] })
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
