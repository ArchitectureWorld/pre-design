import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportPackageService } from '../src/report/package-service.ts'
import { REPORT_INPUT } from './report-fixture.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function fixture(root: string, options: { requiredVisualPending?: boolean; pdfError?: Error } = {}) {
  const reportPackages: unknown[] = []
  const governance = {
    readProject: vi.fn(() => ({
      visualTasks: options.requiredVisualPending
        ? [{ taskId: 'required-1', required: true, status: 'candidate_ready' }]
        : [],
      visualAssets: [],
      reportPackages,
    })),
    putReportPackage: vi.fn(async (record) => { reportPackages.push(record); return record }),
  }
  const renderers = {
    html: vi.fn(async (_document, staging: string) => {
      await mkdir(join(staging, 'html'), { recursive: true })
      await writeFile(join(staging, 'html', 'index.html'), '<html data-report-revision="57"></html>')
    }),
    pptx: vi.fn(async (_document, output: string) => writeFile(output, Buffer.from('PK ppt/slides/slide1.xml'))),
    pdf: options.pdfError === undefined
      ? vi.fn(async (_html, output: string) => writeFile(output, Buffer.from('%PDF-1.7\n%%EOF')))
      : vi.fn(async () => { throw options.pdfError }),
  }
  const validate = vi.fn(async (staging: string) => ({
    manifestId: 'manifest-1', packageId: 'package-1', projectId: 'golden-project', sourceRevision: 57,
    artifacts: [
      { format: 'html' as const, fileName: 'html/index.html', sha256: 'a'.repeat(64), bytes: 42 },
      { format: 'pptx' as const, fileName: 'report.pptx', sha256: 'b'.repeat(64), bytes: 42 },
      { format: 'pdf' as const, fileName: 'report.pdf', sha256: 'c'.repeat(64), bytes: 42 },
    ],
    createdAt: '2026-08-28T10:00:00.000Z',
  }))
  return new ReportPackageService({
    governance: governance as never,
    packageRoot: root,
    browserExecutable: 'fake-edge.exe',
    source: vi.fn(async () => REPORT_INPUT),
    renderers,
    validate,
    createId: () => 'package-1',
    now: () => '2026-08-28T10:00:00.000Z',
  })
}

describe('ReportPackageService', () => {
  it('waits for concurrent renderers to settle before cleaning a failed staging package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-'))
    roots.push(root)
    let pptxFinished = false
    const service = fixture(root, { pdfError: new Error('print failed') })
    const renderers = (service as unknown as {
      renderers: { pptx: (document: unknown, output: string) => Promise<void> }
    }).renderers
    renderers.pptx = vi.fn(async (_document, output) => {
      await new Promise(resolve => setTimeout(resolve, 50))
      await writeFile(output, Buffer.from('PK ppt/slides/slide1.xml'))
      pptxFinished = true
    })

    await expect(service.publish('golden-project', 57)).rejects.toThrow(/print failed/u)
    expect(pptxFinished).toBe(true)
  })

  it('does not publish a partial directory when one renderer fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-'))
    roots.push(root)
    const service = fixture(root, { pdfError: new Error('print failed') })

    await expect(service.publish('golden-project', 57)).rejects.toThrow(/print failed/u)
    await expect(access(join(root, 'package-1'))).rejects.toThrow()
  })

  it('rejects publication while a required visual task is not adopted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-'))
    roots.push(root)
    await expect(fixture(root, { requiredVisualPending: true }).publish('golden-project', 57))
      .rejects.toThrow(/required visual asset/u)
  })

  it('publishes three formats and the manifest together', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-'))
    roots.push(root)
    const manifest = await fixture(root).publish('golden-project', 57)

    expect(manifest.artifacts.map(row => row.format).sort()).toEqual(['html', 'pdf', 'pptx'])
    expect(JSON.parse(await readFile(join(root, 'package-1', 'artifact-manifest.json'), 'utf8')))
      .toMatchObject({ sourceRevision: 57, packageId: 'package-1' })
  })
})
