import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateDocumentWithAjv } from '@architectureworld/presentation-contracts'
import { buildPresentationStandardProject } from '../src/presentation/standard-project-adapter.ts'
import {
  STANDARD_TEST_RULES,
  createStandardFrozenProject,
  createStandardManagedFiles,
} from './presentation-standard-fixture.ts'

const roots: string[] = []

function allObjectKeys(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allObjectKeys(item, result)
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      result.add(key)
      allObjectKeys(child, result)
    }
  }
  return result
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('pre-design Presentation 0.1.0 Adapter', () => {
  it('builds chapter, report subject and detailed page nodes with real source detail', async () => {
    const frozenProject = createStandardFrozenProject()
    const source = {
      ...frozenProject,
      stateObjects: frozenProject.stateObjects.map(object => ({
        ...object,
        reportSections: [{
          key: 'analysis',
          title: '现状证据与行动依据',
          entries: [{
            key: `${object.objectId}-detail`,
            text: `${object.objectId} 的完整调研细节必须进入正式草案，而不能只导出摘要。`,
            basis: '项目实地踏勘记录',
            fieldPath: 'analysis.details[0]',
          }],
        }],
      })),
    }
    const build = await buildPresentationStandardProject({ frozenProject: source, rules: STANDARD_TEST_RULES })
    const outline = build.documents['outline.json'] as any
    const manifest = build.documents['pages/manifest.json'] as any
    const nodes = new Map<string, any>(outline.nodes.map((node: any) => [node.outlineNodeId, node]))
    for (const page of manifest.pages) {
      const pageNode = nodes.get(page.outlineNodeId)
      const subjectNode = nodes.get(pageNode.parentOutlineNodeId)
      const chapterNode = nodes.get(subjectNode.parentOutlineNodeId)
      expect(chapterNode?.kind).toBe('chapter')
      expect(chapterNode?.parentOutlineNodeId).toBeNull()
      expect(subjectNode.kind).toBe('section')
      expect(pageNode.kind).toBe('section')
    }
    expect(new Set(manifest.pages.map((page: any) => page.order)).size).toBe(manifest.pages.length)
    for (const parent of [null, ...nodes.keys()]) {
      const siblings = outline.nodes.filter((node: any) => node.parentOutlineNodeId === parent)
      expect(new Set(siblings.map((node: any) => node.order)).size).toBe(siblings.length)
    }
    const drafts = manifest.pages.map((page: any) => build.documents[page.draftPath])
    for (const object of source.stateObjects) {
      expect(JSON.stringify(drafts)).toContain(object.reportSections[0]!.entries[0]!.text)
    }
  })

  it('changes provenance snapshots when structured detail changes without changing the summary', async () => {
    const base = createStandardFrozenProject()
    const source = (detail: string) => ({
      ...base,
      stateObjects: base.stateObjects.slice(0, 1).map(object => ({
        ...object,
        reportSections: [{ key: 'scope', title: '服务范围', entries: [
          { key: 'scope-1', text: detail, basis: '任务书', fieldPath: 'scope' },
        ] }],
      })),
    })
    const first = await buildPresentationStandardProject({ frozenProject: source('重点覆盖校园东区') })
    const second = await buildPresentationStandardProject({ frozenProject: source('重点覆盖校园西区'), stableIds: first.stableIds })
    const firstOutline = first.documents['outline.json'] as any
    const secondOutline = second.documents['outline.json'] as any
    expect(firstOutline.nodes.find((node: any) => node.kind === 'chapter').sourceRefs[0].sourceSnapshotSha256)
      .not.toBe(secondOutline.nodes.find((node: any) => node.kind === 'chapter').sourceRefs[0].sourceSnapshotSha256)
  })

  it('maps professional content into canonical semantic documents and managed-file records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pre-design-standard-adapter-'))
    roots.push(root)
    const managed = await createStandardManagedFiles(join(root, 'inputs'))
    const build = await buildPresentationStandardProject({
      frozenProject: createStandardFrozenProject(),
      projectSlug: 'campus-renewal-brief',
      rules: STANDARD_TEST_RULES,
      sourceMaterials: managed.sourceMaterials,
      assets: managed.assets,
    })

    expect(build.standardVersion).toBe('0.1.0')
    expect(build.directoryName).toBe(`${build.projectId}-campus-renewal-brief`)
    expect(build.documents['project.json']).toMatchObject({
      documentType: 'ProjectManifest',
      projectId: build.projectId,
      projectSlug: 'campus-renewal-brief',
      createdBy: {
        provider: 'pre-design',
        sourceProjectId: 'preplan-project-campus-renewal',
      },
    })
    expect(build.documents['rules.json']).toMatchObject(STANDARD_TEST_RULES)

    const outline = build.documents['outline.json'] as any
    const pageManifest = build.documents['pages/manifest.json'] as any
    expect(outline.nodes.length).toBeGreaterThan(10)
    expect(outline.nodes.some((node: any) => node.kind === 'chapter' && node.parentOutlineNodeId === null)).toBe(true)
    expect(outline.nodes.some((node: any) => node.kind === 'section' && node.parentOutlineNodeId !== null)).toBe(true)
    expect(pageManifest.pages.length).toBeGreaterThanOrEqual(10)

    const draftEntries = Object.entries(build.documents)
      .filter(([path]) => /^pages\/drafts\/page_[a-f0-9-]+\.json$/u.test(path))
    expect(draftEntries).toHaveLength(pageManifest.pages.length)
    for (const [path, draft] of draftEntries) {
      const document = draft as any
      const blockTypes = new Set(document.contentBlocks.map((block: any) => block.type))
      expect(blockTypes.has('heading')).toBe(true)
      expect(blockTypes.has('text')).toBe(true)
      expect(document.contentBlocks.filter((block: any) => block.role === 'page_title')).toHaveLength(1)
      expect(document.contentBlocks.filter((block: any) => block.role === 'key_message')).toHaveLength(1)
      expect(document.scriptBlocks).toHaveLength(1)
      expect(document.scriptBlocks[0].referencedContentBlockIds.length).toBeGreaterThan(0)
      expect(document.scriptBlocks[0].sourceRefs[0]).toMatchObject({
        provider: 'pre-design',
        sourceProjectId: 'preplan-project-campus-renewal',
        sourceRevision: 7,
      })
      expect(document.scriptBlocks[0].sourceRefs[0].sourceSnapshotSha256).toMatch(/^[a-f0-9]{64}$/u)
      const result = await validateDocumentWithAjv('DraftPageDocument', document)
      expect(result.valid, `${path}: ${JSON.stringify(result.errors)}`).toBe(true)
    }

    const sourceManifest = build.documents['source-materials/manifest.json'] as any
    expect(sourceManifest.materials).toHaveLength(1)
    expect(sourceManifest.materials[0]).toMatchObject({
      originalFileName: 'site-metrics.csv',
      alternateOriginalFileNames: ['site-metrics-copy.csv'],
      category: 'data',
      relativePath: 'source-materials/data/site-metrics.csv',
      mimeType: 'text/csv',
      sizeBytes: managed.sourceBytes.length,
    })
    expect(sourceManifest.materials[0].sha256).toMatch(/^[a-f0-9]{64}$/u)

    const assetManifest = build.documents['assets/manifest.json'] as any
    expect(assetManifest.assets).toHaveLength(1)
    expect(assetManifest.assets[0]).toMatchObject({
      displayName: '场地面积摘要',
      mediaType: 'image',
      category: 'chart',
      relativePath: 'assets/charts/site-area-summary.svg',
      mimeType: 'image/svg+xml',
      sizeBytes: managed.assetBytes.length,
      adoptionStatus: 'adopted',
      metadata: { widthPx: 1600, heightPx: 900 },
    })
    expect(assetManifest.assets[0].origin.sourceMaterialIds).toEqual([
      sourceManifest.materials[0].sourceMaterialId,
    ])
    expect(build.managedFiles.map(file => file.relativePath).sort()).toEqual([
      'assets/charts/site-area-summary.svg',
      'source-materials/data/site-metrics.csv',
    ])
    expect(draftEntries.some(([, draft]) => (draft as any).pageAssets.some(
      (reference: any) => reference.assetId === assetManifest.assets[0].assetId,
    ))).toBe(true)

    for (const document of Object.values(build.documents)) {
      const result = await validateDocumentWithAjv((document as any).documentType, document as any)
      expect(result.valid, JSON.stringify(result.errors)).toBe(true)
    }

    const forbidden = new Set([
      'agentRuntime', 'sessionId', 'gateId', 'proposalId', 'projectHead',
      'baseRevision', 'presentationRevision', 'syncOrigin', 'conflictState',
      'recoveryRecord', 'font', 'fontSize', 'color', 'x', 'y', 'w', 'h',
      'templateName', 'layoutName', 'pptMaster', 'css',
    ])
    for (const key of allObjectKeys(build.documents)) expect(forbidden.has(key), `forbidden canonical key: ${key}`).toBe(false)
  })

  it('preserves all semantic identities when names, order and content change', async () => {
    const first = await buildPresentationStandardProject({
      frozenProject: createStandardFrozenProject(),
      projectSlug: 'campus-renewal-brief',
      rules: STANDARD_TEST_RULES,
    })
    const changedSource = createStandardFrozenProject({
      projectName: 'Campus Renewal Decision Brief',
      revision: 8,
      stateObjects: [...createStandardFrozenProject().stateObjects]
        .reverse()
        .map(object => object.objectId === 'DG01'
          ? { ...object, title: '更新后的核心诊断', summary: '更新后的问题结论。' }
          : object),
    })
    const second = await buildPresentationStandardProject({
      frozenProject: changedSource,
      projectSlug: 'renamed-campus-brief',
      rules: STANDARD_TEST_RULES,
      stableIds: first.stableIds,
      presentationProjectId: first.projectId,
    })

    expect(second.projectId).toBe(first.projectId)
    expect(second.stableIds).toEqual(first.stableIds)
    const firstPages = (first.documents['pages/manifest.json'] as any).pages
    const secondPages = (second.documents['pages/manifest.json'] as any).pages
    expect(secondPages.map((page: any) => page.pageId)).toEqual(firstPages.map((page: any) => page.pageId))
    expect(secondPages.map((page: any) => page.draftPath)).toEqual(firstPages.map((page: any) => page.draftPath))
    expect((second.documents['project.json'] as any).projectSlug).toBe('renamed-campus-brief')
  })
})
