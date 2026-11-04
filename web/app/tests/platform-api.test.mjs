import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pg from 'pg'
import sharp from 'sharp'
import { createApp } from '../src/server.mjs'
import {confirmedOutlineFixture} from './fixtures/outline.mjs'

const connection = { host: '/tmp/pre-design-pg-1000', port: 55439, database: 'pre_design_web', user: 'zetta' }
const users = [{ id: 'admin', role: 'admin', token: 'm'.repeat(40) }, { id: 'alice', role: 'user', token: 'a'.repeat(40) }, { id: 'bob', role: 'user', token: 'b'.repeat(40) }]
async function fixture(t, options = {}) {
  const schema = `platform_${randomUUID().replaceAll('-', '')}`
  const pool = new pg.Pool(connection)
  await pool.query(`CREATE SCHEMA ${schema}`)
  const db = new pg.Pool({ ...connection, options: `-c search_path=${schema}` })
  const root = await mkdtemp(join(tmpdir(), 'pre-platform-'))
  const contexts = new Map(), runs = [], held = new Map(), traceHolds = [], preparations = []
  const workers = {
    async call(p, body) {
      if (body.operation === 'create') contexts.set(p.id, { project: { projectId: p.id, name: p.name, currentRevision: 0 }, stateObjects: [], proposals: [], revisions: [] })
      if (body.operation === 'research-plan') return { catalog: { chapters: [], modules: [{ id: '1.01', title: '项目基本情况' }] }, plan: { activeModuleIds: ['1.01'], pendingModuleIds: [], blockedModuleIds: [] } }
      if (body.operation === 'research-status') return { status: 'idle', modules: [] }
      if (body.operation === 'chapter-prepare') { preparations.push({ project: p.id, ...body }); return { status: 'configured', chapterId: body.chapterId, readiness: { status: 'ready', blockers: [] } } }
      if (body.operation === 'report-preflight') return { ready: preparations.some(row => row.project === p.id && row.chapterId === body.selection.chapterId), blockers: [{ code: 'CHAPTER_REQUEST_REQUIRED', message: '请先保存本章要求和真实图片资料。' }] }
      if (body.operation === 'report-status') return { status: 'idle', chapters: [] }
      return structuredClone(contexts.get(p.id))
    },
    async run(p, text, _onEvent, snapshot) {
      runs.push({ project: p.id, text, snapshot: structuredClone(snapshot) })
      if (options.hold) await new Promise((resolve, reject) => held.set(p.id, { resolve, reject }))
      return { response: '测试中的外部模型响应', eventCount: 1 }
    },
    async runResearch(p, selection, snapshot) { runs.push({ project: p.id, selection, snapshot }); return { status: 'partial', selectedModuleIds: selection.moduleIds, modules: [], limitations: ['需要补充项目资料'] } },
    async runReport(p, selection, snapshot) { runs.push({ project: p.id, selection, snapshot }); return { status: selection.mode === 'research-summary' ? 'unreviewed' : 'completed', chapterId: selection.chapterId } },
    async executionTrace() { if (options.holdTrace) await new Promise(resolve => traceHolds.push(resolve)); return { parent: { status: 'recorded', requests: [{ provider: 'SenseNova', model: 'sensenova-6.8-flash-lite', evidence: 'request/header', usage: null }] }, executions: [], usage: null } },
    async close(id) { held.get(id)?.reject(new Error('WORKER_CANCELLED')); held.delete(id) },
    async closeAll() { for (const id of held.keys()) await this.close(id) },
  }
  let app = await createApp({ db, workers, projectsRoot: root, users })
  t.after(async () => { for (const release of traceHolds) release(); await app.close(); await db.end(); await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); await rm(root, { recursive: true, force: true }) })
  const request = (user, method, url, payload) => app.inject({ method, url, headers: { authorization: `Bearer ${users.find(u => u.id === user).token}` }, ...(payload === undefined ? {} : { payload }) })
  const create = async (owner = 'alice') => { const r = await request(owner, 'POST', '/api/projects', { requestId: randomUUID(), name: '研究项目' }); assert.equal(r.statusCode, 200, r.body); await confirmedOutlineFixture(db,r.json().id); return r.json() }
  const configure = async (change = () => {}) => {
    const r = await request('admin', 'GET', '/api/admin/models'); assert.equal(r.statusCode, 200, r.body)
    const policy = r.json(), selected = policy.models.find(m => m.provider === 'SenseNova' && m.model === 'sensenova-6.8-flash-lite')
    selected.status = 'verified'; selected.capabilities = { text: true, tools: true, vision: true, image: false }
    for (const role of ['parent', 'text', 'web', 'vision', 'imageLlm']) policy.routes[role] = { primary: { provider: selected.provider, model: selected.model }, fallbacks: [] }
    change(policy)
    const saved = await request('admin', 'PUT', '/api/admin/models', { expectedRevision: policy.revision, policy })
    assert.equal(saved.statusCode, 200, saved.body); return saved.json()
  }
  return { get app() { return app }, db, request, create, configure, runs, held, traceHolds, preparations,
    async restart() { await app.close(); app = await createApp({ db, workers, projectsRoot: root, users }) },
  }
}
async function until(predicate) { const end = Date.now() + 5000; while (!predicate()) { if (Date.now() > end) throw new Error('Condition timed out'); await new Promise(r => setTimeout(r, 10)) } }

