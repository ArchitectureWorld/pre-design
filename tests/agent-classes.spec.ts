import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentClassService } from '../src/agent-classes/service.ts'
import { WebQueryAgent } from '../src/agent-classes/web-query.ts'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture(modelTurnAuthorization?: (projectId: string, parentId: string) => { authorizationId: string; grantedAt: string; maxModelTurns: number | null } | undefined) {
  const root = await mkdtemp(join(tmpdir(), 'pre-agent-class-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const llm = {
    listProviders: () => [{ id: 'test', name: 'Test' }],
    listConfigurableProviders: () => [{ provider: 'dormant', displayName: 'Dormant' }],
    listModels: vi.fn(async () => [{ provider: 'test', id: 'a', name: 'A' }, { provider: 'test', id: 'b', name: 'B' }]),
  }
  const events: { type: string; data: unknown }[] = []
  const childEvents = new Map<string, typeof events>()
  const deps = { llm: llm as never, sessions: { get: vi.fn((id: string) => ({ snapshotEvents: () => childEvents.get(id) ?? events })) },
    activity: vi.fn<() => 'running' | 'idle' | undefined>(() => undefined), modelTurnAuthorization }
  const service = await AgentClassService.open(ctx.storage.domain, deps)
  return { root, ctx, service, deps, llm, events, childEvents }
}
const a = { provider: 'test', model: 'a' }
const b = { provider: 'test', model: 'b' }
const parent = { id: 'parent', options: a } as never

async function comfyFixture() {
  const f = await fixture()
  f.llm.listProviders = () => [{ id: 'test', name: 'Test' }, { id: 'Comfyui-PIC', name: 'ComfyUI' }]
  f.llm.listModels.mockImplementation(async (provider?: string) => provider === 'Comfyui-PIC'
    ? [{ provider, id: 'Klein', name: 'Klein' }]
    : [a, b].map(r => ({ provider: r.provider, id: r.model, name: r.model })))
  Object.assign(f.deps, { tools: { schemas: () => [{ name: 'comfyui_pic' }] } })
  return f
}
const comfy = { provider: 'Comfyui-PIC', model: 'Klein' }
it('requires an explicit LLM for primary and backup ComfyUI routes and persists it globally', async () => {
  const { service, ctx, deps } = await comfyFixture()
  const routes = { image: comfy, text: a, web: a }
  await expect(service.save(0, routes)).rejects.toThrow('MODEL_COMPANION_REQUIRED')
  await expect(service.save(0, { ...routes, image: a }, { image: [comfy] })).rejects.toThrow('MODEL_COMPANION_REQUIRED')
  await service.save(0, { ...routes, image: { ...comfy, llm: a } }, { image: [b] })
  expect(await service.catalog()).toContainEqual(expect.objectContaining({ provider: comfy.provider,
    models: [expect.objectContaining({ id: comfy.model, imageTool: 'comfyui_pic' })] }))
  await service.close()
  const restored = await AgentClassService.open(ctx.storage.domain, deps)
  expect((await restored.view('unrelated-project')).settings.routes.image).toEqual({ ...comfy, llm: a })
})
it('rejects tool recursion, non-image tool routes and companions attached to direct image models', async () => {
  const { service } = await comfyFixture()
  const routes = { image: a, text: a, web: a }
  await expect(service.save(0, { ...routes, image: { ...comfy, llm: comfy } })).rejects.toThrow('MODEL_COMPANION_INVALID')
  await expect(service.save(0, { ...routes, text: { ...comfy, llm: a } })).rejects.toThrow('MODEL_TOOL_CLASS_INVALID')
  await expect(service.save(0, { ...routes, image: { ...a, llm: b } })).rejects.toThrow('MODEL_COMPANION_INVALID')
  await expect(service.save(0, { ...routes, image: { ...comfy, llm: { provider: 'gone', model: 'x' } } })).rejects.toThrow('MODEL_UNAVAILABLE')
})
it('verifies the companion as the actual model and preserves the paired fallback snapshot', async () => {
  const { service, events } = await comfyFixture()
  await service.save(0, { image: a, text: a, web: a }, { image: [{ ...comfy, llm: b }] })
  const first = await service.begin('p', 'image', 'scene', parent)
  await service.attach(first.id, 'child')
  events.push({ type: 'request/header', data: { header: { config: a } } },
    { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'SERVER' } } } })
  await service.finish(first.id, 'failed')
  await service.save(1, { image: { ...comfy, llm: a }, text: a, web: a }, { image: [] })
  const backup = (await service.fallback(first.id, parent))!
  expect(backup.selected).toEqual({ ...comfy, llm: b })
  events.splice(0, events.length, { type: 'request/header', data: { header: { config: b } } },
    { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  await service.attach(backup.id, 'child-backup')
  await service.finish(backup.id, 'completed')
  expect(service.execution(backup.id)).toMatchObject({ actual: b, selected: { ...comfy, llm: b }, status: 'completed' })
})
it('skips a missing image tool without dispatch and rejects a child using the wrong companion', async () => {
  const { service, deps, events } = await comfyFixture()
  await service.save(0, { image: { ...comfy, llm: a }, text: a, web: a }, { image: [b] })
  Object.assign(deps, { tools: { schemas: () => [] } })
  const fallback = await service.begin('p', 'image', 'scene', parent)
  expect(fallback.selected).toEqual(b)
  expect((await service.executions('p')).find(row => row.selected.provider === comfy.provider)).toMatchObject({ status: 'failed', availabilityFailure: 'catalog' })
  Object.assign(deps, { tools: { schemas: () => [{ name: 'comfyui_pic' }] } })
  const run = await service.begin('p', 'image', 'another scene', parent)
  await service.attach(run.id, 'wrong-child')
  events.push({ type: 'request/header', data: { header: { config: b } } })
  await expect(service.finish(run.id, 'completed')).rejects.toThrow('MODEL_ROUTE_MISMATCH')
})
it('verifies a settled ComfyUI companion from persisted evidence after the native child unloads', async () => {
  const { service, deps } = await comfyFixture()
  await service.save(0, { image: { ...comfy, llm: b }, text: a, web: a })
  const run = await service.begin('p', 'image', 'scene', parent)
  await service.attach(run.id, 'unloaded-child')
  deps.sessions.get.mockReturnValue(undefined as never)
  const readPersistedEvents = vi.fn(async () => [
    { type: 'request/header', data: { header: { config: b } } },
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
  ])
  Object.assign(deps, { readPersistedEvents })
  await service.finish(run.id, 'completed')
  expect(readPersistedEvents).toHaveBeenCalledWith('unloaded-child')
  expect(service.execution(run.id)).toMatchObject({ actual: b, status: 'completed', childStopReason: 'completed' })
})

