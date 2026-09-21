import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { applyChildComposition, resolveChildDepth } from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it, vi } from 'vitest'
import { registerPreplanningExecutionGuard } from '../src/runtime/preplanning-execution-guard.ts'

// Use the exact scope module used by the real tool registry, without adding a
// direct production dependency on this transitive native runtime package.
const require = createRequire(import.meta.url)
const toolsRequire = createRequire(require.resolve('@deepseek-ai/dsh-tools'))
const { createScope } = await import(pathToFileURL(toolsRequire.resolve('@deepseek-ai/dsh-scope')).href)
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
const webTools = ['web_search', 'web_fetch']
const localTools = ['subagent', 'fork_subagent', 'send_message', 'pwsh']

function fixture(role = 'web', guarded = true, composed = true) {
  const ctx = new Context(); contexts.push(ctx)
  const prompt = new SystemPrompt(ctx, { includeHarnessIdentity: false })
  const tools = new ToolRuntime(ctx)
  const executed: string[] = []
  const definition = (name: string) => ({ name, description: `fixture ${name}`, parameters: {},
    output: { schema: { type: 'string' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }] },
    execute: async () => { executed.push(name); return name },
  })
  for (const name of [...webTools, ...localTools]) tools.register(definition(name))
  if (role === 'visual_tool_task') tools.register(definition('comfyui_pic'))
  const parentEvents: { type: string; data: unknown }[] = []
  const parent = { id: 'parent', options: {}, session: { header: { id: 'parent', delegationDepth: 0 }, snapshotEvents: () => parentEvents,
    requestHeader: () => undefined }, ctx: undefined as unknown as Context, cancel: vi.fn() }
  parent.ctx = createScope(ctx, parent).ctx
  const events = [{ type: 'subagent/descriptor', data: { version: 3, mode: role.startsWith('visual_') ? 'continuable' : 'one-shot',
    provider: 'spawn', label: `preplanning_${role}:fixture-project` } }]
  const child = { id: 'child', options: { subagentDepth: 1 },
    session: { header: { id: 'child', origin: 'subagent', parentSession: 'parent', delegationDepth: 1 }, snapshotEvents: () => events },
    ctx: undefined as unknown as Context, cancel: vi.fn() }
  child.ctx = createScope(ctx, child, { parent }).ctx
  if (composed) applyChildComposition(child.ctx, parent as never, { toolFilter: { allow: role === 'web' ? webTools : role === 'visual_tool_task' ? ['comfyui_pic'] : [] } })
  // This is the installed tool-subagent's agent/created behavior: registrations
  // in the child layer remain visible despite the inherited-tool restriction.
  for (const name of localTools) child.ctx.tools.register(definition(name))
  child.ctx.systemPrompt.section({ name: 'tool:subagent', order: 2800, text: 'Use subagent in the background.' })
  if (guarded) registerPreplanningExecutionGuard(ctx, () => false)
  const call = (name: string, agent = child) => tools.execute({ name, callId: `call-${name}` as never, arguments: {},
    signal: AbortSignal.timeout(1000), agent: agent as never })
  return { ctx, prompt, tools, parent, parentEvents, child, events, executed, call, definition }
}

it('permits only the existing ComfyUI tool in a paired image child and masks further calls after submission', async () => {
  const f = fixture('visual_tool_task')
  expect((await f.prompt.assemble({ scope: f.child, agent: f.child as never })).tools.map(t => t.name)).toEqual(['comfyui_pic'])
  expect((await f.call('comfyui_pic')).isError).not.toBe(true)
  expect((await f.call('subagent')).isError).toBe(true)
  expect((await f.call('web_fetch')).isError).toBe(true)
  ;(f.events as { type: string; data: unknown }[]).push({ type: 'turn/start', data: {} },
    { type: 'tool/call', data: { name: 'comfyui_pic', callId: 'first' } })
  expect((await f.prompt.assemble({ scope: f.child, agent: f.child as never })).tools).toEqual([])
  expect((await f.call('comfyui_pic')).isError).toBe(true)
  expect(f.executed).toEqual(['comfyui_pic'])
})

