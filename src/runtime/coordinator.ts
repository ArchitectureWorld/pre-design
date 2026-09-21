import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { WorkflowRuntime } from './workflow-runtime.ts'
import type { ParallelWorkflowBatchResult, ParallelWorkflowRunOptions } from './parallel-workflow-executor.ts'

export interface CoordinatorAgent {
  readonly id?: string
  followup(message: UserMessage): void | Promise<void>
  whenIdle(): Promise<void>
}

export interface ParallelWorkflowBatchPort {
  isEnabled?(projectId: string): boolean
  whenIdle?(projectId: string): Promise<void>
  canRun(projectId: string): boolean
  runReadyBatch(
    agent: CoordinatorAgent,
    projectId: string,
    options?: ParallelWorkflowRunOptions,
  ): Promise<ParallelWorkflowBatchResult>
}

export class AutomationCoordinator {
  private readonly running = new Map<string, symbol>()
  private readonly failures = new Map<string, string>()
  private readonly reportCancellation = new Map<string, AbortController>()

  constructor(
    private readonly runtime: WorkflowRuntime,
    private readonly parallel?: ParallelWorkflowBatchPort,
    private readonly onComplete?: (projectId: string, signal: AbortSignal, agent: CoordinatorAgent) => Promise<void>,
    private readonly publishIssues?: (agent: CoordinatorAgent, signal: AbortSignal, message: string) => Promise<void>,
  ) {}

  async start(agent: CoordinatorAgent, projectId: string): Promise<void> {
    if (this.running.has(projectId)) return
    const token = Symbol(projectId)
    this.failures.delete(projectId)
    this.running.set(projectId, token)
    const cancellation = new AbortController()
    this.reportCancellation.set(projectId, cancellation)
    void this.run(agent, projectId, token, cancellation.signal)
    await Promise.resolve()
  }

  async pause(projectId: string): Promise<void> {
    this.running.delete(projectId)
    this.reportCancellation.get(projectId)?.abort(new Error('REPORT_GENERATION_PAUSED'))
    this.reportCancellation.delete(projectId)
  }

  isRunning(projectId: string): boolean {
    return this.running.has(projectId)
  }

  lastError(projectId: string): string | undefined {
    return this.failures.get(projectId)
  }

  private async drainPrevious(projectId: string): Promise<void> {
    try { await this.parallel?.whenIdle?.(projectId) } catch {
      // This barrier waits for an earlier generation, not this run's work.
      // Its failure must not consume an explicit resume. Persisted running or
      // blocked items re-enter the normal recovery path after the drain.
    }
  }

