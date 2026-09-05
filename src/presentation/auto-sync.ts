import type { FrozenProjectInput } from '../report/types.ts'
import type { ProjectRepository } from '../state/repository.ts'
import type { PresentationStandardProjectService } from './standard-project-service.ts'
import { preparePresentationMaterials } from './material-registry.ts'
import type {
  ExportPresentationStandardProjectInput,
  PresentationAdoptedAssetInput,
} from './standard-project-types.ts'

export type PresentationAutoSyncState =
  | 'pending'
  | 'syncing'
  | 'synced'
  | 'migration_required'
  | 'external_changes'
  | 'error'

export interface PresentationAutoSyncRequest {
  readonly workspaceRoot?: string
  readonly reason: string
}

export interface PresentationAutoSyncStatus {
  readonly state: PresentationAutoSyncState
  readonly currentRevision: number
  readonly syncedRevision: number
  readonly workspaceRoot?: string
  readonly reason?: string
  readonly message?: string
  readonly updatedAt: string
}

interface PresentationAutoSyncDependencies {
  readonly repository: Pick<ProjectRepository, 'listProjects'>
  readonly standardProjects: Pick<
    PresentationStandardProjectService,
    'findByPreDesignProjectId' | 'exportProject'
  >
  readonly source: (
    projectId: string,
    revision: number,
  ) => FrozenProjectInput | Promise<FrozenProjectInput>
  readonly adoptedAssets: (
    frozenProject: FrozenProjectInput,
  ) => readonly PresentationAdoptedAssetInput[]
  readonly delayMs?: number
  readonly now?: () => string
}

interface ProjectSlot {
  timer?: ReturnType<typeof setTimeout>
  running?: Promise<PresentationAutoSyncStatus>
  pending?: PresentationAutoSyncRequest
  status?: PresentationAutoSyncStatus
  readonly waiters: Set<() => void>
}

const DEFAULT_DELAY_MS = 750
const MIGRATION_CODE = 'PRE_DESIGN_WORKSPACE_MIGRATION_CONFIRMATION_REQUIRED'
const EXTERNAL_CHANGE_CODES = new Set([
  'PRESENTATION_EXTERNAL_CHANGE_REVIEW_REQUIRED',
  'PRESENTATION_WORKSPACE_MANAGED_CONTENT_EXISTS',
])

function errorCodeOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const code = (error as { readonly code?: unknown }).code
  if (typeof code === 'string') return code
  const message = (error as { readonly message?: unknown }).message
  if (typeof message !== 'string') return undefined
  const match = /^([A-Z][A-Z0-9_]+):/u.exec(message)
  return match?.[1]
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function migrationMessage(error: unknown): string {
  const details = error !== null && typeof error === 'object'
    ? (error as { readonly details?: unknown }).details
    : undefined
  const record = details !== null && typeof details === 'object'
    ? details as Record<string, unknown>
    : undefined
  const previous = typeof record?.previousDirectoryRoot === 'string'
    ? `旧目录：${record.previousDirectoryRoot}。`
    : ''
  const requested = typeof record?.requestedDirectoryRoot === 'string'
    ? `目标工作区：${record.requestedDirectoryRoot}。`
    : ''
  return [
    `${MIGRATION_CODE}: 检测到旧版标准项目需要迁移。`,
    previous,
    requested,
    '请只执行一次 /preplan-presentation-sync --force 进行确认；旧目录不会自动删除。',
  ].filter(Boolean).join(' ')
}

function mergeRequest(
  previous: PresentationAutoSyncRequest | undefined,
  next: PresentationAutoSyncRequest,
): PresentationAutoSyncRequest {
  return {
    workspaceRoot: next.workspaceRoot ?? previous?.workspaceRoot,
    reason: next.reason,
  }
}

export class PresentationAutoSyncService {
  private readonly slots = new Map<string, ProjectSlot>()
  private readonly delayMs: number
  private readonly now: () => string
  private closed = false

  constructor(private readonly dependencies: PresentationAutoSyncDependencies) {
    this.delayMs = dependencies.delayMs ?? DEFAULT_DELAY_MS
    this.now = dependencies.now ?? (() => new Date().toISOString())
  }

