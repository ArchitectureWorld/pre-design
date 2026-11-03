import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { captureMaterialCorpus } from '../materials/research-evidence.ts'
import { sessionStatements } from '../runtime/material-research-intake.ts'
import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { boundResearchContext, type RegionalCommandDependencies } from './regional-command.ts'
import type { ModuleExecutionRequest, ModuleExecutionSummary, ModuleRunEntry } from './module-execution.ts'
import { readModuleExecutionSummary, readModuleExecutionResult } from './module-execution.ts'
import { CONDITION_FIELDS, type ResearchFlags } from './types.ts'
import { deliveryContractPrompt } from '../report/delivery-contract.ts'
import { loadPlanningCatalog } from './catalog.ts'
import { projectResearchPlan } from './planning.ts'
import { replayModuleWebCorpus, validateModuleWebRefresh, moduleWebQueries, assertModuleAcquisition, type ModuleWebRefresh, type ModuleWebSourceRequest, type ModuleSourceRecovery } from './module-web-acquisition.ts'
import type { MaterialCorpus } from '../materials/research-evidence.ts'
import { readResearchFile } from './run-store.ts'
import { planModuleReviewRecovery } from './module-recovery-feedback.ts'
import {controlledResearchReady,type ProgressReviewReceipt} from './module-progress-review.ts'

interface NativeModuleRuntime {
  execute(parent: Agent, request: ModuleExecutionRequest, options?: {
    readonly onProgress?: (entry: ModuleRunEntry) => void | Promise<void>
    readonly onProgressReview?: (receipt:ProgressReviewReceipt) => void | Promise<void>
    readonly assertCurrent?: () => void | Promise<void>
  }): Promise<ModuleExecutionSummary>
}
interface RunState {
  readonly controller: AbortController
  snapshotId: string
  readonly flags: ResearchFlags
  readonly startedAt: string
  readonly entries: ModuleRunEntry[]
  readonly reviseModuleIds?: readonly string[]
  promise: Promise<void>
  status: 'running' | 'completed' | 'partial' | 'cancelled' | 'failed'
  result?: ModuleExecutionSummary
  error?: string
  acquisition?: { key: string; status: string }
  latestProgressReview?:ProgressReviewReceipt
}
function parse(raw: string) {
  const flags: ResearchFlags = {}, seen = new Set<string>()
  let all = false, item: string | undefined, resume: string[] | undefined, refreshQuery: string | undefined, sourceHints: string[] | undefined
  let reviewOnly=false
  let reviseModuleIds: string[] | undefined
  for (const token of raw.trim().split(/\s+/u).filter(Boolean)) {
    if (token === '--all-modules' && !all) { all = true; continue }
    const match = /^--([A-Za-z]+)=(\S+)$/u.exec(token)
    if (!match || seen.has(match[1])) throw new Error('MODULE_COMMAND_INVALID')
    const [, key, value] = match; seen.add(key)
    if(key==='reviewOnly'&&['true','false'].includes(value)){reviewOnly=value==='true';continue}
    if(key==='revise'){
      const ids=value.split(',')
      if(ids.length<=62&&new Set(ids).size===ids.length&&ids.every(id=>/^[1-8]\.0[1-9]$/u.test(id))){reviseModuleIds=ids;continue}
      throw new Error('MODULE_REVISION_TARGET_INVALID')
    }
    if (key === 'item' && /^[1-8]\.0[1-9]$/u.test(value)) { item = value; continue }
    if (key === 'resume') {
      const ids = value.split(',')
      // One current coordinator plus one immutable source bundle per module.
      if (ids.length <= 63 && new Set(ids).size === ids.length && ids.every(id => /^RUN-[a-f0-9-]{36}$/u.test(id))) { resume = ids; continue }
    }
    if (key === 'refreshQuery') { refreshQuery = value; continue }
    if (key === 'sourceHints') { sourceHints = value.split(','); continue }
    if (!(CONDITION_FIELDS as readonly string[]).includes(key) || !['true', 'false'].includes(value)) throw new Error('MODULE_COMMAND_INVALID')
    flags[key as keyof ResearchFlags] = value === 'true'
  }
  if (all && Object.keys(flags).length) throw new Error('MODULE_COMMAND_AMBIGUOUS_FLAGS')
  if (all) for (const field of CONDITION_FIELDS) flags[field] = true
  if (CONDITION_FIELDS.some(field => typeof flags[field] !== 'boolean')) throw new Error('MODULE_CONDITIONS_REQUIRED: 明确四项条件，或使用 --all-modules 测试全部条件分支；条件不代表现场事实。')
  if (sourceHints && !refreshQuery) throw new Error('MODULE_WEB_HINTS_REQUIRE_REFRESH')
  if (resume && refreshQuery) throw new Error('MODULE_WEB_REFRESH_REQUIRES_NEW_SNAPSHOT: 刷新来源不能同时恢复旧快照结果；原审计记录保留，新快照须重新研究与审查。')
  if(reviewOnly&&(!item||!resume||refreshQuery))throw new Error('MODULE_REVIEW_TARGET_REQUIRED: 直接新独审须指定 --item 和原检查点 --resume，且保持原输入。')
  if(reviseModuleIds&&(!resume||reviewOnly||(item&&(reviseModuleIds.length!==1||reviseModuleIds[0]!==item))))throw new Error('MODULE_REVISION_TARGET_INVALID: 指定返修须提供 --resume，不能同时使用 --reviewOnly；与 --item 并用时只能返修同一目标。')
  const refresh: ModuleWebRefresh | undefined = refreshQuery ? { queryKey: refreshQuery, sourceHints: sourceHints ?? [] } : undefined
  return { flags, item, resume, refresh, reviewOnly, reviseModuleIds }
}

