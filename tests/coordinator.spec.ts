import { describe, expect, it, vi } from 'vitest'
import { AutomationCoordinator } from '../src/runtime/coordinator.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('AutomationCoordinator', () => {
  it('follows up one descriptor per idle turn and stops after pause', async () => {
    const turns = [deferred(), deferred()]
    const descriptors = [
      { workflowId: 'preplan.wf.01.01', targetObjectId: 'PS01', title: '项目基本情况与启动原因' },
      { workflowId: 'preplan.wf.01.02', targetObjectId: 'PS02', title: '核心问题与决策需求' },
    ]
    let cursor = 0
    const runtime = {
      current: vi.fn(() => undefined),
      nextReady: vi.fn(() => descriptors[cursor]),
      transition: vi.fn(async () => undefined),
      snapshot: vi.fn(() => ({ blocked: [] })),
    }
    const followups: Array<{ readonly content: readonly { readonly type: string; readonly text?: string }[] }> = []
    const agent = {
      followup: vi.fn(async (message: { readonly content: readonly { readonly type: string; readonly text?: string }[] }) => {
        followups.push(message)
      }),
      whenIdle: vi.fn(() => turns[cursor]!.promise.then(() => { cursor += 1 })),
    }
    const coordinator = new AutomationCoordinator(runtime as never)

    await coordinator.start(agent, 'project-1')
    await vi.waitFor(() => expect(followups).toHaveLength(1))
    expect(followups[0]).toMatchObject({
      role: 'user',
      source: { kind: 'plugin', plugin: 'preplanning-agent', form: 'notice' },
    })
    expect(followups[0]?.content[0]?.text).toContain('只处理 nextWorkflow')
    expect(followups[0]?.content[0]?.text).toContain('preplan.wf.01.01')

    turns[0].resolve()
    await vi.waitFor(() => expect(followups).toHaveLength(2))
    await coordinator.pause('project-1')
    turns[1].resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(followups).toHaveLength(2)
  })

  it('stops automatically when a hard blocker appears after a turn', async () => {
    const turn = deferred()
    let blocked = false
    const runtime = {
      current: vi.fn(() => undefined),
      nextReady: vi.fn(() => ({ workflowId: 'preplan.wf.01.01', targetObjectId: 'PS01', title: '项目身份' })),
      transition: vi.fn(async () => undefined),
      snapshot: vi.fn(() => ({ blocked: blocked ? [{ workflowId: 'preplan.wf.01.01' }] : [] })),
    }
    const agent = { followup: vi.fn(async () => undefined), whenIdle: vi.fn(() => turn.promise) }
    const coordinator = new AutomationCoordinator(runtime as never)
    await coordinator.start(agent, 'project-1')
    await vi.waitFor(() => expect(agent.followup).toHaveBeenCalledTimes(1))
    blocked = true
    turn.resolve()
    await vi.waitFor(() => expect(coordinator.isRunning('project-1')).toBe(false))
    expect(agent.followup).toHaveBeenCalledTimes(1)
  })

  it('resumes a persisted running workflow after restart without repeating its transition', async () => {
    const turn = deferred()
    const descriptor = {
      workflowId: 'preplan.wf.01.05', targetObjectId: 'PS05', title: '已定条件与待验证前提',
    }
    const runtime = {
      current: vi.fn(() => descriptor),
      nextReady: vi.fn(() => undefined),
      transition: vi.fn(async () => undefined),
      snapshot: vi.fn(() => ({ blocked: [] })),
    }
    const followups: Array<{ readonly content: readonly { readonly type: string; readonly text?: string }[] }> = []
    const agent = {
      followup: vi.fn(async (message: { readonly content: readonly { readonly type: string; readonly text?: string }[] }) => {
        followups.push(message)
      }),
      whenIdle: vi.fn(() => turn.promise),
    }
    const coordinator = new AutomationCoordinator(runtime as never)

    await coordinator.start(agent, 'project-1')
    await vi.waitFor(() => expect(agent.followup).toHaveBeenCalledTimes(1))
    expect(runtime.transition).not.toHaveBeenCalled()
    expect(followups[0]?.content[0]?.text).toContain('preplan.wf.01.05')

    await coordinator.pause('project-1')
    turn.resolve()
  })
})
