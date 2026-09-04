import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContractRegistry } from '../contracts/registry.ts'
import type { WorkflowDescriptor } from '../contracts/types.ts'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { ProposalGateway } from '../proposals/gateway.ts'
import type { ProjectRepository } from '../state/repository.ts'
import type { WorkflowAnalysisCandidate } from './subagent-workflow-analyzer.ts'

interface AutomationWorkflowCommitterDependencies {
  readonly repository: Pick<ProjectRepository, 'readContext'>
  readonly governance: Pick<GovernanceRepository, 'readProject'>
  readonly registry: Pick<ContractRegistry, 'validateStateObject' | 'stateExample'>
  readonly gateway: Pick<ProposalGateway, 'submitProposal' | 'commitProposal'>
  readonly now?: () => string
  readonly createId?: () => string
}

export interface AutomationWorkflowCommitResult {
  readonly proposalId: string
  readonly revision: number
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? structuredClone(value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

function stringArray(value: unknown, fallback: readonly string[] = []): string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? [...value]
    : [...fallback]
}

export class AutomationWorkflowCommitter {
  private readonly now: () => string
  private readonly createId: () => string

  constructor(private readonly dependencies: AutomationWorkflowCommitterDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString())
    this.createId = dependencies.createId ?? (() => randomUUID())
  }

  async commit(
    parent: Agent,
    projectId: string,
    descriptor: WorkflowDescriptor,
    candidate: WorkflowAnalysisCandidate,
  ): Promise<AutomationWorkflowCommitResult> {
    const sessionId = String(parent.id)
    const context = this.dependencies.repository.readContext(sessionId)
    if (context.project.projectId !== projectId) {
      throw new Error(`parent Session is bound to '${context.project.projectId}', not '${projectId}'`)
    }
    const currentRevision = context.project.currentRevision
    const timestamp = this.now()
    const sourceSnapshot = Object.fromEntries(descriptor.requiredUpstream
      .filter(objectId => objectId !== 'ProjectSeed')
      .map((objectId) => {
        const upstream = context.stateObjects.find(record => record.objectId === objectId)
        if (upstream === undefined) throw new Error(`required upstream object '${objectId}' is unavailable`)
        return [objectId, upstream.revision]
      }))
    const example = recordOf(this.dependencies.registry.stateExample(descriptor.targetObjectId))
    const exampleApproval = recordOf(example.approval)
    const supplied = recordOf(candidate.payload)
    const suppliedApproval = recordOf(supplied.approval)
    const actor = {
      actor_id: `preplanning-workflow-agent:${sessionId}`,
      name: '前期策划专业分析 Agent',
      role: 'agent',
      organization: null,
      authority_scope: ['propose'],
      contact_ref: null,
    }
    const payload: Record<string, unknown> = {
      ...supplied,
      object_id: descriptor.targetObjectId,
      object_type: stringValue(example.object_type, stringValue(supplied.object_type, descriptor.targetObjectId)),
      schema_version: stringValue(example.schema_version, '0.6.0'),
      project_id: projectId,
      chapter_id: descriptor.chapterId,
      work_item_id: descriptor.workItemId,
      status: 'provisional',
      revision: currentRevision + 1,
      created_at: timestamp,
      updated_at: timestamp,
      created_by: actor,
      source_snapshot: sourceSnapshot,
      approval: {
        ...exampleApproval,
        ...suppliedApproval,
        status: 'pending',
        required_role: stringValue(
          suppliedApproval.required_role,
          stringValue(exampleApproval.required_role, 'chapter_reviewer'),
        ),
        approver: null,
        approved_at: null,
        conditions: stringArray(suppliedApproval.conditions, stringArray(exampleApproval.conditions)),
        comment: typeof suppliedApproval.comment === 'string'
          ? suppliedApproval.comment
          : typeof exampleApproval.comment === 'string' ? exampleApproval.comment : '',
      },
    }
    const validation = this.dependencies.registry.validateStateObject(
      descriptor.targetObjectId,
      payload,
    )
    if (!validation.valid) {
      throw new Error(`${descriptor.targetObjectId} validation failed: ${validation.errors.join('; ')}`)
    }

    const governed = this.dependencies.governance.readProject(projectId)
    const authorizationId = governed.policy?.mode === 'automatic'
      ? governed.policy.automationAuthorizationId
      : undefined
    if (authorizationId === undefined) {
      throw new Error(`project '${projectId}' has no active automatic authorization`)
    }
    const unique = this.createId()
    const envelope = {
      proposal_id: `proposal-${unique}`,
      project_id: projectId,
      workflow_id: descriptor.workflowId,
      target_object_id: descriptor.targetObjectId,
      target_schema_id: descriptor.targetSchemaId,
      expected_revision: currentRevision,
      actor,
      created_at: timestamp,
      change_set: {
        operation: 'create',
        payload,
        semantic_paths: [`/${descriptor.targetObjectId}`],
        editorial_only: false,
      },
      evidence_refs: [],
      assumptions: [],
      validation_intent: 'human_review',
      requested_state: 'pending_review',
      dependency_versions: sourceSnapshot,
      idempotency_key: `parallel:${projectId}:${descriptor.workflowId}:r${currentRevision}:${unique}`,
    }
    const proposal = await this.dependencies.gateway.submitProposal(envelope, sessionId)
    const committed = await this.dependencies.gateway.commitProposal(proposal.proposalId, {
      source: 'automation_authorization',
      authorizationId,
      actor: {
        actorId: 'preplanning-automation',
        name: '前期策划自动化服务',
        role: 'system_service',
      },
    }, sessionId)
    return Object.freeze({
      proposalId: committed.proposalId,
      revision: committed.revision,
    })
  }
}
