import { createHash, randomUUID } from 'node:crypto'
import { renameSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { nextAgentClassAttempt, type AgentClassService } from '../../agent-classes/service.ts'
import type { FrozenProjectInput } from '../types.ts'
import { migrateCachedPlanningChapter, migrateCachedPlanningManuscript, resolveManuscriptConcurrency, type PlanningManuscriptServiceOptions } from './service.ts'
import { PLANNING_CHAPTER_IDS, type PlanningChapterId, type PlanningManuscript, type PlanningManuscriptChapter } from './types.ts'
import { makeSourceIndex } from './source.ts'
import { validatePlanningManuscript } from './validation.ts'
import { buildEditorialPrompt, EDITORIAL_PERSONA, EDITORIAL_SCHEMA, PLANNING_EDITORIAL_VERSION } from './editorial-prompt.ts'

type Guard = () => void | Promise<void>
interface Attempt { status: 'reserved' | 'running' | 'completed' | 'failed' | 'cancelled'; childId?: string; executionId?: string; stopReason?: string; validationFeedback?: string; errorCode?: string; returnedContent?: unknown; correction: boolean }
interface Checkpoint { version: string; fingerprint: string; attempts: Attempt[]; manuscript?: PlanningManuscript; recoveredFromAttempt?: number }
const processCopy = /造血载体|物理解耦|交通环境过滤缓冲器|多维协同|商用容量(?:保持)?为?0|安全无虞|确保零污染|完全不破坏|闭环管控/u

function cachedEditorialResponse(value: unknown): { chapters: PlanningManuscriptChapter[] } {
  const chapters = (value as { chapters?: unknown } | null)?.chapters
  if (!Array.isArray(chapters)) throw new Error('MANUSCRIPT_EDITORIAL_CHECKPOINT_INVALID: 成稿响应章节结构损坏。')
  return { chapters: chapters.map(chapter => migrateCachedPlanningChapter(chapter, 'MANUSCRIPT_EDITORIAL_CHECKPOINT_INVALID')) }
}

export function validateEditedManuscript(value: unknown, draft: PlanningManuscript, input: FrozenProjectInput, chapterId?: PlanningChapterId): PlanningManuscript {
  let chapters = (value as { chapters?: unknown })?.chapters
  if (chapterId) {
    if (!Array.isArray(chapters) || chapters.length !== 1 || chapters[0]?.id !== chapterId) throw new Error(`MANUSCRIPT_EDITORIAL_COVERAGE: 本次只能返回${chapterId}章。`)
    const edited = chapters[0]
    chapters = draft.chapters.map(chapter => chapter.id === chapterId ? edited : chapter)
  }
  const manuscript = validatePlanningManuscript({ ...draft, chapters }, input)
  manuscript.chapters.forEach((chapter, index) => {
    if (chapterId && chapter.id !== chapterId) return
    const prior = draft.chapters[index]!
    if (JSON.stringify(chapter.pages.map(p => [p.id, p.kind, [...p.sourceRefs].sort()])) !== JSON.stringify(prior.pages.map(p => [p.id, p.kind, [...p.sourceRefs].sort()]))) {
      throw new Error(`MANUSCRIPT_EDITORIAL_COVERAGE: ${chapter.id}须保留原页身份、产品类型与来源。`)
    }
    chapter.pages.forEach((page, pageIndex) => {
      const priorTable = prior.pages[pageIndex]!.table
      if (priorTable && (!page.table || page.table.rows.length !== priorTable.rows.length)) throw new Error(`MANUSCRIPT_EDITORIAL_COVERAGE: ${page.id}须保留原比较选项或经营分工表的全部行。`)
    })
    const copy = JSON.stringify({ title: chapter.title, thesis: chapter.thesis, pages: chapter.pages.map(({ notes: _notes, ...page }) => page) })
    const residue = processCopy.exec(copy)
    if (residue) throw new Error(`MANUSCRIPT_EDITORIAL_AUDIENCE: ${chapter.id}仍有过程套话“${residue[0]}”，应改为具体方案表达。`)
  })
  return manuscript
}

/** Final composition is a real, separately budgeted text-class child. */
export class PlanningManuscriptEditor {
  readonly version = PLANNING_EDITORIAL_VERSION
  private get maxConcurrency(): number { return resolveManuscriptConcurrency(this.dependencies.maxConcurrency) }
  constructor(private readonly dependencies: Pick<PlanningManuscriptServiceOptions, 'subagents' | 'agentClasses' | 'now' | 'timeoutMs' | 'maxConcurrency'>) {
    resolveManuscriptConcurrency(dependencies.maxConcurrency)
  }

  async edit(draft: PlanningManuscript, input: FrozenProjectInput, root: string, parent: Agent, signal: AbortSignal, assertCurrent: Guard, correctionsAvailable: number): Promise<PlanningManuscript> {
    const guard = async () => { signal.throwIfAborted(); await assertCurrent(); signal.throwIfAborted() }
    await guard()
    const fingerprint = createHash('sha256').update(JSON.stringify({ version: this.version, source: draft.sourceFingerprint, chapters: draft.chapters })).digest('hex')
    draft = validatePlanningManuscript(migrateCachedPlanningManuscript(draft, 'MANUSCRIPT_EDITORIAL_CHECKPOINT_INVALID'), input)
    const folder = join(root, '.pre-design', 'report-manuscript-editorial')
    const checkpoints = new Map<PlanningChapterId, Checkpoint>()
    const failures = new Map<PlanningChapterId, unknown>()
    for (const id of PLANNING_CHAPTER_IDS) {
      try { checkpoints.set(id, await this.readCheckpoint(join(folder, `${fingerprint}-${id}.json`), fingerprint)) }
      catch (error) { failures.set(id, error) }
    }
    const used = [...checkpoints.values()].reduce((sum, cp) => sum + cp.attempts.filter(a => a.correction).length, 0)
    const corrections = { remaining: failures.size ? 0 : correctionsAvailable - used }
    if (corrections.remaining < 0) throw new Error('MANUSCRIPT_CORRECTION_LIMIT: 成稿纠错记录超出本版额度。')
    let next = 0
    const completed = new Map<PlanningChapterId, PlanningManuscriptChapter>()
    const editedAt: string[] = []
    const worker = async () => {
        while (next < PLANNING_CHAPTER_IDS.length) {
          await guard()
          if (next >= PLANNING_CHAPTER_IDS.length) return
          const id = PLANNING_CHAPTER_IDS[next++]!
          if (failures.has(id)) continue
          try {
          const manuscript = await this.editChapter(id, checkpoints.get(id)!, fingerprint, draft, input, folder, parent, signal, guard, guard, corrections)
          completed.set(id, manuscript.chapters.find(c => c.id === id)!)
          if (manuscript.editorial) editedAt.push(manuscript.editorial.editedAt)
          } catch (error) { failures.set(id, error); signal.throwIfAborted() }
        }
    }
    const results = await Promise.allSettled(Array.from({ length: this.maxConcurrency }, worker))
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed) throw failed.reason
    if (failures.size) {
      const errorDirectory = join(root, '.pre-design', 'report-manuscript-errors')
      await guard(); await mkdir(errorDirectory, { recursive: true })
      await writeFile(join(errorDirectory, `${randomUUID()}.json`), JSON.stringify({ projectId: input.projectId, sourceRevision: input.revision,
        at: this.dependencies.now?.() ?? new Date().toISOString(), stage: 'editing',
        errors: [...failures].map(([chapterId, error]) => ({ chapterId, message: error instanceof Error ? error.message : String(error) })),
      }, null, 2) + '\n', { flag: 'wx', signal })
      throw failures.values().next().value
    }
    await guard()
    const manuscript = validateEditedManuscript({ chapters: PLANNING_CHAPTER_IDS.map(id => completed.get(id)) }, draft, input)
    return { ...manuscript, editorial: { version: this.version, draftFingerprint: fingerprint,
      editedAt: editedAt.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? this.dependencies.now?.() ?? new Date().toISOString() } }
  }

  private async readCheckpoint(path: string, fingerprint: string): Promise<Checkpoint> {
    let checkpoint: Checkpoint
    try { checkpoint = JSON.parse(await readFile(path, 'utf8')) as Checkpoint }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('MANUSCRIPT_EDITORIAL_CHECKPOINT_INVALID: 成稿编辑检查点不可读取。')
      checkpoint = { version: this.version, fingerprint, attempts: [] }
    }
    if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)
      || checkpoint.version !== this.version || checkpoint.fingerprint !== fingerprint || !Array.isArray(checkpoint.attempts)
      || checkpoint.attempts.some(a => !a || !['reserved', 'running', 'completed', 'failed', 'cancelled'].includes(a.status) || typeof a.correction !== 'boolean')) {
      throw new Error('MANUSCRIPT_EDITORIAL_CHECKPOINT_INVALID: 成稿编辑检查点与初稿不匹配。')
    }
    if (checkpoint.manuscript !== undefined) checkpoint.manuscript = migrateCachedPlanningManuscript(checkpoint.manuscript, 'MANUSCRIPT_EDITORIAL_CHECKPOINT_INVALID')
    return checkpoint
  }

  private async editChapter(chapterId: PlanningChapterId, checkpoint: Checkpoint, fingerprint: string, draft: PlanningManuscript, input: FrozenProjectInput, folder: string, parent: Agent, signal: AbortSignal, guard: Guard, dispatchGuard: Guard, corrections: { remaining: number }): Promise<PlanningManuscript> {
    const path = join(folder, `${fingerprint}-${chapterId}.json`)
    const persist = async () => {
      await mkdir(folder, { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      try { await writeFile(temporary, JSON.stringify(checkpoint, null, 2), { flag: 'wx' }); renameSync(temporary, path) }
      finally { await rm(temporary, { force: true }) }
    }
    const latest = checkpoint.attempts.at(-1)
    if (latest && ['reserved', 'running'].includes(latest.status)) throw new Error('MANUSCRIPT_RECOVERY_REQUIRED: 成稿编辑子会话尚未确认结束，不能重复派发。')
    if (checkpoint.manuscript !== undefined) {
      const recovered = checkpoint.recoveredFromAttempt === undefined ? undefined : checkpoint.attempts[checkpoint.recoveredFromAttempt]
      if ((latest?.status !== 'completed' && !(recovered?.stopReason === 'completed' && recovered.returnedContent && recovered.validationFeedback))
        || checkpoint.manuscript.editorial?.version !== this.version || checkpoint.manuscript.editorial.draftFingerprint !== fingerprint) throw new Error('MANUSCRIPT_EDITORIAL_CHECKPOINT_INVALID: 成稿缺少完成凭据。')
      if (recovered) validateEditedManuscript(cachedEditorialResponse(recovered.returnedContent), draft, input, chapterId)
      validatePlanningManuscript(checkpoint.manuscript, input)
      const cached = validateEditedManuscript({ chapters: checkpoint.manuscript.chapters.filter(c => c.id === chapterId) }, draft, input, chapterId)
      await guard()
      return { ...cached, editorial: checkpoint.manuscript.editorial }
    }
    // A validator compatibility fix can recover an already completed response.
    // Keep failed attempts and budget reservations intact, record its origin,
    // and never reuse truncated, running, or still-invalid model output.
    for (let index = checkpoint.attempts.length - 1; index >= 0; index--) {
      const previous = checkpoint.attempts[index]!
      if (previous.stopReason !== 'completed' || !previous.validationFeedback || previous.returnedContent === undefined) continue
      let recovered: PlanningManuscript
      try { recovered = validateEditedManuscript(cachedEditorialResponse(previous.returnedContent), draft, input, chapterId) }
      catch { continue }
      await guard()
      checkpoint.manuscript = { ...recovered, editorial: { version: this.version, draftFingerprint: fingerprint, editedAt: this.dependencies.now?.() ?? new Date().toISOString() } }
      checkpoint.recoveredFromAttempt = index
      await persist(); await guard()
      return checkpoint.manuscript
    }
    let nextExecution: Awaited<ReturnType<AgentClassService['begin']>> | undefined
    for (;;) {
      await dispatchGuard()
      const correction = Boolean(checkpoint.attempts.at(-1)?.validationFeedback)
      if (correction && corrections.remaining < 1) throw new Error('MANUSCRIPT_CORRECTION_LIMIT: 本版成稿纠错额度用尽。')
      if (correction) corrections.remaining--
      const rejected = [...checkpoint.attempts].reverse().find(a => a.validationFeedback)
      const attempt: Attempt = { status: 'reserved', correction }; checkpoint.attempts.push(attempt)
      let execution: Awaited<ReturnType<PlanningManuscriptServiceOptions['agentClasses']['begin']>> | undefined
      let run: Awaited<ReturnType<PlanningManuscriptServiceOptions['subagents']['start']>> | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      let taskSignal = signal
      try {
        await persist(); await dispatchGuard()
        execution = nextExecution ?? await this.dependencies.agentClasses.begin(input.projectId, 'text', `汇报文案：成稿编辑 ${chapterId}`, parent, signal)
        nextExecution = undefined
        attempt.executionId = execution.id; await persist(); await dispatchGuard()
        const deadline = new AbortController()
        timer = setTimeout(() => deadline.abort(new Error('MANUSCRIPT_EDITORIAL_TIMEOUT: 成稿编辑超时。')), this.dependencies.timeoutMs ?? 600_000)
        timer.unref?.(); taskSignal = AbortSignal.any([signal, deadline.signal])
        run = await this.dependencies.subagents.start('spawn', {
          parent, agentOptions: { ...execution.selected, maxTokens: 65536 }, signal: taskSignal,
          prompt: [{ type: 'text', text: buildEditorialPrompt(draft, makeSourceIndex(input), rejected?.validationFeedback, rejected?.returnedContent, chapterId) }],
          outputSchema: EDITORIAL_SCHEMA, maxDepth: 1, toolFilter: { allow: [] }, persona: EDITORIAL_PERSONA,
          label: `preplanning_manuscript:${input.projectId}:editorial:${chapterId}`,
        })
        const response = run.result.then(result => ({ result }), error => ({ error }))
        attempt.childId = String(run.id); attempt.status = 'running'; await persist()
        await this.dependencies.agentClasses.attach(execution.id, String(run.id))
        const settled = await new Promise<Awaited<typeof response>>((resolve, reject) => {
          const abort = () => { taskSignal.removeEventListener('abort', abort); reject(taskSignal.reason) }
          if (taskSignal.aborted) { reject(taskSignal.reason); return }
          taskSignal.addEventListener('abort', abort, { once: true })
          response.then(value => { taskSignal.removeEventListener('abort', abort); resolve(value) })
        })
        if ('error' in settled) throw settled.error
        taskSignal.throwIfAborted()
        attempt.stopReason = settled.result.stopReason
        if (attempt.stopReason !== 'completed') throw new Error(`MANUSCRIPT_EDITORIAL_INCOMPLETE: ${attempt.stopReason}，未发布成稿。`)
        attempt.returnedContent = settled.result.structured
        let manuscript: PlanningManuscript
        try { manuscript = validateEditedManuscript(settled.result.structured, draft, input, chapterId) }
        catch (error) { attempt.validationFeedback = error instanceof Error ? error.message : 'MANUSCRIPT_EDITORIAL_INVALID'; throw error }
        await guard(); await this.dependencies.agentClasses.finish(execution.id, 'completed'); await guard()
        manuscript = { ...manuscript, editorial: { version: this.version, draftFingerprint: fingerprint, editedAt: this.dependencies.now?.() ?? new Date().toISOString() } }
        attempt.status = 'completed'; delete attempt.returnedContent; checkpoint.manuscript = manuscript
        await persist(); await guard()
        return manuscript
      } catch (error) {
        attempt.status = signal.aborted ? 'cancelled' : 'failed'
        attempt.errorCode = error instanceof Error ? /^MANUSCRIPT_[A-Z_]+/u.exec(error.message)?.[0] ?? 'MANUSCRIPT_EDITORIAL_FAILED' : 'MANUSCRIPT_EDITORIAL_FAILED'
        delete checkpoint.manuscript
        if (execution) await this.dependencies.agentClasses.finish(execution.id, signal.aborted ? 'cancelled' : 'failed', attempt.errorCode).catch(() => undefined)
        await persist()
        if (signal.aborted) throw signal.reason
        if (taskSignal.aborted) throw taskSignal.reason
        if (!attempt.validationFeedback) {
          nextExecution = await nextAgentClassAttempt(this.dependencies.agentClasses, execution, parent, taskSignal)
          if (nextExecution) continue
        }
        if (!attempt.validationFeedback || corrections.remaining < 1) throw error
      } finally { if (timer) clearTimeout(timer); await run?.dispose().catch(() => undefined) }
    }
  }
}