  request(
    projectId: string,
    request: PresentationAutoSyncRequest,
  ): PresentationAutoSyncStatus {
    this.assertOpen()
    const slot = this.slot(projectId)
    slot.pending = mergeRequest(slot.pending, request)
    const currentRevision = this.currentRevision(projectId)
    const syncedRevision = this.syncedRevision(projectId)
    slot.status = {
      state: 'pending',
      currentRevision,
      syncedRevision,
      ...(request.workspaceRoot === undefined ? {} : { workspaceRoot: request.workspaceRoot }),
      reason: request.reason,
      updatedAt: this.now(),
    }
    if (slot.running === undefined && slot.timer === undefined) {
      slot.timer = setTimeout(() => {
        slot.timer = undefined
        void this.ensureRunning(projectId, slot)
      }, this.delayMs)
    }
    return { ...slot.status }
  }

  async flush(
    projectId: string,
    request: PresentationAutoSyncRequest,
  ): Promise<PresentationAutoSyncStatus> {
    this.assertOpen()
    const slot = this.slot(projectId)
    slot.pending = mergeRequest(slot.pending, request)
    if (slot.timer !== undefined) {
      clearTimeout(slot.timer)
      slot.timer = undefined
    }
    return { ...await this.ensureRunning(projectId, slot) }
  }

  noteExplicitSuccess(
    projectId: string,
    input: {
      readonly preDesignRevision: number
      readonly directoryRoot?: string
      readonly reason?: string
      readonly message?: string
    },
  ): PresentationAutoSyncStatus {
    const slot = this.slot(projectId)
    if (slot.timer !== undefined) {
      clearTimeout(slot.timer)
      slot.timer = undefined
    }
    slot.pending = undefined
    slot.status = {
      state: 'synced',
      currentRevision: input.preDesignRevision,
      syncedRevision: input.preDesignRevision,
      ...(input.directoryRoot === undefined ? {} : { workspaceRoot: input.directoryRoot }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.message === undefined ? {} : { message: input.message }),
      updatedAt: this.now(),
    }
    this.settleWaiters(slot)
    return { ...slot.status }
  }

  status(projectId: string, currentRevision?: number): PresentationAutoSyncStatus {
    const current = currentRevision ?? this.currentRevision(projectId)
    const slot = this.slots.get(projectId)
    const synced = slot?.status?.syncedRevision ?? this.syncedRevision(projectId)
    if (slot?.status !== undefined) {
      if (slot.status.state === 'synced' && current > synced) {
        return {
          ...slot.status,
          state: 'pending',
          currentRevision: current,
          syncedRevision: synced,
        }
      }
      return { ...slot.status, currentRevision: current, syncedRevision: synced }
    }
    const binding = this.dependencies.standardProjects.findByPreDesignProjectId(projectId)
    const failureCode = binding?.lastFailure?.code
    if (failureCode === MIGRATION_CODE) {
      return {
        state: 'migration_required',
        currentRevision: current,
        syncedRevision: synced,
        workspaceRoot: binding?.workspaceRoot,
        message: binding?.lastFailure?.message,
        updatedAt: binding?.updatedAt ?? this.now(),
      }
    }
    if (failureCode !== undefined && EXTERNAL_CHANGE_CODES.has(failureCode)) {
      return {
        state: 'external_changes',
        currentRevision: current,
        syncedRevision: synced,
        workspaceRoot: binding?.workspaceRoot,
        message: binding?.lastFailure?.message,
        updatedAt: binding?.updatedAt ?? this.now(),
      }
    }
    return {
      state: current <= synced ? 'synced' : 'pending',
      currentRevision: current,
      syncedRevision: synced,
      ...(binding?.workspaceRoot === undefined ? {} : { workspaceRoot: binding.workspaceRoot }),
      updatedAt: binding?.updatedAt ?? this.now(),
    }
  }

  whenIdle(projectId: string): Promise<void> {
    const slot = this.slots.get(projectId)
    if (slot === undefined || (slot.timer === undefined && slot.running === undefined)) {
      return Promise.resolve()
    }
    return new Promise(resolve => slot.waiters.add(resolve))
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const running: Promise<unknown>[] = []
    for (const slot of this.slots.values()) {
      if (slot.timer !== undefined) {
        clearTimeout(slot.timer)
        slot.timer = undefined
      }
      if (slot.running !== undefined) running.push(slot.running)
      slot.pending = undefined
    }
    await Promise.allSettled(running)
    for (const slot of this.slots.values()) this.settleWaiters(slot)
  }

