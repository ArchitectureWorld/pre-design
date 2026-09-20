import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Ajv from 'ajv'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareClientVisuals } from '../src/presentation/client-visuals.ts'
import { renderManuscriptDiagram } from '../src/presentation/manuscript-diagrams.ts'
import { PLANNING_CHAPTER_OUTPUT_SCHEMA } from '../src/report/manuscript/prompts.ts'
import { makeSourceIndex, manuscriptSourceFingerprint } from '../src/report/manuscript/source.ts'
import { PLANNING_MANUSCRIPT_POLICY_VERSION } from '../src/report/manuscript/types.ts'
import { validatePlanningChapter } from '../src/report/manuscript/validation.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom') as {
  JSDOM: new (source: string, options?: { readonly contentType?: string }) => { window: { document: Document } }
}

const input: FrozenProjectInput = {
  projectId: 'diagram-project', projectName: '茶园体验项目', revision: 4, generatedAt: '2026-09-18T00:00:00Z',
  recommendation: '以茶园游线组织日间体验', decisionItems: [], gates: [], visualAssets: [],
  stateObjects: [{ objectId: 'IM01', chapterId: '08', title: '启动游线', summary: '从外围服务进入茶園体验', facts: [],
    reportSections: [{ key: 'scope', title: '游线', entries: [{ key: 'route', fieldPath: 'data.scope',
      text: '外围到达后进入茶園，品茶后返回驿站采购。', basis: '拟议方案' }] }] }],
}
const sources = makeSourceIndex(input)
const roots: string[] = []
async function workspace() { const root = await mkdtemp(join(tmpdir(), 'manuscript-diagram-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

function graph() {
  return { nodes: [
    { id: 'arrival', label: '外围到达', column: 0, row: 0, tone: 'accent' },
    { id: 'tea', label: '茶园体验', column: 1, row: 0, tone: 'neutral' },
    { id: 'return', label: '返程采购', column: 1, row: 1, tone: 'muted' },
  ], edges: [{ from: 'arrival', to: 'tea', label: '预约接驳' }, { from: 'tea', to: 'return' }] }
}
function page(id = 'launch-journey'): any {
  return { id, kind: 'delivery', title: '首期日间游程', claim: '到达、茶园体验与返程服务组成一条完整游线。',
    body: ['这一段正文用于解释产品如何提供完整体验，不应被转换成关系图节点。'], sourceRefs: [sources[0]!.id], notes: [],
    visual: { kind: 'diagram', subject: '到达与体验的关系', purpose: '呈现游客活动先后关系', caption: '日间游程', diagram: graph() } }
}
function chapter(pages = [page()]): any { return { id: 'launch', title: '启动安排', thesis: '以完整日间游线组织首期开放。', pages } }
function frozen(pages = [page()]): FrozenProjectInput {
  return { ...input, manuscript: { schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: PLANNING_MANUSCRIPT_POLICY_VERSION,
    projectId: input.projectId, sourceRevision: input.revision, sourceFingerprint: manuscriptSourceFingerprint(input), generatedAt: input.generatedAt,
    title: '茶園项目策划', chapters: [validatePlanningChapter(chapter(pages), 'launch', sources)] } }
}
async function visuals(pages = [page()], assets: Parameters<typeof prepareClientVisuals>[0]['assets'] = [], diagrams?: boolean) {
  const root = await workspace()
  return prepareClientVisuals({ frozenProject: frozen(pages), workspaceRoot: root, sources: [], assets, ...(diagrams === undefined ? {} : { diagrams }) })
}

describe('authored diagram contract', () => {
  it('preserves explicit nodes, edges and layout through manuscript validation', () => {
    const result = validatePlanningChapter(chapter(), 'launch', sources)
    expect(result.pages[0]!.visual).toMatchObject({ diagram: graph() })
  })

  it.each([
    ['empty nodes', (g: any) => { g.nodes = [] }],
    ['more than twelve nodes', (g: any) => { g.nodes = Array.from({ length: 13 }, (_, i) => ({ id: `n${i}`, label: '节点', column: i % 4, row: Math.floor(i / 4) })) }],
    ['duplicate node identifiers', (g: any) => { g.nodes[1].id = 'arrival' }],
    ['blank node identifier', (g: any) => { g.nodes[0].id = ' ' }],
    ['blank node label', (g: any) => { g.nodes[0].label = ' ' }],
    ['node label over thirty two characters', (g: any) => { g.nodes[0].label = '茶'.repeat(33) }],
    ['XML control in a label', (g: any) => { g.nodes[0].label = '茶\u0000园' }],
    ['overlapping cells', (g: any) => { g.nodes[1].column = 0 }],
    ['column outside the grid', (g: any) => { g.nodes[0].column = 4 }],
    ['negative row', (g: any) => { g.nodes[0].row = -1 }],
    ['row outside the grid', (g: any) => { g.nodes[0].row = 3 }],
    ['fractional column', (g: any) => { g.nodes[0].column = 0.5 }],
    ['string row', (g: any) => { g.nodes[0].row = '0' }],
    ['unknown tone', (g: any) => { g.nodes[0].tone = 'bright' }],
    ['missing edge endpoint', (g: any) => { g.edges[0].to = 'missing' }],
    ['blank edge endpoint', (g: any) => { g.edges[0].from = '' }],
    ['blank optional edge label', (g: any) => { g.edges[0].label = ' ' }],
    ['edge label over twenty characters', (g: any) => { g.edges[0].label = '接'.repeat(21) }],
    ['more than twenty edges', (g: any) => { g.edges = Array.from({ length: 21 }, () => ({ from: 'arrival', to: 'tea' })) }],
  ])('rejects %s before it can become an asset', (_name, mutate) => {
    const value = chapter(); mutate(value.pages[0].visual.diagram)
    expect(() => validatePlanningChapter(value, 'launch', sources)).toThrow(/MANUSCRIPT_DIAGRAM/)
  })

  it.each(['concept', 'source', 'none'])('does not accept graph data on a %s visual', kind => {
    const value = chapter(); value.pages[0].visual.kind = kind
    expect(() => validatePlanningChapter(value, 'launch', sources)).toThrow(/MANUSCRIPT_DIAGRAM/)
  })

  it('keeps older graph-free pages and blank optional product normalization compatible', () => {
    const value = chapter(); delete value.pages[0].visual.diagram
    value.pages[0].product = { name: '', audience: '', experience: '', location: '', scale: '', operations: '' }
    const result = validatePlanningChapter(value, 'launch', sources)
    expect(result.pages[0]!.product).toBeUndefined()
    expect(result.pages[0]!.visual).not.toHaveProperty('diagram')
  })

  it('counts label limits by characters rather than UTF-16 units', () => {
    const value = chapter(); value.pages[0].visual.diagram.nodes[0].label = '🌳'.repeat(32)
    expect(validatePlanningChapter(value, 'launch', sources).pages[0]!.visual).toHaveProperty('diagram')
  })

  it('allows the writer schema to produce graph data and applies coordinate bounds', () => {
    const validate = new Ajv({ strict: false }).compile(PLANNING_CHAPTER_OUTPUT_SCHEMA)
    expect(validate(chapter())).toBe(true)
    const invalid = chapter(); invalid.pages[0].visual.diagram.nodes[0].column = 4
    expect(validate(invalid)).toBe(false)
    const legacy = chapter(); delete legacy.pages[0].visual.diagram
    expect(validate(legacy)).toBe(true)
  })

  it('uses only the structured-output schema subset accepted by DSH', () => {
    expect(() => assertObjectJsonSchema(PLANNING_CHAPTER_OUTPUT_SCHEMA)).not.toThrow()
  })
})

describe('authored diagrams as page-bound SVG assets', () => {
  const bounds = (element: Element) => ({ x: Number(element.getAttribute('x')), y: Number(element.getAttribute('y')),
    width: Number(element.getAttribute('width')), height: Number(element.getAttribute('height')) })
  const overlaps = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) => a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y

  it('centers the occupied rows and columns, without preserving empty grid cells', () => {
    const value = page()
    value.visual.diagram = { nodes: [
      { id: 'start', label: '外围到达', column: 0, row: 2 },
      { id: 'end', label: '茶园体验', column: 3, row: 2 },
    ], edges: [{ from: 'start', to: 'end' }] }
    const doc = new JSDOM(renderManuscriptDiagram(value), { contentType: 'image/svg+xml' }).window.document
    const boxes = Array.from(doc.querySelectorAll('[data-node-id] > rect')).map(bounds)
    expect(boxes).toHaveLength(2)
    expect(boxes[0]!.width).toBeGreaterThan(300)
    expect(boxes[0]!.y + boxes[0]!.height / 2).toBe(360)
    expect(boxes[1]!.x - boxes[0]!.x - boxes[0]!.width).toBeLessThan(200)
    expect(boxes[0]!.x).toBe(1280 - boxes[1]!.x - boxes[1]!.width)
  })

  it('crops a single-row graph tightly so the report does not scale empty canvas into the image area', async () => {
    const value = page()
    value.visual.diagram = { nodes: Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, label: '茶园体验', column: i, row: 1 })),
      edges: [{ from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }] }
    const result = await visuals([value]), asset = result.assets[0]!
    const doc = new JSDOM(await readFile(asset.sourcePath, 'utf8'), { contentType: 'image/svg+xml' }).window.document
    const [x, y, width, height] = doc.documentElement.getAttribute('viewBox')!.split(' ').map(Number)
    expect(height).toBeLessThan(220)
    expect(width! / height!).toBeGreaterThan(5)
    expect(Number(doc.documentElement.getAttribute('width'))).toBe(width)
    expect(Number(doc.documentElement.getAttribute('height'))).toBe(height)
    expect(asset.widthPx).toBe(width)
    expect(asset.heightPx).toBe(height)
    for (const box of Array.from(doc.querySelectorAll('[data-node-id] > rect')).map(bounds)) {
      expect(box.x - x!).toBeGreaterThanOrEqual(12)
      expect(box.y - y!).toBeGreaterThanOrEqual(12)
      expect(x! + width! - box.x - box.width).toBeGreaterThanOrEqual(12)
      expect(y! + height! - box.y - box.height).toBeGreaterThanOrEqual(12)
    }
  })

  it('keeps three-row client diagrams above 16pt at the actual 11.93 by 4.5 inch report image area', () => {
    const value = page()
    value.visual.diagram = { nodes: [
      { id: 'family', label: '周末家庭客群', column: 0, row: 0 },
      { id: 'group', label: '自然研学团队', column: 0, row: 2 },
      { id: 'reserve', label: '预约与外围到达', column: 1, row: 1 },
      { id: 'visit', label: '半日至一日体验', column: 2, row: 1, tone: 'accent' },
      { id: 'return', label: '选购与返程', column: 3, row: 1 },
    ], edges: [{ from: 'family', to: 'reserve' }, { from: 'group', to: 'reserve' },
      { from: 'reserve', to: 'visit' }, { from: 'visit', to: 'return' }] }
    const doc = new JSDOM(renderManuscriptDiagram(value), { contentType: 'image/svg+xml' }).window.document
    const width = Number(doc.documentElement.getAttribute('width')), height = Number(doc.documentElement.getAttribute('height'))
    const pointsPerUnit = Math.min(11.93 * 72 / width, 4.5 * 72 / height)
    for (const text of Array.from(doc.querySelectorAll('[data-node-id] text'))) {
      expect(Number(text.getAttribute('font-size')) * pointsPerUnit).toBeGreaterThanOrEqual(16)
    }
    expect(height).toBeLessThan(620)
  })

  it('routes long, reversing and self-loop edges outside every node while retaining each relation', () => {
    const value = page()
    value.visual.diagram = { nodes: Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`, label: `节点 ${i}`, column: i % 4, row: Math.floor(i / 4),
    })), edges: [{ from: 'n0', to: 'n3' }, { from: 'n3', to: 'n0' }, { from: 'n0', to: 'n11' },
      { from: 'n9', to: 'n1' }, { from: 'n5', to: 'n5' }] }
    const doc = new JSDOM(renderManuscriptDiagram(value), { contentType: 'image/svg+xml' }).window.document
    const boxes = Array.from(doc.querySelectorAll('[data-node-id] > rect')).map(bounds)
    const paths = Array.from(doc.querySelectorAll('[data-edge-index][marker-end]'))
    expect(paths).toHaveLength(value.visual.diagram.edges.length)
    for (const [index, path] of paths.entries()) {
      expect(path.getAttribute('data-edge-from')).toBe(value.visual.diagram.edges[index].from)
      expect(path.getAttribute('data-edge-to')).toBe(value.visual.diagram.edges[index].to)
      const numbers = path.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/gu)!.map(Number)
      const points = Array.from({ length: numbers.length / 2 }, (_, i) => [numbers[i * 2]!, numbers[i * 2 + 1]!] as const)
      for (let i = 1; i < points.length; i++) {
        const from = points[i - 1]!, to = points[i]!
        expect(from[0] === to[0] || from[1] === to[1]).toBe(true)
        for (const box of boxes) {
          const crosses = from[0] === to[0]
            ? from[0] > box.x && from[0] < box.x + box.width && Math.max(from[1], to[1]) > box.y && Math.min(from[1], to[1]) < box.y + box.height
            : from[1] > box.y && from[1] < box.y + box.height && Math.max(from[0], to[0]) > box.x && Math.min(from[0], to[0]) < box.x + box.width
          expect(crosses, `${index}: ${from.join(',')} -> ${to.join(',')}`).toBe(false)
        }
      }
    }
  })

  it('preserves labelled parallel relations without colliding labels or inventing extra edges', () => {
    const value = page()
    value.visual.diagram.edges = [{ from: 'arrival', to: 'tea', label: '预约接驳' },
      { from: 'arrival', to: 'tea', label: '团队预约' }, { from: 'tea', to: 'return', label: '展销采购' }]
    const svg = renderManuscriptDiagram(value)
    expect(renderManuscriptDiagram(value)).toBe(svg)
    const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document
    const labels = Array.from(doc.querySelectorAll('[data-edge-label] > rect')).map(bounds)
    expect(labels).toHaveLength(3)
    expect(doc.querySelectorAll('[marker-end]')).toHaveLength(3)
    labels.forEach((label, i) => labels.slice(i + 1).forEach(other => expect(overlaps(label, other)).toBe(false)))
    expect(doc.querySelectorAll('[data-node-id]')).toHaveLength(3)
  })

  it('never paints a material disclaimer, including a caption from an older manuscript', () => {
    const value = page(); value.visual.caption = '拟议关系示意；不表示实际地理位置、测绘范围或已建成状态。'
    const doc = new JSDOM(renderManuscriptDiagram(value), { contentType: 'image/svg+xml' }).window.document
    expect(doc.documentElement.textContent).not.toMatch(/拟议关系示意|非地理|不表示实际|不代表实际|已建成状态/u)
  })

  it('balances narrow cards at word boundaries instead of leaving a broken word or one-character final line', () => {
    const value = page()
    value.visual.diagram.nodes = Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, label: '外围停车与导览', column: i, row: 0 }))
    value.visual.diagram.edges = []
    const doc = new JSDOM(renderManuscriptDiagram(value), { contentType: 'image/svg+xml' }).window.document
    expect(Array.from(doc.querySelectorAll('[data-node-id="n0"] tspan')).map(item => item.textContent)).toEqual(['外围停车', '与导览'])
  })

  it.each([1, 7, 8, 14, 15, 24, 25, 32])('keeps a %i-character node readable and within its box', length => {
    const value = page(); value.visual.diagram.nodes[0].label = '茶'.repeat(length)
    const doc = new JSDOM(renderManuscriptDiagram(value), { contentType: 'image/svg+xml' }).window.document
    const node = doc.querySelector('[data-node-id="arrival"]')!, box = node.querySelector('rect')!, text = node.querySelector('text')!
    const fontSize = Number(text.getAttribute('font-size')), spans = Array.from(text.querySelectorAll('tspan'))
    expect(fontSize).toBeGreaterThanOrEqual(22)
    if (length <= 14) expect(fontSize).toBeGreaterThanOrEqual(30)
    expect(Math.max(...spans.map(span => Array.from(span.textContent ?? '').length)) * fontSize).toBeLessThanOrEqual(Number(box.getAttribute('width')) - 12)
    const firstY = Number(text.getAttribute('y')), lastY = firstY + spans.reduce((sum, span) => sum + Number(span.getAttribute('dy')), 0)
    expect(firstY - fontSize / 2).toBeGreaterThanOrEqual(Number(box.getAttribute('y')) + 6)
    expect(lastY + fontSize / 2).toBeLessThanOrEqual(Number(box.getAttribute('y')) + Number(box.getAttribute('height')) - 6)
    expect(text.textContent).toBe('茶'.repeat(length))
  })

  it.each([false, true])('directly connects neighboring nodes in one row, reverse=%s', reverse => {
    const value = page(); value.visual.diagram.edges = [{ from: reverse ? 'tea' : 'arrival', to: reverse ? 'arrival' : 'tea' }]
    const doc = new JSDOM(renderManuscriptDiagram(value), { contentType: 'image/svg+xml' }).window.document
    const from = doc.querySelector(`[data-node-id="${reverse ? 'tea' : 'arrival'}"] > rect`)!
    const to = doc.querySelector(`[data-node-id="${reverse ? 'arrival' : 'tea'}"] > rect`)!
    const startX = Number(from.getAttribute('x')) + (reverse ? 0 : Number(from.getAttribute('width')))
    const endX = Number(to.getAttribute('x')) + (reverse ? Number(to.getAttribute('width')) : 0)
    const y = Number(from.getAttribute('y')) + Number(from.getAttribute('height')) / 2
    expect(doc.querySelector('[marker-end]')!.getAttribute('d')).toBe(`M ${startX} ${y} L ${endX} ${y}`)
  })

  it('keeps enlarged edge labels in the grid gaps even with every node cell occupied', () => {
    const value = page()
    value.visual.diagram = {
      nodes: Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, label: '节点', column: i % 4, row: Math.floor(i / 4) })),
      edges: [{ from: 'n0', to: 'n1', label: '接'.repeat(20) }, { from: 'n1', to: 'n5', label: '上下关系' },
        { from: 'n5', to: 'n8', label: '转向关系' }, { from: 'n11', to: 'n11', label: '自循环' }],
    }
    const doc = new JSDOM(renderManuscriptDiagram(value), { contentType: 'image/svg+xml' }).window.document
    const bounds = (element: Element) => ({ x: Number(element.getAttribute('x')), y: Number(element.getAttribute('y')),
      width: Number(element.getAttribute('width')), height: Number(element.getAttribute('height')) })
    const nodes = Array.from(doc.querySelectorAll('[data-node-id] > rect')).map(bounds)
    const labels = Array.from(doc.querySelectorAll('[data-edge-label] > rect'))
    expect(labels).toHaveLength(4)
    for (const label of labels) {
      const box = bounds(label), text = label.parentElement!.querySelector('text')!
      expect(Number(text.getAttribute('font-size'))).toBeGreaterThanOrEqual(22)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(1280)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(720)
      expect(nodes.some(node => box.x < node.x + node.width && box.x + box.width > node.x
        && box.y < node.y + node.height && box.y + box.height > node.y)).toBe(false)
    }
  })

  it('writes a parseable graph with arrows and short labels, without redrawing page prose', async () => {
    const result = await visuals()
    expect(result.assets).toHaveLength(1)
    const asset = result.assets[0]!
    expect(asset).toMatchObject({ mimeType: 'image/svg+xml', semanticRole: 'deterministic_visual', pageBindingOnly: true,
      pageBindings: [{ findingId: 'manuscript:launch-journey', role: 'primary' }], origin: { type: 'generated_by_tool' } })
    const svg = await readFile(asset.sourcePath, 'utf8')
    const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document
    expect(doc.documentElement.localName).toBe('svg')
    expect(Number(doc.documentElement.getAttribute('width'))).toBeGreaterThan(Number(doc.documentElement.getAttribute('height')))
    expect(doc.querySelectorAll('[marker-end]')).toHaveLength(2)
    expect(doc.documentElement.textContent).not.toMatch(/非地理|不代表实际|法定边界/u)
    expect(doc.documentElement.textContent).toContain('外围到达')
    expect(doc.documentElement.textContent).toContain('预约接驳')
    expect(svg).not.toContain(page().body[0])
    expect(svg).not.toContain(page().claim)
    expect(asset.originalFileName).toBe(`${createHash('sha256').update(svg).digest('hex')}.svg`)
  })

  it('keeps source labels as safe text instead of SVG or external-resource injection', async () => {
    const value = page(); value.visual.diagram.nodes[0].label = '<script>坏标签</script>'
    value.visual.diagram.edges[0].label = '<image href="x"/>'
    const result = await visuals([value]); expect(result.assets).toHaveLength(1)
    const svg = await readFile(result.assets[0]!.sourcePath, 'utf8')
    const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document
    expect(doc.querySelector('script,image,foreignObject,use')).toBeNull()
    expect(doc.documentElement.textContent).toContain('<script>坏标签</script>')
    expect(doc.documentElement.textContent).toContain('<image href="x"/>')
  })

  it('does not invent graph assets from briefs, prose, real tables or concept requirements', async () => {
    const plain = page(); delete plain.visual.diagram
    const tabular = page('launch-comparison'); delete tabular.visual.diagram
    tabular.table = { columns: ['产品', '作用'], rows: [['茶园漫行', '进入茶园'], ['品茶', '停留体验']] }
    const concept = page('launch-scene'); delete concept.visual.diagram; concept.visual.kind = 'concept'
    expect((await visuals([plain, tabular, concept])).assets).toEqual([])
  })

  it('honors diagrams=false without creating a replacement card', async () => {
    expect((await visuals([page()], [], false)).assets).toEqual([])
  })

  it('replaces only managed graph assets when the authored relationship changes', async () => {
    const first = await visuals(); expect(first.assets).toHaveLength(1)
    const owned = first.assets[0]!
    const other = { ...owned, sourceKey: 'manual-illustration', pageBindings: [{ findingId: 'manuscript:launch-other', role: 'supporting' as const }] }
    const changed = page(); changed.visual.diagram.edges[0].label = '步行进入'
    const second = await visuals([changed], [owned, other])
    expect(second.assets).toHaveLength(2)
    expect(second.assets.find(asset => asset.sourceKey === 'manual-illustration')).toEqual(other)
    const updated = second.assets.find(asset => asset.sourceKey !== 'manual-illustration')!
    expect(updated.sourceKey).toBe(owned.sourceKey)
    expect(updated.originalFileName).not.toBe(owned.originalFileName)
    const withoutGraph = page(); delete withoutGraph.visual.diagram
    expect((await visuals([withoutGraph], [updated, other])).assets).toEqual([other])
  })
})

describe('explicit source-page material binding', () => {
  const sourceKey = 'workspace-inbox:图/少谭河影像.jpg'
  function sourcePage() {
    const value = page('launch-source'); delete value.visual.diagram
    value.visual.kind = 'source'; value.visual.sourceMaterialKey = sourceKey
    value.visual.caption = '库区现场影像'
    return value
  }
  it('preserves a nonblank source key only on a source visual', () => {
    expect(validatePlanningChapter(chapter([sourcePage()]), 'launch', sources).pages[0]!.visual).toHaveProperty('sourceMaterialKey', sourceKey)
    const value = page(); value.visual.sourceMaterialKey = sourceKey
    expect(() => validatePlanningChapter(chapter([value]), 'launch', sources)).toThrow(/MANUSCRIPT_VISUAL_SOURCE/)
    const blank = sourcePage(); blank.visual.sourceMaterialKey = ' '
    expect(() => validatePlanningChapter(chapter([blank]), 'launch', sources)).toThrow(/MANUSCRIPT_VISUAL_SOURCE/)
  })
  it('binds only the exact registry source to its named page and preserves its caption', async () => {
    const root = await workspace(), path = join(root, 'source.png')
    await writeFile(path, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    const source = { sourceKey, sourcePath: path, originalFileName: 'source.png', mimeType: 'image/png', importedAt: input.generatedAt }
    const unrelated = { ...source, sourceKey: 'workspace-inbox:other.png', sourcePath: join(root, 'must-not-read.png') }
    const unbound = sourcePage(); unbound.id = 'launch-unbound'; delete unbound.visual.sourceMaterialKey
    const result = await prepareClientVisuals({ frozenProject: frozen([sourcePage(), unbound]), workspaceRoot: root, sources: [unrelated, source], assets: [] })
    expect(result.assets).toHaveLength(1)
    expect(result.assets[0]).toMatchObject({ aliases: [sourceKey, `client-source:${sourceKey}`], displayName: sourcePage().visual.caption, origin: { type: 'source_material', sourceMaterialKeys: [sourceKey] },
      pageBindingOnly: true, pageBindings: [{ findingId: 'manuscript:launch-source', role: 'primary' }] })
    expect(result.warnings).toEqual([])
  })
  it('warns and leaves the page unbound when the exact registry key is absent', async () => {
    const root = await workspace()
    const result = await prepareClientVisuals({ frozenProject: frozen([sourcePage()]), workspaceRoot: root, sources: [{
      sourceKey: 'workspace-inbox:图/少潭河影像.jpg', sourcePath: join(root, 'must-not-read.jpg'), originalFileName: 'other.jpg', mimeType: 'image/jpeg', importedAt: input.generatedAt,
    }], assets: [] })
    expect(result.assets).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain(sourceKey)
    expect(result.warnings[0]).toContain('launch-source')
  })
})
