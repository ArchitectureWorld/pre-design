import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { preparePresentationMaterials } from '../src/presentation/material-registry.ts'
import { buildPresentationStandardProject } from '../src/presentation/standard-project-adapter.ts'
import { publishPresentationStandardProjectIntoWorkspace } from '../src/presentation/workspace-project-writer.ts'
import { createStandardFrozenProject } from './presentation-standard-fixture.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pre-material-registry-'))
  roots.push(root)
  await mkdir(join(root, '.pre-design'))
  await mkdir(join(root, 'originals'))
  const source = createStandardFrozenProject()
  const entries = [
    { sourceKey: 'photo', originalFileName: 'photo.svg', mimeType: 'image/svg+xml', semanticRole: 'map', metadata: { widthPx: 800, heightPx: 600 }, role: 'supporting',
      pageBindings: [{ findingId: 'pre-design:project-brief', role: 'background' }] },
    { sourceKey: 'video', originalFileName: 'video.mp4', mimeType: 'video/mp4', metadata: { durationMs: 2500 }, role: 'reference' },
    { sourceKey: 'pdf', originalFileName: 'report.pdf', mimeType: 'application/pdf', metadata: { pageCount: 1 }, role: 'reference' },
    { sourceKey: 'cad', originalFileName: 'plan.dwg', mimeType: 'image/vnd.dwg', metadata: {}, role: 'reference' },
    { sourceKey: 'data', originalFileName: 'metrics.csv', mimeType: 'text/csv', metadata: { rowCount: 1, columnCount: 2 }, role: 'reference' },
  ].map(entry => ({ ...entry, sourcePath: `originals/${entry.originalFileName}`, displayName: entry.sourceKey,
    importedAt: source.generatedAt, aliases: [`legacy-${entry.sourceKey}`], evidenceIds: [`ev-${entry.sourceKey}`], objectIds: ['PS01'] }))
  const bytes = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600"/></svg>',
    Buffer.from([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109]),
    '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF', 'AC1032-test-cad', 'name,value\narea,12\n',
  ]
  for (const [index, entry] of entries.entries()) await writeFile(join(root, entry.sourcePath), bytes[index]!)
  const registry = { version: 1, projectId: source.projectId, materials: entries }
  const indexPath = join(root, '.pre-design', 'materials.json')
  await writeFile(indexPath, JSON.stringify(registry))
  return { root, source, entries, registry, indexPath }
}

