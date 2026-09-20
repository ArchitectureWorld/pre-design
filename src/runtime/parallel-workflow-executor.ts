import type { Agent } from '@deepseek-ai/dsh-agent'
import type { WorkflowDescriptor } from '../contracts/types.ts'
import type { PresentationAutoSyncService } from '../presentation/auto-sync.ts'
import type { ResearchExecutionResult } from '../research/execution-service.ts'
import { researchAllowsAnalysis } from '../research/execution-service.ts'
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

export interface ParallelWorkflowRunOptions {
  /** Refill from the current Ready Set as each result is committed. */
  readonly refill?: boolean
  /** Admission fence owned by the coordinator; never cancels admitted work. */
  readonly canDispatch?: () => boolean
}

interface WorkflowResearchCollector {
  collect(parent: unknown, workflowId: string, signal?: AbortSignal): Promise<ResearchExecutionResult>
}

interface ParallelWorkflowExecutorDependencies {
  readonly runtime: Pick<WorkflowRuntime, 'ready' | 'running' | 'transition' | 'snapshot'>
  readonly enabled: (projectId: string) => boolean
  readonly analyzer: Pick<DshSubagentWorkflowAnalyzer, 'available' | 'analyze'>
  /** Present in V2.0.1 production wiring; optional only for legacy/unit callers. */
  readonly research?: WorkflowResearchCollector
  readonly committer: Pick<AutomationWorkflowCommitter, 'commit'> & Partial<Pick<AutomationWorkflowCommitter, 'validateCandidate'>>
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
  if (descriptor.completionCriteria !== undefined || descriptor.evidencePolicy !== undefined) return undefined
  return {
    completionChecks: [],
    evidenceChecks: [],
    assumptions: [],
    blockers: [],
    confidence: 1,
  }
}

function qualityExceptionReason(report: WorkflowQualityReport): string {
  const messages = report.blockers.map(blocker => blocker.message.trim()).filter(Boolean)
  if (messages.length > 0) return messages.join('；')
  if (report.reasons.length > 0) return report.reasons.join('；')
  return `自动质量状态：${report.disposition}`
}

function researchBlockedQuality(
  descriptor: WorkflowDescriptor,
  research: ResearchExecutionResult,
  maxAttempts: number,
): WorkflowQualityReport {
  const missing = research.validation.missingDataPointIds ?? []
  const message = `Research evidence validation failed: ${research.validation.errors.join('；')}`
    + (missing.length === 0 ? '' : `；缺少可追溯数据项：${missing.join('、')}。可用 preplanning_read_material 读取原文并核对来源；材料目录和文件名不能替代字段证据。`)
  return Object.freeze({
    workflowId: descriptor.workflowId,
    targetObjectId: descriptor.targetObjectId,
    disposition: 'blocked_external',
    score: 0,
    completionCoverage: 0,
    evidenceCoverage: research.validation.coverage,
    confidence: 0,
    attempt: 1,
    maxAttempts,
    reasons: Object.freeze([message]),
    blockers: Object.freeze([{
      code: 'research-evidence-invalid',
      kind: 'external' as const,
      message,
    }]),
    assumptions: Object.freeze([]),
  })
}

interface AnalyzedWorkflow {
  readonly candidate?: WorkflowAnalysisCandidate
  readonly quality?: WorkflowQualityReport
  readonly error?: unknown
  readonly revised: number
}

export class ParallelWorkflowExecutor {
  private readonly activeProjects = new Map<string, Promise<ParallelWorkflowBatchResult>>()
  private readonly maxConcurrency: number
  private readonly maxQualityAttemptsOverride?: number

  constructor(private readonly dependencies: ParallelWorkflowExecutorDependencies) {
    const requested = dependencies.maxConcurrency ?? 5
    this.maxConcurrency = Number.isFinite(requested)
      ? Math.max(1, Math.min(5, Math.trunc(requested)))
      : 5
    this.maxQualityAttemptsOverride = dependencies.maxQualityAttempts === undefined
      ? undefined
      : Math.max(1, Math.min(8, Math.trunc(dependencies.maxQualityAttempts)))
  }

  isEnabled(projectId: string): boolean {
    return this.dependencies.enabled(projectId)
  }

  async whenIdle(projectId: string): Promise<void> {
    await this.activeProjects.get(projectId)
  }

  canRun(projectId: string): boolean {
    return !this.activeProjects.has(projectId)
      && this.isEnabled(projectId)
      && this.dependencies.analyzer.available()
      && (this.dependencies.runtime.running(projectId).length > 0
        || this.dependencies.runtime.ready(projectId).length > 0)
  }

