import { createHash } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { VisualAssetRecord, VisualTaskRecord } from '../governance/types.ts'
import { checkVisualQuality } from './quality.ts'
import type { VisualAssetStore } from './asset-store.ts'
import type { SessionImageCollector } from './session-image-collector.ts'
import { nextAgentClassAttempt, type AgentClassService } from '../agent-classes/service.ts'
import type { ClassExecution, ModelRoute } from '../agent-classes/types.ts'
import { preplanningChildToolFilter } from '../agent-classes/child-tool-boundary.ts'
import {
  VISUAL_MODEL_ID,
  VISUAL_MODEL_PROVIDER,
  VISUAL_SUBAGENT_PROVIDER,
  type VisualGenerationTask,
  type VisualImageData,
} from './types.ts'

const VISUAL_PERSONA = `你是前期策划项目的概念表现图专用视觉智能体。
只生成建筑、城市设计、空间意向和氛围的 AI 概念图片。图像来源与AI性质信息仅保留在独立资料依据，不写入汇报正文或图片。
输出完整单幅场景，画面延伸至四边，不留标题区、说明区或白边。不要在像素画面中绘制汉字、字母、数字、图注、标签、引线、图例或水印。
禁止使用 Shell、网页搜索、文件系统工具，禁止写 Project State、确认 Gate 或替代事实证据。
禁止调用任何工具（包括 subagent）或继续委派。只能由当前所选模型直接输出栅格图片；如果不能直接生图，说明能力不足并结束，禁止寻找或切换其他模型。
不得伪造红线、CAD/BIM、现状照片、法定地图、统计数据或已建成效果；资料不足时拒绝并说明缺口。
每次只处理一项视觉任务，输出图片，不替换调用方指定的模型。`

const DEFAULT_PROJECT_VISUAL_STYLE = `统一项目视觉风格：克制的低饱和自然材料，专业建筑与景观可视化，真实光影、清晰空间层次和适度使用者活动；场景、设施和建筑语言以当前项目依据与任务要求为准，不默认添加水体、滨水设施或大型建筑。画面不含文字、标尺、水印或数据标注。`

export interface VisualAgentDependencies {
  readonly agentClasses?: AgentClassService
  readonly governance: GovernanceRepository
  readonly llm: Pick<LlmRuntime, 'listModels'>
  readonly subagents: Pick<SubagentRuntime, 'startContinuable' | 'interrupt'>
  readonly collector: SessionImageCollector
  readonly store: VisualAssetStore
  readonly now?: () => string
}
export type VisualDispatchGuard = () => void | Promise<void | (() => void)>

export class VisualAgentError extends Error {
  constructor(readonly code: 'visual-model-unavailable' | 'visual-generation-failed' | 'visual-recovery-required' | 'visual-not-dispatched', message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'VisualAgentError'
  }
}

function reservedTaskChildId(task: VisualGenerationTask, attempt: number): string {
  const digest = createHash('sha256')
    .update(`${task.projectId}\0${task.taskId}\0${attempt}`)
    .digest('hex')
    .slice(0, 24)
  return `preplanning-visual-${digest}`
}

function taskPrompt(task: VisualGenerationTask): string {
  return [
    `当前唯一视觉任务 ${task.taskId}（${task.chapterId}/${task.workItemId}）`,
    '成果性质：AI 概念表现图，不是事实证据或已建成照片。',
    task.projectStyle ?? DEFAULT_PROJECT_VISUAL_STYLE,
    `任务要求：${task.prompt}`,
    task.referenceAssetIds?.length
      ? `仅将这些已核验参考资产作为构图依据：${task.referenceAssetIds.join('、')}`
      : '本任务没有参考资产；不得自行补造场地、红线、现状或法定数据。',
    '只生成当前任务的一张清晰概念图片；不得引用、重做、拼接或成对生成任何历史任务。',
  ].join('\n')
}

export class VisualAgentService {
  private readonly now: () => string