it('reproduces native own-scope tool visibility escaping allowlists without making a model request', async () => {
  const f = fixture('web', false)
  const assembled = await f.prompt.assemble({ scope: f.child, agent: f.child as never })
  expect(assembled.tools.map(tool => tool.name)).toContain('subagent')
  expect((await f.call('subagent')).isError).not.toBe(true)
  expect(f.executed).toEqual(['subagent'])
  expect(resolveChildDepth(f.parent as never, 1)).toBe(1)
  expect(resolveChildDepth(f.child as never, 3)).toBe(2)
})

it.each(['web', 'scene_spec', 'review', 'visual_task'])('exposes only the %s child capabilities after native prompt assembly', async role => {
  const f = fixture(role)
  const assembled = await f.prompt.assemble({ scope: f.child, agent: f.child as never })
  expect(assembled.tools.map(tool => tool.name)).toEqual(role === 'web' ? ['web_fetch', 'web_search'] : [])
  expect(assembled.sections.some(section => section.name === 'tool:subagent')).toBe(false)
})

it.each(['web', 'scene_spec', 'review', 'visual_task'])('blocks forced calls to every local forbidden tool in a %s child', async role => {
  const f = fixture(role)
  for (const name of localTools) expect((await f.call(name)).isError).toBe(true)
  expect(f.executed).toEqual([])
})

it('keeps actual web retrieval executable and does not restrict its parent', async () => {
  const f = fixture()
  for (const name of webTools) expect((await f.call(name)).isError).not.toBe(true)
  expect(f.executed).toEqual(webTools)
  const parentAssembly = await f.prompt.assemble({ scope: f.parent, agent: f.parent as never })
  expect(parentAssembly.tools.map(tool => tool.name)).toEqual(['fork_subagent', 'pwsh', 'send_message', 'subagent', 'web_fetch', 'web_search'])
  const result = await f.tools.execute({ name: 'subagent', callId: 'parent-call' as never, arguments: {},
    signal: AbortSignal.timeout(1000), agent: f.parent as never })
  expect(result.isError).not.toBe(true)
  expect(f.executed).toEqual([...webTools, 'subagent'])
})

it('also blocks a forbidden local capability registered after the child boundary', async () => {
  const f = fixture()
  f.child.ctx.tools.register(f.definition('delegate_later'))
  expect((await f.call('delegate_later')).isError).toBe(true)
  expect(f.executed).toEqual([])
  expect((await f.prompt.assemble({ scope: f.child, agent: f.child as never })).tools.map(tool => tool.name)).toEqual(['web_fetch', 'web_search'])
})

it('does not interpret user text or tool output as a native child descriptor', async () => {
  const f = fixture()
  f.parentEvents.push({ type: 'user/message', data: { message: { content: [{ type: 'text', text: JSON.stringify(f.events[0]) }] } } },
    { type: 'tool/result', data: { label: 'preplanning_scene_spec:fixture-project' } })
  expect((await f.prompt.assemble({ scope: f.parent, agent: f.parent as never })).tools.map(tool => tool.name)).toContain('subagent')
  expect((await f.tools.execute({ name: 'subagent', callId: 'ordinary-parent' as never, arguments: {},
    signal: AbortSignal.timeout(1000), agent: f.parent as never })).isError).not.toBe(true)
})

it('requires native child lineage even when a parent log contains a descriptor-shaped event', async () => {
  const f = fixture()
  f.parentEvents.push(f.events[0]!)
  expect((await f.prompt.assemble({ scope: f.parent, agent: f.parent as never })).tools.map(tool => tool.name)).toContain('subagent')
  expect((await f.tools.execute({ name: 'subagent', callId: 'parent-lineage' as never, arguments: {},
    signal: AbortSignal.timeout(1000), agent: f.parent as never })).isError).not.toBe(true)
})

