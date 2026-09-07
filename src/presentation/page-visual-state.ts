import { lstat, open, realpath, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { writeCanonicalJsonAtomically } from './filesystem.ts'
import { readFile, mkdir } from 'node:fs/promises'
import { sha256CanonicalJson } from './canonical-json.ts'

export const PAGE_VISUAL_STATE_PATH = '.pre-design/page-visual-fill.json'
export interface StudioPageVisualTarget {
  readonly kind: 'studio_current_page'
  readonly preDesignProjectId: string
  readonly studioProjectId: string
  readonly pageId: string
  readonly sourceStateHash: string
  readonly sourceObjectIds: readonly string[]
}
export interface StudioPageVisualLinkReceipt {
  readonly kind: 'presentation-tools.page-visual-link.v1'
  readonly runId: string
  readonly studioProjectId: string
  readonly pageId: string
  readonly sourceStateHash: string
  readonly requestId: string
  readonly preAssetId: string
  readonly studioAssetId: string
  readonly pageAssetId: string
  readonly projectRevision: number
  readonly linkedAt: string
}
export interface PageVisualRequest {
  readonly taskId: string
  readonly findingId?: string
  readonly target?: StudioPageVisualTarget
  readonly requestId?: string
  /** Stable DSH report run identity for Studio-targeted requests. Optional only for legacy unlinked state. */
  readonly runId?: string
  readonly briefHash: string
  readonly prompt: string
  readonly style: string
  readonly status: 'generating' | 'candidate' | 'adopted' | 'adopted_unlinked' | 'linked' | 'recovery_required' | 'failed'
  readonly assetId?: string
  readonly message?: string
  readonly linkReceipt?: StudioPageVisualLinkReceipt
}
export interface PageVisualState {
  readonly version: 1
  readonly projectId: string
  readonly requests: readonly PageVisualRequest[]
}
function validText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && !/[\u0000-\u001f]/u.test(value)
}

async function stateDirectory(root: string, create = false): Promise<string> {
  const directory = join(resolve(root), '.pre-design')
  if (create) await mkdir(directory, { recursive: true })
  try {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== join(await realpath(root), '.pre-design')) {
      throw new Error('PAGE_VISUAL_STATE_INVALID: 配置目录必须是工作区内普通目录')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return directory
}

export async function readPageVisualState(root: string, projectId: string): Promise<PageVisualState> {
  const file = join(await stateDirectory(root), 'page-visual-fill.json')
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('PAGE_VISUAL_STATE_INVALID: 状态文件必须为普通文件')
    const value = JSON.parse(await readFile(file, 'utf8')) as PageVisualState
    if (value.version !== 1 || value.projectId !== projectId || !Array.isArray(value.requests)) throw new Error('PAGE_VISUAL_STATE_INVALID: 项目或版本不匹配')
    const ids = new Set<string>()
    for (const item of value.requests) {
      if (!item || typeof item.taskId !== 'string' || !/^page-fill-[a-f0-9]{64}$/u.test(item.taskId)
        || ids.has(item.taskId) || !/^[a-f0-9]{64}$/u.test(item.briefHash)
        || (item.target === undefined ? typeof item.findingId !== 'string' || item.findingId.trim() === ''
          : item.findingId !== undefined || item.target.kind !== 'studio_current_page'
            || item.target.preDesignProjectId !== projectId || typeof item.target.studioProjectId !== 'string' || !item.target.studioProjectId.trim()
            || typeof item.target.pageId !== 'string' || !item.target.pageId.trim() || !/^[a-f0-9]{64}$/u.test(item.target.sourceStateHash)
            || !Array.isArray(item.target.sourceObjectIds) || !item.target.sourceObjectIds.length
            || item.target.sourceObjectIds.some((id: unknown) => typeof id !== 'string' || !id.trim())
            || new Set(item.target.sourceObjectIds).size !== item.target.sourceObjectIds.length
            || typeof item.requestId !== 'string' || !item.requestId.trim()
            || (item.runId !== undefined && !validText(item.runId)))
        || typeof item.prompt !== 'string' || item.prompt.trim() === '' || typeof item.style !== 'string' || item.style.trim() === ''
        || !['generating', 'candidate', 'adopted', 'adopted_unlinked', 'linked', 'recovery_required', 'failed'].includes(item.status)
        || (['adopted_unlinked', 'linked'].includes(item.status) && item.target === undefined)
        || (item.assetId !== undefined && (typeof item.assetId !== 'string' || item.assetId.trim() === ''))
        || (['candidate', 'adopted', 'adopted_unlinked', 'linked'].includes(item.status) && !item.assetId)) throw new Error('PAGE_VISUAL_STATE_INVALID: 补图请求损坏')
      if (item.status === 'linked') {
        const receipt = item.linkReceipt
        const validTimestamp = typeof receipt?.linkedAt === 'string' && !Number.isNaN(Date.parse(receipt.linkedAt))
          && new Date(receipt.linkedAt).toISOString() === receipt.linkedAt
        if (!item.target || !validText(item.runId) || !receipt || receipt.kind !== 'presentation-tools.page-visual-link.v1'
          || receipt.runId !== item.runId || receipt.studioProjectId !== item.target.studioProjectId
          || receipt.pageId !== item.target.pageId || receipt.sourceStateHash !== item.target.sourceStateHash
          || receipt.requestId !== item.requestId || receipt.preAssetId !== item.assetId
          || !validText(receipt.studioAssetId)
          || !validText(receipt.pageAssetId)
          || !Number.isSafeInteger(receipt.projectRevision) || receipt.projectRevision < 0 || !validTimestamp) {
          throw new Error('PAGE_VISUAL_STATE_INVALID: Studio 挂接回执损坏')
        }
      } else if (item.linkReceipt !== undefined) {
        throw new Error('PAGE_VISUAL_STATE_INVALID: 未完成挂接的请求不能携带回执')
      }
      ids.add(item.taskId)
      if (item.target && (item.taskId !== `page-fill-${item.briefHash}`
        || item.briefHash !== sha256CanonicalJson({ target: item.target, requestId: item.requestId, prompt: item.prompt, style: item.style }))) {
        throw new Error('PAGE_VISUAL_STATE_INVALID: Studio 请求身份与目标内容不匹配')
      }
    }
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, projectId, requests: [] }
    throw error
  }
}

export async function savePageVisualRequest(root: string, projectId: string, request: PageVisualRequest): Promise<void> {
  const state = await readPageVisualState(root, projectId)
  await stateDirectory(root, true)
  await writeCanonicalJsonAtomically(join(resolve(root), PAGE_VISUAL_STATE_PATH), {
    ...state, requests: [...state.requests.filter(item => item.taskId !== request.taskId), request],
  })
}

/** A second process fails closed rather than issuing the same paid request. */
export async function withPageVisualLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const path = join(await stateDirectory(root, true), 'page-visual-fill.lock')
  let handle
  try { handle = await open(path, 'wx') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('PAGE_VISUAL_BUSY: 此工作区已有补图请求，未重复生成；异常退出遗留锁需人工核查')
    throw error
  }
  try { return await action() } finally { await handle.close(); await unlink(path) }
}