  constructor(private readonly dependencies: VisualAgentDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString())
  }

  findCandidate(projectId: string, taskId: string): VisualAssetRecord | undefined {
    const assets = this.dependencies.governance.readProject(projectId).visualAssets.filter(asset => asset.taskId === taskId)
    if (assets.some(asset => asset.status === 'rejected')) return undefined
    return assets.filter(asset => (asset.status === 'candidate' || asset.status === 'adopted') && asset.quality?.accepted === true)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  }

  async probeModel(): Promise<{
    provider: typeof VISUAL_MODEL_PROVIDER
    model: typeof VISUAL_MODEL_ID
    advertised: boolean
  }> {
    let advertised = false
    try {
      advertised = (await this.dependencies.llm.listModels(VISUAL_MODEL_PROVIDER))
        .some(row => row.id === VISUAL_MODEL_ID)
    } catch {
      advertised = false
    }
    return { provider: VISUAL_MODEL_PROVIDER, model: VISUAL_MODEL_ID, advertised }
  }

  private async startTaskAgent(
    parent: Agent,
    task: VisualGenerationTask,
    attempt: number,
    signal: AbortSignal,
    route: ModelRoute,
    beforeStart?: VisualDispatchGuard,
    onDispatch?: () => void,
  ): Promise<string> {
    if (!this.dependencies.agentClasses) await this.probeModel()
    signal.throwIfAborted()
    const finalCheck = await beforeStart?.()
    finalCheck?.()
    signal.throwIfAborted()
    const childId = reservedTaskChildId(task, attempt)
    try {
      onDispatch?.()
      const started = await this.dependencies.subagents.startContinuable({
        provider: VISUAL_SUBAGENT_PROVIDER,
        label: `preplanning_visual_task:${task.projectId}:${task.taskId}:${attempt}`,
        childId: childId as SessionId,
        request: {
          parent,
          prompt: [{ type: 'text', text: taskPrompt(task) }, ...(task.referenceContent ?? [])],
          agentOptions: { ...route, maxTokens: 8192 },
          maxDepth: 1,
          toolFilter: preplanningChildToolFilter('visual_task'),
          persona: VISUAL_PERSONA,
        },
        signal,
      })
      const actualChildId = String(started.childId)
      if (actualChildId !== childId) throw new Error('visual child identity changed during creation')
      return actualChildId
    } catch (error) {
      const reason = `视觉模型 ${route.provider}/${route.model} 启动失败。`
      throw new VisualAgentError('visual-model-unavailable', reason, { cause: error })
    }
  }

  async generate(
    parent: Agent,
    task: VisualGenerationTask,
    signal: AbortSignal = AbortSignal.timeout(600_000),
    options: { readonly preserveUncertain?: boolean; readonly recoveryOnly?: boolean; readonly beforeStart?: VisualDispatchGuard } = {},
  ): Promise<VisualAssetRecord> {
    const project = this.dependencies.governance.readProject(task.projectId)
    let existing = project.visualTasks
      .find(row => row.taskId === task.taskId)
    if (project.visualAssets.some(asset => asset.taskId === task.taskId && asset.status === 'rejected')) {
      throw new VisualAgentError('visual-generation-failed', 'VISUAL_BRIEF_REJECTED: 此任务图片已拒收，请修订场景要求后生成；不恢复已拒旧图')
    }
    let queued: VisualTaskRecord = existing ?? {
      taskId: task.taskId,
      projectId: task.projectId,
      chapterId: task.chapterId,
      workItemId: task.workItemId,
      kind: task.kind,
      required: task.required,
      status: 'queued',
      attempts: 0,
      updatedAt: this.now(),
    }
    await this.dependencies.governance.putVisualTask(queued)
    let nextExecution: ClassExecution | undefined
    for (;;) {
    let dispatched = false
    let preparedNewAttempt = false
    let producedImage = false
    let recoveredTerminalWithoutImage = false
    let execution = nextExecution
    nextExecution = undefined
    let executionId = execution?.id
    try {
      signal.throwIfAborted()
      let priorCompleted = false
      if (existing?.childId !== undefined && existing.attempts > 0
        && String(existing.childId) === reservedTaskChildId(task, existing.attempts)) {
        let lateImage: VisualImageData | undefined
        try {
          // Observe the same immutable live/cold snapshot for both image and terminal evidence.
          if (this.dependencies.collector.inspectExisting) {
            const observation = await this.dependencies.collector.inspectExisting(String(existing.childId), 0, signal)
            lateImage = observation.image; priorCompleted = observation.completed
          } else {
            lateImage = await this.dependencies.collector.findExistingImage(String(existing.childId), 0, signal)
            priorCompleted = await this.dependencies.collector.hasCompleted?.(String(existing.childId), signal) === true
          }
        } catch (error) {
          throw new VisualAgentError('visual-recovery-required', 'PAGE_VISUAL_RECOVERY_REQUIRED: 原子会话持久化记录暂不可核验，未启动新 attempt', { cause: error })
        }
        if (lateImage !== undefined) {
          lateImage = await this.settleAttemptImage(parent, existing, lateImage, signal)
          const { blockedReason: _blockedReason, ...recovered } = existing
          const recoveredRunning: VisualTaskRecord = {
            ...recovered,
            chapterId: task.chapterId,
            workItemId: task.workItemId,
            status: 'running',
            updatedAt: this.now(),
          }
          await this.dependencies.governance.putVisualTask(recoveredRunning)
          return await this.recordCandidate(task, recoveredRunning, lateImage, signal)
        }
      }
      if (options.recoveryOnly || (options.preserveUncertain && existing && existing.attempts > 0 && existing.status !== 'failed')) {
        if (!priorCompleted) throw new VisualAgentError('visual-recovery-required', 'PAGE_VISUAL_RECOVERY_REQUIRED: 原付费任务尚未终结或结果未知，未启动新 attempt')
        recoveredTerminalWithoutImage = true
        if (existing?.executionId && this.dependencies.agentClasses) {
          await this.dependencies.agentClasses.finish(existing.executionId, 'failed', '原付费任务已终结且未获得图像；可显式重试')
        }
        if (options.recoveryOnly) throw new VisualAgentError('visual-generation-failed', '原付费任务已终结且未获得图像；可显式重试')
      }
      const attempt = queued.attempts + 1
      execution ??= await this.dependencies.agentClasses?.begin(task.projectId, 'image', `${task.taskId} ${task.prompt}`, parent, signal)
      executionId = execution?.id
      const route = execution?.selected ?? { provider: VISUAL_MODEL_PROVIDER, model: VISUAL_MODEL_ID }
      const { blockedReason: _previousBlockedReason, ...attemptBase } = queued
      const starting: VisualTaskRecord = {
        ...attemptBase,
        status: 'running',
        attempts: attempt,
        modelRoute: route,
        executionId,
        // Reserve durable recovery identity before the transport can submit a paid request.
        ...(options.preserveUncertain ? { childId: reservedTaskChildId(task, attempt) as SessionId } : {}),
        updatedAt: this.now(),
      }
      preparedNewAttempt = true
      await this.dependencies.governance.putVisualTask(starting)
      if (executionId) await this.dependencies.agentClasses!.attach(executionId, reservedTaskChildId(task, attempt))
      const childId = await this.startTaskAgent(parent, task, attempt, signal, route, options.beforeStart, () => { dispatched = true })
      const running: VisualTaskRecord = { ...starting, childId: childId as SessionId, updatedAt: this.now() }
      let interrupted = false
      const interruptChild = () => {
        if (interrupted) return
        interrupted = true
        try {
          this.dependencies.subagents.interrupt(childId as SessionId, { kind: 'ancestor', agent: parent })
        } catch {
          // The caller deadline remains the governed visual failure when child interruption is rejected.
        }
      }
      signal.addEventListener('abort', interruptChild, { once: true })
      if (signal.aborted) interruptChild()
      try {
        await this.dependencies.governance.putVisualTask(running)
        const received = await this.dependencies.collector.waitForImage(childId, 0, signal)
        producedImage = true
        const image = await this.settleAttemptImage(parent, running, received, signal)
        return await this.recordCandidate(task, running, image, signal)
      } finally {
        signal.removeEventListener('abort', interruptChild)
      }
    } catch (error) {
      if (error instanceof VisualAgentError && error.code === 'visual-recovery-required') throw error
      const latest = this.dependencies.governance.readProject(task.projectId).visualTasks
        .find(row => row.taskId === task.taskId) ?? queued
      let latestCompleted = false
      if (options.preserveUncertain && dispatched && latest.childId) {
        try { latestCompleted = await this.dependencies.collector.hasCompleted?.(String(latest.childId), AbortSignal.timeout(5000)) === true }
        catch { /* Failed cold reads cannot settle an already submitted paid request. */ }
      }
      if (options.preserveUncertain && dispatched && !latestCompleted) {
        if (executionId) await this.dependencies.agentClasses!.finish(executionId, 'recovery_required', '原付费请求结果未知，等待恢复。')
        await this.dependencies.governance.putVisualTask({ ...latest, status: 'running', blockedReason: '原付费任务结果未知，等待恢复；未允许再次付费', updatedAt: this.now() })
        throw new VisualAgentError('visual-recovery-required', 'PAGE_VISUAL_RECOVERY_REQUIRED: 原付费任务结果未知，保留原 child 等待恢复', { cause: error })
      }
      if (executionId) await this.dependencies.agentClasses!.finish(executionId, signal.aborted ? 'cancelled' : 'failed', '图像任务失败；详情见视觉任务与子会话。')
      if (latest.status !== 'blocked' || recoveredTerminalWithoutImage) {
        await this.dependencies.governance.putVisualTask({
          ...latest,
          status: options.preserveUncertain || recoveredTerminalWithoutImage ? 'failed' : 'blocked',
          blockedReason: error instanceof Error ? error.message : '视觉生成失败',
          updatedAt: this.now(),
        })
      }
      if (!producedImage && !signal.aborted) {
        nextExecution = await nextAgentClassAttempt(this.dependencies.agentClasses, execution, parent, signal)
        if (nextExecution) {
          // A distinct paid attempt owns a new durable child ID. Keep every class
          // reservation and advance from the latest visual attempt, never zero.
          queued = this.dependencies.governance.readProject(task.projectId).visualTasks.find(row => row.taskId === task.taskId) ?? latest
          existing = undefined
          continue
        }
      }
      if (options.preserveUncertain && preparedNewAttempt && !dispatched) {
        throw new VisualAgentError('visual-not-dispatched', '视觉请求在实际提交前停止，可显式重试', { cause: error })
      }
      if (error instanceof VisualAgentError) throw error
      throw new VisualAgentError('visual-generation-failed', `视觉任务 '${task.taskId}' 生成失败`, { cause: error })
    }
    }
  }

  private async settleAttemptImage(parent: Agent, running: VisualTaskRecord, image: VisualImageData, signal: AbortSignal): Promise<VisualImageData> {
    signal.throwIfAborted()
    if (!image.attemptSource) return image
    try {
      if (!running.childId) throw new Error('failed-stream image has no owning child')
      const childId = String(running.childId)
      const observed = await this.dependencies.collector.inspectExisting(childId, 0, signal)
      if (observed.turn !== image.attemptSource.turn) throw new Error('visual turn changed before recovery')
      if (!observed.completed) {
        // Interrupt only the reserved child under the original ancestor authority. A request
        // to stop is not completion; observe its terminal before saving or finishing anything.
        try { this.dependencies.subagents.interrupt(running.childId as SessionId, { kind: 'ancestor', agent: parent }) }
        catch (error) { if (!await this.dependencies.collector.hasCompleted(childId, signal)) throw error }
        await this.dependencies.collector.waitUntilIdle(childId, AbortSignal.any([signal, AbortSignal.timeout(15_000)]))
      }
      const settled = await this.dependencies.collector.inspectExisting(childId, 0, signal)
      signal.throwIfAborted()
      if (!settled.completed || settled.turn !== image.attemptSource.turn || !settled.image) throw new Error('visual attempt settlement cannot be verified')
      return settled.image
    } catch (error) {
      signal.throwIfAborted()
      if (running.executionId && this.dependencies.agentClasses) {
        await this.dependencies.agentClasses.finish(running.executionId, 'recovery_required', '完整图片已收到，但原子会话终结尚未核实。')
      }
      await this.dependencies.governance.putVisualTask({ ...running, status: 'running',
        blockedReason: '原图等待子会话终结核验；未派发替代请求', updatedAt: this.now() })
      throw new VisualAgentError('visual-recovery-required', 'PAGE_VISUAL_RECOVERY_REQUIRED: 原图已收到，子会话终结核验未完成', { cause: error })
    }
  }

  private async recordCandidate(
    task: VisualGenerationTask,
    running: VisualTaskRecord,
    image: VisualImageData,
    signal: AbortSignal,
  ): Promise<VisualAssetRecord> {
    signal.throwIfAborted()
    const classes = this.dependencies.agentClasses
    if (image.attemptSource && running.executionId && classes) {
      const original = classes.execution(running.executionId)
      if (!original || original.classId !== 'image' || original.projectId !== task.projectId || original.childId !== running.childId
        || original.status === 'cancelled') throw new Error('VISUAL_RECOVERY_EXECUTION_UNVERIFIED: 原生图执行不允许恢复')
      // A verified artifact can survive a failed stream. Never rewrite its aborted
      // native execution as completed, including when its session is unloaded.
      await classes.finish(original.id, 'failed', original.status === 'failed' && original.error ? original.error
        : '流式生图未正常结束；完整图像已独立核验，原执行仍保留失败状态。')
      const observed = classes.execution(original.id)!
      if (!observed.actual || observed.actual.provider !== original.selected.provider || observed.actual.model !== original.selected.model
        || observed.error?.startsWith('MODEL_ROUTE_MISMATCH')
        || running.modelRoute?.provider !== original.selected.provider || running.modelRoute.model !== original.selected.model) {
        throw new Error('VISUAL_RECOVERY_ROUTE_UNVERIFIED: 完整图像的实际模型与原派发记录不一致')
      }
      signal.throwIfAborted()
    }
    const stored = await this.dependencies.store.saveCandidate(task, image)
    signal.throwIfAborted()
    const quality = checkVisualQuality({
      mimeType: stored.mimeType,
      width: stored.width,
      height: stored.height,
      bytes: typeof image.data === 'string' ? Buffer.from(image.data, 'base64').byteLength : image.data.byteLength,
    })
    const candidate: VisualAssetRecord = {
      ...stored,
      status: quality.accepted ? 'candidate' : 'rejected',
      provider: running.modelRoute?.provider ?? VISUAL_MODEL_PROVIDER,
      model: running.modelRoute?.model ?? VISUAL_MODEL_ID,
      promptSummary: task.prompt.slice(0, 240),
      ...(image.attemptSource ? { recoveredFrom: { childId: running.childId!,
        ...(running.executionId ? { executionId: running.executionId } : {}), ...image.attemptSource } } : {}),
      quality,
    }
    if (running.executionId && classes && !image.attemptSource) {
      await classes.finish(running.executionId, quality.accepted ? 'completed' : 'failed', quality.accepted ? undefined : quality.issues.join('；'))
    }
    await this.dependencies.governance.putVisualAsset(candidate)
    await this.dependencies.governance.putVisualTask({
      ...running,
      status: quality.accepted ? 'candidate_ready' : 'failed',
      ...(quality.accepted ? {} : { blockedReason: quality.issues.join('；') }),
      updatedAt: this.now(),
    })
    return candidate
  }

  async adopt(projectId: string, assetId: string, revision: number): Promise<VisualAssetRecord> {
    const project = this.dependencies.governance.readProject(projectId)
    const asset = project.visualAssets.find(row => row.assetId === assetId)
    if (asset === undefined || asset.status !== 'candidate' || asset.quality?.accepted !== true) {
      throw new Error(`quality-approved visual candidate '${assetId}' not found`)
    }
    const adopted: VisualAssetRecord = { ...asset, status: 'adopted', adoptedRevision: revision }
    await this.dependencies.governance.putVisualAsset(adopted)
    const task = project.visualTasks.find(row => row.taskId === asset.taskId)
    if (task !== undefined) {
      const { blockedReason: _previousBlockedReason, ...adoptedTask } = task
      await this.dependencies.governance.putVisualTask({ ...adoptedTask, status: 'adopted', updatedAt: this.now() })
    }
    return adopted
  }

  async reject(projectId: string, assetId: string, reason: string): Promise<void> {
    if (!reason.trim()) throw new Error('VISUAL_REJECTION_REASON_REQUIRED')
    const project = this.dependencies.governance.readProject(projectId)
    const asset = project.visualAssets.find(row => row.assetId === assetId)
    if (!asset) throw new Error('VISUAL_ASSET_NOT_FOUND')
    await this.dependencies.governance.putVisualAsset({ ...asset, status: 'rejected',
      quality: { accepted: false, score: 0, issues: [reason] } })
    const task = project.visualTasks.find(row => row.taskId === asset.taskId)
    if (task) await this.dependencies.governance.putVisualTask({ ...task, status: 'failed', blockedReason: reason, updatedAt: this.now() })
  }

  async replace(
    projectId: string,
    rejectedAssetId: string,
    replacementAssetId: string,
  ): Promise<{ readonly rejectedAssetId: string; readonly replacementAssetId: string }> {
    const project = this.dependencies.governance.readProject(projectId)
    const rejectedAsset = project.visualAssets.find(row => row.assetId === rejectedAssetId)
    const replacementAsset = project.visualAssets.find(row => row.assetId === replacementAssetId)
    if (rejectedAsset === undefined || rejectedAsset.status !== 'candidate') {
      throw new Error(`visual candidate '${rejectedAssetId}' is not available for replacement`)
    }
    if (replacementAsset === undefined || replacementAsset.status !== 'adopted') {
      throw new Error(`adopted replacement visual '${replacementAssetId}' not found`)
    }
    const rejectedTask = project.visualTasks.find(row => row.taskId === rejectedAsset.taskId)
    const replacementTask = project.visualTasks.find(row => row.taskId === replacementAsset.taskId)
    if (rejectedTask === undefined || replacementTask === undefined
      || rejectedTask.chapterId !== replacementTask.chapterId
      || rejectedTask.workItemId !== replacementTask.workItemId
      || rejectedTask.kind !== replacementTask.kind) {
      throw new Error('replacement visual does not match the rejected visual brief')
    }
    await this.dependencies.governance.putVisualAsset({ ...rejectedAsset, status: 'rejected' })
    await this.dependencies.governance.putVisualTask({
      ...rejectedTask,
      required: false,
      status: 'failed',
      blockedReason: `已由采用资产 ${replacementAssetId} 替代`,
      updatedAt: this.now(),
    })
    return { rejectedAssetId, replacementAssetId }
  }
}