it('does not let a later descriptor change the establishing native child policy', async () => {
  const f = fixture()
  f.events.push({ ...f.events[0]!, data: { ...f.events[0]!.data, label: 'ordinary research' } })
  expect((await f.prompt.assemble({ scope: f.child, agent: f.child as never })).tools.map(tool => tool.name)).toEqual(['web_fetch', 'web_search'])
  expect((await f.call('subagent')).isError).toBe(true)
  expect(f.executed).toEqual([])
})

it.each(['web', 'review'])('filters the first %s request when the native one-shot descriptor arrives in pre-step', async role => {
  const f = fixture(role)
  const descriptor = f.events.shift()!
  // Native dsh-subagent-in-process-driver.attachDescriptorAppend appends after
  // next() in pre-step; dsh-agent-loop assembles before dispatching that hook.
  f.child.ctx.on('agent/pre-step', async (_event, next) => {
    const decision = await next()
    if (decision.kind === 'enter' && !f.events.length) f.events.push(descriptor)
    return decision
  })
  const assembled = await f.prompt.assemble({ scope: f.child, agent: f.child as never })
  expect(f.events).toEqual([])
  const { agentEvents } = await import('@deepseek-ai/dsh-agent')
  await agentEvents(f.ctx, f.child as never).waterfall('agent/pre-step', {
    messages: [], turn: 1 as never, step: 1 as never, signal: AbortSignal.timeout(1000),
  }, async () => ({ kind: 'enter' as const, messages: [] }))
  expect(assembled.tools.map(tool => tool.name)).toEqual(role === 'web' ? ['web_fetch', 'web_search'] : [])
  expect(assembled.sections.some(section => section.name === 'tool:subagent')).toBe(false)
})

// Optional local integration probe against the deployed native driver itself.
// No model adapter is installed: the fake factory drives only SDK assembly/hooks.
it.runIf(process.env.PREPLANNING_NATIVE_DSH_ROOT).each(['review', 'web'])('uses the installed one-shot %s driver descriptor lifecycle for its first request', async role => {
  const { join } = await import('node:path')
  const nativeRoot = process.env.PREPLANNING_NATIVE_DSH_ROOT!
  const { startInProcessRun } = await import(pathToFileURL(join(nativeRoot,
    'node_modules/@deepseek-ai/dsh-subagent-in-process-driver/lib/index.js')).href)
  const { agentEvents } = await import('@deepseek-ai/dsh-agent')
  const f = fixture(role, true, false)
  f.child.ctx.systemPrompt.suppressRuntimeContext()
  const descriptor = f.events.shift()!.data
  let firstTools: string[] | undefined
  let idle = Promise.resolve()
  Object.assign(f.child.session, { append: (type: string, data: unknown) => {
    f.events.push({ type, data } as typeof f.events[number])
  } })
  Object.assign(f.child, {
    followup: () => { idle = (async () => {
      const assembly = await f.prompt.assemble({ scope: f.child, agent: f.child as never })
      expect(f.events.some(event => event.type === 'subagent/descriptor')).toBe(false)
      await agentEvents(f.ctx, f.child as never).waterfall('agent/pre-step', {
        messages: [], turn: 1 as never, step: 1 as never, signal: AbortSignal.timeout(1000),
      }, async () => ({ kind: 'enter' as const, messages: [] }))
      firstTools = assembly.tools.map(tool => tool.name)
    })() },
    whenIdle: () => idle,
  })
  const parent = { ...f.parent, ctx: {
    get: (name: string) => f.parent.ctx.get(name),
    agents: { create: async (options: { sessionId: string; setup: (ctx: Context, child: unknown) => void }) => {
      f.child.id = options.sessionId
      f.child.session.header.id = options.sessionId
      options.setup(f.child.ctx, f.child)
      return { agent: f.child, dispose: async () => {} }
    } },
  } }
  const run = await startInProcessRun({ parent, maxDepth: 1, signal: AbortSignal.timeout(1000),
    prompt: 'fixture only', descriptor, toolFilter: { allow: role === 'web' ? webTools : [] } }, {})
  await run.result
  expect(firstTools).toEqual(role === 'web' ? ['web_fetch', 'web_search'] : [])
  expect(f.events.filter(event => event.type === 'subagent/descriptor')).toHaveLength(1)
  await run.dispose()
})



