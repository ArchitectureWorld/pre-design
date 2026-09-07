import { lstat, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DraftPageDocument, PageManifest } from '@architectureworld/presentation-contracts'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { VisualAssetRecord } from '../governance/types.ts'
import { verifiedRasterImageDimensions } from '../governance/site-boundary-asset-store.ts'
import type { FrozenProjectInput } from '../report/types.ts'
import { VisualAgentError, type VisualAgentService, type VisualDispatchGuard } from '../visual/agent.ts'
import { sha256CanonicalJson } from './canonical-json.ts'
import { sha256File } from './filesystem.ts'
import { preparePresentationMaterials, type PreparePresentationMaterialsInput } from './material-registry.ts'
import { buildPresentationStandardProject } from './standard-project-adapter.ts'
import type { PresentationAdoptedAssetInput } from './standard-project-types.ts'
import { compileReportOutline } from './projector/report-outline.ts'
import { readPageVisualState, savePageVisualRequest, withPageVisualLock, type PageVisualRequest, type StudioPageVisualTarget, type StudioPageVisualLinkReceipt } from './page-visual-state.ts'

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
export interface StudioVisualInput extends PageVisualInput {
  readonly runId: string
  readonly assertCurrent?: () => void
  readonly beforeStart?: VisualDispatchGuard
  readonly target: StudioPageVisualTarget
  readonly requestId: string
  readonly title: string
  readonly keyMessage: string
  readonly chapterId: string
  readonly workItemId: string
  readonly prompt: string
  readonly style?: string
  readonly signal?: AbortSignal
}
export interface StudioVisualLinkConfirmation {
  readonly workspaceRoot: string
  readonly projectId: string
  readonly runId: string
  readonly studioProjectId: string
  readonly pageId: string
  readonly sourceStateHash: string
  readonly requestId: string
  readonly prompt: string
  readonly style?: string
  readonly assetId: string
  readonly signal?: AbortSignal
}
interface GeneratedAssetResult {
  readonly taskId: string
  readonly assetId: string
  readonly status: 'candidate' | 'adopted'
  readonly reused: boolean
}
export interface StudioVisualResult extends Omit<GeneratedAssetResult, 'status'> {
  readonly status: 'candidate' | 'adopted_unlinked'
  readonly requestId: string
  readonly target: StudioPageVisualTarget
  readonly image: { readonly bytes: Uint8Array; readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; readonly sha256: string; readonly width: number; readonly height: number }
  readonly provenance: { readonly kind: 'ai_concept'; readonly preDesignProjectId: string; readonly preDesignRevision: number;
    readonly studioProjectId: string; readonly pageId: string; readonly sourceStateHash: string; readonly sourceObjectIds: readonly string[];
    readonly provider?: string; readonly model?: string; readonly promptSummary?: string; readonly createdAt: string; readonly adoptedRevision?: number;
    readonly declarations: readonly ['AI 概念示意（非现场实拍）'] }
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
function textValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && !/[\u0000-\u001f]/u.test(value)
}

async function verifyPageImage(asset: PresentationAdoptedAssetInput): Promise<void> {
  const info = await lstat(asset.sourcePath)
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error('图片为空或不是普通文件')
  const bytes = await readFile(asset.sourcePath)
  const mime = asset.mimeType.toLowerCase()
  let dimensions: { width: number; height: number }
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp') {
    dimensions = verifiedRasterImageDimensions(mime, bytes)
  } else if (mime === 'image/svg+xml') {
    const svg = bytes.toString('utf8').replace(/^\uFEFF/u, '').replace(/^\s*<\?xml[^>]*\?>/u, '').trim()
    const document = /^<svg\b([^>]*?)(?:\/>|>[\s\S]*<\/svg>)$/u.exec(svg)
    const attributes = document?.[1] ?? ''
    const attribute = (name: string): string | undefined => new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'u').exec(attributes)?.[2]
    if (!document || attribute('xmlns') !== 'http://www.w3.org/2000/svg') throw new Error('SVG 文档无效')
    const viewBox = attribute('viewBox')?.trim().split(/[\s,]+/u).map(Number)
    const length = (name: string, fallback: number | undefined): number => {
      const value = attribute(name)
      return value === undefined ? fallback ?? Number.NaN : /^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/u.test(value) ? Number.parseFloat(value) : Number.NaN
    }
    dimensions = { width: length('width', viewBox?.length === 4 ? viewBox[2] : undefined), height: length('height', viewBox?.length === 4 ? viewBox[3] : undefined) }
  } else {
    throw new Error(`尚不能核验 ${asset.mimeType} 的图像字节，请采用可核验的 PNG/JPEG/WebP/SVG`)
  }
  if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0
    || (asset.widthPx !== undefined && asset.widthPx !== dimensions.width) || (asset.heightPx !== undefined && asset.heightPx !== dimensions.height)) {
    throw new Error('图片实际尺寸无效或与登记不一致')
  }
}