  private async run(agent: CoordinatorAgent, projectId: string, token: symbol, signal: AbortSignal): Promise<void> {
    try {
      // Only an explicit start retries previously blocked work, once per start.
      // Wait for a paused in-flight batch before changing its persisted status.
      await this.drainPrevious(projectId)
      if (this.running.get(projectId) !== token) return
      if (this.runtime.snapshot(projectId).blocked.length > 0) await this.runtime.retryBlocked(projectId)
      let resumed = this.runtime.current(projectId)
      const visited = new Set<string>()
      while (this.running.get(projectId) === token) {
        if (this.parallel?.whenIdle !== undefined) {
          await this.drainPrevious(projectId)
          if (this.running.get(projectId) !== token) return
          resumed = this.runtime.current(projectId)
        }
        if (this.parallel?.canRun(projectId) === true) {
          const batch = await this.parallel.runReadyBatch(agent, projectId, {
            refill: true,
            canDispatch: () => this.running.get(projectId) === token,
          })
          if (this.running.get(projectId) !== token) return
          if (batch.attempted > 0) {
            resumed = undefined
            if (batch.blocked > 0 || batch.needsHuman > 0 || batch.errors?.length) {
              this.failures.set(projectId, `已继续处理其余可执行工作；${batch.blocked} 项失败、${batch.needsHuman} 项待处理${batch.errors?.length ? `、${batch.errors.length} 项执行异常` : ''}。详见对应工作项记录。`)
            }
            // Infrastructure errors may leave an unpersistable item Ready. The
            // executor has already drained all independent work; do not spin it.
            if (batch.errors?.length) return
            continue
          }
        }

        const next = resumed ?? this.runtime.nextReady(projectId)
        if (next === undefined) {
          if (this.onComplete !== undefined && this.runtime.isComplete(projectId)) await this.onComplete(projectId, signal, agent)
          return
        }
        if (visited.has(next.workflowId)) return
        visited.add(next.workflowId)
        if (this.parallel?.isEnabled?.(projectId) === true) {
          await this.runtime.transition(projectId, next.workflowId, {
            to: 'blocked',
            reason: '自动工作项分析器当前不可用；请检查 DSH spawn 子代理提供器，恢复后重试。未切换模型或改用主会话工具执行。',
          })
          this.failures.set(projectId, '子代理分析器不可用，已逐项记录失败；其余可执行工作继续处理。')
          resumed = undefined
          continue
        }
        try {
        if (resumed === undefined) {
          await this.runtime.transition(projectId, next.workflowId, { to: 'running' })
        }
        resumed = undefined
        const text = [
          '继续前期策划全流程。只处理 nextWorkflow，不得猜测其他工作项或 Schema。',
          `nextWorkflow: ${next.workflowId}`,
          `目标对象: ${next.targetObjectId}`,
          `任务: ${next.title}`,
          '先调用 preplanning_get_context 获取精确 targetSchema，再只提交一个 ProposalEnvelope。',
        ].join('\n')
        await agent.followup(createUserMessage({
          content: [{ type: 'text', text }],
          source: {
            kind: 'plugin',
            plugin: 'preplanning-agent',
            form: 'notice',
            summary: `继续前期策划工作流 ${next.workflowId}`,
          },
        }))
        await agent.whenIdle()
        if (this.running.get(projectId) !== token) return
        if (this.runtime.current(projectId)?.workflowId === next.workflowId) throw new Error('工作项未返回可提交结果')
        if (this.runtime.snapshot(projectId).blocked.length > 0) this.failures.set(projectId, '失败工作项已记录，其余可执行工作已继续；依赖缺失结果的工作项待补做。')
        } catch (error) {
          if (this.running.get(projectId) !== token) return
          await this.runtime.transition(projectId, next.workflowId, { to: 'blocked', reason: error instanceof Error ? error.message : String(error) })
          this.failures.set(projectId, '失败工作项已记录，其余可执行工作已继续；依赖缺失结果的工作项待补做。')
          resumed = undefined
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (this.running.get(projectId) !== token) {
        // A paused generation cannot rewrite the new generation's workflows.
        if (!this.running.has(projectId)) this.failures.set(projectId, reason)
        return
      }
      this.failures.set(projectId, reason)
      // Detached coordinator work must never leave an unhandled rejection or
      // a silently stuck workflow. Preserve an observable error even if storage fails.
      try {
        const affected = this.runtime.running(projectId)
        const targets = affected.length > 0 ? affected : [this.runtime.nextReady(projectId)].filter(row => row !== undefined)
        for (const workflow of targets) {
          await this.runtime.transition(projectId, workflow.workflowId, { to: 'blocked', reason })
        }
      } catch (persistenceError) {
        this.failures.set(projectId, `${reason}; blocker persistence failed: ${String(persistenceError)}`)
      }
    } finally {
      if (this.running.get(projectId) === token) {
        const message = this.failures.get(projectId)
        if (message && !signal.aborted) {
          try { await this.publishIssues?.(agent, signal, message) }
          catch (error) { this.failures.set(projectId, `${message}; notification failed: ${String(error)}`) }
        }
        if (this.running.get(projectId) !== token) return
        this.running.delete(projectId)
        this.reportCancellation.delete(projectId)
      }
    }
  }
}
