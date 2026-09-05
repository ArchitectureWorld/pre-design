import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateDocumentWithAjv } from '@architectureworld/presentation-contracts'
import { buildPresentationStandardProject } from '../src/presentation/standard-project-adapter.ts'
import { PresentationStableIdLedger } from '../src/presentation/identity-ledger.ts'
import type { ProfessionalFinding } from '../src/presentation/projector/types.ts'
import { createStandardFrozenProject } from './presentation-standard-fixture.ts'

const planner = vi.hoisted(() => ({ compile: vi.fn() }))
vi.mock('../src/presentation/projector/report-outline.ts', () => ({ compileReportOutline: planner.compile }))

type PlannedFinding = ProfessionalFinding & { sectionKey: string; sectionTitle: string; sectionOrder: number }

function finding(overrides: Partial<PlannedFinding> = {}): PlannedFinding {
  return {
    findingId: 'pre-design:project-brief',
    topicKey: 'project_brief',
    sectionKey: 'project-task',
    sectionTitle: '项目任务与价值判断',
    sectionOrder: 0,
    order: 0,
    title: '任务边界与关键证据',
    keyMessage: '明确项目的服务范围与实施条件。',
    contentNature: 'professional_judgement',
    objectIds: ['PS01'],
    evidenceIds: [],
    supportingBlocks: [
      { type: 'heading', role: 'section_title', content: '汇报问题：为什么确定这一服务范围？' },
      { type: 'text', role: 'body', content: '完整分析正文：需要联动东区宿舍与南门交通节点。' },
      { type: 'list', role: 'key_points', listStyle: 'unordered', items: ['完整调研证据一', '完整调研证据二'] },
      { type: 'list', role: 'key_points', listStyle: 'unordered', items: ['完整调研证据三'] },
      { type: 'metric_group', role: 'key_metrics', metrics: [{ label: '实际服务人口', value: 1200, unit: '人', note: '实地统计' }] },
      { type: 'metric_group', role: 'key_metrics', metrics: [{ label: '覆盖范围', value: '东区', note: '任务书' }] },
      { type: 'table', role: 'comparison', columns: ['方案', '判断'], rows: [['东区范围', '优先建设'], ['西区范围', '后续研究']] },
      { type: 'table', role: 'data', columns: ['依据', '数值'], rows: [['调研点', 12]] },
      { type: 'text', role: 'source_note', content: '图表建议：服务半径与交通节点叠合图。', contentNature: 'recommendation' },
    ],
    speakerNotes: ['待核对项：西区地块权属须由业主确认。'],
    ...overrides,
  }
}

beforeEach(() => planner.compile.mockReset())

