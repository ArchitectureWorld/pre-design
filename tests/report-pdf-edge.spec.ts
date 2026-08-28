import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildReportDocument } from '../src/report/build-document.ts'
import { renderHtml } from '../src/report/render-html.ts'
import { renderPdf } from '../src/report/render-pdf.ts'
import { REPORT_INPUT } from './report-fixture.ts'

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Edge PDF port', () => {
  it.runIf(existsSync(edge))('prints the client HTML through the installed Edge executable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-edge-pdf-'))
    roots.push(root)
    const document = buildReportDocument({ ...REPORT_INPUT, visualAssets: [] })
    const html = await renderHtml(document, root)
    const output = join(root, 'report.pdf')

    const artifact = await renderPdf(html.path, output, edge)

    expect((await readFile(output)).subarray(0, 5).toString()).toBe('%PDF-')
    expect(artifact.bytes).toBeGreaterThan(10_000)
  }, 30_000)
})
