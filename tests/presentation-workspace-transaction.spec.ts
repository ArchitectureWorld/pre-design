import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  recoverPresentationWorkspaceTransaction,
  workspaceTransactionDirectory,
} from '../src/presentation/workspace-write-transaction.ts'
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

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

afterEach(cleanupSharedWorkspaces)

describe('shared Workspace write transaction', () => {
  it('rolls back every managed file when a later multi-file commit step fails', async () => {
    const root = await createSharedWorkspace()
    const initialBuild = await buildSharedProject({ revision: 1, summary: '事务前内容。' })
    const initial = await publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build: initialBuild,
      operationId: 'rollback-initial',
    })
    await writePresentationOwnedFixture(root)
    const before = await snapshotFiles(root)

    const updatedBuild = await buildSharedProject({
      revision: 2,
      summary: '事务中更新多个文件。',
      projectName: '武汉站综合枢纽共享项目更新版',
      stableIds: initialBuild.stableIds,
    })

    await expect(publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build: updatedBuild,
      operationId: 'rollback-injected-failure',
      expectedExistingFileHashes: initial.fileHashes,
      hooks: {
        afterManagedPathCommitted: (_relativePath, index) => {
          if (index === 0) throw new Error('INJECTED_SECOND_FILE_FAILURE')
        },
      },
    })).rejects.toMatchObject({ code: 'WORKSPACE_TRANSACTION_FAILED' })

    expect(await snapshotFiles(root)).toEqual(before)
    expect(await exists(workspaceTransactionDirectory(root))).toBe(false)
    await expectContractValid(root)
  })

  it('detects an abandoned journal after restart and restores the pre-transaction project', async () => {
    const root = await createSharedWorkspace()
    const build = await buildSharedProject({ revision: 1, summary: '恢复前内容。' })
    await publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build,
      operationId: 'recovery-initial',
    })
    await writePresentationOwnedFixture(root)

    const outlinePath = join(root, 'outline.json')
    const originalOutline = await readFile(outlinePath)
    const transactionRoot = workspaceTransactionDirectory(root)
    const backupPath = join(transactionRoot, 'backup', 'outline.json')
    await mkdir(join(transactionRoot, 'backup'), { recursive: true })
    await rename(outlinePath, backupPath)
    await writeFile(outlinePath, '{"half":"new"}\n', 'utf8')
    await writeFile(join(transactionRoot, 'owner.json'), JSON.stringify({
      schemaVersion: 1,
      operationId: 'abandoned-after-restart',
      workspaceRoot: root,
      pid: 2147483647,
      createdAt: '2026-09-05T00:00:00.000Z',
    }), 'utf8')
    await writeFile(join(transactionRoot, 'journal.json'), JSON.stringify({
      schemaVersion: 1,
      operationId: 'abandoned-after-restart',
      workspaceRoot: root,
      projectId: build.projectId,
      phase: 'committing',
      actions: [{ relativePath: 'outline.json', kind: 'replace' }],
      currentAction: 0,
      completedActions: 0,
      createdLayoutsRoot: false,
    }), 'utf8')

    const recovered = await recoverPresentationWorkspaceTransaction(root)

    expect(recovered).toMatchObject({ status: 'recovered' })
    expect(await readFile(outlinePath)).toEqual(originalOutline)
    expect(await exists(transactionRoot)).toBe(false)
    expect((await readJson<{ projectId: string }>(join(root, 'project.json'))).projectId)
      .toBe(build.projectId)
    await expectContractValid(root)
  })

  it('allows one writer and rejects a concurrent writer with WORKSPACE_WRITE_LOCKED', async () => {
    const root = await createSharedWorkspace()
    const initialBuild = await buildSharedProject({ revision: 1, summary: '并发前内容。' })
    const initial = await publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build: initialBuild,
      operationId: 'concurrency-initial',
    })

    const firstBuild = await buildSharedProject({
      revision: 2,
      summary: '第一个事务。',
      stableIds: initialBuild.stableIds,
    })
    const secondBuild = await buildSharedProject({
      revision: 3,
      summary: '第二个事务不得交叉写入。',
      stableIds: initialBuild.stableIds,
    })
    const enteredCommit = deferred()
    const releaseCommit = deferred()

    const first = publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build: firstBuild,
      operationId: 'concurrency-first',
      expectedExistingFileHashes: initial.fileHashes,
      hooks: {
        beforeCommit: async () => {
          enteredCommit.resolve()
          await releaseCommit.promise
        },
      },
    })
    await enteredCommit.promise

    await expect(publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build: secondBuild,
      operationId: 'concurrency-second',
      expectedExistingFileHashes: initial.fileHashes,
    })).rejects.toMatchObject({ code: 'WORKSPACE_WRITE_LOCKED' })

    releaseCommit.resolve()
    await first
    expect((await readJson<{ projectId: string }>(join(root, 'project.json'))).projectId)
      .toBe(initialBuild.projectId)
    await expectContractValid(root)
  })
})
