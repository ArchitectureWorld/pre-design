import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createConditionalReportBundle, conditionalReportDetails, planConditionalPages } from '../src/report/conditional-report.ts'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { writeAuthoredReportDocuments } from '../src/report/regular/documents.ts'
import { renderPptx } from '../src/report/render-pptx.ts'
import { inspectPptx } from './support/pptx-inspector.ts'
import { reportModuleResearchFixture } from './support/report-module-research.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'
import { reportResearchUsage } from '../src/report/research-note.ts'
import { completeReportFixture } from './support/complete-report.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function directory() { const root = await mkdtemp(join(tmpdir(), 'report-research-note-')); roots.push(root); return root }
const input = () => ({ ...REPORT_INPUT, moduleResearch: reportModuleResearchFixture() })

describe('readable frozen research compilation note', () => {
  it('retains unused modules in the index and binds cited modules to the actual page identities', () => {
    const source = completeReportFixture(true)
    expect(reportResearchUsage(source)[0]).toMatchObject({ itemId: '5.06', status: 'completed',
      pageIds: ['opportunity-plan', 'site-plan', 'positioning-plan', 'products-plan', 'spatial-plan', 'launch-plan', 'operation-plan'] })
    for (const chapter of source.manuscript!.chapters) for (const page of chapter.pages) Object.assign(page, { sourceRefs: ['source:module:5.060:other'] })
    expect(reportResearchUsage(source)).toMatchObject([{ itemId: '5.06', pageIds: [], status: 'completed' }])
    expect(source.moduleResearch!.results).toHaveLength(1)
  })
  it('projects the complete authored scope/date/limitations without exposing the task transcript or internal binding', () => {
    const source = input(), bundle = createConditionalReportBundle(source)
    const note = bundle.report.compilationNote?.join('\n')
    expect(note).toContain('少潭河生态游憩与研学策划；实施范围待边界复核。')
    expect(note).toContain('2026-09-26')
    expect(note).toContain('历史资料不能证明当前运营状态。')
    expect(note).toContain('委托范围仍须业主确认。')
    expect(note).toContain(`第 ${source.revision} 版`)
    expect(note).toContain('条件式策划成果')
    expect(note).not.toMatch(/PRIVATE|private-|run-a|[a-f0-9]{64}/u)
    expect(conditionalReportDetails(bundle.report).find(row => row.title === '编制与研究范围说明')?.entries).toEqual(bundle.report.compilationNote)
    expect(createConditionalReportBundle(REPORT_INPUT).report.compilationNote).toBeUndefined()
  })
  it('keeps the same validated research note on the formal projection without the conditional label', () => {
    const report = createClientReportBundle(input(), CLIENT_PROFILE).report
    expect(report.compilationNote?.join('\n')).toContain('少潭河生态游憩')
    expect(report.compilationNote?.join('\n')).not.toContain('条件式策划成果')
  })
  it('rejects research that lacks the validated task output instead of synthesizing a scope from the raw task', () => {
    const source = input()
    Object.assign(source.moduleResearch, { results: [] })
    expect(() => createConditionalReportBundle(source)).toThrow('REPORT_RESEARCH_NOTE_UNAVAILABLE')
  })
  it('exports compilation questions in report notes and sources while keeping the manuscript body for the proposal', async () => {
    const bundle = createConditionalReportBundle({ ...input(), projectName: '少潭河', stateObjects: [
      { objectId: 'PS01', chapterId: '01', title: '项目任务', summary: '文旅休闲研究', facts: [] },
    ] }), root = await directory()
    await writeAuthoredReportDocuments(bundle.report, root)
    const html = await readFile(join(root, 'planning-sources.html'), 'utf8')
    const markdown = await readFile(join(root, 'report-manuscript.md'), 'utf8')
    const notes = await readFile(join(root, 'report-notes.md'), 'utf8')
    expect(html).toContain('<h2>编制与研究范围说明</h2>')
    expect(html).toContain('研究资料索引')
    expect(html).toContain('研究 1.01')
    expect(html).toContain('资料与限制依据，正文未单独引用')
    expect(markdown).not.toContain('研究资料索引')
    for (const note of bundle.report.compilationNote!) { expect(html).toContain(note); expect(notes).toContain(note); expect(markdown).not.toContain(note) }
    await renderPptx({ report: bundle.report, identity: bundle.identity, plan: planConditionalPages(bundle, 'pptx') }, join(root, 'report.pptx'))
    const pptx = await inspectPptx(join(root, 'report.pptx'))
    expect(pptx.notesTexts.join('\n')).toContain('少潭河生态游憩')
    expect(pptx.textObjects.map(row => row.text).join('\n')).not.toContain('少潭河生态游憩')
  })
})
