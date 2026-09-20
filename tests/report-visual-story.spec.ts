import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { planRegularManuscriptPage } from '../src/report/regular/layout.ts'
import { summarizeReportPage } from '../src/report/manuscript/report-story.ts'
import { auditRegularVisuals, assertRegularVisuals } from '../src/report/regular/visual-audit.ts'
import type { PlanningManuscriptPage } from '../src/report/manuscript/types.ts'
import type { ClientPagePlan, ClientReport, ClientVisualAsset } from '../src/report/client-types.ts'

const photo = (id: string, nodeIds?: string[]): ClientVisualAsset => ({ assetId: id, role: 'product-scene', chapterId: 'c',
  caption: '工业遗产的展览体验', sourceKind: 'ai-concept', sourcePath: `${id}.png`, sha256: createHash('sha256').update(id).digest('hex'), width: 1600, height: 900, stageNodeIds: nodeIds })
const page: PlanningManuscriptPage = { id: 'industrial-visit', kind: 'argument', title: '从工业遗产到公共展览', claim: '利用原有厂房组织连续的公众体验。',
  body: ['保留设备与构架，让参观者理解生产历史。', '开放路线与检修区域分开组织。'], notes: [], sourceRefs: ['s'],
  visual: { kind: 'concept', subject: '工业遗产展览', purpose: '公众体验', caption: '展览体验' } }

