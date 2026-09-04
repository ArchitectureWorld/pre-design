import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { registerPreplanningTools } from '../src/tools/register.ts'

function envelope() {
  return {
    proposal_id: 'proposal-serial-gate',
    project_id: 'project-1',
    workflow_id: 'preplan.wf.08.08',
    target_object_id: 'IM08',
    target_schema_id: 'urn:preplan:v0.6:state:IM08',
    expected_revision: 56,
    actor: { actor_id: 'agent-1', name: '前期策划智能体', role: 'agent', authority_scope: ['propose'] },
    created_at: '2026-09-04T09:00:00.000Z',
    change_set: { operation: 'create', payload: {}, semantic_paths: ['/data'] },
    evidence_refs: [],
    assumptions: [],
    validation_intent: 'human_review',
    requested_state: 'pending_review',
    idempotency_key: 'serial-final-workflow-gate',
  }
}

describe('serial automatic workflow completion', () => {
  it('approves the newly Ready final Gate before scheduling Presentation sync', async () => {
    const definitions: ToolDefinition[] = []
    const approveReady = vi.fn(async () => 1)
    const request = vi.fn()
    const transition = vi.fn(async () => undefined)
    const ctx = {
      tools: { register: (definition: ToolDefinition) => { definitions.push(definition); return () => undefined } },
    } as unknown as Context

    registerPreplanningTools(ctx, {
      repository: {
        readContext: vi.fn(() => ({
          project: { projectId: 'project-1', name: '最终章节项目', currentRevision: 57, currentStage: '08-08' },
          binding: { sessionId: 'session-1', projectId: 'project-1' },
          stateObjects: [], revisions: [], events: [], questions: [], proposals: [],
        })),
      },
      gateway: {
        submitProposal: vi.fn(async () => ({
          proposalId: 'proposal-serial-gate', projectId: 'project-1', expectedRevision: 56, status: 'pending_review',
        })),
        commitProposal: vi.fn(async () => ({
          projectId: 'project-1', proposalId: 'proposal-serial-gate', revision: 57,
          replayed: false, status: 'confirmed',
        })),
      },
      governance: {
        readProject: vi.fn(() => ({
          policy: { mode: 'automatic', automationAuthorizationId: 'authorization-1', reportDepth: 'standard' },
          authorizations: [{ authorizationId: 'authorization-1', status: 'active' }],
          gateDecisions: [], visualTasks: [], visualAssets: [], siteBoundaries: [], reportPackages: [],
        })),
      },
      runtime: {
        snapshot: vi.fn(() => ({
          chapters: [{ chapterId: '08', total: 8, completed: 8, ready: 0, running: 0, blocked: 0, pendingReview: 0 }],
          blocked: [],
          runs: [{ workflowId: 'preplan.wf.08.08', status: 'running' }],
        })),
        transition,
      },
      registry: {},
      gateApprover: { approveReady },
      presentationSync: {
        request,
        status: () => ({ state: 'pending', currentRevision: 57, syncedRevision: 56, updatedAt: '2026-09-04T09:00:00.000Z' }),
      },
    } as never)

    const applyCommands = definitions.find(definition => definition.name === 'preplanning_apply_commands')
    await applyCommands?.execute({ envelope: envelope() }, {
      agent: { id: 'session-1', session: { header: { cwd: 'D:\\沙潭河' } } },
    } as never)

    expect(transition).toHaveBeenCalledWith('project-1', 'preplan.wf.08.08', {
      to: 'confirmed', proposalId: 'proposal-serial-gate', revision: 57,
    })
    expect(approveReady).toHaveBeenCalledWith('project-1')
    expect(request).toHaveBeenCalledWith('project-1', {
      workspaceRoot: 'D:\\沙潭河',
      reason: 'automatic-workflow:preplan.wf.08.08:revision:57:approved-gates:1',
    })
    expect(approveReady.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]!)
  })
})
