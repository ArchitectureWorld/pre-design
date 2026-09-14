import { describe, expect, it, vi } from 'vitest'
import { ParallelWorkflowExecutor } from '../src/runtime/parallel-workflow-executor.ts'

const descriptors = [
  {
    workflowId: 'preplan.wf.01.01', chapterId: '01', workItemId: '01-01', targetObjectId: 'PS01',
    targetSchemaId: 'urn:preplan:v0.6:state:PS01', title: '项目基本情况与启动原因', purpose: '建立项目身份',
    risk: 'M', requiredUpstream: ['ProjectSeed'], completionCriteria: ['身份完整'], evidencePolicy: ['P0 项目证据'], atomicToolIds: [],
  },
  {
    workflowId: 'preplan.wf.01.02', chapterId: '01', workItemId: '01-02', targetObjectId: 'PS02',
    targetSchemaId: 'urn:preplan:v0.6:state:PS02', title: '关键决策问题', purpose: '明确决策问题',
    risk: 'M', requiredUpstream: ['ProjectSeed'], completionCriteria: ['问题完整'], evidencePolicy: ['P0 项目证据'], atomicToolIds: [],
  },
] as const

function invalidResearch(workflowId: string) {
  return {
    records: [],
    validation: {
      valid: false,
      coverage: 0,
      missingDataPointIds: ['required-input'],
      staleEvidenceIds: [], rejectedEvidenceIds: [], acceptedEvidenceIds: [],
      highAuthorityCount: 0, independentSourceCount: 0, gradeACount: 0,
      errors: [`${workflowId}: missing required data points`],
    },
  }
}

describe('parallel workflow independent research gate', () => {
  it('blocks before LLM analysis when independent Research validation fails', async () => {
    const transition = vi.fn(async () => undefined)
    const analyze = vi.fn(async () => { throw new Error('analyzer must not run without trusted research') })
    const collect = vi.fn(async (_parent: unknown, workflowId: string) => invalidResearch(workflowId))
    const commit = vi.fn()

    const executor = new ParallelWorkflowExecutor({
      runtime: {
        ready: vi.fn(() => descriptors as never),
        running: vi.fn(() => []),
        transition,
        snapshot: vi.fn(() => ({ runs: [], chapters: [], blocked: [] })),
      } as never,
      enabled: () => true,
      analyzer: { available: () => true, analyze } as never,
      research: { collect } as never,
      committer: { commit } as never,
      gateApprover: { approveReady: vi.fn(async () => 0) } as never,
      presentationSync: { request: vi.fn(), flush: vi.fn(async () => undefined) } as never,
      maxConcurrency: 2,
    })

    const result = await executor.runReadyBatch({ id: 'agent-1' }, 'project-1')

    expect(result).toMatchObject({ attempted: 2, completed: 0, blocked: 2 })
    expect(collect).toHaveBeenCalledTimes(2)
    expect(analyze).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    const blockedTransitions = transition.mock.calls.filter(([, , command]) => command.to === 'blocked')
    expect(blockedTransitions).toHaveLength(2)
    for (const [, , command] of blockedTransitions) {
      expect(command.quality).toMatchObject({ disposition: 'blocked_external', evidenceCoverage: 0 })
      expect(command.reason).toContain('Research evidence validation failed')
    }
  })
})
