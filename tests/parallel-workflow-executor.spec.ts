import { describe, expect, it, vi } from 'vitest'
import { ParallelWorkflowExecutor } from '../src/runtime/parallel-workflow-executor.ts'
import { DshSubagentWorkflowAnalyzer } from '../src/runtime/subagent-workflow-analyzer.ts'

const descriptors = Array.from({ length: 5 }, (_, index) => ({
  workflowId: `preplan.wf.02.0${index + 1}`,
  chapterId: '02',
  workItemId: `02-0${index + 1}`,
  title: `基础研究 ${index + 1}`,
  purpose: `完成基础研究 ${index + 1}`,
  targetObjectId: `BL0${index + 1}`,
  targetSchemaId: `urn:preplan:v0.6:BL0${index + 1}`,
  gateId: 'G2',
  requiredUpstream: ['PS03', 'PS07'],
  atomicToolIds: [],
  automationLevel: 'automatic',
  risk: 'medium',
  humanReviewMandatory: false,
  missingDataPolicy: 'explicit_unknown',
}))

describe('ParallelWorkflowExecutor', () => {
  it('analyzes at most four Ready workflows concurrently and commits in Contract order', async () => {
    let active = 0
    let maxActive = 0
    const analysisOrder: string[] = []
    const commitOrder: string[] = []
    const transitions: Array<{ workflowId: string; to: string }> = []
    const sync = {
      request: vi.fn(),
      flush: vi.fn(async () => ({ state: 'synced' })),
    }
    const executor = new ParallelWorkflowExecutor({
      runtime: {
        ready: () => descriptors,
        running: () => [],
        transition: async (_projectId: string, workflowId: string, command: any) => {
          transitions.push({ workflowId, to: command.to })
          return {} as never
        },
        snapshot: () => ({ blocked: [] }),
      },
      enabled: () => true,
      analyzer: {
        available: () => true,
        analyze: async (_parent: unknown, _projectId: string, descriptor: any) => {
          active += 1
          maxActive = Math.max(maxActive, active)
          analysisOrder.push(descriptor.workflowId)
          await new Promise(resolve => setTimeout(resolve, (6 - Number(descriptor.workItemId.slice(-1))) * 5))
          active -= 1
          return { payload: { object_id: descriptor.targetObjectId, data: { summary: descriptor.title } } }
        },
      },
      committer: {
        commit: async (_parent: unknown, _projectId: string, descriptor: any) => {
          commitOrder.push(descriptor.workflowId)
          return { proposalId: `proposal-${descriptor.workflowId}`, revision: commitOrder.length }
        },
      },
      gateApprover: { approveReady: vi.fn(async () => 1) },
      presentationSync: sync,
      maxConcurrency: 4,
    } as never)

    expect(executor.canRun('preplan-1')).toBe(true)
    const result = await executor.runReadyBatch({ session: { header: { cwd: 'D:\\沙潭河' } } }, 'preplan-1')

    expect(maxActive).toBe(4)
    expect(analysisOrder).toHaveLength(4)
    expect(commitOrder).toEqual(descriptors.slice(0, 4).map(row => row.workflowId))
    expect(transitions.filter(row => row.to === 'running').map(row => row.workflowId))
      .toEqual(descriptors.slice(0, 4).map(row => row.workflowId))
    expect(transitions.filter(row => row.to === 'confirmed').map(row => row.workflowId))
      .toEqual(descriptors.slice(0, 4).map(row => row.workflowId))
    expect(sync.request).toHaveBeenCalledTimes(4)
    expect(sync.flush).toHaveBeenCalledOnce()
    expect(result).toEqual({ attempted: 4, completed: 4, blocked: 0, approvedGates: 1 })
  })

  it('does not select the parallel path without automatic authorization, provider capacity, or two Ready tasks', () => {
    const base = {
      runtime: { ready: () => descriptors.slice(0, 1), running: () => [], transition: vi.fn(), snapshot: vi.fn() },
      enabled: () => true,
      analyzer: { available: () => true, analyze: vi.fn() },
      committer: { commit: vi.fn() },
      gateApprover: { approveReady: vi.fn() },
      presentationSync: { request: vi.fn(), flush: vi.fn() },
    }
    expect(new ParallelWorkflowExecutor(base as never).canRun('preplan-1')).toBe(false)
    expect(new ParallelWorkflowExecutor({ ...base, runtime: { ...base.runtime, ready: () => descriptors }, enabled: () => false } as never).canRun('preplan-1')).toBe(false)
    expect(new ParallelWorkflowExecutor({ ...base, runtime: { ...base.runtime, ready: () => descriptors }, analyzer: { ...base.analyzer, available: () => false } } as never).canRun('preplan-1')).toBe(false)
    expect(new ParallelWorkflowExecutor({ ...base, runtime: { ...base.runtime, ready: () => descriptors, running: () => [descriptors[0]] } } as never).canRun('preplan-1')).toBe(false)
  })

  it('blocks only the failed workflow and still commits successful sibling analyses', async () => {
    const transitions: Array<{ workflowId: string; to: string; reason?: string }> = []
    const commits: string[] = []
    const executor = new ParallelWorkflowExecutor({
      runtime: {
        ready: () => descriptors.slice(0, 3), running: () => [], snapshot: () => ({ blocked: [] }),
        transition: async (_projectId: string, workflowId: string, command: any) => {
          transitions.push({ workflowId, to: command.to, reason: command.reason })
          return {} as never
        },
      },
      enabled: () => true,
      analyzer: {
        available: () => true,
        analyze: async (_parent: unknown, _projectId: string, descriptor: any) => {
          if (descriptor.workflowId === descriptors[1]!.workflowId) throw new Error('research transport failed')
          return { payload: { object_id: descriptor.targetObjectId, data: {} } }
        },
      },
      committer: {
        commit: async (_parent: unknown, _projectId: string, descriptor: any) => {
          commits.push(descriptor.workflowId)
          return { proposalId: `proposal-${descriptor.workflowId}`, revision: commits.length }
        },
      },
      gateApprover: { approveReady: async () => 0 },
      presentationSync: { request: vi.fn(), flush: vi.fn(async () => ({ state: 'synced' })) },
      maxConcurrency: 4,
    } as never)

    const result = await executor.runReadyBatch({}, 'preplan-1')

    expect(commits).toEqual([descriptors[0]!.workflowId, descriptors[2]!.workflowId])
    expect(transitions).toContainEqual(expect.objectContaining({
      workflowId: descriptors[1]!.workflowId, to: 'blocked', reason: 'research transport failed',
    }))
    expect(result).toMatchObject({ attempted: 3, completed: 2, blocked: 1 })
  })
})

