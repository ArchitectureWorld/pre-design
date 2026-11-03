import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { applyChildComposition, resolveChildDepth } from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it, vi } from 'vitest'
import { registerPreplanningExecutionGuard } from '../src/runtime/preplanning-execution-guard.ts'
import { PLANNING_PURPOSE_INSTRUCTION } from '../src/research-v2/planning-purpose.ts'

// Use the exact scope module used by the real tool registry, without adding a
// direct production dependency on this transitive native runtime package.
const require = createRequire(import.meta.url)
const toolsRequire = createRequire(require.resolve('@deepseek-ai/dsh-tools'))
const { createScope } = await import(pathToFileURL(toolsRequire.resolve('@deepseek-ai/dsh-scope')).href)
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
const webTools = ['web_search', 'web_fetch']
const structuredRoles = ['material_intake', 'workflow', 'module_text', 'module_review']
const localTools = ['subagent', 'fork_subagent', 'send_message', 'pwsh']

function fixture(role = 'web', guarded = true, composed = true, fetchText?: string, structuredSchema?: any) {
  const ctx = new Context(); contexts.push(ctx)
  const prompt = new SystemPrompt(ctx, { includeHarnessIdentity: false })
  const tools = new ToolRuntime(ctx)
  const executed: string[] = []
  const definition = (name: string) => ({ name, description: `fixture ${name}`, parameters: name==='structured_output'&&structuredSchema?structuredSchema:{},
    output: { schema: { type: 'string' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }] },
    execute: async () => { executed.push(name); return name === 'web_fetch' && fetchText !== undefined ? fetchText : name },
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
  if (structuredRoles.includes(role)||role.startsWith('chapter_')) child.ctx.tools.register(definition('structured_output'))
  child.ctx.systemPrompt.section({ name: 'tool:subagent', order: 2800, text: 'Use subagent in the background.' })
  if (guarded) registerPreplanningExecutionGuard(ctx, () => false)
  const call = (name: string, agent = child) => tools.execute({ name, callId: `call-${name}` as never, arguments: {},
    signal: AbortSignal.timeout(1000), agent: agent as never })
  return { ctx, prompt, tools, parent, parentEvents, child, events, executed, call, definition }
}

it('provides exact field feedback to the next chapter request after native schema rejection',async()=>{
 const schema={type:'object',required:['pages'],properties:{pages:{type:'array',items:{
  type:'object',required:['pageId','overlays'],properties:{pageId:{type:'string'},overlays:{type:'array'}}
 }}}}
 const f=fixture('chapter_layout-revision-test',true,true,undefined,schema)
 ;(f.events as {type:string;data:unknown}[]).push(
  {type:'tool/call',data:{name:'structured_output',callId:'rejected',arguments:JSON.stringify({pages:[{pageId:'p1'}]})}},
  {type:'tool/result',data:{error:{code:'INVALID_ARGS'},message:{source:{callId:'rejected'}}}})
 const assembled=await f.prompt.assemble({scope:f.child,agent:f.child as never})
 expect(assembled.tools.map(t=>t.name)).toEqual(['structured_output'])
 expect(assembled.sections.find(s=>s.name==='preplanning:chapter-schema-feedback')?.text).toContain('value.pages[0].overlays')
 expect((await f.prompt.assemble({scope:f.parent,agent:f.parent as never})).sections.some(s=>s.name==='preplanning:chapter-schema-feedback')).toBe(false)
})

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
it('keeps native source submission available after closing exhausted network tools', async () => {
  const f = fixture('web')
  f.child.ctx.tools.register(f.definition('structured_output'))
  f.events[0]!.data.label += ':retrieval=1'
  f.events.push({ type: 'turn/start', data: {} } as never,
    { type: 'tool/call', data: { name: 'web_fetch', callId: 'fetched-source' } } as never)
  const assembled = await f.prompt.assemble({ scope: f.child, agent: f.child as never })
  expect(assembled.tools.map(tool => tool.name)).toEqual(['structured_output'])
  expect((await f.call('structured_output')).isError).not.toBe(true)
  expect((await f.call('web_fetch')).isError).toBe(true)
  expect((await f.call('subagent')).isError).toBe(true)
  expect(f.executed).toEqual(['structured_output'])
})

it('keeps source intake on structured extraction without inheriting parent report/proposal orchestration', async () => {
  const f = fixture('material_intake')
  f.ctx.systemPrompt.section({ name: 'preplanning-agent', order: 120, text: 'PARENT_REPORT_INSTRUCTIONS: call preplanning_get_context and submit ProposalEnvelope' })
  f.ctx.systemPrompt.section({ name: 'unrelated-policy', order: 100, text: 'Keep unrelated host policy.' })
  const assembled = await f.prompt.assemble({ scope: f.child, agent: f.child as never })
  expect(assembled.tools.map(tool => tool.name)).toEqual(['structured_output'])
  expect(assembled.sections.some(section => section.text.includes('PARENT_REPORT_INSTRUCTIONS'))).toBe(false)
  expect(assembled.sections.find(section => section.name === 'preplanning-agent')?.text).toContain('逐字')
  expect(assembled.sections.find(section => section.name === 'unrelated-policy')?.text).toBe('Keep unrelated host policy.')
  expect((await f.call('structured_output')).isError).not.toBe(true)
  expect((await f.call('subagent')).isError).toBe(true)
  expect((await f.call('web_fetch')).isError).toBe(true)
  const parent = await f.prompt.assemble({ scope: f.parent, agent: f.parent as never })
  expect(parent.sections.find(section => section.name === 'preplanning-agent')?.text).toContain('PARENT_REPORT_INSTRUCTIONS')
})

it.each(['workflow', 'module_text', 'module_review'])('restricts the %s native child to its own structured submission tool', async role => {
  const f = fixture(role)
  f.ctx.systemPrompt.section({ name: 'preplanning-agent', order: 120, text: 'PARENT_REPORT_INSTRUCTIONS: submit proposals and delegate report work' })
  const assembled = await f.prompt.assemble({ scope: f.child, agent: f.child as never })
  expect(assembled.tools.map(tool => tool.name)).toEqual(['structured_output'])
  expect(assembled.sections.some(section => section.text.includes('PARENT_REPORT_INSTRUCTIONS'))).toBe(false)
  expect(assembled.sections.find(section => section.name === 'preplanning-agent')?.text).toContain('structured_output')
  for (const name of [...localTools, ...webTools]) expect((await f.call(name)).isError).toBe(true)
  expect((await f.call('structured_output')).isError).not.toBe(true)
  expect(f.executed).toEqual(['structured_output'])
  expect((await f.tools.execute({ name: 'subagent', callId: 'parent-stays-unrestricted' as never, arguments: {},
    signal: AbortSignal.timeout(1000), agent: f.parent as never })).isError).not.toBe(true)
})
it.each(['chapter_layout-revision-abcd','chapter_visual-review-0','chapter_scene-briefs-v1','chapter_content-table-correction-abcd'])('keeps %s on report submission and blocks inherited coding or delegation',async role=>{
  const f=fixture(role)
  f.ctx.systemPrompt.section({name:'preplanning-agent',order:120,text:'PARENT_REPORT_INSTRUCTIONS: delegate work and inspect code'})
  const assembled=await f.prompt.assemble({scope:f.child,agent:f.child as never})
  expect(assembled.tools.map(t=>t.name)).toEqual(['structured_output'])
  expect(assembled.sections.some(s=>s.text.includes('PARENT_REPORT_INSTRUCTIONS'))).toBe(false)
  for(const name of localTools)expect((await f.call(name)).isError).toBe(true)
  expect((await f.call('structured_output')).isError).not.toBe(true)
})

it.each(['module_text', 'module_review'])('puts the approved planning purpose in the %s native system role instead of relying on source packets', async role => {
  const f = fixture(role)
  f.ctx.systemPrompt.section({ name: 'preplanning-agent', order: 120, text: 'PARENT_REPORT_INSTRUCTIONS' })
  f.ctx.systemPrompt.section({ name: 'unrelated-policy', order: 100, text: 'Keep host policy.' })
  const assembled = await f.prompt.assemble({ scope: f.child, agent: f.child as never })
  const roleText = assembled.sections.find(section => section.name === 'preplanning-agent')!.text
  expect(roleText).toContain(PLANNING_PURPOSE_INSTRUCTION)
  expect(roleText).toContain('研究选择必须写入对应专业字段和evidence')
  expect(roleText).toContain('structured_output')
  expect(roleText).toContain('审查角色不得替作者补写事实或绕过检查')
  expect(assembled.sections.find(section => section.name === 'unrelated-policy')?.text).toBe('Keep host policy.')
  expect(assembled.tools.map(tool => tool.name)).toEqual(['structured_output'])
  const parentAssembly = await f.prompt.assemble({ scope: f.parent, agent: f.parent as never })
  expect(parentAssembly.sections.find(section => section.name === 'preplanning-agent')?.text).toBe('PARENT_REPORT_INSTRUCTIONS')
})

it.each(['web', 'material_intake', 'workflow'])('does not grant scheme-authoring duties to a %s child', async role => {
  const f = fixture(role)
  f.ctx.systemPrompt.section({ name: 'preplanning-agent', order: 120, text: 'PARENT_REPORT_INSTRUCTIONS' })
  const assembled = await f.prompt.assemble({ scope: f.child, agent: f.child as never })
  expect(assembled.sections.find(section => section.name === 'preplanning-agent')?.text).not.toContain(PLANNING_PURPOSE_INSTRUCTION)
})

it('keeps inline webpage image bytes as inert text only in the native research child without changing the canonical fetched value', async () => {
  const source = '原文结论：数据需申请。\n![二维码](data:image/png;base64,AA\nBB==)\n来源日期 2025-01-01'
  const f = fixture('web', true, true, source)
  const childResult = await f.call('web_fetch')
  expect(childResult).toMatchObject({ isError: false, value: source })
  expect(childResult.content).toEqual([{ type: 'text', text: expect.stringContaining('![二维码](data&#58;image/png;base64,AA\nBB==)') }])
  const rendered = (childResult.content[0] as { text: string }).text
  expect(rendered).toContain('图像内容尚未识别')
  expect(rendered).toContain('原文结论：数据需申请。')
  expect(rendered).toContain('来源日期 2025-01-01')
  expect(rendered).not.toContain('data:image/')
  const parentResult = await f.call('web_fetch', f.parent as never)
  expect(parentResult.content).toEqual([{ type: 'text', text: source }])
})

it('does not override a later tool policy block when rendering webpage text', async () => {
  const f = fixture('web', true, true, '![x](data:image/png;base64,AAAA)')
  f.ctx.on('tools/post-execute', async () => ({ kind: 'block', feedback: [{ type: 'text', text: 'policy refused' }] }))
  const result = await f.call('web_fetch')
  expect(result.isError).toBe(true)
  expect(result.content).toEqual([{ type: 'text', text: 'policy refused' }])
})

it('preserves a later canonical replacement instead of projecting the superseded fetched value', async () => {
  const f = fixture('web', true, true, '![x](data:image/png;base64,AAAA)')
  f.ctx.on('tools/post-execute', async () => ({ kind: 'accept', value: 'redacted by policy' }))
  const result = await f.call('web_fetch')
  expect(result).toMatchObject({ isError: false, value: 'redacted by policy', content: [{ type: 'text', text: 'redacted by policy' }] })
})

it('projects the composed content while retaining its canonical source and non-text blocks', async () => {
  const f = fixture('web', true, true, 'canonical fetched text')
  const image = { type: 'image' as const, attachment: { attachmentId: 'fixture-image' as never,
    mediaType: 'image/png' as const, bytes: 4, width: 1, height: 1 } }
  f.ctx.on('tools/post-execute', async () => ({ kind: 'accept', content: [
    { type: 'text', text: 'hook annotation ![map](DATA:IMAGE/png;base64,BBBB)' }, image,
  ] }))
  const result = await f.call('web_fetch')
  expect(result.value).toBe('canonical fetched text')
  expect(result.content[0]).toMatchObject({ text: expect.stringContaining('hook annotation ![map](DATA&#58;IMAGE/png;base64,BBBB)') })
  expect(result.content[1]).toEqual(image)
})

it('leaves ordinary webpage text, remote image links and failed tool results unchanged', async () => {
  const source = '普通资料 ![图](https://example.test/image.png)'
  const f = fixture('web', true, true, source)
  expect((await f.call('web_fetch')).content).toEqual([{ type: 'text', text: source }])
  f.ctx.on('tools/execute', async () => { throw new Error('error data:image/png;base64,AAAA') })
  const failure = await f.call('web_fetch')
  expect(failure.isError).toBe(true)
  expect(failure.content).toEqual([{ type: 'text', text: expect.stringContaining('error data:image/png;base64,AAAA') }])
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

it.each(['web', 'review', ...structuredRoles])('filters the first %s request when the native one-shot descriptor arrives in pre-step', async role => {
  const f = fixture(role)
  f.ctx.systemPrompt.section({ name: 'preplanning-agent', order: 120, text: 'PARENT_REPORT_INSTRUCTIONS' })
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
  expect(assembled.tools.map(tool => tool.name)).toEqual(role === 'web' ? ['web_fetch', 'web_search'] : structuredRoles.includes(role) ? ['structured_output'] : [])
  expect(assembled.sections.some(section => section.name === 'tool:subagent')).toBe(false)
  expect(assembled.sections.find(section => section.name === 'preplanning-agent')?.text.includes('PARENT_REPORT_INSTRUCTIONS')).toBe(!structuredRoles.includes(role))
})

// Optional local integration probe against the deployed native driver itself.
// No model adapter is installed: the fake factory drives only SDK assembly/hooks.
it.runIf(process.env.PREPLANNING_NATIVE_DSH_ROOT).each(['review', 'web', ...structuredRoles])('uses the installed one-shot %s driver descriptor lifecycle for its first request', async role => {
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
  expect(firstTools).toEqual(role === 'web' ? ['web_fetch', 'web_search'] : structuredRoles.includes(role) ? ['structured_output'] : [])
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
