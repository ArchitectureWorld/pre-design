import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import sharp from 'sharp'
import { createStandardFrozenProject } from './presentation-standard-fixture.ts'
import { createConditionalReportBundle, planConditionalPages, type ConditionalReportMaterial } from '../src/report/conditional-report.ts'
import { paginatePlanningPage } from '../src/report/planning-page-layout.ts'
import { renderPptx } from '../src/report/render-pptx.ts'
import { renderPlanningPage } from '../src/report/render-planning-page.ts'
import { makeSourceIndex } from '../src/report/manuscript/source.ts'
import { reportImageDimensions } from '../src/report/regular/image-dimensions.ts'
import type { PlanningManuscriptPage } from '../src/report/manuscript/types.ts'

const input = createStandardFrozenProject()
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const base: PlanningManuscriptPage = { id: 'products-walk', kind: 'argument', title: '以步行串联项目资源',
  claim: '利用既有道路组织游览，集中布置停留与服务节点。', body: ['保留既有道路并组织公共服务。'],
  sourceRefs: [makeSourceIndex(input)[0]!.id], visual: { kind: 'none', subject: '游览组织', purpose: '明确实施方式', caption: '建议游览组织' }, notes: [] }

it('reserves a wider area for authored diagrams and paginates its narrower copy without dropping text', () => {
  const body = ['茶园漫游与品饮活动共同形成周末体验。'.repeat(20)]
  const page: PlanningManuscriptPage = { ...base, body, visual: { ...base.visual, kind: 'diagram',
    diagram: { nodes: [{ id: 'tea', label: '茶园漫游', column: 0, row: 0 }], edges: [] } } }
  const parts = paginatePlanningPage(page, true)
  expect(parts.flatMap(p => p.body).join('')).toBe(body[0])
  expect(parts.length).toBeGreaterThan(paginatePlanningPage({ ...page, visual: { ...base.visual, kind: 'concept' } }, true).length)
  expect(renderPlanningPage(page, '游览组织', '<figure><img src="diagram.svg"></figure>')).toContain('with-media with-diagram')
})

