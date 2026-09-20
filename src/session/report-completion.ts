import type { ConditionalReportPackageService } from '../report/conditional-package-service.ts'
import type { CoordinatorAgent } from '../runtime/coordinator.ts'
import type { ProjectRepository } from '../state/repository.ts'
import type { CommandRuntime } from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'

interface Dependencies {
  readonly repository: Pick<ProjectRepository, 'readContext'>
  readonly reports: Pick<ConditionalReportPackageService, 'generate'>
  readonly publishStatus: (agent: CoordinatorAgent, signal: AbortSignal, reportError?: string) => Promise<void>
  readonly prepareVisuals?: (projectId: string, revision: number, agent: Agent, signal: AbortSignal) => Promise<void>
  readonly prepareManuscript?: (projectId: string, revision: number, agent: Agent, signal: AbortSignal) => Promise<void>
}

export function createReportStatusPublisher(options: {
  commands: Pick<CommandRuntime, 'execute'>
  repository: Pick<ProjectRepository, 'readContext'>
  reportErrors: Map<string, string>
}): Dependencies['publishStatus'] {
  return async (agent, signal, error) => {
    signal.throwIfAborted()
    const projectId = options.repository.readContext(String(agent.id)).project.projectId
    if (error === undefined) options.reportErrors.delete(projectId)
    else options.reportErrors.set(projectId, error)
    // This SDK cannot persist ignorable metadata via Session.append. Its native
    // command lifecycle is log-only, model-free, paired and restart compatible.
    const execution = await options.commands.execute(agent as Agent, '/preplan-status', [], signal)
    if (execution === undefined || execution.result.kind !== 'success') throw new Error('REPORT_STATUS_NOTIFICATION_FAILED')
  }
}

export function createAutomaticReportCompletion(dependencies: Dependencies) {
  return async (projectId: string, signal: AbortSignal, agent: CoordinatorAgent): Promise<void> => {
    if (agent.id === undefined) throw new Error('REPORT_SESSION_UNAVAILABLE')
    const context = dependencies.repository.readContext(String(agent.id))
    if (context.project.projectId !== projectId) throw new Error('REPORT_SESSION_PROJECT_CHANGED')
    const revision = context.project.currentRevision
    const publishStatus = async (reportError?: string) => {
      if (signal.aborted) return
      const latest = dependencies.repository.readContext(String(agent.id))
      if (latest.project.projectId !== projectId || latest.project.currentRevision !== revision) return
      await dependencies.publishStatus(agent, signal, reportError)
    }
    try {
      await dependencies.prepareManuscript?.(projectId, revision, agent as Agent, signal)
      await dependencies.prepareVisuals?.(projectId, revision, agent as Agent, signal)
      await dependencies.reports.generate(projectId, revision, signal)
    } catch (error) {
      // Host diagnostics keep the original error; the user-facing event must not
      // expose local paths or provider credentials included in arbitrary errors.
      await publishStatus('报告生成失败；可继续流程或使用导出命令重试。')
      throw error
    }
    await publishStatus()
  }
}
