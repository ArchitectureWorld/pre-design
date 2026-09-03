import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateProjectDirectoryWithAjv } from '@architectureworld/presentation-contracts'
import { buildPresentationStandardProject } from '../src/presentation/standard-project-adapter.ts'
import {
  PresentationStandardProjectError,
  publishPresentationStandardProject,
} from '../src/presentation/standard-project-writer.ts'
import {
  STANDARD_TEST_RULES,
  createStandardFrozenProject,
  createStandardManagedFiles,
} from './presentation-standard-fixture.ts'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pre-design-standard-writer-'))
  roots.push(root)
  return root
}

async function noTransientDirectories(root: string): Promise<boolean> {
  return (await readdir(root)).every(name => !name.startsWith('.creating-') && !name.startsWith('.backup-'))
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Presentation standard project atomic writer', () => {
  it('writes, validates and atomically publishes a complete project directory', async () => {
    const root = await workspace()
    const managed = await createStandardManagedFiles(join(root, 'inputs'))
    const build = await buildPresentationStandardProject({
      frozenProject: createStandardFrozenProject(),
      projectSlug: 'campus-renewal-brief',
      rules: STANDARD_TEST_RULES,
      sourceMaterials: managed.sourceMaterials,
      assets: managed.assets,
    })
    const result = await publishPresentationStandardProject({
      workspaceRoot: root,
      build,
      operationId: 'first-publish',
    })

    expect(result.directoryRoot).toBe(join(root, build.directoryName))
    expect(result.validation.valid).toBe(true)
    expect(result.replacedExisting).toBe(false)
    expect(result.fileHashes['project.json']).toMatch(/^[a-f0-9]{64}$/u)
    expect(result.fileHashes['source-materials/data/site-metrics.csv']).toBe(
      (build.documents['source-materials/manifest.json'] as any).materials[0].sha256,
    )
    expect(await readFile(join(result.directoryRoot, 'source-materials/data/site-metrics.csv'))).toEqual(managed.sourceBytes)
    expect(await readFile(join(result.directoryRoot, 'assets/charts/site-area-summary.svg'))).toEqual(managed.assetBytes)
    await expect(validateProjectDirectoryWithAjv(result.directoryRoot))
      .resolves.toMatchObject({ valid: true, standardVersion: '0.1.0' })
    expect(await noTransientDirectories(root)).toBe(true)
  })

  it('cleans staging and publishes nothing when any pre-commit step fails', async () => {
    const root = await workspace()
    const build = await buildPresentationStandardProject({
      frozenProject: createStandardFrozenProject(),
      projectSlug: 'failure-case',
      rules: STANDARD_TEST_RULES,
    })

    await expect(publishPresentationStandardProject({
      workspaceRoot: root,
      build,
      operationId: 'injected-failure',
      hooks: {
        beforeValidation: () => {
          throw new Error('injected writer failure')
        },
      },
    })).rejects.toMatchObject({
      name: 'PresentationStandardProjectError',
      code: 'PRESENTATION_STANDARD_PROJECT_WRITE_FAILED',
      stage: 'validation',
    })
    await expect(readdir(join(root, build.directoryName))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await noTransientDirectories(root)).toBe(true)
  })

  it('never silently overwrites an existing project and protects external changes', async () => {
    const root = await workspace()
    const firstBuild = await buildPresentationStandardProject({
      frozenProject: createStandardFrozenProject(),
      projectSlug: 'managed-update',
      rules: STANDARD_TEST_RULES,
    })
    const first = await publishPresentationStandardProject({
      workspaceRoot: root,
      build: firstBuild,
      operationId: 'publish-one',
    })

    const secondBuild = await buildPresentationStandardProject({
      frozenProject: createStandardFrozenProject({ revision: 8 }),
      projectSlug: 'managed-update',
      rules: STANDARD_TEST_RULES,
      stableIds: firstBuild.stableIds,
      presentationProjectId: firstBuild.projectId,
    })
    await expect(publishPresentationStandardProject({
      workspaceRoot: root,
      build: secondBuild,
      operationId: 'publish-two-without-ledger',
    })).rejects.toMatchObject({
      code: 'PRESENTATION_STANDARD_PROJECT_EXISTS',
      stage: 'preflight',
    })

    const safeUpdate = await publishPresentationStandardProject({
      workspaceRoot: root,
      build: secondBuild,
      operationId: 'publish-two-safe',
      expectedExistingFileHashes: first.fileHashes,
    })
    expect(safeUpdate.replacedExisting).toBe(true)
    expect((JSON.parse(await readFile(join(safeUpdate.directoryRoot, 'project.json'), 'utf8'))).projectId)
      .toBe(firstBuild.projectId)

    const manuallyEdited = JSON.parse(await readFile(join(safeUpdate.directoryRoot, 'rules.json'), 'utf8'))
    manuallyEdited.writingRules.push('外部人工补充规则')
    await writeFile(join(safeUpdate.directoryRoot, 'rules.json'), `${JSON.stringify(manuallyEdited, null, 2)}\n`)

    await expect(publishPresentationStandardProject({
      workspaceRoot: root,
      build: secondBuild,
      operationId: 'publish-three-conflict',
      expectedExistingFileHashes: safeUpdate.fileHashes,
    })).rejects.toMatchObject({
      code: 'PRESENTATION_EXTERNAL_CHANGE_REVIEW_REQUIRED',
      stage: 'preflight',
    })
    expect((JSON.parse(await readFile(join(safeUpdate.directoryRoot, 'rules.json'), 'utf8'))).writingRules)
      .toContain('外部人工补充规则')

    const confirmed = await publishPresentationStandardProject({
      workspaceRoot: root,
      build: secondBuild,
      operationId: 'publish-three-confirmed',
      expectedExistingFileHashes: safeUpdate.fileHashes,
      confirmExternalChanges: true,
    })
    expect(confirmed.replacedExisting).toBe(true)
    expect((JSON.parse(await readFile(join(confirmed.directoryRoot, 'rules.json'), 'utf8'))).writingRules)
      .not.toContain('外部人工补充规则')
    expect(await noTransientDirectories(root)).toBe(true)
  })

  it('returns structured Contract validation errors without a successful directory', async () => {
    const root = await workspace()
    const build = await buildPresentationStandardProject({
      frozenProject: createStandardFrozenProject(),
      projectSlug: 'invalid-contract-output',
      rules: STANDARD_TEST_RULES,
    })
    const invalidBuild = {
      ...build,
      documents: {
        ...build.documents,
        'pages/manifest.json': {
          ...(build.documents['pages/manifest.json'] as any),
          projectId: 'project_01992a80-0000-7000-8000-ffffffffffff',
        },
      },
    }

    let caught: unknown
    try {
      await publishPresentationStandardProject({
        workspaceRoot: root,
        build: invalidBuild,
        operationId: 'invalid-contract',
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(PresentationStandardProjectError)
    expect(caught).toMatchObject({
      code: 'PRESENTATION_STANDARD_PROJECT_VALIDATION_FAILED',
      stage: 'validation',
    })
    expect((caught as PresentationStandardProjectError).details).toHaveProperty('errors')
    await expect(readdir(join(root, build.directoryName))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await noTransientDirectories(root)).toBe(true)
  })
})
