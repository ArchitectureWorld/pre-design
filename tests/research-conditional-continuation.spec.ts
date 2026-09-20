import { describe, expect, it, vi } from 'vitest'
import { researchAllowsAnalysis, type ResearchExecutionResult } from '../src/research/execution-service.ts'
import { DshSubagentWorkflowAnalyzer } from '../src/runtime/subagent-workflow-analyzer.ts'
import { AutomationWorkflowCommitter } from '../src/runtime/automation-workflow-committer.ts'
import { ContractRegistry } from '../src/contracts/registry.ts'
import { ResearchRegistry } from '../src/research/registry.ts'
import { evaluateWorkflowQuality } from '../src/runtime/workflow-quality.ts'

const workflowId = 'preplan.wf.01.02'
const limitation = '决策主体尚未指定；不声称取得项目实施批准。'
function conditional(): ResearchExecutionResult {
  return {
    records: [],
    validation: { valid: false, integrityValid: true, coverage: 0, missingDataPointIds: ['decision-owner'],
      staleEvidenceIds: [], rejectedEvidenceIds: [], acceptedEvidenceIds: [], highAuthorityCount: 0,
      independentSourceCount: 0, gradeACount: 0, errors: ['missing required data points: decision-owner'] },
    continuation: { mode: 'conditional', workflowId, policy: 'v2.0.1-research-fallback',
      missingDataPointIds: ['decision-owner'], limitations: [limitation] },
  }
}

