import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import pg from 'pg'

const root = resolve(import.meta.dirname, '../..'), data = join(root, '.local/web')
const configPath = join(data, 'config.json')
const existing = await readFile(configPath, 'utf8').then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
if (existing) {
  console.log(`配置已存在，保留原配置：${configPath}`)
} else {
  const databaseName = process.env.PRE_WEB_DATABASE ?? 'pre_design_web_v210'
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) throw new Error('PRE_WEB_DATABASE must be a lowercase PostgreSQL identifier')
  const database = { host: process.env.PRE_WEB_PG_HOST ?? `/tmp/pre-design-pg-${process.getuid()}`, port: Number(process.env.PRE_WEB_PG_PORT ?? 55439), database: databaseName, user: process.env.USER }
  const admin = new pg.Pool({ ...database, database: 'postgres' })
  try {
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName])).rowCount) await admin.query(`CREATE DATABASE "${databaseName}"`)
  } finally { await admin.end() }
  await mkdir(data, { recursive: true, mode: 0o700 }); await chmod(data, 0o700)
  const users = ['admin', 'user-a', 'user-b'].map((id, i) => ({ id, role: i ? 'user' : 'admin', token: randomBytes(32).toString('hex') }))
  const config = { host: process.env.PRE_WEB_HOST ?? '127.0.0.1', port: Number(process.env.PRE_WEB_PORT ?? 4320), projectsRoot: join(data, 'projects'), database, users, worker: { privateRoot: join(data, 'workers'), ...(process.env.PRE_WEB_MODEL_SETTINGS ? { settings: process.env.PRE_WEB_MODEL_SETTINGS } : {}), ...(process.env.PRE_WEB_MODEL_CREDENTIALS ? { credentials: process.env.PRE_WEB_MODEL_CREDENTIALS } : {}) } }
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  await writeFile(join(data, 'access.txt'), '本文件包含候选环境访问令牌，仅在本机保管，不提交仓库。\n\n' + users.map(u => `${u.id} (${u.role})\n${u.token}\n`).join('\n'), { flag: 'wx', mode: 0o600 })
  console.log(`已建立候选配置：${configPath}\n访问令牌保存在：${join(data, 'access.txt')}\n模型默认待验证；请由管理员配置接入和能力。`)
}
