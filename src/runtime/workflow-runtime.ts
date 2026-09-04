import type { ContractRegistry } from '../contracts/registry.ts'
import type { WorkflowDescriptor } from '../contracts/types.ts'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { WorkflowRunRecord, WorkflowRunStatus } from '../governance/types.ts'
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
  }

  snapshot(projectId: string): WorkflowSnapshot {
    const runs = this.governance.readProject(projectId).workflowRuns
    const chapters = this.registry.gates().map(gate => this.chapterSummary(gate.chapterId, runs))
    return {
      projectId,
      runs,
      chapters,
      blocked: runs.filter(run => run.status === 'blocked'),
    }
  }

  ready(projectId: string): readonly WorkflowDescriptor[] {
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

  async transition(
    projectId: string,
    workflowId: string,
    command: WorkflowTransitionCommand,
  ): Promise<WorkflowRunRecord> {
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

    const { blockedReason: _blockedReason, confirmedRevision: _confirmedRevision, ...base } = current
    const updated: WorkflowRunRecord = {
      ...base,
      status: command.to,
      attempt: current.attempt + (command.to === 'running' ? 1 : 0),
      updatedAt: this.now(),
      ...(command.proposalId === undefined ? {} : { proposalId: command.proposalId }),
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
    const runs = this.governance.readProject(projectId).workflowRuns
    const resolvedObjects = new Set(runs
      .filter(run => run.status === 'confirmed' || run.status === 'not_applicable')
      .map(run => run.targetObjectId))
    const runByWorkflow = new Map(runs.map(run => [run.workflowId, run]))
    for (const descriptor of this.registry.workflows()) {
      const run = runByWorkflow.get(descriptor.workflowId)
      if (run?.status !== 'not_started') continue
      const ready = descriptor.requiredUpstream.every(objectId =>
        objectId === 'ProjectSeed' || resolvedObjects.has(objectId))
      if (!ready) continue
      await this.governance.putWorkflowRun({ ...run, status: 'ready', updatedAt: this.now() })
    }
  }
}