it.runIf(process.platform === 'win32')('survives a temporary Windows reader lock without duplicating task reservations', async () => {
  const grant = { authorizationId: 'locked-store', grantedAt: new Date().toISOString(), maxModelTurns: 2 }
  const { root, service } = await fixture(() => grant)
  await service.save(0, { image: a, text: a, web: a, review: a })
  const child = spawn('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$h=[System.IO.File]::Open($env:PRE_DESIGN_TEST_LOCK_PATH,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite); try { [Console]::WriteLine('locked'); Start-Sleep -Milliseconds 500 } finally { $h.Dispose() }"],
    { windowsHide: true, env: { ...process.env, PRE_DESIGN_TEST_LOCK_PATH: join(root, 'preplanning_agent_classes.json') }, stdio: ['ignore', 'pipe', 'pipe'] })
  const closed = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`lock helper exit ${code}`))) })
  try {
    await new Promise<void>((resolve, reject) => { child.once('error', reject); child.stdout.on('data', data => { if (String(data).includes('locked')) resolve() }); child.once('exit', () => reject(new Error('reader exited before readiness'))) })
    const rows = await Promise.all([service.begin('p', 'text', 'one', parent), service.begin('p', 'review', 'two', parent)])
    expect(new Set(rows.map(row => row.id)).size).toBe(2)
    await expect(service.begin('p', 'text', 'third', parent)).rejects.toThrow('PREPLANNING_MODEL_TURN_LIMIT')
    expect((await service.view('p')).executions).toHaveLength(2)
  } finally { await closed }
}, 10_000)

it('persists ordered global backups, keeps them on legacy saves, and rejects duplicates and stale writes', async () => {
  const { service, ctx, deps } = await fixture()
  const routes = { image: a, web: a, text: a, review: a }
  await (service.save as any)(0, routes, { text: [b], review: [b] })
  expect(service.settings()).toMatchObject({ fallbacks: { text: [b], review: [b] } })
  await service.save(1, routes)
  expect(service.settings()).toMatchObject({ fallbacks: { text: [b], review: [b] } })
  await expect((service.save as any)(1, routes, { text: [] })).rejects.toThrow('CONFIG_CONFLICT')
  await expect((service.save as any)(2, routes, { text: [a] })).rejects.toThrow('MODEL_ROUTE_DUPLICATE')
  await expect((service.save as any)(2, routes, { text: [b, b] })).rejects.toThrow('MODEL_ROUTE_DUPLICATE')
  await (service.save as any)(2, routes, { text: [] })
  await service.close()
  const reopened = await AgentClassService.open(ctx.storage.domain, deps)
  expect((await reopened.view('another-project')).settings).toMatchObject({ fallbacks: { text: [], review: [b] } })
})

