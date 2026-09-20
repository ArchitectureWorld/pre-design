import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { BUNDLED_CASE_STUDY_IMAGES } from '../src/report/case-studies/catalog-images.ts'
import { VERIFIED_CASE_STUDIES } from '../src/report/case-studies/catalog.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderHtml } from '../src/report/render-html.ts'
import { renderPrintHtml } from '../src/report/render-print-html.ts'
import { renderPptx } from '../src/report/render-pptx.ts'
import { inspectPptxArtifact } from '../src/report/inspect-pptx.ts'
import { paginatePlanningPage } from '../src/report/planning-page-layout.ts'
import { compileClientReportOutline } from '../src/presentation/projector/client-outline.ts'
import { createConditionalReportBundle, planConditionalPages, conditionalReportDetails, type ConditionalReportMaterial } from '../src/report/conditional-report.ts'
import { reportImageDimensions } from '../src/report/regular/image-dimensions.ts'
import { createStandardFrozenProject } from './presentation-standard-fixture.ts'
import { makeSourceIndex } from '../src/report/manuscript/source.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'

const input = createStandardFrozenProject()
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const page = (id: string, title: string, experience: string) => ({ id, kind: 'product' as const, title,
  claim: `${title}把日常学习转为可以停留、交流的共享体验。`, body: [experience], sourceRefs: [makeSourceIndex(input)[0]!.id],
  product: { name: title, audience: '师生及访客', experience, location: '现有公共空间节点', scale: '按现状场地容量确定', operations: '校方统筹，活动组织者参与' },
  visual: { kind: 'concept' as const, subject: title, purpose: experience, caption: '拟议使用场景' }, notes: ['保留既有建筑功能'] })
export const authoredInput = { ...input, manuscript: { schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: 'test',
  projectId: input.projectId, sourceRevision: input.revision, sourceFingerprint: 'test', generatedAt: input.generatedAt,
  title: '共享校园｜前期策划汇报', chapters: [{ id: 'products', title: '全天候共享学习产品', thesis: '连接学习与交流', pages: [
    page('products-reading', '树下共读客厅', '围绕树荫与现有座椅组织自由阅读和小组交流，面向课间与傍晚开放。'),
    { ...page('products-exhibition', '开放作品展廊', '利用既有连廊展示课程成果，由学生社团按学期策展，结合导览形成对外交流窗口。'),
      table: { columns: ['产品', '主要活动', '运营方式'], rows: [['共读客厅', '阅读交流', '校方统筹'], ['作品展廊', '课程展览', '社团策展']] } },
  ] }] } } satisfies FrozenProjectInput

it('uses authored pages as the content authority and keeps different products as independent arguments', () => {
  const findings = compileClientReportOutline(authoredInput)
  expect(findings.map(row => row.title)).toEqual(['树下共读客厅', '开放作品展廊'])
  expect(findings[0]!.keyMessage).toBe(authoredInput.manuscript.chapters[0]!.pages[0]!.claim)
  expect(findings[1]!.supportingBlocks.some(block => block.type === 'table' && block.rows[1]?.[2] === '社团策展')).toBe(true)
  expect(findings[0]!.visualBrief).not.toBe(findings[1]!.visualBrief)
})

it('retains the actual product and comparison content in the export instead of only source summaries', () => {
  const bundle = createConditionalReportBundle(authoredInput)
  expect(bundle.report.products.map(row => row.name)).toEqual(['树下共读客厅', '开放作品展廊'])
  expect(JSON.stringify(bundle.report.chapters)).toContain('社团策展')
  expect(JSON.stringify(bundle.report.chapters)).toContain('围绕树荫与现有座椅')
  const plan = planConditionalPages(bundle, 'html')
  const physical = plan.pages.filter(row => row.headline === '开放作品展廊')
  expect(physical.map(row => row.pagination?.partIndex)).toEqual(physical.map((_, index) => index))
  expect(physical.flatMap(row => row.planningContent?.table?.rows ?? [])).toEqual([['共读客厅', '阅读交流', '校方统筹'], ['作品展廊', '课程展览', '社团策展']])
  expect(plan.pages).toEqual(planConditionalPages(bundle, 'pdf').pages)
  expect(plan.pages).toEqual(planConditionalPages(bundle, 'pptx').pages)
})