describe('DshSubagentWorkflowAnalyzer', () => {
  it('uses one-shot spawn with no tools, one delegation level and a structured payload', async () => {
    const dispose = vi.fn(async () => undefined)
    const start = vi.fn(async (_provider: string, _request: any) => ({
      id: 'child-1',
      localAgent: undefined,
      result: Promise.resolve({
        stopReason: 'completed',
        output: [],
        structured: { payload: { object_type: 'EnvironmentalBaseline', data: { summary: '候选结论' } } },
      }),
      dispose,
    }))
    const analyzer = new DshSubagentWorkflowAnalyzer({
      subagents: { getProvider: () => ({ name: 'spawn' }), start },
      repository: {
        readContext: () => ({
          project: { projectId: 'preplan-1', name: '沙潭河', currentRevision: 7 },
          stateObjects: [
            { objectId: 'PS03', revision: 3, value: { data: { location: '武汉' } } },
            { objectId: 'PS07', revision: 7, value: { data: { constraints: [] } } },
          ],
        }),
      },
      registry: {
        stateSchema: (objectId: string) => ({ type: 'object', title: objectId }),
        stateExample: (objectId: string) => ({ object_id: objectId, data: {} }),
      },
    } as never)

    expect(analyzer.available()).toBe(true)
    const result = await analyzer.analyze({ id: 'session-1' } as never, 'preplan-1', descriptors[2]!)

    expect(result.payload).toMatchObject({ object_type: 'EnvironmentalBaseline' })
    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]?.[0]).toBe('spawn')
    expect(start.mock.calls[0]?.[1]).toMatchObject({
      maxDepth: 1,
      toolFilter: { allow: [] },
      outputSchema: { type: 'object' },
    })
    const prompt = start.mock.calls[0]?.[1].prompt[0].text
    expect(prompt).toContain('preplan.wf.02.03')
    expect(prompt).toContain('PS03')
    expect(prompt).toContain('禁止复制示例事实')
    expect(dispose).toHaveBeenCalledOnce()
  })
})