it('skips removed catalog routes with a durable failed attempt and a separately reserved backup', async () => {
  const { service, llm } = await fixture()
  await (service.save as any)(0, { image: a, web: a, text: a }, { text: [b] })
  llm.listModels.mockResolvedValue([{ provider: 'test', id: 'b', name: 'B' }])
  const run = await service.begin('p', 'text', 'task', parent)
  expect(run.selected).toEqual(b)
  expect(run).toMatchObject({ routeIndex: 1, routeChain: [a, b] })
  const history = await service.executions('p')
  expect(history).toHaveLength(2)
  expect(history.find(r => r.selected.model === 'a')).toMatchObject({ status: 'failed', availabilityFailure: 'catalog' })
  expect(history.find(r => r.selected.model === 'a')?.childId).toBeUndefined()
})

it('keeps native failed children and budget while falling back in the snapshotted order after disposal', async () => {
  const { service, childEvents, deps } = await fixture()
  await (service.save as any)(0, { image: a, web: a, text: a }, { text: [b] })
  const first = await service.begin('p', 'text', 'task', parent)
  await service.attach(first.id, 'failed-child')
  childEvents.set('failed-child', [{ type: 'request/header', data: { header: { config: a } } },
    { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'RATE_LIMIT', message: 'secret credential' } } } }])
  await service.finish(first.id, 'failed', 'provider failure')
  await (service.save as any)(1, { image: a, web: a, text: a }, { text: [] })
  deps.sessions.get.mockReturnValue(undefined as never)
  const second = await (service as any).fallback(first.id, parent, AbortSignal.timeout(1000))
  expect(second).toMatchObject({ selected: b, configurationRevision: 1, routeIndex: 1, fallbackFromExecutionId: first.id, chainId: (first as any).chainId })
  expect(service.execution(first.id)).toMatchObject({ status: 'failed', childId: 'failed-child', actual: a, availabilityFailure: 'rate-limit' })
  expect(JSON.stringify(await service.executions('p'))).not.toContain('secret credential')
  expect(parent).toMatchObject({ options: a })
})

it.each(['completed', 'aborted', 'unknown', 'CONTEXT_WINDOW_EXCEEDED', 'INVALID_ARGS', 'EMPTY_RESPONSE'])('never falls back for content, cancellation, unknown result or non-availability failure: %s', async code => {
  const { service, events } = await fixture()
  await (service.save as any)(0, { image: a, web: a, text: a }, { text: [b] })
  const run = await service.begin('p', 'text', 'task', parent)
  await service.attach(run.id, 'child')
  events.push({ type: 'request/header', data: { header: { config: a } } })
  if (code !== 'unknown') events.push({ type: 'turn/end', data: { reason: ['completed','aborted'].includes(code) ? { kind: code } : { kind: 'error', error: { code, message: '503 429 transport failed' } } } })
  await service.finish(run.id, 'failed', 'CONTENT_INVALID')
  expect(await (service as any).fallback(run.id, parent, AbortSignal.timeout(1000))).toBeUndefined()
  expect(await service.executions('p')).toHaveLength(1)
})

it('does not renew an exhausted model grant for a fallback', async () => {
  const { service, events } = await fixture(() => ({ authorizationId: 'grant', grantedAt: '2026-01-01T00:00:00Z', maxModelTurns: 1 }))
  await (service.save as any)(0, { image: a, web: a, text: a }, { text: [b] })
  const first = await service.begin('p', 'text', 'task', parent)
  await service.attach(first.id, 'child')
  events.push({ type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'SERVER' } } } })
  await service.finish(first.id, 'failed')
  await expect((service as any).fallback(first.id, parent, AbortSignal.timeout(1000))).rejects.toThrow('MODEL_TURN_LIMIT')
  expect(await service.executions('p')).toHaveLength(1)
})

