import type { ContractRegistry } from '../contracts/registry.ts'
import type { WorkflowDescriptor } from '../contracts/types.ts'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { AutomationAuthorizationRecord } from '../governance/types.ts'
import type { ProjectRepository } from '../state/repository.ts'
import type { ActorRef, ConfirmProposalResult, ProposalRecord } from '../state/types.ts'

interface ProposalEnvelope {
  readonly proposal_id: string
  readonly project_id: string
  readonly workflow_id: string
  readonly target_object_id: string
  readonly target_schema_id: string
  readonly expected_revision: number
  readonly actor: {
    readonly role: string
    readonly authority_scope?: readonly string[]
  }
  readonly change_set: {
    readonly payload: unknown
  }
  readonly validation_intent: string
  readonly requested_state?: string
  readonly idempotency_key?: string
  readonly created_at: string
}

interface ConfirmableStateObject {
  readonly status: string
  readonly revision: number
  readonly updated_at: string
  readonly data: Readonly<Record<string, unknown>>
  readonly approval: Readonly<Record<string, unknown>>
  readonly [key: string]: unknown
}

export class GatewayError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'GatewayError'
  }
}

export type ProposalCommitDecision =
  | { readonly source: 'manual_workflow'; readonly actor: ActorRef }
  | {
    readonly source: 'automation_authorization'
    readonly authorizationId: string
    readonly actor: ActorRef
  }

export interface ProposalCommitResult extends ConfirmProposalResult {
  readonly status: 'provisionally_committed' | 'confirmed'
}

