import { createHash } from 'node:crypto'
import type { ContractRegistry } from '../contracts/registry.ts'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { WorkflowRuntime } from '../runtime/workflow-runtime.ts'
import type { ProjectRepository } from '../state/repository.ts'
import type { ActorRef, ProposalRecord } from '../state/types.ts'

type ConfirmedProposalRecord = ProposalRecord & {
  readonly status: 'confirmed'
  readonly committedRevision: number
  readonly confirmedAt: string
  readonly confirmedBy: ActorRef
}

function isConfirmedProposal(proposal: ProposalRecord): proposal is ConfirmedProposalRecord {
  return proposal.status === 'confirmed'
    && proposal.committedRevision !== undefined
    && proposal.confirmedAt !== undefined
    && proposal.confirmedBy !== undefined
}

export interface ControlledContextDependencies {
  readonly governance: GovernanceRepository
  readonly runtime: WorkflowRuntime
  readonly registry: ContractRegistry
}

export function buildControlledContext(
  repository: ProjectRepository,
  sessionId: string,
  dependencies?: ControlledContextDependencies,
) {
  const context = repository.readContext(sessionId)
  const stateObjects = context.stateObjects.map(record => ({
    objectId: record.objectId,
    revision: record.revision,
    value: record.value,
  }))
  const base = {
    project: {
      projectId: context.project.projectId,
      name: context.project.name,
      revision: context.project.currentRevision,
      stage: context.project.currentStage,
    },
    revisionHash: createHash('sha256').update(JSON.stringify(stateObjects)).digest('hex'),
    stateObjects,
    openQuestions: context.questions
      .filter(question => question.status === 'open')
      .map(question => ({ questionId: question.questionId, prompt: question.prompt, priority: question.priority })),
    pendingProposals: context.proposals
      .filter(proposal => proposal.status === 'pending_review')
      .map(proposal => ({ proposalId: proposal.proposalId, expectedRevision: proposal.expectedRevision })),
    confirmedProposals: context.proposals
      .filter(isConfirmedProposal)
      .map(proposal => ({
        proposalId: proposal.proposalId,
        committedRevision: proposal.committedRevision,
        confirmedAt: proposal.confirmedAt,
        confirmedBy: {
          actorId: proposal.confirmedBy.actorId,
          name: proposal.confirmedBy.name,
          role: proposal.confirmedBy.role,
        },
      })),
    auditEvents: context.events
      .filter(event => event.eventType === 'proposal.confirmed')
      .map(event => ({
        eventId: event.eventId,
        eventType: event.eventType,
        revision: event.revision,
        actor: {
          actorId: event.actor.actorId,
          name: event.actor.name,
          role: event.actor.role,
        },
        occurredAt: event.occurredAt,
        payload: event.payload,
      })),
    allowedActions: ['submit_proposal', 'request_clarification'],
  }
  if (dependencies === undefined) return base
  const governance = dependencies.governance.readProject(context.project.projectId)
  const workflow = dependencies.runtime.nextReady(context.project.projectId)
  const snapshot = dependencies.runtime.snapshot(context.project.projectId)
  const stateByObject = new Map(context.stateObjects.map(record => [record.objectId, record]))
  return {
    ...base,
    mode: governance.policy?.mode ?? 'manual',
    authorization: governance.authorizations.find(row => row.status === 'active') ?? null,
    nextWorkflow: workflow ?? null,
    targetSchema: workflow === undefined ? null : dependencies.registry.stateSchema(workflow.targetObjectId),
    upstreamSnapshot: workflow === undefined
      ? []
      : workflow.requiredUpstream.map(objectId => objectId === 'ProjectSeed'
        ? { objectId, status: 'available' }
        : {
          objectId,
          status: stateByObject.has(objectId) ? 'available' : 'missing',
          revision: stateByObject.get(objectId)?.revision ?? null,
        }),
    blockers: snapshot.blocked,
    chapters: snapshot.chapters,
    gateDecisions: governance.gateDecisions,
    visualSummary: {
      tasks: governance.visualTasks.length,
      candidates: governance.visualAssets.filter(row => row.status === 'candidate').length,
      adopted: governance.visualAssets.filter(row => row.status === 'adopted').length,
      blocked: governance.visualTasks.filter(row => row.status === 'blocked').length,
    },
    reportSummary: {
      packages: governance.reportPackages.length,
      latest: governance.reportPackages.at(-1) ?? null,
    },
  }
}
