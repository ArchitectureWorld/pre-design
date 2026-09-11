import { describe, expect, it } from 'vitest'
import type { WorkflowDescriptor } from '../src/contracts/types.ts'
import {
  evaluateWorkflowQuality,
  type WorkflowQualityEvidence,
} from '../src/runtime/workflow-quality.ts'

function descriptor(overrides: Partial<WorkflowDescriptor> = {}): WorkflowDescriptor {
  return {
    workflowId: 'preplan.wf.test',
    chapterId: '01',
    workItemId: '01-01',
    title: '测试工作项',
    purpose: '形成可复核的专业判断',
    targetObjectId: 'PS01',
    targetSchemaId: 'urn:test',
    gateId: 'G1',
    requiredUpstream: ['ProjectSeed'],
    atomicToolIds: ['T01'],
    automationLevel: 'A2',
    risk: 'M',
    humanReviewMandatory: true,
    missingDataPolicy: '缺失资料必须显式记录。',
    evidencePolicy: ['事实必须绑定证据', '冲突证据不得静默覆盖'],
    completionCriteria: ['完成核心判断', '记录未决事项'],
    reopenTriggers: ['关键事实变化'],
    forbiddenActions: ['fabricate_missing_values'],
    reviewPolicy: {
      humanReviewMandatory: true,
      provisionalAutoCommitAllowed: false,
      gateStillHuman: true,
    },
    ...overrides,
  }
}

function quality(overrides: Partial<WorkflowQualityEvidence> = {}): WorkflowQualityEvidence {
  return {
    completionChecks: [
      { criterion: '完成核心判断', status: 'pass', rationale: '已由上游事实形成结论' },
      { criterion: '记录未决事项', status: 'pass', rationale: '已明确列出未决事项' },
    ],
    evidenceChecks: [
      { policy: '事实必须绑定证据', status: 'pass', rationale: '事实均有 EvidenceRef' },
      { policy: '冲突证据不得静默覆盖', status: 'pass', rationale: '无未处理冲突' },
    ],
    assumptions: [],
    blockers: [],
    confidence: 0.9,
    ...overrides,
  }
}

describe('evaluateWorkflowQuality', () => {
  it('auto-passes a medium-risk workflow only when every contract rule is covered', () => {
    expect(evaluateWorkflowQuality(descriptor(), quality(), { attempt: 1 })).toMatchObject({
      disposition: 'auto_pass',
      completionCoverage: 1,
      evidenceCoverage: 1,
      confidence: 0.9,
    })
  })

  it('requests an automatic revision when completion or evidence coverage is incomplete', () => {
    const result = evaluateWorkflowQuality(descriptor(), quality({
      completionChecks: [{ criterion: '完成核心判断', status: 'pass', rationale: '已完成' }],
      evidenceChecks: [{ policy: '事实必须绑定证据', status: 'gap', rationale: '部分事实缺少 EvidenceRef' }],
    }), { attempt: 1 })

    expect(result.disposition).toBe('auto_revise')
    expect(result.completionCoverage).toBe(0.5)
    expect(result.evidenceCoverage).toBe(0)
    expect(result.reasons.join('\n')).toMatch(/完成条件|证据/)
  })

  it('blocks on explicit external dependencies instead of repeatedly asking the model to retry', () => {
    const result = evaluateWorkflowQuality(descriptor(), quality({
      blockers: [{ code: 'MISSING_SURVEY', kind: 'external', message: '缺少正式测绘资料' }],
    }), { attempt: 1 })

    expect(result.disposition).toBe('blocked_external')
    expect(result.blockers).toHaveLength(1)
  })

  it('revises low-confidence work before involving a person', () => {
    const result = evaluateWorkflowQuality(descriptor(), quality({ confidence: 0.55 }), { attempt: 1 })
    expect(result.disposition).toBe('auto_revise')
    expect(result.reasons.join('\n')).toMatch(/置信度/)
  })

  it('routes high-risk work to local human review even when the analysis itself passes', () => {
    const result = evaluateWorkflowQuality(descriptor({ risk: 'H' }), quality(), { attempt: 1 })
    expect(result.disposition).toBe('needs_human')
    expect(result.reasons.join('\n')).toMatch(/高风险/)
  })

  it('escalates an exhausted automatic revision loop instead of retrying forever', () => {
    const result = evaluateWorkflowQuality(descriptor(), quality({ confidence: 0.5 }), {
      attempt: 3,
      maxAttempts: 3,
    })
    expect(result.disposition).toBe('needs_human')
    expect(result.reasons.join('\n')).toMatch(/自动修订上限/)
  })
})
