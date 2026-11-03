import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { PreplanningSubagents } from '../src/runtime/dsh-subagents.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const parent = { id: 'parent' } as never
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pre-dsh-adapter-')); roots.push(root)
  const ctx = new Context(); contexts.push(ctx)
  const applied: string[] = []
  const child = (id: string, parentId = 'parent') => ({ id,
    session: { header: { parentSession: parentId } },
    ctx: { tools: { restrict: (value: unknown) => applied.push(JSON.stringify(value)) },
      systemPrompt: { section: (value: { text: string }) => applied.push(value.text) } },
  })
  const dispose = vi.fn(async () => {})
  const runtime = {
    startActivation: vi.fn(async (spec: any) => {
      await ctx.serial('agent/created', { agent: child(spec.childId) as never, source: 'create' as never })
      expect(applied).toEqual(['{"allow":[]}', 'Only return structured planning evidence.'])
      return { childId: spec.childId, result: Promise.resolve({ stopReason: 'completed', output: [] }), dispose }
    }),
    interrupt: vi.fn(), getProvider: vi.fn(() => ({})),
  }
  const adapter = new PreplanningSubagents(ctx, runtime as never, root)
  return { ctx, root, adapter, runtime, applied, child, dispose }
}
it('applies durable restrictions before publishing the new activation and owns cancellation/disposal', async () => {
  const f = await fixture(); const controller = new AbortController()
  const run = await f.adapter.start('spawn', { parent, signal: controller.signal,
    prompt: [{ type: 'text', text: 'plan' }], persona: 'Only return structured planning evidence.', toolFilter: { allow: [] }, label: 'preplanning_workflow:p:w' })
  expect(f.runtime.startActivation.mock.calls[0][0]).toMatchObject({ provider: 'spawn', delivery: 'caller' })
  expect(f.runtime.startActivation.mock.calls[0][0].request).not.toHaveProperty('toolFilter')
  expect(f.runtime.startActivation.mock.calls[0][0].request).not.toHaveProperty('persona')
  expect(run.id).toMatch(/^preplanning-child-/)
  expect(run.localAgent?.id).toBe(run.id)
  expect((await run.result).stopReason).toBe('completed')
  await run.dispose(); expect(f.dispose).toHaveBeenCalledOnce()
})
it('reapplies the saved policy on cold creation and rejects another parent', async () => {
  const f = await fixture()
  const run = await f.adapter.start('spawn', { parent, signal: new AbortController().signal,
    prompt: [], persona: 'Only return structured planning evidence.', toolFilter: { allow: [] }, label: 'preplanning_workflow:p:w' })
  const ctx = new Context(); contexts.push(ctx)
  new PreplanningSubagents(ctx, f.runtime as never, f.root)
  f.applied.length = 0
  await ctx.serial('agent/created', { agent: f.child(String(run.id)) as never, source: 'resume' as never })
  expect(f.applied).toEqual(['{"allow":[]}', 'Only return structured planning evidence.'])
  await expect(ctx.serial('agent/created', { agent: f.child(String(run.id), 'another') as never, source: 'resume' as never })).rejects.toThrow('CHILD_POLICY_PARENT_MISMATCH')
  await run.dispose()
})
it('fails closed for managed child identities whose policy is missing', async () => {
  const f = await fixture()
  await expect(f.ctx.serial('agent/created', { agent: f.child('preplanning-child-missing') as never, source: 'resume' as never })).rejects.toThrow('CHILD_POLICY_MISSING')
})
it('disposes an active child on cancellation exactly once', async () => {
  const f = await fixture(), controller = new AbortController()
  f.runtime.startActivation.mockImplementationOnce(async spec => ({ childId: spec.childId, result: new Promise(() => {}), dispose: f.dispose }))
  const run = await f.adapter.start('spawn', { parent, signal: controller.signal, prompt: [], toolFilter: { allow: [] } })
  controller.abort(new Error('cancelled'))
  await run.dispose()
  expect(f.dispose).toHaveBeenCalledOnce()
})
it('rejects cancellation before dispatch and conflicting policies on reuse', async () => {
  const f = await fixture(), controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await expect(f.adapter.start('spawn', { parent, signal: controller.signal, prompt: [], toolFilter: { allow: [] } })).rejects.toThrow('cancelled')
  expect(f.runtime.startActivation).not.toHaveBeenCalled()
  const signal = new AbortController().signal
  const run = await f.adapter.start('spawn', { parent, signal, prompt: [], toolFilter: { allow: [] }, persona: 'Only return structured planning evidence.' })
  await expect(f.adapter.startContinuable({ provider: 'spawn', childId: run.id, label: 'test', signal,
    request: { parent, prompt: [], toolFilter: { allow: ['bash'] } } })).rejects.toThrow('CHILD_POLICY_CONFLICT')
  expect(f.runtime.startActivation).toHaveBeenCalledOnce()
  await run.dispose()
})
it('rejects a runtime publishing a different child identity and closes it', async () => {
  const f = await fixture()
  f.runtime.startActivation.mockImplementationOnce(async () => ({ childId: 'unexpected', result: Promise.resolve({ stopReason: 'completed', output: [] }), dispose: f.dispose }))
  await expect(f.adapter.start('spawn', { parent, signal: new AbortController().signal, prompt: [], toolFilter: { allow: [] } })).rejects.toThrow('CHILD_ID_MISMATCH')
  expect(f.dispose).toHaveBeenCalledOnce()
})