it('leads the cover with the authored proposition and uses its caption without losing image provenance', () => {
  const bundle = createConditionalReportBundle(authoredInput, [{
    sourceKey: 'generated-concept', sourcePath: '/not-read-in-projection/concept.png', originalFileName: 'concept.png',
    displayName: '后台任务素材 page-fill-123', mimeType: 'image/png', semanticRole: 'concept_visual',
    widthPx: 1200, heightPx: 800, createdAt: input.generatedAt, adoptedAt: input.generatedAt,
    objectIds: [], evidenceIds: [], role: 'primary', pageBindingOnly: true,
    pageBindings: [{ findingId: 'manuscript:products-reading', role: 'primary' }],
    origin: { type: 'generated_by_tool', sourceMaterialKeys: [], parentAssetKeys: [], method: 'concept', sourceTool: null },
    sha256: 'a'.repeat(64),
  }])
  const original = authoredInput.manuscript.chapters[0]!.pages[0]!
  expect(planConditionalPages(bundle, 'pdf').pages[0]!.primaryFocus).toEqual({ type: 'claim', statement: original.claim })
  expect(bundle.report.proposition.projectDefinition).toBe(original.claim)
  expect(bundle.report.assets[0]).toMatchObject({ caption: original.visual.caption, sourceKind: 'ai-concept', disclosure: '概念示意' })
  expect(JSON.stringify(bundle.report.chapters)).not.toContain('法定场地边界尚未确认')
  expect(JSON.stringify(conditionalReportDetails(bundle.report))).toContain('法定场地边界尚未确认')
})

it('renders authored paragraphs and editable comparison cells in HTML, print and PPTX', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manuscript-projection-')); roots.push(root)
  const materials: ConditionalReportMaterial[] = []
  for (const [index, page] of authoredInput.manuscript.chapters[0].pages.entries()) {
    const bytes = await readFile(new URL(`./fixtures/golden-project/assets/concept-0${index + 1}.jpg`, import.meta.url))
    const image = reportImageDimensions('image/jpeg', bytes), sourcePath = join(root, `fixture-${index}.jpg`)
    await writeFile(sourcePath, bytes)
    materials.push({
    sourceKey: `fixture:${page.id}`, sourcePath, originalFileName: 'fixture.jpg', displayName: 'Renderer image fixture',
    mimeType: 'image/jpeg', semanticRole: 'concept_visual', widthPx: image.width, heightPx: image.height,
    createdAt: input.generatedAt, adoptedAt: input.generatedAt, objectIds: [], evidenceIds: [], role: 'primary', pageBindingOnly: true,
    pageBindings: [{ findingId: `manuscript:${page.id}`, role: 'primary' }],
    origin: { type: 'generated_by_tool', sourceMaterialKeys: [], parentAssetKeys: [], method: 'renderer test fixture', sourceTool: null },
    sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  const bundle = createConditionalReportBundle(authoredInput, materials)
  const context = (medium: 'html' | 'pdf' | 'pptx') => ({ report: bundle.report, identity: bundle.identity, plan: planConditionalPages(bundle, medium) })
  const html = await renderHtml(context('html'), root)
  const print = await renderPrintHtml(context('pdf'), root)
  const pptx = await renderPptx(context('pptx'), join(root, 'report.pptx'))
  for (const path of [html.path, print]) {
    const text = await readFile(path, 'utf8')
    expect(text).toContain('围绕树荫与现有座椅')
    expect(text).toContain('<td>社团策展</td>')
  }
  const inspection = await inspectPptxArtifact(pptx.path)
  expect(inspection.visibleText).toContain('围绕树荫与现有座椅')
  expect(inspection.visibleText).toContain('社团策展')
})

it('paginates long print copy without cropping the authored paragraph or dropping comparison rows', () => {
  const original = authoredInput.manuscript.chapters[0]!.pages[0]!
  const long = { ...original, product: undefined, body: ['完整策划内容与适用条件。'.repeat(120)],
    table: { columns: ['设施', '体验', '运营'], rows: Array.from({ length: 15 }, (_, index) => [`节点${index}`, '由步行、停留与活动组成完整体验。', '预约分组并安排日常维护。']) } }
  const parts = paginatePlanningPage(long, false)
  expect(parts.length).toBeGreaterThan(2)
  expect(parts.flatMap(part => part.body).join('')).toBe(long.body[0])
  expect(parts.flatMap(part => part.table?.rows ?? [])).toEqual(long.table.rows)
})
