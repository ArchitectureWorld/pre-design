import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
})
