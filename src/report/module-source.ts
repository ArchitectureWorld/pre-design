import { randomUUID } from 'node:crypto'
import { lstat, mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MaterialCorpus, MaterialCorpusDocument } from '../materials/research-evidence.ts'
import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { loadPlanningCatalog } from '../research-v2/catalog.ts'
import { projectResearchPlan } from '../research-v2/planning.ts'
import { createResearchReadCache, readResearchFile, researchWorkspaceRoot } from '../research-v2/run-store.ts'
import { verifyModuleSourceValues } from '../research-v2/module-claims.ts'
import { readModuleExecutionSummary, type ModuleExecutionRequest, type ModuleExecutionResult, type ModuleExecutionSummary, type ModuleNativeExecutionReceipt, type ModuleSourceValue } from '../research-v2/module-execution.ts'
import type { ResearchFlags } from '../research-v2/types.ts'
import type { ClassExecution } from '../agent-classes/types.ts'
import { matchesModelRoute } from '../agent-classes/model-options.ts'
import type { SessionStatement } from '../runtime/material-research-intake.ts'
import { DEFAULT_REPORT_DELIVERY_CONTRACT } from './delivery-contract.ts'
import { assertModuleAcquisition, replayModuleWebCorpus, verifyModuleWebNative } from '../research-v2/module-web-acquisition.ts'
import { moduleReviewIsCurrent } from '../research-v2/module-execution.ts'
import {controlledResearchReady,type ResearchProgress} from '../research-v2/module-progress-review.ts'
import {verifyModuleNativeSubmission} from '../research-v2/module-group-recovery.ts'

export interface ReportResearchBinding { readonly projectId: string; readonly workspaceRoot: string; readonly standardProjectId: string }
export interface ReportResearchSelection {
  readonly version: 'report-module-selection.v1'; readonly selectionId: string; readonly binding: ReportResearchBinding
  readonly parentId: string; readonly snapshotId: string; readonly snapshotRoot: string; readonly flags: ResearchFlags; readonly expectedModuleIds: readonly string[]
  readonly corpusFingerprint: string; readonly taskBriefHash: string; readonly catalogHash: string; readonly planHash: string
  readonly statementKeys: readonly string[]; readonly manifestRunId?: string
}
export interface FrozenModuleResearch {
  readonly researchProgress?:ResearchProgress
  readonly deliveryMode?:'reviewed'|'conditional'
  readonly documents?: readonly Pick<MaterialCorpusDocument, 'path' | 'contentHash' | 'provenance'>[]
  readonly selectionId: string; readonly manifestRunId: string; readonly snapshotId: string; readonly snapshotHash: string
  readonly catalogHash: string; readonly planHash: string; readonly corpusFingerprint: string; readonly taskBrief: string
  readonly expectedModuleIds: readonly string[]; readonly results: readonly ModuleExecutionResult[]
  readonly moduleRuns: ModuleExecutionSummary['moduleRuns']; readonly limitations: readonly string[]; readonly fingerprint: string
}
export type ReportModuleResearchLoad = { readonly status: 'not_requested' }
  | { readonly status: 'not_ready'; readonly selection: ReportResearchSelection }
  | { readonly status: 'ready'; readonly selection: ReportResearchSelection; readonly research: FrozenModuleResearch }
export interface ReportModuleSourceDependencies { readonly executions: (projectId: string) => Promise<readonly ClassExecution[]>; readonly now?:()=>Date;
  readonly readEvents?: (childId: string) => Promise<readonly { type: string; data: unknown }[] | undefined> }
