import { watch } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateProjectDirectoryWithAjv } from '@architectureworld/presentation-contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPresentationStandardProject } from '../src/presentation/standard-project-adapter.ts'
import { publishPresentationStandardProjectIntoWorkspace } from '../src/presentation/workspace-project-writer.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'

const roots: string[] = []

const frozenProject: FrozenProjectInput = {
  projectId: 'preplan-workspace-root-test',
  projectName: '武汉站综合枢纽',
  revision: 3,
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

async function workspaceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pre-design-workspace-root-'))
  roots.push(root)
  await writeFile(join(root, '项目说明.txt'), '用户资料，不得被 Pre 覆盖。', 'utf8')
  await mkdir(join(root, 'layouts'), { recursive: true })
  await writeFile(join(root, 'layouts', 'page-1.json'), '{"layout":"human-owned"}\n', 'utf8')
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Presentation standard project in a DSH Workspace root', () => {
  it('publishes Canonical files directly into the existing Workspace while preserving unrelated files and layouts', async () => {
    const root = await workspaceRoot()
    const build = await buildPresentationStandardProject({ frozenProject, projectSlug: 'wuhan-station' })

    const published = await publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build,
      operationId: 'workspace-initial-export',
    })

    expect(published.directoryRoot).toBe(root)
    expect(JSON.parse(await readFile(join(root, 'project.json'), 'utf8'))).toMatchObject({
      projectId: build.projectId,
      standardVersion: '0.1.0',
    })
    expect(await readFile(join(root, '项目说明.txt'), 'utf8')).toBe('用户资料，不得被 Pre 覆盖。')
    expect(await readFile(join(root, 'layouts', 'page-1.json'), 'utf8')).toContain('human-owned')
    await expect(validateProjectDirectoryWithAjv(root)).resolves.toMatchObject({ valid: true })
  })

  it('ignores unrelated Workspace edits but rejects external changes to Pre-managed files', async () => {
    const root = await workspaceRoot()
    const build = await buildPresentationStandardProject({ frozenProject, projectSlug: 'wuhan-station' })
    const first = await publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build,
      operationId: 'workspace-first-export',
    })

    await writeFile(join(root, '项目说明.txt'), '用户继续修改自己的资料。', 'utf8')
    const second = await publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build,
      operationId: 'workspace-second-export',
      expectedExistingFileHashes: first.fileHashes,
    })
    expect(second.replacedExisting).toBe(true)
    expect(await readFile(join(root, '项目说明.txt'), 'utf8')).toBe('用户继续修改自己的资料。')

    await writeFile(join(root, 'outline.json'), '{"externally":"changed"}\n', 'utf8')
    await expect(publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build,
      operationId: 'workspace-third-export',
      expectedExistingFileHashes: second.fileHashes,
    })).rejects.toThrow('PRESENTATION_EXTERNAL_CHANGE_REVIEW_REQUIRED')
  })

  it('publishes updates while Report Studio watches the Workspace root, pages and drafts directories', async () => {
    const root = await workspaceRoot()
    const initialBuild = await buildPresentationStandardProject({
      frozenProject,
      projectSlug: 'wuhan-station',
    })
    const initial = await publishPresentationStandardProjectIntoWorkspace({
      directoryRoot: root,
      build: initialBuild,
      operationId: 'workspace-watched-initial',
    })
    const watchers = [
      watch(root, { persistent: true }, () => undefined),
      watch(join(root, 'pages'), { persistent: true }, () => undefined),
      watch(join(root, 'pages', 'drafts'), { persistent: true }, () => undefined),
    ]

    try {
      const updatedBuild = await buildPresentationStandardProject({
        frozenProject: {
          ...frozenProject,
          projectName: '武汉站综合枢纽更新版',
          revision: 4,
        },
        projectSlug: 'wuhan-station',
        stableIds: initialBuild.stableIds,
      })
      await publishPresentationStandardProjectIntoWorkspace({
        directoryRoot: root,
        build: updatedBuild,
        operationId: 'workspace-watched-update',
        expectedExistingFileHashes: initial.fileHashes,
      })
    } finally {
      for (const watcher of watchers) watcher.close()
    }

    expect(JSON.parse(await readFile(join(root, 'project.json'), 'utf8'))).toMatchObject({
      name: '武汉站综合枢纽更新版',
    })
    await expect(validateProjectDirectoryWithAjv(root)).resolves.toMatchObject({ valid: true })
  })
})