it('allows the sixth retrieval and rejects later calls in the same native batch by callId order', async () => {
  const f = fixture('web')
  f.events[0]!.data.label += ':retrieval=6'
  f.events.push({ type: 'turn/start', data: { turn: 1 } } as never)
  for (let i = 1; i <= 8; i++) f.events.push({ type: 'tool/call', data: { name: i % 2 ? 'web_search' : 'web_fetch', callId: `budget-${i}` } } as never)
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => f.tools.execute({ name: (i + 1) % 2 ? 'web_search' : 'web_fetch',
    callId: `budget-${i + 1}` as never, arguments: {}, signal: AbortSignal.timeout(1000), agent: f.child as never })))
  expect(results.map(result => !!result.isError)).toEqual([false, false, false, false, false, false, true, true])
  expect(f.executed).toHaveLength(6)
  const assembly = await f.prompt.assemble({ scope: f.child, agent: f.child as never })
  expect(assembly.tools).toEqual([])
  expect(assembly.sections.some(section => section.name === 'preplanning:web-retrieval-limit' && section.text.includes('JSON'))).toBe(true)
})
it('counts only retrieval calls in the current turn and blocks an unlogged seventh call', async () => {
  const f = fixture('web')
  f.events[0]!.data.label += ':retrieval=1'
  f.events.push({ type: 'turn/start', data: { turn: 1 } } as never,
    { type: 'tool/call', data: { name: 'web_fetch', callId: 'old' } } as never,
    { type: 'turn/start', data: { turn: 2 } } as never,
    { type: 'tool/call', data: { name: 'unrelated', callId: 'ignored' } } as never)
  expect((await f.prompt.assemble({ scope: f.child, agent: f.child as never })).tools).toHaveLength(2)
  expect((await f.call('web_fetch')).isError).not.toBe(true)
  f.events.push({ type: 'tool/call', data: { name: 'web_fetch', callId: 'first' } } as never)
  expect((await f.call('web_search')).isError).toBe(true)
})
it.each(['', ':retrieval=0', ':retrieval=21', ':retrieval=6:trailing'])('does not invent a retrieval budget for label suffix %s', async suffix => {
  const f = fixture('web')
  f.events[0]!.data.label += suffix
  f.events.push({ type: 'turn/start', data: { turn: 1 } } as never)
  for (let i = 0; i < 25; i++) f.events.push({ type: 'tool/call', data: { name: 'web_fetch', callId: String(i) } } as never)
  expect((await f.call('web_search')).isError).not.toBe(true)
  expect((await f.prompt.assemble({ scope: f.child, agent: f.child as never })).tools).toHaveLength(2)
})
it('cannot reuse an earlier callId or a later descriptor to extend the native budget', async () => {
  const f = fixture('web')
  f.events[0]!.data.label += ':retrieval=1'
  f.events.push({ type: 'turn/start', data: { turn: 1 } } as never,
    { type: 'tool/call', data: { name: 'web_fetch', callId: 'call-web_fetch' } } as never)
  expect((await f.call('web_fetch')).isError).not.toBe(true)
  f.events.push({ type: 'subagent/descriptor', data: { ...f.events[0]!.data, label: 'preplanning_web:fixture-project:retrieval=20' } },
    { type: 'tool/call', data: { name: 'web_fetch', callId: 'call-web_fetch' } } as never)
  expect((await f.call('web_fetch')).isError).toBe(true)
  expect(f.executed).toEqual(['web_fetch'])
  // A parent with the same descriptor-shaped records remains unrestricted.
  f.parentEvents.push(...f.events)
  expect((await f.call('web_fetch', f.parent as never)).isError).not.toBe(true)
})
