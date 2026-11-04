import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { captureMaterialCorpus, verifyMaterialBindings, type MaterialEvidenceBinding } from '../src/materials/research-evidence.ts'
import { WorkspaceMaterialReader } from '../src/materials/workspace-materials.ts'
import { materialPdf } from './support/material-pdf.ts'

const roots: string[] = []
const workflowId = 'preplan.wf.01.01'
const now = '2026-09-26T00:00:00.000Z'
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'pre-material-evidence-'))
  roots.push(root)
  await mkdir(join(root, '原始资料'))
  return root
}
async function source(root: string, text: string, path = '原始资料/brief.txt'): Promise<MaterialEvidenceBinding> {
  await writeFile(join(root, path), text)
  return { dataPointId: 'project-location', path, contentHash: hash(text), quote: text }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('material corpus', () => {
  it('includes nested folder uploads and original JSON names that match generated metadata', async () => {
    const root = await workspace()
    const directory = join(root, '原始资料', '项目', '建筑', '方案', 'upload-uuid')
    await mkdir(directory, { recursive: true })
    for (const name of ['说明.txt', 'project.json', 'rules.json', 'outline.json', 'manifest.json', '.source.json']) {
      await writeFile(join(directory, name), JSON.stringify({ name, note: '用户原始资料' }))
    }
    await writeFile(join(root, 'project.json'), '{"note":"系统文件，不作为原件"}')
    const inventory = await new WorkspaceMaterialReader().list(root)
    expect(inventory.truncated).toBe(false)
    expect(inventory.files).toHaveLength(6)
    const corpus = await captureMaterialCorpus(root)
    expect(corpus.documents).toHaveLength(6)
    expect(corpus.documents.every(doc => doc.path.startsWith('原始资料/项目/建筑/方案/upload-uuid/'))).toBe(true)
  })

  it('extracts all real PDF pages across batches and deduplicates byte-identical originals/copies', async () => {
    const root = await workspace()
    const bytes = materialPdf(Array.from({ length: 12 }, (_, index) => `Physical page ${index + 1}`))
    await writeFile(join(root, '原始资料', 'a-original.pdf'), bytes)
    await mkdir(join(root, '原始资料', 'copies'))
    await writeFile(join(root, '原始资料', 'copies', 'copied.pdf'), bytes)
    await writeFile(join(root, 'summary.md'), 'Generated model summary must not become source')
    await mkdir(join(root, 'source-materials'))
    await writeFile(join(root, 'source-materials', 'ignored.txt'), 'Fallback is not original')
    const result = await captureMaterialCorpus(root)
    expect(result.documents).toHaveLength(1)
    expect(result.documents[0]).toMatchObject({ path: '原始资料/a-original.pdf', contentHash: hash(bytes), byteLength: bytes.length })
    expect(result.documents[0].pages).toHaveLength(12)
    expect(result.documents[0].pages?.at(-1)).toEqual({ page: 12, text: 'Physical page 12' })
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect((await captureMaterialCorpus(root)).fingerprint).toBe(result.fingerprint)
  })

  it('uses source-materials only when no original files exist', async () => {
    const root = await workspace()
    await mkdir(join(root, 'source-materials'))
    await writeFile(join(root, 'source-materials', 'brief.txt'), 'Fallback source')
    expect((await captureMaterialCorpus(root)).documents[0]).toMatchObject({ path: 'source-materials/brief.txt', text: 'Fallback source' })
    await writeFile(join(root, '原始资料', 'drawing.dwg'), 'CAD')
    const result = await captureMaterialCorpus(root)
    expect(result.documents).toEqual([])
    expect(result.limitations.join(' ')).toMatch(/drawing\.dwg/)
  })

  it('paginates source text without inventing content from a filename', async () => {
    const root = await workspace()
    const text = Array.from({ length: 1_003 }, (_, index) => `Line ${index + 1}`).join('\n')
    await source(root, text, '原始资料/a.txt')
    await source(root, '', '原始资料/Approved 900 rooms.txt')
    const result = await captureMaterialCorpus(root)
    expect(result.documents.find(row => row.path === '原始资料/a.txt')?.text).toBe(text)
    expect(JSON.stringify(result.documents.map(row => row.text))).not.toContain('900 rooms')
    expect(result.limitations.join(' ')).toMatch(/empty/i)
  })

  it('bounds total corpus characters and reports every skipped/truncated source', async () => {
    const root = await workspace()
    await source(root, '1234567890', '原始资料/a.txt')
    await source(root, 'Second source', '原始资料/b.txt')
    const result = await captureMaterialCorpus(root, { maxChars: 7 })
    expect(result.documents[0].text).toBe('1234567')
    expect(result.documents).toHaveLength(1)
    expect(result.limitations.join(' ')).toMatch(/a\.txt.*truncat/i)
    expect(result.limitations.join(' ')).toMatch(/b\.txt/)
  })

  it('reports per-page extraction truncation and scanned pages', async () => {
    const root = await workspace()
    await writeFile(join(root, '原始资料', 'long.pdf'), materialPdf(['Very long text on first page', 'Page two']))
    await writeFile(join(root, '原始资料', 'scan.pdf'), materialPdf(['']))
    const result = await captureMaterialCorpus(root, { reader: new WorkspaceMaterialReader({ maxChars: 10 }) })
    expect(result.documents[0].pages?.map(page => page.page)).toEqual([1, 2])
    expect(result.limitations.join(' ')).toMatch(/long\.pdf.*page 1.*truncat/i)
    expect(result.limitations.join(' ')).toMatch(/scan\.pdf.*OCR/)
  })

  it('reports unsupported executables and oversized files without reading them', async () => {
    const root = await workspace()
    await writeFile(join(root, '原始资料', 'launch.exe'), 'not executed')
    await writeFile(join(root, '原始资料', 'large.txt'), '123456789')
    const result = await captureMaterialCorpus(root, { reader: new WorkspaceMaterialReader({ maxBytes: 4 }) })
    expect(result.documents).toEqual([])
    expect(result.limitations.join(' ')).toMatch(/launch\.exe.*unsupported/i)
    expect(result.limitations.join(' ')).toMatch(/large\.txt.*oversized/i)
  })

  it('reports inventory limits rather than claiming that every file was captured', async () => {
    const root = await workspace()
    await Promise.all(Array.from({ length: 257 }, (_, index) => writeFile(join(root, '原始资料', `${index}.txt`), `Source ${index}`)))
    const result = await captureMaterialCorpus(root)
    expect(result.documents).toHaveLength(256)
    expect(result.limitations.join(' ')).toMatch(/inventory.*truncat/i)
  })

  it('does not mistake an inventory limit for absence of original source files', async () => {
    const root = await workspace()
    await mkdir(join(root, 'source-materials'))
    await Promise.all(Array.from({ length: 256 }, (_, index) => writeFile(join(root, 'source-materials', `${index}.txt`), `Fallback ${index}`)))
    const binding = await source(root, 'Actual original')
    const result = await captureMaterialCorpus(root)
    expect(result.documents.every(document => document.path.startsWith('原始资料/'))).toBe(true)
    expect(result.limitations.join(' ')).toMatch(/inventory.*truncat/i)
    await expect(verifyMaterialBindings(root, workflowId, [{ ...binding, path: 'source-materials/0.txt', contentHash: hash('Fallback 0'), quote: 'Fallback 0' }])).rejects.toThrow(/source/)
  })
})

describe('verified material bindings', () => {
  it('rereads the physical PDF page and preserves the quote and original byte hash', async () => {
    const root = await workspace()
    const bytes = materialPdf(['First source page', 'Proposed capacity: 120 rooms.'])
    const path = '原始资料/source.pdf'
    await writeFile(join(root, path), bytes)
    const binding = { dataPointId: 'project-capacity', path, contentHash: hash(bytes), page: 2, quote: 'capacity: 120 rooms.' }
    const records = await verifyMaterialBindings(root, workflowId, [binding], { now })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ workflowId, dataPointId: 'project-capacity', sourceId: 'workspace-project-files',
      sourceType: 'workspace_file', sourceUri: pathToFileURL(join(root, path)).href, capturedAt: now,
      contentHash: hash(bytes), reliability: 'B', claimClass: 'source_conclusion',
      rawValue: binding.quote, normalizedValue: binding.quote,
      locator: { relativePath: path, page: 2, quote: binding.quote, fragmentHash: hash(binding.quote) } })
    expect((await verifyMaterialBindings(root, workflowId, [binding]))[0].evidenceId).toBe(records[0].evidenceId)
    await expect(verifyMaterialBindings(root, workflowId, [{ ...binding, page: 1 }])).rejects.toThrow(/quote/)
    await expect(verifyMaterialBindings(root, workflowId, [{ ...binding, page: undefined }])).rejects.toThrow(/page/)
  })

  it('permits only NFKC and whitespace normalization for contiguous source matching', async () => {
    const root = await workspace()
    const binding = await source(root, '项目：ＡＢＣ\r\n容量：１２０ 间。')
    const quote = 'ABC 容量:120 间。'
    expect((await verifyMaterialBindings(root, workflowId, [{ ...binding, quote }]))[0].rawValue).toBe(quote)
    for (const forged of ['ABC 容量:12 间。', 'ABC 容量120 间。', 'ABC 间。']) {
      await expect(verifyMaterialBindings(root, workflowId, [{ ...binding, quote: forged }])).rejects.toThrow(/quote/)
    }
  })

  it('finds a contiguous quote spanning a text read boundary', async () => {
    const root = await workspace()
    const text = [...Array.from({ length: 999 }, () => 'filler'), 'Quoted line', 'continues here'].join('\n')
    const binding = await source(root, text)
    const record = (await verifyMaterialBindings(root, workflowId, [{ ...binding, quote: 'Quoted line\ncontinues here' }]))[0]
    expect(record.rawValue).toBe('Quoted line\ncontinues here')
  })

  it('rejects changed files even when the supplied quote remains in the source', async () => {
    const root = await workspace()
    const binding = await source(root, 'Original quote')
    await writeFile(join(root, binding.path), 'Original quote\nNew revision')
    await expect(verifyMaterialBindings(root, workflowId, [binding])).rejects.toThrow(/hash|changed/i)
  })

  it('rejects traversal, outside junctions and generated summaries as evidence', async () => {
    const root = await workspace()
    const outside = await workspace()
    const binding = await source(outside, 'Outside source')
    await symlink(outside, join(root, '原始资料', 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    await source(root, 'Model generated summary', 'summary.txt')
    for (const path of ['../outside.txt', '原始资料/escape/原始资料/brief.txt', 'summary.txt']) {
      await expect(verifyMaterialBindings(root, workflowId, [{ ...binding, path }])).rejects.toThrow(/source|workspace|material|outside/i)
    }
  })

  it('rejects empty, missing, forged-hash and duplicate data point bindings', async () => {
    const root = await workspace()
    const binding = await source(root, 'Actual assertion')
    for (const invalid of [{ ...binding, quote: '  ' }, { ...binding, path: '原始资料/missing.txt' },
      { ...binding, contentHash: '0'.repeat(64) }, { ...binding, dataPointId: '' }]) {
      await expect(verifyMaterialBindings(root, workflowId, [invalid])).rejects.toThrow()
    }
    await expect(verifyMaterialBindings(root, workflowId, [binding, binding])).rejects.toThrow(/duplicate/i)
  })

  it('honors abort before and during extraction instead of converting cancellation into a limitation', async () => {
    const root = await workspace()
    const binding = await source(root, 'Actual assertion')
    const signal = AbortSignal.abort(new Error('user cancelled'))
    await expect(captureMaterialCorpus(root, { signal })).rejects.toThrow('user cancelled')
    await expect(verifyMaterialBindings(root, workflowId, [binding], { signal })).rejects.toThrow('user cancelled')
    const controller = new AbortController()
    class CancellingReader extends WorkspaceMaterialReader {
      override async read(...args: Parameters<WorkspaceMaterialReader['read']>) {
        const result = await super.read(...args)
        controller.abort(new Error('cancelled during read'))
        return result
      }
    }
    await expect(captureMaterialCorpus(root, { signal: controller.signal, reader: new CancellingReader() })).rejects.toThrow('cancelled during read')
  })
})
