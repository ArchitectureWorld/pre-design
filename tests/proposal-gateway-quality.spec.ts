import { describe, expect, it, vi } from 'vitest'
import { ProposalGateway } from '../src/proposals/gateway.ts'

const payload = {
  object_id: 'BL03', object_type: 'EnvironmentalBaseline', schema_version: '0.6.0', project_id: 'project-1',
  chapter_id: '02', work_item_id: '02-03', status: 'provisional', revision: 5,
  updated_at: '2026-09-11T00:00:00.000Z', data: {},
  approval: { status: 'pending', required_role: 'chapter_reviewer', approver: null, approved_at: null, conditions: [] },
}

const envelope = {
  proposal_id: 'proposal-1', project_id: 'project-1', workflow_id: 'preplan.wf.02.03', target_object_id: 'BL03',
  target_schema_id: 'urn:test:BL03', expected_revision: 4, actor: { role: 'agent', authority_scope: ['propose'] },
  change_set: { payload }, validation_intent: 'human_review', requested_state: 'pending_review',
  idempotency_key: 'proposal-1-key', created_at: '2026-09-11T00:00:00.000Z',
}

const passingQuality = {
  workflowId: 'preplan.wf.02.03', targetObjectId: 'BL03', disposition: 'auto_pass' as const,
  score: 0.92, completionCoverage: 1, evidenceCoverage: 1, confidence: 0.9,
  attempt: 2, maxAttempts: 3, reasons: [], blockers: [], assumptions: [],
}

function harness(risk = 'M') {
  const repositoryCommit = vi.fn(async () => ({ projectId: 'project-1', proposalId: 'proposal-1', revision: 5, replayed: false }))
  const repository = {
    readContext: () => ({
      project: { projectId: 'project-1', currentRevision: 4 },
      proposals: [{ proposalId: 'proposal-1', projectId: 'project-1', envelope }],
    }),
    commitProposal: repositoryCommit,
  }
  const registry = {
    workflow: () => ({
      workflowId: 'preplan.wf.02.03', chapterId: '02', workItemId: '02-03', targetObjectId: 'BL03',
      targetSchemaId: 'urn:test:BL03', gateId: 'G2', risk,
    }),
    validateStateObject: () => ({ valid: true, errors: [] }),
  }
  const governance = {
    readProject: () => ({
      policy: { mode: 'automatic', automationAuthorizationId: 'authorization-1' },
      authorizations: [{
        authorizationId: 'authorization-1', status: 'active', startingRevision: 0,
        scope: { workflowIds: ['preplan.wf.02.03'], chapterIds: ['02'], gateIds: ['G2'] },
        grantedBy: { actorId: 'user-1', name: '负责人', role: 'decision_owner' },
      }],
    }),
  }
  return {
    gateway: new ProposalGateway(repository as never, registry as never, () => '2026-09-11T00:10:00.000Z', governance as never),
    repositoryCommit,
  }
}

describe('ProposalGateway automatic quality boundary', () => {
  it('rejects automatic confirmation when trusted quality is missing', async () => {
    const { gateway, repositoryCommit } = harness()
    await expect(gateway.commitProposal('proposal-1', {
      source: 'automation_authorization', authorizationId: 'authorization-1',
      actor: { actorId: 'system', name: '自动化服务', role: 'system_service' },
    }, 'session-1')).rejects.toThrow(/quality/i)
    expect(repositoryCommit).not.toHaveBeenCalled()
  })

  it('confirms only an auto_pass quality decision with matching workflow identity', async () => {
    const { gateway, repositoryCommit } = harness()
    const result = await gateway.commitProposal('proposal-1', {
      source: 'automation_authorization', authorizationId: 'authorization-1', quality: passingQuality,
      actor: { actorId: 'system', name: '自动化服务', role: 'system_service' },
    }, 'session-1')
    expect(result.status).toBe('confirmed')
    expect(repositoryCommit).toHaveBeenCalledOnce()

    const mismatch = harness()
    await expect(mismatch.gateway.commitProposal('proposal-1', {
      source: 'automation_authorization', authorizationId: 'authorization-1',
      quality: { ...passingQuality, targetObjectId: 'BL99' },
      actor: { actorId: 'system', name: '自动化服务', role: 'system_service' },
    }, 'session-1')).rejects.toThrow(/quality/i)
    expect(mismatch.repositoryCommit).not.toHaveBeenCalled()
  })

  it('never auto-confirms a high-risk workflow even when quality passes', async () => {
    const { gateway, repositoryCommit } = harness('H')
    await expect(gateway.commitProposal('proposal-1', {
      source: 'automation_authorization', authorizationId: 'authorization-1', quality: passingQuality,
      actor: { actorId: 'system', name: '自动化服务', role: 'system_service' },
    }, 'session-1')).rejects.toThrow(/high-risk|高风险/i)
    expect(repositoryCommit).not.toHaveBeenCalled()
  })
})
