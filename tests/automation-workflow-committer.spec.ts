import { describe, expect, it, vi } from 'vitest'
import { AutomationWorkflowCommitter } from '../src/runtime/automation-workflow-committer.ts'
import { AutomaticGateApprover } from '../src/runtime/automatic-gate-approver.ts'

const descriptor = {
  workflowId: 'preplan.wf.02.03',
  chapterId: '02',
  workItemId: '02-03',
  title: '自然环境基线',
  purpose: '识别自然环境条件',
  targetObjectId: 'BL03',
  targetSchemaId: 'urn:preplan:v0.6:BL03',
  gateId: 'G2',
  requiredUpstream: ['PS03', 'PS07'],
  atomicToolIds: [],
  automationLevel: 'automatic',
  risk: 'medium',
  humanReviewMandatory: false,
  missingDataPolicy: 'explicit_unknown',
}

describe('AutomationWorkflowCommitter', () => {
  it('normalizes protected metadata and commits against the latest Revision', async () => {
    let capturedEnvelope: Record<string, unknown> | undefined
    const validateStateObject = vi.fn(() => ({ valid: true, errors: [] }))
    const committer = new AutomationWorkflowCommitter({
      repository: {
        readContext: () => ({
          project: { projectId: 'preplan-1', name: '沙潭河', currentRevision: 4 },
          stateObjects: [
            { objectId: 'PS03', revision: 2, value: { data: {} } },
            { objectId: 'PS07', revision: 4, value: { data: {} } },
          ],
        }),
      },
      governance: {
        readProject: () => ({
          policy: { mode: 'automatic', automationAuthorizationId: 'authorization-1' },
          authorizations: [{ authorizationId: 'authorization-1', status: 'active' }],
        }),
      },
      registry: {
        validateStateObject,
        stateExample: () => ({
          schema_version: '0.6.0',
          object_type: 'EnvironmentalBaseline',
          approval: { required_role: 'chapter_reviewer', conditions: [], comment: '' },
        }),
      },
      gateway: {
        submitProposal: async envelope => {
          capturedEnvelope = envelope as Record<string, unknown>
          return {
            proposalId: (envelope as { proposal_id: string }).proposal_id,
            projectId: 'preplan-1', expectedRevision: 4, idempotencyKey: 'parallel-key',
            envelope, createdAt: '2026-09-04T00:00:00Z', status: 'pending_review',
          }
        },
        commitProposal: async () => ({
          projectId: 'preplan-1', proposalId: 'proposal-1', revision: 5,
          replayed: false, status: 'confirmed',
        }),
      },
      now: () => '2026-09-04T00:00:00Z',
    } as never)

    const result = await committer.commit(
      { id: 'session-1' } as never,
      'preplan-1',
      descriptor,
      {
        payload: {
          object_id: 'SHOULD_NOT_SURVIVE',
          project_id: 'wrong-project',
          chapter_id: '99',
          work_item_id: '99-99',
          status: 'confirmed',
          revision: 999,
          object_type: 'EnvironmentalBaseline',
          data: { terrain: [], hydrology: [], confidence: { level: 'low', score: 0.2, basis: '资料不足' } },
          quality: { completeness: 0.3, consistency: 0.8, timeliness: 0.5, traceability: 0.2, reproducibility: 0.2, issues: ['缺少正式资料'], grade: 'D' },
        },
      },
    )

    expect(result.revision).toBe(5)
    const envelope = capturedEnvelope as {
      expected_revision: number
      actor: Record<string, unknown>
      change_set: { payload: Record<string, unknown> }
      dependency_versions: Record<string, number>
    }
    expect(envelope.expected_revision).toBe(4)
    expect(envelope.actor).toMatchObject({ role: 'agent', authority_scope: ['propose'] })
    expect(envelope.dependency_versions).toEqual({ PS03: 2, PS07: 4 })
    expect(envelope.change_set.payload).toMatchObject({
      object_id: 'BL03', project_id: 'preplan-1', chapter_id: '02', work_item_id: '02-03',
      status: 'provisional', revision: 5, schema_version: '0.6.0',
      created_by: { role: 'agent', authority_scope: ['propose'] },
      source_snapshot: { PS03: 2, PS07: 4 },
      approval: { status: 'pending', required_role: 'chapter_reviewer', approver: null, approved_at: null },
    })
    expect(validateStateObject).toHaveBeenCalledWith('BL03', envelope.change_set.payload)
  })

  it('rejects an invalid candidate before submitting a Proposal', async () => {
    const submitProposal = vi.fn()
    const committer = new AutomationWorkflowCommitter({
      repository: {
        readContext: () => ({ project: { projectId: 'preplan-1', currentRevision: 1 }, stateObjects: [] }),
      },
      governance: {
        readProject: () => ({ policy: { mode: 'automatic', automationAuthorizationId: 'authorization-1' } }),
      },
      registry: {
        validateStateObject: () => ({ valid: false, errors: ['/data required'] }),
        stateExample: () => ({ schema_version: '0.6.0', object_type: 'EnvironmentalBaseline', approval: { required_role: 'chapter_reviewer' } }),
      },
      gateway: { submitProposal, commitProposal: vi.fn() },
      now: () => '2026-09-04T00:00:00Z',
    } as never)

    await expect(committer.commit(
      { id: 'session-1' } as never,
      'preplan-1', descriptor, { payload: {} },
    )).rejects.toThrow('BL03 validation failed: /data required')
    expect(submitProposal).not.toHaveBeenCalled()
  })
})

describe('AutomaticGateApprover', () => {
  it('approves newly Ready gates once and leaves existing decisions unchanged', async () => {
    const decideGate = vi.fn(async (_projectId, gateId) => ({ gateId }))
    const approver = new AutomaticGateApprover({
      registry: { gates: () => [{ gateId: 'G1' }, { gateId: 'G2' }, { gateId: 'G3' }] },
      governance: {
        readProject: () => ({
          policy: { mode: 'automatic', automationAuthorizationId: 'authorization-1' },
          gateDecisions: [{ gateId: 'G1', revision: 7, decision: 'approved' }],
        }),
      },
      gates: {
        evaluateGate: (_projectId, gateId) => ({
          gateId, ready: gateId !== 'G3', revision: 7,
        }),
        decideGate,
      },
    } as never)

    expect(await approver.approveReady('preplan-1')).toBe(1)
    expect(decideGate).toHaveBeenCalledOnce()
    expect(decideGate.mock.calls[0]?.[1]).toBe('G2')
    expect(decideGate.mock.calls[0]?.[2]).toMatchObject({
      source: 'automation_authorization',
      authorizationId: 'authorization-1',
      decision: 'approved',
      actor: { role: 'system_service' },
    })
  })
})
