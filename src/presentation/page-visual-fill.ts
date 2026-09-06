import { lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DraftPageDocument, PageManifest } from '@architectureworld/presentation-contracts'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { VisualAssetRecord } from '../governance/types.ts'
import type { FrozenProjectInput } from '../report/types.ts'
import type { VisualAgentService } from '../visual/agent.ts'
import { sha256CanonicalJson } from './canonical-json.ts'
import { sha256File } from './filesystem.ts'
import { preparePresentationMaterials, type PreparePresentationMaterialsInput } from './material-registry.ts'
import { buildPresentationStandardProject } from './standard-project-adapter.ts'
import type { PresentationAdoptedAssetInput } from './standard-project-types.ts'
import { compileReportOutline } from './projector/report-outline.ts'
import { readPageVisualState, savePageVisualRequest, withPageVisualLock, type PageVisualRequest } from './page-visual-state.ts'

export const DEFAULT_PAGE_VISUAL_STYLE = '统一使用克制的低饱和自然材料、专业建筑可视化与清晰空间层次；无文字、标尺、水印或伪造数据。'
const IMAGE_MIME = /^image\/(?:avif|bmp|gif|jpeg|png|svg\+xml|webp|x-icon|vnd\.microsoft\.icon)$/iu
export interface PageVisualInput {
  readonly frozenProject: FrozenProjectInput
  readonly workspaceRoot: string
  readonly previous?: PreparePresentationMaterialsInput['previous']
}
interface GenerateInput extends PageVisualInput {
  readonly findingId: string
  readonly prompt: string
  readonly style?: string
  readonly signal?: AbortSignal
}
export interface PageVisualPlanEntry {
  readonly findingId: string
  readonly pageId: string
  readonly title: string
  readonly keyMessage: string
  readonly covered: boolean
  readonly imageCount: number
  readonly requestStatus?: PageVisualRequest['status']
  readonly contentHash: string
  readonly chapterId?: string
  readonly workItemId?: string
}
export interface PageVisualFillResult {
  readonly taskId: string
  readonly findingId: string
  readonly assetId: string
  readonly status: 'candidate' | 'adopted'
  readonly reused: boolean
}
interface Dependencies {
  readonly visual: Pick<VisualAgentService, 'generate' | 'adopt'>
  readonly governance: Pick<GovernanceRepository, 'readProject'>
  readonly resolveAsset: (fileName: string) => string
  readonly adoptedAssets?: (project: FrozenProjectInput) => readonly PresentationAdoptedAssetInput[]
}

function contentOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(contentOnly)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'sourceRefs' && !/Ids?$/u.test(key)).map(([key, child]) => [key, contentOnly(child)]))
}
function required(value: string | undefined, name: string): string {
  const result = value?.normalize('NFC').trim()
  if (!result || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result)) throw new Error(`PAGE_VISUAL_INVALID: ${name} 不能为空或包含控制字符`)
  return result
}

export class PageVisualFillService {
  private readonly inFlight = new Map<string, Promise<PageVisualFillResult>>()
  constructor(private readonly dependencies: Dependencies) {}

  /** Builds in memory only: no requests, candidates, files or model calls. */
  async plan(input: PageVisualInput): Promise<{ readonly pages: readonly PageVisualPlanEntry[]; readonly warnings: readonly string[] }> {
    const materials = await preparePresentationMaterials({ ...input, assets: this.dependencies.adoptedAssets?.(input.frozenProject) ?? [] })
    const build = await buildPresentationStandardProject({ frozenProject: input.frozenProject, ...materials, stableIds: input.previous?.stableIds })
    const findings = compileReportOutline(input.frozenProject)
    const state = await readPageVisualState(input.workspaceRoot, input.frozenProject.projectId)
    const assets = new Map(materials.assets.map(asset => [build.stableIds[`asset:asset:${asset.sourceKey}`], asset]))
    const pages = (build.documents['pages/manifest.json'] as PageManifest).pages.map(page => {
      const finding = findings.find(item => build.stableIds[`page:finding:${item.findingId}`] === page.pageId)!
      const draft = build.documents[page.draftPath!] as DraftPageDocument
      const source = input.frozenProject.stateObjects.find(object => finding.objectIds.includes(object.objectId) && object.workItemId)
      const images = draft.pageAssets.filter(link => ['primary', 'supporting', 'background'].includes(link.role)
        && IMAGE_MIME.test(assets.get(link.assetId)?.mimeType ?? ''))
      return { findingId: finding.findingId, pageId: page.pageId, title: finding.title, keyMessage: finding.keyMessage,
        covered: images.length > 0, imageCount: images.length,
        requestStatus: state.requests.filter(request => request.findingId === finding.findingId).at(-1)?.status,
        contentHash: sha256CanonicalJson(contentOnly({ contentBlocks: draft.contentBlocks, scriptBlocks: draft.scriptBlocks })),
        ...(source ? { chapterId: source.chapterId, workItemId: source.workItemId } : {}),
      }
    })
    return { pages, warnings: [...materials.materialWarnings, ...state.requests.filter(request => request.status === 'failed')
      .map(request => `补图 ${request.findingId} 未完成：${request.message ?? '生成失败'}`)] }
  }

  private async page(input: PageVisualInput & { findingId: string }): Promise<PageVisualPlanEntry> {
    const page = (await this.plan(input)).pages.find(item => item.findingId === input.findingId)
    if (!page) throw new Error(`PAGE_VISUAL_FINDING_NOT_FOUND: ${input.findingId}`)
    return page
  }

