import type { ContractRegistry } from '../contracts/registry.ts'
import type { WorkflowDescriptor } from '../contracts/types.ts'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { WorkflowRunRecord, WorkflowRunStatus, WorkflowRevisionFeedback, WorkflowRevisionRecord } from '../governance/types.ts'
import type { ChapterWorkflowSummary, WorkflowSnapshot, WorkflowTransitionCommand } from './types.ts'

const ALLOWED: Readonly<Record<WorkflowRunStatus, readonly WorkflowRunStatus[]>> = {
  not_started: ['ready'],
  ready: ['running', 'blocked', 'not_applicable'],
  running: ['blocked', 'pending_review', 'confirmed'],
  blocked: ['ready'],
  pending_review: ['confirmed', 'ready', 'superseded'],
  confirmed: ['superseded'],
  not_applicable: ['superseded'],
  superseded: ['ready'],
}

export class WorkflowRuntime {
  private readonly revising = new Set<string>()
  private readonly transitionWrites = new Map<string, number>()
  constructor(
    private readonly registry: ContractRegistry,
    private readonly governance: GovernanceRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async initializeProject(projectId: string): Promise<void> {
    const existing = new Set(this.governance.readProject(projectId).workflowRuns.map(run => run.workflowId))
    for (const descriptor of this.registry.workflows()) {
      if (existing.has(descriptor.workflowId)) continue
      await this.governance.putWorkflowRun({
        runId: `${projectId}:${descriptor.workflowId}`,
        projectId,
        workflowId: descriptor.workflowId,
        chapterId: descriptor.chapterId,
        workItemId: descriptor.workItemId,
        targetObjectId: descriptor.targetObjectId,
        status: descriptor.requiredUpstream.every(objectId => objectId === 'ProjectSeed')
          ? 'ready'
          : 'not_started',
        attempt: 0,
        updatedAt: this.now(),
      })
    }
    // A durable pending request fences dispatch across a process interruption.
    const pending = this.pendingRevisions(projectId)
    if (pending.length > 0) {
      if (this.revising.has(projectId) || (this.transitionWrites.get(projectId) ?? 0) > 0) throw new Error('workflow revision recovery is already active')
      this.revising.add(projectId)
      try {
        for (const request of pending) await this.applyRevision(request)
      } finally { this.revising.delete(projectId) }
    }
    await this.unlockReady(projectId)
  }

  snapshot(projectId: string): WorkflowSnapshot {
    const pendingIds = new Set(this.pendingRevisions(projectId).flatMap(row => row.affectedObjectIds))
    const runs = this.governance.readProject(projectId).workflowRuns.map(run =>
      pendingIds.has(run.targetObjectId) ? { ...run, status: 'superseded' as const } : run)
    const chapters = this.registry.gates().map(gate => this.chapterSummary(gate.chapterId, runs))
    return {
      projectId,
      runs,
      chapters,
      blocked: runs.filter(run => run.status === 'blocked'),
    }
  }

  ready(projectId: string): readonly WorkflowDescriptor[] {
    if (this.revising.has(projectId) || this.pendingRevisions(projectId).length > 0) return []
    const readyIds = new Set(this.governance.readProject(projectId).workflowRuns
      .filter(run => run.status === 'ready')
      .map(run => run.workflowId))
    return Object.freeze(this.registry.workflows()
      .filter(descriptor => readyIds.has(descriptor.workflowId)))
  }

  running(projectId: string): readonly WorkflowDescriptor[] {
    const runningIds = new Set(this.governance.readProject(projectId).workflowRuns
      .filter(run => run.status === 'running')
      .map(run => run.workflowId))
    return Object.freeze(this.registry.workflows()
      .filter(descriptor => runningIds.has(descriptor.workflowId)))
  }

  nextReady(projectId: string): WorkflowDescriptor | undefined {
    return this.ready(projectId)[0]
  }

  current(projectId: string): WorkflowDescriptor | undefined {
    return this.running(projectId)[0]
  }

  isComplete(projectId: string): boolean {
    if (this.pendingRevisions(projectId).length > 0) return false
    const runs = this.snapshot(projectId).runs
    const expected = this.registry.workflows()
    const byId = new Map(runs.map(run => [run.workflowId, run]))
    return expected.length > 0 && runs.length === expected.length && byId.size === runs.length
      && expected.every(descriptor => {
        const run = byId.get(descriptor.workflowId)
        return run?.status === 'confirmed' || run?.status === 'not_applicable'
      })
  }

  async retryBlocked(projectId: string): Promise<void> {
    const runs = this.governance.readProject(projectId).workflowRuns
    const resolved = new Set(runs.filter(run => run.status === 'confirmed' || run.status === 'not_applicable').map(run => run.targetObjectId))
    for (const run of runs) {
      if (run.status !== 'blocked') continue
      const workflow = this.registry.workflow(run.workflowId)
      if (!workflow.requiredUpstream.every(id => id === 'ProjectSeed' || resolved.has(id))) continue
      // Re-enter the normal research, analysis, quality and commit path. Never approve here.
      await this.transition(projectId, run.workflowId, { to: 'ready' })
    }
  }

  async transition(
    projectId: string,
    workflowId: string,
    command: WorkflowTransitionCommand,
  ): Promise<WorkflowRunRecord> {
    this.transitionWrites.set(projectId, (this.transitionWrites.get(projectId) ?? 0) + 1)
    try {
      return await this.performTransition(projectId, workflowId, command)
    } finally {
      const remaining = (this.transitionWrites.get(projectId) ?? 1) - 1
      if (remaining === 0) this.transitionWrites.delete(projectId)
      else this.transitionWrites.set(projectId, remaining)
    }
  }

  private async performTransition(projectId: string, workflowId: string, command: WorkflowTransitionCommand): Promise<WorkflowRunRecord> {
    if (this.revising.has(projectId) || this.pendingRevisions(projectId).length > 0) {
      throw new Error('workflow revision is pending; resume invalidation before dispatch')
    }
    this.registry.workflow(workflowId)
    const current = this.governance.readProject(projectId).workflowRuns
      .find(run => run.workflowId === workflowId)
    if (current === undefined) {
      throw new Error(`workflow run '${workflowId}' is not initialized for project '${projectId}'`)
    }
    if (!ALLOWED[current.status].includes(command.to)) {
      throw new Error(`illegal workflow transition '${current.status}' -> '${command.to}'`)
    }
    if (command.to === 'blocked' && command.reason?.trim() === '') {
      throw new Error('blocked transition requires a reason')
    }
    if (command.to === 'blocked' && command.reason === undefined) {
      throw new Error('blocked transition requires a reason')
    }
    if (command.to === 'confirmed' && !Number.isInteger(command.revision)) {
      throw new Error('confirmed transition requires a revision')
    }
    if (command.quality !== undefined
      && (command.quality.workflowId !== workflowId || command.quality.targetObjectId !== current.targetObjectId)) {
      throw new Error('workflow quality identity does not match transition target')
    }

    const { blockedReason: _blockedReason, confirmedRevision: _confirmedRevision, ...base } = current
    const updated: WorkflowRunRecord = {
      ...base,
      status: command.to,
      attempt: current.attempt + (command.to === 'running' ? 1 : 0),
      updatedAt: this.now(),
      ...(command.proposalId === undefined ? {} : { proposalId: command.proposalId }),
      ...(command.quality === undefined ? {} : { quality: structuredClone(command.quality) }),
      ...(command.to === 'blocked' ? { blockedReason: command.reason } : {}),
      ...(command.to === 'confirmed' ? { confirmedRevision: command.revision } : {}),
    }
    await this.governance.putWorkflowRun(updated)
    await this.unlockReady(projectId)
    return updated
  }

  async supersedeByObject(projectId: string, objectId: string): Promise<WorkflowRunRecord | undefined> {
    const run = this.governance.readProject(projectId).workflowRuns.find(row => row.targetObjectId === objectId)
    if (run === undefined) throw new Error(`workflow run for object '${objectId}' is not initialized`)
    if (run.status === 'superseded') return run
    if (run.status !== 'confirmed' && run.status !== 'not_applicable' && run.status !== 'pending_review') {
      return undefined
    }
    return this.transition(projectId, run.workflowId, { to: 'superseded' })
  }

  async reopenObjects(
    projectId: string,
    objectIds: readonly string[],
    feedback: Omit<WorkflowRevisionFeedback, 'createdAt'>,
  ): Promise<void> {
    if ((this.transitionWrites.get(projectId) ?? 0) > 0) throw new Error('cannot revise while workflow writes are active')
    if (this.revising.has(projectId) || this.pendingRevisions(projectId).length > 0) {
      throw new Error('workflow revision is pending; initialize project to recover it first')
    }
    const context = this.governance.readProject(projectId)
    if (context.workflowRevisions?.some(row => row.requestId === feedback.requestId)) {
      throw new Error('revision request id already exists')
    }
    if (context.workflowRuns.some(run => run.status === 'running')) throw new Error('cannot revise while workflows are running')
    for (const objectId of objectIds) {
      if (!context.workflowRuns.some(run => run.targetObjectId === objectId)) throw new Error(`workflow run for object '${objectId}' is not initialized`)
    }
    this.revising.add(projectId)
    try {
      const request: WorkflowRevisionRecord = { ...feedback, projectId, affectedObjectIds: [...objectIds], createdAt: this.now(), status: 'pending' }
      await this.governance.putWorkflowRevision(request)
      await this.applyRevision(request)
    } finally {
      this.revising.delete(projectId)
    }
    await this.unlockReady(projectId)
  }

  private pendingRevisions(projectId: string): readonly WorkflowRevisionRecord[] {
    return (this.governance.readProject(projectId).workflowRevisions ?? []).filter(row => row.status === 'pending')
  }

  private async applyRevision(request: WorkflowRevisionRecord): Promise<void> {
    const { projectId, affectedObjectIds, status: _status, ...feedback } = request
    const affected = new Set(affectedObjectIds)
    const runs = this.governance.readProject(projectId).workflowRuns
    if (runs.some(run => run.status === 'running')) throw new Error('cannot revise while workflows are running')
    for (const run of runs) {
      if (!affected.has(run.targetObjectId)) continue
      const { quality: _quality, proposalId: _proposalId, confirmedRevision: _revision, blockedReason: _reason, ...base } = run
      await this.governance.putWorkflowRun({ ...base, status: 'superseded', revisionRequest: feedback, updatedAt: this.now() })
    }
    await this.governance.putWorkflowRevision({ ...request, status: 'applied' })
  }

  private chapterSummary(chapterId: string, runs: readonly WorkflowRunRecord[]): ChapterWorkflowSummary {
    const chapterRuns = runs.filter(run => run.chapterId === chapterId)
    return {
      chapterId,
      total: chapterRuns.length,
      completed: chapterRuns.filter(run => run.status === 'confirmed' || run.status === 'not_applicable').length,
      ready: chapterRuns.filter(run => run.status === 'ready').length,
      running: chapterRuns.filter(run => run.status === 'running').length,
      blocked: chapterRuns.filter(run => run.status === 'blocked').length,
      pendingReview: chapterRuns.filter(run => run.status === 'pending_review').length,
    }
  }

  private async unlockReady(projectId: string): Promise<void> {
    if (this.revising.has(projectId) || this.pendingRevisions(projectId).length > 0) return
    const runs = this.governance.readProject(projectId).workflowRuns
    const resolvedObjects = new Set(runs
      .filter(run => run.status === 'confirmed' || run.status === 'not_applicable')
      .map(run => run.targetObjectId))
    const runByWorkflow = new Map(runs.map(run => [run.workflowId, run]))
    for (const descriptor of this.registry.workflows()) {
      const run = runByWorkflow.get(descriptor.workflowId)
      if (run?.status !== 'not_started' && !(run?.status === 'superseded' && run.revisionRequest !== undefined)) continue
      const ready = descriptor.requiredUpstream.every(objectId =>
        objectId === 'ProjectSeed' || resolvedObjects.has(objectId))
      if (!ready) continue
      await this.governance.putWorkflowRun({ ...run, status: 'ready', updatedAt: this.now() })
    }
  }
}
