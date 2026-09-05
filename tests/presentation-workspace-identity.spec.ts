import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { publishPresentationStandardProjectIntoWorkspace } from '../src/presentation/workspace-project-writer.ts'
import {
  buildSharedProject,
  cleanupSharedWorkspaces,
  createSharedWorkspace,
  expectContractValid,
  readJson,
  snapshotFiles,
  writePresentationOwnedFixture,
} from './helpers/shared-workspace-fixture.ts'

afterEach(cleanupSharedWorkspaces)

describe('shared Workspace projectId authority', () => {
  it('fails closed on projectId conflict without changing any formal or external file', async () => {
    const root = await createSharedWorkspace()
    const initialBuild = await buildSharedProject({ revision: 1, summary: '初始项目。' })
    const initial = await publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build: initialBuild,
      operationId: 'identity-initial',
    })
    await writePresentationOwnedFixture(root)
    const before = await snapshotFiles(root)

    const conflictingBuild = await buildSharedProject({
      revision: 2,
      summary: '不允许覆盖既有身份。',
    })
    expect(conflictingBuild.projectId).not.toBe(initialBuild.projectId)

    await expect(publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build: conflictingBuild,
      operationId: 'identity-conflict',
      expectedExistingFileHashes: initial.fileHashes,
    })).rejects.toMatchObject({ code: 'PROJECT_ID_CONFLICT' })

    expect(await snapshotFiles(root)).toEqual(before)
    expect((await readJson<{ projectId: string }>(join(root, 'project.json'))).projectId)
      .toBe(initialBuild.projectId)
    await expectContractValid(root)
  })

  it('reports PROJECT_ID_MISSING for a partial reserved project without project.json', async () => {
    const root = await createSharedWorkspace()
    await writeFile(join(root, 'rules.json'), '{"partial":true}\n', 'utf8')
    const before = await snapshotFiles(root)
    const build = await buildSharedProject({ revision: 1, summary: '缺失身份。' })

    await expect(publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build,
      operationId: 'identity-missing',
    })).rejects.toMatchObject({ code: 'PROJECT_ID_MISSING' })
    expect(await snapshotFiles(root)).toEqual(before)
  })

  it('reports PROJECT_ID_INVALID for malformed or non-Contract projectId', async () => {
    const root = await createSharedWorkspace()
    await writeFile(join(root, 'project.json'), JSON.stringify({ projectId: 'not-a-project-id' }), 'utf8')
    const before = await snapshotFiles(root)
    const build = await buildSharedProject({ revision: 1, summary: '非法身份。' })

    await expect(publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build,
      operationId: 'identity-invalid',
    })).rejects.toMatchObject({ code: 'PROJECT_ID_INVALID' })
    expect(await snapshotFiles(root)).toEqual(before)
  })
})
