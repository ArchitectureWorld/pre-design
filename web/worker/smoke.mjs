// P0 spike only: not a production worker or a public API.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

const root = dirname(fileURLToPath(import.meta.url))
const controlOnly = process.argv.includes('--control-only')
const runtimeRoot = resolve(root, '../../.cache/dsh-p0')
await mkdir(runtimeRoot, { recursive: true, mode: 0o700 })
const runRoot = await mkdtemp(`${runtimeRoot}/run-`)
const dshHome = resolve(runRoot, 'home')
const workspace = resolve(runRoot, 'workspace')
await mkdir(dshHome, { mode: 0o700 })
await mkdir(workspace, { mode: 0o700 })
const settings = process.env.PRE_DSH_SETTINGS
const provider = process.env.PRE_DSH_PROVIDER ?? 'deepseek-official'
const model = process.env.PRE_DSH_MODEL ?? 'deepseek-v4-flash'
const childEnv = { ...process.env, PRE_DESIGN_PRESENTATION_PROJECT_ROOT: resolve(runRoot, 'presentation-projects') }
const patches = []
if (settings) {
  const config = parse(await readFile(resolve(settings), 'utf8'))
  const providers = Array.isArray(config)
    ? config.find(entry => entry.id === 'llm-pi-ai')?.config?.providers
    : config?.['llm-pi-ai']?.providers
  assert.ok(providers, 'Settings/profile must contain llm-pi-ai providers')
  const route = providers[provider]
  assert.ok(route, `Provider ${provider} missing from settings`)
  if (process.env.PRE_DSH_CREDENTIALS) {
    assert.ok(route.apiKeyEnv, 'Selected provider has no apiKeyEnv reference')
    const credentials = parse(await readFile(resolve(process.env.PRE_DSH_CREDENTIALS), 'utf8'))
    const value = credentials?.refs?.[route.apiKeyEnv]
    assert.ok(typeof value === 'string' && value.trim(), 'Selected credential reference missing')
    childEnv[route.apiKeyEnv] = value
  }
  const patch = resolve(runRoot, 'model.cordis.yml')
  await writeFile(patch, JSON.stringify([{ id: 'llm-pi-ai', config: { providers: { [provider]: route } } }]), { mode: 0o600 })
  patches.push(patch)
}
const hostProbe = process.env.PRE_DSH_HOST === '1'
if (hostProbe) {
  childEnv.PRE_DSH_HOST_READY = resolve(runRoot, 'host-ready.json')
  const patch = resolve(runRoot, 'host.cordis.yml')
  await writeFile(patch, JSON.stringify([
    { insert: [
      { id: 'preplanning-agent', name: resolve(root, '.host-build/lib/index.mjs') },
      { id: 'preplanning-p0-probe', name: resolve(root, 'host-probe.mjs') },
    ] },
    { id: 'sdk-jsonrpc-server', inject: ['sdkAppStartup', 'loader', 'preplanningP0Ready'] },
  ]), { mode: 0o600 })
  patches.push(patch)
}
const report = { status: 'running', controlOnly, hostProbe, node: process.version,
  dsh: '0.2.1-rc.5', provider, model, workspace, dshHome, checks: [] }
let harness
let timer
let timedOut = false
const options = { profile: 'sdk', patches, env: childEnv, dshHome, cwd: workspace, processCwd: workspace,
  provider, model, initializeTimeoutMs: 30000, requestTimeoutMs: 180000 }
