import { agentOptionsForRoute } from '../../agent-classes/model-options.ts'
import { createHash, randomUUID } from 'node:crypto'
import { renameSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { nextAgentClassAttempt, type AgentClassService } from '../../agent-classes/service.ts'
import type { FrozenProjectInput } from '../types.ts'
import { buildPlanningChapterPrompt, buildPlanningChapterClosing, planningChapterSources, planningChapterTitle, planningChapterOutputSchema, PLANNING_CHAPTER_SOURCE_CONTRACT, PLANNING_WRITER_PERSONA,PLANNING_AUTHORING_CONTRACT,PLANNING_CONTEXT_CONTRACT } from './prompts.ts'
import { makeSourceIndex, manuscriptSourceFingerprint } from './source.ts'
import { PLANNING_CHAPTER_IDS, PLANNING_MANUSCRIPT_POLICY_VERSION, PLANNING_MANUSCRIPT_SCHEMA_VERSION,
  type PlanningChapterId, type PlanningManuscript, type PlanningManuscriptChapter, type PlanningManuscriptSource } from './types.ts'
import { validatePlanningChapter, validatePlanningManuscript } from './validation.ts'
import { renderPlanningManuscriptMarkdown, renderPlanningManuscriptEvidence } from './markdown.ts'
import { clientCopyText, clientPlanningPage, clientPlanningManuscript } from './client-copy.ts'
import { DEFAULT_REPORT_DELIVERY_CONTRACT, inspectReportCoverage, type ReportAcceptanceFinding } from '../delivery-contract.ts'
import { sha256CanonicalJson as hash } from '../../presentation/canonical-json.ts'
import {verifyModuleNativeSubmission} from '../../research-v2/module-group-recovery.ts'
import type {SessionEventLike} from '../../visual/session-image-collector.ts'
import { assertApprovedChapterBrief, assertChapterFollowsPlan, buildApprovedChapterPrompt, normalizeApprovedChapterMetadata, type ApprovedChapterBrief, type ChapterDraftRecord } from '../chapter-plan.ts'
import { REPORT_DESIGN_RULES } from '../design-rules.ts'
import { CHAPTER_DIAGRAM_CONTRACT, chapterDiagramFeedback } from '../chapter-diagram-feedback.ts'

type AssertCurrent = () => void | Promise<void>
export interface PlanningManuscriptServiceOptions {
  readonly subagents: Pick<SubagentRuntime, 'getProvider' | 'start'>
  readonly agentClasses: Pick<AgentClassService, 'begin' | 'attach' | 'finish'> & Partial<Pick<AgentClassService, 'fallback' | 'modelLimits' | 'execution'>>
  readonly readEvents?:(id:string)=>Promise<readonly SessionEventLike[]>
  readonly now?: () => string
  readonly maxConcurrency?: number | (() => number)
  readonly timeoutMs?: number
  readonly editor?: {
    readonly version: string
    edit(draft: PlanningManuscript, input: FrozenProjectInput, root: string, parent: Agent, signal: AbortSignal, assertCurrent: AssertCurrent, correctionsAvailable: number): Promise<PlanningManuscript>
  }
}

export function resolveManuscriptConcurrency(value?: number | (() => number)): number {
  const requested = typeof value === 'function' ? value() : value ?? 3
  if (!Number.isInteger(requested) || requested < 1 || requested > 5) throw new Error('MANUSCRIPT_CONCURRENCY_INVALID: 并发必须为1到5。')
  return requested
}
type AttemptStatus = 'reserved' | 'running' | 'completed' | 'failed' | 'cancelled' | 'recovery_required'
interface Attempt {
  id: string
  status: AttemptStatus
  startedAt: string
  executionId?: string
  childId?: string
  completedAt?: string
  errorCode?: string
  validationFeedback?: string
  validationCorrection?: boolean
  sourceContractVersion?: string
  sourceContractRepair?: boolean
  authoringContractVersion?: string
  authoringContractRepair?: boolean
  contextContractVersion?: string
  contextContractRepair?: boolean
  diagramContractVersion?: string
  diagramContractRepair?: boolean
  stopReason?: string
  outputTokenLimit?: number
  contextWindow?: number
  returnedContent?: unknown
  recoveredFromAttempt?:string
  metadataNormalization?: { rawHash: string; normalizedHash: string; changes: import('../chapter-plan.ts').ChapterMetadataChange[] }
}
interface ChapterCheckpoint { attempts: Attempt[]; chapter?: PlanningManuscriptChapter
  contextRepair?: { version:string; previousAttemptId:string; chapter:PlanningManuscriptChapter }
}
interface Checkpoint {
  schemaVersion: 'pre-design.planning-manuscript-checkpoint.v1'
  policyVersion: string
  projectId: string
  sourceRevision: number
  sourceFingerprint: string
  correctionsUsed: number
  chapters: Partial<Record<PlanningChapterId, ChapterCheckpoint>>
}
const MANUSCRIPT_FILE = 'report-manuscript.json'
const contentError = /^MANUSCRIPT_(?:SHAPE|AUDIENCE|PRODUCT|TABLE|CHAPTER_ID|PAGE_ID|PAGE_KIND|VISUAL|VISUAL_SOURCE|DIAGRAM|SOURCE)(?=:)/u
const MAX_CORRECTIONS = 2

async function optionalText(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
function parse(text: string, kind: string): unknown {
  try { return JSON.parse(text) as unknown } catch { throw new Error(`MANUSCRIPT_${kind}_INVALID: 持久化文件不是有效JSON。`) }
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Validate every operation used by the display migration before touching cached JSON. */
function cacheShape(value: unknown, path: string, code: string): Record<string, unknown> {
  const row = object(value)
  if (!row) throw new Error(`${code}: 缓存结构损坏（${path}）。`)
  return row
}
function cacheText(value: unknown, path: string, code: string): void {
  if (typeof value !== 'string') throw new Error(`${code}: 缓存文字结构损坏（${path}）。`)
}
function cacheList(value: unknown, path: string, code: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${code}: 缓存列表结构损坏（${path}）。`)
  return value
}
function cacheTexts(value: unknown, path: string, code: string): void {
  cacheList(value, path, code).forEach((text, i) => cacheText(text, `${path}[${i}]`, code))
}
function assertCachedChapterShape(value: unknown, path: string, code: string): asserts value is PlanningManuscriptChapter {
  const chapter = cacheShape(value, path, code)
  for (const key of ['title', 'thesis']) cacheText(chapter[key], `${path}.${key}`, code)
  cacheList(chapter.pages, `${path}.pages`, code).forEach((value, index) => {
    const at = `${path}.pages[${index}]`, page = cacheShape(value, at, code)
    for (const key of ['title', 'claim']) cacheText(page[key], `${at}.${key}`, code)
    for (const key of ['body', 'notes']) cacheTexts(page[key], `${at}.${key}`, code)
    const visual = cacheShape(page.visual, `${at}.visual`, code)
    for (const key of ['subject', 'purpose', 'caption']) cacheText(visual[key], `${at}.visual.${key}`, code)
    if (page.product !== undefined) {
      for (const [key, text] of Object.entries(cacheShape(page.product, `${at}.product`, code))) cacheText(text, `${at}.product.${key}`, code)
    }
    if (page.table !== undefined) {
      const table = cacheShape(page.table, `${at}.table`, code)
      cacheTexts(table.columns, `${at}.table.columns`, code)
      cacheList(table.rows, `${at}.table.rows`, code).forEach((row, i) => cacheTexts(row, `${at}.table.rows[${i}]`, code))
    }
    if (visual.diagram !== undefined) {
      const diagram = cacheShape(visual.diagram, `${at}.visual.diagram`, code)
      for (const kind of ['nodes', 'edges']) cacheList(diagram[kind], `${at}.visual.diagram.${kind}`, code).forEach((entry, i) => {
        const item = cacheShape(entry, `${at}.visual.diagram.${kind}[${i}]`, code)
        if (kind === 'nodes' || item.label !== undefined) cacheText(item.label, `${at}.visual.diagram.${kind}[${i}].label`, code)
      })
    }
  })
}

export function migrateCachedPlanningChapter(value: unknown, code = 'MANUSCRIPT_CHECKPOINT_INVALID'): PlanningManuscriptChapter {
  assertCachedChapterShape(value, 'chapter', code)
  return { ...value, title: clientCopyText(value.title), thesis: clientCopyText(value.thesis), pages: value.pages.map(page=>clientPlanningPage(page)) }
}

export function migrateCachedPlanningManuscript(value: unknown, code = 'MANUSCRIPT_CACHE_INVALID'): PlanningManuscript {
  const row = cacheShape(value, 'manuscript', code)
  cacheText(row.title, 'manuscript.title', code)
  cacheList(row.chapters, 'manuscript.chapters', code).forEach((chapter, index) => assertCachedChapterShape(chapter, `manuscript.chapters[${index}]`, code))
  if (row.editorial !== undefined) cacheShape(row.editorial, 'manuscript.editorial', code)
  return clientPlanningManuscript(value as PlanningManuscript)
}
async function atomicJson(path: string, value: unknown, guard?: AssertCurrent): Promise<void> {
  return atomicDocuments([{ path, text: `${JSON.stringify(value, null, 2)}\n` }], guard)
}
async function atomicDocuments(documents: readonly { path: string; text: string }[], guard?: AssertCurrent): Promise<void> {
  const pending = documents.map(document => ({ ...document, temporary: `${document.path}.tmp-${randomUUID()}` }))
  try {
    for (const document of pending) {
      await mkdir(dirname(document.path), { recursive: true })
      await writeFile(document.temporary, document.text, { flag: 'wx' })
    }
    await guard?.()
    // No asynchronous gap between the final cancellation/revision check and adoption.
    for (const document of pending) renameSync(document.temporary, document.path)
  } finally { await Promise.all(pending.map(document => rm(document.temporary, { force: true }))) }
}
function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolvePromise, reject) => {
    const abort = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { cleanup(); resolvePromise(value) }, error => { cleanup(); reject(error) })
  })
}

export class PlanningManuscriptService {
  private readonly chapterRunning = new Map<string, { fingerprint: string; signal: AbortSignal; promise: Promise<ChapterDraftRecord> }>()
  private readonly running = new Map<string, { fingerprint: string; signal: AbortSignal; promise: Promise<PlanningManuscript> }>()
  private readonly now: () => string
  private get maxConcurrency(): number { return resolveManuscriptConcurrency(this.dependencies.maxConcurrency) }
  constructor(private readonly dependencies: PlanningManuscriptServiceOptions) {
    this.now = dependencies.now ?? (() => new Date().toISOString())
    resolveManuscriptConcurrency(dependencies.maxConcurrency)
  }

  /** A semantic rejection changes authored content; accepted peer chapters stay intact. */
  async revise(input: FrozenProjectInput, draft: PlanningManuscript, findings: readonly ReportAcceptanceFinding[], workspaceRoot: string,
    agent: Agent, signal: AbortSignal, assertCurrent: AssertCurrent, stage: import('./revision-budget.ts').ReportRevisionStage = 'content'): Promise<PlanningManuscript> {
    const root = resolve(workspaceRoot), key = `${root}\0${input.projectId}`
    if (this.running.has(key)) throw new Error('MANUSCRIPT_REVISION_BUSY')
    const fingerprint = manuscriptSourceFingerprint(input)
    const promise = this.reviseOnce(input, draft, findings, root, agent, signal, assertCurrent, stage).finally(() => {
      if (this.running.get(key)?.promise === promise) this.running.delete(key)
    })
    this.running.set(key, { fingerprint, signal, promise })
    return promise
  }

  private async reviseOnce(input: FrozenProjectInput, draft: PlanningManuscript, findings: readonly ReportAcceptanceFinding[], root: string,
    agent: Agent, signal: AbortSignal, assertCurrent: AssertCurrent, stage: import('./revision-budget.ts').ReportRevisionStage,
    recovery?:import('./revision-budget.ts').ReportRevisionRecovery): Promise<PlanningManuscript> {
    const guard = async () => { signal.throwIfAborted(); await assertCurrent(); signal.throwIfAborted() }
    await guard(); validatePlanningManuscript(draft, input)
    const selected = draft.chapters.filter(c => findings.some(f => c.pages.some(p => p.id === f.pageId)
      || f.requirementId && DEFAULT_REPORT_DELIVERY_CONTRACT.requirements.find(r => r.id === f.requirementId)?.chapters.includes(c.id)))
    if (!selected.length) throw new Error('MANUSCRIPT_REVISION_RESEARCH_REQUIRED: 问题未定位到文稿页面，需先修订对应研究。')
    const fingerprint = manuscriptSourceFingerprint(input), revisionKey = hash(JSON.parse(JSON.stringify({ draft, findings })))
    const folder = join(root, '.pre-design/report-manuscript-revisions', fingerprint)
    const {reserveReportRevision} = await import('./revision-budget.ts')
    await reserveReportRevision(root,folder,draft,revisionKey,stage,(path,value)=>atomicJson(path,value,guard),recovery)
    const sources = makeSourceIndex(input), path = join(folder, revisionKey, 'chapters.json')
    const checkpoint = await this.readCheckpoint(path, input, sources)
    const persist = (check?: AssertCurrent) => atomicJson(path, checkpoint, check)
    // Finance owns shared scenario parameters. Resolve it before dependent
    // summaries, while keeping the report's presentation order unchanged.
    const ordered=input.deliveryContract?[...selected].sort((a,b)=>Number(b.id==='operation')-Number(a.id==='operation')):selected
    for (const chapter of ordered) {
      const row = checkpoint.chapters[chapter.id]
      // Legacy prompts omitted peer tables, quantities and scope. Only reopen
      // saved non-finance chapters that actually authored a competing budget;
      // retain their exact native draft and charge the existing correction cap.
      if(input.deliveryContract&&row?.chapter&&chapter.id!=='operation'
        &&row.attempts.at(-1)?.contextContractVersion!==PLANNING_CONTEXT_CONTRACT
        &&row.chapter.pages.some(p=>p.kind==='financial')&&!row.contextRepair
        &&selected.some(c=>c.id==='operation')){
        if(checkpoint.correctionsUsed>=MAX_CORRECTIONS)throw new Error('MANUSCRIPT_CORRECTION_LIMIT: 跨章口径修正仍受原纠错上限约束。')
        row.contextRepair={version:PLANNING_CONTEXT_CONTRACT,previousAttemptId:row.attempts.at(-1)!.id,chapter:structuredClone(row.chapter)}
        delete row.chapter;await persist(guard)
      }
      if (row?.chapter) continue
      if (row && ['reserved', 'running', 'recovery_required'].includes(row.attempts.at(-1)?.status ?? '')) throw new Error('MANUSCRIPT_RECOVERY_REQUIRED')
      const relevant = findings.filter(f => chapter.pages.some(p => p.id === f.pageId)
        || f.requirementId && DEFAULT_REPORT_DELIVERY_CONTRACT.requirements.find(r => r.id === f.requirementId)?.chapters.includes(chapter.id))
      const feedback=JSON.stringify(relevant)+(row?.contextRepair?'\n旧跨章输入缺失其他章节的完整预算和范围，已保留旧稿；按新的运营章统一口径修正本章，独立财务表归运营章，保留本章实质论点。':'')
      await this.writeChapter(input, chapter.id, sources, agent, signal, guard, checkpoint, persist, { feedback, draft: row?.contextRepair?.chapter??chapter })
      const completed=ordered.filter(c=>checkpoint.chapters[c.id]?.chapter).length
      if(recovery&&(completed%3===0||completed===ordered.length)){
        const current={...draft,chapters:draft.chapters.map(c=>checkpoint.chapters[c.id]?.chapter??c)}
        await atomicJson(join(folder,revisionKey,`step-review-${completed}.json`),{
          afterChapters:completed,recoveryId:recovery.id,sourceFingerprint:fingerprint,manuscriptHash:hash(current),
          findings:inspectReportCoverage({...input,manuscript:current},sources),independentAcceptance:false,
        },guard)
      }
    }
    const authored = validatePlanningManuscript(clientPlanningManuscript({ ...draft, generatedAt: this.now(),
      chapters: draft.chapters.map(c => checkpoint.chapters[c.id]?.chapter ?? c) },sources), input)
    if(this.dependencies.editor)await atomicJson(join(root,'.pre-design/report-manuscript-history',`${hash(authored)}.json`),authored,guard)
    const revised=this.dependencies.editor?validatePlanningManuscript(clientPlanningManuscript(await this.dependencies.editor.edit(authored,input,root,agent,signal,guard,MAX_CORRECTIONS-checkpoint.correctionsUsed),sources),input):authored
    await guard()
    const destination = join(root, '.pre-design', MANUSCRIPT_FILE), existing = await optionalText(destination)
    if (existing !== undefined) {
      const actual = parse(existing, 'CACHE')
      if (hash(actual) !== hash(draft) && hash(actual) !== hash(revised)
        &&hash(validatePlanningManuscript(clientPlanningManuscript(migrateCachedPlanningManuscript(actual),sources),input))!==hash(draft)) throw new Error('MANUSCRIPT_SOURCE_CHANGED')
      await atomicJson(join(root, '.pre-design/report-manuscript-history', `${hash(actual)}.json`), actual, guard)
    }
    await atomicDocuments([
      { path: join(root, '.pre-design/report-manuscript.md'), text: renderPlanningManuscriptMarkdown(revised) },
      { path: join(root, '.pre-design/report-manuscript-sources.md'), text: renderPlanningManuscriptEvidence(revised, sources) },
      { path: destination, text: `${JSON.stringify(revised, null, 2)}\n` },
    ], guard)
    return revised
  }

  async load(input: FrozenProjectInput, workspaceRoot: string): Promise<PlanningManuscript | undefined> {
    const text = await optionalText(join(resolve(workspaceRoot), '.pre-design', MANUSCRIPT_FILE))
    if (text === undefined) return undefined
    const value = parse(text, 'CACHE'), record = object(value)
    if (!record) throw new Error('MANUSCRIPT_CACHE_INVALID: 汇报文案不是对象。')
    if (record.projectId !== input.projectId || record.sourceRevision !== input.revision
      || record.sourceFingerprint !== manuscriptSourceFingerprint(input) || record.policyVersion !== PLANNING_MANUSCRIPT_POLICY_VERSION
      || record.schemaVersion !== PLANNING_MANUSCRIPT_SCHEMA_VERSION) return undefined
    const manuscript = validatePlanningManuscript(clientPlanningManuscript(migrateCachedPlanningManuscript(value),makeSourceIndex(input)), input)
    if (this.dependencies.editor && manuscript.editorial?.version !== this.dependencies.editor.version) return undefined
    return manuscript
  }

  async prepareChapter(input: FrozenProjectInput, workspaceRoot: string, agent: Agent, signal: AbortSignal,
    assertCurrent: AssertCurrent, brief: ApprovedChapterBrief): Promise<ChapterDraftRecord> {
    assertApprovedChapterBrief(brief)
    signal.throwIfAborted()
    const root = resolve(workspaceRoot), key = `${root}\0${input.projectId}`
    const fingerprint = hash({ plan: brief.plan, source: manuscriptSourceFingerprint(input), rules: REPORT_DESIGN_RULES.version })
    if (this.running.has(key)) throw new Error('MANUSCRIPT_CHAPTER_BUSY: 全稿任务尚未结束。')
    const previous = this.chapterRunning.get(key)
    if (previous) {
      if (previous.fingerprint !== fingerprint || previous.signal.aborted) throw new Error('MANUSCRIPT_CHAPTER_BUSY: 另一章节任务尚未结束。')
      const result = await waitFor(previous.promise, signal)
      await assertCurrent(); signal.throwIfAborted(); return result
    }
    const promise = this.prepareChapterOnce(input, root, agent, signal, assertCurrent, structuredClone(brief), fingerprint).finally(() => {
      if (this.chapterRunning.get(key)?.promise === promise) this.chapterRunning.delete(key)
    })
    this.chapterRunning.set(key, { fingerprint, signal, promise })
    return promise
  }

  private async prepareChapterOnce(input: FrozenProjectInput, root: string, agent: Agent, signal: AbortSignal,
    assertCurrent: AssertCurrent, brief: ApprovedChapterBrief, fingerprint: string): Promise<ChapterDraftRecord> {
    const guard = async () => { signal.throwIfAborted(); await assertCurrent(); signal.throwIfAborted() }
    await guard()
    const id = brief.plan.chapterId, folder = join(root, '.pre-design', 'report-chapters', id, fingerprint)
    const path = join(folder, 'checkpoint.json'), destination = join(folder, 'chapter.json')
    const checkpoint = await this.readCheckpoint(path, input, brief.plan.sources, true)
    const persist = (check?: AssertCurrent) => atomicJson(path, structuredClone(checkpoint), check)
    const last = checkpoint.chapters[id]?.attempts.at(-1)
    if (last && ['reserved', 'running', 'recovery_required'].includes(last.status)) {
      throw new Error('MANUSCRIPT_RECOVERY_REQUIRED: 章节原生任务结局尚未确认，禁止重复派发。')
    }
    if (!checkpoint.chapters[id]?.chapter) {
      if (!this.dependencies.subagents.getProvider('spawn')) throw new Error('MANUSCRIPT_PROVIDER_UNAVAILABLE')
      await this.writeChapter(input, id, brief.plan.sources, agent, signal, guard, checkpoint, persist, undefined, brief)
    }
    const chapter = checkpoint.chapters[id]!.chapter!
    assertChapterFollowsPlan(chapter, brief)
    const result: ChapterDraftRecord = { scope: 'chapter', chapterId: id, projectId: input.projectId, sourceRevision: input.revision,
      sourceFingerprint: manuscriptSourceFingerprint(input), planHash: brief.approval.planHash, rulesVersion: REPORT_DESIGN_RULES.version,
      generatedAt: checkpoint.chapters[id]!.attempts.at(-1)!.completedAt ?? this.now(), status: 'draft_ready', userReview: 'pending', chapter,
      nativeAttempts: checkpoint.chapters[id]!.attempts.map(({ executionId, childId, status }) => ({ executionId, childId, status })),
      artifactPaths: { chapter: destination, checkpoint: path } }
    await atomicJson(destination, result, guard)
    const revisionsPath = join(root, '.pre-design', 'report-chapters', id, 'content-revisions.json')
    const saved = await optionalText(revisionsPath)
    if (saved) {
      const ledger = JSON.parse(saved)
      if (ledger.planHash !== result.planHash || ledger.sourceFingerprint !== result.sourceFingerprint) throw new Error('CHAPTER_REVISION_SOURCE_CHANGED')
      const current = [...ledger.revisions].reverse().find((r: any) => r.status === 'completed')
      if (current) {
        const revised = JSON.parse(await readFile(current.draftPath, 'utf8')) as ChapterDraftRecord
        if (hash(revised.chapter) !== current.manuscriptHash || revised.planHash !== result.planHash) throw new Error('CHAPTER_REVISION_INVALID')
        assertChapterFollowsPlan(revised.chapter, brief)
        validatePlanningChapter(revised.chapter, id, brief.plan.sources)
        return revised
      }
    }
    return result
  }

  /** Review-driven content revisions have their own bounded ledger. Structural
   * correction history is immutable and is never cleared to permit new work. */
  async reviseChapter(input: FrozenProjectInput, root: string, parent: Agent, signal: AbortSignal,
    assertCurrent: AssertCurrent, brief: ApprovedChapterBrief, draft: ChapterDraftRecord,
    review: import('../content-review.ts').ChapterContentReviewRecord): Promise<ChapterDraftRecord> {
    assertApprovedChapterBrief(brief)
    if (review.status !== 'needs_revision' || !review.receipt || review.manuscriptHash !== hash(draft.chapter)
      || review.planHash !== brief.approval.planHash) throw new Error('CHAPTER_REVISION_REVIEW_REQUIRED')
    const guard = async () => { signal.throwIfAborted(); await assertCurrent(); signal.throwIfAborted() }
    const ledgerPath = join(root, '.pre-design', 'report-chapters', brief.plan.chapterId, 'content-revisions.json')
    const saved = await optionalText(ledgerPath)
    const ledger: { planHash: string; sourceFingerprint: string; revisions: any[] } = saved ? JSON.parse(saved)
      : { planHash: draft.planHash, sourceFingerprint: draft.sourceFingerprint, revisions: [] }
    if (ledger.planHash !== draft.planHash || ledger.sourceFingerprint !== draft.sourceFingerprint) throw new Error('CHAPTER_REVISION_SOURCE_CHANGED')
    const editorialPath = join(root, '.pre-design', 'report-chapter-editorial-input', `${brief.plan.chapterId}.txt`)
    const editorialInput = await optionalText(editorialPath)
    const reviewHash = hash({ receipt: review.receipt, editorialInput: editorialInput ?? null })
    let revision = ledger.revisions.find(r => r.reviewHash === reviewHash)
    if (revision?.status === 'completed') return JSON.parse(await readFile(revision.draftPath, 'utf8'))
    if (!revision) {
      let finalCorrection: unknown
      if (ledger.revisions.length >= 2) {
        if (ledger.revisions.length !== 2) throw new Error('CHAPTER_CONTENT_REVISION_LIMIT')
        const text = await optionalText(join(root, '.pre-design', 'report-chapter-editorial-input', `${brief.plan.chapterId}-final-correction.json`))
        if (!text) throw new Error('CHAPTER_CONTENT_REVISION_LIMIT')
        const request = JSON.parse(text)
        if (request.kind !== 'one-final-revision' || request.baseManuscriptHash !== hash(draft.chapter)
          || request.reviewOutputHash !== review.receipt.outputHash || typeof request.reason !== 'string' || !request.reason.trim()) {
          throw new Error('CHAPTER_FINAL_CORRECTION_CHANGED')
        }
        // A recorded editorial correction grants one attempt, never acceptance.
        // Keep all earlier receipts and require another independent native review.
        finalCorrection = request
      }
      revision = { number: ledger.revisions.length + 1, status: 'reserved', reviewHash, fromDraftPath: draft.artifactPaths.chapter,
        fromManuscriptHash: hash(draft.chapter), reviewPath: review.path, editorialInput: editorialInput ?? null,
        ...(finalCorrection ? { finalCorrection } : {}), startedAt: this.now() }
      ledger.revisions.push(revision)
      await atomicJson(ledgerPath, ledger, guard)
    }
    const folder = join(root, '.pre-design', 'report-chapters', brief.plan.chapterId, `content-revision-${revision.number}`)
    const path = join(folder, 'checkpoint.json'), destination = join(folder, 'chapter.json')
    const checkpoint = await this.readCheckpoint(path, input, brief.plan.sources, true)
    const latest = checkpoint.chapters[brief.plan.chapterId]?.attempts.at(-1)
    if (latest && ['reserved', 'running', 'recovery_required'].includes(latest.status)) throw new Error('MANUSCRIPT_RECOVERY_REQUIRED')
    const persist = (check?: AssertCurrent) => atomicJson(path, structuredClone(checkpoint), check)
    const feedback = ['以下为独立审查意见，只修具体缺项，逐页保留未受影响的正文。', JSON.stringify(review.receipt.output.findings), ...(editorialInput ? [`以下为编辑复核补充，不能当成新增事实或用户验收：\n${editorialInput}`] : []), ...(brief.plan.chapterId === 'opportunity' && !brief.plan.sources.some(s=>s.id.startsWith('R-')) ? [
      '已确认页表要求具体案例比较。人工稿H-P08给出的道观河、凤娃古寨、涨渡湖等具名资源类型可作为带来源时点的定性对照；H-P11至H-P14可用于产品组织借鉴。不得因现营业状态待核而只写比较维度。',
      '只比较来源支持的内容、体验组织与少潭河的对应建议。对价格、客流、景区等级、营业及合作状态不作未核实断言；不以资料中贬损性的经营评价为结论。来源时点、人工复核和可比范围放notes。',
      '1.06选择至少两个已有具名产品组织案例，1.07至少三个具名区内对象，1.08至少两个具名区域对象；需要比较就提供精简table（每格≤32字），正文解释取舍而非重复表格。',
      '不要在没有信息的情况下编造售卖渠道、价格、停留时间或销量。备注明确当前对比是人工稿所载内容类型的策划研判，不是当前营业调查。'] : [])].join('\n')
    if (!checkpoint.chapters[brief.plan.chapterId]?.chapter) await this.writeChapter(input, brief.plan.chapterId, brief.plan.sources, parent,
      signal, guard, checkpoint, persist, { feedback, draft: draft.chapter }, brief)
    const chapter = checkpoint.chapters[brief.plan.chapterId]!.chapter!
    const result: ChapterDraftRecord = { ...draft, chapter, generatedAt: this.now(), nativeAttempts: checkpoint.chapters[brief.plan.chapterId]!.attempts,
      artifactPaths: { chapter: destination, checkpoint: path } }
    await atomicJson(destination, result, guard)
    Object.assign(revision, { status: 'completed', draftPath: destination, manuscriptHash: hash(chapter), completedAt: this.now() })
    await atomicJson(ledgerPath, ledger, guard)
    return result
  }

  prepare(input: FrozenProjectInput, workspaceRoot: string, agent: Agent, signal: AbortSignal, assertCurrent: AssertCurrent): Promise<PlanningManuscript> {
    if (signal.aborted) return Promise.reject(signal.reason)
    const root = resolve(workspaceRoot), key = `${root}\0${input.projectId}`, fingerprint = manuscriptSourceFingerprint(input)
    if (this.chapterRunning.has(key)) return Promise.reject(new Error('MANUSCRIPT_CHAPTER_BUSY'))
    const previous = this.running.get(key)
    if (previous !== undefined) {
      if (previous.fingerprint === fingerprint && !previous.signal.aborted) return waitFor(previous.promise, signal).then(async manuscript => {
        signal.throwIfAborted(); await assertCurrent(); signal.throwIfAborted()
        return manuscript
      })
      return waitFor(previous.promise.catch(() => undefined), signal).then(() => this.prepare(input, root, agent, signal, assertCurrent))
    }
    const promise = this.prepareOnce(input, root, agent, signal, assertCurrent).finally(() => {
      if (this.running.get(key)?.promise === promise) this.running.delete(key)
    })
    this.running.set(key, { fingerprint, signal, promise })
    return promise
  }

  private async prepareOnce(input: FrozenProjectInput, root: string, agent: Agent, signal: AbortSignal, assertCurrent: AssertCurrent): Promise<PlanningManuscript> {
    const guard = async () => { signal.throwIfAborted(); await assertCurrent(); signal.throwIfAborted() }
    await guard()
    const cached = await this.load(input, root)
    if (cached) {
      await guard()
      const {pendingNativeRevision,verifyNativeRevisionRequest}=await import('../native-revision-request.ts')
      const pending=await pendingNativeRevision(root)
      if(pending){
        if(!this.dependencies.readEvents||!this.dependencies.agentClasses.execution)throw new Error('REPORT_NATIVE_REVISION_REPLAY_REQUIRED')
        const verified=await verifyNativeRevisionRequest(pending.request,input,cached,pending.reviewed,
          id=>this.dependencies.agentClasses.execution!(id),this.dependencies.readEvents)
        const revised=await this.reviseOnce(input,cached,verified.findings,root,agent,signal,guard,'content',verified.recovery)
        await atomicJson(pending.path+'.completed.json',{requestHash:verified.requestHash,manuscriptHash:hash(revised),at:this.now(),independentAcceptance:false},guard)
        return revised
      }
      // A content revision inherited the original editorial marker even though
      // its new prose had never been edited. Resume the existing native editor;
      // grant no new correction budget and persist before any acceptance review.
      if(input.deliveryContract&&this.dependencies.editor&&cached.editorial&&Date.parse(cached.generatedAt)>Date.parse(cached.editorial.editedAt)){
        const sources=makeSourceIndex(input)
        const edited=validatePlanningManuscript(clientPlanningManuscript(await this.dependencies.editor.edit(cached,input,root,agent,signal,guard,0),sources),input)
        await atomicJson(join(root,'.pre-design/report-manuscript-history',`${hash(cached)}.json`),cached,guard)
        await atomicDocuments([
          {path:join(root,'.pre-design/report-manuscript.md'),text:renderPlanningManuscriptMarkdown(edited)},
          {path:join(root,'.pre-design/report-manuscript-sources.md'),text:renderPlanningManuscriptEvidence(edited,sources)},
          {path:join(root,'.pre-design',MANUSCRIPT_FILE),text:`${JSON.stringify(edited,null,2)}\n`},
        ],guard)
        return edited
      }
      return cached
    }
    const sources = makeSourceIndex(input)
    if (!sources.length) throw new Error('MANUSCRIPT_SOURCE_EMPTY: 没有可用于撰写的项目资料。')
    const fingerprint = manuscriptSourceFingerprint(input)
    const version = createHash('sha256').update(PLANNING_MANUSCRIPT_POLICY_VERSION).digest('hex').slice(0, 12)
    const path = join(root, '.pre-design', 'report-manuscript-checkpoints', `${fingerprint}-${version}`, 'chapters.json')
    const checkpoint = await this.readCheckpoint(path, input, sources)
    let writes = Promise.resolve()
    const persist = (check?: AssertCurrent) => {
      const snapshot = structuredClone(checkpoint)
      const pending = writes.then(() => atomicJson(path, snapshot, check))
      writes = pending.catch(() => undefined)
      return pending
    }
    const failures = new Map<PlanningChapterId, unknown>()
    for (const id of PLANNING_CHAPTER_IDS) {
      const latest = checkpoint.chapters[id]?.attempts.at(-1)
      if (latest && ['reserved', 'running', 'recovery_required'].includes(latest.status)) {
        latest.status = 'recovery_required'; latest.errorCode = 'MANUSCRIPT_RECOVERY_REQUIRED'
        await persist()
        failures.set(id, new Error(`MANUSCRIPT_RECOVERY_REQUIRED: ${id}保留了未确认结束的子会话，已跳过该项并继续其它章节。`))
      }
    }
    if (PLANNING_CHAPTER_IDS.some(id => checkpoint.chapters[id]?.chapter === undefined)
      && !this.dependencies.subagents.getProvider('spawn')) throw new Error('MANUSCRIPT_PROVIDER_UNAVAILABLE: DSH文本子会话不可用。')
    let next = 0
    const worker = async () => {
        while (next < PLANNING_CHAPTER_IDS.length) {
          await guard()
          if (next >= PLANNING_CHAPTER_IDS.length) return
          const id = PLANNING_CHAPTER_IDS[next++]!
          if (checkpoint.chapters[id]?.chapter || failures.has(id)) continue
          try { await this.writeChapter(input, id, sources, agent, signal, guard, checkpoint, persist) }
          catch (error) { failures.set(id, error); signal.throwIfAborted() }
        }
    }
    const results = await Promise.allSettled(Array.from({ length: input.deliveryContract ? 1 : this.maxConcurrency }, worker))
    await writes
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed) throw failed.reason
    if (failures.size) {
      await atomicJson(join(root, '.pre-design', 'report-manuscript-errors', `${randomUUID()}.json`), {
        projectId: input.projectId, sourceRevision: input.revision, at: this.now(), stage: 'writing',
        errors: [...failures].map(([chapterId, error]) => ({ chapterId, message: error instanceof Error ? error.message : String(error) })),
      }, guard)
      throw failures.values().next().value
    }
    await guard()
    const sourceDraft: PlanningManuscript = { schemaVersion: PLANNING_MANUSCRIPT_SCHEMA_VERSION,
      policyVersion: PLANNING_MANUSCRIPT_POLICY_VERSION, projectId: input.projectId, sourceRevision: input.revision,
      sourceFingerprint: fingerprint, generatedAt: this.now(), title: `${input.projectName}前期策划汇报文案`,
      chapters: PLANNING_CHAPTER_IDS.map(id => checkpoint.chapters[id]!.chapter!),
    }
    const draft = validatePlanningManuscript(migrateCachedPlanningManuscript(sourceDraft), input)
    const edited = this.dependencies.editor
      // Keep the original chapter text as the editorial checkpoint identity.
      // The editor migrates its working copy after calculating that identity.
      ? await this.dependencies.editor.edit(sourceDraft, input, root, agent, signal, guard, MAX_CORRECTIONS - checkpoint.correctionsUsed)
      : draft
    const manuscript=validatePlanningManuscript(clientPlanningManuscript(edited,sources),input)
    await guard()
    const destination = join(root, '.pre-design', MANUSCRIPT_FILE)
    const existing = await optionalText(destination)
    if (existing !== undefined) {
      const digest = createHash('sha256').update(existing).digest('hex')
      const history = join(root, '.pre-design', 'report-manuscript-history', `${digest}.json`)
      await mkdir(dirname(history), { recursive: true })
      try { await writeFile(history, existing, { flag: 'wx' }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    await atomicDocuments([
      { path: join(root, '.pre-design', 'report-manuscript.md'), text: renderPlanningManuscriptMarkdown(manuscript) },
      { path: join(root, '.pre-design', 'report-manuscript-sources.md'), text: renderPlanningManuscriptEvidence(manuscript, sources) },
      // The canonical complete manuscript is adopted last, after its readable rendering.
      { path: destination, text: `${JSON.stringify(manuscript, null, 2)}\n` },
    ], guard)
    return manuscript
  }

  private async readCheckpoint(path: string, input: FrozenProjectInput, sources: readonly PlanningManuscriptSource[], approvedSources = false): Promise<Checkpoint> {
    const raw = await optionalText(path)
    if (raw === undefined) return { schemaVersion: 'pre-design.planning-manuscript-checkpoint.v1', policyVersion: PLANNING_MANUSCRIPT_POLICY_VERSION,
      projectId: input.projectId, sourceRevision: input.revision, sourceFingerprint: manuscriptSourceFingerprint(input), correctionsUsed: 0, chapters: {} }
    const value = object(parse(raw, 'CHECKPOINT'))
    if (!value || value.schemaVersion !== 'pre-design.planning-manuscript-checkpoint.v1' || value.policyVersion !== PLANNING_MANUSCRIPT_POLICY_VERSION
      || value.projectId !== input.projectId || value.sourceRevision !== input.revision || value.sourceFingerprint !== manuscriptSourceFingerprint(input)
      || !Number.isInteger(value.correctionsUsed) || Number(value.correctionsUsed) < 0 || Number(value.correctionsUsed) > MAX_CORRECTIONS || !object(value.chapters)) {
      throw new Error('MANUSCRIPT_CHECKPOINT_INVALID: 章节恢复记录与当前来源不匹配。')
    }
    const checkpoint = value as unknown as Checkpoint
    // Older checkpoints counted every resumed execution, even without rejected content.
    checkpoint.correctionsUsed = 0
    for (const [id, row] of Object.entries(checkpoint.chapters)) {
      if (!PLANNING_CHAPTER_IDS.includes(id as PlanningChapterId) || !object(row) || !Array.isArray(row.attempts)
        || row.attempts.some(attempt => !object(attempt) || !['reserved', 'running', 'completed', 'failed', 'cancelled', 'recovery_required'].includes(attempt.status)
          || (attempt.validationCorrection !== undefined && typeof attempt.validationCorrection !== 'boolean'))) {
        throw new Error('MANUSCRIPT_CHECKPOINT_INVALID: 章节状态损坏。')
      }
      for (const [index, attempt] of row.attempts.entries()) {
        attempt.validationCorrection ??= index > 0 && Boolean(row.attempts[index - 1]?.validationFeedback)
        if (attempt.validationCorrection) checkpoint.correctionsUsed++
      }
      if(row.contextRepair){
        if(row.contextRepair.version!==PLANNING_CONTEXT_CONTRACT||!row.attempts.some(a=>a.id===row.contextRepair!.previousAttemptId&&a.status==='completed'))throw new Error('MANUSCRIPT_CHECKPOINT_INVALID: 跨章修正缺少原始完成记录。')
        validatePlanningChapter(row.contextRepair.chapter,id as PlanningChapterId,approvedSources?sources:planningChapterSources(id as PlanningChapterId,sources),()=>{})
      }
      if (row.chapter !== undefined) {
        if (row.attempts.at(-1)?.status !== 'completed') throw new Error('MANUSCRIPT_CHECKPOINT_INVALID: 章节缺少完成凭据。')
        validatePlanningChapter(migrateCachedPlanningChapter(row.chapter), id as PlanningChapterId, approvedSources?sources:planningChapterSources(id as PlanningChapterId, sources),input.deliveryContract?()=>{}:undefined)
      }
    }
    if (checkpoint.correctionsUsed > MAX_CORRECTIONS) throw new Error('MANUSCRIPT_CHECKPOINT_INVALID: 内容纠错记录超出本版上限。')
    return checkpoint
  }

  private async writeChapter(input: FrozenProjectInput, id: PlanningChapterId, sources: readonly PlanningManuscriptSource[], parent: Agent,
    signal: AbortSignal, guard: AssertCurrent, checkpoint: Checkpoint, persist: (guard?: AssertCurrent) => Promise<void>, review?: { feedback: string; draft: PlanningManuscriptChapter }, approvedBrief?: ApprovedChapterBrief): Promise<void> {
    const row = checkpoint.chapters[id] ??= { attempts: [] }
    let nextExecution: Awaited<ReturnType<AgentClassService['begin']>> | undefined
    for (;;) {
      await guard()
      const latest = row.attempts.at(-1), chapterSources = approvedBrief ? sources : planningChapterSources(id, sources)
      // Older code omitted diagram errors from correction classification. Replay
      // the same deterministic validation; preserve raw output and charge the
      // normal bounded correction rather than treating this as a new draft.
      if(approvedBrief&&latest?.status==='failed'&&latest.stopReason==='completed'&&latest.returnedContent&&!latest.validationFeedback){
        try{const candidate=validatePlanningChapter(normalizeApprovedChapterMetadata(latest.returnedContent,approvedBrief).value,id,chapterSources);assertChapterFollowsPlan(candidate,approvedBrief)}
        catch(error){if(error instanceof Error&&contentError.test(error.message)){latest.validationFeedback=error.message;await persist(guard)}}
      }
      // A metadata contract error must not spend another native writing attempt.
      // Replay the original completed submission before normalizing the label.
      if (approvedBrief && latest?.status === 'failed' && latest.stopReason === 'completed'
        && latest.validationFeedback?.startsWith('MANUSCRIPT_PRODUCT:') && latest.childId && latest.executionId
        && this.dependencies.readEvents && this.dependencies.agentClasses.execution) {
        const normalized = normalizeApprovedChapterMetadata(latest.returnedContent, approvedBrief)
        if (normalized.changes.length) {
          const execution = this.dependencies.agentClasses.execution(latest.executionId)
          if (!execution || execution.projectId !== input.projectId || execution.classId !== 'text' || execution.childId !== latest.childId
            || execution.parentId === latest.childId || !['failed', 'completed'].includes(execution.status) || execution.childStopReason !== 'completed'
            || !execution.actual || execution.actual.provider !== execution.selected.provider || execution.actual.model !== execution.selected.model) throw new Error('MANUSCRIPT_RECOVERY_NATIVE_INVALID')
          verifyModuleNativeSubmission(await this.dependencies.readEvents(latest.childId), execution.selected, latest.returnedContent)
          const chapter = validatePlanningChapter(normalized.value, id, chapterSources)
          assertChapterFollowsPlan(chapter, approvedBrief)
          await guard(); await this.dependencies.agentClasses.finish(execution.id, 'completed'); await guard()
          row.attempts.push({ id: randomUUID(), status: 'completed', startedAt: this.now(), completedAt: this.now(),
            executionId: execution.id, childId: latest.childId, stopReason: 'completed', validationCorrection: false, recoveredFromAttempt: latest.id,
            metadataNormalization: { rawHash: hash(latest.returnedContent), normalizedHash: hash(chapter), changes: normalized.changes } })
          row.chapter = chapter; await persist(guard); return
        }
      }
      // A completed native draft rejected solely for copy quality can enter the
      // full content review. Verify the exact immutable submission first; retain
      // the rejected attempt and all charged corrections, and never redispatch.
      if(!approvedBrief&&input.deliveryContract&&latest?.status==='failed'&&latest.stopReason==='completed'
        &&latest.validationFeedback?.startsWith('MANUSCRIPT_AUDIENCE:')&&latest.childId&&latest.executionId
        &&this.dependencies.readEvents&&this.dependencies.agentClasses.execution){
        const execution=this.dependencies.agentClasses.execution(latest.executionId)
        if(!execution||execution.projectId!==input.projectId||execution.classId!=='text'||execution.childId!==latest.childId
          ||execution.parentId===latest.childId||!['failed','completed'].includes(execution.status)||execution.childStopReason!=='completed'
          ||!execution.actual||execution.actual.provider!==execution.selected.provider||execution.actual.model!==execution.selected.model)throw new Error('MANUSCRIPT_RECOVERY_NATIVE_INVALID')
        verifyModuleNativeSubmission(await this.dependencies.readEvents(latest.childId),execution.selected,latest.returnedContent)
        const chapter=validatePlanningChapter(latest.returnedContent,id,chapterSources,()=>{})
        await guard();await this.dependencies.agentClasses.finish(execution.id,'completed');await guard()
        row.attempts.push({id:randomUUID(),status:'completed',startedAt:this.now(),completedAt:this.now(),
          executionId:execution.id,childId:latest.childId,stopReason:'completed',validationCorrection:false,recoveredFromAttempt:latest.id})
        row.chapter=chapter;await persist(guard);return
      }
      let sourceContractFeedback: string | undefined
      // One migration attempt repairs a legacy source-choice contract, not an authored conclusion.
      // Prior attempts and their charged corrections remain intact; the tightened native schema
      // applies to this attempt and prevents repeatedly reopening the same contract repair.
      if (latest?.validationFeedback?.startsWith('MANUSCRIPT_SOURCE:') && latest.sourceContractVersion === undefined
        && !row.attempts.some(attempt => attempt.sourceContractRepair)) {
        try { validatePlanningChapter(latest.returnedContent, id, chapterSources) }
        catch (error) { if (error instanceof Error && error.message.startsWith('MANUSCRIPT_SOURCE:')) sourceContractFeedback = error.message }
      }
      const sourceContractRepair = sourceContractFeedback !== undefined
      const diagramContractRepair=!!approvedBrief&&latest?.status==='failed'&&latest.stopReason==='completed'
        &&!!latest.validationFeedback?.startsWith('MANUSCRIPT_DIAGRAM:')&&latest.diagramContractVersion!==CHAPTER_DIAGRAM_CONTRACT
        &&!row.attempts.some(a=>a.diagramContractRepair)
      if(diagramContractRepair){
        const execution=latest.executionId&&this.dependencies.agentClasses.execution?.(latest.executionId)
        if(!latest.childId||!this.dependencies.readEvents||!execution||execution.projectId!==input.projectId||execution.classId!=='text'
          ||execution.childId!==latest.childId||execution.parentId===latest.childId||execution.status!=='failed'||execution.childStopReason!=='completed'
          ||!execution.actual||execution.actual.provider!==execution.selected.provider||execution.actual.model!==execution.selected.model)
          throw new Error('MANUSCRIPT_RECOVERY_NATIVE_INVALID')
        verifyModuleNativeSubmission(await this.dependencies.readEvents(latest.childId),execution.selected,latest.returnedContent)
      }
      const authoringContractRepair=!!latest?.validationFeedback?.startsWith('MANUSCRIPT_AUDIENCE:')
        &&latest.authoringContractVersion!==PLANNING_AUTHORING_CONTRACT&&!row.attempts.some(attempt=>attempt.authoringContractRepair)
      let authoringFeedback:string|undefined
      if(authoringContractRepair)try{validatePlanningChapter(latest?.returnedContent,id,chapterSources)}catch(error){if(error instanceof Error&&error.message.startsWith('MANUSCRIPT_AUDIENCE:'))authoringFeedback=error.message}
      const contextContractRepair=!!row.contextRepair&&!row.attempts.some(a=>a.contextContractRepair)
      const validationCorrection = contextContractRepair||Boolean(latest?.validationFeedback) && !sourceContractRepair&&!authoringContractRepair&&!diagramContractRepair
      if (validationCorrection) {
        if (checkpoint.correctionsUsed >= MAX_CORRECTIONS) throw new Error('MANUSCRIPT_CORRECTION_LIMIT: 本版文案已使用两次纠错，该章节保留待修正记录。')
        checkpoint.correctionsUsed++
      }
      // An execution retry still needs the last rejected draft, without spending a new content correction.
      const rejected = [...row.attempts].reverse().find(attempt => attempt.validationFeedback)
      const attempt: Attempt = { id: randomUUID(), status: 'reserved', startedAt: this.now(), validationCorrection,
        diagramContractVersion:CHAPTER_DIAGRAM_CONTRACT,...(diagramContractRepair?{diagramContractRepair:true}:{}),
        contextContractVersion:PLANNING_CONTEXT_CONTRACT,...(contextContractRepair?{contextContractRepair:true}:{}),
        authoringContractVersion:PLANNING_AUTHORING_CONTRACT,...(authoringContractRepair?{authoringContractRepair:true}:{}),
        sourceContractVersion: PLANNING_CHAPTER_SOURCE_CONTRACT, ...(sourceContractRepair ? { sourceContractRepair: true } : {}) }
      row.attempts.push(attempt)
      let execution: Awaited<ReturnType<PlanningManuscriptServiceOptions['agentClasses']['begin']>> | undefined
      let run: Awaited<ReturnType<SubagentRuntime['start']>> | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      let taskSignal = signal
      try {
        await persist(guard)
        await guard()
        execution = nextExecution ?? await this.dependencies.agentClasses.begin(input.projectId, 'text', `汇报文案：${planningChapterTitle(id)}`, parent, signal)
        nextExecution = undefined
        attempt.executionId = execution.id
        const limits = await this.dependencies.agentClasses.modelLimits?.(execution.selected)
        if (limits?.outputTokenLimit !== undefined) attempt.outputTokenLimit = limits.outputTokenLimit
        if (limits?.contextWindow !== undefined) attempt.contextWindow = limits.contextWindow
        await persist(guard)
        await guard()
        // Package the immutable evidence before starting the native model timer.
        // Large source sharing can take tens of seconds; it is host preparation,
        // not model execution, and must not consume the unchanged model deadline.
        const authoringInput=input.deliveryContract ? { ...input, manuscript: {
          ...input.manuscript, chapters: PLANNING_CHAPTER_IDS.map(key => checkpoint.chapters[key]?.chapter ?? input.manuscript?.chapters.find(c=>c.id===key)).filter((c): c is PlanningManuscriptChapter => !!c),
        } as PlanningManuscript } : input
        const feedback=[review?.feedback,sourceContractFeedback??authoringFeedback??rejected?.validationFeedback,
          ...(approvedBrief&&rejected?.validationFeedback?.startsWith('MANUSCRIPT_DIAGRAM:')?[chapterDiagramFeedback(rejected.returnedContent)]:[])].filter(Boolean).join('\n')||undefined
        const prompt=approvedBrief ? buildApprovedChapterPrompt(approvedBrief,feedback,rejected?.returnedContent??review?.draft) : buildPlanningChapterPrompt(authoringInput,id,sources,feedback,rejected?.returnedContent??review?.draft)
        const productCatalog=authoringInput.manuscript?.chapters.find(c=>c.id==='products')?.pages.filter(p=>p.kind==='product').map(p=>({id:p.id,name:p.product?.name}))??[]
        const outputSchema=planningChapterOutputSchema(chapterSources,productCatalog.map(p=>p.id))
        const closing=approvedBrief ? '请完整提交本轮已确认页表的全部页面，正文表达方案，核实和条件放notes。' : buildPlanningChapterClosing(authoringInput,id)
        const deadline = new AbortController()
        const timeoutMs = this.dependencies.timeoutMs ?? (/^ollama(?:[-_]|$)/iu.test(execution.selected.provider) ? 1_200_000 : 300_000)
        timer = setTimeout(() => deadline.abort(new Error('MANUSCRIPT_CHILD_TIMEOUT: 当前章节子会话超时，已记录该项问题。')), timeoutMs)
        timer.unref?.()
        taskSignal = AbortSignal.any([signal, deadline.signal])
        run = await this.dependencies.subagents.start('spawn', { parent, agentOptions: agentOptionsForRoute(execution.selected),
          prompt: [{ type: 'text', text: prompt },...(input.deliveryContract?[{type:'text' as const,text:closing}]:[])], signal: taskSignal,
          outputSchema, maxDepth: 1, toolFilter: { allow: [] }, persona: PLANNING_WRITER_PERSONA,
          label: `preplanning_manuscript:${input.projectId}:${id}`,
        })
        // Capture rejections immediately, before durable bookkeeping awaits filesystem I/O.
        const response = run.result.then(result => ({ result }), error => ({ error }))
        attempt.childId = String(run.id); attempt.status = 'running'
        await persist()
        await this.dependencies.agentClasses.attach(execution.id, String(run.id))
        const settled = await waitFor(response, taskSignal)
        if ('error' in settled) throw settled.error
        taskSignal.throwIfAborted()
        const result = settled.result
        attempt.stopReason = result.stopReason
        if (result.stopReason === 'max-tokens') throw new Error(`MANUSCRIPT_OUTPUT_LIMIT: ${id}子会话以 max-tokens 结束（${attempt.outputTokenLimit === undefined ? '所选模型的原生输出额度' : `所选模型配置输出上限 ${attempt.outputTokenLimit} tokens`}）；可能触及输出或上下文限制，未采纳不完整结果。`)
        if (result.stopReason !== 'completed') throw new Error(`MANUSCRIPT_CHILD_INCOMPLETE: ${result.stopReason}`)
        attempt.returnedContent = result.structured
        let chapter: PlanningManuscriptChapter
        try {
          const normalized = approvedBrief ? normalizeApprovedChapterMetadata(result.structured, approvedBrief) : undefined
          chapter = validatePlanningChapter(normalized?.value ?? result.structured, id, chapterSources,input.deliveryContract&&!approvedBrief?()=>{}:undefined)
          if (normalized?.changes.length) attempt.metadataNormalization = { rawHash: hash(result.structured), normalizedHash: hash(chapter), changes: normalized.changes }
          if (approvedBrief) assertChapterFollowsPlan(chapter,approvedBrief)
        }
        catch (error) {
          if (error instanceof Error && contentError.test(error.message)) attempt.validationFeedback = error.message
          throw error
        }
        await guard()
        await this.dependencies.agentClasses.finish(execution.id, 'completed')
        await guard()
        attempt.status = 'completed'; attempt.completedAt = this.now()
        if (!attempt.metadataNormalization) delete attempt.returnedContent
        row.chapter = chapter
        await persist(guard)
        return
      } catch (error) {
        const invalidContent = attempt.validationFeedback !== undefined
        delete row.chapter
        attempt.status = signal.aborted ? 'cancelled' : 'failed'
        attempt.errorCode = error instanceof Error ? /^MANUSCRIPT_[A-Z_]+/u.exec(error.message)?.[0] ?? 'MANUSCRIPT_CHILD_FAILED' : 'MANUSCRIPT_CHILD_FAILED'
        if (execution) await this.dependencies.agentClasses.finish(execution.id, signal.aborted ? 'cancelled' : 'failed', attempt.errorCode).catch(() => undefined)
        await persist()
        if (!signal.aborted && !taskSignal.aborted && !invalidContent) {
          nextExecution = await nextAgentClassAttempt(this.dependencies.agentClasses, execution, parent, taskSignal)
          if (nextExecution) continue
        }
        if (signal.aborted) throw signal.reason
        if (taskSignal.aborted) throw taskSignal.reason
        if (!invalidContent) throw error
        if (checkpoint.correctionsUsed >= MAX_CORRECTIONS) throw error
      } finally {
        if (timer) clearTimeout(timer)
        await run?.dispose().catch(() => undefined)
      }
    }
  }
}