it.each([
  ['AUTH', undefined, 'provider'], ['MISSING_CREDENTIAL', undefined, 'provider'], ['INVALID_CREDENTIAL', undefined, 'provider'],
  ['NO_ADAPTER', undefined, 'provider'], ['MODEL_NOT_FOUND', undefined, 'provider'], ['PROVIDER_NOT_FOUND', undefined, 'provider'],
  ['QUOTA', 429, 'provider'], ['TRANSPORT', undefined, 'transport'], ['NETWORK', undefined, 'transport'],
  ['CONNECTION', undefined, 'transport'], ['ECONNREFUSED', undefined, 'transport'], ['ECONNRESET', undefined, 'transport'],
  ['ENOTFOUND', undefined, 'transport'], ['EAI_AGAIN', undefined, 'transport'], ['RATE_LIMIT', undefined, 'rate-limit'],
  ['SERVER', undefined, 'server'], ['UNKNOWN', 429, 'rate-limit'], ['UNKNOWN', 503, 'server'],
] as const)('switches only from a known native availability failure: %s / %s', async (code, status, category) => {
  const { service, events } = await fixture()
  await service.save(0, { image: a, web: a, text: a }, { text: [b] })
  const first = await service.begin('p', 'text', 'task', parent)
  await service.attach(first.id, 'child')
  events.push({ type: 'request/header', data: { header: { config: a } } },
    { type: 'turn/end', data: { reason: { kind: 'error', error: { code, status, message: 'secret provider text' } } } })
  await service.finish(first.id, 'failed')
  expect(await service.fallback(first.id, parent)).toMatchObject({ selected: b, fallbackFromExecutionId: first.id })
  expect(service.execution(first.id)).toMatchObject({ availabilityFailure: category, childStopReason: 'error', actual: a })
  expect(JSON.stringify(await service.executions('p'))).not.toContain('secret provider text')
})
it.each(['CONTEXT_WINDOW_EXCEEDED', 'INVALID_ARGS', 'EMPTY_RESPONSE', 'ABORTED', 'CANCELLED'])('does not let structured HTTP status override non-availability %s', async code => {
  const { service, events } = await fixture()
  await service.save(0, { image: a, web: a, text: a }, { text: [b] })
  const first = await service.begin('p', 'text', 'task', parent); await service.attach(first.id, 'child')
  events.push({ type: 'turn/end', data: { reason: { kind: 'error', error: { code, status: 503 } } } })
  await service.finish(first.id, 'failed')
  expect(await service.fallback(first.id, parent)).toBeUndefined()
})
it('preserves an omitted legacy review route alongside its backups', async () => {
  const { service } = await fixture()
  await service.save(0, { image: a, web: a, text: a, review: a }, { review: [b] })
  await service.save(1, { image: a, web: a, text: a })
  expect(service.settings()).toMatchObject({ routes: { review: a }, fallbacks: { review: [b] } })
})
it('does not reserve or switch a catalog route after cancellation while reading the live catalog', async () => {
  const { service, llm } = await fixture()
  await service.save(0, { image: a, web: a, text: a }, { text: [b] })
  const controller = new AbortController()
  llm.listModels.mockImplementationOnce(async () => { controller.abort(new Error('user cancelled')); return [] })
  await expect(service.begin('p', 'text', 'task', parent, controller.signal)).rejects.toThrow('user cancelled')
  expect(await service.executions('p')).toMatchObject([{ status: 'cancelled', selected: a }])
})
it.each(['running', 'restarted', 'mismatch', 'cancelled', 'wrong-parent'] as const)('refuses a stale fallback when the original child is %s', async scenario => {
  const { service, events, deps } = await fixture()
  await service.save(0, { image: a, web: a, text: a }, { text: [b] })
  const first = await service.begin('p', 'text', 'task', parent); await service.attach(first.id, 'child')
  events.push({ type: 'request/header', data: { header: { config: scenario === 'mismatch' ? b : a } } },
    { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'SERVER' } } } })
  await service.finish(first.id, scenario === 'cancelled' ? 'cancelled' : 'failed')
  if (scenario === 'running') deps.activity.mockReturnValue('running')
  if (scenario === 'restarted') events.push({ type: 'turn/start', data: {} })
  expect(await service.fallback(first.id, scenario === 'wrong-parent' ? { id: 'other' } as never : parent)).toBeUndefined()
  expect(await service.executions('p')).toHaveLength(1)
})
it('reserves only one continuation when concurrent callers request the same backup', async () => {
  const { service, events } = await fixture()
  await service.save(0, { image: a, web: a, text: a }, { text: [b] })
  const first = await service.begin('p', 'text', 'task', parent); await service.attach(first.id, 'child')
  events.push({ type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'SERVER' } } } })
  await service.finish(first.id, 'failed')
  const results = await Promise.allSettled([service.fallback(first.id, parent), service.fallback(first.id, parent)])
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect(String((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason)).toContain('MODEL_FALLBACK_ALREADY_STARTED')
  expect(await service.executions('p')).toHaveLength(2)
})
it('attempts multiple backups in their configured order once and stops at the end of the chain', async () => {
  const { service, childEvents, llm } = await fixture(), c = { provider: 'test', model: 'c' }
  llm.listModels.mockResolvedValue([a, b, c].map(r => ({ provider: r.provider, id: r.model, name: r.model })))
  await service.save(0, { image: a, web: a, text: a }, { text: [c, b] })
  let current = await service.begin('p', 'text', 'task', parent)
  const chainId = current.chainId
  for (const [index, route] of [a, c, b].entries()) {
    expect(current).toMatchObject({ selected: route, chainId, routeIndex: index, routeChain: [a, c, b] })
    await service.attach(current.id, route.model)
    childEvents.set(route.model, [{ type: 'request/header', data: { header: { config: route } } },
      { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'RATE_LIMIT' } } } }])
    await service.finish(current.id, 'failed')
    const next = await service.fallback(current.id, parent)
    if (index === 2) expect(next).toBeUndefined()
    else { expect(next!.fallbackFromExecutionId).toBe(current.id); current = next! }
  }
  expect(await service.executions('p')).toHaveLength(3)
})
it('keeps the failed image reservation when its visual grant cannot admit a configured backup', async () => {
  const { service, events } = await fixture(() => ({ authorizationId: 'grant', grantedAt: '2026-01-01T00:00:00Z', maxModelTurns: 10, maxVisualGenerations: 1 }))
  await service.save(0, { image: a, web: a, text: a }, { image: [b] })
  const first = await service.begin('p', 'image', 'task', parent); await service.attach(first.id, 'child')
  events.push({ type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'QUOTA', status: 429 } } } })
  await service.finish(first.id, 'failed')
  await expect(service.fallback(first.id, parent)).rejects.toThrow('PREPLANNING_VISUAL_BUDGET_LIMIT')
  expect(await service.executions('p')).toHaveLength(1)
})

