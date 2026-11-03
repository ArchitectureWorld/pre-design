import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceMaterialReader } from '../src/materials/workspace-materials.ts'
import { materialPdf } from './support/material-pdf.ts'
import sharp from 'sharp'

const roots: string[] = []
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'pre-materials-'))
  roots.push(root)
  await mkdir(join(root, '原始资料'))
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('workspace material reader', () => {
  it('reads source photograph capture metadata without substituting edit time, ground height or intended land use', async () => {
    const root = await workspace()
    const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#abcdef' } }).jpeg().withExif({
      IFD0: { DateTime: '2026:09:20 15:00:00' }, IFD2: { DateTimeOriginal: '2026:09:15 15:15:32' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '30/1 51/1 3/1', GPSLongitudeRef: 'E', GPSLongitude: '114/1 58/1 7/1', GPSAltitude: '197/1' },
    }).toBuffer()
    await writeFile(join(root, '原始资料', '拟建民宿.JPG'), bytes)
    const reader = new WorkspaceMaterialReader()
    expect((await reader.list(root)).files[0].readable).toBe(true)
    const result = await reader.read(root, { path: '原始资料/拟建民宿.JPG' })
    const metadata = JSON.parse(result.text!)
    expect(metadata).toMatchObject({ kind: 'source-image-metadata.v1', width: 20, height: 10,
      capture: { dateTimeOriginal: '2026:09:15 15:15:32', timeZone: null, latitude: 30.850833333333334, longitude: 114.96861111111112, direction: null } })
    expect(result.contentHash).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(metadata.limitations.join(' ')).toMatch(/不.*地面/u)
    expect(metadata.limitations.join(' ')).toMatch(/不.*用途/u)
  })
  it('keeps missing photograph date and coordinates unknown even when a file has an editing timestamp', async () => {
    const root = await workspace()
    const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#abcdef' } }).jpeg()
      .withExif({ IFD0: { DateTime: '2026:09:20 15:00:00' } }).toBuffer()
    await writeFile(join(root, '原始资料', '20260915-现场.JPG'), bytes)
    const result = await new WorkspaceMaterialReader().read(root, { path: '原始资料/20260915-现场.JPG' })
    expect(JSON.parse(result.text!).capture).toMatchObject({ dateTimeOriginal: null, latitude: null, longitude: null, direction: null })
  })
  it('inventories a photo collection without dropping later original documents at the old 64-file limit', async () => {
    const root = await workspace()
    await Promise.all(Array.from({ length: 65 }, (_, i) => writeFile(join(root, '原始资料', `${i}.jpg`), 'not-read-in-list')))
    await writeFile(join(root, '原始资料', '水利说明.txt'), 'Original water context')
    const result = await new WorkspaceMaterialReader().list(root)
    expect(result.truncated).toBe(false)
    expect(result.files).toHaveLength(66)
    expect(result.files.at(-1)?.path).toBe('原始资料/水利说明.txt')
  })
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