function slideXml(buffer: Buffer): string[] {
  const slides: string[] = [], signature = Buffer.from([0x50, 0x4b, 0x01, 0x02])
  let offset = buffer.indexOf(signature)
  while (offset >= 0 && offset + 46 <= buffer.length) {
    const method = buffer.readUInt16LE(offset + 10), size = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'), local = buffer.readUInt32LE(offset + 42)
    if (/^ppt\/slides\/slide\d+\.xml$/u.test(name)) {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28), content = buffer.subarray(start, start + size)
      slides.push((method === 8 ? inflateRawSync(content) : content).toString('utf8'))
    }
    offset = buffer.indexOf(signature, offset + 46 + nameLength + extraLength + commentLength)
  }
  return slides
}
function text(xml: string) { return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gu)].map(match => match[1]).join('') }
function geometry(xml: string) {
  const transform = xml.match(/<(?:a|p):xfrm[^>]*>([\s\S]*?)<\/(?:a|p):xfrm>/u)![1]!
  return { y: Number(transform.match(/<a:off[^>]* y="([\d.-]+)"/u)![1]) / 914400,
    h: Number(transform.match(/<a:ext[^>]* cy="([\d.-]+)"/u)![1]) / 914400 }
}
async function exportPage(page: PlanningManuscriptPage, withImage = true) {
  const root = await mkdtemp(join(tmpdir(), 'planning-page-layout-')); roots.push(root)
  const snapshot = { ...input, manuscript: { schemaVersion: 'pre-design.planning-manuscript.v1' as const, policyVersion: 'test',
    projectId: input.projectId, sourceRevision: input.revision, sourceFingerprint: 'test', generatedAt: input.generatedAt, title: '项目汇报',
    chapters: [{ id: 'products' as const, title: '产品策划', thesis: '组织游览', pages: [page] }] } }
  const needs = planConditionalPages(createConditionalReportBundle(snapshot, []), 'pptx').pages.flatMap(physical =>
    (physical.regularLayout?.imageSlots ?? []).map(slot => ({ slot, pageId: physical.pagination?.sourcePageId ?? 'cover' })))
  const materials: ConditionalReportMaterial[] = []
  if (withImage) for (const [index, { slot, pageId }] of needs.entries()) {
    const imagePath = join(root, `concept-${index}.png`)
    // Supplying a slot-compatible raster is part of the fixture. Arbitrary
    // gallery counts and ratios must no longer control physical pagination.
    const bytes = await sharp({ create: { width: Math.round(slot.targetAspectRatio * 900), height: 900, channels: 3,
      background: { r: 60 + index * 13 % 180, g: 90 + index * 17 % 160, b: 75 + index * 23 % 160 } } }).png().toBuffer()
    const dimensions = reportImageDimensions('image/png', bytes)
    await writeFile(imagePath, bytes)
    materials.push({
      sourceKey: `planning-test-concept-${index}`, sourcePath: imagePath, originalFileName: `concept-${index}.png`, displayName: '场景测试图', mimeType: 'image/png',
      imageQuality: { requirement: { id: slot.usageId, version: 'fixture', pageId, conclusion: page.claim,
        subjects: [page.visual.subject], activities: [], environment: '', scale: 'scene' as const, allowedKinds: ['render' as const], allowedSources: ['generated' as const], locale: 'domestic' as const } },
      semanticRole: 'concept_visual', widthPx: dimensions.width, heightPx: dimensions.height, createdAt: input.generatedAt, adoptedAt: input.generatedAt,
      objectIds: [], evidenceIds: [], role: 'primary', pageBindingOnly: true,
      pageBindings: [{ findingId: pageId === 'cover' ? 'report:cover' : `manuscript:${pageId}`, role: 'primary' }],
      origin: { type: 'generated_by_tool', sourceMaterialKeys: [], parentAssetKeys: [], method: 'concept', sourceTool: null },
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  const bundle = createConditionalReportBundle(snapshot, materials)
  const plan = planConditionalPages(bundle, 'pptx'), path = join(root, 'report.pptx')
  await renderPptx({ report: bundle.report, identity: bundle.identity, plan }, path)
  return { plan, slides: slideXml(await readFile(path)) }
}

it('rejects a wholly unillustrated manuscript export at the text-page ratio gate', async () => {
  await expect(exportPage(base, false)).rejects.toThrow('REPORT_TEXT_PAGE_RATIO')
})

it('exports an ordinary 33-character planning title in readable lines without colliding with its claim', async () => {
  const page = { ...base, title: '通过生产体验与自然研学组织休闲产品，形成可分期实施的文旅发展路径。' }
  const { slides } = await exportPage(page)
  const slide = slides.find(xml => text(xml).includes(page.title))!
  const shapes = [...slide.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/gu)].map(match => match[0])
  const title = shapes.find(xml => text(xml) === page.title)!, claim = shapes.find(xml => text(xml) === page.claim)!
  expect((title.match(/<a:p>/gu) ?? []).length).toBeGreaterThan(1)
  expect(geometry(title).y + geometry(title).h).toBeLessThanOrEqual(geometry(claim).y)
})

it('fits ten short authored paragraphs without inserting nine empty PowerPoint paragraphs', async () => {
  const page = { ...base, body: Array.from({ length: 10 }, (_, i) => `节点${i + 1}利用既有场地组织停留和游览服务。`) }
  const { slides } = await exportPage(page)
  const shapes = slides.flatMap(xml => [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/gu)].map(match => match[0]))
  // Shared physical layout gives each paragraph its own measured frame.
  for (const paragraph of page.body) {
    const matching = shapes.filter(xml => text(xml) === paragraph)
    expect(matching, `Missing intact paragraph: ${paragraph}\nRendered frames: ${JSON.stringify(shapes.map(text))}`).toHaveLength(1)
    const shape = matching[0]!
    expect((shape.match(/<a:p>/gu) ?? []).length).toBe(1)
    expect(shape).toContain('lang="zh-CN"')
    expect(geometry(shape).h * 72).toBeGreaterThanOrEqual(23)
    expect(geometry(shape).y + geometry(shape).h).toBeLessThanOrEqual(7)
  }
})

it('splits a tall comparison row across physical pages, repeats its header and preserves every cell character', async () => {
  const table = { columns: ['实施条件', '产品体验', '运营组织'], rows: [[
    '条件。'.repeat(200) + '条件末尾', '体验。'.repeat(200) + '体验末尾', '运营。'.repeat(200) + '运营末尾',
  ]] }
  const page = { ...base, table }
  const { slides, plan } = await exportPage(page)
  const plannedTables = plan.pages.flatMap(part => part.regularLayout?.table ? [part.regularLayout.table] : [])
  const fragments = plan.pages.flatMap(part => part.planningContent?.table?.rows ?? [])
  expect(fragments.length).toBeGreaterThan(1)
  table.columns.forEach((_, column) => expect(fragments.map(row => row[column]).join('')).toBe(table.rows[0]![column]))
  const tables = slides.flatMap(xml => [...xml.matchAll(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/gu)].map(match => match[0]))
  expect(tables.length).toBe(fragments.length)
  for (const [index, xml] of tables.entries()) {
    table.columns.forEach(column => expect(text(xml)).toContain(column))
    const box = geometry(xml)
    expect(box.y).toBeCloseTo(plannedTables[index]!.box.y, 4)
    expect(box.y + box.h).toBeLessThanOrEqual(7)
    const rowHeight = [...xml.matchAll(/<a:tr h="(\d+)"/gu)].reduce((sum, match) => sum + Number(match[1]) / 914400, 0)
    expect(rowHeight).toBeCloseTo(box.h, 4)
  }
})

it('keeps explicit paragraph breaks, full long product fields and a product name that differs from the title', () => {
  const page = { ...base, kind: 'product' as const, body: ['沿既有道路组织游览。\n结合场地节点安排停留。'.repeat(80)],
    product: { name: '林间自然体验课堂', audience: '亲子家庭', experience: '课程体验与林间观察。'.repeat(150),
      location: '沿现有林间道路布置停留节点', scale: '按活动时长和人员组织确定预约分组', operations: '统一预约并安排日常维护' } }
  const parts = paginatePlanningPage(page, true)
  const html = parts.map(part => renderPlanningPage(part, '产品策划')).join('')
  expect(html).toContain(page.product.name)
  const body = parts.flatMap(part => part.body).join('')
  expect(body).toContain(page.body[0])
  expect(body).toContain(page.product.experience)
  expect(parts.length).toBeGreaterThan(2)
})

it('places a short table immediately after the copy rather than at the slide footer', async () => {
  const page = { ...base, table: { columns: ['活动', '安排'], rows: [['茶园游览', '按预约开放']] } }
  const { slides } = await exportPage(page)
  const table = slides.flatMap(xml => [...xml.matchAll(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/gu)].map(match => match[0]))[0]!
  expect(geometry(table).y).toBeLessThan(3.5)
})

it('removes archived material explanations from visible slides while preserving the original caption in source notes', async () => {
  const caption = '茶山缓坡架空步道与茶事节点概念示意图（概念意向，非现场实景，不表示实际点位）'
  const page = { ...base, visual: { ...base.visual, kind: 'concept' as const, caption } }
  const { slides, plan } = await exportPage(page, true)
  expect(slides.map(text).join('')).not.toMatch(/意向|非现场实景|概念示意|不表示实际/u)
  const projected = plan.pages.find(item => item.planningContent?.id === page.id)!.planningContent!
  expect(projected.visual.caption).toBe(base.visual.subject)
  expect(projected.notes).toContain(`原图注：${caption}`)
  expect(page.visual.caption).toBe(caption)
})
