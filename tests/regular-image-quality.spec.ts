import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ClientPagePlan, ClientReport, ClientVisualAsset } from '../src/report/client-types.ts'
import type { PlanningManuscriptPage } from '../src/report/manuscript/types.ts'
import { planRegularManuscriptPage, regularImageGeometry, regularInspectionProblem, REGULAR_CANVAS } from '../src/report/regular/layout.ts'
import { auditRegularVisuals, assertRegularVisuals } from '../src/report/regular/visual-audit.ts'
import { imageBriefHash, imagePlacementHash, REPORT_IMAGE_POLICY_VERSION, type ImageInspection, type ImageSlotBrief } from '../src/visual/image-policy.ts'

const photo = (id: string, nodes?: string[]): ClientVisualAsset => ({ assetId: id, chapterId: 'c', role: 'product-scene',
  sourceKind: 'ai-concept', sourcePath: `${id}.png`, sha256: createHash('sha256').update(id).digest('hex'), width: 1600, height: 900,
  caption: '沿湖公共活动', stageNodeIds: nodes })
const page: PlanningManuscriptPage = { id: 'walk', title: '沿湖活动组织', claim: '将入口、活动与休息场所连接为可达的公共空间。',
  kind: 'argument', editorialSummary: true, body: ['保留公众日常步行的连续空间。'], notes: [], sourceRefs: [],
  visual: { kind: 'concept', subject: '沿湖活动', purpose: '步行体验', caption: '沿湖公共活动' } }
const brief = (id = 'walk:scene', pageId = 'walk'): ImageSlotBrief => ({ id, pageId, version: '1', conclusion: '公众活动', subjects: ['公众'], activities: ['步行'], environment: '中国城市公园',
  scale: 'scene', allowedKinds: ['photo', 'render', 'plan'], allowedSources: ['project', 'web', 'generated'], locale: 'domestic' })
function inspected(asset: ClientVisualAsset, requirement: ImageSlotBrief, placement: { box: { x: number; y: number; w: number; h: number }; fit: 'cover' | 'contain'; nodeId?: string }, overrides: Partial<ImageInspection> = {}): ClientVisualAsset {
  return { ...asset, imageQuality: { requirement, inspection: { schemaVersion: 'pre-design.image-inspection.v1', imageSha256: asset.sha256,
    usageId: requirement.id, requirementHash: imageBriefHash(requirement), placementHash: imagePlacementHash(placement), actualImageInput: true,
    inspectedAt: '2026-09-19T00:00:00Z', actualModel: { provider: 'fixture', model: 'pixel-review' }, executionId: 'fixture-review', contentKind: 'photo',
    relevant: true, matchedSubjects: ['公众'], mismatches: [], domesticContext: 'supported', textLanguages: ['zh'], textLegible: true, watermark: 'none',
    quality: 'pass', essentialBounds: [{ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }], decision: 'approved', ...overrides } } }
}
function stages(labels: string[], edges: { from: string; to: string; label?: string }[] = []): PlanningManuscriptPage {
  return { ...page, visual: { ...page.visual, kind: 'diagram', diagram: { nodes: labels.map((label, i) => ({ id: `n${i}`, label, column: i, row: 0 })), edges } } }
}
function physical(assets: ClientVisualAsset[], uses: string[][]) {
  const report = { assets, chapters: [] } as unknown as ClientReport
  const plan = { canvas: { width: 13.333333, height: 7.5, unit: 'in' }, pages: uses.map((ids, i) => ({
    pageId: i === 0 ? 'cover' : `p${i}`, kind: i === 0 ? 'cover' : 'evidence',
    regularLayout: { mode: 'row', texts: [], media: ids.map((assetId, j) => ({ assetId, fit: 'contain', box: { x: j * 6.5, y: 0, w: 6.5, h: 7.5 } })) },
  })) } as unknown as ClientPagePlan
  return { report, plan }
}

