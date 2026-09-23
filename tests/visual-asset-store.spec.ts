import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProjectDirectoryPlan, validateDocumentWithAjv } from '@architectureworld/presentation-contracts'
import { VisualAssetStore } from '../src/visual/asset-store.ts'

const roots: string[] = []
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('VisualAssetStore', () => {
  it('stores verified image bytes under the project boundary with hash and intrinsic dimensions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-visual-'))
    roots.push(root)
    const store = new VisualAssetStore(root, () => 'asset-1', () => '2026-08-28T08:00:00.000Z')
    const candidate = await store.saveCandidate({
      taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06',
      kind: 'concept', required: true, prompt: '滨水公共空间概念图',
    }, { mimeType: 'image/png', data: PNG_1X1 })

    expect(candidate).toMatchObject({
      assetId: 'asset-1', taskId: 'task-1', projectId: 'project-1', status: 'candidate',
      mimeType: 'image/png', width: 1, height: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      fileName: 'project-1/candidates/asset-1.png',
    })
    expect(await readFile(join(root, ...candidate.fileName.split('/')))).toEqual(Buffer.from(PNG_1X1, 'base64'))
  })

  it('rejects non-image media and unsafe project identifiers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-visual-'))
    roots.push(root)
    const store = new VisualAssetStore(root)
    const task = {
      taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06',
      kind: 'concept' as const, required: true, prompt: '概念图',
    }
    await expect(store.saveCandidate(task, { mimeType: 'text/html' as never, data: 'eA==' })).rejects.toThrow(/image/u)
    await expect(store.saveCandidate({ ...task, projectId: '../outside' }, {
      mimeType: 'image/png', data: PNG_1X1,
    })).rejects.toThrow(/projectId/u)
  })

  it('saves new images inside the bound project and reads migrated images there', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-visual-legacy-'))
    const workspace = await mkdtemp(join(tmpdir(), 'preplan-visual-workspace-'))
    roots.push(root, workspace)
    await mkdir(join(workspace, 'assets', 'images'), { recursive: true })
    const standard = createProjectDirectoryPlan({ name: 'Project', projectSlug: 'project' })
    await writeFile(join(workspace, 'assets', 'manifest.json'), JSON.stringify(standard.documents['assets/manifest.json']))
    let legacyHash: string | undefined
    const store = new VisualAssetStore(root, () => 'asset-1', () => '2026-08-28T08:00:00.000Z',
      projectId => projectId === 'project-1' ? workspace : undefined,
      fileName => fileName === 'project-1/candidates/legacy-duplicate.png' ? legacyHash : undefined)
    const candidate = await store.saveCandidate({
      taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06',
      kind: 'concept', required: true, prompt: '滨水公共空间概念图',
    }, { mimeType: 'image/png', data: PNG_1X1 })
    const expected = join(workspace, 'assets', 'images', 'asset-1.png')
    expect(store.resolveAsset(candidate.fileName)).toBe(expected)
    legacyHash = candidate.sha256
    expect(store.resolveAsset('project-1/candidates/legacy-duplicate.png')).toBe(expected)
    expect(await readFile(expected)).toEqual(Buffer.from(PNG_1X1, 'base64'))
    const manifest = JSON.parse(await readFile(join(workspace, 'assets', 'manifest.json'), 'utf8'))
    expect(manifest.assets).toMatchObject([{ adoptionStatus: 'candidate', adoptedAt: null,
      relativePath: 'assets/images/asset-1.png', sha256: candidate.sha256 }])
    expect((await validateDocumentWithAjv('AssetManifest', manifest)).valid).toBe(true)
    await store.setCandidateStatus('project-1', 'project-1/candidates/legacy-duplicate.png', 'adopted')
    const adoptedManifest = JSON.parse(await readFile(join(workspace, 'assets', 'manifest.json'), 'utf8'))
    expect(adoptedManifest.assets[0]).toMatchObject({ adoptionStatus: 'adopted', adoptedAt: '2026-08-28T08:00:00.000Z' })
    expect((await validateDocumentWithAjv('AssetManifest', adoptedManifest)).valid).toBe(true)
    await expect(readFile(join(root, ...candidate.fileName.split('/')))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(() => store.assertWritableProject('project-unknown')).toThrow('VISUAL_WORKSPACE_REQUIRED')
  })

  it('keeps resolving older images from the legacy store until they are migrated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-visual-legacy-'))
    const workspace = await mkdtemp(join(tmpdir(), 'preplan-visual-workspace-'))
    roots.push(root, workspace)
    const fileName = 'project-1/candidates/old.png'
    const oldPath = join(root, ...fileName.split('/'))
    await mkdir(join(root, 'project-1', 'candidates'), { recursive: true })
    await writeFile(oldPath, Buffer.from(PNG_1X1, 'base64'))
    const store = new VisualAssetStore(root, undefined, undefined, () => workspace)
    expect(store.resolveAsset(fileName)).toBe(oldPath)
  })
})
