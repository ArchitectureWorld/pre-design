import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPlatformStore } from '../src/platform-store.mjs'

const connection = { host: '/tmp/pre-design-pg-1000', port: 55439, database: 'pre_design_web', user: 'zetta' }
const token = () => randomBytes(32).toString('hex')
const accounts = () => [{ id: 'admin', token: token(), role: 'admin' }, { id: 'alice', token: token() }]
const fails = statusCode => error => error.statusCode === statusCode
async function database(t) {
  const schema = `platform_policy_${randomUUID().replaceAll('-', '')}`
  const root = new pg.Pool(connection)
  await root.query(`CREATE SCHEMA ${schema}`)
  const db = new pg.Pool({ ...connection, options: `-c search_path=${schema}` })
  t.after(async () => { await db.end(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end() })
  return db
}
function markParentVerified(policy) {
  const model = policy.models.find(item => item.provider === 'SenseNova' && item.model === 'sensenova-6.8-flash-lite')
  model.status = 'verified'; model.capabilities.tools = true
  return policy
}

test('initialization persists token hashes and resolves roles from the database', async t => {
  const db = await database(t), users = accounts(), store = await createPlatformStore(db, users)
  assert.deepEqual(await store.principal('admin'), { id: 'admin', role: 'admin', disabled: false })
  assert.deepEqual(await store.principal('alice'), { id: 'alice', role: 'user', disabled: false })
  assert.equal(await store.principal('missing'), null)
  assert.deepEqual(await store.listUsers(), [
    { id: 'admin', role: 'admin', disabled: false }, { id: 'alice', role: 'user', disabled: false },
  ])
  assert.deepEqual(await store.authenticate(users[0].token), { id: 'admin', role: 'admin', disabled: false })
  assert.equal(await store.authenticate(token()), null)
  assert.equal(await store.authenticate(undefined), null)
  const { rows } = await db.query('SELECT * FROM platform_users ORDER BY id')
  for (const [index, row] of rows.entries()) {
    assert.equal(row.token_hash, createHash('sha256').update(users[index].token).digest('hex'))
    assert.ok(!JSON.stringify(row).includes(users[index].token))
    assert.ok(!Object.hasOwn(row, 'token'))
  }
  users[0].role = 'user'
  assert.equal((await store.authenticate(users[0].token)).role, 'admin')
  await db.query("UPDATE platform_users SET role='user',disabled=true WHERE id='admin'")
  assert.deepEqual(await store.principal('admin'), { id: 'admin', role: 'user', disabled: true })
  assert.equal(await store.authenticate(users[0].token), null)
  const policy = await store.getPolicy()
  assert.equal(policy.revision, 1)
  assert.equal(policy.models.length, 15)
})

test('startup rejects malformed accounts and duplicate identities or tokens', async t => {
  const db = await database(t), shared = token()
  for (const users of [
    [], [{ id: 'admin', token: 'short' }], [{ id: '', token: token() }],
    [{ id: 'admin', token: token(), role: 'owner' }],
    [{ id: 'same', token: token() }, { id: 'same', token: token() }],
    [{ id: 'first', token: shared }, { id: 'second', token: shared }],
    [{ id: 'first', token: token(), unknown: 'value' }],
  ]) await assert.rejects(createPlatformStore(db, users), fails(400))
  const users = accounts(), store = await createPlatformStore(db, users)
  await assert.rejects(createPlatformStore(db, [{ id: 'new-user', token: users[0].token }]), fails(400))
  assert.equal(await store.principal('new-user'), null)
  assert.equal((await store.getPolicy()).revision, 1)
})

test('restart preserves database roles and disabled state while rotating configured tokens', async t => {
  const db = await database(t), users = accounts(), store = await createPlatformStore(db, users)
  await db.query("UPDATE platform_users SET disabled=true WHERE id='alice'")
  const replacement = token()
  const reopened = await createPlatformStore(db, [
    { id: 'admin', token: replacement }, { id: 'alice', token: users[1].token, role: 'admin', disabled: false },
  ])
  assert.deepEqual(await reopened.principal('admin'), { id: 'admin', role: 'admin', disabled: false })
  assert.deepEqual(await reopened.principal('alice'), { id: 'alice', role: 'user', disabled: true })
  assert.equal(await store.authenticate(users[0].token), null)
  assert.equal((await store.authenticate(replacement)).role, 'admin')
  assert.equal((await db.query('SELECT count(*)::int AS count FROM platform_policy_versions')).rows[0].count, 1)
  assert.equal((await db.query('SELECT count(*)::int AS count FROM platform_policy_audit')).rows[0].count, 1)
})

test('only enabled database administrators can save policy', async t => {
  const db = await database(t), store = await createPlatformStore(db, accounts()), policy = await store.getPolicy()
  await assert.rejects(store.savePolicy(policy, 1, 'alice'), fails(403))
  await assert.rejects(store.savePolicy(policy, 1, 'missing'), fails(403))
  await assert.rejects(store.savePolicy(policy, 1, { id: 'admin', role: 'admin' }), fails(403))
  await db.query("UPDATE platform_users SET disabled=true WHERE id='admin'")
  await assert.rejects(store.savePolicy(policy, 1, 'admin'), fails(403))
  assert.equal((await store.getPolicy()).revision, 1)
  assert.equal((await db.query('SELECT count(*)::int AS count FROM platform_policy_audit')).rows[0].count, 1)
})

test('configuration CAS commits one concurrent writer with matching history and audit', async t => {
  const db = await database(t), users = accounts(), store = await createPlatformStore(db, users)
  const original = await store.getPolicy(), a = structuredClone(original), b = structuredClone(original)
  a.limits.maxDailyJobsPerUser = 7; b.limits.maxDailyJobsPerUser = 9
  const results = await Promise.allSettled([store.savePolicy(a, 1, 'admin'), store.savePolicy(b, 1, 'admin')])
  const success = results.filter(result => result.status === 'fulfilled'), rejected = results.filter(result => result.status === 'rejected')
  assert.equal(success.length, 1); assert.equal(rejected.length, 1)
  assert.equal(rejected[0].reason.statusCode, 409)
  const saved = success[0].value
  assert.equal(saved.revision, 2)
  assert.deepEqual(await store.getPolicy(), saved)
  const versions = (await db.query('SELECT revision,policy,created_by FROM platform_policy_versions ORDER BY revision')).rows
  assert.equal(versions.length, 2)
  assert.deepEqual(versions[0].policy, original)
  assert.deepEqual(versions[1].policy, saved)
  assert.equal(versions[1].created_by, 'admin')
  const audit = (await db.query('SELECT revision,previous_revision,actor_id,action FROM platform_policy_audit ORDER BY revision')).rows
  assert.deepEqual(audit, [
    { revision: 1, previous_revision: null, actor_id: null, action: 'initialized' },
    { revision: 2, previous_revision: 1, actor_id: 'admin', action: 'updated' },
  ])
  assert.deepEqual(await (await createPlatformStore(db, users)).getPolicy(), saved)
})

test('saving cannot override revision or leave half a policy after invalid input', async t => {
  const db = await database(t), store = await createPlatformStore(db, accounts()), original = await store.getPolicy()
  await assert.rejects(store.savePolicy({ ...original, revision: 500 }, 1, 'admin'), fails(409))
  await assert.rejects(store.savePolicy(original, 0, 'admin'), fails(400))
  await assert.rejects(store.savePolicy(original, '1', 'admin'), fails(400))
  const wrong = structuredClone(original)
  wrong.routes.imageLlm.primary = { provider: 'openai-codex', model: 'gpt-6-astra' }
  await assert.rejects(store.savePolicy(wrong, 1, 'admin'), fails(400))
  assert.deepEqual(await store.getPolicy(), original)
  assert.equal((await db.query('SELECT count(*)::int AS count FROM platform_policy_versions')).rows[0].count, 1)
  const { revision, ...withoutRevision } = original
  const saved = await store.savePolicy(withoutRevision, revision, 'admin')
  assert.equal(saved.revision, 2)
  await assert.rejects(store.savePolicy(original, 1, 'admin'), fails(409))
})

test('an audit failure rolls back the new version and current policy together', async t => {
  const db = await database(t), store = await createPlatformStore(db, accounts()), original = await store.getPolicy()
  await db.query("ALTER TABLE platform_policy_audit ADD CONSTRAINT fail_update_audit CHECK (action = 'initialized')")
  await assert.rejects(store.savePolicy(original, 1, 'admin'))
  assert.deepEqual(await store.getPolicy(), original)
  assert.equal((await db.query('SELECT count(*)::int AS count FROM platform_policy_versions')).rows[0].count, 1)
  assert.equal((await db.query('SELECT count(*)::int AS count FROM platform_policy_audit')).rows[0].count, 1)
})

test('job snapshots remain immutable across configuration edits and restarts', async t => {
  const db = await database(t), users = accounts(), store = await createPlatformStore(db, users)
  await assert.rejects(store.snapshotPolicy(), error => error.statusCode === 503 && error.code === 'MODEL_POLICY_NOT_READY')
  const pending = await store.snapshotPolicy([])
  assert.equal(pending.revision, 1)
  const verified = markParentVerified(await store.getPolicy())
  await store.savePolicy(verified, 1, 'admin')
  const snapshot = await store.snapshotPolicy(['parent', 'text', 'web', 'vision'])
  assert.equal(snapshot.revision, 2)
  assert.throws(() => { snapshot.limits.globalConcurrency = 99 }, TypeError)
  const next = await store.getPolicy()
  next.limits.globalConcurrency = 4
  next.models[1].credentialRef = 'credential:rotated-sensenova'
  await store.savePolicy(next, 2, 'admin')
  const reopened = await createPlatformStore(db, users)
  assert.equal((await reopened.getPolicy()).revision, 3)
  assert.equal(snapshot.limits.globalConcurrency, 2)
  assert.equal(snapshot.models[1].credentialRef, undefined)
  assert.equal(pending.models[1].status, 'unverified')
  const mutable = await reopened.getPolicy()
  mutable.routes.parent.primary = null
  assert.ok((await reopened.getPolicy()).routes.parent.primary)
})

test('concurrent initialization creates a single initial version and audit event', async t => {
  const db = await database(t), users = accounts()
  const stores = await Promise.all([createPlatformStore(db, users), createPlatformStore(db, users)])
  assert.equal((await stores[0].getPolicy()).revision, 1)
  assert.equal((await stores[1].getPolicy()).revision, 1)
  assert.equal((await db.query('SELECT count(*)::int AS count FROM platform_policy_versions')).rows[0].count, 1)
  assert.equal((await db.query('SELECT count(*)::int AS count FROM platform_policy_audit')).rows[0].count, 1)
})

test('旧 Flux2 配置迁移为独立 Flux3 修订，保留历史与其他模型设置且重启不重复迁移', async t => {
  const db=await database(t),users=accounts(),store=await createPlatformStore(db,users)
  const old=await store.getPolicy();delete old.search
  old.models=old.models.filter(row=>row.provider!=='yaoguang-codex')
  old.models[10].imageConfig={modelFile:'Flux2-Klein-9B-True-v2-bf16.safetensors',textToImageWorkflow:'old.json'}
  old.models[10].status='verified';old.limits.globalConcurrency=7
  await db.query('UPDATE platform_policy_versions SET policy=$1 WHERE revision=1',[old])
  const stores=await Promise.all([createPlatformStore(db,users),createPlatformStore(db,users)])
  const migrated=await stores[0].getPolicy()
  assert.equal(migrated.revision,2);assert.equal(migrated.models[10].status,'unverified')
  assert.equal(migrated.models[10].imageConfig.modelFile,'flux3-image-klein-bf16.safetensors')
  assert.equal(migrated.limits.globalConcurrency,7);assert.equal(migrated.search.enabled,false)
  assert.deepEqual((await db.query('SELECT policy FROM platform_policy_versions WHERE revision=1')).rows[0].policy,old)
  assert.equal((await (await createPlatformStore(db,users)).getPolicy()).revision,2)
  assert.equal((await db.query('SELECT count(*)::int AS count FROM platform_policy_audit')).rows[0].count,2)
})

test('完整14项配置追加瑶光02时仅产生一个新修订，历史快照与既有路由保持不变', async t => {
  const db = await database(t), users = accounts(), store = await createPlatformStore(db, users)
  const historical = markParentVerified(await store.getPolicy())
  historical.models = historical.models.filter(row => row.provider !== 'yaoguang-codex')
  historical.search = { enabled: true, provider: 'ddg', maxResults: 6, maxQueries: 3, timeoutMs: 20000 }
  historical.models[0].maxOutputTokens = 4096
  await db.query('UPDATE platform_policy_versions SET policy=$1 WHERE revision=1', [historical])
  const snapshot = await store.snapshotPolicy(['text'])
  assert.equal(snapshot.models.length, 14)
  const reopened = await Promise.all([createPlatformStore(db, users), createPlatformStore(db, users)])
  const migrated = await reopened[0].getPolicy()
  assert.equal(migrated.revision, 2)
  assert.equal(migrated.models.length, 15)
  assert.deepEqual(migrated.models.slice(0, 14), historical.models)
  assert.deepEqual(migrated.routes, historical.routes)
  assert.deepEqual(migrated.search, historical.search)
  assert.equal(migrated.models[14].provider, 'yaoguang-codex')
  assert.equal(migrated.models[14].model, 'yaoguang02-gpt-6-astra')
  assert.equal(migrated.models[14].status, 'unverified')
  assert.deepEqual(snapshot.models, historical.models)
  assert.equal(snapshot.revision, 1)
  assert.deepEqual((await db.query('SELECT policy FROM platform_policy_versions WHERE revision=1')).rows[0].policy, historical)
  assert.equal((await (await createPlatformStore(db, users)).getPolicy()).revision, 2)
  assert.equal((await db.query('SELECT count(*)::int AS count FROM platform_policy_versions')).rows[0].count, 2)
  assert.deepEqual((await db.query('SELECT revision,previous_revision,actor_id,action FROM platform_policy_audit ORDER BY revision')).rows, [
    { revision: 1, previous_revision: null, actor_id: null, action: 'initialized' },
    { revision: 2, previous_revision: 1, actor_id: null, action: 'updated' },
  ])
})