it('uses a backup in the native web entrypoint only after an evidenced terminal provider error', async () => {
  const { service, childEvents, deps } = await fixture()
  await (service.save as any)(0, { image: a, web: a, text: a }, { web: [b] })
  const start = vi.fn(async (_: unknown, request: any) => {
    const route = request.agentOptions, id = `child-${route.model}`
    childEvents.set(id, [{ type: 'request/header', data: { header: { config: route } } },
      ...(route.model === 'b' ? [{ type: 'tool/call', data: { callId: 'fetch', name: 'web_fetch' } },
        { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'fetch', content: [{ type: 'text', text: 'source' }] }] } } }] : []),
      { type: 'turn/end', data: { reason: route.model === 'a' ? { kind: 'error', error: { code: 'TRANSPORT' } } : { kind: 'completed' } } }])
    return { id, result: Promise.resolve({ stopReason: route.model === 'a' ? 'error' : 'completed', output: [{ type: 'text', text: 'source summary' }] }), dispose: vi.fn() }
  })
  const web = new WebQueryAgent({ classes: service, sessions: deps.sessions, tools: { get: () => ({}) }, subagents: { start } } as never)
  const result = await web.query(parent, 'p', 'query', AbortSignal.timeout(1000))
  expect(start.mock.calls.map(call => call[1].agentOptions.model)).toEqual(['a','b'])
  expect(service.execution(result.executionId)).toMatchObject({ selected: b, actual: b, status: 'completed', routeIndex: 1 })
  expect(await service.executions('p')).toHaveLength(2)
})

it('runs on-demand images even after the text grant is spent without consuming or resetting text reservations', async () => {
  const grant = { authorizationId: 'on-demand', grantedAt: '2026-01-01T00:00:00Z', maxModelTurns: 1,
    maxVisualGenerations: 0, projectVisualBudget: 0, visualBudgetMode: 'on_demand' as const }
  const { service } = await fixture(() => grant)
  await service.save(0, { image: a, web: a, text: a })
  await service.begin('p', 'text', 'text task', parent)
  await expect(service.begin('p', 'image', 'scene one', parent)).resolves.toMatchObject({ classId: 'image' })
  await expect(service.begin('p', 'image', 'scene two', parent)).resolves.toMatchObject({ classId: 'image' })
  await expect(service.begin('p', 'text', 'text overflow', parent)).rejects.toThrow('MODEL_TURN_LIMIT')
  expect(await service.executions('p')).toHaveLength(3)
})

