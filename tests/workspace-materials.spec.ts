import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceMaterialReader } from '../src/materials/workspace-materials.ts'
import { materialPdf } from './support/material-pdf.ts'

const roots: string[] = []
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'pre-materials-'))
  roots.push(root)
  await mkdir(join(root, '原始资料'))
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('workspace material reader', () => {
  it('lists original PDF and unsupported CAD without treating generated project metadata as a source', async () => {
    const root = await workspace()
    await writeFile(join(root, '原始资料', 'plan.pdf'), materialPdf(['Source']))
    await writeFile(join(root, '原始资料', 'site.dwg'), 'binary')
    await writeFile(join(root, 'project.json'), '{"name":"generated"}')
    const result = await new WorkspaceMaterialReader().list(root)
    expect(result.files.map(file => [file.path, file.readable])).toEqual([
      ['原始资料/plan.pdf', true], ['原始资料/site.dwg', false],
    ])
  })

  it('reads the requested real PDF page and preserves source hash and pagination', async () => {
    const root = await workspace()
    const bytes = materialPdf(['First page', 'Verified source page two', 'Third page'])
    await writeFile(join(root, '原始资料', 'source.pdf'), bytes)
    const result = await new WorkspaceMaterialReader().read(root, { path: '原始资料/source.pdf', startPage: 2, maxPages: 1 })
    expect(result).toMatchObject({
      status: 'ok', pageCount: 3, nextPage: 3, contentHash: createHash('sha256').update(bytes).digest('hex'),
      pages: [{ page: 2, text: 'Verified source page two' }],
    })
  })

  it('reads UTF-8 source lines with a reproducible line locator', async () => {
    const root = await workspace()
    await writeFile(join(root, '原始资料', 'brief.txt'), '项目名称\r\n项目所在地：武汉\r\n启动原因：改造\r\n')
    const result = await new WorkspaceMaterialReader().read(root, { path: '原始资料/brief.txt', startLine: 2, maxLines: 1 })
    expect(result).toMatchObject({ status: 'ok', text: '项目所在地：武汉', startLine: 2, endLine: 2, nextLine: 3 })
  })

  it('marks an image-only/empty PDF page as needing OCR instead of claiming extraction succeeded', async () => {
    const root = await workspace()
    await writeFile(join(root, 'scan.pdf'), materialPdf(['']))
    const result = await new WorkspaceMaterialReader().read(root, { path: 'scan.pdf' })
    expect(result).toMatchObject({ status: 'needs_ocr', pages: [{ page: 1, text: '' }] })
  })

  it('bounds output and makes truncation explicit', async () => {
    const root = await workspace()
    await writeFile(join(root, 'long.txt'), 'A'.repeat(200))
    const result = await new WorkspaceMaterialReader({ maxChars: 40 }).read(root, { path: 'long.txt' })
    expect(result.text).toHaveLength(40)
    expect(result.truncated).toBe(true)
  })

  it('rejects invalid page ranges, unsupported binaries and oversized files', async () => {
    const root = await workspace()
    await writeFile(join(root, 'one.pdf'), materialPdf(['One']))
    await writeFile(join(root, 'site.dwg'), 'CAD')
    const reader = new WorkspaceMaterialReader()
    await expect(reader.read(root, { path: 'one.pdf', startPage: 0 })).rejects.toThrow(/startPage/)
    await expect(reader.read(root, { path: 'one.pdf', startPage: 2 })).rejects.toThrow(/page/)
    await expect(reader.read(root, { path: 'one.pdf', maxPages: 100 })).rejects.toThrow(/maxPages/)
    await expect(reader.read(root, { path: 'site.dwg' })).rejects.toThrow(/unsupported/)
    await expect(new WorkspaceMaterialReader({ maxBytes: 2 }).read(root, { path: 'one.pdf' })).rejects.toThrow(/maxBytes/)
  })

  it('rejects traversal and junction escapes without reading outside the workspace', async () => {
    const root = await workspace()
    const outside = await workspace()
    await writeFile(join(outside, 'secret.txt'), 'not a source')
    await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    const reader = new WorkspaceMaterialReader()
    await expect(reader.read(root, { path: '../outside.txt' })).rejects.toThrow(/workspace/)
    await expect(reader.read(root, { path: 'escape/secret.txt' })).rejects.toThrow(/workspace/)
    expect((await reader.list(root)).files).toEqual([])
  })

  it('honors cancellation before touching a material', async () => {
    const root = await workspace()
    const signal = AbortSignal.abort(new Error('cancelled by user'))
    await expect(new WorkspaceMaterialReader().read(root, { path: 'missing.pdf' }, signal)).rejects.toThrow('cancelled by user')
  })
})
