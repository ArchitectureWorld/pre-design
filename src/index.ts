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
import { WorkspaceMaterialReader } from './materials/workspace-materials.ts'
import { GovernanceRepository } from './governance/repository.ts'
import { SiteBoundaryAssetStore } from './governance/site-boundary-asset-store.ts'
import { SiteBoundaryService } from './governance/site-boundary-service.ts'
import { PresentationAutoSyncService } from './presentation/auto-sync.ts'
import { PresentationBindingRepository } from './presentation/binding-repository.ts'
import { adoptedPresentationAssets, registerPresentationRuntime } from './presentation/runtime-integration.ts'
import { PresentationStandardProjectService } from './presentation/standard-project-service.ts'
import { PREPLANNING_SYSTEM_PROMPT } from './prompts/preplanning-system.ts'
import { ProposalGateway } from './proposals/gateway.ts'
import { ResearchRegistry } from './research/registry.ts'
import { resolveBrowserExecutable } from './report/browser-executable.ts'
import { registerReportDownloadRoute, type ReportDownloadRegistrar } from './report/download-route.ts'
import { ReportPackageService } from './report/package-service.ts'
import { ConditionalReportPackageService } from './report/conditional-package-service.ts'
import { readReportFormats } from './report/read-report-formats.ts'
import { prepareWorkspacePresentationMaterials } from './presentation/workspace-materials.ts'
import { createAutomaticVisualCompletion } from './presentation/automatic-visuals.ts'
import { sha256File } from './presentation/filesystem.ts'
import { createAutomaticReportCompletion, createReportStatusPublisher } from './session/report-completion.ts'
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
import { WorkflowResearchRuntime } from './runtime/workflow-research-runtime.ts'
import { WorkflowRuntime } from './runtime/workflow-runtime.ts'
import { ProjectRepository } from './state/repository.ts'
import { registerPreplanningTools } from './tools/register.ts'
import { VisualAgentService } from './visual/agent.ts'
import { PageVisualFillService } from './presentation/page-visual-fill.ts'
import { createDesignVisualBridge, type DesignVisualBridge } from './presentation/design-visual-bridge.ts'
export type { DesignVisualBridge, DesignVisualInput, ResolvedDesignVisualContext, TrustedStudioVisualResolver } from './presentation/design-visual-bridge.ts'
import { VisualAssetStore } from './visual/asset-store.ts'
import { readPersistedVisualEvents, SessionImageCollector } from './visual/session-image-collector.ts'
import { AgentClassService, parentRoute } from './agent-classes/service.ts'
import { WebQueryAgent } from './agent-classes/web-query.ts'
import { ImageInspectionAgent } from './visual/image-inspection.ts'
import { createNativeReportImagePipeline } from './presentation/report-image-runtime.ts'
import { SceneSpecificationAgent } from './visual/scene-spec-agent.ts'
import { registerPreplanningExecutionGuard } from './runtime/preplanning-execution-guard.ts'
import { registerAgentClassRoute, type AgentClassRegistrar } from './agent-classes/route.ts'
import { registerWorkspaceOpenRoute, type WorkspaceOpenRegistrar } from './workspace/open-workspace-route.ts'
import { PlanningManuscriptService, PlanningManuscriptEditor } from './report/manuscript/index.ts'
import { ReportContentPlanner } from './report/manuscript/content-planner.ts'
import { prepareCaseStudies } from './report/case-studies/index.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'

interface PreplanningHost {
  readonly agentClasses: AgentClassService
  readonly webQuery: WebQueryAgent
  readonly pluginId: 'preplanning-agent'
  readonly contractVersion: '0.6.0'
  readonly repository: ProjectRepository
  readonly governance: GovernanceRepository
  readonly presentationBindings: PresentationBindingRepository
  readonly standardProjects: PresentationStandardProjectService
  readonly presentationSync: PresentationAutoSyncService
  readonly designVisualBridge: DesignVisualBridge
  readonly presentationProjectRoot: string
  readonly gateway: ProposalGateway
  readonly registry: ContractRegistry
  readonly researchRegistry: ResearchRegistry
  readonly workflowResearch: WorkflowResearchRuntime
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
    webServer: ReportDownloadRegistrar & WorkspaceOpenRegistrar & AgentClassRegistrar
  }
}

