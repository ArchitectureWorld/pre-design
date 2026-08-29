import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertClientReportPolicy } from '../src/report/client-policy.ts'
import { planClientPages } from '../src/report/page-plan.ts'
import { ReportPackageService } from '../src/report/package-service.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

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
    html: vi.fn(async (_context, staging: string) => {
      await mkdir(join(staging, 'html'), { recursive: true })
      await writeFile(join(staging, 'html', 'index.html'), '<html><head></head><body>成果</body></html>')
    }),
    printHtml: vi.fn(async (_context, staging: string) => {
      await mkdir(join(staging, 'print'), { recursive: true })
      const path = join(staging, 'print', 'index.html')
      await writeFile(path, '<html><head></head><body>打印成果</body></html>')
      return path
    }),
    pptx: vi.fn(async (_context, output: string) => writeFile(output, Buffer.from('PK ppt/slides/slide1.xml'))),
    pdf: options.pdfError === undefined
      ? vi.fn(async (_html, output: string) => writeFile(output, Buffer.from('%PDF-1.7\n%%EOF')))
      : vi.fn(async () => { throw options.pdfError }),
  }
  const validate = vi.fn(async (_staging: string, identity) => ({
    ...identity,
    artifacts: [
      { format: 'html' as const, fileName: 'html/index.html', sha256: 'a'.repeat(64), bytes: 42 },
      { format: 'pptx' as const, fileName: 'report.pptx', sha256: 'b'.repeat(64), bytes: 42 },
      { format: 'pdf' as const, fileName: 'report.pdf', sha256: 'c'.repeat(64), bytes: 42 },
    ],
  }))
  const policy = vi.fn(assertClientReportPolicy)
  const planner = vi.fn(planClientPages)
  const profile = vi.fn(async () => CLIENT_PROFILE)
  const source = vi.fn(async () => REPORT_INPUT)
  const service = new ReportPackageService({
    governance: governance as never,
    packageRoot: root,
    browserExecutable: 'fake-edge.exe',
    source,
    profile,
    policy,
    planner,
    renderers,
    validate,
    createId: () => 'package-1',
    now: () => '2026-08-28T10:00:00.000Z',
  })
  return { service, governance, renderers, validate, policy, planner, profile, source }
}

describe('ReportPackageService', () => {
  it('publishes only after client policy, three page plans, renderers, and identity validation pass', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-'))
    roots.push(root)
    const ports = fixture(root)

    const manifest = await ports.service.publish('golden-project', 57)

    expect(manifest.artifacts.map(row => row.format).sort()).toEqual(['html', 'pdf', 'pptx'])
    expect(ports.policy).toHaveBeenCalledOnce()
    expect(ports.planner).toHaveBeenCalledWith(expect.anything(), 'html')
    expect(ports.planner).toHaveBeenCalledWith(expect.anything(), 'pptx')
    expect(ports.planner).toHaveBeenCalledWith(expect.anything(), 'pdf')
    expect(ports.policy.mock.invocationCallOrder[0]).toBeLessThan(ports.renderers.html.mock.invocationCallOrder[0]!)
    expect(ports.renderers.printHtml).toHaveBeenCalledBefore(ports.renderers.pdf)
    expect(ports.validate).toHaveBeenCalledAfter(ports.renderers.pdf)
    expect(JSON.parse(await readFile(join(root, 'package-1', 'artifact-manifest.json'), 'utf8')))
      .toMatchObject({ sourceRevision: 57, packageId: 'package-1' })
  })

  it('keeps existing packages and publishes nothing when policy validation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-'))
    roots.push(root)
    const existing = join(root, 'package-existing')
    await mkdir(existing, { recursive: true })
    await writeFile(join(existing, 'artifact-manifest.json'), '{}')
    const ports = fixture(root)
    ports.policy.mockImplementation(() => { throw new Error('CLIENT_FORBIDDEN_TERM') })

    await expect(ports.service.publish('golden-project', 57)).rejects.toThrow(/CLIENT_FORBIDDEN_TERM/u)
    await expect(access(join(existing, 'artifact-manifest.json'))).resolves.toBeUndefined()
    await expect(access(join(root, 'package-1'))).rejects.toThrow()
    expect(ports.renderers.html).not.toHaveBeenCalled()
  })

  it('waits for concurrent renderers to settle before cleaning a failed staging package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-'))
    roots.push(root)
    let pptxFinished = false
    const ports = fixture(root, { pdfError: new Error('print failed') })
    ports.renderers.pptx.mockImplementation(async (_context, output) => {
      await new Promise(resolve => setTimeout(resolve, 50))
      await writeFile(output, Buffer.from('PK ppt/slides/slide1.xml'))
      pptxFinished = true
    })

    await expect(ports.service.publish('golden-project', 57)).rejects.toThrow(/print failed/u)
    expect(pptxFinished).toBe(true)
  })

  it('does not publish a partial directory when one renderer fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-'))
    roots.push(root)
    const ports = fixture(root, { pdfError: new Error('print failed') })

    await expect(ports.service.publish('golden-project', 57)).rejects.toThrow(/print failed/u)
    await expect(access(join(root, 'package-1'))).rejects.toThrow()
  })

  it('rejects publication while a required visual task is not adopted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-'))
    roots.push(root)
    await expect(fixture(root, { requiredVisualPending: true }).service.publish('golden-project', 57))
      .rejects.toThrow(/required visual asset/u)
  })
})
