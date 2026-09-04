import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { ContractRegistry } from '../contracts/registry.ts'
import { buildControlledContext } from '../context/build-context.ts'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { PresentationAutoSyncService } from '../presentation/auto-sync.ts'
import type { AutomaticGateApprover } from '../runtime/automatic-gate-approver.ts'
import type { ProposalGateway } from '../proposals/gateway.ts'
import type { WorkflowRuntime } from '../runtime/workflow-runtime.ts'
import { buildPreplanningStatus } from '../session/events.ts'
import type { ProjectRepository } from '../state/repository.ts'

export interface ToolDependencies {
  readonly repository: ProjectRepository
  readonly gateway: ProposalGateway
  readonly governance: GovernanceRepository
  readonly runtime: WorkflowRuntime
  readonly registry: ContractRegistry
  readonly presentationSync?: Pick<PresentationAutoSyncService, 'request' | 'status'>
  readonly gateApprover?: Pick<AutomaticGateApprover, 'approveReady'>
}

function sessionIdOf(exec: { readonly agent?: { readonly id: unknown } }): string {
  if (exec.agent === undefined) throw new Error('前期策划工具必须在 DSH Agent Session 中调用。')
  return String(exec.agent.id)
}

function workspaceRootOf(exec: { readonly agent?: unknown }): string | undefined {
  const agent = exec.agent
  if (agent === null || typeof agent !== 'object') return undefined
  const cwd = (agent as { readonly session?: { readonly header?: { readonly cwd?: unknown } } })
    .session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd.trim() : undefined
}

function jsonSnapshot(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

const PROPOSAL_ENVELOPE_PARAMETER = {
  type: 'object',
  additionalProperties: false,
  required: true,
  description: '符合 v0.6 合同的 ProposalEnvelope JSON 对象；字段值必须来自 preplanning_get_context，不得传 JSON 字符串。',
  properties: {
    proposal_id: { type: 'string', required: true },
    project_id: { type: 'string', required: true },
    workflow_id: { type: 'string', required: true },
    target_object_id: { type: 'string', required: true },
    target_schema_id: { type: 'string', required: true },
    expected_revision: { type: 'integer', required: true },
    actor: {
      type: 'object',
      additionalProperties: true,
      required: true,
      properties: {
        actor_id: { type: 'string', required: true },
        name: { type: 'string', required: true },
        role: { type: 'string', enum: ['agent'], required: true },
        authority_scope: { type: 'array', items: { type: 'string' } },
      },
    },
    created_at: { type: 'string', required: true },
    change_set: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        operation: {
          type: 'string',
          enum: ['create', 'replace', 'merge_patch', 'supersede'],
          required: true,
        },
        payload: { type: 'object', additionalProperties: true, required: true },
        semantic_paths: { type: 'array', items: { type: 'string' }, required: true },
        editorial_only: { type: 'boolean' },
      },
    },
    evidence_refs: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          evidence_id: { type: 'string', required: true },
          asset_id: { type: 'string', required: true },
          version_id: { type: 'string', required: true },
          claim_class: {
            type: 'string',
            enum: ['fact', 'source_conclusion', 'user_statement', 'agent_inference', 'assumption', 'decision', 'missing'],
            required: true,
          },
          locator: { type: 'object', additionalProperties: true, required: true },
        },
      },
    },
    assumptions: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          description: { type: 'string' },
          status: { type: 'string' },
        },
      },
    },
    validation_intent: { type: 'string', enum: ['human_review'], required: true },
    requested_state: { type: 'string', enum: ['pending_review'], required: true },
    idempotency_key: { type: 'string', required: true },
  },
} as const

export function registerPreplanningTools(ctx: Context, dependencies: ToolDependencies): void {
  ctx.tools.register(defineTool({
    name: 'preplanning_get_context',
    description: '读取当前 DSH Session 绑定项目的受控前期策划上下文。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec) {
      return jsonSnapshot(buildControlledContext(dependencies.repository, sessionIdOf(exec), dependencies))
    },
  }))
  ctx.tools.register(defineTool({
    name: 'preplanning_apply_commands',
    description: '提交 ProposalEnvelope 供合同、权限和人工复核网关验证；不直接写入 Project State。',
    parameters: {
      envelope: PROPOSAL_ENVELOPE_PARAMETER,
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec)
      const proposal = await dependencies.gateway.submitProposal(args.envelope, sessionId)
      const workflowId = (args.envelope as { readonly workflow_id?: unknown }).workflow_id
      let status = proposal.status
      let revision: number | undefined
      if (typeof workflowId === 'string') {
        const run = dependencies.runtime.snapshot(proposal.projectId).runs.find(row => row.workflowId === workflowId)
        if (run?.status === 'running') {
          const policy = dependencies.governance.readProject(proposal.projectId).policy
          if (policy?.mode === 'automatic') {
            if (policy.automationAuthorizationId === undefined) {
              throw new Error(`project '${proposal.projectId}' automatic mode has no authorization`)
            }
            const committed = await dependencies.gateway.commitProposal(proposal.proposalId, {
              source: 'automation_authorization',
              authorizationId: policy.automationAuthorizationId,
              actor: {
                actorId: 'preplanning-automation',
                name: '前期策划自动化服务',
                role: 'system_service',
              },
            }, sessionId)
            await dependencies.runtime.transition(proposal.projectId, workflowId, {
              to: 'confirmed',
              proposalId: proposal.proposalId,
              revision: committed.revision,
            })
            const approvedGates = await dependencies.gateApprover?.approveReady(proposal.projectId) ?? 0
            revision = committed.revision
            dependencies.presentationSync?.request(proposal.projectId, {
              ...(workspaceRootOf(exec) === undefined ? {} : { workspaceRoot: workspaceRootOf(exec) }),
              reason: `automatic-workflow:${workflowId}:revision:${committed.revision}:approved-gates:${approvedGates}`,
            })
            status = committed.status
          } else {
            await dependencies.runtime.transition(proposal.projectId, workflowId, {
              to: 'pending_review',
              proposalId: proposal.proposalId,
            })
          }
        }
      }
      return {
        proposalId: proposal.proposalId,
        projectId: proposal.projectId,
        expectedRevision: proposal.expectedRevision,
        status,
        ...(revision === undefined ? {} : { revision }),
        preplanningStatus: jsonSnapshot(buildPreplanningStatus(
          dependencies.repository.readContext(sessionId),
          dependencies,
        )),
      }
    },
  }))
}
