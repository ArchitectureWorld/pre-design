// The private Unix socket accepts business operations, never caller supplied commands.
import { createServer } from 'node:http'
import { chmod, readFile, unlink, realpath, appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { validateSnapshot } from '../app/src/model-policy.mjs'
import { RESEARCH_CONDITIONS, validateResearchSelection, validateReportSelection, validateReportSnapshot, publicBusinessData, researchError } from '../app/src/research-contract.mjs'
import { installProjectBoundary } from './project-boundary.mjs'
import { installModelBoundary } from './model-runtime.mjs'
import { installSearchBoundary } from './search-runtime.mjs'
import { installImageTool } from './image-tool.mjs'
import { ComfyUIClient, compileFlux3Workflow } from './comfyui-client.mjs'
import { createResearchSummary, listProjectArtifacts, researchCheckpoints } from './research-artifacts.mjs'
import { collectExecutionTrace } from './execution-trace.mjs'
import { recordResearchRequest } from './research-request.mjs'
import { checkpointCompatibility } from './research-checkpoint.mjs'
import { prepareChapter, chapterPreflight, chapterReadiness } from './chapter-setup.mjs'

export const name = 'pre-design-web-bridge'
export const inject = ['preplanning', 'commands', 'agents', 'tools', 'llm', 'web', 'attachments']
function success(result) {
  const value = result?.result ?? result
  if (value?.kind !== 'success') {
    const message = typeof value?.text === 'string' ? value.text : 'CORE_OPERATION_FAILED'
    throw researchError(message.match(/^[A-Z][A-Z0-9_]+/u)?.[0] ?? 'CORE_OPERATION_FAILED', message, 409)
  }
  return value
}
export function createBridgeHandler(ctx, { workspace, sessionId, snapshot, callerUserId, imageAvailability, searchAvailability }) {
  let mutation = false, report = { status: 'idle', artifacts: [] }, reportController
  const context = () => ctx.preplanning.repository.readContext(sessionId)
  const research = () => {
    if (!ctx.preplanning.research?.run) throw researchError('RESEARCH_RUNTIME_UNAVAILABLE', '新版研究核心尚未装配。', 503)
    return ctx.preplanning.research
  }
  const status = async () => ({ ...research().status(context().project.projectId), results: await listProjectArtifacts(workspace) })
  const deliveryStatus = () => ctx.preplanning.reportAccess?.status?.(context().project.projectId)
  const chapterOptions = () => ({productionDirectory:(chapterId,request)=>{
    const resolver=ctx.preplanning.reportAccess?.chapterProductionDirectory
    if (typeof resolver !== 'function') throw researchError('CHAPTER_PRODUCTION_DIRECTORY_UNAVAILABLE','章节生产目录服务尚未装配。',503)
    const {project}=context()
    return resolver(workspace,{projectId:project.projectId,projectName:project.name},chapterId,request)
  }})
  const resume = async (selection,agent) => {
    const checkpoints=(await researchCheckpoints(workspace,context().project.projectId)).filter(row=>RESEARCH_CONDITIONS.every(key=>row.plan?.flags?.[key] === selection.flags[key]))
    const newest=checkpoints[0], compatibility=newest ? await checkpointCompatibility(workspace,newest,agent) : {compatible:false,reason:'no_checkpoint'}
    return {newest,compatibility,resumeRunIds:compatibility.compatible ? checkpoints.filter(row=>row.snapshotId === newest.snapshotId).map(row=>row.manifestRunId).slice(0,63) : []}
  }
  const command = async text => {
    const agent = ctx.agents.get(sessionId)
    if (!agent) throw researchError('SESSION_NOT_READY')
    return success(await ctx.commands.execute(agent, text, [], AbortSignal.timeout(60000)))
  }
  async function handle(input) {
    const keys = { create: ['name'], state: [], sync: [], confirm: ['proposalId', 'baseRevision'], 'research-plan': ['selection'], 'research-status': [], 'research-run': ['selection','jobId'], 'research-cancel': [], 'report-status': [], 'report-run': ['selection'], 'report-preflight':['selection'], 'chapter-prepare':['chapterId','message','feedback','assets'], 'execution-trace': ['since'] }
    if (!input || !Object.hasOwn(keys, input.operation) || Object.keys(input).some(key => key !== 'operation' && !keys[input.operation].includes(key))) throw researchError('OPERATION_FORBIDDEN')
    const agent = ctx.agents.get(sessionId)
    if (!agent) throw researchError('SESSION_NOT_READY')
    if (input.jobId !== undefined && (typeof input.jobId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/u.test(input.jobId))) throw researchError('JOB_ID_INVALID')
    if (input.operation === 'execution-trace') return collectExecutionTrace(agent, ctx.preplanning.agentClasses, context().project.projectId, { since: input.since })
    if (input.operation === 'research-status') return status()
    if (input.operation === 'research-cancel') {
      success(research().cancel(context().project.projectId))
      reportController?.abort(new Error('REPORT_USER_CANCELLED'))
      return status()
    }
    if (input.operation === 'report-status') {
      const delivery = await deliveryStatus()
      return { ...report, ...(delivery ? { delivery: { status: delivery.status, expectedModuleIds: delivery.selection?.expectedModuleIds ?? [] } } : {}), chapters:await chapterReadiness(workspace,delivery,chapterOptions()), artifacts: await listProjectArtifacts(workspace) }
    }
    if (input.operation === 'report-preflight') return chapterPreflight(workspace,input.selection,await deliveryStatus(),chapterOptions())
    if (input.operation === 'research-plan') {
      const selection = validateResearchSelection(input.selection ?? { moduleIds: [], flags: {} }, { planning: true })
      const catalog = research().catalog()
      const plan = selection.moduleIds.length ? research().plan({ moduleIds: selection.moduleIds, flags: selection.flags })
        : JSON.parse((await command(`/preplan-research-plan --json ${RESEARCH_CONDITIONS.map(key => `--${key}=${selection.flags[key]}`).join(' ')}`)).text)
      const checkpoint=await resume(selection,agent)
      return { catalog: { hash: catalog.hash, chapters: catalog.chapters, modules: catalog.modules.map(row => ({ id: row.id, moduleId: row.moduleId, title: row.title, when: row.when, deliverables: [...row.figures, row.table] })) }, plan,
        continuation:{mode:checkpoint.compatibility.compatible?'resume':'new-snapshot',reason:checkpoint.compatibility.reason ?? 'unchanged',
          message:checkpoint.compatibility.compatible?'将核验并复用同一快照成果。':'将建立新研究快照；旧成果保留，未选前置模块不会自动执行。'},
        selection: { moduleIds: selection.moduleIds, dependencyModuleIds: plan.dependencyModuleIds ?? [], executionModuleIds: selection.moduleIds },
        availability: { image: imageAvailability ?? { status: 'not_ready', code: 'IMAGE_POLICY_NOT_READY' },
          web: { fetch: 'available', search: searchAvailability?.status === 'ready' ? 'configured' : searchAvailability?.status ?? 'not_ready', ...searchAvailability }, models: { status: snapshot ? 'configured' : 'not_ready' } } }
    }
    if (input.operation === 'state') return { ...context(), workflow: ctx.preplanning.runtime.snapshot(context().project.projectId) }
    if (mutation) throw researchError('BRIDGE_BUSY', '项目正在处理上一项操作。', 409)
    mutation = true
    try {
      if (input.operation === 'create') {
        if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120 || /[\r\n]/u.test(input.name)) throw researchError('NAME_INVALID')
        const projects = ctx.preplanning.repository.listProjects()
        if (projects.length > 1) throw researchError('PROJECT_SCOPE_INVALID')
        if (!projects.length) await command(`/preplan-new ${input.name}`)
        else { if (projects[0].name !== input.name) throw researchError('PROJECT_NAME_CONFLICT'); await command(`/preplan-open ${projects[0].projectId}`) }
        await command('/preplan-presentation-sync')
      } else if (input.operation === 'chapter-prepare') {
        if (report.status === 'running' || research().status(context().project.projectId).status === 'running') throw researchError('CHAPTER_SETUP_BUSY','项目存在运行中的任务。',409)
        const {operation:_operation,...selection}=input
        const result=await prepareChapter(workspace,selection,{callerUserId})
        return {...result,readiness:{...await chapterPreflight(workspace,{chapterId:selection.chapterId,stage:'production-plan'},await deliveryStatus(),chapterOptions()),nextStage:'production-plan'}}
      } else if (input.operation === 'confirm') {
        const current = context()
        if (current.project.currentRevision !== input.baseRevision) throw researchError('REVISION_CONFLICT', '项目版本已变化。', 409)
        if (typeof input.proposalId !== 'string' || !/^[A-Za-z0-9._-]+$/u.test(input.proposalId) || !current.proposals.some(p => p.proposalId === input.proposalId && p.status === 'pending_review')) throw researchError('PROPOSAL_NOT_PENDING')
        await command(`/preplan-confirm ${input.proposalId}`)
        await command('/preplan-presentation-sync')
      } else if (input.operation === 'sync') await command('/preplan-presentation-sync')
      else if (input.operation === 'research-run') {
        const selection = validateResearchSelection(input.selection)
        validateSnapshot(snapshot, ['parent', 'text', 'web'])
        const projectId = context().project.projectId
        if (research().status(projectId).status === 'running' || report.status === 'running') throw researchError('RESEARCH_ALREADY_RUNNING', 'RESEARCH_ALREADY_RUNNING', 409)
        const plan = research().plan({ moduleIds: selection.moduleIds, flags: selection.flags })
        const {newest,compatibility,resumeRunIds}=await resume(selection,agent)
        if (selection.redo && newest && !compatibility.compatible) throw researchError('MODULE_REDO_INPUT_CHANGED','原始资料或任务背景已变化，不能在旧快照单模块重做。请明确选择新快照所需模块范围；旧成果保留。',409,{reason:compatibility.reason})
        if (selection.redo && !resumeRunIds.length) throw researchError('MODULE_REDO_CHECKPOINT_REQUIRED', '所选模块尚无可重放的研究检查点。', 409)
        if (plan.missingDependencies?.length && !resumeRunIds.length) throw researchError('MODULE_DEPENDENCIES_REQUIRED', `请显式选择所需前置模块：${plan.missingDependencies.join('、')}`, 409, { missingDependencies: plan.missingDependencies })
        await recordResearchRequest(ctx, agent, selection, resumeRunIds,{callerUserId,jobId:input.jobId})
        success(await research().run(agent, { moduleIds: selection.moduleIds, flags: selection.flags,
          ...(resumeRunIds.length ? { resumeRunIds } : {}), ...(selection.redo ? { reviseModuleIds: selection.moduleIds } : {}) }, new AbortController().signal))
        return status()
      } else if (input.operation === 'report-run') {
        const selection = validateReportSelection(input.selection)
        if (report.status === 'running' || research().status(context().project.projectId).status === 'running') throw researchError('REPORT_ALREADY_RUNNING', 'REPORT_ALREADY_RUNNING', 409)
        if (selection.mode === 'research-summary') return createResearchSummary(workspace, selection, context().project.projectId)
        const preflight=await chapterPreflight(workspace,selection,await deliveryStatus(),chapterOptions())
        if (!preflight.ready) throw researchError(preflight.blockers[0].code,preflight.blockers[0].message,409,{blockers:preflight.blockers})
        validateReportSnapshot(snapshot,selection)
        if (!ctx.preplanning.reportAccess?.chapter) throw researchError('REPORT_RUNTIME_UNAVAILABLE', '章节报告服务尚未装配。', 503)
        reportController = new AbortController()
        const controller = reportController
        report = { status: 'running', chapterId: selection.chapterId, stage: selection.stage }
        void Promise.resolve().then(() => ctx.preplanning.reportAccess.chapter(agent, selection.chapterId, selection.stage, controller.signal))
          .then(result => { controller.signal.throwIfAborted(); report = { ...report, status: 'completed', message: typeof result === 'string' ? result : result?.text } })
          .catch(error => { report = { ...report, status: controller.signal.aborted ? 'cancelled' : 'failed', error: String(error.message ?? 'REPORT_FAILED') } })
        return report
      }
      return { ...context(), workflow: ctx.preplanning.runtime.snapshot(context().project.projectId) }
    } finally { mutation = false }
  }
  return async input => {
    const result = await handle(input)
    // The private socket is server-owned. This narrowly projected diagnostic is
    // consumed only by executionTrace(), never by an end-user operation route.
    return input.operation === 'execution-trace' ? result : publicBusinessData(result, [workspace])
  }
}

