import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConditionalReportPackageService } from '../src/report/conditional-package-service.ts'
import { renderConditionalHtml } from '../src/report/conditional-render-html.ts'
import { renderPptx } from '../src/report/render-pptx.ts'
import { renderPrintHtml } from '../src/report/render-print-html.ts'
import { readHtmlArtifactIdentity } from '../src/report/validate-artifacts.ts'
import { reportImageDimensions } from '../src/report/regular/image-dimensions.ts'
import type { ArtifactRecord, ReportPackageRecord } from '../src/governance/types.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture(formats?: readonly ArtifactRecord['format'][]) {
  const root = await mkdtemp(join(tmpdir(), 'conditional-package-'))
  roots.push(root)
  const state = { revision: 103, complete: true, pending: false }
  const records = new Map<string, ReportPackageRecord>()
  const source: FrozenProjectInput = { projectId: 'project', projectName: '少潭河', revision: 103,
    generatedAt: '2026-09-17T10:00:00Z', recommendation: '待核', decisionItems: [], gates: [], visualAssets: [],
    siteBoundary: { status: 'not_provided' }, stateObjects: [{ objectId: 'PS01', chapterId: '01', title: '研究方向',
      summary: '文旅休闲开发，边界未知。', facts: [{ label: '约束', value: '建设规模待核', basis: '现有资料缺口' }] }] }
  const renderers = { html: vi.fn(renderConditionalHtml), printHtml: vi.fn(renderPrintHtml), pptx: vi.fn(renderPptx),
    // Metadata/signature fixture; production acceptance separately runs Chromium.
    pdf: vi.fn(async (html: string, path: string) => {
      const identity = readHtmlArtifactIdentity(await readFile(html, 'utf8'))
      await writeFile(path, '%PDF-1.4\n%PREPLAN-METADATA:' + Buffer.from(JSON.stringify(identity)).toString('base64url') + '\n')
    }) }
  let id = 0
  const options = { packageRoot: root, browserExecutable: 'unused-fixture', source: async () => source,
    ...(formats === undefined ? {} : { formats }),
    currentRevision: () => state.revision, isComplete: () => state.complete, createId: () => `package-${++id}`,
    governance: { readProject: () => ({ reportPackages: [...records.values()], workflowRuns: [],
      workflowRevisions: state.pending ? [{ status: 'pending' }] : [] }),
      putReportPackage: async (record: ReportPackageRecord) => { records.set(record.packageId, record); return record } }, renderers }
  const service = new ConditionalReportPackageService(options as never)
  return { root, state, records, source, renderers, options, service }
}

