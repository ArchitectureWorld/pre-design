import { describe, expect, it, vi } from 'vitest'
import type { WorkflowDescriptor } from '../src/contracts/types.ts'
import { ParallelWorkflowExecutor } from '../src/runtime/parallel-workflow-executor.ts'
import { AutomationCoordinator } from '../src/runtime/coordinator.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function harness(dependencies: Record<string, string[]>, concurrency = 3, recovered: string[] = []) {
  const descriptors = Object.entries(dependencies).map(([id, upstream]) => ({
    workflowId: id, targetObjectId: id, requiredUpstream: upstream, risk: 'M',
  })) as unknown as WorkflowDescriptor[]
  const states = new Map(descriptors.map(row => [row.workflowId, recovered.includes(row.workflowId) ? 'running' : 'ready']))
  const pending = new Map(descriptors.map(row => [row.workflowId, deferred<{ payload: { object_id: string } }>()]))
  const started: string[] = []
  const committed: string[] = []
  let active = 0
  let maxActive = 0
  let writing = 0
  let maxWriting = 0
  const runtime = {
    ready: () => descriptors.filter(row => states.get(row.workflowId) === 'ready'
      && row.requiredUpstream.every(id => states.get(id) === 'confirmed')),
    running: () => descriptors.filter(row => states.get(row.workflowId) === 'running'),
    current: () => runtime.running()[0], nextReady: () => runtime.ready()[0],
    snapshot: () => ({ blocked: descriptors.filter(row => states.get(row.workflowId) === 'blocked') }),
    retryBlocked: vi.fn(),
    transition: vi.fn(async (_project: string, id: string, command: { to: string }) => { states.set(id, command.to) }),
  }
  const commit = vi.fn(async (_parent: unknown, _project: string, row: WorkflowDescriptor) => {
    writing += 1; maxWriting = Math.max(maxWriting, writing)
    await Promise.resolve()
    committed.push(row.workflowId)
    writing -= 1
    return { proposalId: row.workflowId, revision: committed.length }
  })
  const executor = new ParallelWorkflowExecutor({
    runtime, enabled: () => true,
    analyzer: { available: () => true, analyze: async (_parent: unknown, _project: string, row: WorkflowDescriptor) => {
      started.push(row.workflowId); active += 1; maxActive = Math.max(maxActive, active)
      try { return await pending.get(row.workflowId)!.promise } finally { active -= 1 }
    } },
    committer: { commit }, gateApprover: { approveReady: async () => 0 },
    presentationSync: { request: vi.fn(), flush: vi.fn(async () => undefined) },
    maxConcurrency: concurrency,
  } as never)
  const agent = { followup: vi.fn(), whenIdle: async () => undefined }
  return { executor, runtime, agent, states, started, committed, commit, pending,
    maxActive: () => maxActive, maxWriting: () => maxWriting,
    finish: (id: string) => pending.get(id)!.resolve({ payload: { object_id: id } }),
  }
}

