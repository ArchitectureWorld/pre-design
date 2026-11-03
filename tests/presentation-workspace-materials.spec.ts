import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createFrozenReportSections } from '../src/report/report-content.ts'
import { prepareWorkspacePresentationMaterials } from '../src/presentation/workspace-materials.ts'
import { createStandardFrozenProject } from './presentation-standard-fixture.ts'
import { materialPdf } from './support/material-pdf.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

function frozenReference(assetId: string, versionId: string, claimClass = 'source_conclusion') {
  const frozen = createStandardFrozenProject()
  return { ...frozen, stateObjects: [{ ...frozen.stateObjects[0]!, reportSections: createFrozenReportSections({ data: {
    evidence_refs: [{ evidence_id: 'ev-original', asset_id: assetId, version_id: versionId,
      claim_class: claimClass, locator: { section: assetId, page: 1 }, notes: '原文：水库基本情况' }],
  } }, '项目任务') }] }
}

async function sourceWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'pre-presentation-inbox-'))
  roots.push(root)
  await mkdir(join(root, '原始资料', '水利资料'), { recursive: true })
  const path = '原始资料/水利资料/少潭河水库“一库一策”方案.pdf'
  const bytes = materialPdf(['Reservoir source'])
  await writeFile(join(root, path), bytes)
  return { root, path, hash: createHash('sha256').update(bytes).digest('hex') }
}

describe('presentation references after source inbox merge', () => {
  it.each(['relative', 'windows', 'file-uri'] as const)('resolves a source-only PDF from its complete %s path after inbox intake, preserving page and hash', async (kind) => {
    const { root, path, hash } = await sourceWorkspace()
    const locator = kind === 'windows' ? path.replaceAll('/', '\\') : kind === 'file-uri' ? pathToFileURL(join(root, path)).href : path
    const frozenProject = frozenReference(locator, hash)
    const before = structuredClone(frozenProject)
    const prepared = await prepareWorkspacePresentationMaterials({ frozenProject, workspaceRoot: root, diagrams: false })
    expect(prepared.sourceInboxFileCount).toBe(1)
    expect(prepared.sourceMaterials).toMatchObject([{ sourceKey: 'workspace-inbox:水利资料/少潭河水库“一库一策”方案.pdf', sourcePath: join(root, path) }])
    expect(prepared.assets).toEqual([])
    expect(prepared.materialWarnings).toEqual([])
    expect(frozenProject).toEqual(before)
    expect(frozenProject.stateObjects[0]!.reportSections[0]!.entries[0]!.evidenceRefs).toMatchObject([
      { assetId: locator, versionId: hash, locator: { section: locator, page: 1 } },
    ])
  })

  it('does not resolve a missing original by matching a different directory with the same filename', async () => {
    const { root, hash } = await sourceWorkspace()
    const missing = '原始资料/其他资料/少潭河水库“一库一策”方案.pdf'
    const prepared = await prepareWorkspacePresentationMaterials({ frozenProject: frozenReference(missing, hash), workspaceRoot: root, diagrams: false })
    expect(prepared.materialWarnings).toContainEqual(expect.stringContaining(missing))
  })

  it('does not silently bind a citation to different bytes at the registered original path', async () => {
    const { root, path } = await sourceWorkspace()
    const prepared = await prepareWorkspacePresentationMaterials({ frozenProject: frozenReference(path, '0'.repeat(64)), workspaceRoot: root, diagrams: false })
    expect(prepared.materialWarnings).toContainEqual(expect.stringContaining('哈希不一致'))
  })

  it.each(['user_statement', 'fact', 'inference'])('keeps an unverified %s session citation distinct from a missing file', async (claimClass) => {
    const { root } = await sourceWorkspace()
    const uri = 'dsh://session/session-test#seq=17'
    const prepared = await prepareWorkspacePresentationMaterials({ frozenProject: frozenReference(uri, '1'.repeat(64), claimClass), workspaceRoot: root, diagrams: false })
    expect(prepared.materialWarnings).toContainEqual(expect.stringContaining('会话引用'))
    expect(prepared.materialWarnings).toContainEqual(expect.stringContaining('未核验'))
    expect(prepared.materialWarnings.join()).not.toContain('尚未关联已登记的可读取原件')
    if (claimClass === 'user_statement') expect(prepared.materialWarnings.join()).toContain('用户陈述来源')
    else expect(prepared.materialWarnings.join()).toContain('不能作为已核验的用户陈述')
  })
})
