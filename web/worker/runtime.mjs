import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { parse } from 'yaml'
import { mkdir, readFile, writeFile, mkdtemp, rm, realpath } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { request } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { validateSnapshot } from '../app/src/model-policy.mjs'
import { validateResearchSelection, validateReportSelection, validateReportSnapshot, reportModelRoles, publicBusinessData, researchError } from '../app/src/research-contract.mjs'
import { isolatedEnvironment, materializeModelRuntime } from './model-runtime.mjs'
import { listProjectArtifacts, readProjectArtifact } from './research-artifacts.mjs'
const workerRoot = dirname(fileURLToPath(import.meta.url))
const signature = value => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')
const terminal = new Set(['completed','partial','cancelled','failed','unreviewed'])

export class ProjectWorkers {
  constructor(config = {}) {
    this.config = config
    this.instances = new Map()
    this.snapshots = new Map()
    this.closing = new Map()
    this.active = new Set()
  }
  open(project, snapshot, requiredRoles = ['parent']) {
    const closing = this.closing.get(project.id)
    if (closing) return closing.then(() => this.open(project, snapshot, requiredRoles))
    const previous = this.instances.get(project.id), key = signature({ snapshot, requiredRoles })
    if (previous && (snapshot === undefined || this.snapshots.get(project.id) === key)) return previous
    if (previous && this.active.has(project.id)) return Promise.reject(researchError('WORKER_TASK_BUSY', '项目已有运行中的模型任务。', 409))
    const pending = (async () => {
      if (previous) await this.dispose(await previous)
      return this.start(project, snapshot, requiredRoles)
    })().catch(error => { if (this.instances.get(project.id) === pending) { this.instances.delete(project.id); this.snapshots.delete(project.id) } throw error })
    this.instances.set(project.id, pending)
    this.snapshots.set(project.id, key)
    return pending
  }
  async start(project, snapshot, requiredRoles = ['parent']) {
    const { privateRoot, settings, credentials } = this.config
    if (!privateRoot || !/^[A-Za-z0-9-]{1,100}$/u.test(project.id)) throw researchError('WORKER_PROJECT_INVALID')
    const workspace = await realpath(project.workspace)
    if (workspace !== resolve(project.workspace)) throw researchError('WORKER_PROJECT_INVALID')
    const home = join(privateRoot, project.id)
    await mkdir(home, { recursive: true, mode: 0o700 })
    let settingsData = {}, credentialsData = {}
    if (snapshot) {
      validateSnapshot(snapshot, ['parent'])
      if (!settings || !credentials) throw researchError('MODEL_NOT_READY', 'MODEL_NOT_READY: 未指定本机模型配置和凭据文件。', 503)
      try { settingsData = parse(await readFile(settings, 'utf8')); credentialsData = parse(await readFile(credentials, 'utf8')) }
      catch { throw researchError('MODEL_NOT_READY', 'MODEL_NOT_READY: 无法读取指定的模型配置或凭据。', 503) }
    }
    const materialized = materializeModelRuntime(snapshot, settingsData, credentialsData, requiredRoles)
    const temp = await mkdtemp(join(tmpdir(), 'pre-web-'))
    const socket = join(temp, 'bridge.sock'), secret = randomBytes(32).toString('hex')
    const patch = join(home, 'web.cordis.yml'), policyFile = join(home, 'task-policy.json')
    await writeFile(policyFile, JSON.stringify({ snapshot, classRoutes: materialized.classRoutes, classFallbacks: materialized.classFallbacks }), { mode: 0o600 })
    await writeFile(patch, JSON.stringify([
      { id: 'llm-pi-ai', config: { providers: materialized.providers } },
      // DSH's default search performs a separately billed auxiliary model call.
      // No such backend has been verified in the task snapshot. HTTP fetch is
      // retained; it validates public destinations and pins DNS connections.
      { id: 'tool-web', config: { search: false, fetch: true } },
      { insert: [{ id: 'preplanning-agent', name: join(workerRoot, '.host-build/lib/index.mjs') }, { id: 'preplanning-web-bridge', name: join(workerRoot, 'web-bridge.mjs') }] },
      { id: 'sdk-jsonrpc-server', inject: ['sdkAppStartup', 'loader', 'preplanningWebBridgeReady'] },
    ]), { mode: 0o600 })
    const parent = materialized.parent ?? { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    const parentModel = snapshot?.models.find(row => row.runtimeProvider === parent.provider && row.model === parent.model)
    const harness = new DeepSeekHarness({ profile: 'sdk', patches: [patch], dshHome: join(home, 'dsh'), cwd: workspace, processCwd: workspace,
      ...parent, ...(parentModel?.maxOutputTokens ? { maxTokens: parentModel.maxOutputTokens } : {}), initializeTimeoutMs: 60000,
      env: { ...isolatedEnvironment(), ...materialized.env, PRE_WEB_SOCKET: socket, PRE_WEB_BRIDGE_SECRET: secret, PRE_WEB_SESSION_ID: project.session_id,
        PRE_WEB_WORKSPACE: workspace, PRE_WEB_POLICY_FILE: policyFile, ...(project.owner_id ? {PRE_WEB_CALLER_USER_ID:String(project.owner_id)} : {}), PRE_DESIGN_PRESENTATION_PROJECT_ROOT: workspace, DSH_MAX_TOKENS_AS_SUCCESS: 'false' } })
    try {
      await harness.start()
      const marker = join(home, 'session-ready')
      const previous = await readFile(marker, 'utf8').catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
      if (previous && previous !== project.session_id) throw researchError('WORKER_SESSION_MISMATCH')
      const session = previous ? await harness.resumeSession(project.session_id) : harness.session(project.session_id)
      await session.setWorkingDirectory(workspace)
      await writeFile(marker, project.session_id, { mode: 0o600 })
      const rpc = body => new Promise((done, reject) => {
        const req = request({ socketPath: socket, path: '/', method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, timeout: 70000 }, res => {
          let text = ''
          res.on('data', chunk => { text += chunk; if (text.length > 16 * 1024 * 1024) req.destroy(new Error('BRIDGE_RESPONSE_LIMIT')) })
          res.on('end', () => { try { const value = JSON.parse(text); if (res.statusCode !== 200) reject(researchError(value.code ?? 'BRIDGE_ERROR', value.error ?? 'BRIDGE_ERROR', res.statusCode, value.details)); else done(value) } catch (error) { reject(error) } })
        })
        req.on('timeout', () => req.destroy(new Error('BRIDGE_TIMEOUT')))
        req.on('error', reject); req.end(JSON.stringify(body))
      })
      return { harness, session, rpc, temp }
    } catch (error) { await harness.close(); await rm(temp, { recursive: true, force: true }); throw error }
  }
  async call(project, body) {
    try { return publicBusinessData(await (await this.open(project)).rpc(body), [project.workspace]) }
    catch (error) {
      // A transport failure leaves the mutation outcome unknown. Drop the dead
      // process but never retry the operation; normal Core rejections keep it alive.
      if (!error.statusCode || error.statusCode >= 500 && error.statusCode !== 503) await this.close(project.id)
      throw error
    }
  }
  async withTask(project, snapshot, signal, job, requiredRoles = ['parent']) {
    signal?.throwIfAborted()
    if (this.active.has(project.id)) throw researchError('WORKER_TASK_BUSY', '项目已有运行中的模型任务。', 409)
    let cleanup
    const cancel = () => { cleanup ??= this.close(project.id); cleanup.catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      signal?.throwIfAborted()
      const pending = this.open(project, snapshot, requiredRoles)
      this.active.add(project.id)
      const instance = await pending
      signal?.throwIfAborted()
      return publicBusinessData(await job(instance), [project.workspace])
    } catch (error) {
      if (signal?.aborted) { await (cleanup ??= this.close(project.id)); throw signal.reason }
      if (!error.statusCode || error.statusCode >= 500 && error.statusCode !== 503) await (cleanup ??= this.close(project.id))
      throw researchError(error.code ?? 'WORKER_EXECUTION_FAILED', publicBusinessData(String(error.message), [project.workspace, this.config.privateRoot, workerRoot]), error.statusCode ?? 500, publicBusinessData(error.details, [project.workspace]))
    } finally {
      signal?.removeEventListener('abort', cancel)
      this.active.delete(project.id)
      if (cleanup) await cleanup
    }
  }
  async run(project, text, onEvent, snapshot, signal) {
    signal?.throwIfAborted()
    const policy = validateSnapshot(snapshot, ['parent'])
    return this.withTask(project, policy, signal, async instance => {
      signal?.throwIfAborted()
      const result = await instance.session.run(text, { onNotification: event => onEvent?.({ type: event.method ?? 'agent-progress' }) })
      signal?.throwIfAborted()
      const ended = result.events.findLast(event => event.type === 'turn/end')
      if (ended?.data?.reason?.kind !== 'completed') throw researchError('AGENT_TURN_NOT_COMPLETED', '模型任务未完成；保留真实终态。', 409)
      return { response: result.finalResponse, eventCount: result.events.length }
    }, ['parent'])
  }
  async monitor(instance, operation, started, onEvent, signal) {
    let status = started
    for (;;) {
      signal?.throwIfAborted()
      onEvent?.({ type: operation === 'research-status' ? 'research-progress' : 'report-progress', ...status })
      if (terminal.has(status.status)) return status
      if (!['running','preparing','cancelling'].includes(status.status)) throw researchError('TASK_STATE_UNKNOWN', '核心没有可确认的活动任务；不会自动重新执行。', 409)
      await delay(this.config.pollIntervalMs ?? 1000, undefined, signal ? { signal } : undefined)
      status = await instance.rpc({ operation })
    }
  }
  async runResearch(project, selection, snapshot, onEvent, signal) {
    signal?.throwIfAborted()
    const input = validateResearchSelection(selection), policy = validateSnapshot(snapshot, ['parent','text','web'])
    return this.withTask(project, policy, signal, async instance => {
      signal?.throwIfAborted()
      return this.monitor(instance, 'research-status', await instance.rpc({ operation: 'research-run', selection: input, ...(project.task_id ? {jobId:String(project.task_id)} : {}) }), onEvent, signal)
    }, ['parent','text','web'])
  }
  async runReport(project, selection, snapshot, onEvent, signal) {
    signal?.throwIfAborted()
    const input = validateReportSelection(selection)
    const roles = reportModelRoles(input)
    const policy = validateReportSnapshot(snapshot,input)
    return this.withTask(project, policy, signal, async instance => {
      signal?.throwIfAborted()
      return this.monitor(instance, 'report-status', await instance.rpc({ operation: 'report-run', selection: input }), onEvent, signal)
    }, roles)
  }
  listArtifacts(project) { return listProjectArtifacts(project.workspace) }
  readArtifact(project, id) { return readProjectArtifact(project.workspace, id) }
  async executionTrace(project, { since } = {}) { return (await this.open(project)).rpc({ operation: 'execution-trace', ...(since === undefined ? {} : { since }) }) }
  async dispose(instance) {
    await instance.harness.close()
    if (instance.temp) await rm(instance.temp, { recursive: true, force: true })
  }
  close(id) {
    if (this.closing.has(id)) return this.closing.get(id)
    const pending = this.instances.get(id)
    if (!pending) return Promise.resolve()
    const closing = (async () => { try { await this.dispose(await pending) } finally {
      if (this.instances.get(id) === pending) { this.instances.delete(id); this.snapshots.delete(id) }
    } })().finally(() => this.closing.delete(id))
    this.closing.set(id, closing)
    return closing
  }
  async closeAll() { await Promise.allSettled([...this.instances.keys()].map(id => this.close(id))) }
}
