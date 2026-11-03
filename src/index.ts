import { chapterProductionDirectory } from './report/chapter-production-contract.ts'
export { chapterProductionDirectory } from './report/chapter-production-contract.ts'
import { PreplanningSubagents } from './runtime/dsh-subagents.ts'
import { randomUUID } from 'node:crypto'
import { establishedResearchWorkspace } from './research-v2/workspace-binding.ts'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SessionStore } from '@deepseek-ai/dsh-session'
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
import { DEFAULT_REPORT_DELIVERY_CONTRACT } from './report/delivery-contract.ts'
import { ReportContentReviewService, ReportContentRejected } from './report/content-review.ts'
import { ReportAcceptanceService } from './report/acceptance.ts'
import { ReportPageRejected } from './report/page-rejection.ts'
import { ReportRenderedReviewService } from './report/rendered-review.ts'
import { ensureReportResearch } from './report/research-preparation.ts'
import { readReportDeliveryState, writeReportDeliveryState, type ReportDeliveryState } from './report/delivery-state.ts'
import { readReportFormats } from './report/read-report-formats.ts'
import { loadTerrainReference } from './report/terrain-reference.ts'
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
import { createNativeMaterialResearchIntake, sessionStatements } from './runtime/material-research-intake.ts'
import { createNativeModuleRuntime } from './research-v2/native-module-runtime.ts'
import {controlledResearchReady} from './research-v2/module-progress-review.ts'
import {createReportTaskStatementReader} from './report/task-statements.ts'
import { createModuleResearchCommands, controlledResearchPlan } from './research-v2/module-command.ts'
import { acquireModuleWebCorpus } from './research-v2/module-web-acquisition.ts'
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
import { beginReportResearchSelection, acceptReportResearchSelection, invalidateReportResearchSelection, createReportModuleResearchLoader, assertReportResearchReady, assertReportTaskUnchanged,
  type ReportResearchBinding, type ReportModuleResearchLoad } from './report/module-source.ts'
import type { FrozenProjectInput } from './report/types.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ChapterProductionService } from './report/chapter-production.ts'

interface PreplanningHost {
  readonly subagents: PreplanningSubagents
  readonly research: ReturnType<typeof createModuleResearchCommands>
  readonly reportAccess: {
    readonly chapterProductionDirectory: typeof chapterProductionDirectory
    status(projectId: string): Promise<ReportModuleResearchLoad>
    generate(parent: Agent, signal: AbortSignal): Promise<import('./governance/types.ts').ArtifactManifestRecord>
    chapter(parent: Agent, chapterId: import('./report/manuscript/types.ts').PlanningChapterId,
      stage: 'write' | 'review' | 'revise' | `production-${import('./report/chapter-production.ts').ChapterProductionStage}`, signal: AbortSignal): Promise<string>
  }
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
  'attachments', 'commands', 'llm', 'sessions', 'storage', 'storageDomain', 'subagents', 'systemPrompt', 'tools',
]
export const Config: z<ConfigShape> = z.object({})