it('reserves image grants atomically and retains the project budget across renewed model grants', async () => {
  let grant = { authorizationId: 'image-grant', grantedAt: '2026-01-01T00:00:00Z', maxModelTurns: 10, maxVisualGenerations: 1, projectVisualBudget: 1 }
  const { service } = await fixture(() => grant)
  await service.save(0, { image: a, web: a, text: a })
  const runs = await Promise.allSettled([1,2].map(() => service.begin('p','image','scene',parent)))
  expect(runs.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect(String((runs.find(r => r.status === 'rejected') as PromiseRejectedResult).reason)).toContain('VISUAL_BUDGET_LIMIT')
  grant = { ...grant, authorizationId: 'new-grant' }
  await expect(service.begin('p','image','another scene',parent)).rejects.toThrow('VISUAL_BUDGET_LIMIT')
  await expect(service.begin('p','text','text task',parent)).resolves.toMatchObject({ classId: 'text' })
})

it('admits only the authorized number of concurrent model turns across agent classes', async () => {
  const authorization = { authorizationId: 'auth-p', grantedAt: '2026-01-01T00:00:00Z', maxModelTurns: 2 }
  const { service } = await fixture(projectId => projectId === 'p' ? authorization : undefined)
  await service.save(0, { image: a, web: a, text: a })
  const results = await Promise.allSettled(['text', 'web', 'image', 'text'].map(classId =>
    service.begin('p', classId as 'text' | 'web' | 'image', 'task', parent)))
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2)
  expect(results.filter(result => result.status === 'rejected').map(result => String(result.reason)))
    .toEqual([expect.stringContaining('PREPLANNING_MODEL_TURN_LIMIT'), expect.stringContaining('PREPLANNING_MODEL_TURN_LIMIT')])
  expect(await service.executions('p')).toHaveLength(2)
  await expect(service.begin('unrelated', 'text', 'task', parent)).resolves.toMatchObject({ projectId: 'unrelated' })
})

it('preserves consumed reservations after failure and restart instead of resetting the authorization budget', async () => {
  const { service, ctx, deps } = await fixture(() => ({ authorizationId: 'auth-p', grantedAt: '2026-01-01T00:00:00Z', maxModelTurns: 1 }))
  const run = await service.begin('p', 'text', 'task', parent)
  await service.finish(run.id, 'failed', 'transport failed')
  await service.close()
  const reopened = await AgentClassService.open(ctx.storage.domain, deps)
  await expect(reopened.begin('p', 'text', 'retry', parent)).rejects.toThrow('PREPLANNING_MODEL_TURN_LIMIT')
  expect(await reopened.executions('p')).toHaveLength(1)
})

it('removes an exhausted task cap explicitly without resetting history, grant identity or restart persistence', async () => {
  let grant: { authorizationId: string; grantedAt: string; maxModelTurns: number | null } = {
    authorizationId: 'same-grant', grantedAt: '2026-01-01T00:00:00Z', maxModelTurns: 1,
  }
  const { service, ctx, deps } = await fixture(() => grant)
  await service.save(0, { image: a, web: a, text: a, review: a })
  const prior = await service.begin('p', 'text', 'original failed task', parent)
  await service.finish(prior.id, 'failed', 'original failure')
  const preserved = service.execution(prior.id)
  await expect(service.begin('p', 'web', 'over finite limit', parent)).rejects.toThrow('PREPLANNING_MODEL_TURN_LIMIT')
  grant = { ...grant, maxModelTurns: null }
  const continued = await Promise.all((['text', 'web', 'review', 'text', 'web'] as const)
    .map(classId => service.begin('p', classId, 'continued task', parent)))
  for (const run of continued) await service.finish(run.id, 'cancelled', 'test completed')
  expect(new Set(continued.map(run => run.id)).size).toBe(5)
  expect(continued.every(run => run.automationAuthorizationId === 'same-grant')).toBe(true)
  await service.close()
  const reopened = await AgentClassService.open(ctx.storage.domain, deps)
  await expect(reopened.begin('p', 'review', 'after restart', parent)).resolves.toMatchObject({ automationAuthorizationId: 'same-grant' })
  expect(await reopened.executions('p')).toHaveLength(7)
  expect(reopened.execution(prior.id)).toEqual(preserved)
})

it('keeps a separate bounded image allowance when only the model-task cap is removed', async () => {
  const grant = { authorizationId: 'no-task-cap', grantedAt: '2026-01-01T00:00:00Z', maxModelTurns: null,
    maxVisualGenerations: 1, projectVisualBudget: 1 }
  const { service } = await fixture(() => grant)
  await service.save(0, { image: a, web: a, text: a })
  await service.begin('p', 'image', 'first image', parent)
  await expect(service.begin('p', 'image', 'second image', parent)).rejects.toThrow('PREPLANNING_VISUAL_BUDGET_LIMIT')
  await expect(service.begin('p', 'text', 'text remains available', parent)).resolves.toMatchObject({ classId: 'text' })
})