describe('standard report outline integration', () => {
  it('uses the complete speaker notes without prepending the takeaway or appending decision text', async () => {
    planner.compile.mockReturnValue([finding({
      contentNature: 'decision',
      keyMessage: '现有成果提出：供水保障需要统筹建设条件。',
      speakerNotes: ['从项目认知出发，先解释供水需求与建设边界的关系。', '接下来比较两处坝址，并说明仍待核实的地质条件。'],
    })])
    const build = await buildPresentationStandardProject({ frozenProject: createStandardFrozenProject({
      decisionItems: ['确认一期实施范围。'], recommendation: '暂推荐下坝址。',
    }) })
    const manifest = build.documents['pages/manifest.json'] as any
    const draft = build.documents[manifest.pages[0].draftPath] as any
    expect(draft.scriptBlocks[0].content).toBe('从项目认知出发，先解释供水需求与建设边界的关系。\n接下来比较两处坝址，并说明仍待核实的地质条件。')
    expect(draft.contentBlocks.find((block: any) => block.role === 'key_message').content)
      .toBe('现有成果提出：供水保障需要统筹建设条件。')
  })

  it.each([
    { label: 'missing', speakerNotes: undefined },
    { label: 'empty', speakerNotes: [] },
    { label: 'blank', speakerNotes: ['  ', '\n'] },
  ])('keeps the legacy decision fallback when speaker notes are $label', async ({ speakerNotes }) => {
    planner.compile.mockReturnValue([finding({ contentNature: 'decision', keyMessage: '明确本轮需要确认的建设边界。', speakerNotes })])
    const build = await buildPresentationStandardProject({ frozenProject: createStandardFrozenProject({
      decisionItems: ['确认一期实施范围。'], recommendation: '暂推荐下坝址。',
    }) })
    const manifest = build.documents['pages/manifest.json'] as any
    const draft = build.documents[manifest.pages[0].draftPath] as any
    expect(draft.scriptBlocks[0].content).toBe('明确本轮需要确认的建设边界。\n确认一期实施范围。\n暂推荐下坝址。')
  })

  it('writes every compiled support block without replacing it with object summaries', async () => {
    planner.compile.mockReturnValue([finding()])
    const ledger = new PresentationStableIdLedger()
    const findingKey = 'finding:pre-design:project-brief'
    const pageId = ledger.resolve('page', findingKey)
    const nodeId = ledger.resolve('outlineNode', findingKey)
    const titleId = ledger.resolve('contentBlock', `${findingKey}:block:title`)
    const messageId = ledger.resolve('contentBlock', `${findingKey}:block:key-message`)
    const listId = ledger.resolve('contentBlock', `${findingKey}:block:list`)
    const metricId = ledger.resolve('contentBlock', `${findingKey}:block:metrics`)
    const tableId = ledger.resolve('contentBlock', `${findingKey}:block:table`)
    const build = await buildPresentationStandardProject({ frozenProject: createStandardFrozenProject(), stableIds: ledger.snapshot() })
    const manifest = build.documents['pages/manifest.json'] as any
    expect(manifest.pages[0]).toMatchObject({ pageId, outlineNodeId: nodeId })
    const draft = build.documents[manifest.pages[0].draftPath] as any
    expect(draft.contentBlocks).toHaveLength(11)
    expect(draft.contentBlocks.find((block: any) => block.role === 'page_title').contentBlockId).toBe(titleId)
    expect(draft.contentBlocks.find((block: any) => block.role === 'key_message').contentBlockId).toBe(messageId)
    expect(draft.contentBlocks.find((block: any) => block.type === 'list')).toMatchObject({
      contentBlockId: listId, items: [{ content: '完整调研证据一' }, { content: '完整调研证据二' }],
    })
    expect(draft.contentBlocks.find((block: any) => block.type === 'metric_group')).toMatchObject({
      contentBlockId: metricId, metrics: [{ label: '实际服务人口', value: 1200, unit: '人', note: '实地统计' }],
    })
    expect(draft.contentBlocks.find((block: any) => block.type === 'table')).toMatchObject({ contentBlockId: tableId })
    expect(draft.contentBlocks.filter((block: any) => block.type === 'list')).toHaveLength(2)
    expect(draft.contentBlocks.filter((block: any) => block.type === 'metric_group')).toHaveLength(2)
    expect(draft.contentBlocks.filter((block: any) => block.type === 'table')).toHaveLength(2)
    expect(JSON.stringify(draft.contentBlocks)).toContain('完整分析正文：需要联动东区宿舍与南门交通节点。')
    expect(JSON.stringify(draft.contentBlocks)).toContain('图表建议：服务半径与交通节点叠合图。')
    expect(JSON.stringify(draft.contentBlocks)).not.toContain(createStandardFrozenProject().stateObjects[0]!.summary)
    expect(draft.scriptBlocks[0].content).toContain('待核对项：西区地块权属须由业主确认。')
    const identifiers: string[] = []
    function collectIds(value: any): void {
      if (Array.isArray(value)) return value.forEach(collectIds)
      if (value === null || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value)) {
        if (['contentBlockId', 'listItemId', 'metricId', 'tableRowId', 'tableCellId'].includes(key)) identifiers.push(String(child))
        else collectIds(child)
      }
    }
    collectIds(draft.contentBlocks)
    expect(new Set(identifiers).size).toBe(identifiers.length)
    const validation = await validateDocumentWithAjv('DraftPageDocument', draft)
    expect(validation.valid, JSON.stringify(validation.errors)).toBe(true)

    planner.compile.mockReturnValue([finding({ title: '更新后的汇报标题', keyMessage: '更新后的核心判断。' })])
    const repeated = await buildPresentationStandardProject({ frozenProject: createStandardFrozenProject(), stableIds: build.stableIds })
    expect(repeated.stableIds).toEqual(build.stableIds)
  })

  it('assigns unique sibling order and global page order across multiple report subjects', async () => {
    planner.compile.mockReturnValue([
      finding({ findingId: 'detail-b', sectionKey: 'conditions', sectionTitle: '实施条件' }),
      finding(),
      finding({ findingId: 'detail-a' }),
    ])
    const build = await buildPresentationStandardProject({ frozenProject: createStandardFrozenProject() })
    const outline = build.documents['outline.json'] as any
    const manifest = build.documents['pages/manifest.json'] as any
    const parents = new Map(outline.nodes.map((node: any) => [node.outlineNodeId, node.parentOutlineNodeId]))
    expect(manifest.pages.map((page: any) => page.order)).toEqual([0, 1, 2])
    for (const page of manifest.pages) {
      const subjectId = parents.get(page.outlineNodeId)
      const chapterId = parents.get(subjectId)
      expect(parents.get(chapterId)).toBeNull()
    }
    for (const parentId of new Set(outline.nodes.map((node: any) => node.parentOutlineNodeId))) {
      const siblings = outline.nodes.filter((node: any) => node.parentOutlineNodeId === parentId)
      expect(new Set(siblings.map((node: any) => node.order)).size).toBe(siblings.length)
    }
  })
})
