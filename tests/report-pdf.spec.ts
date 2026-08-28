import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderPdf } from '../src/report/render-pdf.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('renderPdf', () => {
  it('prints the same local HTML through the supplied browser port and verifies a PDF header', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-pdf-'))
    roots.push(root)
    const html = join(root, 'index.html')
    const output = join(root, 'report.pdf')
    await writeFile(html, '<!doctype html><html data-report-revision="57" data-recommendation-id="recommendation-r57-cultural-riverfront" data-adopted-asset-ids="concept-1,concept-2"><body>前期策划</body></html>', 'utf8')
    const runner = vi.fn(async (_executable: string, args: readonly string[]) => {
      expect(args.some(argument => argument.startsWith('file:///'))).toBe(true)
      await writeFile(output, Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF'))
    })

    const artifact = await renderPdf(html, output, 'fake-edge.exe', runner)

    const pdf = await readFile(output)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const encoded = pdf.toString('latin1').split('%PREPLAN-METADATA:').at(-1)?.split(/\r?\n/u)[0]
    expect(JSON.parse(Buffer.from(encoded ?? '', 'base64url').toString('utf8'))).toEqual({
      revision: 57,
      recommendationId: 'recommendation-r57-cultural-riverfront',
      adoptedAssetIds: ['concept-1', 'concept-2'],
    })
    expect(artifact).toMatchObject({ format: 'pdf', fileName: 'report.pdf', sha256: expect.any(String) })
    expect(runner).toHaveBeenCalledOnce()
  })
})