describe('conditional research in automatic planning', () => {
  it.each([
    ['no central continuation', (r: any) => { delete r.continuation }],
    ['wrong workflow', (r: any) => { r.continuation.workflowId = 'preplan.wf.01.03' }],
    ['wrong policy', (r: any) => { r.continuation.policy = 'model-override' }],
    ['hidden missing inputs', (r: any) => { r.continuation.missingDataPointIds = [] }],
    ['missing limitations', (r: any) => { r.continuation.limitations = [] }],
    ['invalid evidence', (r: any) => { r.validation.integrityValid = false }],
    ['rejected evidence', (r: any) => { r.validation.rejectedEvidenceIds = ['bad'] }],
    ['stale evidence', (r: any) => { r.validation.staleEvidenceIds = ['stale'] }],
    ['unknown integrity', (r: any) => { delete r.validation.integrityValid }],
  ])('rejects %s before spawning a model', async (_name, mutate) => {
    const result = conditional()
    mutate(result)
    expect(researchAllowsAnalysis(result, workflowId)).toBe(false)
    const start = vi.fn()
    const analyzer = new DshSubagentWorkflowAnalyzer({ subagents: { getProvider: () => ({}), start } } as never)
    await expect(analyzer.analyze({ id: 'parent' } as never, 'project', { workflowId } as never, undefined, undefined, result))
      .rejects.toThrow('unvalidated Research')
    expect(start).not.toHaveBeenCalled()
  })

  it('cannot use a conditional continuation to invent initial project identity', () => {
    const result = conditional()
    expect(researchAllowsAnalysis({ ...result, continuation: { ...result.continuation!, workflowId: 'preplan.wf.01.01' } }, 'preplan.wf.01.01')).toBe(false)
  })

  it('carries incomplete evidence and central limitations through actual analyzer and committer boundaries', async () => {
    const registry = await ContractRegistry.open(new URL('../contracts/v0.6/', import.meta.url))
    const researchRegistry = await ResearchRegistry.open(new URL('../research/v2.0.1/', import.meta.url))
    const descriptor = registry.workflow(workflowId)
    const research = conditional()
    const context = { project: { projectId: 'project', name: '少潭河', currentRevision: 1 },
      stateObjects: [{ objectId: 'PS01', revision: 1, value: { data: { canonical_name: '少潭河' } } }] }
    const start = vi.fn(async () => ({ id: 'child', dispose: vi.fn(), result: Promise.resolve({
      stopReason: 'completed', structured: {
        payload: { data: { decision_question: '文旅休闲开发可行性、定位与招商' } },
        qualityEvidence: {
          completionChecks: descriptor.completionCriteria!.map(criterion => ({ criterion, status: 'pass', rationale: '输入明确且未知项已保留' })),
          evidenceChecks: descriptor.evidencePolicy!.map(policy => ({ policy, status: 'pass', rationale: '有据分类' })),
          confidence: 0.95, assumptions: [], blockers: [],
        },
      },
    }) }))
    const analyzer = new DshSubagentWorkflowAnalyzer({
      subagents: { getProvider: () => ({}), start }, repository: { readContext: () => context }, registry, researchRegistry,
    } as never)
    const candidate = await analyzer.analyze({ id: 'parent' } as never, 'project', descriptor, undefined, undefined, research)
    expect(candidate.qualityEvidence!.assumptions).toContain(limitation)
    expect(candidate.researchValidation?.valid).toBe(false)
    expect(candidate.researchEvidence).toEqual([])
    expect(candidate.analysisTrace).toMatchObject({
      inputEvidenceIds: [], inputObjectIds: ['PS01'],
      parameters: { upstreamSnapshots: [{ objectId: 'PS01', revision: 1, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) }] },
    })
    expect(researchRegistry.validateAnalysisTrace(candidate.analysisTrace).valid).toBe(true)
    const trace = candidate.analysisTrace!
    expect(researchRegistry.validateAnalysisTrace({ ...trace, inputObjectIds: [] }).valid).toBe(false)
    expect(researchRegistry.validateAnalysisTrace({ ...trace, parameters: {} }).valid).toBe(false)
    expect(researchRegistry.validateAnalysisTrace({ ...trace, inputObjectIds: ['PS99'] }).valid).toBe(false)
    expect(researchRegistry.validateAnalysisTrace({ ...trace, parameters: { upstreamSnapshots: [{ objectId: 'PS01', revision: 0, contentHash: 'invalid' }] } }).valid).toBe(false)
    const request = (start.mock.calls as unknown as [string, { prompt: { text: string }[] }][])[0]![1]
    expect(request.prompt[0]!.text).toContain('humanApprovalRequired=false')
    expect(request.prompt[0]!.text).not.toContain('项目发起人或项目负责人确认')
    const quality = evaluateWorkflowQuality(descriptor, candidate.qualityEvidence!, { attempt: 1 })
    expect(quality.disposition).toBe('auto_pass')
    const submitProposal = vi.fn(async (envelope: any) => ({ proposalId: envelope.proposal_id }))
    const commitProposal = vi.fn(async () => ({ proposalId: 'proposal-test', revision: 2 }))
    const putAuditEvent = vi.fn()
    const committer = new AutomationWorkflowCommitter({
      repository: { readContext: () => context, putAuditEvent },
      registry: { stateExample: () => registry.stateExample('PS02'), validateStateObject: () => ({ valid: true, errors: [] }) },
      governance: { readProject: () => ({ policy: { mode: 'automatic', automationAuthorizationId: 'auth' } }) },
      gateway: { submitProposal, commitProposal },
    } as never)
    await committer.commit({ id: 'parent' } as never, 'project', descriptor, candidate, quality)
    expect(submitProposal.mock.calls[0]![0].assumptions).toContainEqual(expect.objectContaining({ description: limitation }))
    expect(putAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({
      researchValidation: research.validation, researchContinuation: research.continuation, evidenceRecords: [],
    }) }))
    const invalid = { ...candidate, researchContinuation: { ...research.continuation!, workflowId: 'wrong' } }
    await expect(committer.commit({ id: 'parent' } as never, 'project', descriptor, invalid, quality)).rejects.toThrow('unvalidated Research')
    expect(commitProposal).toHaveBeenCalledOnce()
    context.stateObjects[0]!.revision = 2
    const revised = await analyzer.analyze({ id: 'parent' } as never, 'project', descriptor, undefined, undefined, research)
    expect(revised.analysisTrace!.traceId).not.toBe(trace.traceId)
    expect(revised.analysisTrace!.parameters.upstreamSnapshots).toEqual([
      expect.objectContaining({ objectId: 'PS01', revision: 2 }),
    ])
  })
})