interface ConfigShape {}

export const name = 'preplanning-agent'
export const inject = [
  'attachments', 'commands', 'llm', 'sessions', 'storage', 'storageDomain', 'subagents', 'systemPrompt', 'tools', 'webServer',
  'workspaceRegistry',
]
export const Config: z<ConfigShape> = z.object({})

export async function apply(ctx: Context): Promise<void> {
  const now = () => new Date().toISOString()
  const registry = await ContractRegistry.open(new URL('../contracts/v0.6/', import.meta.url))
  const researchRegistry = await ResearchRegistry.open(new URL('../research/v2.0.1/', import.meta.url))
  const repository = await ProjectRepository.open(ctx.storage.domain)
  const workflowResearch = new WorkflowResearchRuntime(researchRegistry, {
    excludedStateObjectIds: projectId => runtime.snapshot(projectId).runs.filter(run => run.status !== 'confirmed' && run.status !== 'not_applicable').map(run => run.targetObjectId),
    projectContextOf: (parent) => {
      const id = (parent as { readonly id?: unknown }).id
      return id === undefined || id === null ? undefined : repository.readContext(String(id))
    },
  })
  const governance = await GovernanceRepository.open(ctx.storage.domain)
  const automation = new AutomationService(governance, registry, now)
  const agentClassSessions = { get: (id: string) => ctx.sessions.get(id as never) }
  const persistedChildEvents = (id: string, signal: AbortSignal = AbortSignal.timeout(5000)) => {
    const persistence = ctx.get('sessionPersistence')
    if (!persistence) throw new Error('VISUAL_SESSION_PERSISTENCE_UNAVAILABLE: cannot verify an unloaded child')
    return readPersistedVisualEvents(persistence, id, signal)
  }
  const agentClasses = await AgentClassService.open(ctx.storage.domain, {
    tools: ctx.tools,
    readPersistedEvents: persistedChildEvents,
    llm: ctx.llm, sessions: agentClassSessions, activity: id => ctx.get('agents')?.get(id as never)?.status,
    modelTurnAuthorization: (projectId, parentId) => {
      if (governance.readProject(projectId).policy?.mode !== 'automatic') return undefined
      const context = repository.readContext(parentId)
      if (context.project.projectId !== projectId) throw new Error('MODEL_BUDGET_PROJECT_MISMATCH')
      const authorization = automation.requireValid(projectId, context.project.currentRevision)
      return { authorizationId: authorization.authorizationId, grantedAt: authorization.grantedAt,
        maxModelTurns: authorization.scope.maxModelTurns, maxVisualGenerations: authorization.scope.maxVisualGenerations,
        visualBudgetMode: authorization.scope.visualBudgetMode,
        projectVisualBudget: governance.readProject(projectId).visualPolicies.find(policy => policy.policyId === governance.readProject(projectId).policy?.visualPolicyId)?.projectGenerationBudget }
    },
  })
  registerPreplanningExecutionGuard(ctx, id => {
    try { return !!repository.readContext(id).project } catch { return false }
  })
  const webQuery = new WebQueryAgent({ classes: agentClasses, subagents: ctx.subagents, tools: ctx.tools, sessions: agentClassSessions })
  const presentationBindings = await PresentationBindingRepository.open(ctx.storage.domain)
  const dshHome = resolve(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'))
  const presentationProjectRoot = resolve(
    process.env.PRE_DESIGN_PRESENTATION_PROJECT_ROOT?.trim()
      || join(dshHome, 'presentation-projects'),
  )
  const standardProjects = new PresentationStandardProjectService({
    bindings: presentationBindings,
    workspaceRoot: presentationProjectRoot,
    now,
  })
  await standardProjects.recoverBoundWorkspaces()
  const runtime = new WorkflowRuntime(registry, governance, now)
  const gates = new GateService(registry, governance, runtime, automation, now)
  const revisions = new RevisionService(registry, runtime)
  const questions = new QuestionService(repository, runtime, now)
  const gateway = new ProposalGateway(repository, registry, now, governance)
  const visualAssetRoot = join(dshHome, 'preplanning-agent', 'visual-assets')
  const visualStore = new VisualAssetStore(visualAssetRoot, undefined, undefined, projectId => {
    const binding = standardProjects.findByPreDesignProjectId(projectId)
    return binding?.workspaceRoot ?? binding?.directoryRoot
  }, fileName => {
    const projectId = fileName.split('/')[0]
    try { return governance.readProject(projectId).visualAssets.find(asset => asset.fileName === fileName)?.sha256 }
    catch { return undefined }
  })
  const siteBoundaryAssets = new SiteBoundaryAssetStore(visualAssetRoot, {
    readImage: (ref, signal) => ctx.attachments.readImage(ref, signal),
  }, now)
  const boundaries = new SiteBoundaryService(governance, siteBoundaryAssets, now, () => `boundary-${randomUUID()}`)
  const visualCollector = new SessionImageCollector({
    sessions: { get: id => ctx.sessions.get(id as never) },
    readPersistedEvents: persistedChildEvents,
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
    agentClasses,
    governance,
    llm: ctx.llm,
    subagents: ctx.subagents,
    collector: visualCollector,
    store: visualStore,
    now,
  })
  // The deployed WorkBuddy gateway has one global account with two in-flight slots.
  // Re-read the saved route on each run so changing models does not require a restart.
  const manuscriptConcurrency = () => agentClasses.settings().routes.text?.provider === 'workdubbyAI' ? 2 : 5
  const manuscriptEditor = new PlanningManuscriptEditor({ subagents: ctx.subagents, agentClasses, now, maxConcurrency: manuscriptConcurrency })
  const manuscripts = new PlanningManuscriptService({ subagents: ctx.subagents, agentClasses, now, maxConcurrency: manuscriptConcurrency, editor: manuscriptEditor })
  const reportContentPlanner = new ReportContentPlanner({ subagents: ctx.subagents, agentClasses })
  const frozenProjectSource = async (projectId: string, revision: number) => {
    const input = createFrozenProjectInput(projectId, revision, { repository, governance, registry, visualStore })
    const binding = standardProjects.findByPreDesignProjectId(projectId)
    const root = binding?.workspaceRoot ?? binding?.directoryRoot
    const manuscript = root ? await manuscripts.load(input, root) : undefined
    return manuscript ? { ...input, manuscript: await reportContentPlanner.load(manuscript, root!) ?? manuscript, caseStudies: await prepareCaseStudies(input, root) } : input
  }
  const prepareManuscript = async (projectId: string, revision: number, agent: Agent, signal: AbortSignal) => {
    const binding = standardProjects.findByPreDesignProjectId(projectId)
    const root = binding?.workspaceRoot ?? binding?.directoryRoot
    if (!root) throw new Error('MANUSCRIPT_WORKSPACE_REQUIRED: 请先绑定汇报工作区。')
    const assertCurrent = () => {
      const current = repository.readContext(String(agent.id))
      if (current.project.projectId !== projectId || current.project.currentRevision !== revision || !runtime.isComplete(projectId)) throw new Error('MANUSCRIPT_SOURCE_CHANGED')
      if (governance.readProject(projectId).policy?.mode === 'automatic') automation.requireValid(projectId, revision)
    }
    assertCurrent()
    const manuscript = await manuscripts.prepare(await frozenProjectSource(projectId, revision), root, agent, signal, assertCurrent)
    await reportContentPlanner.prepare(manuscript, root, agent, signal, assertCurrent)
  }
  const presentationSync = new PresentationAutoSyncService({
    repository,
    standardProjects,
    source: frozenProjectSource,
    adoptedAssets: adoptedPresentationAssets,
    delayMs: 750,
    now,
  })
  const pageVisualFill = new PageVisualFillService({ visual, governance, resolveAsset: fileName => visualStore.resolveAsset(fileName), adoptedAssets: adoptedPresentationAssets })
  const designVisualBridge = createDesignVisualBridge({ repository, registry, standardProjects, source: frozenProjectSource, pageVisualFill, now })
  const workflowAnalyzer = new DshSubagentWorkflowAnalyzer({
    revisionRequest: (projectId, workflowId) => governance.readProject(projectId).workflowRuns.find(run => run.workflowId === workflowId)?.revisionRequest,
    agentClasses,
    subagents: ctx.subagents,
    repository,
    registry,
    researchRegistry,
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
    research: workflowResearch,
    committer: workflowCommitter,
    gateApprover,
    presentationSync,
    maxConcurrency: 5,
  })
  const reportPackageRoot = join(dshHome, 'preplanning-agent', 'report-packages')
  const reportFormats = (record: import('./governance/types.ts').ReportPackageRecord) => readReportFormats(reportPackageRoot, record)
  const imageInspection = new ImageInspectionAgent({ classes: agentClasses, subagents: ctx.subagents, attachments: ctx.attachments })
  const sceneSpecs = new SceneSpecificationAgent({ classes: agentClasses, subagents: ctx.subagents })
  const reportImagePipeline = createNativeReportImagePipeline({ classes: agentClasses, inspection: imageInspection, sceneSpecs, web: webQuery, visual,
    resolveAsset: fileName => visualStore.resolveAsset(fileName),
    reportIssues: (parent, signal, message) => publishReportStatus(parent, signal, message),
  })
  const clientProfileRoot = join(dshHome, 'preplanning-agent', 'client-profiles')
  const prepareReportMaterials = async (frozenProject: import('./report/types.ts').FrozenProjectInput) => {
    const binding = standardProjects.findByPreDesignProjectId(frozenProject.projectId)
    if (frozenProject.manuscript) {
      const root = binding?.workspaceRoot ?? binding?.directoryRoot
      const reviewed = root ? await reportImagePipeline.load(frozenProject, root) : undefined
      if (!reviewed) throw new Error('REPORT_IMAGE_PLAN_REQUIRED: 请先完成素材去重、审图与物理页面质量检查，再导出汇报。')
      return reviewed
    }
    const materials = await prepareWorkspacePresentationMaterials({ frozenProject, workspaceRoot: binding?.workspaceRoot ?? binding?.directoryRoot,
      assets: adoptedPresentationAssets(frozenProject), previous: binding })
    return Promise.all(materials.assets.map(async asset => ({ ...asset, sha256: await sha256File(asset.sourcePath) })))
  }
  const reports = new ReportPackageService({
    governance,
    boundaryIntegrity: boundaries,
    packageRoot: reportPackageRoot,
    browserExecutable: resolveBrowserExecutable(),
    source: async (projectId, revision) => frozenProjectSource(projectId, revision),
    profile: async (projectId, input) => loadClientProjectProfile(clientProfileRoot, projectId, input),
    materials: prepareReportMaterials,
    createId: () => `report-${randomUUID()}`,
    now,
  })
  registerReportDownloadRoute(ctx.webServer, reportPackageRoot)
  registerAgentClassRoute(ctx.webServer, {
    classes: agentClasses, repository, sessions: agentClassSessions,
    routeForSession: (id) => {
      const parent = ctx.get('agents')?.get(id as never)
      return parent ? parentRoute(parent) : undefined
    },
  })
  const currentReportRevision = (projectId: string) => repository.listProjects().find(project => project.projectId === projectId)?.currentRevision ?? -1
  const conditionalReports = new ConditionalReportPackageService({
    formats: ['html'],
    requireManuscript: true,
    requireCaseStudies: true,
    governance, packageRoot: reportPackageRoot, browserExecutable: resolveBrowserExecutable(),
    source: async (projectId, revision) => frozenProjectSource(projectId, revision),
    materials: prepareReportMaterials,
    currentRevision: currentReportRevision, isComplete: projectId => runtime.isComplete(projectId), now,
  })
  const reportErrors = new Map<string, string>()
  const prepareVisuals = createAutomaticVisualCompletion({ pageVisualFill,
    prepareImageQuality: async (input, parent, signal, assertCurrent, maxGenerations) => { await reportImagePipeline.prepare(input.frozenProject, input.workspaceRoot, parent, signal, assertCurrent, { maxGenerations }) },
    assertCurrent: (projectId, revision, parent) => {
      const current = repository.readContext(String(parent.id))
      if (current.project.projectId !== projectId || current.project.currentRevision !== revision || !runtime.isComplete(projectId)) throw new Error('VISUAL_SOURCE_CHANGED')
      automation.requireValid(projectId, revision)
    },
    input: async (projectId, revision) => {
      const binding = standardProjects.findByPreDesignProjectId(projectId)
      const workspaceRoot = binding?.workspaceRoot ?? binding?.directoryRoot
      if (!workspaceRoot) throw new Error('VISUAL_WORKSPACE_REQUIRED: 请先绑定汇报工作区')
      return { frozenProject: await frozenProjectSource(projectId, revision), workspaceRoot, previous: binding }
    },
    target: (projectId, revision) => {
      const governed = governance.readProject(projectId)
      const visualPolicy = governed.visualPolicies.find(policy => policy.policyId === governed.policy?.visualPolicyId)
      if (governed.policy?.mode !== 'automatic' || !visualPolicy?.enabled) return 0
      const authorization = automation.requireValid(projectId, revision)
      if (authorization.scope.visualBudgetMode === 'on_demand') return Number.POSITIVE_INFINITY
      return Math.min(visualPolicy.targetConceptImages, visualPolicy.projectGenerationBudget, authorization.scope.maxVisualGenerations)
    },
    sync: async projectId => {
      const result = await presentationSync.flush(projectId, { reason: 'client-visual-delivery' })
      if (result.state !== 'synced') throw new Error('VISUAL_SYNC_INCOMPLETE: 图片已保存，页面同步未完成')
    },
  })
  const publishReportStatus = createReportStatusPublisher({ commands: ctx.commands, repository, reportErrors })
  const coordinator = new AutomationCoordinator(runtime, parallel, createAutomaticReportCompletion({
    reports: conditionalReports, repository, prepareManuscript, prepareVisuals,
    publishStatus: publishReportStatus,
  }), publishReportStatus)
  registerWorkspaceOpenRoute(ctx.webServer, {
    get: id => ctx.sessions.get(id as never),
  }, Reflect.get(ctx, 'workspaceRegistry'))
  ctx.effect(() => async () => {
    await agentClasses.close()
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
    conditionalReports,
    prepareManuscript,
    prepareVisuals,
    reportErrors,
    reportFormats,
    presentationSync,
    pageVisualFill,
    pageVisualInput: async (projectId, revision, requestedRoot) => {
      const binding = standardProjects.findByPreDesignProjectId(projectId)
      const workspaceRoot = requestedRoot ?? binding?.workspaceRoot ?? binding?.directoryRoot
      if (!workspaceRoot) throw new Error('请先绑定工作区并同步标准项目，再执行按页补图')
      return { frozenProject: await frozenProjectSource(projectId, revision), workspaceRoot, previous: binding }
    },
    createId: () => `preplan-${randomUUID()}`,
    now,
  })
  registerPreplanningTools(ctx, {
    reportFormats,
    webQuery,
    materialReader: new WorkspaceMaterialReader(),
    designVisualBridge,
    repository,
    gateway,
    governance,
    runtime,
    registry,
    presentationSync,
    gateApprover,
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
    agentClasses,
    webQuery,
    designVisualBridge,
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
    researchRegistry,
    workflowResearch,
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
