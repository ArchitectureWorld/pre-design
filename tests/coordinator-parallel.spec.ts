import { describe, expect, it, vi } from 'vitest'
import { AutomationCoordinator } from '../src/runtime/coordinator.ts'

describe('AutomationCoordinator parallel Ready Set selection', () => {
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
