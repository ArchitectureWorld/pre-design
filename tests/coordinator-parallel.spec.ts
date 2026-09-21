import { describe, expect, it, vi } from 'vitest'
import { AutomationCoordinator } from '../src/runtime/coordinator.ts'

describe('AutomationCoordinator parallel Ready Set selection', () => {
  it('continues later ready work after a failed batch and reports the incomplete tasks without a model followup', async () => {
    let rounds = 0
    const notice = vi.fn(async () => {})
    const runtime = { current: () => undefined, nextReady: () => undefined, isComplete: () => false,
      snapshot: () => ({ blocked: rounds ? [{ workflowId: 'failed' }] : [] }) }
    const agent = { followup: vi.fn(), whenIdle: async () => {} }
    const parallel = { canRun: () => rounds < 2, runReadyBatch: async () => {
      rounds++
      return { attempted: 1, completed: rounds === 2 ? 1 : 0, blocked: rounds === 1 ? 1 : 0, needsHuman: 0, revised: 0, approvedGates: 0 }
    } }
    const coordinator = new AutomationCoordinator(runtime as never, parallel, undefined, notice)
    await coordinator.start(agent, 'project')
    await vi.waitFor(() => expect(coordinator.isRunning('project')).toBe(false))
    expect(rounds).toBe(2)
    expect(coordinator.lastError('project')).toContain('1')
    expect(notice).toHaveBeenCalledOnce()
    expect(agent.followup).not.toHaveBeenCalled()
  })
  it('preserves an immediate resume when the superseded batch fails while draining', async () => {
    let rejectOld!: (error: unknown) => void
    const old = new Promise<any>((_resolve, reject) => { rejectOld = reject })
    let active: Promise<any> | undefined
    let ready = true
    const retryBlocked = vi.fn()
    const transition = vi.fn()
    const runtime = {
      current: () => undefined, running: () => [],
      nextReady: () => ready ? { workflowId: 'ready' } : undefined,
      snapshot: () => ({ blocked: [] }), retryBlocked, transition,
    }
    const parallel = {
      whenIdle: async () => { await active },
      canRun: () => ready,
      runReadyBatch: vi.fn(async () => {
        if (parallel.runReadyBatch.mock.calls.length === 1) {
          active = old
          try { return await old } finally { active = undefined }
        }
        ready = false
        return { attempted: 1, completed: 1, blocked: 0, needsHuman: 0, revised: 0, approvedGates: 0 }
      }),
    }
    const coordinator = new AutomationCoordinator(runtime as never, parallel)
    const agent = { followup: vi.fn(), whenIdle: async () => undefined }
    await coordinator.start(agent, 'project')
    await vi.waitFor(() => expect(parallel.runReadyBatch).toHaveBeenCalledOnce())
    await coordinator.pause('project')
    await coordinator.start(agent, 'project')
    rejectOld(new Error('old batch flush failed'))
    await vi.waitFor(() => expect(coordinator.isRunning('project')).toBe(false))
    expect(parallel.runReadyBatch).toHaveBeenCalledTimes(2)
    expect(transition).not.toHaveBeenCalled()
    expect(coordinator.lastError('project')).toBeUndefined()
  })

  it('runs parallel waves until no Ready workflow remains', async () => {
    let ready = 5
    const parallel = {
      canRun: vi.fn(() => ready >= 2),
      runReadyBatch: vi.fn(async () => {
        const attempted = Math.min(4, ready)
        ready -= attempted
        return { attempted, completed: attempted, blocked: 0, approvedGates: 0 }
      }),
    }
    const runtime = {
      current: vi.fn(() => undefined),
      nextReady: vi.fn(() => ready === 1
        ? { workflowId: 'preplan.wf.08.08', targetObjectId: 'IM08', title: '最终工作项' }
        : undefined),
      transition: vi.fn(async () => undefined),
      snapshot: vi.fn(() => ({ blocked: [] })),
    }
    const idle = Promise.resolve()
    const agent = {
      followup: vi.fn(async () => { ready = 0 }),
      whenIdle: vi.fn(() => idle),
    }
    const coordinator = new AutomationCoordinator(runtime as never, parallel as never)

    await coordinator.start(agent, 'preplan-1')
    await vi.waitFor(() => expect(coordinator.isRunning('preplan-1')).toBe(false))

    expect(parallel.runReadyBatch).toHaveBeenCalledOnce()
    expect(agent.followup).toHaveBeenCalledOnce()
    expect(runtime.transition).toHaveBeenCalledWith(
      'preplan-1', 'preplan.wf.08.08', { to: 'running' },
    )
  })

  it('preserves the existing serial path when parallel execution is unavailable', async () => {
    const turn = new Promise<void>(resolve => setTimeout(resolve, 0))
    let first = true
    const runtime = {
      current: vi.fn(() => undefined),
      nextReady: vi.fn(() => {
        if (!first) return undefined
        first = false
        return { workflowId: 'preplan.wf.01.01', targetObjectId: 'PS01', title: '项目身份' }
      }),
      transition: vi.fn(async () => undefined),
      snapshot: vi.fn(() => ({ blocked: [] })),
    }
    const parallel = { canRun: vi.fn(() => false), runReadyBatch: vi.fn() }
    const agent = { followup: vi.fn(async () => undefined), whenIdle: vi.fn(() => turn) }
    const coordinator = new AutomationCoordinator(runtime as never, parallel as never)

    await coordinator.start(agent, 'preplan-1')
    await vi.waitFor(() => expect(coordinator.isRunning('preplan-1')).toBe(false))

    expect(parallel.runReadyBatch).not.toHaveBeenCalled()
    expect(agent.followup).toHaveBeenCalledOnce()
  })
})
