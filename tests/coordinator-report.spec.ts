import { describe, expect, it, vi } from 'vitest'
import { AutomationCoordinator } from '../src/runtime/coordinator.ts'

function fixture(complete = true) {
  const runtime = { current: () => undefined, nextReady: () => undefined, snapshot: () => ({ runs: [], blocked: [] }),
    isComplete: () => complete, running: () => [], transition: vi.fn() }
  const agent = { followup: vi.fn(), whenIdle: async () => undefined }
  return { runtime, agent }
}
describe('automatic report completion', () => {
  it('generates once when resuming an already complete project without model followups', async () => {
    const h = fixture()
    const generate = vi.fn(async () => undefined)
    const coordinator = new AutomationCoordinator(h.runtime as never, undefined, generate)
    await Promise.all([coordinator.start(h.agent, 'project'), coordinator.start(h.agent, 'project')])
    await vi.waitFor(() => expect(coordinator.isRunning('project')).toBe(false))
    expect(generate).toHaveBeenCalledOnce()
    expect(h.agent.followup).not.toHaveBeenCalled()
  })
  it('does not infer completion from an empty ready queue', async () => {
    const h = fixture(false)
    const generate = vi.fn(async () => undefined)
    const coordinator = new AutomationCoordinator(h.runtime as never, undefined, generate)
    await coordinator.start(h.agent, 'project')
    await vi.waitFor(() => expect(coordinator.isRunning('project')).toBe(false))
    expect(generate).not.toHaveBeenCalled()
  })
  it('exposes generation failure without reopening confirmed work', async () => {
    const h = fixture()
    const coordinator = new AutomationCoordinator(h.runtime as never, undefined, async () => { throw new Error('PDF_FAILED') })
    await coordinator.start(h.agent, 'project')
    await vi.waitFor(() => expect(coordinator.lastError('project')).toBe('PDF_FAILED'))
    expect(h.runtime.transition).not.toHaveBeenCalled()
  })
  it('cancels report generation when paused', async () => {
    const h = fixture()
    let signal: AbortSignal | undefined
    const generate = vi.fn(async (_id: string, abort: AbortSignal) => {
      signal = abort
      await new Promise<void>((_resolve, reject) => abort.addEventListener('abort', () => reject(abort.reason), { once: true }))
    })
    const coordinator = new AutomationCoordinator(h.runtime as never, undefined, generate)
    await coordinator.start(h.agent, 'project')
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
    await coordinator.pause('project')
    expect(signal?.aborted).toBe(true)
    expect(coordinator.isRunning('project')).toBe(false)
  })
})
