import { createHash } from 'node:crypto'
import { z } from 'zod'
import { defaultPolicy, validatePolicy, validateSnapshot } from './model-policy.mjs'

const fail = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) })
const hashToken = token => createHash('sha256').update(token).digest('hex')
const accountSchema = z.array(z.object({
  id: z.string().min(1).max(120).regex(/^[\p{L}\p{N}][\p{L}\p{N}_.@-]*$/u),
  token: z.string().min(32).max(4096).regex(/^\S+$/u),
  role: z.enum(['admin', 'user']).default('user'), disabled: z.boolean().default(false),
}).strict()).min(1)

function configuredAccounts(input) {
  const result = accountSchema.safeParse(input)
  if (!result.success) throw fail(400, '用户配置不合法：需要唯一账号、至少 32 字符的令牌和有效角色', 'INVALID_PLATFORM_USERS')
  const ids = new Set(), hashes = new Set()
  return result.data.map(({ id, token, role, disabled }) => {
    const tokenHash = hashToken(token)
    if (ids.has(id) || hashes.has(tokenHash)) throw fail(400, '用户账号或访问令牌重复', 'INVALID_PLATFORM_USERS')
    ids.add(id); hashes.add(tokenHash)
    return { id, tokenHash, role, disabled }
  })
}

async function transaction(db, operation) {
  const connection = await db.connect()
  try {
    await connection.query('BEGIN')
    const result = await operation(connection)
    await connection.query('COMMIT')
    return result
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {})
    throw error
  } finally { connection.release() }
}
const databaseFailure = error => error.statusCode ? error : fail(503, '平台配置存储暂时不可用', 'PLATFORM_STORE_UNAVAILABLE')

