import type { JSONType } from 'zod'

export interface ActorRef {
  readonly actorId: string
  readonly name: string
  readonly role: string
}

export interface ProjectRecord {
  readonly projectId: string
  readonly name: string
  readonly currentRevision: number
  readonly currentStage: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface StateObjectRecord {
  readonly projectId: string
  readonly objectId: string
  readonly revision: number
  readonly value: JSONType
  readonly updatedAt: string
}

export interface RevisionRecord {
  readonly revisionId: string
  readonly projectId: string
  readonly revision: number
  readonly parentRevision: number | null
  readonly committedAt: string
  readonly committedBy: ActorRef
  readonly stateSnapshot: Readonly<Record<string, JSONType>>
}

export interface AuditEventRecord {
  readonly eventId: string
  readonly projectId: string
  readonly eventType: string
  readonly revision: number
  readonly actor: ActorRef
  readonly occurredAt: string
  readonly payload: JSONType
}

export interface SessionBindingRecord {
  readonly sessionId: string
  readonly projectId: string
  readonly boundAt: string
}

export type ProposalStatus =
  | 'pending_review'
  | 'provisionally_committed'
  | 'confirmed'
  | 'returned'
  | 'validation_failed'
  | 'rejected'

export interface ProposalRecord {
  readonly proposalId: string
  readonly projectId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly envelope: JSONType
  readonly status: ProposalStatus
  readonly createdAt: string
  readonly committedAt?: string
  readonly committedBy?: ActorRef
  readonly confirmedAt?: string
  readonly confirmedBy?: ActorRef
  readonly committedRevision?: number
}

export interface DynamicQuestionRecord {
  readonly questionId: string
  readonly projectId: string
  readonly prompt: string
  readonly priority: number
  readonly workflowId?: string
  readonly owner?: string
  readonly dueAt?: string
  readonly blockingLevel?: 'none' | 'soft' | 'hard'
  readonly evidenceIds?: readonly string[]
  readonly status: 'open' | 'resolved'
  readonly createdAt: string
  readonly resolvedAt?: string
  readonly resolvedRevision?: number
}

export interface ConfirmProposalResult {
  readonly projectId: string
  readonly proposalId: string
  readonly revision: number
  readonly replayed: boolean
}

export interface IdempotencyRecord {
  readonly projectId: string
  readonly idempotencyKey: string
  readonly proposalId: string
  readonly eventId: string
  readonly revision: number
  readonly createdAt: string
}

export interface ProjectContext {
  readonly project: ProjectRecord
  readonly binding: SessionBindingRecord
  readonly stateObjects: readonly StateObjectRecord[]
  readonly revisions: readonly RevisionRecord[]
  readonly events: readonly AuditEventRecord[]
  readonly proposals: readonly ProposalRecord[]
  readonly questions: readonly DynamicQuestionRecord[]
}

export interface ProjectRevisionSnapshot {
  readonly project: ProjectRecord
  readonly revision: RevisionRecord
  readonly stateSnapshot: Readonly<Record<string, JSONType>>
}

export interface CreateProjectInput {
  readonly projectId: string
  readonly name: string
  readonly sessionId: string
  readonly createdAt: string
  readonly actor: ActorRef
}

export interface SaveProposalInput {
  readonly proposalId: string
  readonly projectId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly envelope: unknown
  readonly createdAt: string
}

export interface ConfirmProposalInput {
  readonly proposalId: string
  readonly actor: ActorRef
  readonly confirmedAt: string
  readonly eventId: string
  readonly stateObject: {
    readonly objectId: string
    readonly value: unknown
  }
}

export interface CommitStoredProposalInput {
  readonly proposalId: string
  readonly actor: ActorRef
  readonly committedAt: string
  readonly eventId: string
  readonly eventType: 'proposal.provisionally_committed' | 'proposal.confirmed'
  readonly status: 'provisionally_committed' | 'confirmed'
  readonly resolveOpenQuestions: boolean
  readonly stateObject: {
    readonly objectId: string
    readonly value: unknown
  }
}