  private async runLoop(
    projectId: string,
    slot: ProjectSlot,
  ): Promise<PresentationAutoSyncStatus> {
    while (!this.closed) {
      const request = slot.pending ?? { reason: 'catch-up' }
      slot.pending = undefined
      const revision = this.currentRevision(projectId)
      const binding = this.dependencies.standardProjects.findByPreDesignProjectId(projectId)
      const workspaceRoot = request.workspaceRoot ?? binding?.workspaceRoot
      const syncedBefore = binding?.lastExportedPreDesignRevision ?? slot.status?.syncedRevision ?? 0
      slot.status = {
        state: 'syncing',
        currentRevision: revision,
        syncedRevision: syncedBefore,
        ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
        reason: request.reason,
        updatedAt: this.now(),
      }
      try {
        const frozenProject = await this.dependencies.source(projectId, revision)
        const materials = await preparePresentationMaterials({
          frozenProject,
          workspaceRoot: workspaceRoot ?? binding?.directoryRoot,
          assets: this.dependencies.adoptedAssets(frozenProject),
          previous: binding,
        })
        const input: ExportPresentationStandardProjectInput = {
          frozenProject,
          ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
          assets: materials.assets,
          sourceMaterials: materials.sourceMaterials,
          confirmExternalChanges: false,
        }
        await this.dependencies.standardProjects.exportProject(input)
        slot.status = {
          state: 'synced',
          currentRevision: revision,
          syncedRevision: revision,
          ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
          reason: request.reason,
          ...(materials.materialWarnings.length === 0 ? {} : { message: materials.materialWarnings.join('；') }),
          updatedAt: this.now(),
        }
      } catch (error) {
        slot.pending = undefined
        slot.status = this.classifyFailure(
          error,
          revision,
          syncedBefore,
          workspaceRoot,
          request.reason,
        )
        return slot.status
      }

      const latestRevision = this.currentRevision(projectId)
      if (slot.pending !== undefined || latestRevision > revision) continue
      return slot.status
    }
    return slot.status ?? {
      state: 'error',
      currentRevision: this.currentRevision(projectId),
      syncedRevision: this.syncedRevision(projectId),
      message: 'Presentation 自动同步服务已关闭。',
      updatedAt: this.now(),
    }
  }

  private classifyFailure(
    error: unknown,
    currentRevision: number,
    syncedRevision: number,
    workspaceRoot: string | undefined,
    reason: string,
  ): PresentationAutoSyncStatus {
    const code = errorCodeOf(error)
    if (code === MIGRATION_CODE) {
      return {
        state: 'migration_required',
        currentRevision,
        syncedRevision,
        ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
        reason,
        message: migrationMessage(error),
        updatedAt: this.now(),
      }
    }
    if (code !== undefined && EXTERNAL_CHANGE_CODES.has(code)) {
      return {
        state: 'external_changes',
        currentRevision,
        syncedRevision,
        ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
        reason,
        message: `${code}: 检测到 Pre 托管标准文件的外部修改，自动同步未覆盖。`,
        updatedAt: this.now(),
      }
    }
    return {
      state: 'error',
      currentRevision,
      syncedRevision,
      ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
      reason,
      message: errorMessageOf(error),
      updatedAt: this.now(),
    }
  }

  private ensureRunning(
    projectId: string,
    slot: ProjectSlot,
  ): Promise<PresentationAutoSyncStatus> {
    if (slot.running !== undefined) return slot.running
    const running = this.runLoop(projectId, slot).finally(() => {
      if (slot.running === running) slot.running = undefined
      this.settleWaiters(slot)
    })
    slot.running = running
    return running
  }

  private settleWaiters(slot: ProjectSlot): void {
    if (slot.timer !== undefined || slot.running !== undefined) return
    for (const resolve of slot.waiters) resolve()
    slot.waiters.clear()
  }

  private currentRevision(projectId: string): number {
    const project = this.dependencies.repository.listProjects()
      .find(candidate => candidate.projectId === projectId)
    if (project === undefined) throw new Error(`pre-design project '${projectId}' does not exist`)
    return project.currentRevision
  }

  private syncedRevision(projectId: string): number {
    return this.dependencies.standardProjects
      .findByPreDesignProjectId(projectId)
      ?.lastExportedPreDesignRevision ?? 0
  }

  private slot(projectId: string): ProjectSlot {
    let slot = this.slots.get(projectId)
    if (slot === undefined) {
      slot = { waiters: new Set() }
      this.slots.set(projectId, slot)
    }
    return slot
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Presentation 自动同步服务已关闭。')
  }
}