export async function createPlatformStore(db, users) {
  const accounts = configuredAccounts(users)
  try {
    await transaction(db, async connection => {
      // Serializes DDL and the first revision across candidate API processes.
      await connection.query("SELECT pg_advisory_xact_lock(hashtext(current_database() || ':' || current_schema() || ':platform-policy-init'))")
      await connection.query(`
        CREATE TABLE IF NOT EXISTS platform_users (
          id text PRIMARY KEY,
          token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
          role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
          disabled boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS platform_policy_versions (
          revision integer PRIMARY KEY CHECK (revision > 0),
          policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
          created_by text REFERENCES platform_users(id),
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS platform_policy_state (
          id smallint PRIMARY KEY CHECK (id = 1),
          revision integer NOT NULL REFERENCES platform_policy_versions(revision)
        );
        CREATE TABLE IF NOT EXISTS platform_policy_audit (
          revision integer PRIMARY KEY REFERENCES platform_policy_versions(revision),
          previous_revision integer REFERENCES platform_policy_versions(revision),
          actor_id text REFERENCES platform_users(id),
          action text NOT NULL CHECK (action IN ('initialized','updated')),
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `)
      for (const account of accounts) {
        // Configuration can rotate tokens; established account permissions stay in PostgreSQL.
        await connection.query(`INSERT INTO platform_users(id,token_hash,role,disabled) VALUES($1,$2,$3,$4)
          ON CONFLICT (id) DO UPDATE SET token_hash=EXCLUDED.token_hash,updated_at=now()`,
        [account.id, account.tokenHash, account.role, account.disabled])
      }
      const { rows: [state] } = await connection.query('SELECT revision FROM platform_policy_state WHERE id=1')
      if (!state) {
        const { rows: [history] } = await connection.query('SELECT revision FROM platform_policy_versions LIMIT 1')
        if (history) throw fail(503, '配置历史存在但当前版本缺失，需检查数据库状态', 'PLATFORM_POLICY_STATE_MISSING')
        const initial = validatePolicy(defaultPolicy())
        await connection.query('INSERT INTO platform_policy_versions(revision,policy,created_by) VALUES($1,$2,NULL)', [1, initial])
        await connection.query('INSERT INTO platform_policy_state(id,revision) VALUES(1,1)')
        await connection.query("INSERT INTO platform_policy_audit(revision,previous_revision,actor_id,action) VALUES(1,NULL,NULL,'initialized')")
      }
    })
  } catch (error) {
    if (error.code === '23505') throw fail(400, '用户账号或访问令牌与已有账号重复', 'INVALID_PLATFORM_USERS')
    throw databaseFailure(error)
  }

  async function getPolicy() {
    try {
      const { rows: [row] } = await db.query(`SELECT s.revision,v.policy FROM platform_policy_state s
        JOIN platform_policy_versions v ON v.revision=s.revision WHERE s.id=1`)
      if (!row || row.policy?.revision !== row.revision) throw fail(503, '当前模型配置版本不完整', 'PLATFORM_POLICY_STATE_MISSING')
      return validatePolicy(row.policy)
    } catch (error) { throw databaseFailure(error) }
  }

  async function principal(id) {
    if (typeof id !== 'string' || !id) return null
    try {
      const { rows: [row] } = await db.query('SELECT id,role,disabled FROM platform_users WHERE id=$1', [id])
      return row ?? null
    } catch (error) { throw databaseFailure(error) }
  }

  async function authenticate(token) {
    if (typeof token !== 'string' || token.length < 32 || token.length > 4096) return null
    try {
      const { rows: [row] } = await db.query('SELECT id,role,disabled FROM platform_users WHERE token_hash=$1 AND disabled=false', [hashToken(token)])
      return row ?? null
    } catch (error) { throw databaseFailure(error) }
  }

  async function listUsers() {
    try { return (await db.query('SELECT id,role,disabled FROM platform_users ORDER BY id')).rows }
    catch (error) { throw databaseFailure(error) }
  }

  async function savePolicy(input, expectedRevision, userId) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw fail(400, '需要有效的配置版本', 'INVALID_POLICY_REVISION')
    if (typeof userId !== 'string' || !userId) throw fail(403, '只有启用的管理员可以修改模型配置', 'PLATFORM_ADMIN_REQUIRED')
    try {
      return await transaction(db, async connection => {
        const { rows: [actor] } = await connection.query('SELECT role,disabled FROM platform_users WHERE id=$1 FOR SHARE', [userId])
        if (!actor || actor.role !== 'admin' || actor.disabled) throw fail(403, '只有启用的管理员可以修改模型配置', 'PLATFORM_ADMIN_REQUIRED')
        const policy = validatePolicy(input)
        if (policy.revision !== undefined && policy.revision !== expectedRevision) throw fail(409, '提交的配置版本不一致，请刷新后重试', 'POLICY_REVISION_CONFLICT')
        const { rows: [state] } = await connection.query('SELECT revision FROM platform_policy_state WHERE id=1 FOR UPDATE')
        if (!state) throw fail(503, '当前模型配置版本缺失', 'PLATFORM_POLICY_STATE_MISSING')
        if (state.revision !== expectedRevision) throw fail(409, '模型配置已被修改，请刷新后重试', 'POLICY_REVISION_CONFLICT')
        const saved = { ...policy, revision: state.revision + 1 }
        await connection.query('INSERT INTO platform_policy_versions(revision,policy,created_by) VALUES($1,$2,$3)', [saved.revision, saved, userId])
        const update = await connection.query('UPDATE platform_policy_state SET revision=$1 WHERE id=1 AND revision=$2', [saved.revision, expectedRevision])
        if (update.rowCount !== 1) throw fail(409, '模型配置已被修改，请刷新后重试', 'POLICY_REVISION_CONFLICT')
        await connection.query("INSERT INTO platform_policy_audit(revision,previous_revision,actor_id,action) VALUES($1,$2,$3,'updated')", [saved.revision, expectedRevision, userId])
        return saved
      })
    } catch (error) { throw databaseFailure(error) }
  }

  async function snapshotPolicy(requiredRoles = ['parent']) {
    return validateSnapshot(await getPolicy(), requiredRoles)
  }
  return { getPolicy, savePolicy, snapshotPolicy, listUsers, principal, authenticate }
}