test('administrator model policy is server-authorized and ordinary identity has no model configuration', async t => {
  const { app, request } = await fixture(t)
  assert.equal((await app.inject('/api/me')).statusCode, 401)
  const me = await request('alice', 'GET', '/api/me'); assert.equal(me.statusCode, 200); assert.deepEqual(me.json(), { id: 'alice', role: 'user' })
  assert.equal((await request('alice', 'GET', '/api/admin/models')).statusCode, 403)
  assert.equal((await request('alice', 'PUT', '/api/admin/models', { role: 'admin', expectedRevision: 0, policy: {} })).statusCode, 403)
  const policy = await request('admin', 'GET', '/api/admin/models')
  assert.equal(policy.statusCode, 200, policy.body); assert.equal(policy.json().models.length, 15)
})

test('business endpoints reject policy override fields and unverified models cannot enqueue paid work', async t => {
  const { request, create, db } = await fixture(t); const p = await create()
  for (const key of ['model', 'provider', 'fallbacks', 'reasoningEffort', 'role']) {
    const r = await request('alice', 'POST', `/api/projects/${p.id}/chat`, { requestId: randomUUID(), baseRevision: 0, text: '分析资料', [key]: 'override' })
    assert.equal(r.statusCode, 400, `${key}: ${r.body}`)
  }
  const r = await request('alice', 'POST', `/api/projects/${p.id}/chat`, { requestId: randomUUID(), baseRevision: 0, text: '分析资料' })
  assert.equal(r.statusCode, 503, r.body)
  assert.equal((await db.query('SELECT count(*)::int AS count FROM jobs')).rows[0].count, 0)
})

