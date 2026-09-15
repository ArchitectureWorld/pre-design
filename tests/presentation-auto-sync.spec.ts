import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PresentationAutoSyncService } from '../src/presentation/auto-sync.ts'
import { PresentationStandardProjectError } from '../src/presentation/standard-project-error.ts'

const services: PresentationAutoSyncService[] = []
const workspaceRoots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(services.splice(0).map(service => service.close()))
  for (const root of workspaceRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function workspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pre-auto-sync-'))
  workspaceRoots.push(root)
  return root
}

function frozen(projectId: string, revision: number) {
  return {
    projectId,
    projectName: '沙潭河水库前期策划',
    revision,
    generatedAt: `2026-09-04T00:00:${String(revision).padStart(2, '0')}Z`,
    recommendation: '',
    decisionItems: [],
    stateObjects: [],
    gates: [],
    visualAssets: [],
    adoptedAssetIds: [],
    siteBoundary: { status: 'not_provided' as const },
  }
}

function binding(root: string, overrides: Record<string, unknown> = {}) {
  return {
    preDesignProjectId: 'preplan-1',
    presentationProjectId: 'project_01992a80-0000-7000-8000-000000000101',
    projectSlug: 'shatanhe',
    workspaceRoot: root,
    directoryRoot: root,
    standardVersion: '0.1.0',
    state: 'ready',
    stableIds: {},
    lastExportedPreDesignRevision: 0,
    lastExportedObjectHashes: {},
    lastExportedFileHashes: {},
    createdAt: '2026-09-04T00:00:00Z',
    updatedAt: '2026-09-04T00:00:00Z',
    ...overrides,
  }
}

describe('PresentationAutoSyncService', () => {
  it('coalesces repeated requests and exports only the latest Pre revision', async () => {
    vi.useFakeTimers()
    const root = workspaceRoot()
    let revision = 1
    const exports: number[] = []
    const currentBinding = binding(root)
    const service = new PresentationAutoSyncService({
      repository: {
        listProjects: () => [{ projectId: 'preplan-1', currentRevision: revision }],
      },
      standardProjects: {
        findByPreDesignProjectId: () => currentBinding,
        exportProject: async (input: any) => {
          exports.push(input.frozenProject.revision)
          currentBinding.lastExportedPreDesignRevision = input.frozenProject.revision
          return {
            directoryRoot: input.workspaceRoot ?? root,
            projectId: currentBinding.presentationProjectId,
            projectSlug: 'shatanhe',
            standardVersion: '0.1.0',
            replacedExisting: true,
            fileHashes: {},
            validation: { valid: true, errors: [] },
            stableIds: {},
          }
        },
      },
      source: async (projectId: string, sourceRevision: number) => frozen(projectId, sourceRevision),
      adoptedAssets: () => [],
      delayMs: 500,
    } as never)
    services.push(service)

    service.request('preplan-1', { workspaceRoot: root, reason: 'revision-1' })
    revision = 2
    service.request('preplan-1', { workspaceRoot: root, reason: 'revision-2' })

    expect(service.status('preplan-1', 2)).toMatchObject({ state: 'pending', currentRevision: 2 })
    await vi.advanceTimersByTimeAsync(500)
    await service.whenIdle('preplan-1')

    expect(exports).toEqual([2])
    expect(service.status('preplan-1', 2)).toMatchObject({
      state: 'synced', currentRevision: 2, syncedRevision: 2,
    })
  })

  it('catches up when a newer Revision arrives while an export is in flight', async () => {
    const root = workspaceRoot()
    let revision = 1
    let releaseFirst!: () => void
    const first = new Promise<void>(resolve => { releaseFirst = resolve })
    const exports: number[] = []
    const currentBinding = binding(root)
    const service = new PresentationAutoSyncService({
      repository: { listProjects: () => [{ projectId: 'preplan-1', currentRevision: revision }] },
      standardProjects: {
        findByPreDesignProjectId: () => currentBinding,
        exportProject: async (input: any) => {
          exports.push(input.frozenProject.revision)
          if (exports.length === 1) await first
          currentBinding.lastExportedPreDesignRevision = input.frozenProject.revision
          return {
            directoryRoot: root, projectId: currentBinding.presentationProjectId,
            projectSlug: 'shatanhe', standardVersion: '0.1.0', replacedExisting: true,
            fileHashes: {}, validation: { valid: true, errors: [] }, stableIds: {},
          }
        },
      },
      source: async (projectId: string, sourceRevision: number) => frozen(projectId, sourceRevision),
      adoptedAssets: () => [],
      delayMs: 60_000,
    } as never)
    services.push(service)

    const flushing = service.flush('preplan-1', { workspaceRoot: root, reason: 'batch' })
    await vi.waitFor(() => expect(exports).toEqual([1]))
    revision = 2
    service.request('preplan-1', { workspaceRoot: root, reason: 'new-revision' })
    releaseFirst()
    await flushing
    await service.whenIdle('preplan-1')

    expect(exports).toEqual([1, 2])
    expect(service.status('preplan-1', 2)).toMatchObject({ state: 'synced', syncedRevision: 2 })
  })

  it('classifies legacy directory migration without forcing or rolling back Pre state', async () => {
    const root = workspaceRoot()
    const service = new PresentationAutoSyncService({
      repository: { listProjects: () => [{ projectId: 'preplan-1', currentRevision: 11 }] },
      standardProjects: {
        findByPreDesignProjectId: () => binding(root, {
          workspaceRoot: undefined,
          directoryRoot: join(root, 'legacy-standard-project'),
          lastExportedPreDesignRevision: 0,
        }),
        exportProject: async () => {
          throw new PresentationStandardProjectError(
            'PRE_DESIGN_WORKSPACE_MIGRATION_CONFIRMATION_REQUIRED',
            'preflight',
            'existing standard project requires Workspace migration',
          )
        },
      },
      source: async (projectId: string, sourceRevision: number) => frozen(projectId, sourceRevision),
      adoptedAssets: () => [],
      delayMs: 60_000,
    } as never)
    services.push(service)

    const result = await service.flush('preplan-1', {
      workspaceRoot: root, reason: 'manual-confirm',
    })

    expect(result).toMatchObject({ state: 'migration_required', currentRevision: 11, syncedRevision: 0 })
    expect(result.message).toContain('/preplan-presentation-sync --force')
  })

  it('reports external managed-file changes and never requests a force overwrite', async () => {
    const root = workspaceRoot()
    let confirmExternalChanges: boolean | undefined
    const service = new PresentationAutoSyncService({
      repository: { listProjects: () => [{ projectId: 'preplan-1', currentRevision: 4 }] },
      standardProjects: {
        findByPreDesignProjectId: () => binding(root, { lastExportedPreDesignRevision: 3 }),
        exportProject: async (input: any) => {
          confirmExternalChanges = input.confirmExternalChanges
          throw new PresentationStandardProjectError(
            'PRESENTATION_EXTERNAL_CHANGE_REVIEW_REQUIRED',
            'preflight',
            'existing Workspace contains external changes',
          )
        },
      },
      source: async (projectId: string, sourceRevision: number) => frozen(projectId, sourceRevision),
      adoptedAssets: () => [],
    } as never)
    services.push(service)

    const result = await service.flush('preplan-1', { workspaceRoot: root, reason: 'revision' })

    expect(confirmExternalChanges).toBe(false)
    expect(result).toMatchObject({ state: 'external_changes', currentRevision: 4, syncedRevision: 3 })
  })
})
