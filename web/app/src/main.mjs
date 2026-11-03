import pg from 'pg'
import serveStatic from '@fastify/static'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { ProjectWorkers } from '../../worker/runtime.mjs'
import { createApp } from './server.mjs'
const configPath = process.env.PRE_WEB_CONFIG
if (!configPath) throw new Error('Set PRE_WEB_CONFIG to a private configuration JSON file (see README).')
const config = JSON.parse(await readFile(configPath, 'utf8'))
const db = new pg.Pool(config.database)
const workers = new ProjectWorkers(config.worker)
const app = await createApp({ db, workers, projectsRoot: config.projectsRoot, users: config.users })
app.addHook('onSend', async (_req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
})
await app.register(serveStatic, { root: fileURLToPath(new URL('../dist/', import.meta.url)), index: 'index.html' })
let ending = false
async function close() { if (ending) return; ending = true; await app.close(); await db.end() }
process.once('SIGTERM', () => { void close() }); process.once('SIGINT', () => { void close() })
await app.listen({ port: config.port ?? 4318, host: config.host ?? '127.0.0.1' })
console.log(`Pre-design Web: http://${config.host ?? '127.0.0.1'}:${config.port ?? 4318}`)
