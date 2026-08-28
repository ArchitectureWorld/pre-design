import type { Domain, DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { z, type JSONType } from 'zod'
import { preplanningDomainSpec } from './domain.ts'
import type {
  AuditEventRecord,
  CommitStoredProposalInput,
  ConfirmProposalInput,
  ConfirmProposalResult,
  CreateProjectInput,
  DynamicQuestionRecord,
  IdempotencyRecord,
  ProjectContext,
  ProjectRevisionSnapshot,
  ProjectRecord,
  ProposalRecord,
  RevisionRecord,
  SaveProposalInput,
  SessionBindingRecord,
  StateObjectRecord,
} from './types.ts'

export class RepositoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RepositoryError'
  }
}

type PreplanningDomain = Domain<typeof preplanningDomainSpec>
interface ProjectTableRecords {
  state_objects: StateObjectRecord
  revisions: RevisionRecord
  events: AuditEventRecord
  proposals: ProposalRecord
  questions: DynamicQuestionRecord
}

const revisionKey = (projectId: string, revision: number): string => `${projectId}:${revision}`
const stateObjectKey = (projectId: string, objectId: string): string => `${projectId}:${objectId}`
const idempotencyKey = (projectId: string, key: string): string => `${projectId}:${key}`

export class ProjectRepository {
  private chain: Promise<void> = Promise.resolve()

  private constructor(private readonly domain: PreplanningDomain) {}

  static async open(facility: DomainFacility): Promise<ProjectRepository> {
    return new ProjectRepository(await facility.open(preplanningDomainSpec))
  }

  close(): Promise<void> {
    return this.domain.close()
  }

  createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    return this.serialize(async () => {
      const projects = this.domain.table('projects')
      if (projects.get(input.projectId) !== undefined) {
        throw new RepositoryError('project-exists', `project '${input.projectId}' already exists`)
      }
      if ([...projects.entries()].some(([, project]) => project.name === input.name)) {
        throw new RepositoryError('project-name-exists', `project name '${input.name}' already exists`)
      }
      if (this.domain.table('bindings').get(input.sessionId) !== undefined) {
        throw new RepositoryError('session-already-bound', `session '${input.sessionId}' is already bound`)
      }

      const project: ProjectRecord = {
        projectId: input.projectId,
        name: input.name,
        currentRevision: 0,
        currentStage: '01-01',
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      }
      const revision: RevisionRecord = {
        revisionId: revisionKey(input.projectId, 0),
        projectId: input.projectId,
        revision: 0,
        parentRevision: null,
        committedAt: input.createdAt,
        committedBy: input.actor,
        stateSnapshot: {},
      }
      const binding: SessionBindingRecord = {
        sessionId: input.sessionId,
        projectId: input.projectId,
        boundAt: input.createdAt,
      }
      const question = {
        questionId: `${input.projectId}:question:project_identity`,
        projectId: input.projectId,
        prompt: '请确认项目的规范名称、所在地、对象类型和启动原因。',
        priority: 100,
        status: 'open' as const,
        createdAt: input.createdAt,
      }
      const event: AuditEventRecord = {
        eventId: `${input.projectId}:created`,
        projectId: input.projectId,
        eventType: 'project.created',
        revision: 0,
        actor: input.actor,
        occurredAt: input.createdAt,
        payload: { name: input.name, sessionId: input.sessionId },
      }

      await projects.put(input.projectId, project)
      await this.domain.table('revisions').put(revision.revisionId, revision)
      await this.domain.table('bindings').put(binding.sessionId, binding)
      await this.domain.table('questions').put(question.questionId, question)
      await this.domain.table('events').put(event.eventId, event)
      return project
    })
  }

  bindSession(sessionId: string, projectId: string, boundAt: string): Promise<SessionBindingRecord> {
    return this.serialize(async () => {
      this.requireProject(projectId)
      const binding = { sessionId, projectId, boundAt }
      await this.domain.table('bindings').put(sessionId, binding)
      return binding
    })
  }

  putQuestion(question: DynamicQuestionRecord): Promise<DynamicQuestionRecord> {
    return this.serialize(async () => {
      this.requireProject(question.projectId)
      const stored = {
        ...question,
        evidenceIds: [...(question.evidenceIds ?? [])],
      }
      await this.domain.table('questions').put(question.questionId, stored)
      return question
    })
  }

  listQuestions(projectId: string): readonly DynamicQuestionRecord[] {
    this.requireProject(projectId)
    return this.forProject('questions', projectId)
      .sort((left, right) => right.priority - left.priority || left.questionId.localeCompare(right.questionId))
  }

  saveProposal(input: SaveProposalInput): Promise<ProposalRecord> {
    return this.serialize(async () => {
      const project = this.requireProject(input.projectId)
      if (project.currentRevision !== input.expectedRevision) {
        throw this.revisionConflict(input.expectedRevision, project.currentRevision)
      }
      const proposals = this.domain.table('proposals')
      if (proposals.get(input.proposalId) !== undefined) {
        throw new RepositoryError('proposal-exists', `proposal '${input.proposalId}' already exists`)
      }
      const storedIdempotency = this.domain.table('idempotency').get(
        idempotencyKey(input.projectId, input.idempotencyKey),
      )
      if (storedIdempotency !== undefined) {
        throw new RepositoryError(
          'idempotency-conflict',
          `idempotency key '${input.idempotencyKey}' was already used by proposal '${storedIdempotency.proposalId}'`,
        )
      }
      const proposal: ProposalRecord = {
        ...input,
        envelope: z.json().parse(input.envelope),
        status: 'pending_review',
      }
      await proposals.put(proposal.proposalId, proposal)
      return proposal
    })
  }

  confirmProposal(input: ConfirmProposalInput): Promise<ConfirmProposalResult> {
    return this.commitProposal({
      proposalId: input.proposalId,
      actor: input.actor,
      committedAt: input.confirmedAt,
      eventId: input.eventId,
      eventType: 'proposal.confirmed',
      status: 'confirmed',
      resolveOpenQuestions: true,
      stateObject: input.stateObject,
    })
  }

  commitProposal(input: CommitStoredProposalInput): Promise<ConfirmProposalResult> {
    return this.serialize(async () => {
      const proposals = this.domain.table('proposals')
      const proposal = proposals.get(input.proposalId)
      if (proposal === undefined) {
        throw new RepositoryError('proposal-not-found', `proposal '${input.proposalId}' does not exist`)
      }
      const project = this.requireProject(proposal.projectId)
      const replay = this.domain.table('idempotency').get(
        idempotencyKey(proposal.projectId, proposal.idempotencyKey),
      )
      if (replay !== undefined) {
        if (replay.proposalId !== proposal.proposalId) {
          throw new RepositoryError(
            'idempotency-conflict',
            `idempotency key '${proposal.idempotencyKey}' belongs to proposal '${replay.proposalId}'`,
          )
        }
        return {
          projectId: replay.projectId,
          proposalId: replay.proposalId,
          revision: replay.revision,
          replayed: true,
        }
      }
      if (proposal.status !== 'pending_review') {
        throw new RepositoryError('proposal-not-pending', `proposal '${proposal.proposalId}' is not pending review`)
      }
      if (project.currentRevision !== proposal.expectedRevision) {
        throw this.revisionConflict(proposal.expectedRevision, project.currentRevision)
      }
      const events = this.domain.table('events')
      if (events.get(input.eventId) !== undefined) {
        throw new RepositoryError('audit-event-exists', `audit event '${input.eventId}' already exists`)
      }

      const nextRevision = project.currentRevision + 1
      const revisions = this.domain.table('revisions')
      const nextRevisionKey = revisionKey(project.projectId, nextRevision)
      if (revisions.get(nextRevisionKey) !== undefined) {
        throw new RepositoryError('revision-exists', `revision ${nextRevision} already exists`)
      }
      const snapshot = this.currentStateSnapshot(project)
      const stateObjectValue = z.json().parse(input.stateObject.value)
      snapshot[input.stateObject.objectId] = stateObjectValue
      const stateObject: StateObjectRecord = {
        projectId: project.projectId,
        objectId: input.stateObject.objectId,
        revision: nextRevision,
        value: stateObjectValue,
        updatedAt: input.committedAt,
      }
      const revision: RevisionRecord = {
        revisionId: nextRevisionKey,
        projectId: project.projectId,
        revision: nextRevision,
        parentRevision: project.currentRevision,
        committedAt: input.committedAt,
        committedBy: input.actor,
        stateSnapshot: snapshot,
      }
      const event: AuditEventRecord = {
        eventId: input.eventId,
        projectId: project.projectId,
        eventType: input.eventType,
        revision: nextRevision,
        actor: input.actor,
        occurredAt: input.committedAt,
        payload: { proposalId: proposal.proposalId, objectId: input.stateObject.objectId },
      }
      const confirmedProposal: ProposalRecord = {
        ...proposal,
        status: input.status,
        committedAt: input.committedAt,
        committedBy: input.actor,
        committedRevision: nextRevision,
        ...(input.status === 'confirmed'
          ? { confirmedAt: input.committedAt, confirmedBy: input.actor }
          : {}),
      }
      const updatedProject: ProjectRecord = {
        ...project,
        currentRevision: nextRevision,
        updatedAt: input.committedAt,
      }
      const idempotency: IdempotencyRecord = {
        projectId: project.projectId,
        idempotencyKey: proposal.idempotencyKey,
        proposalId: proposal.proposalId,
        eventId: input.eventId,
        revision: nextRevision,
        createdAt: input.committedAt,
      }

      await this.domain.table('state_objects').put(
        stateObjectKey(project.projectId, stateObject.objectId),
        stateObject,
      )
      await revisions.put(revision.revisionId, revision)
      await events.put(event.eventId, event)
      if (input.resolveOpenQuestions) {
        await this.resolveOpenQuestions(project.projectId, nextRevision, input.committedAt)
      }
      await proposals.put(proposal.proposalId, confirmedProposal)
      await this.domain.table('projects').put(project.projectId, updatedProject)
      await this.domain.table('idempotency').put(
        idempotencyKey(project.projectId, proposal.idempotencyKey),
        idempotency,
      )

      return {
        projectId: project.projectId,
        proposalId: proposal.proposalId,
        revision: nextRevision,
        replayed: false,
      }
    })
  }

  listProjects(): readonly ProjectRecord[] {
    return [...this.domain.table('projects').entries()]
      .map(([, project]) => project)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.projectId.localeCompare(right.projectId))
  }

  readProjectRevision(projectId: string, revision: number): ProjectRevisionSnapshot {
    const project = this.requireProject(projectId)
    const record = this.domain.table('revisions').get(revisionKey(projectId, revision))
    if (record === undefined) {
      throw new RepositoryError('revision-not-found', `revision ${revision} does not exist for project '${projectId}'`)
    }
    return {
      project: { ...project },
      revision: { ...record, stateSnapshot: structuredClone(record.stateSnapshot) },
      stateSnapshot: structuredClone(record.stateSnapshot),
    }
  }

  readContext(sessionId: string): ProjectContext {
    const binding = this.domain.table('bindings').get(sessionId)
    if (binding === undefined) {
      throw new RepositoryError('session-not-bound', `session '${sessionId}' is not bound to a project`)
    }
    const project = this.requireProject(binding.projectId)
    return {
      project,
      binding,
      stateObjects: this.forProject('state_objects', project.projectId)
        .filter(record => record.revision <= project.currentRevision)
        .sort((left, right) => left.objectId.localeCompare(right.objectId)),
      revisions: this.forProject('revisions', project.projectId)
        .filter(record => record.revision <= project.currentRevision)
        .sort((left, right) => left.revision - right.revision),
      events: this.forProject('events', project.projectId)
        .filter(record => record.revision <= project.currentRevision)
        .sort((left, right) => left.revision - right.revision || left.eventId.localeCompare(right.eventId)),
      proposals: this.forProject('proposals', project.projectId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      questions: this.forProject('questions', project.projectId)
        .sort((left, right) => right.priority - left.priority || left.questionId.localeCompare(right.questionId)),
    }
  }

  private forProject<N extends keyof ProjectTableRecords>(
    tableName: N,
    projectId: string,
  ): ProjectTableRecords[N][] {
    const values = [...this.domain.table(tableName).entries()]
      .map(([, record]) => record) as ProjectTableRecords[N][]
    return values.filter(record => record.projectId === projectId)
  }

  private currentStateSnapshot(project: ProjectRecord): Record<string, JSONType> {
    const snapshot: Record<string, JSONType> = {}
    for (const [, record] of this.domain.table('state_objects').entries()) {
      if (record.projectId === project.projectId && record.revision <= project.currentRevision) {
        snapshot[record.objectId] = record.value
      }
    }
    return snapshot
  }

  private requireProject(projectId: string): ProjectRecord {
    const project = this.domain.table('projects').get(projectId)
    if (project === undefined) {
      throw new RepositoryError('project-not-found', `project '${projectId}' does not exist`)
    }
    return project
  }

  private revisionConflict(expected: number, current: number): RepositoryError {
    return new RepositoryError(
      'revision-conflict',
      `expected revision ${expected}, current revision is ${current}`,
    )
  }

  private async resolveOpenQuestions(projectId: string, revision: number, resolvedAt: string): Promise<void> {
    const questions = this.domain.table('questions')
    for (const [key, question] of questions.entries()) {
      if (question.projectId === projectId && question.status === 'open') {
        await questions.put(key, {
          ...question,
          status: 'resolved',
          resolvedAt,
          resolvedRevision: revision,
        })
      }
    }
  }

  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const result = this.chain.then(job)
    this.chain = result.then(() => undefined, () => undefined)
    return result
  }
}