describe('persistent project material registry', () => {
  it('imports image/video/PDF/CAD/data originals into both libraries and preserves them across subsequent synchronization', async () => {
    const { root, source, entries, indexPath } = await fixture()
    const before = await Promise.all(entries.map(entry => readFile(join(root, entry.sourcePath))))
    const prepared = await preparePresentationMaterials({ frozenProject: source, workspaceRoot: root })
    expect(prepared.sourceMaterials).toHaveLength(5)
    expect(prepared.assets).toHaveLength(5)
    expect(prepared.materialWarnings).toEqual([])
    expect(prepared.assets.find(asset => asset.sourceKey === 'photo')?.semanticRole).toBe('map')
    const build = await buildPresentationStandardProject({ frozenProject: source, ...prepared })
    const first = await publishPresentationStandardProjectIntoWorkspace({ directoryRoot: root, build, operationId: 'initial-material-export' })
    expect(first.validation.valid).toBe(true)
    const assets = (build.documents['assets/manifest.json'] as any).assets
    expect(new Set(assets.map((asset: any) => asset.mediaType))).toEqual(new Set(['image', 'video', 'document', 'other', 'data']))
    expect(assets.every((asset: any) => asset.origin.sourceMaterialIds.length === 1)).toBe(true)
    const pages = (build.documents['pages/manifest.json'] as any).pages
    const mainPage = pages.find((page: any) => page.pageId === build.stableIds['page:finding:pre-design:project-brief'])
    const mainDraft = build.documents[mainPage.draftPath] as any
    expect(mainDraft.pageAssets).toHaveLength(5)
    expect(mainDraft.pageAssets.filter((asset: any) => asset.role === 'background')).toHaveLength(1)
    expect(await Promise.all(entries.map(entry => readFile(join(root, entry.sourcePath))))).toEqual(before)

    const previous = { stableIds: build.stableIds, lastExportedFileHashes: first.fileHashes }
    await unlink(join(root, entries[0]!.sourcePath))
    const missingOriginal = await preparePresentationMaterials({ frozenProject: source, workspaceRoot: root, previous })
    expect(missingOriginal.materialWarnings).toContainEqual(expect.stringContaining('保留此前导入的副本'))
    expect(missingOriginal.assets).toHaveLength(5)
    expect(missingOriginal.assets.find(asset => asset.sourceKey === 'photo')?.sourcePath).toContain('source-materials')
    expect(missingOriginal.assets.find(asset => asset.sourceKey === 'photo')?.aliases).toContain('legacy-photo')
    await unlink(indexPath)
    const preserved = await preparePresentationMaterials({ frozenProject: source, workspaceRoot: root, previous })
    expect(preserved.sourceMaterials).toHaveLength(5)
    expect(preserved.assets).toHaveLength(5)
    const secondBuild = await buildPresentationStandardProject({ frozenProject: source, ...preserved, stableIds: build.stableIds })
    const repeated = await publishPresentationStandardProjectIntoWorkspace({ directoryRoot: root, build: secondBuild, operationId: 'repeat-material-export', expectedExistingFileHashes: first.fileHashes })
    expect(repeated.validation.valid).toBe(true)
    expect((secondBuild.documents['assets/manifest.json'] as any).assets.map((asset: any) => asset.assetId)).toEqual(assets.map((asset: any) => asset.assetId))
    const repeatedDraft = secondBuild.documents[mainPage.draftPath] as any
    expect(repeatedDraft.pageAssets).toEqual(mainDraft.pageAssets)
    expect((JSON.parse(await readFile(join(root, 'source-materials/manifest.json'), 'utf8'))).materials).toHaveLength(5)

    const sourceManifestPath = join(root, 'source-materials/manifest.json')
    const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'))
    sourceManifest.materials[0].status = 'archived'
    await writeFile(sourceManifestPath, JSON.stringify(sourceManifest))
    await expect(publishPresentationStandardProjectIntoWorkspace({ directoryRoot: root, build: secondBuild,
      operationId: 'detect-external-material-edit', expectedExistingFileHashes: repeated.fileHashes }))
      .rejects.toMatchObject({ code: 'PRESENTATION_EXTERNAL_CHANGE_REVIEW_REQUIRED' })
  })
  it('reports absent originals and unresolved references while excluding internal object references', async () => {
    const { root, source, registry, indexPath } = await fixture()
    registry.materials.push({ ...registry.materials[0]!, sourceKey: 'missing', sourcePath: 'originals/missing.svg' })
    await writeFile(indexPath, JSON.stringify(registry))
    const frozenProject = { ...source, stateObjects: source.stateObjects.map(object => ({ ...object, reportSections: [{
      key: 'references', title: '资料来源', entries: [{ key: 'entry', text: '引用资料', basis: '资料来源', fieldPath: 'references', evidenceRefs: [
        { evidenceId: 'ev-internal', assetId: 'BL01' }, { evidenceId: 'ev-missing', assetId: 'not-registered' },
      ] }],
    }] })) }
    const prepared = await preparePresentationMaterials({ frozenProject, workspaceRoot: root })
    expect(prepared.assets).toHaveLength(5)
    expect(prepared.materialWarnings).toContainEqual(expect.stringContaining('missing'))
    expect(prepared.materialWarnings).toContainEqual(expect.stringContaining('not-registered'))
    expect(prepared.materialWarnings.join()).not.toContain('BL01')
  })
  it('preserves pageAsset identities for two source keys sharing the same bytes after the registry disappears', async () => {
    const { root, source, registry, indexPath } = await fixture()
    const photo = { ...registry.materials[0]!, aliases: [], evidenceIds: [], objectIds: [] }
    await writeFile(indexPath, JSON.stringify({ ...registry, materials: [
      { ...photo, sourceKey: 'first', pageBindings: [{ findingId: 'pre-design:project-brief', role: 'background' }] },
      { ...photo, sourceKey: 'second', pageBindings: [{ findingId: 'pre-design:baseline', role: 'primary' }] },
    ] }))
    const prepared = await preparePresentationMaterials({ frozenProject: source, workspaceRoot: root })
    const build = await buildPresentationStandardProject({ frozenProject: source, ...prepared })
    const published = await publishPresentationStandardProjectIntoWorkspace({ directoryRoot: root, build, operationId: 'duplicate-source-export' })
    expect(published.validation.valid).toBe(true)
    expect((build.documents['assets/manifest.json'] as any).assets).toHaveLength(1)
    expect((build.documents['source-materials/manifest.json'] as any).materials).toHaveLength(1)
    expect(build.stableIds['asset:asset:first']).toBe(build.stableIds['asset:asset:second'])
    const pages = (build.documents['pages/manifest.json'] as any).pages
    const linkedPages = pages.filter((page: any) => (build.documents[page.draftPath] as any).pageAssets.length > 0)
    expect(linkedPages).toHaveLength(2)

    await unlink(indexPath)
    const preserved = await preparePresentationMaterials({ frozenProject: source, workspaceRoot: root,
      previous: { stableIds: build.stableIds, lastExportedFileHashes: published.fileHashes } })
    const rebuilt = await buildPresentationStandardProject({ frozenProject: source, ...preserved, stableIds: build.stableIds })
    for (const page of linkedPages) {
      expect((rebuilt.documents[page.draftPath] as any).pageAssets).toEqual((build.documents[page.draftPath] as any).pageAssets)
    }
    expect(preserved.assets.map(asset => asset.sourceKey).sort()).toEqual(['first', 'second'])
    expect(preserved.sourceMaterials.map(material => material.sourceKey).sort()).toEqual(['first', 'second'])
  })
  it('rejects video without duration, mismatched projects and relative paths escaping the workspace', async () => {
    const { root, source, registry, indexPath } = await fixture()
    const video = registry.materials[1]!
    await writeFile(indexPath, JSON.stringify({ ...registry, materials: [{ ...video, metadata: {} }] }))
    await expect(preparePresentationMaterials({ frozenProject: source, workspaceRoot: root })).rejects.toThrow('durationMs')
    await writeFile(indexPath, JSON.stringify({ ...registry, projectId: 'another-project' }))
    await expect(preparePresentationMaterials({ frozenProject: source, workspaceRoot: root })).rejects.toThrow('项目 ID')
    await writeFile(indexPath, JSON.stringify({ ...registry, materials: [{ ...video, sourcePath: '../outside.mp4' }] }))
    await expect(preparePresentationMaterials({ frozenProject: source, workspaceRoot: root })).rejects.toThrow('越出工作区')
  })
})