describe('general visual report layout', () => {
  it('shows concise copy with a substantive image without making a text continuation', () => {
    for (let ordinal = 0; ordinal < 5; ordinal++) {
      const parts = planRegularManuscriptPage(summarizeReportPage(page), '项目策划', [photo('p')], ordinal)
      expect(parts).toHaveLength(1)
      expect(parts[0]!.layout.media).toHaveLength(1)
      expect(parts[0]!.content.body).toEqual(page.body)
    }
  })
  it('measures short paragraphs before choosing half-height imagery so a case page stays one page', () => {
    const p = summarizeReportPage({ ...page, body: ['沿原有建筑组织参观线路，保留空间层次。', '设备展陈与公众活动保持直接的视觉联系。', '开放平台连接不同高度的停留节点，形成连续的游览体验。'] })
    for (let ordinal = 0; ordinal < 5; ordinal++) expect(planRegularManuscriptPage(p, '案例研究', [photo('p')], ordinal)).toHaveLength(1)
  })
  it('keeps tables with imagery and does not insert a repeating prose page', () => {
    const p = summarizeReportPage({ ...page, table: { columns: ['场景', '做法'], rows: [['展厅', '保留构架'], ['户外', '连接公共空间']] } })
    const parts = planRegularManuscriptPage(p, '展陈组织', [photo('p')], 0)
    expect(parts).toHaveLength(1)
    expect(parts[0]!.layout.table?.rows).toHaveLength(2)
    expect(parts[0]!.layout.media[0]!.box.w).toBeGreaterThan(4)
    expect(parts[0]!.content.body).toContain('开放路线与检修区域分开组织。')
  })
  it('matches photos to individual stages and lays the array against a canvas edge', () => {
    const p = summarizeReportPage({ ...page, visual: { ...page.visual, kind: 'diagram', diagram: {
      nodes: [{ id: 'arrive', label: '工业遗产入口', column: 0, row: 0 }, { id: 'exhibit', label: '设备展陈', column: 1, row: 0 }],
      edges: [{ from: 'arrive', to: 'exhibit', label: '参观线路' }],
    } } })
    const parts = planRegularManuscriptPage(p, '游览组织', [photo('a', ['arrive']), photo('b', ['exhibit'])], 0)
    expect(parts).toHaveLength(1)
    expect(parts[0]!.layout.media.map(m => [m.nodeId, m.assetId])).toEqual([['arrive', 'a'], ['exhibit', 'b']])
    expect(parts[0]!.layout.media.every(m => Math.abs(m.box.y + m.box.h - 7.5) < 0.00001)).toBe(true)
    expect(parts[0]!.layout.connections?.[0]).toMatchObject({ from: 'arrive', to: 'exhibit', label: '参观线路' })
  })
  it('retains long stage copy and its photographed graph while reporting continuation material gaps', () => {
    const body = Array.from({ length: 12 }, (_, i) => `开放条件${i + 1}：保留原有设备与结构，公众参观和日常检修采用分开的路线。`)
    const p = summarizeReportPage({ ...page, body, visual: { ...page.visual, kind: 'diagram', diagram: {
      nodes: [{ id: 'entry', label: '工业入口', column: 0, row: 0 }, { id: 'visit', label: '公众参观', column: 1, row: 0 }],
      edges: [{ from: 'entry', to: 'visit', label: '步行' }],
    } } })
    const parts = planRegularManuscriptPage(p, '工业遗产更新', [photo('a', ['entry']), photo('b', ['visit'])], 0)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts[0]!.layout.media.map(m => m.nodeId)).toEqual(['entry', 'visit'])
    expect(parts.flatMap(part => part.layout.media).map(media => media.assetId)).toEqual(['a', 'b'])
    expect(parts.slice(1).every(part => part.layout.materialGaps?.some(gap => gap.reason === 'continuation-image-required'))).toBe(true)
    expect(parts.flatMap(part => part.content.body).join('')).toBe(body.join(''))
  })
  it('reserves visible image height beneath long stage labels in dense arrays', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, label: `场所${i + 1}保留工业设备并组织公众参观停留`, column: Math.floor(i / 3), row: i % 3 }))
    const p = summarizeReportPage({ ...page, visual: { ...page.visual, kind: 'diagram', diagram: { nodes, edges: [] } } })
    const parts = planRegularManuscriptPage(p, '工业场景组织', nodes.map(node => photo(node.id, [node.id])), 0)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) for (const image of part.layout.media) {
      const label = part.layout.texts.find(t => t.role === 'stage' && t.nodeId === image.nodeId)!
      expect(image.box.h).toBeGreaterThanOrEqual(1.5)
      expect(label.box.y + label.box.h).toBeLessThanOrEqual(image.box.y + 0.00001)
    }
  })
  it('paginates independent prose and tables without duplicate imagery while preserving every condition and cell', () => {
    const body = Array.from({ length: 12 }, (_, i) => `潮汐条件${i + 1}：涨潮时关闭临水步道，平台开放范围根据当日水位调整。`)
    const rows = Array.from({ length: 9 }, (_, i) => [`场所${i + 1}`, `潮位达到${i + 1}.5米时切换为高位路线。`])
    const p = summarizeReportPage({ ...page, title: '滨海游览的开放组织', body, table: { columns: ['场所', '开放条件'], rows } })
    const parts = planRegularManuscriptPage(p, '滨海公共空间', [photo('shore')], 0)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.flatMap(part => part.layout.media).map(media => media.assetId)).toEqual(['shore'])
    expect(parts.slice(1).every(part => part.layout.materialGaps?.some(gap => gap.reason === 'continuation-image-required'))).toBe(true)
    expect(parts.flatMap(part => part.content.body).join('')).toBe(body.join(''))
    expect(parts.flatMap(part => part.content.table?.rows ?? [])).toEqual(rows)
    for (const part of parts) for (const item of [...part.layout.texts, ...part.layout.media, ...(part.layout.table ? [part.layout.table] : [])]) {
      expect(item.box.y + item.box.h).toBeLessThanOrEqual(7.5)
      expect(item.box.h).toBeGreaterThan(0)
    }
  })
})

