import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import z from '@deepseek-ai/schemastery'
import { registerPreplanningCommands } from './commands/register.ts'
import { ContractRegistry } from './contracts/registry.ts'
import { GovernanceRepository } from './governance/repository.ts'
import { SiteBoundaryAssetStore } from './governance/site-boundary-asset-store.ts'
import { SiteBoundaryService } from './governance/site-boundary-service.ts'
import { PresentationAutoSyncService } from './presentation/auto-sync.ts'
import { PresentationBindingRepository } from './presentation/binding-repository.ts'
import { adoptedPresentationAssets, registerPresentationRuntime } from './presentation/runtime-integration.ts'
import { PresentationStandardProjectService } from './presentation/standard-project-service.ts'
import { PREPLANNING_SYSTEM_PROMPT } from './prompts/preplanning-system.ts'
import { ProposalGateway } from './proposals/gateway.ts'
import { resolveBrowserExecutable } from './report/browser-executable.ts'
import { registerReportDownloadRoute, type ReportDownloadRegistrar } from './report/download-route.ts'
import { ReportPackageService } from './report/package-service.ts'
import { createFrozenProjectInput, loadClientProjectProfile } from './report/source.ts'
import { AutomationService } from './runtime/automation-service.ts'
import { AutomationWorkflowCommitter } from './runtime/automation-workflow-committer.ts'
import { AutomaticGateApprover } from './runtime/automatic-gate-approver.ts'
import { AutomationCoordinator } from './runtime/coordinator.ts'
import { GateService } from './runtime/gate-service.ts'
import { ParallelWorkflowExecutor } from './runtime/parallel-workflow-executor.ts'
import { QuestionService } from './runtime/question-service.ts'
import { RevisionService } from './runtime/revision-service.ts'
import { DshSubagentWorkflowAnalyzer } from './runtime/subagent-workflow-analyzer.ts'
import { WorkflowRuntime } from './runtime/workflow-runtime.ts'
import { ProjectRepository } from './state/repository.ts'
import { registerPreplanningTools } from './tools/register.ts'
import { VisualAgentService } from './visual/agent.ts'
import { VisualAssetStore } from './visual/asset-store.ts'
import { SessionImageCollector } from './visual/session-image-collector.ts'
import { registerWorkspaceOpenRoute, type WorkspaceOpenRegistrar } from './workspace/open-workspace-route.ts'

interface PreplanningHost {
  readonly pluginId: 'preplanning-agent'
  readonly contractVersion: '0.6.0'
  readonly repository: ProjectRepository
  readonly governance: GovernanceRepository
  readonly presentationBindings: PresentationBindingRepository
  readonly standardProjects: PresentationStandardProjectService
  readonly presentationSync: PresentationAutoSyncService
  readonly presentationProjectRoot: string
  readonly gateway: ProposalGateway
  readonly registry: ContractRegistry
  readonly runtime: WorkflowRuntime
  readonly automation: AutomationService
  readonly gates: GateService
  readonly revisions: RevisionService
  readonly questions: QuestionService
  readonly parallel: ParallelWorkflowExecutor
  readonly coordinator: AutomationCoordinator
  readonly visual: VisualAgentService
  readonly siteBoundaryAssets: SiteBoundaryAssetStore
  readonly reports: ReportPackageService
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    preplanning: PreplanningHost
    webServer: ReportDownloadRegistrar & WorkspaceOpenRegistrar
  }
}

interface ConfigShape {}

export const name = 'preplanning-agent'
export const inject = [
  'attachments', 'commands', 'llm', 'sessions', 'storage', 'storageDomain', 'subagents', 'systemPrompt', 'tools', 'webServer',
]
export const Config: z<ConfigShape> = z.object({})

