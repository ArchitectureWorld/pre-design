import { describe, expect, it, vi } from 'vitest'
import { AutomationCoordinator } from '../src/runtime/coordinator.ts'
import { ParallelWorkflowExecutor } from '../src/runtime/parallel-workflow-executor.ts'

const descriptor = {
  workflowId: 'preplan.wf.01.01', targetObjectId: 'PS01', title: '项目身份', risk: 'M',
  completionCriteria: ['确认身份'], evidencePolicy: ['原文证据'],
}

function harness(initial: 'ready' | 'running' | 'blocked' = 'ready', providerAvailable = true) {
  let status: string = initial
  const transitions: Array<{ to: string; reason?: string }> = []
  const committed: string[] = []
  const researchRequests: string[] = []
  const parentMessages: unknown[] = []
  const runtime = {
    ready: () => status === 'ready' ? [descriptor] : [],
    running: () => status === 'running' ? [descriptor] : [],
    current: () => status === 'running' ? descriptor : undefined,
    nextReady: () => status === 'ready' ? descriptor : undefined,
    transition: async (_project: string, _workflow: string, command: { to: string; reason?: string }) => {
      if (status === command.to) throw new Error('duplicate transition')
      status = command.to
      transitions.push(command)
    },
    snapshot: () => ({ blocked: status === 'blocked' ? [{ workflowId: descriptor.workflowId }] : [] }),
    retryBlocked: async () => {
      if (status === 'blocked') await runtime.transition('project', descriptor.workflowId, { to: 'ready' })
    },
  }
  const analyzer = {
    available: () => providerAvailable,
    analyze: async () => ({ payload: { object_id: 'PS01' }, qualityEvidence: {
      completionChecks: [{ criterion: '确认身份', status: 'pass', rationale: '提供了身份原文' }],
      evidenceChecks: [{ policy: '原文证据', status: 'pass', rationale: '已附证据' }],
      assumptions: [], blockers: [], confidence: 0.95,
    } }),
  }
  const research = { collect: async (_parent: unknown, id: string) => {
    researchRequests.push(id)
    return { records: [], validation: { valid: true } }
  } }
  const executor = new ParallelWorkflowExecutor({
    runtime, enabled: () => true, analyzer, research,
    committer: { commit: async () => { committed.push('PS01'); return { proposalId: 'p1', revision: 1 } } },
    gateApprover: { approveReady: async () => 0 },
    presentationSync: { request: () => undefined, flush: async () => undefined },
  } as never)
  const agent = {
    followup: async (message: unknown) => { parentMessages.push(message) },
    whenIdle: async () => undefined,
  }
  return { runtime, executor, agent, analyzer, research, transitions, committed, researchRequests, parentMessages }
}

