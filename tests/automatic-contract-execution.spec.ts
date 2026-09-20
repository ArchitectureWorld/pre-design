import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { ContractRegistry } from '../src/contracts/registry.ts'
import { evaluateWorkflowQuality } from '../src/runtime/workflow-quality.ts'

const root = new URL('../contracts/v0.6/', import.meta.url)
const automaticCheck = '已自动核对现有任务输入、来源和上游结论；未知、假设、冲突及后续验证条件已明确记录，不把自动策划结论当作外部授权或实施批准。'

describe('effective automatic contracts', () => {
  it('accepts evidence-backed PS01 analysis without an invented project-owner confirmation', async () => {
    const registry = await ContractRegistry.open(root)
    const descriptor = registry.workflow('preplan.wf.01.01')
    const report = evaluateWorkflowQuality(descriptor, {
      completionChecks: [
        { criterion: '非参与人员能够准确复述项目；背景与触发分开；不得提前推导方案。', status: 'pass', rationale: '项目地点、性质和本轮用户任务有证据。' },
        { criterion: automaticCheck, status: 'pass', rationale: '自动核对完成，未指定项目负责人，未声称取得外部授权。' },
      ],
      evidenceChecks: descriptor.evidencePolicy!.map(policy => ({ policy, status: 'pass' as const, rationale: '已绑定来源并区分未知与事实。' })),
      assumptions: ['项目法定负责人未指定'], blockers: [], confidence: 0.92,
    }, { attempt: 1 })
    expect(report.disposition).toBe('auto_pass')
    expect(report.completionCoverage).toBe(1)
  })

  it('exposes effective rules for all 57 workflows while keeping frozen source contracts unchanged', async () => {
    const registry = await ContractRegistry.open(root)
    for (const workflow of registry.workflows()) {
      const source = JSON.parse(await readFile(new URL(`workflows/${workflow.workflowId}.contract.json`, root), 'utf8'))
      expect(workflow.humanReviewMandatory, workflow.workflowId).toBe(false)
      expect(workflow.reviewPolicy).toMatchObject({ humanReviewMandatory: false, gateStillHuman: false, provisionalAutoCommitAllowed: true })
      expect(workflow.completionCriteria).toEqual([source.completion_criteria[0], automaticCheck])
      expect(source.completion_criteria[1]).not.toBe(automaticCheck)
      expect(workflow.missingDataPolicy, workflow.workflowId).not.toMatch(/人工|确认设为 G1 前置|未确认项保持 pending，作为 G8 前置/u)
    }
    expect(registry.workflows()).toHaveLength(57)
    for (const gate of registry.gates()) {
      expect(gate.approvalPolicy).toMatchObject({ role: 'system_service', assignmentRequired: false, agentAllowed: false, systemServiceAllowed: true })
    }
  })

  it('still rejects missing substantive checks even when no human approval is required', async () => {
    const registry = await ContractRegistry.open(root)
    const descriptor = registry.workflow('preplan.wf.01.01')
    const report = evaluateWorkflowQuality(descriptor, {
      completionChecks: [{ criterion: automaticCheck, status: 'pass', rationale: '已核对' }],
      evidenceChecks: [], assumptions: [], blockers: [], confidence: 0.95,
    }, { attempt: 1 })
    expect(report.disposition).toBe('auto_revise')
    expect(report.completionCoverage).toBe(0.5)
    expect(report.evidenceCoverage).toBe(0)
  })
})