async function checkpointModuleReview(root: string, runId: string, itemId: string) {
  try {
    const previous = await readModuleExecutionSummary(root, runId)
    return { projectId: previous.projectId, review: previous.results.find(result => result.itemId === itemId)?.execution?.reviewReceipts?.at(-1) }
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'MODULE_RUN_MANIFEST_EXPECTED') throw error
    const previous = await readModuleExecutionResult(root, runId)
    return { projectId: previous.projectId, review: previous.itemId === itemId ? previous.execution?.reviewReceipts?.at(-1) : undefined }
  }
}

/** Starts native execution and exposes its durable bundle receipts without changing old workflow states. */
export function createModuleResearchCommands(dependencies: RegionalCommandDependencies & { readonly runtime: NativeModuleRuntime;
  readonly onComplete?: (parent: Agent, projectId: string, signal: AbortSignal) => Promise<void>;
  readonly prepareSources?: (parent: Agent, request: ModuleWebSourceRequest, onProgress: (key: string, status: string) => void) => Promise<MaterialCorpus> }) {
  const runs = new Map<string, RunState>()
  const pending = new Set<string>()
  const fail = (error: unknown) => ({ kind: 'error' as const, text: error instanceof Error ? error.message : 'MODULE_EXECUTION_FAILED' })
  const commands: CommandDefinition[] = [
    {
      name: 'preplan-research-run', description: '实际执行新版62项研究、验证字段来源与计算、保存逐模块审计结果',
      input: { hint: '--all-modules 或 --industryPlanning=true|false --existingBuildings=... --externalPartners=... --marketing=... [--item=1.01] [--resume=RUN-…[,RUN-…]（先最新协调器、后同快照成果，最多63份）] [--revise=1.06[,1.07]（指定返修；与--item并用时仅同一目标）] 或 --refreshQuery=1.05:2 --sourceHints=HTTPS网址,HTTPS网址' },
      handler: async invocation => {
        let starting: string | undefined
        let run: RunState | undefined
        let settle: (() => void) | undefined
        let detach: (() => void) | undefined
        try {
          const options = parse(invocation.rawInput ?? '')
          const plan = projectResearchPlan(loadPlanningCatalog(), options.flags)
          const selected = new Set(options.item ? [options.item] : plan.activeModuleIds)
          for (let changed = true; changed;) { changed = false; for (const edge of plan.edges) if (selected.has(edge.target) && !selected.has(edge.source)) { selected.add(edge.source); changed = true } }
          if (options.refresh) {
            validateModuleWebRefresh(options.refresh, [...selected])
            if (!dependencies.prepareSources) throw new Error('MODULE_WEB_REFRESH_UNAVAILABLE')
          }
          const context = await boundResearchContext(invocation, dependencies)
          // This runner consumes original files and its own module DAG, not legacy
          // state objects. A legacy commit cannot invalidate these frozen inputs.
          const bindingIdentity = ({ projectId, root, standardProjectId }: typeof context) => ({ projectId, root, standardProjectId })
          if (pending.has(context.projectId) || runs.get(context.projectId)?.status === 'running') return { kind: 'success', text: '新版研究任务已在运行；/preplan-research-status 查看实际进度。' }
          starting = context.projectId; pending.add(starting)
          const controller = new AbortController()
          const cancel = () => controller.abort(invocation.signal.reason)
          invocation.signal?.addEventListener('abort', cancel, { once: true })
          detach = () => invocation.signal?.removeEventListener('abort', cancel)
          if (invocation.signal?.aborted) cancel()
          run = { controller, snapshotId: 'preparing', flags: options.flags, ...(options.reviseModuleIds?{reviseModuleIds:options.reviseModuleIds}:{}), startedAt: dependencies.now().toISOString(), entries: [], promise: new Promise<void>(resolve => { settle = resolve }), status: 'running' }
          runs.set(context.projectId, run)
          const original = await captureMaterialCorpus(context.root, { signal: controller.signal })
          controller.signal.throwIfAborted()
          if (!original.documents.length) throw new Error('MODULE_ORIGINAL_SOURCE_REQUIRED')
          const fullBrief = [
            deliveryContractPrompt(),
            '当前只执行分配的研究模块，其结论、来源与计算将关联到完整报告；不得代写或宣称其他模块完成。',
            '当前绑定项目：' + context.projectId + '。条件开关仅界定研究分支，不证明现场已有建筑、产业或合作方，也不授予批准。',
            '以下是真实用户消息的任务背景；其中测试假设保持假设。它们不是原始资料事实，不得伪装 sourceValues 或外部批准。',
            ...sessionStatements(invocation.agent).map(row => JSON.stringify({ sessionId: row.sessionId, seq: row.seq, time: row.time, text: row.text })),
          ].join('\n')
          let taskBrief = fullBrief.length > 20_000 ? fullBrief.slice(0, 19_900) + '\n[任务背景超过输入上限；后续消息未包含，不可据此推断额外授权或事实。]' : fullBrief
          const activeRun = run
          // Acquisition can take minutes. Publish the running state immediately, retaining cancellation and duplicate guards.
          const execute = async () => {
          const priorSnapshot = options.resume ? JSON.parse(await readResearchFile(context.root, `research/runs/${options.resume[0]}/snapshot.json`, 64 * 1024 * 1024)) as { corpus: MaterialCorpus; taskBrief?: string } : undefined
          const priorCorpus = priorSnapshot?.corpus
          const replayed = priorCorpus ? await replayModuleWebCorpus(context.root, priorCorpus, { signal: controller.signal }) : undefined
          // A normal full continuation keeps its verified frozen sources and
          // limited QA. Source correction is explicit; otherwise every resume
          // can replace the snapshot and force already reviewed work to repeat.
          // Missing or failed required queries are still acquired below.
          const previousPeer = options.item === '3.04' && !options.reviewOnly && replayed ? await checkpointModuleReview(context.root, options.resume![0], '3.04') : undefined
          if (previousPeer && previousPeer.projectId !== context.projectId) throw new Error('MODULE_CHECKPOINT_PROJECT_MISMATCH')
          const limitedPeerReview = previousPeer?.review?.checks.some(check => check.status === 'limited') ? previousPeer.review : undefined
          const reviewRecovery = limitedPeerReview ? planModuleReviewRecovery('3.04', limitedPeerReview) : undefined
          const missingProductQueries = options.item === '3.05' && replayed
            ? moduleWebQueries(['3.05']).filter(query => {
              const found = replayed.acquisition?.queries.filter(row => row.key === query.key) ?? []
              return found.length !== 1 || found[0].status === 'failed'
            }).map(query => query.key) : []
          let sourceRecovery: ModuleSourceRecovery | undefined
          if (reviewRecovery?.queryKeys.length || missingProductQueries.length) {
            if (!dependencies.prepareSources) throw new Error('MODULE_WEB_RECOVERY_UNAVAILABLE: 本模块须按缺查询或独审问题原生补采后建立新快照。')
            if (limitedPeerReview) sourceRecovery = { checkpoint: options.resume![0], moduleId: '3.04',
              queryKeys: reviewRecovery!.queryKeys, reason: 'independent-review-source-gaps', review: structuredClone(limitedPeerReview) }
            else {
              const previous = await checkpointModuleReview(context.root, options.resume![0], '3.05')
              if (previous.projectId !== context.projectId) throw new Error('MODULE_CHECKPOINT_PROJECT_MISMATCH')
              sourceRecovery = { checkpoint: options.resume![0], moduleId: '3.05', queryKeys: missingProductQueries,
                ...(previous.review ? { review: structuredClone(previous.review) } : {}) }
            }
          }
          const missingRequiredSources = replayed && !options.item && moduleWebQueries([...selected]).some(query => {
            const found = replayed.acquisition?.queries.filter(row => row.key === query.key) ?? []
            return found.length !== 1 || found[0].status === 'failed'
          })
          const corpus = replayed && !sourceRecovery && !missingRequiredSources ? replayed : dependencies.prepareSources ? await dependencies.prepareSources(invocation.agent,
            { workspaceRoot: context.root, projectId: context.projectId, corpus: original, moduleIds: [...selected], signal: controller.signal,
              ...(sourceRecovery ? { sourceRecovery } : {}), ...(options.refresh ? { refresh: options.refresh } : {}) },
            (key, status) => { activeRun.acquisition = { key, status } }) : original
          if (sourceRecovery) {
            assertModuleAcquisition(corpus, [sourceRecovery.moduleId])
            if (corpus.fingerprint === replayed?.fingerprint) throw new Error('MODULE_WEB_RECOVERY_UNCHANGED: 补采仍返回旧资料，不能重做同一无进展作者修订。')
          }
          // Ordinary recovery must retain the exact hash-bound task context,
          // including any earlier source-recovery review issues. Rebuilding the
          // brief would change snapshot identity and discard valid checkpoints.
          if (replayed && typeof priorSnapshot?.taskBrief === 'string') taskBrief = priorSnapshot.taskBrief
          const snapshotId = `snapshot-${sha256CanonicalJson({ context: bindingIdentity(context), fingerprint: corpus.fingerprint, flags: options.flags, taskBrief })}`
          activeRun.snapshotId = snapshotId
          return dependencies.runtime.execute(invocation.agent, { workspaceRoot: context.root, projectId: context.projectId,
            snapshotId, corpus, taskBrief, flags: options.flags, ...(options.item ? { moduleIds: [options.item] } : {}),
            ...(options.resume ? { resumeRunIds: options.resume } : {}), ...(options.reviseModuleIds?{reviseModuleIds:options.reviseModuleIds}:{}), ...(options.reviewOnly?{reviewOnly:true}:{}), ...((sourceRecovery || options.refresh || missingRequiredSources) ? { allowInputReuse: true } : {}), signal: activeRun.controller.signal }, {
            onProgress: entry => { activeRun.entries.push(structuredClone(entry)) },
            onProgressReview:receipt=>{activeRun.latestProgressReview=structuredClone(receipt)},
            assertCurrent: async () => {
              const current = await boundResearchContext(invocation, dependencies)
              if (sha256CanonicalJson(bindingIdentity(current)) !== sha256CanonicalJson(bindingIdentity(context))) throw new Error('MODULE_PROJECT_SNAPSHOT_CHANGED')
              if ((await replayModuleWebCorpus(context.root, corpus, { signal: controller.signal })).fingerprint !== corpus.fingerprint) throw new Error('MODULE_SOURCE_SNAPSHOT_CHANGED')
            },
          })
          }
          void execute().then(async result => {
            activeRun.result = result; activeRun.status = result.status
            if(!options.item && (result.status==='completed'||controlledResearchReady(result))) await dependencies.onComplete?.(invocation.agent,context.projectId,controller.signal)
          }).catch(error => {
            activeRun.status = controller.signal.aborted ? 'cancelled' : 'failed'
            activeRun.error = error instanceof Error ? error.message : 'MODULE_EXECUTION_FAILED'
          }).finally(() => { detach?.(); settle?.() })
          return { kind: 'success', text: `已启动新版研究实际执行；检索和原文快照准备完成后进入模块分析。\n${options.item ? `目标 ${options.item} 及其依赖。` : '执行全部已启用模块。'}\n${options.refresh ? `刷新查询 ${options.refresh.queryKey}，建立新资料快照；旧快照研究不自动计入，新结果须重新独立审查。\n` : ''}条件只界定本次研究分支，不能证明现状事实或项目审批。\n/preplan-research-status 查看进度；/preplan-research-cancel 取消。` }
        } catch (error) {
          if (run) { run.status = run.controller.signal.aborted ? 'cancelled' : 'failed'; run.error = error instanceof Error ? error.message : 'MODULE_EXECUTION_FAILED' }
          detach?.(); settle?.(); return fail(error)
        } finally { if (starting) pending.delete(starting) }
      },
    },
    {
      name: 'preplan-research-status', description: '查看当前新版研究实际执行状态和可复核审计包',
      handler: async invocation => {
        try {
          const context = await boundResearchContext(invocation, dependencies), run = runs.get(context.projectId)
          if (!run) return { kind: 'success', text: '当前宿主没有活动的新版研究执行。已保存的 research/runs 审计包仍保留；使用 --resume=RUN-… 验证并恢复。' }
          return { kind: 'success', text: JSON.stringify({ status: run.status, startedAt: run.startedAt, snapshotId: run.snapshotId, flags: run.flags, reviseModuleIds:run.reviseModuleIds,
            acquisition: run.acquisition, modules: run.result?.moduleRuns ?? run.entries, manifestRunId: run.result?.manifestRunId, limitations: run.result?.limitations,
            researchProgress:run.result?.researchProgress??(run.latestProgressReview?{everyModules:3,afterStep:run.latestProgressReview.binding.afterStep,
              reason:run.latestProgressReview.binding.reason,decision:run.latestProgressReview.decision,receiptHash:run.latestProgressReview.hash}:undefined),error: run.error }, null, 2) }
        } catch (error) { return fail(error) }
      },
    },
    {
      name: 'preplan-research-cancel', description: '取消当前新版研究；保留已核验模块及失败/取消记录',
      handler: async invocation => {
        try {
          const context = await boundResearchContext(invocation, dependencies), run = runs.get(context.projectId)
          if (run?.status !== 'running') return { kind: 'success', text: '当前没有正在运行的新版研究任务。' }
          run.controller.abort(new Error('MODULE_USER_CANCELLED'))
          return { kind: 'success', text: '已提交取消；正在结束的子会话不会被标为完成。' }
        } catch (error) { return fail(error) }
      },
    },
  ]
  return { commands, progress: (projectId: string) => {
    const run = runs.get(projectId), flags = run?.flags ?? Object.fromEntries(CONDITION_FIELDS.map(field => [field, true])) as ResearchFlags
    const plan = projectResearchPlan(loadPlanningCatalog(), flags)
    const entries = new Map((run?.result?.moduleRuns ?? run?.entries ?? []).map(entry => [entry.itemId, entry]))
    const chapters = Array.from({length:8}, (_,i) => { const ids=plan.activeModuleIds.filter(id=>id.startsWith(String(i+1)+'.'))
      return {id:String(i+1).padStart(2,'0'), total:ids.length, completed:ids.filter(id=>entries.get(id)?.status==='completed').length, gateStatus:ids.length && ids.every(id=>entries.get(id)?.status==='completed')?'approved':'pending'} })
    const next=plan.waves.flat().find(id=>!entries.has(id))
    const blockers=[...entries.values()].filter(row=>['limited','failed','blocked','cancelled'].includes(row.status)).map(row=>({workflowId:'research-v210',workItemId:row.itemId,reason:row.error?.match(/^[A-Z_]+/u)?.[0]??('独立研究待完成：'+row.status)}))
    return {scheme:'research-v210' as const, stage:run?.acquisition?.key ?? next ?? '新版研究'+(run?.status??'待启动'), blockers, status:run?.status ?? 'idle', total:plan.activeModuleIds.length, qualified:chapters.reduce((sum,row)=>sum+row.completed,0), chapters}
  }, whenIdle: async (projectId: string) => { await runs.get(projectId)?.promise } }
}