describe('15 percent export gate', () => {
  function fixture(textPages: number, area = 50) {
    const assets = Array.from({ length: 20 }, (_, i) => photo(`p${i}`)), report = { assets, chapters: [] } as unknown as ClientReport
    const plan = { canvas: { width: 13.333333, height: 7.5, unit: 'in' }, pages: Array.from({ length: 20 }, (_, i) => ({
      pageId: `p${i}`, regularLayout: { mode: i < textPages ? 'table' : 'left', texts: [],
        media: i < textPages ? [] : [{ assetId: `p${i}`, box: { x: 0, y: 0, w: area / 7.5, h: 7.5 }, fit: 'contain' }] },
    })) } as unknown as ClientPagePlan
    return { report, plan }
  }
  it('counts all physical pages including tables and enforces the exact 15 percent boundary', () => {
    const pass = fixture(3), fail = fixture(4)
    expect(auditRegularVisuals(pass.plan, pass.report).textOnlyRatio).toBe(0.15)
    expect(() => assertRegularVisuals(pass.plan, pass.report)).not.toThrow()
    expect(() => assertRegularVisuals(fail.plan, fail.report)).toThrow('REPORT_TEXT_PAGE_RATIO')
  })
  it('rejects tiny decoration and pure vector diagrams as photographic coverage', () => {
    const tiny = fixture(0, 1)
    expect(() => assertRegularVisuals(tiny.plan, tiny.report)).toThrow('REPORT_TEXT_PAGE_RATIO')
    const diagram = fixture(0)
    expect(() => assertRegularVisuals(diagram.plan, { ...diagram.report, assets: diagram.report.assets.map(asset => ({ ...asset, role: 'diagram', sourceKind: 'deterministic' })) })).toThrow('REPORT_TEXT_PAGE_RATIO')
  })
})

describe('stage image export gate', () => {
  function fixture(sourcePageId: string | undefined, contentPageId = sourcePageId, chapterId = 'c') {
    const diagram = { ...page, visual: { ...page.visual, kind: 'diagram' as const,
      diagram: { nodes: [{ id: 'entry', label: '公众入口', column: 0, row: 0 }], edges: [] } } }
    const report = { assets: [photo('entry-photo', ['entry'])], chapters: [{ id: 'c', blocks: [
      { type: 'planning-page', page: diagram },
      { type: 'planning-page', page: { ...diagram, id: 'waterfront-visit' } },
    ] }] } as unknown as ClientReport
    const plan = { canvas: { width: 13.333333, height: 7.5, unit: 'in' }, pages: [{
      pageId: 'physical-continuation', chapterId,
      ...(sourcePageId ? { pagination: { sourcePageId, partIndex: 1, partCount: 2 } } : {}),
      ...(contentPageId ? { planningContent: { ...diagram, id: contentPageId } } : {}),
      regularLayout: { mode: 'row', texts: [], media: [{ assetId: 'entry-photo', nodeId: 'entry',
        box: { x: 0, y: 0, w: 8, h: 7.5 }, fit: 'contain' }] },
    }] } as unknown as ClientPagePlan
    return { report, plan }
  }
  it('rejects a missing stage even when another page in the chapter uses the same node ID', () => {
    const { plan, report } = fixture(page.id)
    expect(auditRegularVisuals(plan, report).missingStages).toEqual([{ pageId: 'waterfront-visit', nodeId: 'entry' }])
    expect(() => assertRegularVisuals(plan, report)).toThrow('REPORT_STAGE_IMAGES_MISSING')
  })
  it('accepts the source page continuation and falls back to content identity for an unpaginated page', () => {
    for (const source of [page.id, undefined]) {
      const { plan, report } = fixture(source, page.id)
      expect(auditRegularVisuals(plan, report).missingStages).toEqual([{ pageId: 'waterfront-visit', nodeId: 'entry' }])
    }
  })
  it('uses explicit pagination identity ahead of a conflicting content identity', () => {
    const { plan, report } = fixture('waterfront-visit', page.id)
    expect(auditRegularVisuals(plan, report).missingStages).toEqual([{ pageId: page.id, nodeId: 'entry' }])
  })
  it('does not accept unidentified or cross-chapter images for any source page', () => {
    for (const { plan, report } of [fixture(undefined), fixture(page.id, page.id, 'other')]) {
      expect(auditRegularVisuals(plan, report).missingStages).toEqual([
        { pageId: page.id, nodeId: 'entry' }, { pageId: 'waterfront-visit', nodeId: 'entry' },
      ])
    }
  })
})