interface Snapshot { corpus: MaterialCorpus; sourceValues: readonly ModuleSourceValue[]; flags: ResearchFlags; taskBrief?: string }
const fail = (code: string, detail = ''): never => { throw new Error(`${code}${detail ? ': ' + detail : ''}`) }
const equal = (a: unknown, b: unknown) => sha256CanonicalJson(a) === sha256CanonicalJson(b)
const statementKey = (statement: SessionStatement) => sha256CanonicalJson(statement)
const locks = new Map<string, Promise<unknown>>()
async function lock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(work)
  locks.set(key, next)
  try { return await next } finally { if (locks.get(key) === next) locks.delete(key) }
}
function relativeFile(projectId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/u.test(projectId)) fail('REPORT_MODULE_PROJECT_ID')
  return `.pre-design/report-research/${projectId}/selection.json`
}
async function canonicalBinding(binding: ReportResearchBinding): Promise<ReportResearchBinding> {
  relativeFile(binding.projectId)
  if (!binding.standardProjectId?.trim()) fail('REPORT_MODULE_BINDING')
  return { ...binding, workspaceRoot: await researchWorkspaceRoot(binding.workspaceRoot) }
}
async function selectionAt(binding: ReportResearchBinding): Promise<ReportResearchSelection | undefined> {
  try {
    const value = JSON.parse(await readResearchFile(binding.workspaceRoot, relativeFile(binding.projectId))) as ReportResearchSelection
    if (value.version !== 'report-module-selection.v1' || !value.selectionId || !value.parentId || !value.snapshotId
      || !Array.isArray(value.expectedModuleIds) || !Array.isArray(value.statementKeys) || !equal(value.binding, binding)) fail('REPORT_MODULE_BINDING')
    return value
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
async function saveSelection(selection: ReportResearchSelection): Promise<void> {
  const root = selection.binding.workspaceRoot
  let directory = root
  for (const part of relativeFile(selection.binding.projectId).split('/').slice(0, -1)) {
    directory = join(directory, part)
    try { await mkdir(directory) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const stat = await lstat(directory)
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('REPORT_MODULE_PATH')
  }
  const temporary = join(directory, `.selection-${randomUUID()}.json`)
  await writeFile(temporary, JSON.stringify(selection) + '\n', { flag: 'wx' })
  await researchWorkspaceRoot(directory)
  await rename(temporary, join(directory, 'selection.json'))
}
/** A partial rerun makes the earlier complete report stale, while immutable module bundles stay available for explicit recomposition. */
export async function invalidateReportResearchSelection(binding: ReportResearchBinding): Promise<void> {
  const canonical = await canonicalBinding(binding)
  await lock(canonical.workspaceRoot + '\0' + canonical.projectId, async () => {
    const current = await selectionAt(canonical)
    if (!current) return
    const { manifestRunId: _accepted, ...selection } = current
    await saveSelection({ ...selection, selectionId: randomUUID() })
  })
}

export async function beginReportResearchSelection(binding: ReportResearchBinding, request: ModuleExecutionRequest,
  options: { readonly parentId: string; readonly statements?: readonly SessionStatement[] }): Promise<ReportResearchSelection> {
  const canonical = await canonicalBinding(binding)
  if (request.projectId !== canonical.projectId || await researchWorkspaceRoot(request.workspaceRoot) !== canonical.workspaceRoot || !options.parentId.trim()) fail('REPORT_MODULE_BINDING')
  const catalog = loadPlanningCatalog(), plan = projectResearchPlan(catalog, request.flags)
  if (request.moduleIds !== undefined && (request.moduleIds.length !== plan.activeModuleIds.length
    || new Set(request.moduleIds).size !== request.moduleIds.length || request.moduleIds.some(id => !plan.activeModuleIds.includes(id)))) fail('REPORT_MODULE_FULL_RUN_REQUIRED')
  if (plan.pendingModuleIds.length || plan.blockedModuleIds.length || !plan.activeModuleIds.length) fail('REPORT_MODULE_CONDITIONS_REQUIRED')
  const selection: ReportResearchSelection = { version: 'report-module-selection.v1', selectionId: randomUUID(), binding: canonical,
    parentId: options.parentId, snapshotId: request.snapshotId, snapshotRoot: request.workspaceRoot, flags: structuredClone(request.flags), expectedModuleIds: [...plan.activeModuleIds],
    corpusFingerprint: request.corpus.fingerprint, taskBriefHash: sha256CanonicalJson(request.taskBrief ?? ''), catalogHash: catalog.hash, planHash: plan.hash,
    statementKeys: (options.statements ?? []).map(statementKey) }
  await lock(canonical.workspaceRoot + '\0' + canonical.projectId, () => saveSelection(selection))
  return selection
}
async function verifyNative(summary: ModuleExecutionSummary, selection: ReportResearchSelection, executions: readonly ClassExecution[],readEvents:ReportModuleSourceDependencies['readEvents']):Promise<void> {
  const byId = new Map(executions.map(row => [row.id, row]))
  const used = new Set<string>()
  function receipt(value: ModuleNativeExecutionReceipt, classId: 'text' | 'review', result: ModuleExecutionResult) {
    const actual = byId.get(value.executionId)
    if (!actual || used.has(value.executionId) || actual.projectId !== summary.projectId || actual.parentId !== selection.parentId
      || actual.classId !== classId || actual.status !== 'completed' || actual.childId !== value.childId
      || !actual.task.startsWith(result.itemId + ' ') || !actual.actual || !matchesModelRoute(actual.actual, value.actualModel)
      || actual.childStopReason !== 'completed' || value.stopReason !== 'completed') fail('REPORT_MODULE_NATIVE_UNVERIFIED', result.itemId)
    used.add(value.executionId)
  }
  for (const result of summary.results) {
    const execution = result.execution
    if (!execution || !execution.reviewReceipts?.length) fail('REPORT_MODULE_NATIVE_UNVERIFIED', result.itemId)
    const authors = execution!.kind === 'author-field-groups-v3' ? execution!.authorGroups.groups.map(group => group.receipt) : [execution!]
    if (!authors.length) fail('REPORT_MODULE_NATIVE_UNVERIFIED', result.itemId)
    for (const author of authors) receipt(author, 'text', result)
    if(execution!.synthesis){
      receipt(execution!.synthesis.execution,'text',result)
      const events=await readEvents?.(execution!.synthesis.execution.childId)
      if(!events)fail('REPORT_MODULE_SYNTHESIS_NATIVE_UNVERIFIED')
      verifyModuleNativeSubmission(events!,execution!.synthesis.execution.actualModel,execution!.synthesis.judgment)
    }
    // The reader verifies the accepted candidate against the final review. Earlier failed reviews do not establish acceptance.
    receipt(execution!.reviewReceipts!.at(-1)!, 'review', result)
  }
  for(const review of summary.researchProgress?.reviews??[]){
    const anchor=summary.results.find(result=>result.itemId===review.binding.resultRefs.at(-1)?.itemId)
    if(!anchor)fail('REPORT_PROGRESS_NATIVE_UNVERIFIED')
    receipt(review.execution,'review',anchor!)
    if(!byId.get(review.execution.executionId)!.task.includes('progress-review'))fail('REPORT_PROGRESS_NATIVE_UNVERIFIED')
    const events=await readEvents?.(review.execution.childId)
    if(!events)fail('REPORT_PROGRESS_NATIVE_UNVERIFIED')
    verifyModuleNativeSubmission(events!,review.execution.actualModel,review.decision)
    const schemaBound=events!.some(e=>e.type==='request/header'&&((e.data as any)?.header?.tools??[]).some((tool:any)=>
      tool.name==='structured_output'&&tool.parameters?.properties?.requestHash?.const===review.binding.requestHash))
    if(!schemaBound)fail('REPORT_PROGRESS_NATIVE_UNVERIFIED')
  }
}
async function verified(binding: ReportResearchBinding, selection: ReportResearchSelection, manifestRunId: string,
  dependencies: ReportModuleSourceDependencies, readSummary = readModuleExecutionSummary): Promise<FrozenModuleResearch> {
  const summary = await readSummary(binding.workspaceRoot, manifestRunId)
  if (summary.results.some(result => !moduleReviewIsCurrent(result))) fail('REPORT_MODULE_REVIEW_VERSION', '研究需要按当前来源、图件与专业审查要求重新验收；历史回执保留。')
  const dated=JSON.parse(await readResearchFile(binding.workspaceRoot,`research/runs/${manifestRunId}/run.json`,64 * 1024 * 1024)) as {createdAt?:string}
  const age=(dependencies.now?.()??new Date()).getTime()-Date.parse(dated.createdAt??'')
  if(!Number.isFinite(age)||age < -86400000||age>DEFAULT_REPORT_DELIVERY_CONTRACT.researchValidityDays*86400000)fail('REPORT_MODULE_EXPIRED','研究审查结果已超出复用期，请按当前来源重新研究；历史原件仍保留。')
  if (summary.projectId !== binding.projectId || summary.snapshotId !== selection.snapshotId || summary.catalogHash !== selection.catalogHash
    || summary.planHash !== selection.planHash || !equal(summary.plan.flags, selection.flags)) fail('REPORT_MODULE_SNAPSHOT_CHANGED')
  const expected = [...selection.expectedModuleIds].sort(), catalog = loadPlanningCatalog(), plan = projectResearchPlan(catalog, selection.flags)
  const controlled=controlledResearchReady(summary)
  if (catalog.hash !== selection.catalogHash || !equal([...plan.activeModuleIds].sort(), expected) || summary.status !== 'completed'&&!controlled
    || !equal([...summary.selectedModuleIds].sort(), expected) || !equal(summary.results.map(row => row.itemId).sort(), expected)
    || !equal(summary.moduleRuns.filter(row => row.status === 'completed'||controlled&&row.status==='limited').map(row => row.itemId).sort(), expected)
    || summary.moduleRuns.length !== expected.length) fail('REPORT_MODULE_COVERAGE_INCOMPLETE')
  const snapshot = JSON.parse(await readResearchFile(binding.workspaceRoot, `research/runs/${manifestRunId}/snapshot.json`, 64 * 1024 * 1024)) as Snapshot
  if (sha256CanonicalJson(snapshot) !== summary.snapshotHash || snapshot.corpus.fingerprint !== selection.corpusFingerprint
    || !equal(snapshot.flags, selection.flags) || sha256CanonicalJson(snapshot.taskBrief ?? '') !== selection.taskBriefHash) fail('REPORT_MODULE_SNAPSHOT_CHANGED')
  const corpus = await replayModuleWebCorpus(binding.workspaceRoot, snapshot.corpus, { now: dependencies.now?.() })
  assertModuleAcquisition(corpus, expected)
  if (corpus.fingerprint !== selection.corpusFingerprint || sha256CanonicalJson({ ...snapshot, corpus }) !== summary.snapshotHash) fail('REPORT_MODULE_SOURCE_CHANGED', '原始资料与研究冻结快照不一致，请重新研究。')
  // Exact request binding plus the frozen brief avoids invalidating a run merely because /export was added to the conversation.
  if (await researchWorkspaceRoot(selection.snapshotRoot) !== binding.workspaceRoot) fail('REPORT_MODULE_SNAPSHOT_BINDING')
  const context = { projectId: binding.projectId, root: selection.snapshotRoot, standardProjectId: binding.standardProjectId }
  if (`snapshot-${sha256CanonicalJson({ context, fingerprint: corpus.fingerprint, flags: snapshot.flags, taskBrief: snapshot.taskBrief })}` !== summary.snapshotId) fail('REPORT_MODULE_SNAPSHOT_BINDING')
  for (const result of summary.results) verifyModuleSourceValues(corpus, result.sourceValues)
  if (!controlled&&summary.results.some(result => result.execution?.reviewReceipts?.at(-1)?.checks.some(check => check.status !== 'pass'))) fail('REPORT_MODULE_QA_INCOMPLETE')
  const executions = await dependencies.executions(binding.projectId)
  await verifyNative(summary, selection, executions,dependencies.readEvents)
  await verifyModuleWebNative(binding.workspaceRoot, corpus, binding.projectId, selection.parentId, executions, dependencies.readEvents)
  const core = { selectionId: selection.selectionId, manifestRunId, snapshotId: summary.snapshotId, snapshotHash: summary.snapshotHash,
    catalogHash: summary.catalogHash, planHash: summary.planHash, corpusFingerprint: corpus.fingerprint, taskBrief: snapshot.taskBrief ?? '',
    documents: corpus.documents.map(({ path, contentHash, provenance }) => ({ path, contentHash, ...(provenance ? { provenance } : {}) })),
    expectedModuleIds: expected, results: summary.results, moduleRuns: summary.moduleRuns, limitations: summary.limitations,
    deliveryMode:summary.moduleRuns.some(row=>row.status==='limited')?'conditional' as const:'reviewed' as const,
    ...(summary.researchProgress?{researchProgress:summary.researchProgress}:{}) }
  return { ...core, fingerprint: sha256CanonicalJson(core) }
}
export async function acceptReportResearchSelection(binding: ReportResearchBinding, selection: ReportResearchSelection,
  summary: ModuleExecutionSummary, dependencies: ReportModuleSourceDependencies): Promise<void> {
  const canonical = await canonicalBinding(binding)
  if (!equal(canonical, selection.binding)) fail('REPORT_MODULE_BINDING')
  if ((await selectionAt(canonical))?.selectionId !== selection.selectionId) fail('REPORT_MODULE_SELECTION_CHANGED')
  await verified(canonical, selection, summary.manifestRunId, dependencies)
  await lock(canonical.workspaceRoot + '\0' + canonical.projectId, async () => {
    if ((await selectionAt(canonical))?.selectionId !== selection.selectionId) fail('REPORT_MODULE_SELECTION_CHANGED')
    await saveSelection({ ...selection, manifestRunId: summary.manifestRunId })
  })
}
async function loadResearch(binding: ReportResearchBinding, dependencies: ReportModuleSourceDependencies, readSummary = readModuleExecutionSummary): Promise<ReportModuleResearchLoad> {
  const canonical = await canonicalBinding(binding), selection = await selectionAt(canonical)
  if (!selection) return { status: 'not_requested' }
  if (!selection.manifestRunId) return { status: 'not_ready', selection }
  const research = await verified(canonical, selection, selection.manifestRunId, dependencies, readSummary)
  if (!equal(await selectionAt(canonical), selection)) fail('REPORT_MODULE_SELECTION_CHANGED')
  return { status: 'ready', selection, research }
}
export function loadReportModuleResearch(binding: ReportResearchBinding, dependencies: ReportModuleSourceDependencies): Promise<ReportModuleResearchLoad> {
  return loadResearch(binding, dependencies)
}
/** Share the expensive deterministic replay across report checkpoints. Source
 * files, native receipts, selection, corpus and age are still checked on every call. */
export function createReportModuleResearchLoader(dependencies: ReportModuleSourceDependencies): (binding: ReportResearchBinding) => Promise<ReportModuleResearchLoad> {
  const cached = createResearchReadCache<ModuleExecutionSummary>()
  const readSummary: typeof readModuleExecutionSummary = (root, runId) => cached(root + '\0' + runId, () => readModuleExecutionSummary(root, runId))
  const running = new Map<string, Promise<ReportModuleResearchLoad>>()
  return binding => {
    const key = sha256CanonicalJson(binding), active = running.get(key)
    if (active) return active
    // Concurrent guards join this exact in-flight verification. Once it settles,
    // the next guard rechecks originals, native receipts and validity as before.
    const pending = loadResearch(binding, dependencies, readSummary).finally(() => {
      if (running.get(key) === pending) running.delete(key)
    })
    running.set(key, pending)
    return pending
  }
}
export function assertReportResearchReady(load: ReportModuleResearchLoad): void {
  if (load.status === 'not_requested') fail('REPORT_MODULES_REQUIRED', '完整策划报告必须先建立适用研究计划并完成独立核验。')
  if (load.status === 'not_ready') fail('REPORT_MODULES_INCOMPLETE', `新版研究待完成：当前冻结快照要求 ${load.selection.expectedModuleIds.length} 项完整审查结果。`)
}
export function assertReportTaskUnchanged(load: ReportModuleResearchLoad, statements: readonly SessionStatement[]): void {
  if (load.status === 'not_requested') return
  const known = new Set(load.selection.statementKeys)
  const procedural = (text: string) => {
    const command = text.trim()
    if (/[\r\n]/u.test(command)) return false
    return /^\/preplan-(?:status|research-status|research-cancel|pause|run)$/u.test(command)
      || /^\/preplan-export(?:[\t ]+--reuse-images)?$/u.test(command)
      || /^\/preplan-mode[\t ]+(?:manual|automatic)(?:[\t ]+(?:[0-9]|1[0-9]|20)(?:[\t ]+(?:standard|extended))?)?$/u.test(command)
  }
  if (statements.some(row => !known.has(statementKey(row)) && !procedural(row.text))) {
    fail('REPORT_MODULE_TASK_CHANGED', '当前报告仍绑定已冻结研究任务；发现新的用户任务消息，请按当前任务重新运行全量研究。')
  }
}
export async function assertReportResearchUnchanged(binding: ReportResearchBinding, fingerprint: string | undefined, dependencies: ReportModuleSourceDependencies): Promise<void> {
  const load = await loadReportModuleResearch(binding, dependencies)
  assertReportResearchReady(load)
  if ((load.status === 'ready' ? load.research.fingerprint : undefined) !== fingerprint) fail('REPORT_MODULE_SELECTION_CHANGED')
}
