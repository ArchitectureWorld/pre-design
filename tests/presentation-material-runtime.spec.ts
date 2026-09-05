import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncPresentationProject } from '../src/presentation/runtime-integration.ts'
import { PresentationAutoSyncService } from '../src/presentation/auto-sync.ts'
import { createStandardFrozenProject } from './presentation-standard-fixture.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function registeredWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'pre-material-runtime-'))
  roots.push(root)
  await mkdir(join(root, '.pre-design'))
  await mkdir(join(root, '原件'))
  await writeFile(join(root, '原件', '指标.csv'), 'name,value\narea,12\n')
  const frozenProject = createStandardFrozenProject()
  await writeFile(join(root, '.pre-design', 'materials.json'), JSON.stringify({
    version: 1, projectId: frozenProject.projectId, materials: [{
      sourceKey: 'site-metrics', sourcePath: '原件/指标.csv', originalFileName: '指标.csv',
      displayName: '现状指标数据', mimeType: 'text/csv', importedAt: frozenProject.generatedAt,
      aliases: ['legacy-data-asset'], evidenceIds: ['ev-site-metrics'], objectIds: ['BL01'],
      role: 'reference', metadata: { rowCount: 1, columnCount: 2 },
    }],
  }))
  const published = { directoryRoot: root, projectId: 'project_01992a80-0000-7000-8000-000000000101',
    validation: { valid: true, errors: [] }, replacedExisting: true }
  return { root, frozenProject, published }
}

describe('registered materials in formal runtime synchronization', () => {
  it('loads registered originals and formal data assets in manual synchronization', async () => {
    const { root, frozenProject, published } = await registeredWorkspace()
    const exportProject = vi.fn(async () => published)
    await syncPresentationProject({
      repository: { readContext: () => ({ project: { projectId: frozenProject.projectId, currentRevision: frozenProject.revision } }), bindSession: vi.fn() },
      standardProjects: { exportProject, findByWorkspaceRoot: () => undefined, findByPreDesignProjectId: () => undefined },
      source: () => frozenProject,
    } as never, 'session-materials', false, root)
    expect(exportProject).toHaveBeenCalledWith(expect.objectContaining({
      sourceMaterials: [expect.objectContaining({ sourceKey: 'site-metrics', sourcePath: join(root, '原件', '指标.csv') })],
      assets: [expect.objectContaining({ sourceKey: 'site-metrics', evidenceIds: ['ev-site-metrics'], aliases: ['legacy-data-asset'], role: 'reference', rowCount: 1 })],
    }))
  })

  it('uses the same registered material preparation in automatic synchronization', async () => {
    const { root, frozenProject, published } = await registeredWorkspace()
    const exportProject = vi.fn(async () => published)
    const service = new PresentationAutoSyncService({
      repository: { listProjects: () => [{ projectId: frozenProject.projectId, currentRevision: frozenProject.revision }] },
      standardProjects: { findByPreDesignProjectId: () => ({ workspaceRoot: root, lastExportedPreDesignRevision: 0 }), exportProject },
      source: () => frozenProject, adoptedAssets: () => [], delayMs: 60_000,
    } as never)
    try {
      const result = await service.flush(frozenProject.projectId, { workspaceRoot: root, reason: 'material-test' })
      expect(result.state).toBe('synced')
      expect(exportProject).toHaveBeenCalledWith(expect.objectContaining({
        sourceMaterials: [expect.objectContaining({ sourceKey: 'site-metrics' })],
        assets: [expect.objectContaining({ sourceKey: 'site-metrics' })],
      }))
    } finally { await service.close() }
  })
})