export class ProposalGateway {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly registry: ContractRegistry,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly governance?: GovernanceRepository,
  ) {}

  async submitProposal(value: unknown, sessionId: string): Promise<ProposalRecord> {
    const context = this.repository.readContext(sessionId)
    const envelopeValidation = this.registry.validateProposalEnvelope(value)
    if (!envelopeValidation.valid) {
      throw new GatewayError('invalid-envelope', `ProposalEnvelope validation failed: ${envelopeValidation.errors.join('; ')}`)
    }
    const envelope = value as ProposalEnvelope
    if (envelope.project_id !== context.project.projectId) {
      throw new GatewayError('project-mismatch', 'proposal project does not match the bound Session project')
    }
    if (envelope.actor.role !== 'agent' || !envelope.actor.authority_scope?.includes('propose')) {
      throw new GatewayError('actor-spoofing', 'actor role must be agent with propose authority')
    }
    let descriptor: WorkflowDescriptor
    try {
      descriptor = this.registry.workflow(envelope.workflow_id)
    } catch {
      throw new GatewayError('unknown-workflow', `unknown workflow '${envelope.workflow_id}'`)
    }
    if (envelope.target_object_id !== descriptor.targetObjectId) {
      throw new GatewayError(
        'target-object-mismatch',
        `workflow '${descriptor.workflowId}' must target ${descriptor.targetObjectId}`,
      )
    }
    if (envelope.target_schema_id !== descriptor.targetSchemaId) {
      throw new GatewayError(
        'target-schema-mismatch',
        `target schema must be ${descriptor.targetObjectId} (${descriptor.targetSchemaId})`,
      )
    }
    if (envelope.expected_revision !== context.project.currentRevision) {
      throw new GatewayError(
        'revision-conflict',
        `expected revision ${envelope.expected_revision}, current revision is ${context.project.currentRevision}`,
      )
    }
    if (envelope.validation_intent !== 'human_review' || envelope.requested_state !== 'pending_review') {
      throw new GatewayError('human-review-required', 'preplan.wf.01.01 requires pending human review')
    }
    const stateValidation = this.registry.validateStateObject(descriptor.targetObjectId, envelope.change_set.payload)
    if (!stateValidation.valid) {
      throw new GatewayError(
        'invalid-state',
        `${descriptor.targetObjectId} validation failed: ${stateValidation.errors.join('; ')}`,
      )
    }
    if (envelope.idempotency_key === undefined) {
      throw new GatewayError('idempotency-required', 'ProposalEnvelope idempotency_key is required')
    }

    const replay = context.proposals.find(proposal =>
      proposal.proposalId === envelope.proposal_id || proposal.idempotencyKey === envelope.idempotency_key)
    if (replay !== undefined) {
      if (replay.proposalId !== envelope.proposal_id || replay.idempotencyKey !== envelope.idempotency_key) {
        throw new GatewayError('idempotency-conflict', 'proposal id or idempotency key was already used')
      }
      if (JSON.stringify(replay.envelope) !== JSON.stringify(value)) {
        throw new GatewayError('idempotency-payload-mismatch', 'idempotency replay payload differs from the original proposal')
      }
      return replay
    }
    return this.repository.saveProposal({
      proposalId: envelope.proposal_id,
      projectId: envelope.project_id,
      expectedRevision: envelope.expected_revision,
      idempotencyKey: envelope.idempotency_key,
      envelope: value,
      createdAt: envelope.created_at,
    })
  }

  async commitProposal(
    proposalId: string,
    decision: ProposalCommitDecision,
    sessionId: string,
  ): Promise<ProposalCommitResult> {
    if (decision.actor.role !== 'system_service') {
      throw new GatewayError('system-service-required', 'proposal workflow commit requires system_service')
    }
    const context = this.repository.readContext(sessionId)
    const proposal = context.proposals.find(candidate => candidate.proposalId === proposalId)
    if (proposal === undefined || proposal.projectId !== context.project.projectId) {
      throw new GatewayError('proposal-not-found', `proposal '${proposalId}' is not pending in the bound project`)
    }
    const envelope = proposal.envelope as unknown as ProposalEnvelope
    const descriptor = this.registry.workflow(envelope.workflow_id)
    const policy = this.governance?.readProject(context.project.projectId).policy
    if (decision.source === 'manual_workflow' && policy?.mode === 'automatic') {
      throw new GatewayError('mode-mismatch', 'automatic project requires automation authorization')
    }
    const committedAt = this.now()
    let approvalActor = decision.actor
    if (decision.source === 'automation_authorization') {
      approvalActor = this.requireValidAuthorization(
        context.project.projectId,
        context.project.currentRevision,
        descriptor,
        decision.authorizationId,
        committedAt,
      )
    }

    const confirmed = decision.source === 'automation_authorization'
    const payload = envelope.change_set.payload as ConfirmableStateObject
    const committedPayload = {
      ...payload,
      status: confirmed ? 'confirmed' : 'provisional',
      revision: context.project.currentRevision + 1,
      updated_at: committedAt,
      data: {
        ...payload.data,
        status: confirmed ? 'confirmed' : 'provisional',
      },
      approval: confirmed
        ? {
          ...payload.approval,
          status: 'approved',
          approver: {
            actor_id: approvalActor.actorId,
            name: approvalActor.name,
            role: approvalActor.role,
          },
          approved_at: committedAt,
        }
        : {
          ...payload.approval,
          status: 'pending',
          approver: null,
          approved_at: null,
        },
    }
    const stateValidation = this.registry.validateStateObject(descriptor.targetObjectId, committedPayload)
    if (!stateValidation.valid) {
      throw new GatewayError(
        'invalid-committed-state',
        `Committed ${descriptor.targetObjectId} validation failed: ${stateValidation.errors.join('; ')}`,
      )
    }
    const status = confirmed ? 'confirmed' : 'provisionally_committed'
    const result = await this.repository.commitProposal({
      proposalId,
      actor: decision.actor,
      committedAt,
      eventId: `${proposalId}:${status}`,
      eventType: confirmed ? 'proposal.confirmed' : 'proposal.provisionally_committed',
      status,
      resolveOpenQuestions: false,
      stateObject: {
        objectId: descriptor.targetObjectId,
        value: committedPayload,
      },
    })
    return { ...result, status }
  }

  async confirmProposal(proposalId: string, actor: ActorRef, sessionId: string): Promise<ConfirmProposalResult> {
    if (actor.role !== 'decision_owner') {
      throw new GatewayError('human-required', 'human decision_owner required')
    }
    const context = this.repository.readContext(sessionId)
    const proposal = context.proposals.find(candidate => candidate.proposalId === proposalId)
    if (proposal === undefined || proposal.projectId !== context.project.projectId) {
      throw new GatewayError('proposal-not-found', `proposal '${proposalId}' is not pending in the bound project`)
    }
    const envelope = proposal.envelope as unknown as ProposalEnvelope
    const descriptor = this.registry.workflow(envelope.workflow_id)
    const confirmedAt = this.now()
    const payload = envelope.change_set.payload as ConfirmableStateObject
    const confirmedPayload = {
      ...payload,
      status: 'confirmed',
      revision: context.project.currentRevision + 1,
      updated_at: confirmedAt,
      data: {
        ...payload.data,
        status: 'confirmed',
      },
      approval: {
        ...payload.approval,
        status: 'approved',
        approver: {
          actor_id: actor.actorId,
          name: actor.name,
          role: actor.role,
        },
        approved_at: confirmedAt,
      },
    }
    const stateValidation = this.registry.validateStateObject(descriptor.targetObjectId, confirmedPayload)
    if (!stateValidation.valid) {
      throw new GatewayError(
        'invalid-confirmed-state',
        `Confirmed ${descriptor.targetObjectId} validation failed: ${stateValidation.errors.join('; ')}`,
      )
    }
    return this.repository.confirmProposal({
      proposalId,
      actor,
      confirmedAt,
      eventId: `${proposalId}:confirmed`,
      stateObject: {
        objectId: envelope.target_object_id,
        value: confirmedPayload,
      },
    })
  }

  private requireValidAuthorization(
    projectId: string,
    revision: number,
    descriptor: WorkflowDescriptor,
    authorizationId: string,
    committedAt: string,
  ): AutomationAuthorizationRecord['grantedBy'] {
    const governance = this.governance?.readProject(projectId)
    const authorization = governance?.authorizations.find(candidate =>
      candidate.authorizationId === authorizationId)
    const policyMatches = governance?.policy?.mode === 'automatic'
      && (governance.policy.automationAuthorizationId === undefined
        || governance.policy.automationAuthorizationId === authorizationId)
    const active = authorization?.status === 'active'
      && authorization.startingRevision <= revision
      && (authorization.expiresAt === undefined || authorization.expiresAt > committedAt)
      && authorization.scope.workflowIds.includes(descriptor.workflowId)
      && authorization.scope.chapterIds.includes(descriptor.chapterId)
      && authorization.scope.gateIds.includes(descriptor.gateId)
    if (!policyMatches || !active) {
      throw new GatewayError(
        'authorization-invalid',
        `automation authorization '${authorizationId}' is missing, inactive, expired, or out of scope`,
      )
    }
    return authorization.grantedBy
  }
}
