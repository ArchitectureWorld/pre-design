import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { validateProjectDirectoryWithAjv } from '@architectureworld/presentation-contracts'
import { PresentationBindingRepository } from '../src/presentation/binding-repository.ts'
import { PresentationStandardProjectService } from '../src/presentation/standard-project-service.ts'
import { buildPresentationStandardProject } from '../src/presentation/standard-project-adapter.ts'
import { publishPresentationStandardProject } from '../src/presentation/standard-project-writer.ts'
import {
  STANDARD_TEST_RULES,
  STANDARD_TEST_TIME,
  createStandardFrozenProject,
  createStandardManagedFiles,
} from './presentation-standard-fixture.ts'

const roots: string[] = []
const contexts: Context[] = []

async function openStorage() {
  const root = await mkdtemp(join(tmpdir(), 'pre-design-standard-e2e-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const bindings = await PresentationBindingRepository.open(ctx.storage.domain)
  return { root, ctx, bindings }
}

function findPrivateCanonicalKeys(value: unknown, path: string[] = []): string[] {
  const privateKeys = new Set([
    'agentRuntime', 'dshSession', 'sessionId', 'gateId', 'proposalId', 'reviewStatus',
    'projectHead', 'baseRevision', 'presentationRevision', 'syncStatus',
    'conflictState', 'recoveryRecord',
  ])
  const found: string[] = []
  if (Array.isArray(value)) {
    value.forEach((child, index) => found.push(...findPrivateCanonicalKeys(child, [...path, String(index)])))
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (privateKeys.has(key)) found.push([...path, key].join('.'))
      found.push(...findPrivateCanonicalKeys(child, [...path, key]))
    }
  }
  return found
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('pre-design to Presentation Standard Project end-to-end', () => {
  it('expands a ten-page two-level directory at the same source revision while retaining old identities', async () => {
    const { root, bindings } = await openStorage()
    const workspaceRoot = join(root, 'presentation-projects')
    const service = new PresentationStandardProjectService({ bindings, workspaceRoot, now: () => STANDARD_TEST_TIME })
    const source = createStandardFrozenProject()
    const empty = await service.createProject({
      preDesignProjectId: source.projectId,
      projectName: source.projectName,
      projectSlug: 'campus-renewal-brief',
      createdAt: STANDARD_TEST_TIME,
      rules: STANDARD_TEST_RULES,
    })
    const emptyBinding = bindings.read(source.projectId)!
    const fullBuild = await buildPresentationStandardProject({
      frozenProject: source,
      rules: STANDARD_TEST_RULES,
      projectSlug: emptyBinding.projectSlug,
      presentationProjectId: empty.projectId,
      stableIds: emptyBinding.stableIds,
    })
    const legacyTopics = {
      'project-brief': 'project_brief', baseline: 'diagnosis', diagnosis: 'diagnosis',
      opportunity: 'opportunity', positioning: 'positioning', strategy: 'positioning',
      product: 'program_product', spatial: 'spatial_strategy', delivery: 'delivery_model',
      decision: 'decision_next_steps',
    }
    const allPages = (fullBuild.documents['pages/manifest.json'] as any).pages
    const allNodes = (fullBuild.documents['outline.json'] as any).nodes
    const legacyPages = Object.keys(legacyTopics).map((key, order) => {
      const pageId = fullBuild.stableIds[`page:finding:pre-design:${key}`]
      return { ...allPages.find((page: any) => page.pageId === pageId), order }
    })
    expect(legacyPages).toHaveLength(10)
    expect(legacyPages.every(page => page.pageId)).toBe(true)
    const legacyLeafNodes = Object.entries(legacyTopics).map(([key, topic], order) => ({
      ...allNodes.find((node: any) => node.outlineNodeId === fullBuild.stableIds[`outlineNode:finding:pre-design:${key}`]),
      parentOutlineNodeId: fullBuild.stableIds[`outlineNode:topic:${topic}`],
      order,
    }))
    const draftPaths = new Set(legacyPages.map(page => page.draftPath))
    const legacyDocuments = {
      ...Object.fromEntries(Object.entries(fullBuild.documents).filter(([path]) => !path.startsWith('pages/drafts/') || draftPaths.has(path))),
      'outline.json': {
        ...fullBuild.documents['outline.json'] as any,
        nodes: [...allNodes.filter((node: any) => node.parentOutlineNodeId === null), ...legacyLeafNodes],
      },
      'pages/manifest.json': { ...fullBuild.documents['pages/manifest.json'] as any, pages: legacyPages },
    }
    const serializedLegacy = JSON.stringify(legacyDocuments)
    const legacyIds = Object.fromEntries(Object.entries(fullBuild.stableIds).filter(([, id]) => serializedLegacy.includes(id)))
    const legacy = await publishPresentationStandardProject({
      workspaceRoot,
      build: { ...fullBuild, documents: legacyDocuments, stableIds: legacyIds },
      operationId: 'seed-legacy-two-level-directory',
      expectedExistingFileHashes: emptyBinding.lastExportedFileHashes,
    })
    await bindings.put({
      ...emptyBinding,
      stableIds: legacyIds,
      lastExportedPreDesignRevision: source.revision,
      lastExportedObjectHashes: fullBuild.semanticObjectHashes,
      lastExportedFileHashes: legacy.fileHashes,
    })

    const expanded = await service.exportProject({ frozenProject: source, rules: STANDARD_TEST_RULES })
    expect(expanded.validation.valid).toBe(true)
    expect(expanded.directoryRoot).toBe(legacy.directoryRoot)
    const expandedBinding = bindings.read(source.projectId)!
    expect(expandedBinding.lastExportedPreDesignRevision).toBe(source.revision)
    const expandedManifest = JSON.parse(await readFile(join(expanded.directoryRoot, 'pages/manifest.json'), 'utf8'))
    expect(expandedManifest.pages.length).toBeGreaterThan(10)
    for (const oldPage of legacyPages) {
      expect(expandedManifest.pages).toContainEqual(expect.objectContaining({
        pageId: oldPage.pageId, outlineNodeId: oldPage.outlineNodeId, draftPath: oldPage.draftPath, titleBlockId: oldPage.titleBlockId,
      }))
    }
    for (const [key, id] of Object.entries(legacyIds)) expect(expanded.stableIds[key]).toBe(id)
    const repeated = await service.exportProject({ frozenProject: source, rules: STANDARD_TEST_RULES })
    expect(repeated.stableIds).toEqual(expanded.stableIds)
    expect(bindings.read(source.projectId)!.lastExportedFileHashes).toEqual(expandedBinding.lastExportedFileHashes)

    const editedPath = join(expanded.directoryRoot, legacyPages[0]!.draftPath)
    const editedDraft = JSON.parse(await readFile(editedPath, 'utf8'))
    editedDraft.contentBlocks.find((block: any) => block.role === 'page_title').content = '用户手动修改的专题综合判断'
    await writeFile(editedPath, `${JSON.stringify(editedDraft, null, 2)}\n`)
    await expect(service.exportProject({ frozenProject: source, rules: STANDARD_TEST_RULES }))
      .rejects.toMatchObject({ code: 'PRESENTATION_EXTERNAL_CHANGE_REVIEW_REQUIRED' })
    expect(await readFile(editedPath, 'utf8')).toContain('用户手动修改的专题综合判断')
  })

  it('creates an empty legal directory, fills it, validates it and preserves stable IDs across restart', async () => {
    const { root, ctx, bindings } = await openStorage()
    const workspaceRoot = join(root, 'presentation-projects')
    const service = new PresentationStandardProjectService({
      bindings,
      workspaceRoot,
      now: () => STANDARD_TEST_TIME,
    })

    const empty = await service.createProject({
      preDesignProjectId: 'preplan-project-campus-renewal',
      projectName: 'Campus Renewal Brief',
      projectSlug: 'campus-renewal-brief',
      createdAt: STANDARD_TEST_TIME,
      rules: STANDARD_TEST_RULES,
    })
    expect(empty.validation.valid).toBe(true)
    expect((JSON.parse(await readFile(join(empty.directoryRoot, 'outline.json'), 'utf8'))).nodes).toEqual([])
    expect((JSON.parse(await readFile(join(empty.directoryRoot, 'pages/manifest.json'), 'utf8'))).pages).toEqual([])
    expect(bindings.read('preplan-project-campus-renewal')).toMatchObject({
      presentationProjectId: empty.projectId,
      projectSlug: 'campus-renewal-brief',
      directoryRoot: empty.directoryRoot,
      standardVersion: '0.1.0',
      state: 'ready',
      lastExportedPreDesignRevision: 0,
    })

    const managed = await createStandardManagedFiles(join(root, 'inputs'))
    const filled = await service.exportProject({
      frozenProject: createStandardFrozenProject(),
      rules: STANDARD_TEST_RULES,
      sourceMaterials: managed.sourceMaterials,
      assets: managed.assets,
    })
    expect(filled.projectId).toBe(empty.projectId)
    expect(filled.validation.valid).toBe(true)
    const validation = await validateProjectDirectoryWithAjv(filled.directoryRoot)
    expect(validation.valid, JSON.stringify(validation.errors)).toBe(true)

    const firstBinding = bindings.read('preplan-project-campus-renewal')!
    expect(firstBinding.state).toBe('ready')
    expect(firstBinding.lastExportedPreDesignRevision).toBe(7)
    expect(Object.keys(firstBinding.stableIds).length).toBeGreaterThan(80)
    expect(Object.keys(firstBinding.lastExportedFileHashes).length).toBeGreaterThan(6)

    await bindings.close()
    const reopenedBindings = await PresentationBindingRepository.open(ctx.storage.domain)
    const restarted = new PresentationStandardProjectService({
      bindings: reopenedBindings,
      workspaceRoot,
      now: () => '2026-09-03T01:00:00.000Z',
    })
    const changed = createStandardFrozenProject({
      revision: 8,
      projectName: 'Campus Renewal Decision Brief',
      stateObjects: [...createStandardFrozenProject().stateObjects].reverse(),
    })
    const repeated = await restarted.exportProject({
      frozenProject: changed,
      rules: STANDARD_TEST_RULES,
      sourceMaterials: managed.sourceMaterials,
      assets: managed.assets,
    })
    const secondBinding = reopenedBindings.read('preplan-project-campus-renewal')!
    expect(repeated.projectId).toBe(empty.projectId)
    expect(secondBinding.stableIds).toEqual(firstBinding.stableIds)
    expect(secondBinding.lastExportedPreDesignRevision).toBe(8)
    expect(repeated.directoryRoot).toBe(filled.directoryRoot)

    const pageManifest = JSON.parse(await readFile(join(repeated.directoryRoot, 'pages/manifest.json'), 'utf8'))
    const draftDocuments = await Promise.all(pageManifest.pages.map(async (page: any) =>
      JSON.parse(await readFile(join(repeated.directoryRoot, page.draftPath), 'utf8'))))
    expect(draftDocuments.flatMap(draft => findPrivateCanonicalKeys(draft))).toEqual([])
    expect(draftDocuments.every((draft: any) => draft.contentBlocks.some(
      (block: any) => block.sourceRefs?.some((source: any) =>
        source.provider === 'pre-design'
        && source.sourceProjectId === 'preplan-project-campus-renewal'
        && source.sourceRevision === 8),
    ))).toBe(true)

    await reopenedBindings.close()
  })

  it('marks recovery required after failure while retaining the previous valid directory', async () => {
    const { root, bindings } = await openStorage()
    const service = new PresentationStandardProjectService({
      bindings,
      workspaceRoot: join(root, 'presentation-projects'),
      now: () => STANDARD_TEST_TIME,
    })
    const initial = await service.createProject({
      preDesignProjectId: 'preplan-project-recovery',
      projectName: 'Recovery Project',
      projectSlug: 'recovery-project',
      createdAt: STANDARD_TEST_TIME,
      rules: STANDARD_TEST_RULES,
    })
    const originalProject = await readFile(join(initial.directoryRoot, 'project.json'), 'utf8')

    await expect(service.exportProject({
      frozenProject: createStandardFrozenProject({ projectId: 'preplan-project-recovery' }),
      rules: STANDARD_TEST_RULES,
      writerHooks: {
        beforeCommit: () => {
          throw new Error('injected service failure')
        },
      },
    })).rejects.toMatchObject({ code: 'PRESENTATION_STANDARD_PROJECT_WRITE_FAILED' })
    expect(bindings.read('preplan-project-recovery')?.state).toBe('recovery_required')
    expect(await readFile(join(initial.directoryRoot, 'project.json'), 'utf8')).toBe(originalProject)
    await expect(validateProjectDirectoryWithAjv(initial.directoryRoot))
      .resolves.toMatchObject({ valid: true })
  })

  it('requires explicit confirmation before replacing externally modified canonical content', async () => {
    const { root, bindings } = await openStorage()
    const service = new PresentationStandardProjectService({
      bindings,
      workspaceRoot: join(root, 'presentation-projects'),
      now: () => STANDARD_TEST_TIME,
    })
    const initial = await service.createProject({
      preDesignProjectId: 'preplan-project-conflict',
      projectName: 'Conflict Project',
      projectSlug: 'conflict-project',
      createdAt: STANDARD_TEST_TIME,
      rules: STANDARD_TEST_RULES,
    })
    const rulesPath = join(initial.directoryRoot, 'rules.json')
    const rules = JSON.parse(await readFile(rulesPath, 'utf8'))
    rules.writingRules.push('外部编辑内容')
    await writeFile(rulesPath, `${JSON.stringify(rules, null, 2)}\n`)

    const frozen = createStandardFrozenProject({ projectId: 'preplan-project-conflict' })
    await expect(service.exportProject({
      frozenProject: frozen,
      rules: STANDARD_TEST_RULES,
    })).rejects.toMatchObject({
      code: 'PRESENTATION_EXTERNAL_CHANGE_REVIEW_REQUIRED',
    })
    expect((JSON.parse(await readFile(rulesPath, 'utf8'))).writingRules).toContain('外部编辑内容')

    const confirmed = await service.exportProject({
      frozenProject: frozen,
      rules: STANDARD_TEST_RULES,
      confirmExternalChanges: true,
    })
    expect(confirmed.validation.valid).toBe(true)
    expect((JSON.parse(await readFile(rulesPath, 'utf8'))).writingRules).not.toContain('外部编辑内容')
  })
})
