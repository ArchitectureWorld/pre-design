import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { parse } from 'yaml'
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { request } from 'node:http'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
const workerRoot = dirname(fileURLToPath(import.meta.url))
export class ProjectWorkers {
  constructor({ privateRoot, settings, credentials, provider, model }) {
    this.config = { privateRoot, settings, credentials, provider, model }
    this.instances = new Map()
  }
  async open(project) {
    if (this.instances.has(project.id)) return this.instances.get(project.id)
    const pending = this.start(project).catch(error => { this.instances.delete(project.id); throw error })
    this.instances.set(project.id, pending)
    return pending
  }
  async start(project) {
    const { privateRoot, settings, credentials, provider, model } = this.config
    const home = join(privateRoot, project.id)
    await mkdir(home, { recursive: true, mode: 0o700 })
    const settingsFile = parse(await readFile(settings, 'utf8'))
    const providers = Array.isArray(settingsFile) ? settingsFile.find(entry => entry.id === 'llm-pi-ai')?.config?.providers : settingsFile?.['llm-pi-ai']?.providers
    const route = providers?.[provider]
    if (!route?.apiKeyEnv) throw new Error('MODEL_ROUTE_NOT_CONFIGURED')
    const refs = parse(await readFile(credentials, 'utf8'))?.refs
    if (!refs?.[route.apiKeyEnv]) throw new Error('MODEL_CREDENTIAL_REFERENCE_MISSING')
    const temp = await mkdtemp(join(tmpdir(), 'pre-web-'))
    const socket = join(temp, 'bridge.sock'), secret = randomBytes(32).toString('hex')
    const patch = join(home, 'web.cordis.yml')
    await writeFile(patch, JSON.stringify([
      { id: 'llm-pi-ai', config: { providers: { [provider]: route } } },
      { insert: [ { id: 'preplanning-agent', name: join(workerRoot, '.host-build/lib/index.mjs') },
        { id: 'preplanning-web-bridge', name: join(workerRoot, 'web-bridge.mjs') } ] },
      { id: 'sdk-jsonrpc-server', inject: ['sdkAppStartup', 'loader', 'preplanningWebBridgeReady'] },
    ]), { mode: 0o600 })
    const harness = new DeepSeekHarness({ profile: 'sdk', patches: [patch], dshHome: join(home, 'dsh'),
      cwd: project.workspace, processCwd: project.workspace, provider, model, initializeTimeoutMs: 45000, requestTimeoutMs: 300000,
      env: { ...process.env, [route.apiKeyEnv]: refs[route.apiKeyEnv], PRE_WEB_SOCKET: socket, PRE_WEB_BRIDGE_SECRET: secret,
        PRE_WEB_SESSION_ID: project.session_id, PRE_DESIGN_PRESENTATION_PROJECT_ROOT: project.workspace } })
    try {
      await harness.start()
      // A persisted marker is written only after successful session creation.
      const marker = join(home, 'session-ready')
      const exists = await readFile(marker, 'utf8').then(() => true, e => { if (e.code === 'ENOENT') return false; throw e })
      const session = exists ? await harness.resumeSession(project.session_id) : harness.session(project.session_id)
      await session.setWorkingDirectory(project.workspace)
      await writeFile(marker, project.session_id, { mode: 0o600 })
      const rpc = body => new Promise((done, reject) => {
        const req = request({ socketPath: socket, path: '/', method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, timeout: 70000 }, res => {
          let text = ''; res.on('data', chunk => text += chunk)
          res.on('end', () => { try { const value = JSON.parse(text); if (res.statusCode !== 200) reject(new Error(value.error ?? 'BRIDGE_ERROR')); else done(value) } catch (e) { reject(e) } })
        })
        req.on('timeout', () => req.destroy(new Error('BRIDGE_TIMEOUT')))
        req.on('error', reject); req.end(JSON.stringify(body))
      })
      return { harness, session, rpc, temp }
    } catch (error) { await harness.close(); await rm(temp, { recursive: true, force: true }); throw error }
  }
  async call(project, body) {
    try { return await (await this.open(project)).rpc(body) }
    catch (error) { await this.close(project.id); throw error }
  }
  async run(project, text, onEvent) {
    const instance = await this.open(project)
    try {
      const result = await instance.session.run(text, { onNotification: event => {
        // Only progress metadata crosses to the UI; authoritative state is read separately.
        onEvent?.({ type: event.method ?? 'agent-progress' })
      } })
      const ended = result.events.findLast(event => event.type === 'turn/end')
      if (ended?.data?.reason?.kind !== 'completed') throw new Error('AGENT_TURN_NOT_COMPLETED')
      return { response: result.finalResponse, eventCount: result.events.length }
    } catch (error) { await this.close(project.id); throw error }
  }
  async close(id) {
    const pending = this.instances.get(id)
    if (!pending) return
    const instance = await pending
    await instance.harness.close()
    this.instances.delete(id)
    await rm(instance.temp, { recursive: true, force: true })
  }
  async closeAll() { await Promise.allSettled([...this.instances.keys()].map(id => this.close(id))) }
}
