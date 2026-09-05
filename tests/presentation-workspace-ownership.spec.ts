import { setTimeout as delay } from 'node:timers/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PRE_DESIGN_FIXED_MANAGED_PATHS,
} from '../src/presentation/workspace-managed-paths.ts'
import { publishPresentationStandardProjectIntoWorkspace } from '../src/presentation/workspace-project-writer.ts'
import {
  buildSharedProject,
  cleanupSharedWorkspaces,
  createSharedWorkspace,
  expectContractValid,
  mtimeNanoseconds,
  readJson,
  snapshotFiles,
  snapshotSelectedFiles,
  writeJson,
  writePresentationOwnedFixture,
  type FileSnapshot,
} from './helpers/shared-workspace-fixture.ts'

const EXTERNAL_PATHS = [
  'layouts/manifest.json',
  'layouts/pages/page-a.json',
  'layouts/openpencil/page-a.op',
  'layouts/future-component/unknown.bin',
  'third-party-extension/custom.json',
  'assets/other/future-component/unknown.bin',
] as const

function externalInventory(
  snapshot: Readonly<Record<string, FileSnapshot>>,
): Readonly<Record<string, FileSnapshot>> {
  return Object.freeze(Object.fromEntries(Object.entries(snapshot)
    .filter(([path]) => path.startsWith('layouts/')
      || path.startsWith('third-party-extension/')
      || path.startsWith('assets/other/future-component/'))
    .sort(([left], [right]) => left.localeCompare(right))))
}

afterEach(cleanupSharedWorkspaces)

describe('shared Workspace file ownership', () => {
  it('updates only exact Pre-managed files and preserves layouts plus unknown paths byte-for-byte', async () => {
    expect(PRE_DESIGN_FIXED_MANAGED_PATHS).toEqual([
      'project.json',
      'rules.json',
      'outline.json',
      'pages/manifest.json',
      'source-materials/manifest.json',
      'assets/manifest.json',
    ])

    const root = await createSharedWorkspace()
    const initialBuild = await buildSharedProject({ revision: 1, summary: '初始策划结论。' })
    const initial = await publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build: initialBuild,
      operationId: 'ownership-initial',
    })
    await writePresentationOwnedFixture(root)
    const externalBefore = await snapshotSelectedFiles(root, EXTERNAL_PATHS)
    const externalTreeBefore = externalInventory(await snapshotFiles(root))
    const projectIdBefore = (await readJson<{ projectId: string }>(join(root, 'project.json'))).projectId

    const updatedBuild = await buildSharedProject({
      revision: 2,
      summary: '更新后的策划结论。',
      stableIds: initialBuild.stableIds,
    })
    const updated = await publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build: updatedBuild,
      operationId: 'ownership-update',
      expectedExistingFileHashes: initial.fileHashes,
    })

    expect(await snapshotSelectedFiles(root, EXTERNAL_PATHS)).toEqual(externalBefore)
    expect(externalInventory(await snapshotFiles(root))).toEqual(externalTreeBefore)
    expect((await readJson<{ projectId: string }>(join(root, 'project.json'))).projectId)
      .toBe(projectIdBefore)
    expect(updated.projectId).toBe(projectIdBefore)
    expect(await readJson(join(root, 'outline.json'))).toMatchObject({ projectId: projectIdBefore })
    await expectContractValid(root)
  })

  it('keeps projectId and external files stable across three reopen-update cycles and skips unchanged writes', async () => {
    const root = await createSharedWorkspace()
    let build = await buildSharedProject({ revision: 1, summary: '第一版结论。' })
    let published = await publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build,
      operationId: 'cycle-1',
    })
    await writePresentationOwnedFixture(root)

    const projectId = (await readJson<{ projectId: string }>(join(root, 'project.json'))).projectId
    const externalBefore = await snapshotSelectedFiles(root, EXTERNAL_PATHS)
    const externalTreeBefore = externalInventory(await snapshotFiles(root))
    const rulesPath = join(root, 'rules.json')
    const rulesMtimeBefore = await mtimeNanoseconds(rulesPath)
    await delay(1100)

    for (const revision of [2, 3, 4]) {
      build = await buildSharedProject({
        revision,
        summary: `第 ${revision} 版结论。`,
        stableIds: build.stableIds,
      })
      published = await publishPresentationStandardProjectIntoWorkspace({
        directoryRoot: root,
        build,
        operationId: `cycle-${revision}`,
        expectedExistingFileHashes: published.fileHashes,
      })
      expect((await readJson<{ projectId: string }>(join(root, 'project.json'))).projectId)
        .toBe(projectId)
      expect(await snapshotSelectedFiles(root, EXTERNAL_PATHS)).toEqual(externalBefore)
      expect(externalInventory(await snapshotFiles(root))).toEqual(externalTreeBefore)
      await expectContractValid(root)
    }

    expect(await mtimeNanoseconds(rulesPath)).toBe(rulesMtimeBefore)
  })

  it('preserves compatible extension keys in a managed JSON document while updating known content', async () => {
    const root = await createSharedWorkspace()
    const initialBuild = await buildSharedProject({ revision: 1, summary: '第一版结论。' })
    const initial = await publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build: initialBuild,
      operationId: 'extension-initial',
    })

    const rulesPath = join(root, 'rules.json')
    const existing = await readJson<Record<string, unknown>>(rulesPath)
    const terminology = existing.terminology as Record<string, string>
    terminology['report-studio.future-layout-mode'] = 'preserve-without-interpretation'
    await writeJson(rulesPath, existing)

    const updatedBuild = await buildSharedProject({
      revision: 2,
      summary: '第二版已知内容。',
      stableIds: initialBuild.stableIds,
    })
    await publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build: updatedBuild,
      operationId: 'extension-update',
      expectedExistingFileHashes: initial.fileHashes,
    })

    const updatedRules = await readJson<{ terminology: Record<string, string> }>(rulesPath)
    expect(updatedRules.terminology['report-studio.future-layout-mode'])
      .toBe('preserve-without-interpretation')
    await expectContractValid(root)
  })

  it('rejects any candidate path inside layouts before writing the Workspace', async () => {
    const root = await createSharedWorkspace()
    const build = await buildSharedProject({ revision: 1, summary: '越权测试。' })
    const unsafeBuild = {
      ...build,
      documents: {
        ...build.documents,
        'layouts/forbidden.json': build.documents['project.json'],
      },
    }

    await expect(publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build: unsafeBuild,
      operationId: 'ownership-violation',
    })).rejects.toMatchObject({ code: 'EXTERNAL_PATH_MODIFICATION_FORBIDDEN' })
  })
})