  private brief(input: GenerateInput, page: PageVisualPlanEntry): PageVisualRequest {
    const prompt = required(input.prompt, 'prompt')
    const style = required(input.style ?? DEFAULT_PAGE_VISUAL_STYLE, 'style')
    const briefHash = sha256CanonicalJson({ projectId: input.frozenProject.projectId, findingId: page.findingId, contentHash: page.contentHash, prompt, style })
    return { taskId: `page-fill-${briefHash}`, findingId: page.findingId, briefHash, prompt, style, status: 'generating' }
  }

  private async usableAsset(projectId: string, taskId: string, assetId?: string): Promise<VisualAssetRecord | undefined> {
    const candidates = this.dependencies.governance.readProject(projectId).visualAssets.filter(asset => asset.projectId === projectId && asset.taskId === taskId
      && (assetId === undefined || asset.assetId === assetId) && ['candidate', 'adopted'].includes(asset.status) && asset.quality?.accepted === true)
      .sort((left, right) => Number(right.status === 'adopted') - Number(left.status === 'adopted'))
    for (const asset of candidates) {
      const path = this.dependencies.resolveAsset(asset.fileName)
      try {
        const info = await lstat(path)
        if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error('素材文件无效')
        if (await sha256File(path) !== asset.sha256) throw new Error('素材哈希不匹配')
      } catch (error) { throw new Error(`PAGE_VISUAL_ASSET_UNAVAILABLE: ${asset.assetId} 原图缺失或无效`, { cause: error }) }
      return asset
    }
    return undefined
  }

  async generate(parent: Agent, input: GenerateInput): Promise<PageVisualFillResult> {
    input.signal?.throwIfAborted()
    const page = await this.page(input)
    const brief = this.brief(input, page)
    const key = `${resolve(input.workspaceRoot)}\0${brief.taskId}`
    const running = this.inFlight.get(key)
    if (running) return running
    const job = withPageVisualLock(input.workspaceRoot, async () => {
      input.signal?.throwIfAborted()
      const projectId = input.frozenProject.projectId
      const previous = (await readPageVisualState(input.workspaceRoot, projectId)).requests.find(item => item.taskId === brief.taskId)
      const existing = await this.usableAsset(projectId, brief.taskId, previous?.assetId)
      if (existing) {
        const status = existing.status as 'candidate' | 'adopted'
        await savePageVisualRequest(input.workspaceRoot, projectId, { ...brief, assetId: existing.assetId, status })
        return { taskId: brief.taskId, findingId: brief.findingId, assetId: existing.assetId, status, reused: true }
      }
      if (page.covered) throw new Error('PAGE_VISUAL_ALREADY_COVERED: 当前页已有可用图片，不自动替换')
      if (!page.chapterId || !page.workItemId) throw new Error('PAGE_VISUAL_SOURCE_REQUIRED: 页面缺少真实工作项归属')
      await savePageVisualRequest(input.workspaceRoot, projectId, brief)
      try {
        const asset = await this.dependencies.visual.generate(parent, { taskId: brief.taskId, projectId, chapterId: page.chapterId,
          workItemId: page.workItemId, kind: 'concept', required: false,
          prompt: `页面：${page.title}\n核心判断：${page.keyMessage}\n${brief.prompt}`, projectStyle: brief.style }, input.signal)
        input.signal?.throwIfAborted()
        if (asset.taskId !== brief.taskId || asset.projectId !== projectId || !['candidate', 'adopted'].includes(asset.status) || asset.quality?.accepted !== true) {
          throw new Error('PAGE_VISUAL_INVALID_RESULT: 未获得通过质量检查的候选图')
        }
        if (!await this.usableAsset(projectId, brief.taskId, asset.assetId)) throw new Error('PAGE_VISUAL_INVALID_RESULT: 候选图未保存')
        const status = asset.status as 'candidate' | 'adopted'
        await savePageVisualRequest(input.workspaceRoot, projectId, { ...brief, status, assetId: asset.assetId })
        return { taskId: brief.taskId, findingId: brief.findingId, assetId: asset.assetId, status, reused: false }
      } catch (error) {
        await savePageVisualRequest(input.workspaceRoot, projectId, { ...brief, status: 'failed', message: error instanceof Error ? error.message : String(error) })
        throw error
      }
    })
    this.inFlight.set(key, job)
    try { return await job } finally { this.inFlight.delete(key) }
  }

  async adopt(input: PageVisualInput & { readonly findingId: string; readonly assetId: string }): Promise<PageVisualFillResult> {
    const page = await this.page(input)
    return withPageVisualLock(input.workspaceRoot, async () => {
      const projectId = input.frozenProject.projectId
      const request = (await readPageVisualState(input.workspaceRoot, projectId)).requests.find(item => item.assetId === input.assetId && item.findingId === input.findingId)
      if (!request) throw new Error('PAGE_VISUAL_CANDIDATE_MISMATCH: 候选图不属于此页面')
      if (this.brief({ ...input, prompt: request.prompt, style: request.style }, page).briefHash !== request.briefHash) {
        throw new Error('PAGE_VISUAL_BRIEF_CHANGED: 页面内容已变化，请重新核对补图需求')
      }
      const asset = await this.usableAsset(projectId, request.taskId, input.assetId)
      if (!asset) throw new Error('PAGE_VISUAL_CANDIDATE_INVALID: 候选图不可采用')
      if (page.covered && asset.status !== 'adopted') throw new Error('PAGE_VISUAL_ALREADY_COVERED: 当前页已有可用图片，不自动替换')
      const adopted = asset.status === 'adopted' ? asset : await this.dependencies.visual.adopt(projectId, asset.assetId, input.frozenProject.revision)
      await savePageVisualRequest(input.workspaceRoot, projectId, { ...request, status: 'adopted' })
      return { taskId: request.taskId, findingId: request.findingId, assetId: adopted.assetId, status: 'adopted', reused: asset.status === 'adopted' }
    })
  }
}