test('unresolved research conditions are rejected before reserving a job or daily quota', async t => {
  const { request, create, configure, db, runs } = await fixture(t)
  await configure(); const p = await create()
  for (const flags of [{}, { industryPlanning: false, existingBuildings: 'unknown', externalPartners: false, marketing: false }]) {
    const r = await request('alice', 'POST', `/api/projects/${p.id}/research`, { requestId: randomUUID(), baseRevision: 0, moduleIds: ['1.01'], flags })
    assert.equal(r.statusCode, 400, r.body)
    assert.match(r.json().error, /四项.*条件/)
  }
  assert.equal((await db.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n, 0)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM job_reservations')).rows[0].n, 0)
  assert.equal(runs.length, 0)
  assert.equal((await request('alice', 'POST', `/api/projects/${p.id}/research/plan`, { moduleIds: ['1.01'], flags: {} })).statusCode, 200)
})

test('chapter preparation binds genuine uploaded images to the owned project and is idempotent', async t => {
  const { request, create, db, preparations } = await fixture(t), p = await create()
  const png = await sharp({ create: { width: 20, height: 12, channels: 3, background: '#294352' } }).png().toBuffer()
  const upload = async (filename, data = png) => request('alice', 'POST', `/api/projects/${p.id}/materials`, { requestId: randomUUID(), baseRevision: 0, filename, content: data.toString('base64') })
  assert.equal((await upload('伪装.jpg')).statusCode, 400)
  assert.equal((await upload('损坏.png', Buffer.from('not an image'))).statusCode, 400)
  const image = await upload('现场.png'); assert.equal(image.statusCode, 200, image.body)
  const body = { requestId: 'prepare-chapter', baseRevision: 0, chapterId: 'site', message: '请依据本项目研究，制作面向业主的场地章节。', feedback: '保留资料缺口，不推断已获审批。', materialIds: [image.json().id] }
  assert.equal((await request('bob', 'POST', `/api/projects/${p.id}/chapters/prepare`, body)).statusCode, 404)
  assert.equal((await request('alice', 'POST', `/api/projects/${p.id}/chapters/prepare`, { ...body, path: '/etc/passwd' })).statusCode, 400)
  const other = await create('alice')
  assert.equal((await request('alice', 'POST', `/api/projects/${other.id}/chapters/prepare`, body)).statusCode, 400)
  const saved = await request('alice', 'POST', `/api/projects/${p.id}/chapters/prepare`, body)
  assert.equal(saved.statusCode, 200, saved.body); assert.equal(saved.json().status, 'configured')
  assert.equal((await request('alice', 'POST', `/api/projects/${p.id}/chapters/prepare`, body)).statusCode, 200)
  assert.equal(preparations.length, 1)
  assert.equal(preparations[0].message, body.message)
  assert.equal(preparations[0].assets[0].width, 20); assert.equal(preparations[0].assets[0].height, 12)
  assert.match(preparations[0].assets[0].path, /原始资料/)
  assert.equal(preparations[0].assets[0].sha256, image.json().sha256)
  assert.equal((await request('alice', 'POST', `/api/projects/${p.id}/chapters/prepare`, { ...body, message: '修改了章节要求后的另一次请求。' })).statusCode, 409)
  const state = await request('alice', 'GET', `/api/projects/${p.id}/state`)
  assert.deepEqual(state.json().materials[0].image, { width: 20, height: 12, format: 'png' })
  assert.equal((await db.query('SELECT count(*)::int AS n FROM job_reservations')).rows[0].n, 0)
})

test('missing chapter preparation is reported before reserving a paid report', async t => {
  const { request, create, configure, db } = await fixture(t); await configure(); const p = await create()
  const r = await request('alice', 'POST', `/api/projects/${p.id}/reports`, { requestId: 'report-unprepared', baseRevision: 0, chapterId: 'site', stage: 'production-plan' })
  assert.equal(r.statusCode, 409, r.body); assert.match(r.json().error, /本章要求/)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n, 0)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM job_reservations')).rows[0].n, 0)
})

