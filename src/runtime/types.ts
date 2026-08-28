import type { WorkflowRunRecord, WorkflowRunStatus } from '../governance/types.ts'

export interface ChapterWorkflowSummary {
  readonly chapterId: string
  readonly total: number
  readonly completed: number
  readonly ready: number
  readonly running: number
  readonly blocked: number
  readonly pendingReview: number
}

export interface WorkflowSnapshot {
  readonly projectId: string
  readonly runs: readonly WorkflowRunRecord[]
  readonly chapters: readonly ChapterWorkflowSummary[]
  readonly blocked: readonly WorkflowRunRecord[]
}

export interface WorkflowTransitionCommand {
  readonly to: WorkflowRunStatus
  readonly revision?: number
  readonly reason?: string
  readonly proposalId?: string
}