describe('automatic workflow execution reliability', () => {
  it('revalidates a blocked workflow on explicit restart after its research input is repaired', async () => {
    const h = harness('blocked')
    const coordinator = new AutomationCoordinator(h.runtime as never, h.executor)
    await coordinator.start(h.agent, 'project')
    await vi.waitFor(() => expect(coordinator.isRunning('project')).toBe(false))
    expect(h.researchRequests).toEqual(['preplan.wf.01.01'])
    expect(h.committed).toEqual(['PS01'])
    expect(h.transitions.map(row => row.to)).toEqual(['ready', 'running', 'confirmed'])
  })

  it('reblocks once when retry evidence is still missing instead of looping or committing', async () => {
    const h = harness('blocked')
    h.research.collect = async () => {
      h.researchRequests.push('preplan.wf.01.01')
      return { records: [], validation: { valid: false, coverage: 0, errors: ['Missing project-location'], missingDataPointIds: ['project-location'] } }
    }
    const coordinator = new AutomationCoordinator(h.runtime as never, h.executor)
    await coordinator.start(h.agent, 'project')
    await vi.waitFor(() => expect(coordinator.isRunning('project')).toBe(false))
    expect(h.researchRequests).toHaveLength(1)
    expect(h.committed).toEqual([])
    expect(h.transitions.map(row => row.to)).toEqual(['ready', 'running', 'blocked'])
  })

  it.each(['ready', 'running'] as const)('runs one %s workflow through research and quality without parent tool exploration', async (initial) => {
    const h = harness(initial)
    const coordinator = new AutomationCoordinator(h.runtime as never, h.executor)
    await coordinator.start(h.agent, 'project')
    await vi.waitFor(() => expect(coordinator.isRunning('project')).toBe(false))

    expect(h.parentMessages).toEqual([])
    expect(h.researchRequests).toEqual(['preplan.wf.01.01'])
    expect(h.committed).toEqual(['PS01'])
    expect(h.transitions.map(row => row.to)).toEqual(initial === 'ready' ? ['running', 'confirmed'] : ['confirmed'])
  })

  it('blocks a single workflow before model invocation when trusted facts are missing', async () => {
    const h = harness()
    h.research.collect = async () => ({ records: [], validation: {
      valid: false, coverage: 0, errors: ['Missing project-location'], missingDataPointIds: ['project-location'],
    } })
    h.analyzer.analyze = async () => { throw new Error('must not ask model to invent evidence') }
    const result = await h.executor.runReadyBatch(h.agent, 'project')
    expect(result).toMatchObject({ attempted: 1, blocked: 1, completed: 0 })
    expect(h.committed).toEqual([])
    expect(h.transitions.at(-1)).toMatchObject({ to: 'blocked', reason: expect.stringContaining('project-location') })
  })

  it('blocks automatic execution when the child provider is unavailable instead of switching execution mode', async () => {
    const h = harness('ready', false)
    const coordinator = new AutomationCoordinator(h.runtime as never, h.executor)
    await coordinator.start(h.agent, 'project')
    await vi.waitFor(() => expect(coordinator.isRunning('project')).toBe(false))
    expect(h.parentMessages).toEqual([])
    expect(h.transitions.at(-1)).toMatchObject({ to: 'blocked', reason: expect.stringContaining('分析器') })
  })

  it('does not execute a second batch while the same project is already being analyzed', async () => {
    const h = harness()
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const originalAnalyze = h.analyzer.analyze
    h.analyzer.analyze = async () => { await pending; return originalAnalyze() }
    const first = h.executor.runReadyBatch(h.agent, 'project')
    await vi.waitFor(() => expect(h.researchRequests).toHaveLength(1))
    const second = await h.executor.runReadyBatch(h.agent, 'project')
    expect(second.attempted).toBe(0)
    release()
    await first
    expect(h.committed).toEqual(['PS01'])
  })

  it('records an execution exception as a blocker and leaves no detached rejection', async () => {
    const h = harness('running')
    const executor = {
      isEnabled: () => true, canRun: () => true,
      runReadyBatch: async () => { throw new Error('material reader failed') },
    }
    const coordinator = new AutomationCoordinator(h.runtime as never, executor)
    await coordinator.start(h.agent, 'project')
    await vi.waitFor(() => expect(coordinator.isRunning('project')).toBe(false))
    expect(h.transitions.at(-1)).toMatchObject({ to: 'blocked', reason: expect.stringContaining('material reader failed') })
    expect(h.parentMessages).toEqual([])
  })

  it('waits for an in-flight batch across pause and resume instead of marking its analyzer unavailable', async () => {
    const h = harness()
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const originalAnalyze = h.analyzer.analyze
    h.analyzer.analyze = async () => { await pending; return originalAnalyze() }
    const coordinator = new AutomationCoordinator(h.runtime as never, h.executor)
    await coordinator.start(h.agent, 'project')
    await vi.waitFor(() => expect(h.researchRequests).toHaveLength(1))
    await coordinator.pause('project')
    await coordinator.start(h.agent, 'project')
    await new Promise(resolve => setTimeout(resolve, 0))
    const transitionsDuringResume = [...h.transitions]
    release()
    await vi.waitFor(() => expect(coordinator.isRunning('project')).toBe(false))
    expect(transitionsDuringResume.map(row => row.to)).toEqual(['running'])
    expect(h.transitions.map(row => row.to)).toEqual(['running', 'confirmed'])
    expect(h.committed).toEqual(['PS01'])
    expect(h.parentMessages).toEqual([])
  })
})
