import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { registerPreplanningTools } from '../src/tools/register.ts'

function validToolEnvelope(workflowId = 'preplan.wf.01.01') {
  return {
    proposal_id: 'proposal-1',
    project_id: 'project-1',
    workflow_id: workflowId,
    target_object_id: 'PS01',
    target_schema_id: 'urn:preplan:v0.6:state:PS01',
    expected_revision: 0,
    actor: { actor_id: 'agent-1', name: '前期策划智能体', role: 'agent', authority_scope: ['propose'] },
    created_at: '2026-08-27T16:05:00.000Z',
    change_set: { operation: 'create', payload: {}, semantic_paths: ['/data'] },
    evidence_refs: [],
    assumptions: [],
    validation_intent: 'human_review',
    requested_state: 'pending_review',
    idempotency_key: 'idempotency-tool-1',
  }
}

describe('preplanning model tools', () => {
  it('精确注册两个模型工具，不暴露 T01—T47', () => {
    const definitions: ToolDefinition[] = []
    const ctx = {
      tools: { register: (definition: ToolDefinition) => { definitions.push(definition); return () => undefined } },
    } as unknown as Context
    registerPreplanningTools(ctx, {
      repository: {} as never, gateway: {} as never, governance: {} as never,
      runtime: {} as never, registry: {} as never,
    })

    expect(definitions.map(definition => definition.name)).toEqual([
      'preplanning_get_context',
      'preplanning_apply_commands',
    ])
    expect(definitions.some(definition => /^T\d{2}$/u.test(definition.name))).toBe(false)
  })

  it('向真实模型暴露 ProposalEnvelope 的必填结构与受控枚举', () => {
    const definitions: ToolDefinition[] = []
    const ctx = {
      tools: { register: (definition: ToolDefinition) => { definitions.push(definition); return () => undefined } },
    } as unknown as Context
    registerPreplanningTools(ctx, {
      repository: {} as never, gateway: {} as never, governance: {} as never,
      runtime: {} as never, registry: {} as never,
    })

    const applyCommands = definitions.find(definition => definition.name === 'preplanning_apply_commands')

    expect(applyCommands?.parameters).toMatchObject({
      type: 'object',
      required: ['envelope'],
      properties: {
        envelope: {
          type: 'object',
          additionalProperties: false,
          required: expect.arrayContaining([
            'proposal_id', 'project_id', 'workflow_id', 'target_object_id',
            'target_schema_id', 'expected_revision', 'actor', 'created_at',
            'change_set', 'evidence_refs', 'assumptions', 'validation_intent',
          ]),
          properties: {
            validation_intent: { type: 'string', enum: ['human_review'] },
            requested_state: { type: 'string', enum: ['pending_review'] },
            change_set: {
              type: 'object',
              additionalProperties: false,
              required: ['operation', 'payload', 'semantic_paths'],
              properties: {
                operation: { type: 'string', enum: ['create', 'replace', 'merge_patch', 'supersede'] },
              },
            },
          },
        },
      },
    })
  })

  it('使用调用 Agent 的 SessionBinding 读上下文并提交 ProposalEnvelope', async () => {
    const definitions: ToolDefinition[] = []
    let proposalSubmitted = false
    const readContext = vi.fn(() => ({
      project: {
        projectId: 'project-1', name: '验收项目', currentRevision: 0, currentStage: '01-01',
        createdAt: '2026-08-27T16:00:00.000Z', updatedAt: '2026-08-27T16:00:00.000Z',
      },
      binding: { sessionId: 'session-1', projectId: 'project-1', boundAt: '2026-08-27T16:00:00.000Z' },
      stateObjects: [],
      revisions: [],
      events: [],
      questions: [],
      proposals: proposalSubmitted
        ? [{
            proposalId: 'proposal-1', projectId: 'project-1', expectedRevision: 0,
            idempotencyKey: 'idempotency-1', envelope: {}, status: 'pending_review',
            createdAt: '2026-08-27T16:05:00.000Z',
          }]
        : [],
    }))
    const submitProposal = vi.fn(async () => {
      proposalSubmitted = true
      return { proposalId: 'proposal-1', projectId: 'project-1', expectedRevision: 0, status: 'pending_review' }
    })
    const ctx = {
      tools: { register: (definition: ToolDefinition) => { definitions.push(definition); return () => undefined } },
    } as unknown as Context
    registerPreplanningTools(ctx, {
      repository: { readContext } as never,
      gateway: { submitProposal } as never,
      governance: {
        readProject: vi.fn(() => ({
          policy: { mode: 'manual', reportDepth: 'standard' },
          authorizations: [], gateDecisions: [], visualTasks: [], visualAssets: [], siteBoundaries: [], reportPackages: [],
        })),
      } as never,
      runtime: {
        nextReady: vi.fn(() => undefined),
        snapshot: vi.fn(() => ({
          chapters: [{ chapterId: '01', total: 7, completed: 0, ready: 0, running: 1, blocked: 0, pendingReview: 0 }],
          blocked: [],
          runs: [{
            runId: 'project-1:preplan.wf.01.01', projectId: 'project-1', workflowId: 'preplan.wf.01.01',
            chapterId: '01', workItemId: '01-01', targetObjectId: 'PS01', status: 'running',
            attempt: 1, updatedAt: '2026-08-27T16:01:00.000Z',
          }],
        })),
        transition: vi.fn(async () => undefined),
      } as never,
      registry: {
        workflow: vi.fn(() => ({
          workflowId: 'preplan.wf.01.01', chapterId: '01', workItemId: '01-01',
          title: '项目基本情况与启动原因', targetObjectId: 'PS01', gateId: 'G1', requiredUpstream: ['ProjectSeed'],
        })),
        stateSchema: vi.fn(() => ({ $id: 'urn:preplan:v0.6:state:PS01', type: 'object' })),
        stateExample: vi.fn(() => ({ object_id: 'PS01', data: { canonical_name: 'name_sample' } })),
        gate: vi.fn(() => ({ gateId: 'G1', chapterId: '01', title: '项目任务确认' })),
      } as never,
    })
    const exec = { agent: { id: 'session-1' } } as never
    const getContext = definitions.find(definition => definition.name === 'preplanning_get_context')
    const applyCommands = definitions.find(definition => definition.name === 'preplanning_apply_commands')

    const controlled = await getContext?.execute({}, exec)
    const envelope = validToolEnvelope()
    const applied = await applyCommands?.execute({ envelope }, exec)

    expect(readContext).toHaveBeenCalledWith('session-1')
    expect(controlled).toMatchObject({
      mode: 'manual',
      nextWorkflow: { workflowId: 'preplan.wf.01.01', targetObjectId: 'PS01' },
      targetSchema: { $id: 'urn:preplan:v0.6:state:PS01' },
      targetPayloadExample: { object_id: 'PS01', data: { canonical_name: 'name_sample' } },
      chapters: [{ chapterId: '01', total: 7, running: 1 }],
      blockers: [],
    })
    expect(submitProposal).toHaveBeenCalledWith(envelope, 'session-1')
    expect(applied).toMatchObject({
      proposalId: 'proposal-1', status: 'pending_review',
      preplanningStatus: {
        projectId: 'project-1', projectName: '验收项目', revision: 0, stage: '01-01',
        status: 'pending_review', pendingProposalCount: 1, openQuestionCount: 0,
      },
    })
  })

  it('全自动模式用有效授权确认提案并推进 workflow', async () => {
    const definitions: ToolDefinition[] = []
    const transition = vi.fn(async () => undefined)
    const commitProposal = vi.fn(async () => ({
      projectId: 'project-1', proposalId: 'proposal-1', revision: 1, replayed: false, status: 'confirmed',
    }))
    const ctx = {
      tools: { register: (definition: ToolDefinition) => { definitions.push(definition); return () => undefined } },
    } as unknown as Context
    registerPreplanningTools(ctx, {
      repository: {
        readContext: vi.fn(() => ({
          project: { projectId: 'project-1', name: '自动项目', currentRevision: 1, currentStage: '01-01' },
          binding: { sessionId: 'session-1', projectId: 'project-1' },
          stateObjects: [], revisions: [], events: [], questions: [], proposals: [],
        })),
      } as never,
      gateway: {
        submitProposal: vi.fn(async () => ({
          proposalId: 'proposal-1', projectId: 'project-1', expectedRevision: 0, status: 'pending_review',
        })),
        commitProposal,
      } as never,
      governance: {
        readProject: vi.fn(() => ({
          policy: { mode: 'automatic', automationAuthorizationId: 'authorization-1' },
          authorizations: [{ authorizationId: 'authorization-1', status: 'active' }],
          workflowRuns: [], gateDecisions: [], visualTasks: [], visualAssets: [], siteBoundaries: [], reportPackages: [],
        })),
      } as never,
      runtime: {
        snapshot: vi.fn(() => ({
          chapters: [], blocked: [],
          runs: [{ workflowId: 'preplan.wf.01.01', status: 'running' }],
        })),
        transition,
      } as never,
      registry: {} as never,
    })

    const applyCommands = definitions.find(definition => definition.name === 'preplanning_apply_commands')
    const applied = await applyCommands?.execute({ envelope: validToolEnvelope() }, {
      agent: { id: 'session-1' },
    } as never)

    expect(commitProposal).toHaveBeenCalledWith('proposal-1', {
      source: 'automation_authorization',
      authorizationId: 'authorization-1',
      actor: { actorId: 'preplanning-automation', name: '前期策划自动化服务', role: 'system_service' },
    }, 'session-1')
    expect(transition).toHaveBeenCalledWith('project-1', 'preplan.wf.01.01', {
      to: 'confirmed', proposalId: 'proposal-1', revision: 1,
    })
    expect(applied).toMatchObject({ status: 'confirmed', revision: 1 })
  })
})