describe('image-aware physical composition', () => {
  it('can safely bind a reviewed full original with slight aspect mismatch while still requiring final placement evidence', () => {
    const placement = { box: { x: 0, y: 0, w: 13.333333, h: 7.5 }, fit: 'cover' as const }
    const asset = inspected({ ...photo('native-sized'), width: 1600, height: 896 }, brief(), placement,
      { placementHash: `${REPORT_IMAGE_POLICY_VERSION}:full-original` })
    const [part] = planRegularManuscriptPage(page, '公共空间', [asset], 0)
    expect(part!.layout.media).toHaveLength(1)
    expect(part!.layout.media[0]!.fit).toBe('cover')
    expect(regularImageGeometry(asset, part!.layout.media[0]!).retainedArea).toBeGreaterThan(0.99)
    expect(regularInspectionProblem(asset, part!.layout.media[0]!)).toBe('stale-placement')
  })
  it('tolerates one source pixel of raster rounding without allowing a material subject crop', () => {
    const placement = { box: { x: 0, y: 0, w: 13.333333, h: 7.5 }, fit: 'cover' as const }
    const rounded = inspected({ ...photo('normalized'), width: 2730, height: 1535 }, brief(), placement, {
      placementHash: `${REPORT_IMAGE_POLICY_VERSION}:full-original`, essentialBounds: [{ x: 0, y: 0, width: 1, height: 1 }],
    })
    const layout = planRegularManuscriptPage(page, '公共空间', [rounded], 0)[0]!.layout
    expect(layout.media[0]?.fit).toBe('cover')
    expect(regularImageGeometry(rounded, layout.media[0]!).retainedArea).toBeGreaterThan(0.999)
    const substantive = { ...rounded, width: 2740 }
    expect(planRegularManuscriptPage(page, '公共空间', [substantive], 0)[0]!.layout.media).toEqual([])
  })
  it('shares the complete prose across multiple stage pages before adding a text continuation', () => {
    const labels = ['到达入口', '滨水步行', '茶园漫游', '茶室停留', '观景休憩', '便捷返程']
    const body = Array.from({ length: 6 }, (_, i) => `游程安排${i + 1}：沿连续步道组织不同的停留体验，让游客在行进与休息之间自然切换。`)
    const p = { ...stages(labels), body }
    const parts = planRegularManuscriptPage(p, '游程体验', labels.map((_, i) => photo(`stage-${i}`, [`n${i}`])), 0)
    expect(parts).toHaveLength(2)
    expect(parts.every(part => part.layout.media.length === 3 && part.content.body.length > 0)).toBe(true)
    expect(parts.flatMap(part => part.content.body).join('')).toBe(body.join(''))
    expect(parts.flatMap(part => part.layout.materialGaps ?? [])).toEqual([])
    for (const part of parts) for (const media of part.layout.media) {
      expect(media.box.h).toBeGreaterThanOrEqual(1.5)
      const bodyBottom = Math.max(...part.layout.texts.filter(t => t.role === 'body').map(t => t.box.y + t.box.h))
      expect(bodyBottom).toBeLessThan(media.box.y)
    }
  })
  it('anchors complete landscape images to a page edge instead of centering them inside empty panels', () => {
    const asset = photo('landscape')
    for (let ordinal = 0; ordinal < 5; ordinal++) {
      const parts = planRegularManuscriptPage(page, '游园体验', [asset], ordinal)
      for (const placement of parts.flatMap(part => part.layout.media)) {
        const geometry = regularImageGeometry(asset, placement), b = geometry.visible
        expect(geometry.retainedArea).toBe(1)
        expect(b.x < 1e-6 || b.y < 1e-6 || Math.abs(b.x + b.w - REGULAR_CANVAS.width) < 1e-6
          || Math.abs(b.y + b.h - REGULAR_CANVAS.height) < 1e-6).toBe(true)
        expect(b.y < 1e-6 || Math.abs(b.y + b.h - REGULAR_CANVAS.height) < 1e-6).toBe(true)
      }
    }
  })
  it.each([
    { width: 960, height: 375, kind: 'plan' as const },
    { width: 1600, height: 400, kind: 'photo' as const },
  ])('gives a single $width × $height case $kind enough complete visible area in every rotation slot', ({ width, height, kind }) => {
    const asset: ClientVisualAsset = { ...photo('wide-case'), sourceKind: 'project-source', role: kind === 'plan' ? 'diagram' : 'product-scene', width, height,
      provenance: { sourceLabel: '案例实景与布局原图', sourceDate: '2026-09-19', locator: 'https://example.com/case', sourceFileSha256: photo('wide-case').sha256, evidenceIds: ['case-analysis'] },
      imageQuality: { contentKind: kind } }
    const sourcePage: PlanningManuscriptPage = { ...page, kind: 'comparison', sourceRefs: ['case-analysis'], notes: ['保留案例来源正文。'],
      visual: { ...page.visual, kind: 'source', sourceMaterialKey: 'case-study-photo:wide' }, body: ['案例以连续开放空间连接入口与公共活动区域。'] }
    for (const editorialSummary of [true, undefined] as const) for (let ordinal = 0; ordinal < 5; ordinal++) {
      const parts = planRegularManuscriptPage({ ...sourcePage, editorialSummary }, '案例空间分析', [asset], ordinal)
      expect(parts).toHaveLength(1)
      const part = parts[0]!, placement = part.layout.media[0]!, geometry = regularImageGeometry(asset, placement)
      expect(placement.fit).toBe('contain')
      expect(geometry.retainedArea).toBe(1)
      expect(geometry.visible.w * geometry.visible.h / (REGULAR_CANVAS.width * REGULAR_CANVAS.height)).toBeGreaterThanOrEqual(0.2)
      expect(Math.min(width / geometry.visible.w, height / geometry.visible.h)).toBeGreaterThanOrEqual(96)
      expect(part.content.body).toEqual(sourcePage.body)
      expect(part.content.sourceRefs).toEqual(['case-analysis'])
      expect(part.content.notes).toEqual(['保留案例来源正文。'])
      expect(part.layout.shade).toBeUndefined()
      for (const text of part.layout.texts) {
        if (text.role === 'body') expect(text.size).toBe(15)
        expect(Math.min(text.box.x + text.box.w, geometry.visible.x + geometry.visible.w) <= Math.max(text.box.x, geometry.visible.x) + 1e-6
          || Math.min(text.box.y + text.box.h, geometry.visible.y + geometry.visible.h) <= Math.max(text.box.y, geometry.visible.y) + 1e-6).toBe(true)
      }
      const reviewed = inspected(asset, brief(), placement, { contentKind: kind })
      const report = { assets: [reviewed], chapters: [] } as unknown as ClientReport
      const plan = { canvas: REGULAR_CANVAS, pages: [{ pageId: 'walk', planningContent: part.content, regularLayout: part.layout }] } as unknown as ClientPagePlan
      expect(auditRegularVisuals(plan, report, { requireInspectedImages: true }).textOnlyRatio).toBe(0)
      expect(() => assertRegularVisuals(plan, report, { requireInspectedImages: true })).not.toThrow()
    }
  })
  it('paginates long wide-case analysis in source order and reserves new originals for the continuations', () => {
    const body = Array.from({ length: 9 }, (_, i) => `案例分析${i + 1}：已建项目按入口、沿线活动和停留节点组织空间；运营边界与本项目需要分别核实。`)
    const p = { ...page, kind: 'comparison' as const, body, visual: { ...page.visual, kind: 'source' as const, sourceMaterialKey: 'case-study-photo:wide' } }
    const assets = ['case-main', 'case-extra-1', 'case-extra-2', 'case-extra-3', 'case-extra-4'].map((id, index): ClientVisualAsset => ({
      ...photo(id), sourceKind: 'project-source', width: 1600, height: 400,
      imageQuality: { requirement: brief(index ? `walk:continuation:${index}` : 'walk:scene') },
    }))
    const parts = planRegularManuscriptPage(p, '案例真实分析', assets, 0)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every(part => part.layout.media.length === 1)).toBe(true)
    expect(parts.flatMap(part => part.content.body).join('')).toBe(body.join(''))
    expect(parts.flatMap(part => part.layout.media).map(m => m.assetId)).toEqual(assets.slice(0, parts.length).map(asset => asset.assetId))
    for (const part of parts) {
      const placement = part.layout.media[0]!, asset = assets.find(asset => asset.assetId === placement.assetId)!, geometry = regularImageGeometry(asset, placement)
      expect(placement.fit).toBe('contain')
      expect(geometry.retainedArea).toBe(1)
      expect(geometry.visible.w * geometry.visible.h / (REGULAR_CANVAS.width * REGULAR_CANVAS.height)).toBeGreaterThanOrEqual(0.2)
      expect(part.layout.texts.filter(text => text.role === 'body').every(text => text.size === 15)).toBe(true)
      for (const item of [...part.layout.texts, ...part.layout.media]) {
        expect(item.box.x).toBeGreaterThanOrEqual(0); expect(item.box.y).toBeGreaterThanOrEqual(0)
        expect(item.box.x + item.box.w).toBeLessThanOrEqual(REGULAR_CANVAS.width + 1e-6)
        expect(item.box.y + item.box.h).toBeLessThanOrEqual(REGULAR_CANVAS.height + 1e-6)
      }
    }
  })
  it('preserves a square in the array while leaving an analytical image out of scene slots', () => {
    const assets = [{ ...photo('square'), width: 1000, height: 1000 }, { ...photo('analysis'), imageQuality: { contentKind: 'composite' as const } }]
    const input: PlanningManuscriptPage = { ...page, task: { kind: 'scene', question: '如何活动？', scale: 'scene', requiredEvidence: ['场景'], preferredTemplate: 'array-horizontal', imageCount: 2 } }
    const parts = planRegularManuscriptPage(input, '沿湖空间', assets, 1)
    expect(parts).toHaveLength(1)
    expect(parts.flatMap(p => p.layout.media).map(media => media.assetId)).toEqual(['square'])
    expect(regularImageGeometry(assets[0]!, parts[0]!.layout.media[0]!).retainedArea).toBe(1)
    expect(parts[0]!.layout.imageSlots).toHaveLength(2)
    expect(parts[0]!.layout.materialGaps?.map(gap => gap.reason)).toEqual(['incompatible-image-slot'])
  })
  it('keeps a sourced analysis and its concise explanation on the same page without obscuring the drawing', () => {
    const asset = { ...photo('source-plan'), role: 'diagram' as const, sourceKind: 'project-source' as const, imageQuality: { contentKind: 'plan' as const } }
    const parts = planRegularManuscriptPage({ ...page, visual: { ...page.visual, kind: 'source' } }, '案例整体布局', [asset], 4)
    expect(parts).toHaveLength(1)
    expect(parts[0]!.layout.media[0]!.fit).toBe('contain')
    expect(parts[0]!.layout.shade).toBeUndefined()
    expect(parts[0]!.content.body).toEqual(page.body)
  })
  it('gives a compatible table illustration a substantive visible area after contain fitting', () => {
    const asset = { ...photo('table-picture'), width: 900, height: 1800 }, [part] = planRegularManuscriptPage({ ...page, table: { columns: ['场所', '活动'], rows: [['入口', '步行'], ['平台', '休息']] } }, '活动配置', [asset], 0)
    const visible = regularImageGeometry(asset, part!.layout.media[0]!).visible
    expect(visible.w * visible.h / 100).toBeGreaterThanOrEqual(0.2)
    expect(part!.content.table?.rows).toEqual([['入口', '步行'], ['平台', '休息']])
  })
  it('keeps three explicitly planned scenes large and continuous without adding pages when images arrive', () => {
    const assets = ['portrait-a', 'portrait-b', 'portrait-c'].map(id => ({ ...photo(id), width: 1600, height: 1350 }))
    const input: PlanningManuscriptPage = { ...page, task: { kind: 'scene', question: '如何活动？', scale: 'scene', requiredEvidence: ['场景'], preferredTemplate: 'array-horizontal', imageCount: 3 } }
    const parts = planRegularManuscriptPage(input, '日常活动', assets, 1)
    expect(parts).toHaveLength(1)
    expect(parts.flatMap(p => p.layout.media).map(m => m.assetId)).toEqual(assets.map(a => a.assetId))
    for (const part of parts) {
      const visibleArea = part.layout.media.reduce((sum, media) => { const b = regularImageGeometry(assets.find(a => a.assetId === media.assetId)!, media).visible; return sum + b.w * b.h }, 0)
      expect(visibleArea).toBeGreaterThanOrEqual(20)
    }
  })
  it('paginates dense stages into legible photographs without losing any source node or caption', () => {
    const p = stages(Array.from({ length: 12 }, (_, i) => `场所${i + 1}保留设施并组织公众步行和停留`))
    const assets = p.visual.diagram!.nodes.map(n => photo(n.id, [n.id]))
    const parts = planRegularManuscriptPage(p, '公共空间', assets, 0)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.flatMap(part => part.layout.media).map(m => m.nodeId)).toEqual(assets.map(a => a.assetId))
    for (const part of parts) {
      expect(part.layout.media.length).toBeLessThanOrEqual(3)
      for (const media of part.layout.media) {
        expect(media.box.h).toBeGreaterThanOrEqual(1.5)
        expect(media.fit).toBe('contain')
        const caption = part.layout.texts.find(t => t.role === 'stage' && t.nodeId === media.nodeId)!
        expect(caption).toBeDefined()
        expect(caption.box.x + caption.box.w / 2).toBeCloseTo(media.box.x + media.box.w / 2, 5)
        expect(caption.box.y + caption.box.h).toBeLessThanOrEqual(media.box.y + 0.00001)
        expect(caption.box.x).toBeGreaterThanOrEqual(0)
        expect(caption.box.x + caption.box.w).toBeLessThanOrEqual(13.333334)
      }
      expect(Math.max(...part.layout.media.map(m => m.box.y + m.box.h))).toBeCloseTo(7.5, 5)
    }
  })
  it('reports a material gap when two stage assets refer to the same original', () => {
    const a = { ...photo('a', ['n0']), width: 2000, height: 900 }, b = { ...photo('b', ['n1']), width: 2000, height: 900, imageIdentity: { originalId: 'original-a', fileSha256: photo('b').sha256, derivedFromSha256: a.sha256, verification: 'verified-derivative' as const } }
    const p = stages(['入口', '停留'])
    const parts = planRegularManuscriptPage(p, '公共空间', [{ ...a, imageIdentity: { originalId: 'original-a', fileSha256: a.sha256, verification: 'decoded-pixels' } }, b], 0)
    expect(parts.flatMap(part => part.layout.media)).toHaveLength(1)
    expect(parts.flatMap(part => part.layout.materialGaps ?? [])).toContainEqual({ pageId: 'walk', nodeId: 'n1', reason: 'duplicate-original' })
  })
  it('measures a long caption against the fixed scene width and keeps all lines outside image pixels', () => {
    const p = stages(['在公共入口保留连续步行并组织清晰可达的服务设施以及滨水休息空间'])
    const [part] = planRegularManuscriptPage(p, '公共空间', [{ ...photo('wide-stage', ['n0']), width: 4000, height: 900 }], 0)
    const caption = part!.layout.texts.find(t => t.role === 'stage')!, image = part!.layout.media[0]!
    expect(caption.text.split('\n').length * caption.leading / 72 + 0.14).toBeLessThanOrEqual(caption.box.h + 0.00001)
    expect(caption.box.x + caption.box.w / 2).toBeCloseTo(image.box.x + image.box.w / 2, 5)
    expect(caption.box.y + caption.box.h).toBeLessThanOrEqual(image.box.y + 0.00001)
  })
  it('preserves prose and table continuation content without repeating the same background to simulate coverage', () => {
    const body = Array.from({ length: 20 }, (_, i) => `开放条件${i + 1}：公众参观和日常维护使用分开的路线，并保持应急通行能力。`)
    const rows = Array.from({ length: 12 }, (_, i) => [`空间${i + 1}`, `达到水位${i + 1}时调整开放范围。`])
    for (const p of [{ ...page, body }, { ...page, body, table: { columns: ['空间', '条件'], rows } }]) {
      const parts = planRegularManuscriptPage(p, '公共空间', [{ ...photo('only'), width: 900, height: 1800 }], 4)
      expect(parts.length).toBeGreaterThan(1)
      expect(parts.flatMap(part => part.layout.media).map(m => m.assetId)).toEqual(['only'])
      expect(parts.flatMap(part => part.content.body).join('')).toBe(body.join(''))
      expect(parts.flatMap(part => part.layout.materialGaps ?? []).length).toBeGreaterThan(0)
      if (p.table) expect(parts.flatMap(part => part.content.table?.rows ?? [])).toEqual(rows)
    }
  })
  it('reserves explicitly supplied continuation images for later physical pages', () => {
    const body = Array.from({ length: 20 }, (_, i) => `开放条件${i + 1}：公众参观和日常维护使用分开的路线，并保持应急通行能力。`)
    const assets = [photo('first'), ...[1, 2, 3].map(n => ({ ...photo(`extra-${n}`), imageQuality: { requirement: brief(`walk:continuation:${n}`) } }))].map(asset => ({ ...asset, width: 900, height: 1800 }))
    const parts = planRegularManuscriptPage({ ...page, body }, '公共空间', assets, 0)
    expect(parts[0]!.layout.media.map(m => m.assetId)).toEqual(['first'])
    expect(parts.slice(1).flatMap(p => p.layout.media).map(m => m.assetId)).toEqual(['extra-1', 'extra-2', 'extra-3'].slice(0, parts.length - 1))
    expect(parts.every(p => p.layout.media.length <= 1)).toBe(true)
    expect(parts.flatMap(p => p.content.body).join('')).toBe(body.join(''))
  })
  it('retains an independently bound second use of one original on a different physical story page', () => {
    const first = { ...photo('first'), width: 900, height: 1800 }, second = { ...first, assetId: 'second-usage', imageQuality: { requirement: brief('walk:continuation:1') } }
    const body = Array.from({ length: 12 }, (_, i) => `游园段落${i + 1}：保留可达的林下休憩场所，与公众步行路径连续衔接。`)
    for (const p of [{ ...page, body }, { ...page, body: [], table: { columns: ['场所', '体验'], rows: body.map(text => ['林下休憩', text]) } }]) {
      const parts = planRegularManuscriptPage(p, '游园体验', [first, second], 0)
      expect(parts[0]!.layout.media.map(media => media.assetId)).toEqual(['first'])
      expect(parts[1]!.layout.media.map(media => media.assetId)).toEqual(['second-usage'])
      expect(parts.every(part => part.layout.media.length <= 1)).toBe(true)
    }
  })
  it('allows only a current reviewed cover crop retaining at least 80 percent and all essential subjects', () => {
    const placement = { box: { x: 0, y: 0, w: 13.333333, h: 7.5 }, fit: 'cover' as const }
    const asset = inspected({ ...photo('crop'), width: 1600, height: 1000 }, brief(), placement)
    expect(planRegularManuscriptPage(page, '公众空间', [asset], 4)[0]!.layout.media[0]!.fit).toBe('cover')
    for (const invalid of [
      inspected(asset, brief(), placement, { essentialBounds: [{ x: 0, y: 0, width: 1, height: 1 }] }),
      inspected(asset, brief(), placement, { imageSha256: 'f'.repeat(64) }),
      inspected(asset, brief(), placement, { placementHash: 'old-placement' }),
      inspected(asset, brief(), placement, { contentKind: 'composite' }),
    ]) {
      const layout = planRegularManuscriptPage(page, '公众空间', [invalid], 4)[0]!.layout
      expect(layout.media).toEqual([])
      expect(layout.materialGaps?.[0]?.reason).toBe('incompatible-image-slot')
    }
  })
  it('treats actual composite-image inspection as analytical even when import metadata called it a photograph', () => {
    const placement = { box: { x: 0, y: 0, w: 13.333333, h: 7.5 }, fit: 'cover' as const }
    const reviewed = inspected({ ...photo('composite'), width: 1600, height: 1000 }, brief(), placement, { contentKind: 'composite' })
    const asset = { ...reviewed, imageQuality: { ...reviewed.imageQuality, contentKind: 'photo' as const } }
    const [part] = planRegularManuscriptPage({ ...page, visual: { ...page.visual, kind: 'source' } }, '整体关系', [asset], 4)
    expect(part!.layout.media[0]!.fit).toBe('contain')
    expect(part!.layout.shade).toBeUndefined()
  })
  it('uses numbering and position for an explicit sequence and keeps parallel stages unnumbered', () => {
    const labels = ['准备材料', '现场体验', '结果反馈'], assets = labels.map((_, i) => photo(`p${i}`, [`n${i}`]))
    const sequential = planRegularManuscriptPage(stages(labels, [{ from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' }]), '活动组织', assets, 0)
    expect(sequential.flatMap(p => p.layout.connections ?? [])).toEqual([])
    expect(sequential.flatMap(p => p.layout.texts.filter(t => t.role === 'stage').map(t => t.text.replace(/\n/gu, '')))).toEqual(['01 准备材料', '02 现场体验', '03 结果反馈'])
    const parallel = planRegularManuscriptPage(stages(labels), '活动组织', assets, 0)
    expect(parallel.flatMap(p => p.layout.texts.filter(t => t.role === 'stage').map(t => t.text.replace(/\n/gu, '')))).toEqual(labels)
  })
  it('preserves a genuine branch and return relation while removing exact duplicate edges', () => {
    const edges = [{ from: 'n0', to: 'n1', label: '步行' }, { from: 'n0', to: 'n2', label: '接驳' }, { from: 'n2', to: 'n0', label: '返回' }]
    const p = stages(['入口', '展陈', '休息'], [...edges, edges[0]!])
    const parts = planRegularManuscriptPage(p, '活动组织', [photo('a', ['n0']), photo('b', ['n1']), photo('c', ['n2'])], 0)
    expect(parts.flatMap(p => p.layout.connections ?? []).map(({ from, to, label }) => ({ from, to, label }))).toEqual(edges)
  })
  it('preserves network relations that cross dense-stage pagination as visible relationship references', () => {
    const edges = [{ from: 'n0', to: 'n1', label: '步行' }, { from: 'n0', to: 'n4', label: '接驳' }, { from: 'n5', to: 'n0', label: '返回' }]
    const p = stages(['入口', '展览', '广场', '服务', '茶园', '湖岸'], edges)
    const parts = planRegularManuscriptPage(p, '公共空间', p.visual.diagram!.nodes.map(n => photo(n.id, [n.id])), 0)
    expect(parts).toHaveLength(2)
    expect(parts.flatMap(p => [...(p.layout.connections ?? []), ...(p.layout.relationReferences ?? [])]).map(({ from, to, label }) => ({ from, to, label }))).toEqual(edges)
    expect(parts[0]!.layout.texts.some(t => t.text.includes('入口 → 茶园（接驳）'))).toBe(true)
    expect(parts[1]!.layout.texts.some(t => t.text.includes('湖岸 → 入口（返回）'))).toBe(true)
  })
})

describe('physical image quality audit', () => {
  it('counts original families across the cover and continuation and catches same-page duplicates', () => {
    const a = photo('a'), b = photo('b'), assets = [a, b].map(asset => ({ ...asset, imageIdentity: { originalId: 'family', fileSha256: asset.sha256, verification: 'verified-derivative' as const } }))
    const { plan, report } = physical(assets, [['a'], ['a', 'b']])
    const audit = auditRegularVisuals(plan, report)
    expect(audit.originalImageUses).toEqual([{ originalId: 'family', count: 3, pageIds: ['cover', 'p1'], assetIds: ['a', 'b'] }])
    expect(audit.repeatedOriginals).toHaveLength(1)
    expect(audit.samePageDuplicates).toEqual([{ pageId: 'p1', originalId: 'family', count: 2 }])
    expect(() => assertRegularVisuals(plan, report)).toThrow('REPORT_IMAGE_ORIGINAL_REUSE')
  })
  it('uses the source sha fallback when asset IDs and paths differ', () => {
    const a = photo('first'), b = { ...photo('renamed'), sha256: a.sha256 }
    const { plan, report } = physical([a, b], [['first'], ['renamed'], ['first']])
    expect(auditRegularVisuals(plan, report).repeatedOriginals).toEqual([{ originalId: a.sha256, count: 3, pageIds: ['cover', 'p1', 'p2'], assetIds: ['first', 'renamed'] }])
  })
  it('does not count an unreviewed image toward the strict substantive-image ratio', () => {
    const { plan, report } = physical([photo('unreviewed')], [['unreviewed']])
    const audit = auditRegularVisuals(plan, report, { requireInspectedImages: true })
    expect(audit.textOnlyRatio).toBe(1)
    expect(audit.unreviewedImages).toEqual([{ pageId: 'cover', assetId: 'unreviewed', reason: 'missing-inspection' }])
    expect(() => assertRegularVisuals(plan, report, { requireInspectedImages: true })).toThrow('REPORT_IMAGE_INSPECTION_REQUIRED')
  })
  it('counts a current reviewed source plan and rejects a stale placement or another page usage', () => {
    const placement = { box: { x: 0, y: 0, w: 6.5, h: 7.5 }, fit: 'contain' as const }
    const asset = inspected({ ...photo('plan'), role: 'diagram', sourceKind: 'project-source', provenance: { sourceLabel: 'Published site plan', sourceDate: '2026-09-19', locator: 'https://example.com/site-plan', sourceFileSha256: photo('plan').sha256, evidenceIds: ['published-plan'] } }, brief('cover:plan', 'cover'), placement, { contentKind: 'plan' })
    const { plan, report } = physical([asset], [['plan']])
    expect(auditRegularVisuals(plan, report, { requireInspectedImages: true }).textOnlyRatio).toBe(0)
    for (const invalid of [inspected(asset, brief('walk:plan'), placement, { contentKind: 'plan' }), inspected(asset, brief('cover:plan', 'cover'), placement, { contentKind: 'plan', placementHash: 'old' })]) {
      expect(auditRegularVisuals(plan, { ...report, assets: [invalid] }, { requireInspectedImages: true }).textOnlyRatio).toBe(1)
    }
  })
})