it('counts all legacy dispatches in the active authorization window, including beyond the UI history limit', async () => {
  let authorization: { authorizationId: string; grantedAt: string; maxModelTurns: number } | undefined
  const { service } = await fixture(() => authorization)
  for (let i = 0; i < 101; i++) await service.begin('p', 'text', `legacy ${i}`, parent)
  authorization = { authorizationId: 'auth-p', grantedAt: '2026-01-01T00:00:00Z', maxModelTurns: 101 }
  await expect(service.begin('p', 'text', 'exceeds historical budget', parent)).rejects.toThrow('PREPLANNING_MODEL_TURN_LIMIT')
})

it('scopes reservations to their authorization and includes only untagged legacy runs since the grant', async () => {
  let authorization = { authorizationId: 'old-auth', grantedAt: '2026-01-01T00:00:00Z', maxModelTurns: 1 }
  const { service } = await fixture(() => authorization)
  await service.begin('p', 'text', 'old', parent)
  authorization = { ...authorization, authorizationId: 'new-auth' }
  await expect(service.begin('p', 'text', 'new', parent)).resolves.toMatchObject({ automationAuthorizationId: 'new-auth' })
  await expect(service.begin('p', 'text', 'over limit', parent)).rejects.toThrow('PREPLANNING_MODEL_TURN_LIMIT')
})

it('uses the live DSH directory, including dormant providers, without a model allowlist', async () => {
  const { service, llm } = await fixture()
  expect(await service.catalog()).toMatchObject([{ provider: 'test', models: [{ id: 'a' }, { id: 'b' }] }, { provider: 'dormant', models: [], available: false }])
  llm.listModels.mockResolvedValue([{ provider: 'test', id: 'new-model', name: 'New' }])
  expect((await service.catalog())[0].models.map(row => row.id)).toEqual(['new-model'])
})

it('persists global classes across projects and rejects stale saves and removed models', async () => {
  const { service, ctx, deps, llm } = await fixture()
  await service.save(0, { image: a, web: b, text: b })
  await expect(service.save(0, { image: a, web: a, text: a })).rejects.toThrow('CONFIG_CONFLICT')
  expect((await service.view('p2', a)).settings.routes.text).toEqual(b)
  await service.close()
  const reopened = await AgentClassService.open(ctx.storage.domain, deps)
  expect(reopened.settings()).toMatchObject({ revision: 1, routes: { image: a, web: b, text: b } })
  llm.listModels.mockResolvedValue([{ provider: 'test', id: 'a', name: 'A' }])
  await expect(reopened.begin('p1', 'text', 'task', parent)).rejects.toThrow('MODEL_UNAVAILABLE')
  await expect(reopened.save(1, { image: a, web: b, text: a })).rejects.toThrow('MODEL_UNAVAILABLE')
})

it('snapshots dispatch settings and records actual model only from child request evidence', async () => {
  const { service, events } = await fixture()
  await service.save(0, { image: a, web: a, text: a })
  const run = await service.begin('p', 'text', '01.01', parent)
  await service.attach(run.id, 'child')
  await service.save(1, { image: b, web: b, text: b })
  expect((await service.executions('p'))[0]).toMatchObject({ selected: a, childId: 'child', status: 'running' })
  expect((await service.executions('p'))[0].actual).toBeUndefined()
  events.push({ type: 'request/header', data: { header: { config: a } } })
  await service.finish(run.id, 'completed')
  expect((await service.executions('p'))[0]).toMatchObject({ selected: a, actual: a, status: 'completed' })
  expect((await service.begin('p', 'text', 'next', parent)).selected).toEqual(b)
  expect(await service.executions('other')).toEqual([])
  expect((await service.begin('other', 'text', 'another project', parent)).selected).toEqual(b)
})

it('captures the initial DSH route once and never follows later project or parent model changes', async () => {
  const { service, ctx, deps } = await fixture()
  expect((await service.view('p1', a)).settings.routes.text).toEqual(a)
  expect((await service.view('p2', b)).settings.routes.text).toEqual(a)
  await service.close()
  const reopened = await AgentClassService.open(ctx.storage.domain, deps)
  expect((await reopened.begin('p3', 'web', 'query', { id: 'other-parent', options: b } as never)).selected).toEqual(a)
})