export async function apply(ctx: Context): Promise<void> {
  const now = () => new Date().toISOString()
  const registry = await ContractRegistry.open(new URL('../contracts/v0.6/', import.meta.url))
  const repository = await ProjectRepository.open(ctx.storage.domain)
  const governance = await GovernanceRepository.open(ctx.storage.domain)
  const presentationBindings = await PresentationBindingRepository.open(ctx.storage.domain)
  const presentationProjectRoot = resolve(
    process.env.PRE_DESIGN_PRESENTATION_PROJECT_ROOT?.trim()
      || join(homedir(), '.dsh', 'presentation-projects'),
  )
  const standardProjects = new PresentationStandardProjectService({
    bindings: presentationBindings,
    workspaceRoot: presentationProjectRoot,
    now,
  })
  const runtime = new WorkflowRuntime(registry, governance, now)
  const automation = new AutomationService(governance, registry, now)
  const gates = new GateService(registry, governance, runtime, automation, now)
  const revisions = new RevisionService(registry, runtime)
  const questions = new QuestionService(repository, runtime, now)
  const gateway = new ProposalGateway(repository, registry, now, governance)
  const visualAssetRoot = join(homedir(), '.dsh', 'preplanning-agent', 'visual-assets')
  const visualStore = new VisualAssetStore(visualAssetRoot)
  const siteBoundaryAssets = new SiteBoundaryAssetStore(visualAssetRoot, {
    readImage: (ref, signal) => ctx.attachments.readImage(ref, signal),
  }, now)
  const boundaries = new SiteBoundaryService(governance, siteBoundaryAssets, now, () => `boundary-${randomUUID()}`)
  const visualCollector = new SessionImageCollector({
    sessions: { get: id => ctx.sessions.get(id as never) },
    attachments: { readImage: (ref, signal) => ctx.attachments.readImage(ref as never, signal) },
    waitForEvent: (childId, signal) => new Promise<void>((resolveWait, reject) => {
      let dispose: () => unknown = () => undefined
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort)
        dispose()
      }
      const onAbort = () => {
        cleanup()
        reject(signal.reason ?? new Error('visual image collection aborted'))
      }
      dispose = ctx.on('session/event', (session) => {
        if (String(session.id) !== childId) return
        cleanup()
        resolveWait()
      })
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    }),
  })
  const visual = new VisualAgentService({
    governance,
    llm: ctx.llm,
    subagents: ctx.subagents,
    collector: visualCollector,
    store: visualStore,
    now,
  })
  const frozenProjectSource = (projectId: string, revision: number) => createFrozenProjectInput(
    projectId,
    revision,
    { repository, governance, registry, visualStore },
  )
  const presentationSync = new PresentationAutoSyncService({
    repository,
    standardProjects,
    source: frozenProjectSource,
    adoptedAssets: adoptedPresentationAssets,
    delayMs: 750,
    now,
  })
  const workflowAnalyzer = new DshSubagentWorkflowAnalyzer({
    subagents: ctx.subagents,
    repository,
    registry,
  })
  const workflowCommitter = new AutomationWorkflowCommitter({
    repository,
    governance,
    registry,
    gateway,
    createId: randomUUID,
    now,
  })
  const gateApprover = new AutomaticGateApprover({ registry, governance, gates })
  const parallel = new ParallelWorkflowExecutor({
    runtime,
    enabled: (projectId) => {
      const project = governance.readProject(projectId)
      const authorizationId = project.policy?.automationAuthorizationId
      return project.policy?.mode === 'automatic'
        && authorizationId !== undefined
        && project.authorizations.some(record =>
          record.authorizationId === authorizationId && record.status === 'active')
    },
    analyzer: workflowAnalyzer,
    committer: workflowCommitter,
    gateApprover,
    presentationSync,
    maxConcurrency: 4,
  })
  const coordinator = new AutomationCoordinator(runtime, parallel)
  const reportPackageRoot = join(homedir(), '.dsh', 'preplanning-agent', 'report-packages')
  const clientProfileRoot = join(homedir(), '.dsh', 'preplanning-agent', 'client-profiles')
  const reports = new ReportPackageService({
    governance,
    boundaryIntegrity: boundaries,
    packageRoot: reportPackageRoot,
    browserExecutable: resolveBrowserExecutable(),
    source: async (projectId, revision) => frozenProjectSource(projectId, revision),
    profile: async (projectId, input) => loadClientProjectProfile(clientProfileRoot, projectId, input),
    createId: () => `report-${randomUUID()}`,
    now,
  })
  registerReportDownloadRoute(ctx.webServer, reportPackageRoot)
  registerWorkspaceOpenRoute(ctx.webServer, {
    get: id => ctx.sessions.get(id as never),
  })
  ctx.effect(() => async () => {
    await presentationSync.close()
    await presentationBindings.close()
    await governance.close()
    await repository.close()
  })
  registerPreplanningCommands(ctx, {
    repository,
    gateway,
    governance,
    runtime,
    automation,
    gates,
    revisions,
    coordinator,
    visual,
    boundaries,
    registry,
    reports,
    presentationSync,
    createId: () => `preplan-${randomUUID()}`,
    now,
  })
  registerPreplanningTools(ctx, {
    repository,
    gateway,
    governance,
    runtime,
    registry,
    presentationSync,
  })
  registerPresentationRuntime(ctx, {
    repository,
    standardProjects,
    source: frozenProjectSource,
    autoSync: presentationSync,
  })
  ctx.systemPrompt.section({
    name: 'preplanning-agent',
    order: 120,
    text: PREPLANNING_SYSTEM_PROMPT,
  })
  ctx.provide('preplanning', Object.freeze({
    pluginId: 'preplanning-agent',
    contractVersion: '0.6.0',
    repository,
    governance,
    presentationBindings,
    standardProjects,
    presentationSync,
    presentationProjectRoot,
    gateway,
    registry,
    runtime,
    automation,
    gates,
    revisions,
    questions,
    parallel,
    coordinator,
    visual,
    siteBoundaryAssets,
    reports,
  }))
}