test('research summary remains a deterministic operation and prepared chapters use the validated report route', async t => {
  const { app, request, create, configure, db, runs } = await fixture(t), p = await create()
  const summary = await request('alice', 'POST', `/api/projects/${p.id}/reports`, { requestId: 'summary', baseRevision: 0, mode: 'research-summary', moduleIds: ['1.01'] })
  assert.equal(summary.statusCode, 200, summary.body); await app.waitForJobs()
  assert.equal(runs[0].snapshot, null)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM job_reservations')).rows[0].n, 0)
  await configure()
  const png = await sharp({ create: { width: 20, height: 12, channels: 3, background: '#294352' } }).png().toBuffer()
  const file = await request('alice', 'POST', `/api/projects/${p.id}/materials`, { requestId: 'photo', baseRevision: 0, filename: '素材.png', content: png.toString('base64') })
  assert.equal(file.statusCode, 200, file.body)
  await confirmedOutlineFixture(db,p.id)
  const setup = await request('alice', 'POST', `/api/projects/${p.id}/chapters/prepare`, { requestId: 'setup', baseRevision: 0, chapterId: 'site', message: '请根据当前项目资料编制场地研究章节。', materialIds: [file.json().id] })
  assert.equal(setup.statusCode, 200, setup.body)
  const report = await request('alice', 'POST', `/api/projects/${p.id}/reports`, { requestId: 'native-plan', baseRevision: 0, chapterId: 'site', stage: 'production-plan' })
  assert.equal(report.statusCode, 200, report.body); await app.waitForJobs()
  assert.deepEqual(runs[1].selection, { chapterId: 'site', stage: 'production-plan' })
  assert.ok(runs[1].snapshot.routes.text.primary)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM job_reservations')).rows[0].n, 1)
})

test('task snapshots survive administrator changes and retries return the original task', async t => {
  const { app, request, create, configure, db, runs } = await fixture(t)
  const policy = await configure(), p = await create()
  const body = { requestId: 'same-logical-task', baseRevision: 0, text: '分析资料' }
  const first = await request('alice', 'POST', `/api/projects/${p.id}/chat`, body); assert.equal(first.statusCode, 200, first.body)
  await app.waitForJobs()
  await configure(p => { p.limits.maxDailyJobsPerUser = 30 })
  const replay = await request('alice', 'POST', `/api/projects/${p.id}/chat`, body)
  assert.equal(replay.json().id, first.json().id); assert.equal(runs.length, 1)
  assert.equal(runs[0].snapshot.revision, policy.revision)
  const row = (await db.query('SELECT policy_snapshot FROM jobs WHERE id=$1', [first.json().id])).rows[0]
  assert.equal(row.policy_snapshot.revision, policy.revision)
  const state = await request('alice', 'GET', `/api/projects/${p.id}/state`)
  assert.equal(state.statusCode, 200); assert.ok(!state.body.includes('sensenova')); assert.ok(!state.body.includes('policy_snapshot'))
  assert.ok(!state.body.includes('execution_metadata'))
  const audit = (await request('admin', 'GET', '/api/admin/jobs')).json()
  assert.equal(audit[0].execution_metadata.parent.requests[0].model, 'sensenova-6.8-flash-lite')
  assert.equal(audit[0].execution_metadata.usage, null)
})

test('global queue reservation limits concurrency and only the owner can cancel a running task', async t => {
  const { app, request, create, configure, runs, held } = await fixture(t, { hold: true })
  await configure(p => { p.limits.globalConcurrency = 1 })
  const a = await create(), b = await create('bob')
  const first = await request('alice', 'POST', `/api/projects/${a.id}/chat`, { requestId: 'a-job', baseRevision: 0, text: '分析 A' })
  await until(() => runs.length === 1)
  const second = await request('bob', 'POST', `/api/projects/${b.id}/chat`, { requestId: 'b-job', baseRevision: 0, text: '分析 B' })
  assert.equal(second.statusCode, 200, second.body); assert.equal(runs.length, 1)
  assert.equal((await request('bob', 'POST', `/api/projects/${a.id}/jobs/${first.json().id}/cancel`, {})).statusCode, 404)
  const cancelled = await request('alice', 'POST', `/api/projects/${a.id}/jobs/${first.json().id}/cancel`, {})
  assert.equal(cancelled.statusCode, 200, cancelled.body)
  await until(() => runs.length === 2)
  held.get(b.id).resolve(); await app.waitForJobs()
  const state = (await request('alice', 'GET', `/api/projects/${a.id}/state`)).json()
  assert.equal(state.jobs[0].status, 'cancelled')
})