export async function apply(ctx) {
  const socket = process.env.PRE_WEB_SOCKET, secret = process.env.PRE_WEB_BRIDGE_SECRET, sessionId = process.env.PRE_WEB_SESSION_ID
  const workspace = await realpath(process.env.PRE_WEB_WORKSPACE ?? '')
  if (!socket || !secret || !sessionId || !process.env.PRE_WEB_POLICY_FILE) throw new Error('WEB_BRIDGE_CONFIG_MISSING')
  const policy = JSON.parse(await readFile(process.env.PRE_WEB_POLICY_FILE, 'utf8'))
  await installSearchBoundary(ctx, { searchPolicy: policy.searchPolicy, availability: policy.searchAvailability,
    onAudit: entry => appendFile(join(dirname(process.env.PRE_WEB_POLICY_FILE), 'search-audit.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 }) })
  if (policy.imageBackend) {
    const backend = policy.imageBackend
    await installImageTool(ctx, { workspace, sessionId, policy, backend: {
      client: new ComfyUIClient({ ...backend, headers: backend.credentialEnv ? { Authorization: `Bearer ${process.env[backend.credentialEnv]}` } : {} }),
      compileWorkflow: compileFlux3Workflow,
    } })
  }
  installProjectBoundary(ctx, { sessionId, workspace })
  await installModelBoundary(ctx, { sessionId, ...policy })
  const handle = createBridgeHandler(ctx, { workspace, sessionId, ...policy, callerUserId:process.env.PRE_WEB_CALLER_USER_ID })
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8')
    const supplied = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${secret}`)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401).end('{}'); return }
    if (req.method !== 'POST' || req.url !== '/') { res.writeHead(404).end('{}'); return }
    try {
      let raw = ''
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 131072) throw researchError('BODY_LIMIT') }
      res.end(JSON.stringify(await handle(JSON.parse(raw))))
    } catch (error) {
      res.writeHead(error.statusCode ?? 400).end(JSON.stringify(publicBusinessData({ error: String(error.message).slice(0, 2000), code: error.code, details: error.details }, [workspace])))
    }
  })
  server.requestTimeout = 65000
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve) })
  await chmod(socket, 0o600)
  ctx.effect(() => async () => {
    try { ctx.preplanning.research.cancel(ctx.preplanning.repository.readContext(sessionId).project.projectId) } catch { /* The session may not yet exist. */ }
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await unlink(socket).catch(error => { if (error.code !== 'ENOENT') throw error })
  })
  ctx.provide('preplanningWebBridgeReady', true)
}
