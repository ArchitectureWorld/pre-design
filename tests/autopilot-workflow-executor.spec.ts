import { describe, expect, it, vi } from 'vitest'
import { ParallelWorkflowExecutor } from '../src/runtime/parallel-workflow-executor.ts'
import type { WorkflowDescriptor } from '../src/contracts/types.ts'
import type { WorkflowQualityEvidence } from '../src/runtime/workflow-quality.ts'

const baseDescriptor: WorkflowDescriptor = {
  workflowId: 'preplan.wf.02.01', chapterId: '02', workItemId: '02-01', title: '规划管控',
  purpose: '形成可追溯的规划判断', targetObjectId: 'BL01', targetSchemaId: 'urn:test:BL01', gateId: 'G2',
  requiredUpstream: ['PS03'], atomicToolIds: ['T01'], automationLevel: 'A2', risk: 'M',
  humanReviewMandatory: true, missingDataPolicy: '缺口显式化',
  evidencePolicy: ['事实必须绑定证据'], completionCriteria: ['完成核心判断'],
  reopenTriggers: ['规划条件变化'], forbiddenActions: ['fabricate_missing_values'],
  reviewPolicy: { humanReviewMandatory: true, provisionalAutoCommitAllowed: false, gateStillHuman: true },
}

const passEvidence: WorkflowQualityEvidence = {
  completionChecks: [{ criterion: '完成核心判断', status: 'pass', rationale: '已形成结论' }],
  evidenceChecks: [{ policy: '事实必须绑定证据', status: 'pass', rationale: '已绑定来源' }],
  assumptions: [], blockers: [], confidence: 0.9,
}

function dependencies(options: {
  descriptor?: WorkflowDescriptor
  analyses: readonly WorkflowQualityEvidence[]
}) {
  const descriptor = options.descriptor ?? baseDescriptor
  const transitions: Array<{ to: string; reason?: string; quality?: any }> = []
  const analyze = vi.fn(async () => {
    const qualityEvidence = options.analyses[Math.min(analyze.mock.calls.length - 1, options.analyses.length - 1)]!
    return { payload: { object_id: descriptor.targetObjectId, data: { result: '候选结论' } }, qualityEvidence }
  })
  const commit = vi.fn(async () => ({ proposalId: 'proposal-1', revision: 8 }))
  return {
    transitions, analyze, commit,
    deps: {
      runtime: {
        ready: () => [descriptor, { ...descriptor, workflowId: 'preplan.wf.02.02', workItemId: '02-02', targetObjectId: 'BL02' }],
        running: () => [],
        transition: async (_projectId: string, _workflowId: string, command: any) => {
          transitions.push({ to: command.to, reason: command.reason, quality: command.quality })
          return {} as never
        },
        snapshot: () => ({ blocked: [] }),
      },
      enabled: () => true,
      analyzer: { available: () => true, analyze },
      committer: { commit },
      gateApprover: { approveReady: vi.fn(async () => 0) },
      presentationSync: { request: vi.fn(), flush: vi.fn(async () => ({ state: 'synced' })) },
      maxConcurrency: 1,
      maxQualityAttempts: 3,
    },
  }
}

describe('Pre Autopilot workflow quality loop', () => {
  it('automatically revises a low-quality candidate and commits only the passing revision', async () => {
    const first: WorkflowQualityEvidence = { ...passEvidence, confidence: 0.5 }
    const { deps, transitions, analyze, commit } = dependencies({ analyses: [first, passEvidence] })
    const executor = new ParallelWorkflowExecutor(deps as never)

    const result = await executor.runReadyBatch({ id: 'session-1' }, 'project-1')

    expect(analyze).toHaveBeenCalledTimes(2)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(transitions.map(row => row.to)).toEqual(['running', 'confirmed'])
    expect(transitions.at(-1)?.quality).toMatchObject({ disposition: 'auto_pass', attempt: 2 })
    expect(result).toMatchObject({ completed: 1, blocked: 0, needsHuman: 0, revised: 1 })
  })

  it('automatically commits a passing high-risk workflow after stronger machine quality checks', async () => {
    const descriptor = { ...baseDescriptor, risk: 'H' }
    const { deps, transitions, analyze, commit } = dependencies({ descriptor, analyses: [{ ...passEvidence, confidence: 0.93 }] })
    const executor = new ParallelWorkflowExecutor(deps as never)

    const result = await executor.runReadyBatch({ id: 'session-1' }, 'project-1')

    expect(analyze).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledOnce()
    expect(transitions.map(row => row.to)).toEqual(['running', 'confirmed'])
    expect(transitions.at(-1)?.quality).toMatchObject({ disposition: 'auto_pass' })
    expect(result).toMatchObject({ completed: 1, blocked: 0, needsHuman: 0 })
  })

  it('stops immediately on an external blocker and records the quality reason', async () => {
    const blocked: WorkflowQualityEvidence = {
      ...passEvidence,
      blockers: [{ code: 'MISSING_FORMAL_PLAN', kind: 'external', message: '缺少正式总平图' }],
    }
    const { deps, transitions, analyze, commit } = dependencies({ analyses: [blocked] })
    const executor = new ParallelWorkflowExecutor(deps as never)

    const result = await executor.runReadyBatch({ id: 'session-1' }, 'project-1')

    expect(analyze).toHaveBeenCalledOnce()
    expect(commit).not.toHaveBeenCalled()
    expect(transitions.map(row => row.to)).toEqual(['running', 'blocked'])
    expect(transitions.at(-1)?.reason).toContain('缺少正式总平图')
    expect(transitions.at(-1)?.quality).toMatchObject({ disposition: 'blocked_external' })
    expect(result).toMatchObject({ completed: 0, blocked: 1, needsHuman: 0 })
  })

  it('keeps an exhausted automatic revision loop machine-visible as quality_unresolved', async () => {
    const weak: WorkflowQualityEvidence = { ...passEvidence, confidence: 0.4 }
    const { deps, transitions, analyze, commit } = dependencies({ analyses: [weak, weak, weak] })
    const executor = new ParallelWorkflowExecutor(deps as never)

    const result = await executor.runReadyBatch({ id: 'session-1' }, 'project-1')

    expect(analyze).toHaveBeenCalledTimes(3)
    expect(commit).not.toHaveBeenCalled()
    expect(transitions.map(row => row.to)).toEqual(['running', 'blocked'])
    expect(transitions.at(-1)?.quality).toMatchObject({ disposition: 'quality_unresolved', attempt: 3 })
    expect(result).toMatchObject({ completed: 0, blocked: 1, needsHuman: 0, revised: 2 })
  })
})
