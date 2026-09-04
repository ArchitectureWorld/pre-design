import type { Agent } from '@deepseek-ai/dsh-agent'
import type { WorkflowDescriptor } from '../contracts/types.ts'
import type { PresentationAutoSyncService } from '../presentation/auto-sync.ts'
import type { WorkflowRuntime } from './workflow-runtime.ts'
import type { AutomationWorkflowCommitter } from './automation-workflow-committer.ts'
import type { AutomaticGateApprover } from './automatic-gate-approver.ts'
import type {
  DshSubagentWorkflowAnalyzer,
  WorkflowAnalysisCandidate,
} from './subagent-workflow-analyzer.ts'

export interface ParallelWorkflowBatchResult {
  readonly attempted: number
  readonly completed: number
  readonly blocked: number
  readonly approvedGates: number
}

interface ParallelWorkflowExecutorDependencies {
  readonly runtime: Pick<WorkflowRuntime, 'ready' | 'running' | 'transition' | 'snapshot'>
  readonly enabled: (projectId: string) => boolean
  readonly analyzer: Pick<DshSubagentWorkflowAnalyzer, 'available' | 'analyze'>
  readonly committer: Pick<AutomationWorkflowCommitter, 'commit'>
  readonly gateApprover: Pick<AutomaticGateApprover, 'approveReady'>
  readonly presentationSync: Pick<PresentationAutoSyncService, 'request' | 'flush'>
  readonly maxConcurrency?: number
}

function workspaceRootOf(parent: unknown): string | undefined {
  const candidate = parent as {
    readonly session?: { readonly header?: { readonly cwd?: unknown } }
  }
  const cwd = candidate.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd.trim() : undefined
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class ParallelWorkflowExecutor {
  private readonly maxConcurrency: number

  constructor(private readonly dependencies: ParallelWorkflowExecutorDependencies) {
    const requested = dependencies.maxConcurrency ?? 4
    this.maxConcurrency = Math.max(1, Math.min(4, Math.trunc(requested)))
  }

  canRun(projectId: string): boolean {
    return this.dependencies.enabled(projectId)
      && this.dependencies.analyzer.available()
      && this.dependencies.runtime.running(projectId).length === 0
      && this.dependencies.runtime.ready(projectId).length >= 2
  }

  async runReadyBatch(
    parent: unknown,
    projectId: string,
  ): Promise<ParallelWorkflowBatchResult> {
    if (!this.canRun(projectId)) {
      return { attempted: 0, completed: 0, blocked: 0, approvedGates: 0 }
    }
    const agent = parent as Agent
    const selected = this.dependencies.runtime.ready(projectId)
      .slice(0, this.maxConcurrency)
    for (const descriptor of selected) {
      await this.dependencies.runtime.transition(projectId, descriptor.workflowId, { to: 'running' })
    }

    const analyses = await Promise.allSettled(selected.map(descriptor =>
      this.dependencies.analyzer.analyze(agent, projectId, descriptor)))
    const workspaceRoot = workspaceRootOf(parent)
    let completed = 0
    let blocked = 0

    for (let index = 0; index < selected.length; index += 1) {
      const descriptor = selected[index] as WorkflowDescriptor
      const analysis = analyses[index] as PromiseSettledResult<WorkflowAnalysisCandidate>
      if (analysis.status === 'rejected') {
        await this.dependencies.runtime.transition(projectId, descriptor.workflowId, {
          to: 'blocked',
          reason: failureReason(analysis.reason),
        })
        blocked += 1
        continue
      }
      try {
        const committed = await this.dependencies.committer.commit(
          agent,
          projectId,
          descriptor,
          analysis.value,
        )
        await this.dependencies.runtime.transition(projectId, descriptor.workflowId, {
          to: 'confirmed',
          proposalId: committed.proposalId,
          revision: committed.revision,
        })
        this.dependencies.presentationSync.request(projectId, {
          ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
          reason: `workflow:${descriptor.workflowId}:revision:${committed.revision}`,
        })
        completed += 1
      } catch (error) {
        await this.dependencies.runtime.transition(projectId, descriptor.workflowId, {
          to: 'blocked',
          reason: failureReason(error),
        })
        blocked += 1
      }
    }

    const approvedGates = await this.dependencies.gateApprover.approveReady(projectId)
    await this.dependencies.presentationSync.flush(projectId, {
      ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
      reason: 'parallel-ready-wave',
    })
    return {
      attempted: selected.length,
      completed,
      blocked,
      approvedGates,
    }
  }
}