it('never marks an unexecuted or mismatched model as completed', async () => {
  const { service, events } = await fixture()
  const first = await service.begin('p', 'text', 'missing', parent)
  await service.attach(first.id, 'child')
  await expect(service.finish(first.id, 'completed')).rejects.toThrow('MODEL_EXECUTION_UNVERIFIED')
  events.push({ type: 'request/header', data: { header: { config: b } } })
  await expect(service.finish(first.id, 'completed')).rejects.toThrow('MODEL_ROUTE_MISMATCH')
})
it('shows child inactivity separately from a task awaiting result validation', async () => {
  const { service, events } = await fixture()
  const run = await service.begin('p', 'text', 'task', parent)
  await service.attach(run.id, 'child')
  events.push({ type: 'turn/start', data: {} }, { type: 'request/header', data: { header: { config: a } } }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  expect((await service.executions('p'))[0]).toMatchObject({ activity: 'idle', status: 'running' })
  events.push({ type: 'turn/start', data: {} })
  expect((await service.executions('p'))[0]).toMatchObject({ activity: 'unknown' })
})
it('refuses successful task completion when the latest child turn actually failed', async () => {
  const { service, events } = await fixture()
  const run = await service.begin('p', 'text', 'task', parent)
  await service.attach(run.id, 'child')
  events.push({ type: 'request/header', data: { header: { config: a } } }, { type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'synthetic provider failure', code: 'TEST' } } } })
  await expect(service.finish(run.id, 'completed')).rejects.toThrow('CHILD_EXECUTION_FAILED')
  expect((await service.executions('p'))[0]).toMatchObject({ status: 'failed', activity: 'idle' })
})
it('retains terminal activity after the disposed child session leaves the live store', async () => {
  const { service, events, deps } = await fixture()
  const run = await service.begin('p', 'text', 'task', parent)
  await service.attach(run.id, 'child')
  events.push({ type: 'request/header', data: { header: { config: a } } }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  await service.finish(run.id, 'completed')
  deps.sessions.get.mockReturnValue(undefined as never)
  expect((await service.executions('p'))[0]).toMatchObject({ status: 'completed', actual: a, activity: 'idle' })
})

it.each([
  ['MISSING_CREDENTIAL', 'no API key', 'MODEL_CREDENTIAL_MISSING'],
  ['AUTH', 'refresh_token_invalidated', 'MODEL_LOGIN_EXPIRED'],
  ['AUTH', 'invalid API key', 'MODEL_AUTH_FAILED'],
  ['SERVER', '503: {"code":"no_healthy_account"}', 'MODEL_ACCOUNT_UNAVAILABLE'],
] as const)('preserves a safe actionable native failure after disposal: %s %s', async (code, message, expected) => {
  const { service, events, deps } = await fixture()
  const run = await service.begin('p', 'text', 'task', parent)
  await service.attach(run.id, 'child')
  events.push({ type: 'request/header', data: { header: { config: a } } },
    { type: 'turn/end', data: { reason: { kind: 'error', error: { code, message: `${message} private-secret https://example.com/?token=private-secret` } } } })
  await service.finish(run.id, 'failed', 'IMAGE_REVIEW_FAILED: error')
  deps.sessions.get.mockReturnValue(undefined as never)
  const recorded = (await service.executions('p'))[0]
  expect(recorded).toMatchObject({ status: 'failed', actual: a, activity: 'idle', error: expect.stringContaining(expected) })
  expect(recorded?.error).not.toMatch(/private-secret|example\.com/u)
})

it('does not attribute an earlier login failure to a new turn or overwrite validation errors', async () => {
  const { service, events } = await fixture()
  const run = await service.begin('p', 'text', 'task', parent)
  await service.attach(run.id, 'child')
  events.push({ type: 'request/header', data: { header: { config: a } } },
    { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'AUTH', message: 'refresh_token_invalidated' } } } },
    { type: 'turn/start', data: {} })
  await service.finish(run.id, 'failed', 'IMAGE_REVIEW_OUTPUT_INVALID')
  expect(service.execution(run.id)?.error).toBe('IMAGE_REVIEW_OUTPUT_INVALID')
})

it('includes image inspection in the exhausted text grant and never inherits a generation model', async () => {
  const { service } = await fixture(() => ({ authorizationId: 'review-limit', grantedAt: '2026-01-01T00:00:00Z', maxModelTurns: 1, visualBudgetMode: 'on_demand' as const }))
  await service.save(0, { image: a, web: a, text: a })
  await expect(service.begin('p', 'review', 'inspect', parent)).rejects.toThrow('MODEL_UNAVAILABLE')
  await service.save(1, { image: a, web: a, text: a, review: b })
  await service.begin('p', 'review', 'inspect', parent)
  await expect(service.begin('p', 'text', 'text', parent)).rejects.toThrow('MODEL_TURN_LIMIT')
  await expect(service.begin('p', 'review', 'retry', parent)).rejects.toThrow('MODEL_TURN_LIMIT')
})