const check = (name, extra = {}) => {
  report.checks.push({ name, ...extra })
  console.log(`PASS ${name}`)
}
async function start() {
  harness = new DeepSeekHarness(options)
  await harness.start()
}
async function close() {
  if (harness) await harness.close()
  harness = undefined
}
async function verifyTurn(session, prompt, token, name, requireTool) {
  const result = await session.run(prompt)
  await writeFile(resolve(runRoot, `${name}.json`), JSON.stringify(result, null, 2), { mode: 0o600 })
  const failedTurn = result.events.find(event => event.type === 'turn/end' && event.data.reason?.kind === 'error')
  assert.ok(!failedTurn, `Agent failed: ${JSON.stringify(failedTurn?.data.reason)}`)
  assert.ok(result.finalResponse.includes(token), 'Response does not contain the expected marker')
  assert.ok(result.events.length > 0, 'No session events')
  const eventTypes = [...new Set(result.events.map(event => event.type))]
  if (requireTool) assert.ok(eventTypes.some(type => type?.startsWith('tool/')), 'No tool event observed')
  if (hostProbe && requireTool) {
    const call = result.events.find(event => event.type === 'tool/call' && event.data.name === 'preplanning_read_material')
    assert.ok(call, 'Professional material tool was not called')
    const results = result.events.filter(event => event.type === 'tool/result').map(event => event.data.message)
    assert.ok(results.some(block => block.toolCallId === call.data.callId && !block.isError && JSON.stringify(block.content).includes(token)), 'Professional tool did not return the marker successfully')
    const project = JSON.parse(await readFile(childEnv.PRE_DSH_HOST_READY + '.project', 'utf8'))
    assert.equal(project.currentRevision, 0)
    check('domain-project-created', { projectId: project.projectId })
  }
  if (!requireTool) assert.ok(!eventTypes.includes('tool/call'), 'History check used tools instead of conversation history')
  check(name, { eventCount: result.events.length, eventTypes })
}
try {
  timer = setTimeout(() => {
    timedOut = true
    void harness?.close().catch(() => {})
  }, 240000)
  for (const name of ['dsh', 'dsh-sdk-client']) {
    const pkg = JSON.parse(await readFile(resolve(root, `node_modules/@deepseek-ai/${name}/package.json`), 'utf8'))
    assert.equal(pkg.version, '0.2.1-rc.5')
  }
  const [major, minor] = process.versions.node.split('.').map(Number)
  assert.ok(major > 24 || (major === 24 && minor >= 11), 'Use the pinned Node runtime (see README)')
  check('versions')
  await start()
  check('initialize')
  if (hostProbe) {
    const ready = JSON.parse(await readFile(childEnv.PRE_DSH_HOST_READY, 'utf8'))
    assert.equal(ready.pluginId, 'preplanning-agent')
    assert.equal(ready.hasWebServer, false)
    check('headless-host', ready)
  }
  const session = harness.session()
  report.sessionId = session.id
  assert.equal(await session.setWorkingDirectory(workspace), workspace)
  assert.equal(await session.getWorkingDirectory(), workspace)
  check('working-directory')
  const token = randomUUID()
  if (!controlOnly) {
    await writeFile(resolve(workspace, 'p0-marker.txt'), token, { mode: 0o600 })
    await verifyTurn(session,
      hostProbe
        ? 'First call p0_create_project, then preplanning_get_context, then use preplanning_read_material with path p0-marker.txt. Reply with the exact file contents. Do not use any generic file tools or shell, and do not modify files.'
        : 'Read p0-marker.txt in your working directory using a file tool. Reply with its exact contents. Do not modify any files.',
      token, 'real-file-read', true)
  }
  if (!controlOnly && hostProbe) {
    const delegated = await session.run('Call p0_delegate once. Return the exact marker reported by that tool. Do not call any other tool.')
    assert.ok(delegated.finalResponse.includes('CHILD_ACTIVATION_OK'))
    const receipt = JSON.parse(await readFile(childEnv.PRE_DSH_HOST_READY + '.child', 'utf8'))
    assert.equal(receipt.stopReason, 'completed')
    assert.ok(receipt.childId.startsWith('preplanning-child-'))
    check('real-restricted-child-activation', { childId: receipt.childId })
  }
  if (!controlOnly) await unlink(resolve(workspace, 'p0-marker.txt'))
  await close()
  check('shutdown')
  await start()
  if (hostProbe && !controlOnly) {
    const before = JSON.parse(await readFile(childEnv.PRE_DSH_HOST_READY + '.project', 'utf8'))
    const after = JSON.parse(await readFile(childEnv.PRE_DSH_HOST_READY, 'utf8'))
    assert.deepEqual(after.projectIds, [before.projectId])
    check('domain-project-persisted')
  }
  const restored = await harness.resumeSession(report.sessionId)
  assert.equal(restored.id, report.sessionId)
  assert.equal(await restored.getWorkingDirectory(), workspace)
  check('resume-original-session')
  if (!controlOnly) await verifyTurn(restored,
    'What was the exact marker read in our previous conversation? Answer from conversation history without using tools.',
    token, 'history-after-restart', false)
  assert.equal(timedOut, false, 'Overall deadline exceeded')
  report.status = hostProbe ? 'host-load-probe-passed-not-full-P0-B' : controlOnly ? 'control-only-passed-not-P0' : 'P0-A-passed'
} catch (error) {
  report.status = 'failed'
  report.error = timedOut ? 'Overall 240000ms deadline exceeded; SDK runtime closed' : String(error)
  process.exitCode = 1
} finally {
  clearTimeout(timer)
  try { await close() } catch (error) {
    report.status = 'failed'
    report.cleanupError = String(error)
    process.exitCode = 1
  }
  await writeFile(resolve(runRoot, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(report, null, 2))
  console.log(`Evidence: ${runRoot}`)
}
