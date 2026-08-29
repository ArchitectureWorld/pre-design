import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { planClientPages } from '../src/report/page-plan.ts'
import { renderPdf } from '../src/report/render-pdf.ts'
import { renderPrintHtml } from '../src/report/render-print-html.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('renderPdf', () => {
  it('builds a 48-72 page print source without client-visible governance fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-print-html-'))
    roots.push(root)
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, CLIENT_PROFILE)
    const context = {
      report: bundle.report,
      plan: planClientPages(bundle.report, 'pdf'),
      identity: bundle.identity,
    }

    const path = await renderPrintHtml(context, root)
    const html = await readFile(path, 'utf8')
    const body = html.match(/<body[\s\S]*<\/body>/u)?.[0] ?? ''
    const printPages = html.match(/class="print-page/gu) ?? []

    expect(printPages.length).toBeGreaterThanOrEqual(48)
    expect(printPages.length).toBeLessThanOrEqual(72)
    expect(body).not.toMatch(/Gate|Revision|Workflow|工作项|完成度/iu)
    expect(html).toContain('data-page-kind="appendix"')
    expect(html).not.toMatch(/https?:\/\//iu)
  })

  it('prints the same local HTML through the supplied browser port and verifies a PDF header', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-pdf-'))
    roots.push(root)
    const html = join(root, 'index.html')
    const output = join(root, 'report.pdf')
    await writeFile(html, '<!doctype html><html><head><meta name="preplan-project-id" content="golden-project"><meta name="preplan-source-revision" content="57"><meta name="preplan-recommendation-id" content="recommendation-r57-cultural-riverfront"><meta name="preplan-adopted-assets" content="concept-1,concept-2"></head><body>前期策划</body></html>', 'utf8')
    const runner = vi.fn(async (_executable: string, args: readonly string[]) => {
      expect(args.some(argument => argument.startsWith('file:///'))).toBe(true)
      await writeFile(output, Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF'))
    })

    const artifact = await renderPdf(html, output, 'fake-edge.exe', runner)

    const pdf = await readFile(output)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const encoded = pdf.toString('latin1').split('%PREPLAN-METADATA:').at(-1)?.split(/\r?\n/u)[0]
    expect(JSON.parse(Buffer.from(encoded ?? '', 'base64url').toString('utf8'))).toEqual({
      projectId: 'golden-project',
      sourceRevision: 57,
      recommendationId: 'recommendation-r57-cultural-riverfront',
      adoptedAssetIds: ['concept-1', 'concept-2'],
    })
    expect(artifact).toMatchObject({ format: 'pdf', fileName: 'report.pdf', sha256: expect.any(String) })
    expect(runner).toHaveBeenCalledOnce()
  })
})
