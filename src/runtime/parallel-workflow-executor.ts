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
import {
  evaluateWorkflowQuality,
  type WorkflowQualityEvidence,
  type WorkflowQualityReport,
} from './workflow-quality.ts'

export interface ParallelWorkflowBatchResult {
  readonly attempted: number
  readonly completed: number
  readonly blocked: number
  readonly needsHuman: number
  readonly revised: number
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
  readonly maxQualityAttempts?: number
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

function legacyQualityEvidence(descriptor: WorkflowDescriptor): WorkflowQualityEvidence | undefined {
  // Compatibility is intentionally limited to descriptors that predate WorkflowSpec V2.
  // Registry-backed v2 descriptors always carry these arrays and must fail closed if the analyzer omits quality evidence.
  if (descriptor.completionCriteria !== undefined || descriptor.evidencePolicy !== undefined) return undefined
  return {
    completionChecks: [],
    evidenceChecks: [],
    assumptions: [],
    blockers: [],
    confidence: 1,
  }
}

function externalBlockerReason(report: WorkflowQualityReport): string {
  const messages = report.blockers
    .filter(blocker => blocker.kind === 'external')
    .map(blocker => blocker.message.trim())
    .filter(Boolean)
  return messages.length > 0 ? messages.join('；') : report.reasons.join('；') || '存在外部阻断'
}

interface AnalyzedWorkflow {
  readonly candidate?: WorkflowAnalysisCandidate
  readonly quality?: WorkflowQualityReport
  readonly error?: unknown
  readonly revised: number
}

export class ParallelWorkflowExecutor {
  private readonly maxConcurrency: number
  private readonly maxQualityAttempts: number

  constructor(private readonly dependencies: ParallelWorkflowExecutorDependencies) {
    const requested = dependencies.maxConcurrency ?? 4
    this.maxConcurrency = Math.max(1, Math.min(4, Math.trunc(requested)))
    this.maxQualityAttempts = Math.max(1, Math.min(5, Math.trunc(dependencies.maxQualityAttempts ?? 3)))
  }

  canRun(projectId: string): boolean {
    return this.dependencies.enabled(projectId)
      && this.dependencies.analyzer.available()
      && this.dependencies.runtime.running(projectId).length === 0
      && this.dependencies.runtime.ready(projectId).length >= 2
  }

  private async evaluateCandidate(
    agent: Agent,
    projectId: string,
    descriptor: WorkflowDescriptor,
    initial: PromiseSettledResult<WorkflowAnalysisCandidate>,
  ): Promise<AnalyzedWorkflow> {
    if (initial.status === 'rejected') return { error: initial.reason, revised: 0 }
    let candidate = initial.value
    let revised = 0
    let previousQuality: WorkflowQualityReport | undefined

    for (let attempt = 1; attempt <= this.maxQualityAttempts; attempt += 1) {
      const evidence = candidate.qualityEvidence ?? legacyQualityEvidence(descriptor)
      if (evidence === undefined) {
        return { error: new Error(`workflow '${descriptor.workflowId}' returned no quality evidence`), revised }
      }
      const quality = evaluateWorkflowQuality(descriptor, evidence, {
        attempt,
        maxAttempts: this.maxQualityAttempts,
      })
      if (quality.disposition !== 'auto_revise') return { candidate, quality, revised }
      if (attempt >= this.maxQualityAttempts) return { candidate, quality, revised }
      revised += 1
      previousQuality = quality
      try {
        candidate = await this.dependencies.analyzer.analyze(
          agent,
          projectId,
          descriptor,
          undefined,
          previousQuality,
        )
      } catch (error) {
        return { error, revised }
      }
    }
    return { candidate, quality: previousQuality, revised }
  }

  async runReadyBatch(
    parent: unknown,
    projectId: string,
  ): Promise<ParallelWorkflowBatchResult> {
    if (!this.canRun(projectId)) {
      return { attempted: 0, completed: 0, blocked: 0, needsHuman: 0, revised: 0, approvedGates: 0 }
    }
    const agent = parent as Agent
    const selected = this.dependencies.runtime.ready(projectId)
      .slice(0, this.maxConcurrency)
    for (const descriptor of selected) {
      await this.dependencies.runtime.transition(projectId, descriptor.workflowId, { to: 'running' })
    }

    // Preserve the original parallel first-pass behavior. Revisions are local to the failing workflow.
    const initialAnalyses = await Promise.allSettled(selected.map(descriptor =>
      this.dependencies.analyzer.analyze(agent, projectId, descriptor)))
    const evaluated = await Promise.all(selected.map((descriptor, index) =>
      this.evaluateCandidate(
        agent,
        projectId,
        descriptor,
        initialAnalyses[index] as PromiseSettledResult<WorkflowAnalysisCandidate>,
      )))

    const workspaceRoot = workspaceRootOf(parent)
    let completed = 0
    let blocked = 0
    let needsHuman = 0
    let revised = 0

    for (let index = 0; index < selected.length; index += 1) {
      const descriptor = selected[index] as WorkflowDescriptor
      const result = evaluated[index] as AnalyzedWorkflow
      revised += result.revised

      if (result.error !== undefined || result.candidate === undefined || result.quality === undefined) {
        await this.dependencies.runtime.transition(projectId, descriptor.workflowId, {
          to: 'blocked',
          reason: failureReason(result.error ?? 'workflow analysis incomplete'),
        })
        blocked += 1
        continue
      }

      if (result.quality.disposition === 'blocked_external') {
        await this.dependencies.runtime.transition(projectId, descriptor.workflowId, {
          to: 'blocked',
          reason: externalBlockerReason(result.quality),
          quality: result.quality,
        })
        blocked += 1
        continue
      }

      if (result.quality.disposition === 'needs_human') {
        await this.dependencies.runtime.transition(projectId, descriptor.workflowId, {
          to: 'pending_review',
          quality: result.quality,
        })
        needsHuman += 1
        continue
      }

      if (result.quality.disposition !== 'auto_pass') {
        await this.dependencies.runtime.transition(projectId, descriptor.workflowId, {
          to: 'pending_review',
          quality: result.quality,
        })
        needsHuman += 1
        continue
      }

      try {
        const committed = await this.dependencies.committer.commit(
          agent,
          projectId,
          descriptor,
          result.candidate,
          result.quality,
        )
        await this.dependencies.runtime.transition(projectId, descriptor.workflowId, {
          to: 'confirmed',
          proposalId: committed.proposalId,
          revision: committed.revision,
          quality: result.quality,
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
          quality: result.quality,
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
      needsHuman,
      revised,
      approvedGates,
    }
  }
}
