import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { WorkflowRuntime } from './workflow-runtime.ts'

export interface CoordinatorAgent {
  followup(message: UserMessage): void | Promise<void>
  whenIdle(): Promise<void>
}

export class AutomationCoordinator {
  private readonly running = new Map<string, symbol>()

  constructor(private readonly runtime: WorkflowRuntime) {}

  async start(agent: CoordinatorAgent, projectId: string): Promise<void> {
    if (this.running.has(projectId)) return
    const token = Symbol(projectId)
    this.running.set(projectId, token)
    void this.run(agent, projectId, token)
    await Promise.resolve()
  }

  async pause(projectId: string): Promise<void> {
    this.running.delete(projectId)
  }

  isRunning(projectId: string): boolean {
    return this.running.has(projectId)
  }

  private async run(agent: CoordinatorAgent, projectId: string, token: symbol): Promise<void> {
    try {
      while (this.running.get(projectId) === token) {
        const next = this.runtime.nextReady(projectId)
        if (next === undefined) return
        await this.runtime.transition(projectId, next.workflowId, { to: 'running' })
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
        if (this.runtime.snapshot(projectId).blocked.length > 0) return
      }
    } finally {
      if (this.running.get(projectId) === token) this.running.delete(projectId)
    }
  }
}