describe('conditional report packaging', () => {
  it('exports and reuses HTML by default without invoking print, PDF or PPTX rendering', async () => {
    const h = await fixture()
    const [first, duplicate] = await Promise.all([h.service.generate('project', 103), h.service.generate('project', 103)])
    expect(first.artifacts.map(row => row.format)).toEqual(['html'])
    expect(duplicate.packageId).toBe(first.packageId)
    expect(first).toMatchObject({ deliveryMode: 'conditional', publishable: false })
    const files = await readdir(join(h.root, first.packageId))
    expect(files).not.toContain('print')
    expect(files).not.toContain('report.pdf')
    expect(files).not.toContain('report.pptx')
    const restarted = new ConditionalReportPackageService(h.options as never)
    expect((await restarted.generate('project', 103)).packageId).toBe(first.packageId)
    expect(h.renderers.html).toHaveBeenCalledTimes(1)
    expect(h.renderers.printHtml).not.toHaveBeenCalled()
    expect(h.renderers.pdf).not.toHaveBeenCalled()
    expect(h.renderers.pptx).not.toHaveBeenCalled()
  })

  it.each([
    { requested: ['html', 'pptx'], expected: ['html', 'pptx'] },
    { requested: ['pdf', 'html'], expected: ['html', 'pdf'] },
    { requested: ['pptx'], expected: ['pptx'] },
    { requested: ['pdf'], expected: ['pdf'] },
  ] as const)('renders and validates only the selected formats: $requested', async ({ requested, expected }) => {
    const h = await fixture(requested)
    const manifest = await h.service.generate('project', 103)
    expect(manifest.artifacts.map(row => row.format)).toEqual(expected)
    expect(h.renderers.html).toHaveBeenCalledTimes(requested.some(format => format === 'html') ? 1 : 0)
    expect(h.renderers.pptx).toHaveBeenCalledTimes(requested.some(format => format === 'pptx') ? 1 : 0)
    expect(h.renderers.printHtml).toHaveBeenCalledTimes(requested.some(format => format === 'pdf') ? 1 : 0)
    expect(h.renderers.pdf).toHaveBeenCalledTimes(requested.some(format => format === 'pdf') ? 1 : 0)
    expect((await h.service.generate('project', 103)).packageId).toBe(manifest.packageId)
  })

  it('keeps format-specific caches separate and reuses equivalent requested format sets', async () => {
    const h = await fixture()
    const html = await h.service.generate('project', 103)
    const all = new ConditionalReportPackageService({ ...h.options, formats: ['pdf', 'html', 'pptx', 'html'] } as never)
    const complete = await all.generate('project', 103)
    expect(complete.packageId).not.toBe(html.packageId)
    expect(complete.artifacts.map(row => row.format)).toEqual(['html', 'pptx', 'pdf'])
    expect(h.records.get(html.packageId)?.status).toBe('generated_conditional')
    const htmlGeneration = JSON.parse(await readFile(join(h.root, html.packageId, 'generation.json'), 'utf8'))
    const allGeneration = JSON.parse(await readFile(join(h.root, complete.packageId, 'generation.json'), 'utf8'))
    expect(htmlGeneration.formats).toEqual(['html'])
    expect(allGeneration.formats).toEqual(['html', 'pptx', 'pdf'])
    expect(htmlGeneration.fingerprint).not.toBe(allGeneration.fingerprint)
    const reordered = new ConditionalReportPackageService({ ...h.options, formats: ['pptx', 'pdf', 'html'] } as never)
    expect((await reordered.generate('project', 103)).packageId).toBe(complete.packageId)
    expect((await h.service.generate('project', 103)).packageId).toBe(html.packageId)
    expect(h.renderers.html).toHaveBeenCalledTimes(2)
    expect(h.renderers.pdf).toHaveBeenCalledTimes(1)
  })

  it.each(['old-version', 'absent-fingerprint', 'absent-metadata'])('replaces a healthy obsolete package without marking it failed: %s', async reason => {
    const h = await fixture()
    const original = await h.service.generate('project', 103)
    const path = join(h.root, original.packageId, 'generation.json')
    const generation = JSON.parse(await readFile(path, 'utf8'))
    if (reason === 'absent-metadata') await rm(path)
    else await writeFile(path, JSON.stringify(reason === 'old-version' ? { ...generation, version: 'old' } : { version: 'old' }))
    const replacement = await h.service.generate('project', 103)
    expect(replacement.packageId).not.toBe(original.packageId)
    expect(h.records.get(original.packageId)?.status).toBe('generated_conditional')
    expect(await readFile(join(h.root, original.packageId, 'html/index.html'), 'utf8')).toContain('条件式策划成果')
  })

  it('still marks changed artifacts failed when an obsolete package needs recomposition', async () => {
    const h = await fixture()
    const original = await h.service.generate('project', 103)
    const htmlPath = join(h.root, original.packageId, 'html/index.html')
    await writeFile(htmlPath, (await readFile(htmlPath, 'utf8')).replace('条件式策划成果', '文件被修改'))
    await writeFile(join(h.root, original.packageId, 'generation.json'), JSON.stringify({ version: 'old' }))
    expect((await h.service.generate('project', 103)).packageId).not.toBe(original.packageId)
    expect(h.records.get(original.packageId)?.status).toBe('failed')
  })

  it('marks an incomplete old three-format package failed even when the new request only needs HTML', async () => {
    const h = await fixture(['html', 'pptx', 'pdf'])
    const original = await h.service.generate('project', 103)
    await rm(join(h.root, original.packageId, 'report.pdf'))
    const htmlOnly = new ConditionalReportPackageService({ ...h.options, formats: ['html'] } as never)
    const replacement = await htmlOnly.generate('project', 103)
    expect(replacement.artifacts.map(row => row.format)).toEqual(['html'])
    expect(replacement.packageId).not.toBe(original.packageId)
    expect(h.records.get(original.packageId)?.status).toBe('failed')
    expect(h.renderers.pdf).toHaveBeenCalledTimes(1)
  })

  it('rejects empty or unsupported format selections before any rendering', async () => {
    const h = await fixture()
    expect(() => new ConditionalReportPackageService({ ...h.options, formats: [] } as never)).toThrow('REPORT_FORMATS_INVALID')
    expect(() => new ConditionalReportPackageService({ ...h.options, formats: ['docx'] } as never)).toThrow('REPORT_FORMATS_INVALID')
    expect(h.renderers.html).not.toHaveBeenCalled()
  })
  it('keeps detailed entries outside the slide excerpt in the HTML appendix', async () => {
    const h = await fixture()
    const entry = '完整条目尾部<&>不得丢失'
    Object.assign(h.source.stateObjects[0]!, { reportSections: [{ key: 'details', title: '详细资料',
      entries: [{ key: 'detail', text: entry, basis: '完整依据', fieldPath: '/data/details' }] }] })
    const manifest = await h.service.generate('project', 103)
    const html = await readFile(join(h.root, manifest.packageId, 'html/index.html'), 'utf8')
    expect(html).toContain('id="planning-details"')
    expect(html).toContain('完整条目尾部&lt;&amp;&gt;不得丢失')
    expect(html).toContain('完整依据')
  })
  it('keeps working notes in a separate source file when exporting an authored manuscript', async () => {
    const h = await fixture()
    const entry = '内部工作记录<&>与论证过程全文'
    Object.assign(h.source.stateObjects[0]!, { reportSections: [{ key: 'details', title: '详细资料',
      entries: [{ key: 'detail', text: entry, basis: '完整依据', fieldPath: '/data/details' }] }] })
    Object.assign(h.source, { manuscript: { schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: 'test',
      projectId: h.source.projectId, sourceRevision: h.source.revision, sourceFingerprint: 'test', generatedAt: h.source.generatedAt,
      title: '茶园游览前期策划', chapters: [{ id: 'products', title: '茶园游览产品', thesis: '沿茶园组织慢行体验', pages: [{
        id: 'products-trail', kind: 'argument', title: '茶园漫游步道', claim: '沿既有茶园便道组织步行游览。',
        body: ['在平缓地段布置休息节点，让游览与农业生产有序衔接。'], sourceRefs: [],
        visual: { kind: 'none', subject: '', purpose: '', caption: '' }, notes: [],
      }] }] } })
    const imagePath = fileURLToPath(new URL('./fixtures/golden-project/assets/concept-01.jpg', import.meta.url))
    const imageBytes = await readFile(imagePath)
    const dimensions = reportImageDimensions('image/jpeg', imageBytes)
    const service = new ConditionalReportPackageService({ ...h.options, materials: async () => [{
      sourceKey: 'scene-fixture', sourcePath: imagePath, displayName: '概念场景测试配图', originalFileName: 'concept-01.jpg',
      mimeType: 'image/jpeg', semanticRole: 'concept_visual', widthPx: dimensions.width, heightPx: dimensions.height,
      createdAt: h.source.generatedAt, adoptedAt: h.source.generatedAt, objectIds: [], evidenceIds: [], role: 'primary',
      pageBindingOnly: true, pageBindings: [{ findingId: 'manuscript:products-trail', role: 'primary' }],
      origin: { type: 'generated_by_tool', sourceMaterialKeys: [], parentAssetKeys: [], method: 'concept', sourceTool: null },
      sha256: createHash('sha256').update(imageBytes).digest('hex'),
    }] } as never)
    const manifest = await service.generate('project', 103)
    const directory = join(h.root, manifest.packageId)
    const html = await readFile(join(directory, 'html/index.html'), 'utf8')
    expect(html).toContain('在平缓地段布置休息节点')
    expect(html).not.toContain('id="planning-details"')
    expect(html).not.toContain('内部工作记录')
    const source = await readFile(join(directory, 'planning-sources.html'), 'utf8')
    expect(source).toContain('内部工作记录&lt;&amp;&gt;与论证过程全文')
    expect(source).toContain('完整依据')
  })
  it('drains a cancelled generation before an immediate resume creates a fresh package', async () => {
    const h = await fixture(['html', 'pptx', 'pdf'])
    let release!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const original = h.renderers.pdf.getMockImplementation()!
    h.renderers.pdf.mockImplementationOnce(async (html, path) => { await hold; await original(html, path) })
    const old = new AbortController()
    const first = h.service.generate('project', 103, old.signal)
    const failed = expect(first).rejects.toThrow('paused')
    await vi.waitFor(() => expect(h.renderers.pdf).toHaveBeenCalledTimes(1))
    old.abort(new Error('paused'))
    const resumed = h.service.generate('project', 103, new AbortController().signal)
    void resumed.catch(() => undefined)
    release()
    await failed
    await expect(resumed).resolves.toMatchObject({ deliveryMode: 'conditional' })
    expect(h.renderers.pdf).toHaveBeenCalledTimes(2)
    expect([...h.records.values()].map(row => row.status)).toEqual(['failed', 'generated_conditional'])
  })
  it('generates three identity-checked formats and reuses a valid package concurrently and after restart', async () => {
    const h = await fixture(['html', 'pptx', 'pdf'])
    const [first, duplicate] = await Promise.all([h.service.generate('project', 103), h.service.generate('project', 103)])
    expect(first.packageId).toBe(duplicate.packageId)
    expect(first.artifacts.map(row => row.format)).toEqual(['html', 'pptx', 'pdf'])
    expect(first.deliveryMode).toBe('conditional')
    expect(first.publishable).toBe(false)
    expect(h.records.get(first.packageId)).toMatchObject({ status: 'generated_conditional', sourceRevision: 103, generatedAt: expect.any(String) })
    expect(h.records.get(first.packageId)?.publishedAt).toBeUndefined()
    const restarted = new ConditionalReportPackageService(h.options as never)
    expect((await restarted.generate('project', 103)).packageId).toBe(first.packageId)
    expect(h.renderers.pptx).toHaveBeenCalledTimes(1)
  })

  it('rebuilds a missing artifact instead of returning a false successful package', async () => {
    const h = await fixture(['html', 'pptx', 'pdf'])
    const first = await h.service.generate('project', 103)
    await rm(join(h.root, first.packageId, 'report.pdf'))
    const second = await h.service.generate('project', 103)
    expect(second.packageId).not.toBe(first.packageId)
    expect(h.records.get(first.packageId)?.status).toBe('failed')
    expect(h.renderers.pptx).toHaveBeenCalledTimes(2)
  })

  it('does not render pending, incomplete or stale planning revisions', async () => {
    const h = await fixture()
    h.state.pending = true
    await expect(h.service.generate('project', 103)).rejects.toThrow('WORKFLOW_REVISION_INCOMPLETE')
    h.state.pending = false; h.state.complete = false
    await expect(h.service.generate('project', 103)).rejects.toThrow('REPORT_WORKFLOWS_INCOMPLETE')
    h.state.complete = true; h.state.revision = 104
    await expect(h.service.generate('project', 103)).rejects.toThrow('REPORT_REVISION_CHANGED')
    expect(h.renderers.html).not.toHaveBeenCalled()
  })

  it('cleans completed render files and records failure when source revision changes during rendering', async () => {
    const h = await fixture(['html', 'pptx', 'pdf'])
    const original = h.renderers.pdf.getMockImplementation()!
    h.renderers.pdf.mockImplementation(async (html, path) => { await original(html, path); h.state.revision = 104 })
    await expect(h.service.generate('project', 103)).rejects.toThrow('REPORT_REVISION_CHANGED')
    expect(await readdir(h.root)).toEqual([])
    expect([...h.records.values()].at(-1)?.status).toBe('failed')
  })

  it('waits for both renderers before cleaning a failed or cancelled run', async () => {
    const h = await fixture(['html', 'pptx', 'pdf'])
    let pptxFinished = false
    const original = h.renderers.pptx.getMockImplementation()!
    h.renderers.pptx.mockImplementation(async (context, path) => { const result = await original(context, path); pptxFinished = true; return result })
    h.renderers.pdf.mockRejectedValueOnce(new Error('PDF_FAILED'))
    await expect(h.service.generate('project', 103)).rejects.toThrow('PDF_FAILED')
    expect(pptxFinished).toBe(true)
    expect(await readdir(h.root)).toEqual([])
    const controller = new AbortController()
    h.renderers.pdf.mockImplementationOnce(async () => { controller.abort(new Error('paused')) })
    await expect(h.service.generate('project', 103, controller.signal)).rejects.toThrow()
    expect(await readdir(h.root)).toEqual([])
    expect([...h.records.values()].every(row => row.status === 'failed')).toBe(true)
  })
})