test('selected research is explicit and partial results remain limited, with cross-user resources denied', async t => {
  const { app, request, create, configure, runs } = await fixture(t)
  await configure(); const p = await create()
  assert.equal((await request('bob', 'GET', `/api/projects/${p.id}/research`)).statusCode, 404)
  assert.equal((await request('bob', 'GET', `/api/projects/${p.id}/events`)).statusCode, 404)
  assert.equal((await request('alice', 'POST', `/api/projects/${p.id}/research`, { requestId: 'empty', baseRevision: 0, moduleIds: [], flags: {} })).statusCode, 400)
  const r = await request('alice', 'POST', `/api/projects/${p.id}/research`, { requestId: 'selected', baseRevision: 0, moduleIds: ['1.01'], flags: { industryPlanning: false, existingBuildings: false, externalPartners: false, marketing: false } })
  assert.equal(r.statusCode, 200, r.body); await app.waitForJobs()
  assert.deepEqual(runs[0].selection.moduleIds, ['1.01'])
  const state = (await request('alice', 'GET', `/api/projects/${p.id}/state`)).json()
  assert.equal(state.jobs[0].status, 'partial'); assert.match(JSON.stringify(state.jobs[0].result), /补充项目资料/)
})

test('concurrent submissions cannot oversubscribe the persistent daily user reservation', async t => {
  const { app, request, create, configure, db } = await fixture(t)
  await configure(p => { p.limits.maxDailyJobsPerUser = 1 }); const p = await create()
  const responses = await Promise.all(['one', 'two'].map(requestId => request('alice', 'POST', `/api/projects/${p.id}/chat`, { requestId, baseRevision: 0, text: '分析' })))
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 429])
  await app.waitForJobs()
  assert.equal((await db.query('SELECT count(*)::int AS count FROM jobs')).rows[0].count, 1)
})

test('restart preserves a paid-task receipt and never automatically repeats an unknown result', async t => {
  const f = await fixture(t, { hold: true })
  const policy = await f.configure(), p = await f.create()
  const body = { requestId: 'restart-task', baseRevision: 0, text: '分析资料' }
  const first = await f.request('alice', 'POST', `/api/projects/${p.id}/chat`, body)
  assert.equal(first.statusCode, 200, first.body); await until(() => f.runs.length === 1)
  await f.restart(); await f.app.waitForJobs()
  const retried = await f.request('alice', 'POST', `/api/projects/${p.id}/chat`, body)
  assert.equal(retried.json().id, first.json().id)
  assert.equal(retried.json().status, 'interrupted')
  assert.equal(f.runs.length, 1)
  const row = (await f.db.query('SELECT policy_snapshot FROM jobs WHERE id=$1', [first.json().id])).rows[0]
  assert.equal(row.policy_snapshot.revision, policy.revision)
})

test('cancellation during final audit recording reaches cancelled and releases its concurrency slot', async t => {
  const f = await fixture(t, { holdTrace: true })
  await f.configure(); const p = await f.create()
  const task = await f.request('alice', 'POST', `/api/projects/${p.id}/chat`, { requestId: 'cancel-finalizing', baseRevision: 0, text: '分析' })
  await until(() => f.traceHolds.length === 1)
  assert.equal((await f.request('alice', 'POST', `/api/projects/${p.id}/jobs/${task.json().id}/cancel`, {})).statusCode, 200)
  f.traceHolds[0](); await f.app.waitForJobs()
  const row = (await f.db.query('SELECT status FROM jobs WHERE id=$1', [task.json().id])).rows[0]
  assert.equal(row.status, 'cancelled')
  const events = (await f.db.query('SELECT data FROM events WHERE project_id=$1', [p.id])).rows
  assert.ok(!events.some(({ data }) => data.type === 'task-completed'))
})