  private async evaluateCandidate(
    agent: Agent,
    projectId: string,
    descriptor: WorkflowDescriptor,
    initial: PromiseSettledResult<WorkflowAnalysisCandidate>,
    research?: ResearchExecutionResult,
  ): Promise<AnalyzedWorkflow> {
    if (initial.status === 'rejected') return { error: initial.reason, revised: 0 }
    let candidate = initial.value
    let revised = 0
    let schemaCorrections = 0
    let previousQuality: WorkflowQualityReport | undefined
    const maxAttempts = this.maxQualityAttemptsOverride
      ?? descriptor.automationPolicy?.maxAutomaticAttempts
      ?? 3

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const evidence = candidate.qualityEvidence ?? legacyQualityEvidence(descriptor)
      if (evidence === undefined) {
        return { error: new Error(`workflow '${descriptor.workflowId}' returned no quality evidence`), revised }
      }
      let quality = evaluateWorkflowQuality(descriptor, evidence, {
        attempt,
        maxAttempts,
        ...(research === undefined ? {} : { research }),
      })
      // Validate the normalized candidate before entering the write boundary.
      // External/conflict failures retain their existing non-retry dispositions.
      let schemaFeedback: { payload: WorkflowAnalysisCandidate['payload']; errors: readonly string[] } | undefined
      if (quality.disposition === 'auto_pass' || quality.disposition === 'auto_revise') {
        let validation: ReturnType<AutomationWorkflowCommitter['validateCandidate']> | undefined
        try {
          validation = this.dependencies.committer.validateCandidate?.(agent, projectId, descriptor, candidate)
        } catch (error) {
          return { error, revised }
        }
        if (validation?.valid === false) {
          schemaFeedback = { payload: candidate.payload, errors: validation.errors.slice(0, 20) }
          quality = Object.freeze({ ...quality,
            disposition: schemaCorrections >= 2 || attempt >= maxAttempts ? 'quality_unresolved' as const : 'auto_revise' as const,
            reasons: Object.freeze([
              `候选 Schema/来源完整性校验失败：${schemaFeedback.errors.join('; ')}`,
              ...(schemaCorrections >= 2 ? ['已达到 Schema/来源完整性自动纠正上限：2次'] : []),
              ...quality.reasons,
            ]),
          })
        }
      }
      if (quality.disposition !== 'auto_revise') return { candidate, quality, revised }
      if (attempt >= maxAttempts) return { candidate, quality, revised }
      revised += 1
      if (schemaFeedback !== undefined) schemaCorrections += 1
      previousQuality = quality
      try {
        candidate = await this.dependencies.analyzer.analyze(
          agent,
          projectId,
          descriptor,
          undefined,
          previousQuality,
          research,
          schemaFeedback,
        )
      } catch (error) {
        return { error, revised }
      }
    }
    return { candidate, quality: previousQuality, revised }
  }

  private async analyzeWithResearch(
    agent: Agent,
    projectId: string,
    descriptor: WorkflowDescriptor,
  ): Promise<AnalyzedWorkflow> {
    const maxAttempts = this.maxQualityAttemptsOverride
      ?? descriptor.automationPolicy?.maxAutomaticAttempts
      ?? 3
    let research: ResearchExecutionResult | undefined
    if (this.dependencies.research !== undefined) {
      try {
        research = await this.dependencies.research.collect(agent, descriptor.workflowId)
      } catch (error) {
        return { error, revised: 0 }
      }
      if (!researchAllowsAnalysis(research, descriptor.workflowId)) {
        return { quality: researchBlockedQuality(descriptor, research, maxAttempts), revised: 0 }
      }
    }
    try {
      const candidate = await this.dependencies.analyzer.analyze(
        agent,
        projectId,
        descriptor,
        undefined,
        undefined,
        research,
      )
      return this.evaluateCandidate(
        agent,
        projectId,
        descriptor,
        { status: 'fulfilled', value: candidate },
        research,
      )
    } catch (error) {
      return { error, revised: 0 }
    }
  }

  async runReadyBatch(
    parent: unknown,
    projectId: string,
    options: ParallelWorkflowRunOptions = {},
  ): Promise<ParallelWorkflowBatchResult> {
    if (!this.canRun(projectId)) {
      return { attempted: 0, completed: 0, blocked: 0, needsHuman: 0, revised: 0, approvedGates: 0 }
    }
    const batch = this.executeBatch(parent, projectId, options)
    this.activeProjects.set(projectId, batch)
    try {
      return await batch
    } finally {
      this.activeProjects.delete(projectId)
    }
  }

  private async executeBatch(parent: unknown, projectId: string, options: ParallelWorkflowRunOptions): Promise<ParallelWorkflowBatchResult> {
    const agent = parent as Agent
    // A persisted running item is a recovery candidate, not a reason to bypass
    // research/quality and send the parent back into unrestricted tool use.
    const running = this.dependencies.runtime.running(projectId)
    const initial = [...running, ...this.dependencies.runtime.ready(projectId)]
      .filter((row, index, rows) => rows.findIndex(other => other.workflowId === row.workflowId) === index)
      .slice(0, this.maxConcurrency)
    const admitted = new Set<string>()
    const pending = new Map<string, Promise<{ descriptor: WorkflowDescriptor; result: AnalyzedWorkflow }>>()
    const workspaceRoot = workspaceRootOf(parent)
    let attempted = 0
    let completed = 0
    let blocked = 0
    let needsHuman = 0
    let revised = 0
    let approvedGates = 0
    let failure: { error: unknown } | undefined

    const settle = async (descriptor: WorkflowDescriptor, result: AnalyzedWorkflow) => {
      revised += result.revised

      if (result.candidate === undefined && result.quality?.disposition === 'blocked_external') {
        await this.dependencies.runtime.transition(projectId, descriptor.workflowId, {
          to: 'blocked',
          reason: qualityExceptionReason(result.quality),
          quality: result.quality,
        })
        blocked += 1
        return
      }

      if (result.error !== undefined || result.candidate === undefined || result.quality === undefined) {
        await this.dependencies.runtime.transition(projectId, descriptor.workflowId, {
          to: 'blocked',
          reason: failureReason(result.error ?? 'workflow analysis incomplete'),
        })
        blocked += 1
        return
      }

      if (result.quality.disposition === 'blocked_external'
        || result.quality.disposition === 'quality_unresolved'
        || result.quality.disposition === 'evidence_conflict') {
        await this.dependencies.runtime.transition(projectId, descriptor.workflowId, {
          to: 'blocked',
          reason: qualityExceptionReason(result.quality),
          quality: result.quality,
        })
        blocked += 1
        return
      }

      if (result.quality.disposition === 'needs_human') {
        await this.dependencies.runtime.transition(projectId, descriptor.workflowId, {
          to: 'pending_review',
          quality: result.quality,
        })
        needsHuman += 1
        return
      }

      if (result.quality.disposition !== 'auto_pass') {
        await this.dependencies.runtime.transition(projectId, descriptor.workflowId, {
          to: 'blocked',
          reason: qualityExceptionReason(result.quality),
          quality: result.quality,
        })
        blocked += 1
        return
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

    const fill = async () => {
      while (pending.size < this.maxConcurrency && failure === undefined && blocked === 0 && needsHuman === 0
        && options.canDispatch?.() !== false && this.isEnabled(projectId) && this.dependencies.analyzer.available()) {
        const candidates = options.refill
          ? [...this.dependencies.runtime.running(projectId), ...this.dependencies.runtime.ready(projectId)]
          : initial
        const descriptor = candidates.find(row => !admitted.has(row.workflowId))
        if (descriptor === undefined) break
        admitted.add(descriptor.workflowId)
        const alreadyRunning = this.dependencies.runtime.running(projectId)
          .some(row => row.workflowId === descriptor.workflowId)
        if (!alreadyRunning) await this.dependencies.runtime.transition(projectId, descriptor.workflowId, { to: 'running' })
        attempted += 1
        // Each analysis includes its bounded quality/schema retries and owns one
        // slot until settled. A slow sibling cannot hold up a finished result.
        pending.set(descriptor.workflowId, this.analyzeWithResearch(agent, projectId, descriptor)
          .then(result => ({ descriptor, result }), error => ({ descriptor, result: { error, revised: 0 } })))
      }
    }

    while (true) {
      try { await fill() } catch (error) { failure ??= { error } }
      if (pending.size === 0) break
      const { descriptor, result } = await Promise.race(pending.values())
      pending.delete(descriptor.workflowId)
      try {
        // Only this loop writes: project Revision/CAS, transitions and gates
        // remain serialized while all other model calls continue concurrently.
        await settle(descriptor, result)
        if (options.refill) approvedGates += await this.dependencies.gateApprover.approveReady(projectId)
      } catch (error) { failure ??= { error } }
      // A pause or infrastructure failure closes admission, but already
      // admitted healthy analyses drain before whenIdle() resolves/rejects.
    }
    if (failure !== undefined) throw failure.error
    if (!options.refill) approvedGates = await this.dependencies.gateApprover.approveReady(projectId)
    await this.dependencies.presentationSync.flush(projectId, {
      ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
      reason: options.refill ? 'parallel-ready-drained' : 'parallel-ready-wave',
    })
    return {
      attempted,
      completed,
      blocked,
      needsHuman,
      revised,
      approvedGates,
    }
  }
}
