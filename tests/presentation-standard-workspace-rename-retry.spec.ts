import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPresentationStandardProject } from '../src/presentation/standard-project-adapter.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'

const renameFailure = vi.hoisted(() => ({
  target: '' as string,
  failuresRemaining: 0,
  targetCalls: 0,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (oldPath: string, newPath: string) => {
      if (oldPath === renameFailure.target) {
        renameFailure.targetCalls += 1
        if (renameFailure.failuresRemaining > 0) {
          renameFailure.failuresRemaining -= 1
          throw Object.assign(new Error('simulated transient Windows directory lock'), {
            code: 'EPERM',
            syscall: 'rename',
            path: oldPath,
            dest: newPath,
          })
        }
      }
      return actual.rename(oldPath, newPath)
    },
  }
})

const { publishPresentationStandardProjectIntoWorkspace } = await import(
  '../src/presentation/workspace-project-writer.ts'
)

const roots: string[] = []

function frozenProject(revision: number, projectName: string): FrozenProjectInput {
  return {
    projectId: 'preplan-workspace-retry-test',
    projectName,
    revision,
    generatedAt: '2026-09-04T02:30:00.000Z',
    recommendation: '形成站城一体的综合枢纽。',
    decisionItems: [],
    stateObjects: [{
      objectId: 'DG05', chapterId: '03', workItemId: '03-05',
      title: '核心机会', summary: '整合铁路、城市与公共空间。', facts: [],
    }],
    gates: [],
    visualAssets: [],
    adoptedAssetIds: [],
    siteBoundary: { status: 'not_provided' },
  }
}

afterEach(async () => {
  renameFailure.target = ''
  renameFailure.failuresRemaining = 0
  renameFailure.targetCalls = 0
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Presentation standard project Workspace commit retries', () => {
  it('retries a transient EPERM while replacing the managed page manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pre-design-workspace-retry-'))
    roots.push(root)
    await mkdir(join(root, 'layouts'), { recursive: true })
    await writeFile(join(root, 'layouts', 'human-owned.json'), '{}\n', 'utf8')

    const initialBuild = await buildPresentationStandardProject({
      frozenProject: frozenProject(3, '武汉站综合枢纽'),
      projectSlug: 'wuhan-station',
    })
    const initial = await publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build: initialBuild,
      operationId: 'workspace-retry-initial',
    })

    const updatedBuild = await buildPresentationStandardProject({
      frozenProject: frozenProject(4, '武汉站综合枢纽更新版'),
      projectSlug: 'wuhan-station',
    })
    renameFailure.target = join(root, 'pages', 'manifest.json')
    renameFailure.failuresRemaining = 1

    await publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build: updatedBuild,
      operationId: 'workspace-retry-update',
      expectedExistingFileHashes: initial.fileHashes,
    })

    expect(renameFailure.targetCalls).toBe(2)
    expect(JSON.parse(await readFile(join(root, 'project.json'), 'utf8'))).toMatchObject({
      name: '武汉站综合枢纽更新版',
    })
    await expect(readFile(join(root, 'layouts', 'human-owned.json'), 'utf8')).resolves.toBe('{}\n')
  })
})
