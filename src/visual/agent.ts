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
import {
  VISUAL_MODEL_ID,
  VISUAL_MODEL_PROVIDER,
  VISUAL_SUBAGENT_PROVIDER,
  type VisualGenerationTask,
  type VisualImageData,
} from './types.ts'

const VISUAL_PERSONA = `你是前期策划项目的概念表现图专用视觉智能体。
只生成明确标注为“AI 概念表现”的建筑、城市设计、空间意向和氛围图片。
禁止使用 Shell、网页搜索、文件系统工具，禁止写 Project State、确认 Gate 或替代事实证据。
不得伪造红线、CAD/BIM、现状照片、法定地图、统计数据或已建成效果；资料不足时拒绝并说明缺口。
每次只处理一项视觉任务，输出图片，不替换调用方指定的模型。`

const DEFAULT_PROJECT_VISUAL_STYLE = `统一项目视觉风格：现代东方建筑语言，克制的低饱和自然材料，连续流动的滨水公共空间，生态景观与文化建筑一体化；采用专业建筑竞赛级可视化、真实光影、清晰空间层次和适度人群活动，画面不含文字、标尺、水印或数据标注。`

export interface VisualAgentDependencies {
  readonly governance: GovernanceRepository
  readonly llm: Pick<LlmRuntime, 'listModels'>
  readonly subagents: Pick<SubagentRuntime, 'startContinuable'>
  readonly collector: SessionImageCollector
  readonly store: VisualAssetStore
  readonly now?: () => string
}

export class VisualAgentError extends Error {
  constructor(readonly code: 'visual-model-unavailable' | 'visual-generation-failed', message: string, options?: ErrorOptions) {
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
  ): Promise<string> {
    await this.probeModel()
    const childId = reservedTaskChildId(task, attempt)
    try {
      const started = await this.dependencies.subagents.startContinuable({
        provider: VISUAL_SUBAGENT_PROVIDER,
        label: `preplanning_visual_task:${task.projectId}:${task.taskId}:${attempt}`,
        childId: childId as SessionId,
        request: {
          parent,
          prompt: [{ type: 'text', text: taskPrompt(task) }, ...(task.referenceContent ?? [])],
          agentOptions: { provider: VISUAL_MODEL_PROVIDER, model: VISUAL_MODEL_ID, maxTokens: 8192 },
          maxDepth: 1,
          toolFilter: { allow: [] },
          persona: VISUAL_PERSONA,
        },
        signal,
      })
      const actualChildId = String(started.childId)
      if (actualChildId !== childId) throw new Error('visual child identity changed during creation')
      return actualChildId
    } catch (error) {
      const reason = `固定视觉模型 ${VISUAL_MODEL_PROVIDER}/${VISUAL_MODEL_ID} 不可用；禁止替换模型。`
      throw new VisualAgentError('visual-model-unavailable', reason, { cause: error })
    }
  }

  async generate(
    parent: Agent,
    task: VisualGenerationTask,
    signal: AbortSignal = AbortSignal.timeout(600_000),
  ): Promise<VisualAssetRecord> {
    const existing = this.dependencies.governance.readProject(task.projectId).visualTasks
      .find(row => row.taskId === task.taskId)
    const queued: VisualTaskRecord = existing ?? {
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
    try {
      if (existing?.childId !== undefined && existing.attempts > 0
        && String(existing.childId) === reservedTaskChildId(task, existing.attempts)) {
        const lateImage = await this.dependencies.collector.findExistingImage(String(existing.childId), 0, signal)
        if (lateImage !== undefined) {
          const { blockedReason: _blockedReason, ...recovered } = existing
          const recoveredRunning: VisualTaskRecord = {
            ...recovered,
            chapterId: task.chapterId,
            workItemId: task.workItemId,
            status: 'running',
            updatedAt: this.now(),
          }
          await this.dependencies.governance.putVisualTask(recoveredRunning)
          return await this.recordCandidate(task, recoveredRunning, lateImage)
        }
      }
      const attempt = queued.attempts + 1
      const { blockedReason: _previousBlockedReason, ...attemptBase } = queued
      const starting: VisualTaskRecord = {
        ...attemptBase,
        status: 'running',
        attempts: attempt,
        updatedAt: this.now(),
      }
      await this.dependencies.governance.putVisualTask(starting)
      const childId = await this.startTaskAgent(parent, task, attempt, signal)
      const running: VisualTaskRecord = { ...starting, childId: childId as SessionId, updatedAt: this.now() }
      await this.dependencies.governance.putVisualTask(running)
      const image = await this.dependencies.collector.waitForImage(childId, 0, signal)
      return await this.recordCandidate(task, running, image)
    } catch (error) {
      const latest = this.dependencies.governance.readProject(task.projectId).visualTasks
        .find(row => row.taskId === task.taskId) ?? queued
      if (latest.status !== 'blocked') {
        await this.dependencies.governance.putVisualTask({
          ...latest,
          status: 'blocked',
          blockedReason: error instanceof Error ? error.message : '视觉生成失败',
          updatedAt: this.now(),
        })
      }
      if (error instanceof VisualAgentError) throw error
      throw new VisualAgentError('visual-generation-failed', `视觉任务 '${task.taskId}' 生成失败`, { cause: error })
    }
  }

  private async recordCandidate(
    task: VisualGenerationTask,
    running: VisualTaskRecord,
    image: VisualImageData,
  ): Promise<VisualAssetRecord> {
    const stored = await this.dependencies.store.saveCandidate(task, image)
    const quality = checkVisualQuality({
      mimeType: stored.mimeType,
      width: stored.width,
      height: stored.height,
      bytes: typeof image.data === 'string' ? Buffer.from(image.data, 'base64').byteLength : image.data.byteLength,
    })
    const candidate: VisualAssetRecord = {
      ...stored,
      status: quality.accepted ? 'candidate' : 'rejected',
      provider: VISUAL_MODEL_PROVIDER,
      model: VISUAL_MODEL_ID,
      promptSummary: task.prompt.slice(0, 240),
      quality,
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
}