describe('rolling dependency-aware workflow scheduling', () => {
  it.each([5, 99, Number.NaN])('runs five children with requested capacity %s and refills without exceeding five', async (capacity) => {
    const h = harness({ a: [], b: [], c: [], d: [], e: [], f: [], g: [] }, capacity)
    const run = h.executor.runReadyBatch(h.agent, 'project', { refill: true })
    await vi.waitFor(() => expect(h.started).toEqual(['a', 'b', 'c', 'd', 'e']))
    h.finish('b')
    await vi.waitFor(() => expect(h.started).toEqual(['a', 'b', 'c', 'd', 'e', 'f']))
    h.finish('f')
    await vi.waitFor(() => expect(h.started).toContain('g'))
    for (const id of ['a', 'c', 'd', 'e', 'g']) h.finish(id)
    expect(await run).toMatchObject({ attempted: 7, completed: 7 })
    expect(h.maxActive()).toBe(5)
    expect(h.maxWriting()).toBe(1)
  })

  it('commits a fast sibling and starts its dependent without waiting for the slow sibling', async () => {
    const h = harness({ slow: [], fast: [], dependent: ['fast'] }, 2)
    const commitGate = deferred<void>()
    const originalCommit = h.commit.getMockImplementation()!
    h.commit.mockImplementation(async (...args) => {
      if (args[2].workflowId === 'fast') await commitGate.promise
      return originalCommit(...args)
    })
    const run = h.executor.runReadyBatch(h.agent, 'project', { refill: true })
    await vi.waitFor(() => expect(h.started).toEqual(['slow', 'fast']))
    h.finish('fast')
    await vi.waitFor(() => expect(h.commit).toHaveBeenCalledOnce())
    expect(h.started).not.toContain('dependent')
    commitGate.resolve()
    await vi.waitFor(() => expect(h.started).toContain('dependent'))
    expect(h.committed).toEqual(['fast'])
    expect(h.states.get('slow')).toBe('running')
    h.finish('dependent'); h.finish('slow')
    expect(await run).toMatchObject({ attempted: 3, completed: 3, blocked: 0 })
    expect(h.maxActive()).toBe(2)
    expect(h.maxWriting()).toBe(1)
  })

  it('refills a freed slot from already-ready work while preserving the three-child limit', async () => {
    const h = harness({ a: [], b: [], c: [], d: [], e: [] })
    const run = h.executor.runReadyBatch(h.agent, 'project', { refill: true })
    await vi.waitFor(() => expect(h.started).toEqual(['a', 'b', 'c']))
    h.finish('b')
    await vi.waitFor(() => expect(h.started).toEqual(['a', 'b', 'c', 'd']))
    expect(h.states.get('a')).toBe('running')
    h.finish('d')
    await vi.waitFor(() => expect(h.started).toContain('e'))
    h.finish('a'); h.finish('c'); h.finish('e')
    expect(await run).toMatchObject({ attempted: 5, completed: 5 })
    expect(h.maxActive()).toBe(3)
    expect(h.maxWriting()).toBe(1)
    expect(new Set(h.started).size).toBe(5)
  })

  it('fills recovery capacity with independent ready work', async () => {
    const h = harness({ recovered: [], ready: [] }, 2, ['recovered'])
    const run = h.executor.runReadyBatch(h.agent, 'project', { refill: true })
    await vi.waitFor(() => expect(h.started).toEqual(['recovered', 'ready']))
    h.finish('recovered'); h.finish('ready')
    expect(await run).toMatchObject({ completed: 2 })
    expect(h.runtime.transition.mock.calls.filter(call => call[1] === 'recovered' && call[2].to === 'running')).toHaveLength(0)
  })

  it('pause drains healthy tasks without admitting replacements; resume starts only remaining work', async () => {
    const h = harness({ a: [], b: [], c: ['a'] }, 2)
    const coordinator = new AutomationCoordinator(h.runtime as never, h.executor)
    await coordinator.start(h.agent, 'project')
    await vi.waitFor(() => expect(h.started).toEqual(['a', 'b']))
    await coordinator.pause('project')
    h.finish('a'); h.finish('b')
    await h.executor.whenIdle('project')
    expect(h.started).toEqual(['a', 'b'])
    expect(h.committed).toHaveLength(2)
    await coordinator.start(h.agent, 'project')
    await vi.waitFor(() => expect(h.started).toEqual(['a', 'b', 'c']))
    h.finish('c')
    await vi.waitFor(() => expect(coordinator.isRunning('project')).toBe(false))
    expect(h.committed).toHaveLength(3)
  })

  it('continues independent work after a blocker without dispatching its dependents or retrying it', async () => {
    const h = harness({ a: [], b: [], c: [], dependent: ['b'] }, 2)
    const run = h.executor.runReadyBatch(h.agent, 'project', { refill: true })
    await vi.waitFor(() => expect(h.started).toEqual(['a', 'b']))
    h.pending.get('b')!.reject(new Error('transport failure'))
    await vi.waitFor(() => expect(h.states.get('b')).toBe('blocked'))
    await vi.waitFor(() => expect(h.started).toEqual(['a', 'b', 'c']))
    h.finish('a'); h.finish('c')
    expect(await run).toMatchObject({ attempted: 3, completed: 2, blocked: 1 })
    expect(h.committed.sort()).toEqual(['a', 'c'])
    expect(h.states.get('dependent')).toBe('ready')
    expect(h.runtime.transition.mock.calls).toContainEqual(['project', 'b', { to: 'blocked', reason: 'transport failure' }])
  })

  it('records an admission write failure and still runs later independent work', async () => {
    const h = harness({ a: [], b: [], c: [] }, 2)
    const transition = h.runtime.transition.getMockImplementation()!
    h.runtime.transition.mockImplementation(async (...args) => {
      if (args[1] === 'b' && args[2].to === 'running') throw new Error('storage unavailable')
      return transition(...args)
    })
    let settled = false
    const run = h.executor.runReadyBatch(h.agent, 'project', { refill: true }).then(result => { settled = true; return result })
    await vi.waitFor(() => expect(h.started).toEqual(['a', 'c']))
    expect(settled).toBe(false)
    h.finish('a'); h.finish('c')
    expect(await run).toMatchObject({ errors: [{ stage: 'admission', workflowId: 'b', message: 'storage unavailable' }] })
    expect(h.committed.sort()).toEqual(['a', 'c'])
  })
})
