import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import * as report from '../src/report/module-source.ts'

it('invalidates the accepted report binding before a partial rerun while retaining immutable research and selection requirements', async () => {
  const root = await mkdtemp(join(tmpdir(), 'report-partial-'))
  try {
    const binding = { projectId: 'project', workspaceRoot: root, standardProjectId: 'standard' }
    const flags = { industryPlanning: false, existingBuildings: false, externalPartners: false, marketing: false }
    const selection = await report.beginReportResearchSelection(binding, { workspaceRoot: root, projectId: 'project', snapshotId: 'snapshot',
      corpus: { documents: [], limitations: [], fingerprint: 'source-hash' }, flags }, { parentId: 'parent' })
    const path = join(root, '.pre-design/report-research/project/selection.json')
    const old = { ...selection, manifestRunId: 'RUN-old' }
    await writeFile(path, JSON.stringify(old))
    await mkdir(join(root, 'research/runs/RUN-old'), { recursive: true })
    await writeFile(join(root, 'research/runs/RUN-old/report.json'), 'immutable original')
    const invalidate = (report as any).invalidateReportResearchSelection
    expect(typeof invalidate).toBe('function')
    await invalidate(binding)
    const pending = JSON.parse(await readFile(path, 'utf8'))
    expect(pending.manifestRunId).toBeUndefined()
    expect(pending.selectionId).not.toBe(selection.selectionId)
    expect(pending.expectedModuleIds).toEqual(selection.expectedModuleIds)
    expect(await readFile(join(root, 'research/runs/RUN-old/report.json'), 'utf8')).toBe('immutable original')
    expect((await report.createReportModuleResearchLoader({ executions: async () => [] })(binding)).status).toBe('not_ready')
  } finally { await rm(root, { recursive: true, force: true }) }
})
