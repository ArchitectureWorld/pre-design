import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import { preplanningExecutionStop, registerPreplanningExecutionGuard } from '../src/runtime/preplanning-execution-guard.ts'

const descriptor = { type: 'subagent/descriptor', data: { label: 'preplanning_visual_task:any-project:any-scene:1' } }

it.each(['subagent', 'pwsh', 'studio_generate_design_visual'])('denies %s before its body can delegate or switch providers in a visual child', async name => {
  const ctx = new Context()
  ctx.provide('systemPrompt', { tools: () => () => {} } as never)
  const tools = new ToolRuntime(ctx)
  const execute = vi.fn(async () => ({ ran: true }))
  tools.register({ name, description: 'test capability', parameters: {}, output: {
    schema: { type: 'object', properties: { ran: { type: 'boolean' } }, required: ['ran'], additionalProperties: false },
    render: () => [{ type: 'text', text: 'ran' }],
  }, execute })
  registerPreplanningExecutionGuard(ctx, () => false)
  try {
    const result = await tools.execute({ name, callId: 'one-call' as never, arguments: {}, signal: new AbortController().signal,
      agent: { id: 'any-visual-child', session: { snapshotEvents: () => [descriptor] } } as never })
    expect(execute).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).toContain('PREPLANNING_VISUAL_NATIVE_IMAGE_ONLY')
  } finally { await ctx.fiber.dispose() }
})

it('does not restrict ordinary parent, text or web agent tools', () => {
  let guard: ((exec: any) => unknown) | undefined
  const ctx = { on: vi.fn(), tools: { guard: (fn: typeof guard) => { guard = fn } } } as unknown as Context
  registerPreplanningExecutionGuard(ctx, () => true)
  expect(guard).toBeTypeOf('function')
  for (const label of [undefined, 'preplanning_workflow:project:work', 'preplanning_web:project']) {
    expect(guard!({ agent: { session: { snapshotEvents: () => label ? [{ type: 'subagent/descriptor', data: { label } }] : [] } } })).toBeUndefined()
  }
  expect(guard!({})).toBeUndefined()
})

it('ends a visual tool attempt without another model step while permitting native image output', () => {
  const start = { type: 'turn/start', data: {} }
  expect(preplanningExecutionStop([descriptor, start, { type: 'tool/call', data: { name: 'subagent' } }], false)).toContain('PREPLANNING_VISUAL_NATIVE_IMAGE_ONLY')
  expect(preplanningExecutionStop([descriptor, start, { type: 'assistant/message', data: { message: { content: [{ type: 'image', attachment: {} }] } } }], false)).toBeUndefined()
})