export async function apply(ctx: Context): Promise<void> {
  const now = () => new Date().toISOString()
  const dshHome = resolve(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'))
  const subagents = new PreplanningSubagents(ctx, ctx.subagents, join(dshHome, 'preplanning-agent', 'child-policies'))
  const registry = await ContractRegistry.open(new URL('../contracts/v0.6/', import.meta.url))
  const researchRegistry = await ResearchRegistry.open(new URL('../research/v2.0.1/', import.meta.url))
  const repository = await ProjectRepository.open(ctx.storage.domain)
  const workflowResearch = new WorkflowResearchRuntime(researchRegistry, {
    materialEvidence: (parent, workflowId, signal) => materialIntake.collect(parent, workflowId, signal),
    excludedStateObjectIds: projectId => runtime.snapshot(projectId).runs.filter(run => run.status !== 'confirmed' && run.status !== 'not_applicable').map(run => run.targetObjectId),
    projectContextOf: (parent) => {
      const id = (parent as { readonly id?: unknown }).id
      return id === undefined || id === null ? undefined : repository.readContext(String(id))
    },
  })
  const governance = await GovernanceRepository.open(ctx.storage.domain)
  const automation = new AutomationService(governance, registry, now)
  const agentClassSessions = { get: (id: string) => ctx.sessions.get(id as never) }
  // Local receipt replay shares the event loop with full research verification.
  // Its I/O allowance is independent of model deadlines and reasoning settings.
  const persistedChildEvents = (id: string, signal: AbortSignal = AbortSignal.timeout(120_000)) => {
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
  const materialIntake = createNativeMaterialResearchIntake({ registry: researchRegistry, subagents, agentClasses,
    projectIdOf: parent => repository.readContext(String(parent.id)).project.projectId })
  const webQuery = new WebQueryAgent({ classes: agentClasses, subagents, tools: ctx.tools, sessions: agentClassSessions, readPersistedEvents: persistedChildEvents })
  const presentationBindings = await PresentationBindingRepository.open(ctx.storage.domain)
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
  }, now, projectId => {
    const binding = standardProjects.findByPreDesignProjectId(projectId)
    return binding?.workspaceRoot ?? binding?.directoryRoot
  })
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
    subagents,
    collector: visualCollector,
    store: visualStore,
    now,
  })
  // The deployed WorkBuddy gateway has one global account with two in-flight slots.
  // Re-read the saved route on each run so changing models does not require a restart.
  const manuscriptConcurrency = () => 2
  const manuscriptEditor = new PlanningManuscriptEditor({ subagents, agentClasses, now, maxConcurrency: manuscriptConcurrency })
  const manuscripts = new PlanningManuscriptService({ subagents, agentClasses, now, maxConcurrency: manuscriptConcurrency, editor: manuscriptEditor,
    readEvents:async id=>agentClassSessions.get(id)?.snapshotEvents()??await persistedChildEvents(id,AbortSignal.timeout(120_000))??[] })
  const reportContentPlanner = new ReportContentPlanner({ subagents, agentClasses,requireNativePlan:true })
  const reportResearchBinding = (projectId: string): ReportResearchBinding | undefined => {
    const binding = establishedResearchWorkspace(standardProjects.findByPreDesignProjectId(projectId))
    return binding ? { projectId, workspaceRoot: binding.root, standardProjectId: binding.standardProjectId } : undefined
  }
  const moduleSourceDependencies = { executions: (projectId: string) => agentClasses.executions(projectId, { all:true }), readEvents: persistedChildEvents }
  const loadReportResearch = createReportModuleResearchLoader(moduleSourceDependencies)
  const readReportTaskStatements = createReportTaskStatementReader({
    live: id => agentClassSessions.get(id),
    stat: async id => {
      const persistence = ctx.get('sessionPersistence')
      const snapshot = await persistence?.stat(id as never)
      return snapshot ? { id: String(snapshot.header.id), revision: String(snapshot.revision) } : undefined
    },
    readEvents: id => persistedChildEvents(id, AbortSignal.timeout(120_000)),
  })
  const reportWorkspaceRoot=(projectId:string)=>{const root=reportResearchBinding(projectId)?.workspaceRoot;if(!root)throw new Error('REPORT_WORKSPACE_REQUIRED');return root}
  const reportParents=new Map<string,Agent>()
  const controlledReportProjects = new Set<string>()
  const reviewEvents=async(id:string)=>agentClassSessions.get(id)?.snapshotEvents()??await persistedChildEvents(id)??[]
  const contentReview=new ReportContentReviewService({classes:agentClasses,subagents,readEvents:reviewEvents})
  const chapterProduction=new ChapterProductionService({classes:agentClasses,subagents,attachments:ctx.attachments,readEvents:reviewEvents,manuscripts,review:contentReview,web:webQuery,visual})
  const renderedReview=new ReportRenderedReviewService({classes:agentClasses,subagents,attachments:ctx.attachments,readEvents:reviewEvents,workspaceRoot:reportWorkspaceRoot,
    parent:projectId=>{const parent=reportParents.get(projectId);if(!parent)throw new Error('REPORT_REVIEW_PARENT_REQUIRED');return parent}})
  const reportAcceptance=new ReportAcceptanceService({content:contentReview,workspaceRoot:reportWorkspaceRoot,rendered:renderedReview,browserExecutable:resolveBrowserExecutable()})
  const reportDelivery=(projectId:string)=>{const root=reportResearchBinding(projectId)?.workspaceRoot;return root?readReportDeliveryState(root,projectId):undefined}
  const updateDelivery=async(projectId:string,revision:number,status:ReportDeliveryState['status'],message:string)=>{
    await writeReportDeliveryState(reportWorkspaceRoot(projectId),projectId,revision,status,message)
    const parent=reportParents.get(projectId)
    if(parent)await publishReportStatus(parent,new AbortController().signal,status==='failed'?message:undefined)
  }
  const reportResearch = async (projectId: string, required: boolean, parent?: Agent): Promise<ReportModuleResearchLoad> => {
    const binding = reportResearchBinding(projectId)
    const load = binding ? await loadReportResearch(binding) : { status: 'not_requested' as const }
    if (required) {
      assertReportResearchReady(load)
      if (load.status !== 'not_requested') {
        assertReportTaskUnchanged(load, await readReportTaskStatements(load.selection.parentId))
        if (parent && String(parent.id) !== load.selection.parentId) assertReportTaskUnchanged(load, sessionStatements(parent))
      }
    }
    return load
  }
  const assertFrozenReportCurrent = async (input: FrozenProjectInput) => {
    const load = await reportResearch(input.projectId, true)
    if ((load.status === 'ready' ? load.research.fingerprint : undefined) !== input.moduleResearch?.fingerprint) throw new Error('REPORT_MODULE_SELECTION_CHANGED')
    if((await loadTerrainReference(reportWorkspaceRoot(input.projectId)))?.fingerprint!==input.terrain?.fingerprint)throw new Error('REPORT_TERRAIN_CHANGED')
  }
  const frozenProjectSource = async (projectId: string, revision: number, requireResearch = false, parent?: Agent) => {
    let input: FrozenProjectInput = { ...createFrozenProjectInput(projectId, revision, { repository, governance, registry, visualStore }), deliveryContract:DEFAULT_REPORT_DELIVERY_CONTRACT }
    const binding = standardProjects.findByPreDesignProjectId(projectId)
    const root = binding?.workspaceRoot ?? binding?.directoryRoot
    const research = await reportResearch(projectId, requireResearch, parent)
    if(root)input={...input,terrain:await loadTerrainReference(root)}
    if (research.status === 'ready') input = { ...input, moduleResearch: research.research }
    const manuscript = root ? await manuscripts.load(input, root) : undefined
    return manuscript ? { ...input, manuscript: await reportContentPlanner.load(manuscript, root!) ?? manuscript, caseStudies: await prepareCaseStudies(input, root) } : input
  }
  const prepareManuscript = async (projectId: string, revision: number, agent: Agent, signal: AbortSignal) => {
    reportParents.set(projectId,agent)
    const binding = standardProjects.findByPreDesignProjectId(projectId)
    const root = binding?.workspaceRoot ?? binding?.directoryRoot
    if (!root) throw new Error('MANUSCRIPT_WORKSPACE_REQUIRED: 请先绑定汇报工作区。')
    await updateDelivery(projectId,revision,'generating','正在完成研究与完整图文策划文稿。')
    try{
    const current=repository.readContext(String(agent.id))
    if(current.project.projectId!==projectId||current.project.currentRevision!==revision)throw new Error('REPORT_WORKFLOWS_INCOMPLETE')
    if(governance.readProject(projectId).policy?.mode==='automatic')automation.requireValid(projectId,revision)
    await ensureReportResearch({load:()=>reportResearch(projectId,false,agent),start:async flags=>{
      const raw=flags?Object.entries(flags).map(([key,value])=>`--${key}=${value}`).join(' '):'--all-modules'
      const result=await ctx.commands.execute(agent,`/preplan-research-run ${raw}`,[],signal)
      if(!result||result.result.kind!=='success')throw new Error('REPORT_RESEARCH_START_FAILED')
    },wait:()=>moduleResearch.whenIdle(projectId)},signal,{allowStart:!controlledReportProjects.has(projectId)})
    const input = await frozenProjectSource(projectId, revision, true, agent)
    const assertCurrent = async () => {
      const current = repository.readContext(String(agent.id))
      if (current.project.projectId !== projectId || current.project.currentRevision !== revision) throw new Error('MANUSCRIPT_SOURCE_CHANGED')
      if (governance.readProject(projectId).policy?.mode === 'automatic') automation.requireValid(projectId, revision)
      await assertFrozenReportCurrent(input)
    }
    await assertCurrent()
    let manuscript = await manuscripts.prepare(input, root, agent, signal, assertCurrent)
    for(;;){
      const display=await reportContentPlanner.prepare(manuscript,root,agent,signal,assertCurrent)
      const reviewInput={...input,manuscript:display,caseStudies:await prepareCaseStudies({...input,manuscript},root)}
      await updateDelivery(projectId,revision,'pending','文稿已生成，正在进行独立内容验收。')
      try{await contentReview.prepare(reviewInput,root,agent,signal,assertCurrent);break}
      catch(error){
        if(!(error instanceof ReportContentRejected))throw error
        await updateDelivery(projectId,revision,'generating','内容验收发现具体页面问题，正在定向修订。')
        manuscript=await manuscripts.revise({...input,manuscript},manuscript,error.findings,root,agent,signal,assertCurrent,error.stage)
      }
    }
    }catch(error){
      const message=error instanceof ReportContentRejected?error.message:'研究、文稿或独立审查未完成；已保留真实状态与诊断，尚无合格报告。'
      await updateDelivery(projectId,revision,'failed',message);throw error
    }
  }
  const prepareChapter = async (projectId: string, revision: number, parent: Agent, signal: AbortSignal,
    chapterId: import('./report/manuscript/types.ts').PlanningChapterId, stage: 'write' | 'review' | 'revise' | `production-${import('./report/chapter-production.ts').ChapterProductionStage}`): Promise<string> => {
    const { readFile, writeFile, mkdir, rename } = await import('node:fs/promises')
    const root = reportWorkspaceRoot(projectId), briefPath = join(root, '.pre-design', 'report-chapter-plans', `${chapterId}.json`)
    const briefText = stage==='production-plan'?undefined:await readFile(briefPath, 'utf8')
    const brief = briefText?JSON.parse(briefText) as import('./report/chapter-plan.ts').ApprovedChapterBrief:undefined
    if (brief&&brief.plan.chapterId !== chapterId) throw new Error('CHAPTER_PLAN_ID_MISMATCH')
    const requestPath=join(root,'.pre-design','chapter-production-requests',`${chapterId}.json`)
    const requestText=stage.startsWith('production-')?await readFile(requestPath,'utf8'):undefined
    const research = stage.startsWith('production-') ? await reportResearch(projectId,true,parent) : undefined
    const input = {...createFrozenProjectInput(projectId, revision, { repository, governance, registry, visualStore }),
      ...(research?.status==='ready'?{moduleResearch:research.research}:{})}
    const guard = async () => {
      signal.throwIfAborted()
      const current = repository.readContext(String(parent.id))
      if (current.project.projectId !== projectId || current.project.currentRevision !== revision) throw new Error('MANUSCRIPT_SOURCE_CHANGED')
      if (briefText!==undefined&&await readFile(briefPath, 'utf8') !== briefText) throw new Error('CHAPTER_PLAN_CHANGED')
      if (requestText!==undefined&&await readFile(requestPath,'utf8')!==requestText)throw new Error('CHAPTER_PRODUCTION_REQUEST_CHANGED')
    }
    await guard()
    if(stage.startsWith('production-'))return chapterProduction.run(input,root,chapterId,stage.slice(11) as import('./report/chapter-production.ts').ChapterProductionStage,parent,signal,guard)
    if(!brief)throw new Error('CHAPTER_PRODUCTION_REQUEST_REQUIRED')
    let draft = await manuscripts.prepareChapter(input, root, parent, signal, guard, brief)
    let review = stage !== 'write' ? await contentReview.prepareChapter(draft, brief, root, parent, signal, guard) : undefined
    if (stage === 'revise' && review?.status === 'needs_revision') {
      draft = await manuscripts.reviseChapter(input, root, parent, signal, guard, brief, draft, review)
      review = await contentReview.prepareChapter(draft, brief, root, parent, signal, guard)
    }
    await guard()
    const folder = join(root, '.pre-design', 'report-chapters', chapterId)
    await mkdir(folder, { recursive: true })
    const temporary = join(folder, `latest.tmp-${randomUUID()}.json`)
    await writeFile(temporary, JSON.stringify({ scope: 'chapter', chapterId, planHash: draft.planHash, rulesVersion: draft.rulesVersion,
      draftPath: draft.artifactPaths.chapter, reviewPath: review?.path, contentStatus: review?.status ?? 'draft_ready',
      userReview: 'pending', updatedAt: now(), pageCount: draft.chapter.pages.length }, null, 2))
    await guard(); await rename(temporary, join(folder, 'latest.json'))
    return `${draft.chapter.title}：${draft.chapter.pages.length}页原生正文已保存。${review ? `独立内容审查：${review.status}。` : '尚未进行独立内容审查。'}图件与正式HTML/PDF尚未导出。\n${draft.artifactPaths.chapter}${review ? `\n${review.path}` : ''}`
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
    revisionHistory: (projectId, workflowId) => runtime.revisionHistory(projectId, workflowId),
    agentClasses,
    subagents,
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
    maxConcurrency: 2,
  })
  const reportPackageRoot = join(dshHome, 'preplanning-agent', 'report-packages')
  const reportFormats = (record: import('./governance/types.ts').ReportPackageRecord) => readReportFormats(reportPackageRoot, record)
  const imageInspection = new ImageInspectionAgent({ classes: agentClasses, subagents, attachments: ctx.attachments })
  const sceneSpecs = new SceneSpecificationAgent({ classes: agentClasses, subagents })
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
    acceptance:reportAcceptance,
    governance,
    boundaryIntegrity: boundaries,
    packageRoot: reportPackageRoot,
    browserExecutable: resolveBrowserExecutable(),
    source: async (projectId, revision) => frozenProjectSource(projectId, revision, true),
    assertSourceCurrent: assertFrozenReportCurrent,
    profile: async (projectId, input) => loadClientProjectProfile(clientProfileRoot, projectId, input),
    materials: prepareReportMaterials,
    createId: () => `report-${randomUUID()}`,
    now,
  })
  const currentReportRevision = (projectId: string) => repository.listProjects().find(project => project.projectId === projectId)?.currentRevision ?? -1
  const reviseReportPages=async(projectId:string,revision:number,findings:readonly import('./report/delivery-contract.ts').ReportAcceptanceFinding[],parent:Agent,signal:AbortSignal)=>{
    const input=await frozenProjectSource(projectId,revision,true,parent),root=reportWorkspaceRoot(projectId)
    const caseFindings=findings.filter(f=>f.pageId?.startsWith('case-study-'))
    if(caseFindings.length)throw new ReportPageRejected(caseFindings.map(f=>({...f,message:`${f.message}；请修订该真实案例的来源记录、对应图片或案例页面布局；业务正文改写不能解决此项。`})),'REPORT_CASE_PAGE_REJECTED')
    const draft=await manuscripts.load(input,root)
    if(!draft)throw new Error('REPORT_MANUSCRIPT_REQUIRED')
    const mapped=findings.map(f=>{
      if(draft.chapters.some(c=>c.pages.some(p=>p.id===f.pageId)))return f
      const chapter=input.manuscript?.chapters.find(c=>c.pages.some(p=>p.id===f.pageId))
        ??(f.pageId==='cover'?draft.chapters.find(c=>c.id==='positioning'):undefined)
      return {...f,pageId:draft.chapters.find(c=>c.id===chapter?.id)?.pages[0]?.id}
    })
    if(mapped.some(f=>!f.pageId))throw new Error('REPORT_REVISION_PAGE_UNRESOLVED')
    const guard=async()=>{signal.throwIfAborted();if(currentReportRevision(projectId)!==revision)throw new Error('REPORT_REVISION_CHANGED');await assertFrozenReportCurrent(input)}
    await manuscripts.revise({...input,manuscript:draft},draft,mapped,root,parent,signal,guard)
    await prepareManuscript(projectId,revision,parent,signal)
  }
  const conditionalReports = new ConditionalReportPackageService({
    acceptance:reportAcceptance,
    revisePages:async(projectId,revision,findings,signal,options)=>{
      const parent=reportParents.get(projectId);if(!parent)throw new Error('REPORT_REVIEW_PARENT_REQUIRED')
      await reviseReportPages(projectId,revision,findings,parent,signal)
      await prepareVisuals(projectId,revision,parent,signal,options)
    },
    onState:updateDelivery,
    formats: ['html'],
    requireManuscript: true,
    requireCaseStudies: true,
    governance, packageRoot: reportPackageRoot, browserExecutable: resolveBrowserExecutable(),
    source: async (projectId, revision) => frozenProjectSource(projectId, revision, true),
    assertSourceCurrent: assertFrozenReportCurrent,
    materials: prepareReportMaterials,
    currentRevision: currentReportRevision, completionScheme: 'research-v210',
    isComplete: async projectId => (await reportResearch(projectId, false)).status === 'ready', now,
  })
  const reportErrors = new Map<string, string>()
  const completeVisuals = createAutomaticVisualCompletion({ pageVisualFill,
    prepareImageQuality: async (input, parent, signal, assertCurrent, maxGenerations) => { await reportImagePipeline.prepare(input.frozenProject, input.workspaceRoot, parent, signal, assertCurrent, { maxGenerations }) },
    assertCurrent: (projectId, revision, parent) => {
      const current = repository.readContext(String(parent.id))
      if (current.project.projectId !== projectId || current.project.currentRevision !== revision) throw new Error('VISUAL_SOURCE_CHANGED')
      automation.requireValid(projectId, revision)
    },
    input: async (projectId, revision) => {
      const binding = standardProjects.findByPreDesignProjectId(projectId)
      const workspaceRoot = binding?.workspaceRoot ?? binding?.directoryRoot
      if (!workspaceRoot) throw new Error('VISUAL_WORKSPACE_REQUIRED: 请先绑定汇报工作区')
      return { frozenProject: await frozenProjectSource(projectId, revision, true), workspaceRoot, previous: binding }
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
  const prepareVisuals: typeof completeVisuals = async (projectId, revision, parent, signal, options) => {
    reportParents.set(projectId,parent)
    await updateDelivery(projectId,revision,'generating','正在准备与页面结论对应的图像和空间表达。')
    try{
    for(let round=0;;round++){
      const input = await frozenProjectSource(projectId, revision, true, parent)
      try{await completeVisuals(projectId, revision, parent, signal, options);await assertFrozenReportCurrent(input);break}
      catch(error){
        if(!(error instanceof ReportPageRejected)||round>=2)throw error
        await updateDelivery(projectId,revision,'generating','地形方案未通过可复算检查，正在修订对应空间页面。')
        await reviseReportPages(projectId,revision,error.findings,parent,signal)
      }
    }
    }catch(error){await updateDelivery(projectId,revision,'failed','图文准备或独立审图未完成；具体缺口已记录。');throw error}
  }
  const publishReportStatus = createReportStatusPublisher({ commands: ctx.commands, repository, reportErrors })
  const completeReport = createAutomaticReportCompletion({
    reports: conditionalReports, repository, prepareManuscript, prepareVisuals,
    publishStatus: publishReportStatus,
  })
  const coordinator = new AutomationCoordinator(runtime, parallel, completeReport, publishReportStatus)
  // Web routes are an optional adapter; SDK workers load the same domain core.
  ctx.inject(['webServer', 'workspaceRegistry'], webCtx => {
    webCtx.effect(() => registerReportDownloadRoute(webCtx.webServer, reportPackageRoot))
    webCtx.effect(() => registerAgentClassRoute(webCtx.webServer, {
      classes: agentClasses, repository, sessions: agentClassSessions,
      routeForSession: (id) => {
        const parent = ctx.get('agents')?.get(id as never)
        return parent ? parentRoute(parent) : undefined
      },
    }))
    webCtx.effect(() => registerWorkspaceOpenRoute(webCtx.webServer, {
      get: id => ctx.sessions.get(id as never),
    }, Reflect.get(webCtx, 'workspaceRegistry')))
  })
  ctx.effect(() => async () => {
    await agentClasses.close()
    await presentationSync.close()
    await presentationBindings.close()
    await governance.close()
    await repository.close()
  })
  const researchWorkspaceBinding = (projectId: string) => {
    return establishedResearchWorkspace(standardProjects.findByPreDesignProjectId(projectId))
  }
  const nativeModuleRuntime = createNativeModuleRuntime({ subagents, agentClasses, attachments: ctx.attachments, readNativeEvents: persistedChildEvents,
    synthesizeGroups:true,progressReview:true,objectGroupAuthorIds:['6.01','7.02','7.04'] })
  const moduleResearch = createModuleResearchCommands({
    onComplete: (parent, projectId, signal) => completeReport(projectId,signal,parent),
    prepareSources: (parent, request, onProgress) => acquireModuleWebCorpus(parent, request, { web: webQuery, onProgress }),
    readContext: sessionId => repository.readContext(sessionId), resolveBinding: researchWorkspaceBinding,
    now: () => new Date(), runtime: { execute: async (parent, request, options) => {
      const binding = reportResearchBinding(request.projectId)
      if (!binding) throw new Error('REPORT_MODULE_BINDING')
      const selectedPlan = request.moduleIds ? controlledResearchPlan({ moduleIds: request.moduleIds, flags: request.flags }) : undefined
      const coversReport = !selectedPlan || selectedPlan.requestedModuleIds.length === selectedPlan.activeModuleIds.length
        && selectedPlan.activeModuleIds.every(id => selectedPlan.requestedModuleIds.includes(id))
      const selection = coversReport
        ? await beginReportResearchSelection(binding, request, { parentId: String(parent.id), statements: sessionStatements(parent) }) : undefined
      if (!coversReport) await invalidateReportResearchSelection(binding)
      const summary = await nativeModuleRuntime.execute(parent, request, options)
      if (selection && (summary.status === 'completed'||controlledResearchReady(summary))) await acceptReportResearchSelection(binding, selection, summary, moduleSourceDependencies)
      return summary
    } },
  })
  for (const command of moduleResearch.commands) ctx.commands.register(command)
  registerPreplanningCommands(ctx, {
    researchWorkspaceBinding,
    researchProgress: projectId => moduleResearch.progress(projectId),
    unifiedResearch: {
      run: invocation => moduleResearch.commands.find(command => command.name === 'preplan-research-run')!.handler({ ...invocation, rawInput: invocation.rawInput?.trim() || '--all-modules' }),
      pause: invocation => moduleResearch.commands.find(command => command.name === 'preplan-research-cancel')!.handler(invocation),
    },
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
    prepareChapter,
    prepareVisuals,
    reportErrors,
    reportDelivery,
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
    reportDelivery,
    researchWorkspaceBinding,
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
  async function withExistingResearch<T>(parent: Agent, signal: AbortSignal, action: (projectId: string, revision: number) => Promise<T>): Promise<T> {
    signal.throwIfAborted()
    const { project } = repository.readContext(String(parent.id))
    await reportResearch(project.projectId, true, parent)
    if (controlledReportProjects.has(project.projectId)) throw new Error('REPORT_ALREADY_RUNNING')
    controlledReportProjects.add(project.projectId)
    try { return await action(project.projectId, project.currentRevision) }
    finally { controlledReportProjects.delete(project.projectId) }
  }
  ctx.provide('preplanning', Object.freeze({
    subagents,
    research: moduleResearch,
    reportAccess: {
      chapterProductionDirectory,
      status: (projectId: string) => reportResearch(projectId, false),
      generate: (parent: Agent, signal: AbortSignal) => withExistingResearch(parent, signal, async (projectId, revision) => {
        await prepareManuscript(projectId, revision, parent, signal)
        await prepareVisuals(projectId, revision, parent, signal, { maxGenerations: 0 })
        return conditionalReports.generate(projectId, revision, signal, { maxGenerations: 0 })
      }),
      chapter: (parent: Agent, chapterId: import('./report/manuscript/types.ts').PlanningChapterId,
        stage: 'write' | 'review' | 'revise' | `production-${import('./report/chapter-production.ts').ChapterProductionStage}`, signal: AbortSignal) =>
        withExistingResearch(parent, signal, (projectId, revision) => prepareChapter(projectId, revision, parent, signal, chapterId, stage)),
    },
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