export class PageVisualFillService {
  private readonly inFlight = new Map<string, Promise<GeneratedAssetResult>>()
  constructor(private readonly dependencies: Dependencies) {}

  /** Builds in memory only: no requests, candidates, files or model calls. */
  async plan(input: PageVisualInput): Promise<{ readonly pages: readonly PageVisualPlanEntry[]; readonly warnings: readonly string[] }> {
    const materials = await preparePresentationMaterials({ ...input, assets: this.dependencies.adoptedAssets?.(input.frozenProject) ?? [] })
    const build = await buildPresentationStandardProject({ frozenProject: input.frozenProject, ...materials, stableIds: input.previous?.stableIds })
    const findings = compileReportOutline(input.frozenProject)
    const state = await readPageVisualState(input.workspaceRoot, input.frozenProject.projectId)
    const verifiedImageIds = new Set<string>()
    const imageWarnings: string[] = []
    for (const asset of materials.assets) {
      if (!IMAGE_MIME.test(asset.mimeType)) continue
      const assetId = build.stableIds[`asset:asset:${asset.sourceKey}`]
      if (assetId === undefined || verifiedImageIds.has(assetId)) continue
      try { await verifyPageImage(asset); verifiedImageIds.add(assetId) } catch (error) {
        imageWarnings.push(`PAGE_VISUAL_IMAGE_UNAVAILABLE: ${asset.sourceKey} 未计为已覆盖：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const pages = (build.documents['pages/manifest.json'] as PageManifest).pages.map(page => {
      const finding = findings.find(item => build.stableIds[`page:finding:${item.findingId}`] === page.pageId)!
      const draft = build.documents[page.draftPath!] as DraftPageDocument
      const source = input.frozenProject.stateObjects.find(object => finding.objectIds.includes(object.objectId) && object.workItemId)
      const images = draft.pageAssets.filter(link => ['primary', 'supporting', 'background'].includes(link.role)
        && verifiedImageIds.has(link.assetId))
      return { findingId: finding.findingId, pageId: page.pageId, title: finding.title, keyMessage: finding.keyMessage,
        covered: images.length > 0, imageCount: images.length,
        requestStatus: state.requests.filter(request => request.findingId === finding.findingId).at(-1)?.status,
        contentHash: sha256CanonicalJson(contentOnly({ contentBlocks: draft.contentBlocks, scriptBlocks: draft.scriptBlocks })),
        ...(source ? { chapterId: source.chapterId, workItemId: source.workItemId } : {}),
      }
    })
    return { pages, warnings: [...materials.materialWarnings, ...imageWarnings, ...state.requests.filter(request => request.status === 'failed')
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
    return { ...await this.generateTarget(parent, input, page, brief), findingId: page.findingId }
  }

  private async generateTarget(parent: Agent, input: PageVisualInput & { signal?: AbortSignal; beforeStart?: VisualDispatchGuard },
    page: Pick<PageVisualPlanEntry, 'title' | 'keyMessage' | 'covered' | 'chapterId' | 'workItemId'>, brief: PageVisualRequest): Promise<GeneratedAssetResult> {
    const key = `${resolve(input.workspaceRoot)}\0${brief.taskId}`
    const running = this.inFlight.get(key)
    if (running) return running
    const job = withPageVisualLock(input.workspaceRoot, async () => {
      input.signal?.throwIfAborted()
      const projectId = input.frozenProject.projectId
      const previous = (await readPageVisualState(input.workspaceRoot, projectId)).requests.find(item => item.taskId === brief.taskId)
      if (brief.target) {
        const request = (await readPageVisualState(input.workspaceRoot, projectId)).requests.find(item => item.target && item.requestId === brief.requestId)
        if (request && (request.briefHash !== brief.briefHash || (request.runId !== undefined && request.runId !== brief.runId))) throw new Error('DESIGN_VISUAL_REQUEST_CONFLICT: requestId 已用于不同内容或运行任务')
      }
      const existing = await this.usableAsset(projectId, brief.taskId, previous?.assetId)
      const recoveryOnly = !!previous && (previous.status === 'recovery_required' || (!!brief.target && previous.status === 'generating')) && !existing
      if (previous && previous.status !== 'failed' && ((!existing && !recoveryOnly) || (['adopted', 'adopted_unlinked', 'linked'].includes(previous.status) && existing?.status !== 'adopted'))) {
        throw new Error('PAGE_VISUAL_RECOVERY_REQUIRED: 已有补图请求暂无法从治理状态恢复，未再次生成；请重新加载治理状态并核查原请求')
      }
      if (existing) {
        const status = existing.status as 'candidate' | 'adopted'
        const requestStatus = brief.target && status === 'adopted' ? (previous?.status === 'linked' ? 'linked' : 'adopted_unlinked') : status
        await savePageVisualRequest(input.workspaceRoot, projectId, { ...brief, assetId: existing.assetId, status: requestStatus, ...(requestStatus === 'linked' ? { linkReceipt: previous?.linkReceipt } : {}) })
        return { taskId: brief.taskId, assetId: existing.assetId, status, reused: true }
      }
      if (page.covered) throw new Error('PAGE_VISUAL_ALREADY_COVERED: 当前页已有可用图片，不自动替换')
      if (!page.chapterId || !page.workItemId) throw new Error('PAGE_VISUAL_SOURCE_REQUIRED: 页面缺少真实工作项归属')
      await savePageVisualRequest(input.workspaceRoot, projectId, recoveryOnly ? { ...brief, status: 'recovery_required' } : brief)
      try {
        const asset = await this.dependencies.visual.generate(parent, { taskId: brief.taskId, projectId, chapterId: page.chapterId,
          workItemId: page.workItemId, kind: 'concept', required: false,
          prompt: `页面：${page.title}\n核心判断：${page.keyMessage}\n${brief.prompt}`, projectStyle: brief.style }, input.signal,
        { preserveUncertain: true, recoveryOnly, beforeStart: input.beforeStart })
        input.signal?.throwIfAborted()
        if (asset.taskId !== brief.taskId || asset.projectId !== projectId || !['candidate', 'adopted'].includes(asset.status) || asset.quality?.accepted !== true) {
          throw new Error('PAGE_VISUAL_INVALID_RESULT: 未获得通过质量检查的候选图')
        }
        if (!await this.usableAsset(projectId, brief.taskId, asset.assetId)) throw new Error('PAGE_VISUAL_INVALID_RESULT: 候选图未保存')
        const status = asset.status as 'candidate' | 'adopted'
        await savePageVisualRequest(input.workspaceRoot, projectId, { ...brief, status, assetId: asset.assetId })
        return { taskId: brief.taskId, assetId: asset.assetId, status, reused: false }
      } catch (error) {
        // VisualAgent classifies actual dispatch/terminal evidence; an aborted signal alone
        // must not override its confirmed pre-dispatch failure and strand an unstarted child.
        const confirmedUnsubmitted = error instanceof VisualAgentError && error.code === 'visual-not-dispatched'
        const uncertain = !confirmedUnsubmitted && (input.signal?.aborted || (error instanceof VisualAgentError && error.code === 'visual-recovery-required'))
        await savePageVisualRequest(input.workspaceRoot, projectId, { ...brief, status: uncertain ? 'recovery_required' : 'failed', message: error instanceof Error ? error.message : String(error) })
        throw error
      }
    })
    this.inFlight.set(key, job)
    try { return await job } finally { this.inFlight.delete(key) }
  }

  private studioBrief(input: StudioVisualInput): PageVisualRequest {
    const runId = required(input.runId, 'runId')
    const prompt = required(input.prompt, 'prompt')
    const style = required(input.style ?? DEFAULT_PAGE_VISUAL_STYLE, 'style')
    const requestId = required(input.requestId, 'requestId')
    const briefHash = sha256CanonicalJson({ target: input.target, requestId, prompt, style })
    return { taskId: `page-fill-${briefHash}`, target: input.target, requestId, runId, briefHash, prompt, style, status: 'generating' }
  }

  private async studioResult(input: StudioVisualInput, result: GeneratedAssetResult): Promise<StudioVisualResult> {
    const asset = await this.usableAsset(input.frozenProject.projectId, result.taskId, result.assetId)
    if (!asset) throw new Error('PAGE_VISUAL_CANDIDATE_INVALID: 候选图不可用')
    const sourcePath = this.dependencies.resolveAsset(asset.fileName)
    const bytes = await readFile(sourcePath)
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('PAGE_VISUAL_ASSET_UNAVAILABLE: 返回图像字节哈希不匹配')
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType)) throw new Error('PAGE_VISUAL_IMAGE_UNAVAILABLE: 不支持的图像格式')
    const mimeType = asset.mimeType as StudioVisualResult['image']['mimeType']
    const dimensions = verifiedRasterImageDimensions(mimeType, bytes)
    if (dimensions.width !== asset.width || dimensions.height !== asset.height) throw new Error('PAGE_VISUAL_IMAGE_UNAVAILABLE: 尺寸不匹配')
    return { ...result, status: asset.status === 'adopted' ? 'adopted_unlinked' : 'candidate', requestId: input.requestId, target: input.target,
      image: { bytes, mimeType, sha256: asset.sha256, ...dimensions },
      provenance: { kind: 'ai_concept', preDesignProjectId: input.frozenProject.projectId, preDesignRevision: input.frozenProject.revision,
        studioProjectId: input.target.studioProjectId, pageId: input.target.pageId, sourceStateHash: input.target.sourceStateHash,
        sourceObjectIds: input.target.sourceObjectIds, provider: asset.provider, model: asset.model, promptSummary: asset.promptSummary,
        createdAt: asset.createdAt, adoptedRevision: asset.adoptedRevision, declarations: ['AI 概念示意（非现场实拍）'] } }
  }

  async generateStudioPage(parent: Agent, input: StudioVisualInput): Promise<StudioVisualResult> {
    input.signal?.throwIfAborted()
    const result = await this.generateTarget(parent, input, { ...input, covered: false }, this.studioBrief(input))
    return this.studioResult(input, result)
  }

  async adoptStudioPage(input: StudioVisualInput & { assetId: string },
    authorize: (candidate: { requestId: string; assetId: string }) => Promise<() => void>): Promise<StudioVisualResult> {
    input.signal?.throwIfAborted()
    return withPageVisualLock(input.workspaceRoot, async () => {
      const projectId = input.frozenProject.projectId
      const brief = this.studioBrief(input)
      const request = (await readPageVisualState(input.workspaceRoot, projectId)).requests.find(item => item.target && item.requestId === input.requestId)
      if (!request || request.briefHash !== brief.briefHash || (request.runId !== undefined && request.runId !== input.runId) || request.assetId !== input.assetId) throw new Error('PAGE_VISUAL_CANDIDATE_MISMATCH: 候选图与页面请求不匹配')
      const asset = await this.usableAsset(projectId, request.taskId, request.assetId)
      if (!asset) throw new Error('PAGE_VISUAL_CANDIDATE_INVALID: 候选图不可采用')
      const result = await this.studioResult(input, { taskId: request.taskId, assetId: asset.assetId, status: asset.status as 'candidate' | 'adopted', reused: asset.status === 'adopted' })
      const assertAuthorized = await authorize({ requestId: request.requestId!, assetId: asset.assetId })
      input.signal?.throwIfAborted()
      assertAuthorized()
      const adopted = asset.status === 'adopted' ? asset : await this.dependencies.visual.adopt(projectId, asset.assetId, input.frozenProject.revision)
      if (request.status !== 'linked') await savePageVisualRequest(input.workspaceRoot, projectId, { ...request, runId: input.runId, status: 'adopted_unlinked' })
      input.signal?.throwIfAborted()
      return { ...result, status: 'adopted_unlinked', provenance: { ...result.provenance, adoptedRevision: adopted.adoptedRevision } }
    })
  }

  async confirmStudioPageLinked(input: StudioVisualLinkConfirmation, linkReceipt: StudioPageVisualLinkReceipt): Promise<StudioPageVisualLinkReceipt> {
    input.signal?.throwIfAborted()
    return withPageVisualLock(input.workspaceRoot, async () => {
      const prompt = required(input.prompt, 'prompt')
      const style = required(input.style ?? DEFAULT_PAGE_VISUAL_STYLE, 'style')
      const requestId = required(input.requestId, 'requestId')
      const request = (await readPageVisualState(input.workspaceRoot, input.projectId)).requests.find(item => item.target && item.requestId === requestId)
      const briefHash = request?.target === undefined ? '' : sha256CanonicalJson({ target: request.target, requestId, prompt, style })
      if (!request || !request.target || request.target.preDesignProjectId !== input.projectId
        || request.target.studioProjectId !== input.studioProjectId || request.target.pageId !== input.pageId
        || request.target.sourceStateHash !== input.sourceStateHash || request.runId !== input.runId || request.briefHash !== briefHash
        || request.assetId !== input.assetId || !['adopted_unlinked', 'linked'].includes(request.status)) {
        throw new Error('PAGE_VISUAL_LINK_RECEIPT_MISMATCH: 挂接回执与已采用页面请求不匹配')
      }
      const expected = {
        kind: 'presentation-tools.page-visual-link.v1', runId: input.runId,
        studioProjectId: input.studioProjectId, pageId: input.pageId, sourceStateHash: input.sourceStateHash,
        requestId, preAssetId: input.assetId,
      }
      const receiptKeys = ['kind', 'runId', 'studioProjectId', 'pageId', 'sourceStateHash', 'requestId', 'preAssetId', 'studioAssetId', 'pageAssetId', 'projectRevision', 'linkedAt']
      if (!linkReceipt || Object.keys(linkReceipt).length !== receiptKeys.length || receiptKeys.some(key => !Object.hasOwn(linkReceipt, key))) {
        throw new Error('PAGE_VISUAL_LINK_RECEIPT_INVALID: 挂接回执字段不完整')
      }
      for (const [key, value] of Object.entries(expected)) {
        if (linkReceipt[key as keyof StudioPageVisualLinkReceipt] !== value) throw new Error(`PAGE_VISUAL_LINK_RECEIPT_MISMATCH: ${key} 不匹配`)
      }
      const validTimestamp = typeof linkReceipt.linkedAt === 'string' && !Number.isNaN(Date.parse(linkReceipt.linkedAt))
        && new Date(linkReceipt.linkedAt).toISOString() === linkReceipt.linkedAt
      if (!textValue(linkReceipt.studioAssetId) || !textValue(linkReceipt.pageAssetId)
        || !Number.isSafeInteger(linkReceipt.projectRevision) || linkReceipt.projectRevision < 0 || !validTimestamp) {
        throw new Error('PAGE_VISUAL_LINK_RECEIPT_INVALID: 挂接回执内容无效')
      }
      if (request.status === 'linked') {
        if (sha256CanonicalJson(request.linkReceipt) !== sha256CanonicalJson(linkReceipt)) throw new Error('PAGE_VISUAL_LINK_RECEIPT_CONFLICT: 同一请求已有不同挂接回执')
        return request.linkReceipt!
      }
      await savePageVisualRequest(input.workspaceRoot, input.projectId, { ...request, status: 'linked', linkReceipt })
      return linkReceipt
    })
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
      return { taskId: request.taskId, findingId: input.findingId, assetId: adopted.assetId, status: 'adopted', reused: asset.status === 'adopted' }
    })
  }
}
