import { describe, expect, it } from 'vitest'
import { evaluateWorkflowQuality, type WorkflowQualityEvidence } from '../src/runtime/workflow-quality.ts'
import type { WorkflowDescriptor } from '../src/contracts/types.ts'
import type { ResearchExecutionResult } from '../src/research/execution-service.ts'

const descriptor: WorkflowDescriptor = { workflowId: 'preplan.wf.01.02', targetObjectId: 'PS02', risk: 'H',
  chapterId: '01', workItemId: '01-02', title: '决策问题', purpose: '界定问题', targetSchemaId: 'urn:preplan:v0.6:state:PS02',
  gateId: 'G1', requiredUpstream: ['PS01'], atomicToolIds: [], automationLevel: 'automatic', humanReviewMandatory: false,
  missingDataPolicy: '未知角色形成条件式研究', completionCriteria: ['界定决策问题'], evidencePolicy: ['证据可追溯'] }
const research = {
  records: [{ evidenceId: 'old-rule' }, { evidenceId: 'current-rule' }],
  validation: { valid: false, integrityValid: true, coverage: 0.6667, missingDataPointIds: ['decision-owner'],
    acceptedEvidenceIds: ['old-rule', 'current-rule'], staleEvidenceIds: [], rejectedEvidenceIds: [], errors: ['missing decision-owner'] },
  continuation: { mode: 'conditional', workflowId: descriptor.workflowId, policy: 'v2.0.1-research-fallback', missingDataPointIds: ['decision-owner'], limitations: ['主体未知，不伪造外部批准'] },
} as unknown as ResearchExecutionResult
const evidence = (blockers: unknown[], confidence = 0.95): WorkflowQualityEvidence => ({
  completionChecks: [{ criterion: '界定决策问题', status: 'pass', rationale: '有限结论' }],
  evidenceChecks: [{ policy: '证据可追溯', status: 'pass', rationale: '来源保留' }],
  assumptions: ['主体未知'], blockers, confidence,
} as WorkflowQualityEvidence)
const assess = (blockers: unknown[], attempt = 1, confidence = 0.95) => evaluateWorkflowQuality(descriptor, evidence(blockers, confidence), { attempt, maxAttempts: 3, research } as never)

describe('evidence-grounded automatic workflow blockers', () => {
  it('returns legacy unsubstantiated external and conflict claims for correction rather than halting', () => {
    const report = assess([
      { code: 'missing-owner', kind: 'external', message: '主体未知，已允许条件式继续' },
      { code: 'old-policy', kind: 'conflict', message: '2020年资料尚未核验2026年适用性' },
    ])
    expect(report.disposition).toBe('auto_revise')
    expect(report.blockers).toHaveLength(2)
    expect(report.blockers.every(b => b.kind === 'quality')).toBe(true)
    expect(report.blockers[1]!.message).toContain('2020年资料')
  })
  it('keeps known permitted gaps as a correction request, never an automatic pass', () => {
    const report = assess([{ code: 'missing-owner', kind: 'external', message: '必须先有负责人',
      scope: 'current_workflow', criterion: '界定决策问题', dataPointIds: ['decision-owner'], evidenceIds: [] }])
    expect(report.disposition).toBe('auto_revise')
    expect(report.reasons.join(' ')).toContain('质量')
    expect(report.blockers[0]!.message).toContain('条件式')
  })
  it.each([[], ['old-rule'], ['old-rule', 'old-rule'], ['old-rule', 'invented']])('does not accept an unsupported contradiction: %j', (...ids) => {
    const report = assess([{ code: 'conflict', kind: 'conflict', message: '称存在冲突', scope: 'current_workflow',
      criterion: '界定决策问题', dataPointIds: [], evidenceIds: ids }])
    expect(report.disposition).toBe('auto_revise')
  })
  it('preserves a current-workflow conflict backed by two independently accepted records', () => {
    expect(assess([{ code: 'conflict', kind: 'conflict', message: '两份现行来源对同一约束给出矛盾结论', scope: 'current_workflow',
      criterion: '界定决策问题', dataPointIds: [], evidenceIds: ['old-rule', 'current-rule'] }]).disposition).toBe('evidence_conflict')
  })
  it('requires later implementation conditions and unknown criteria to be corrected', () => {
    for (const change of [{ scope: 'later_implementation' }, { criterion: '虚构前置审批' }]) {
      expect(assess([{ code: 'conflict', kind: 'conflict', message: '后续实施条件', scope: 'current_workflow',
        criterion: '界定决策问题', dataPointIds: [], evidenceIds: ['old-rule', 'current-rule'], ...change }]).disposition).toBe('auto_revise')
    }
  })
  it('does not lower confidence or bypass the bounded revision limit', () => {
    expect(assess([], 1, 0.86).disposition).toBe('auto_revise')
    expect(assess([{ code: 'missing-owner', kind: 'external', message: '无根据阻断' }], 3).disposition).toBe('quality_unresolved')
  })
})
