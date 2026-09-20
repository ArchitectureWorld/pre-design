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

interface TransitionCommand {
  readonly to: string
  readonly reason?: string
  readonly quality?: {
    readonly disposition?: string
    readonly evidenceCoverage?: number
  }
}

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
  it('automatically corrects an ungrounded missing-owner blocker before committing conditional research', async () => {
    const descriptor = descriptors[1]
    const research = { ...invalidResearch(descriptor.workflowId),
      validation: { ...invalidResearch(descriptor.workflowId).validation, integrityValid: true },
      continuation: { mode: 'conditional', workflowId: descriptor.workflowId, policy: 'v2.0.1-research-fallback',
        missingDataPointIds: ['required-input'], limitations: ['主体未知，仅界定问题'] } }
    const analyze = vi.fn(async () => ({ payload: {}, qualityEvidence: {
      completionChecks: [{ criterion: '问题完整', status: 'pass', rationale: '问题已界定' }],
      evidenceChecks: [{ policy: 'P0 项目证据', status: 'pass', rationale: '缺口保留' }], assumptions: ['主体未知'], confidence: 0.95,
      blockers: analyze.mock.calls.length === 1 ? [{ code: 'missing-owner', kind: 'external', message: '缺少决策主体' }] : [],
    } }))
    const commit = vi.fn(async () => ({ proposalId: 'proposal', revision: 2 }))
    const executor = new ParallelWorkflowExecutor({
      runtime: { ready: () => [descriptor], running: () => [], transition: vi.fn() }, enabled: () => true,
      analyzer: { available: () => true, analyze }, research: { collect: async () => research }, committer: { commit },
      gateApprover: { approveReady: async () => 0 }, presentationSync: { request: vi.fn(), flush: async () => undefined },
    } as never)
    expect(await executor.runReadyBatch({ id: 'parent' }, 'project')).toMatchObject({ completed: 1, blocked: 0, revised: 1 })
    expect(analyze).toHaveBeenCalledTimes(2)
    expect(commit).toHaveBeenCalledOnce()
  })

  it('routes conditional research through analysis, central quality and automatic commit', async () => {
    const descriptor = descriptors[1]
    const research = { ...invalidResearch(descriptor.workflowId),
      validation: { ...invalidResearch(descriptor.workflowId).validation, integrityValid: true },
      continuation: { mode: 'conditional', workflowId: descriptor.workflowId, policy: 'v2.0.1-research-fallback',
        missingDataPointIds: ['required-input'], limitations: ['数据缺失，仅形成附条件策划结论'] },
    }
    const analyze = vi.fn(async () => ({ payload: {}, qualityEvidence: {
      completionChecks: [{ criterion: '问题完整', status: 'pass', rationale: '已限定问题' }],
      evidenceChecks: [{ policy: 'P0 项目证据', status: 'pass', rationale: '未知项保留' }],
      assumptions: research.continuation.limitations, blockers: [], confidence: 0.95,
    } }))
    const commit = vi.fn(async () => ({ proposalId: 'proposal', revision: 1 }))
    const transition = vi.fn()
    const executor = new ParallelWorkflowExecutor({
      runtime: { ready: () => [descriptor], running: () => [], transition }, enabled: () => true,
      analyzer: { available: () => true, analyze }, research: { collect: async () => research }, committer: { commit },
      gateApprover: { approveReady: async () => 0 }, presentationSync: { request: vi.fn(), flush: async () => undefined },
    } as never)
    expect(await executor.runReadyBatch({ id: 'parent' }, 'project')).toMatchObject({ completed: 1, blocked: 0, needsHuman: 0 })
    expect(analyze).toHaveBeenCalledWith({ id: 'parent' }, 'project', descriptor, undefined, undefined, research)
    expect(commit).toHaveBeenCalledOnce()
    expect(transition).toHaveBeenCalledWith('project', descriptor.workflowId, expect.objectContaining({ to: 'confirmed' }))
  })

  it('blocks before LLM analysis when independent Research validation fails', async () => {
    const transition = vi.fn(async (_projectId: string, _workflowId: string, _command: TransitionCommand) => undefined)
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
    const blockedTransitions = transition.mock.calls.filter(call => call[2].to === 'blocked')
    expect(blockedTransitions).toHaveLength(2)
    for (const call of blockedTransitions) {
      const command = call[2]
      expect(command.quality).toMatchObject({ disposition: 'blocked_external', evidenceCoverage: 0 })
      expect(command.reason).toContain('Research evidence validation failed')
    }
  })
})
