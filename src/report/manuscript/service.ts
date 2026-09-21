import { createHash, randomUUID } from 'node:crypto'
import { renameSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { nextAgentClassAttempt, type AgentClassService } from '../../agent-classes/service.ts'
import type { FrozenProjectInput } from '../types.ts'
import { buildPlanningChapterPrompt, planningChapterSources, planningChapterTitle, PLANNING_CHAPTER_OUTPUT_SCHEMA, PLANNING_WRITER_PERSONA } from './prompts.ts'
import { makeSourceIndex, manuscriptSourceFingerprint } from './source.ts'
import { PLANNING_CHAPTER_IDS, PLANNING_MANUSCRIPT_POLICY_VERSION, PLANNING_MANUSCRIPT_SCHEMA_VERSION,
  type PlanningChapterId, type PlanningManuscript, type PlanningManuscriptChapter, type PlanningManuscriptSource } from './types.ts'
import { validatePlanningChapter, validatePlanningManuscript } from './validation.ts'
import { renderPlanningManuscriptMarkdown, renderPlanningManuscriptEvidence } from './markdown.ts'
import { clientCopyText, clientPlanningPage, clientPlanningManuscript } from './client-copy.ts'

type AssertCurrent = () => void | Promise<void>
export interface PlanningManuscriptServiceOptions {
  readonly subagents: Pick<SubagentRuntime, 'getProvider' | 'start'>
  readonly agentClasses: Pick<AgentClassService, 'begin' | 'attach' | 'finish'> & Partial<Pick<AgentClassService, 'fallback'>>
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
  stopReason?: string
  outputTokenLimit?: number
  returnedContent?: unknown
}
interface ChapterCheckpoint { attempts: Attempt[]; chapter?: PlanningManuscriptChapter }
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
const contentError = /^MANUSCRIPT_(?:SHAPE|AUDIENCE|PRODUCT|TABLE|CHAPTER_ID|PAGE_ID|PAGE_KIND|VISUAL|SOURCE)(?=:)/u
const MAX_CORRECTIONS = 2
const MAX_OUTPUT_TOKENS = 65536

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
  return { ...value, title: clientCopyText(value.title), thesis: clientCopyText(value.thesis), pages: value.pages.map(clientPlanningPage) }
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
  private readonly running = new Map<string, { fingerprint: string; signal: AbortSignal; promise: Promise<PlanningManuscript> }>()
  private readonly now: () => string
  private get maxConcurrency(): number { return resolveManuscriptConcurrency(this.dependencies.maxConcurrency) }
  constructor(private readonly dependencies: PlanningManuscriptServiceOptions) {
    this.now = dependencies.now ?? (() => new Date().toISOString())
    resolveManuscriptConcurrency(dependencies.maxConcurrency)
  }

  async load(input: FrozenProjectInput, workspaceRoot: string): Promise<PlanningManuscript | undefined> {
    const text = await optionalText(join(resolve(workspaceRoot), '.pre-design', MANUSCRIPT_FILE))
    if (text === undefined) return undefined
    const value = parse(text, 'CACHE'), record = object(value)
    if (!record) throw new Error('MANUSCRIPT_CACHE_INVALID: 汇报文案不是对象。')
    if (record.projectId !== input.projectId || record.sourceRevision !== input.revision
      || record.sourceFingerprint !== manuscriptSourceFingerprint(input) || record.policyVersion !== PLANNING_MANUSCRIPT_POLICY_VERSION
      || record.schemaVersion !== PLANNING_MANUSCRIPT_SCHEMA_VERSION) return undefined
    const manuscript = validatePlanningManuscript(migrateCachedPlanningManuscript(value), input)
    if (this.dependencies.editor && manuscript.editorial?.version !== this.dependencies.editor.version) return undefined
    return manuscript
  }

  prepare(input: FrozenProjectInput, workspaceRoot: string, agent: Agent, signal: AbortSignal, assertCurrent: AssertCurrent): Promise<PlanningManuscript> {
    if (signal.aborted) return Promise.reject(signal.reason)
    const root = resolve(workspaceRoot), key = `${root}\0${input.projectId}`, fingerprint = manuscriptSourceFingerprint(input)
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
    if (cached) { await guard(); return cached }
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
    const results = await Promise.allSettled(Array.from({ length: this.maxConcurrency }, worker))
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
    const manuscript = this.dependencies.editor
      // Keep the original chapter text as the editorial checkpoint identity.
      // The editor migrates its working copy after calculating that identity.
      ? await this.dependencies.editor.edit(sourceDraft, input, root, agent, signal, guard, MAX_CORRECTIONS - checkpoint.correctionsUsed)
      : draft
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

  private async readCheckpoint(path: string, input: FrozenProjectInput, sources: readonly PlanningManuscriptSource[]): Promise<Checkpoint> {
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
      if (row.chapter !== undefined) {
        if (row.attempts.at(-1)?.status !== 'completed') throw new Error('MANUSCRIPT_CHECKPOINT_INVALID: 章节缺少完成凭据。')
        validatePlanningChapter(migrateCachedPlanningChapter(row.chapter), id as PlanningChapterId, planningChapterSources(id as PlanningChapterId, sources))
      }
    }
    if (checkpoint.correctionsUsed > MAX_CORRECTIONS) throw new Error('MANUSCRIPT_CHECKPOINT_INVALID: 内容纠错记录超出本版上限。')
    return checkpoint
  }

  private async writeChapter(input: FrozenProjectInput, id: PlanningChapterId, sources: readonly PlanningManuscriptSource[], parent: Agent,
    signal: AbortSignal, guard: AssertCurrent, checkpoint: Checkpoint, persist: (guard?: AssertCurrent) => Promise<void>): Promise<void> {
    const row = checkpoint.chapters[id] ??= { attempts: [] }
    let nextExecution: Awaited<ReturnType<AgentClassService['begin']>> | undefined
    for (;;) {
      await guard()
      const validationCorrection = Boolean(row.attempts.at(-1)?.validationFeedback)
      if (validationCorrection) {
        if (checkpoint.correctionsUsed >= MAX_CORRECTIONS) throw new Error('MANUSCRIPT_CORRECTION_LIMIT: 本版文案已使用两次纠错，该章节保留待修正记录。')
        checkpoint.correctionsUsed++
      }
      // An execution retry still needs the last rejected draft, without spending a new content correction.
      const rejected = [...row.attempts].reverse().find(attempt => attempt.validationFeedback)
      const attempt: Attempt = { id: randomUUID(), status: 'reserved', startedAt: this.now(), validationCorrection, outputTokenLimit: MAX_OUTPUT_TOKENS }
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
        await persist(guard)
        await guard()
        const deadline = new AbortController()
        const timeoutMs = this.dependencies.timeoutMs ?? (/^ollama(?:[-_]|$)/iu.test(execution.selected.provider) ? 1_200_000 : 300_000)
        timer = setTimeout(() => deadline.abort(new Error('MANUSCRIPT_CHILD_TIMEOUT: 当前章节子会话超时，已记录该项问题。')), timeoutMs)
        timer.unref?.()
        taskSignal = AbortSignal.any([signal, deadline.signal])
        run = await this.dependencies.subagents.start('spawn', { parent, agentOptions: { ...execution.selected, maxTokens: MAX_OUTPUT_TOKENS },
          prompt: [{ type: 'text', text: buildPlanningChapterPrompt(input, id, sources, rejected?.validationFeedback, rejected?.returnedContent) }], signal: taskSignal,
          outputSchema: PLANNING_CHAPTER_OUTPUT_SCHEMA, maxDepth: 1, toolFilter: { allow: [] }, persona: PLANNING_WRITER_PERSONA,
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
        if (result.stopReason === 'max-tokens') throw new Error(`MANUSCRIPT_OUTPUT_LIMIT: ${id}子会话以 max-tokens 结束（配置输出上限 ${MAX_OUTPUT_TOKENS} tokens）；可能触及输出或上下文限制，未采纳不完整结果。`)
        if (result.stopReason !== 'completed') throw new Error(`MANUSCRIPT_CHILD_INCOMPLETE: ${result.stopReason}`)
        attempt.returnedContent = result.structured
        let chapter: PlanningManuscriptChapter
        try { chapter = validatePlanningChapter(result.structured, id, planningChapterSources(id, sources)) }
        catch (error) {
          if (error instanceof Error && contentError.test(error.message)) attempt.validationFeedback = error.message
          throw error
        }
        await guard()
        await this.dependencies.agentClasses.finish(execution.id, 'completed')
        await guard()
        attempt.status = 'completed'; attempt.completedAt = this.now()
        delete attempt.returnedContent
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
