import { describe, expect, it } from 'vitest'
import {
  buildPresentationProjection,
  DEFAULT_PRESENTATION_TOPICS,
  type ProjectionIdFactory,
  type PresentationProjectionInput,
} from '../src/presentation/projector/index.ts'

function deterministicIds(): ProjectionIdFactory {
  const counters = new Map<string, number>()
  return {
    create(kind) {
      const next = (counters.get(kind) ?? 0) + 1
      counters.set(kind, next)
      return `${kind}_${next}`
    },
  }
}

function projectionInput(): PresentationProjectionInput {
  return {
    preDesignProjectId: 'preplan-project-1',
    presentationProjectId: 'presentation-project-1',
    preDesignRevision: 42,
    additionalTopics: [
      {
        key: 'project_specific_culture',
        title: '文化遗产策略',
        order: 45,
      },
    ],
    findings: [
      {
        findingId: 'finding-positioning',
        topicKey: 'positioning',
        order: 20,
        title: '项目定位必须从资源罗列转向城市产品',
        keyMessage: '项目应形成可使用、可运营、可传播的复合城市产品。',
        contentNature: 'recommendation',
        objectIds: ['PS07', 'OP03'],
        evidenceIds: ['evidence-positioning-1'],
        supportingBlocks: [
          {
            type: 'text',
            content: '定位同时服务公共价值和长期运营。',
            contentNature: 'professional_judgement',
          },
        ],
        speakerNotes: ['先解释定位不是口号，再说明三个价值维度。'],
        assetIds: ['asset-positioning-1'],
      },
      {
        findingId: 'finding-diagnosis',
        topicKey: 'diagnosis',
        order: 10,
        title: '现有资源尚未形成连续体验',
        keyMessage: '空间、活动与运营资源目前相互割裂。',
        contentNature: 'professional_judgement',
        objectIds: ['DG05', 'DG06'],
        evidenceIds: ['evidence-031', 'evidence-032'],
        supportingBlocks: [
          {
            type: 'heading',
            role: 'section_title',
            content: '主要表现',
          },
          {
            type: 'text',
            content: '核心公共空间之间缺少清晰的连续关系。',
            contentNature: 'fact',
          },
          {
            type: 'list',
            listStyle: 'unordered',
            items: ['空间节点孤立', '活动时段单一', '运营主体分散'],
          },
          {
            type: 'metric_group',
            metrics: [
              { label: '连续开放空间', value: 3.2, unit: 'km', note: '待现场复核' },
              { label: '主要断点', value: 4, unit: '处' },
            ],
          },
          {
            type: 'table',
            columns: ['问题', '影响'],
            rows: [
              ['空间断点', '降低步行连续性'],
              ['活动断点', '难以形成全天体验'],
            ],
          },
        ],
        speakerNotes: [
          '先讲空间断点。',
          '再说明断点如何影响活动和运营。',
        ],
        assetIds: ['asset-map-1', 'asset-photo-1'],
      },
      {
        findingId: 'finding-culture',
        topicKey: 'project_specific_culture',
        order: 30,
        title: '文化资源需要转化为可参与内容',
        keyMessage: '文化价值只有进入日常活动和空间体验后才会被持续感知。',
        contentNature: 'recommendation',
        objectIds: ['OP09'],
        evidenceIds: [],
        supportingBlocks: [],
        speakerNotes: [],
        assetIds: [],
      },
      {
        findingId: 'excluded-draft',
        topicKey: 'delivery_model',
        order: 40,
        title: '尚未达到准入条件',
        keyMessage: '该内容不应进入正式投影。',
        contentNature: 'assumption',
        objectIds: ['IM01'],
        evidenceIds: [],
        supportingBlocks: [],
        include: false,
      },
    ],
  }
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys)
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)])
}

describe('Contract-neutral Presentation projection', () => {
  it('freezes the eight default narrative topics without forcing empty sections', () => {
    expect(DEFAULT_PRESENTATION_TOPICS.map(topic => topic.title)).toEqual([
      '项目认知与任务',
      '现状与核心问题',
      '发展机会',
      '项目定位与目标',
      '产品与功能体系',
      '空间策略',
      '运营、投资与实施',
      '决策事项与下一步',
    ])

    const result = buildPresentationProjection(projectionInput(), deterministicIds())
    expect(result.sections.map(section => section.topicKey)).toEqual([
      'diagnosis',
      'positioning',
      'project_specific_culture',
    ])
    expect(result.sections.some(section => section.topicKey === 'delivery_model')).toBe(false)
  })

  it('aggregates multiple professional objects into one single-conclusion page', () => {
    const result = buildPresentationProjection(projectionInput(), deterministicIds())
    const diagnosis = result.pages.find(page => page.findingId === 'finding-diagnosis')
    if (diagnosis === undefined) throw new Error('diagnosis page missing')

    expect(diagnosis.projectId).toBe('presentation-project-1')
    expect(diagnosis.sourceRefs).toEqual([
      {
        provider: 'pre-design',
        sourceProjectId: 'preplan-project-1',
        sourceRevision: 42,
        objectIds: ['DG05', 'DG06'],
        evidenceIds: ['evidence-031', 'evidence-032'],
      },
    ])
    expect(diagnosis.contentBlocks.filter(block => block.type === 'heading' && block.role === 'page_title'))
      .toHaveLength(1)
    expect(diagnosis.contentBlocks.filter(block => block.type === 'text' && block.role === 'key_message'))
      .toHaveLength(1)
    expect(diagnosis.contentBlocks.map(block => block.type)).toEqual([
      'heading',
      'text',
      'heading',
      'text',
      'list',
      'metric_group',
      'table',
    ])
    expect(diagnosis.scriptBlocks).toHaveLength(2)
    expect(diagnosis.pageAssets.map(asset => asset.assetId)).toEqual([
      'asset-map-1',
      'asset-photo-1',
    ])
  })

  it('generates stable nested identities through the injected ID factory', () => {
    const first = buildPresentationProjection(projectionInput(), deterministicIds())
    const second = buildPresentationProjection(projectionInput(), deterministicIds())
    expect(second).toEqual(first)

    const diagnosis = first.pages.find(page => page.findingId === 'finding-diagnosis')!
    const list = diagnosis.contentBlocks.find(block => block.type === 'list')
    const metrics = diagnosis.contentBlocks.find(block => block.type === 'metric_group')
    const table = diagnosis.contentBlocks.find(block => block.type === 'table')
    if (list?.type !== 'list' || metrics?.type !== 'metric_group' || table?.type !== 'table') {
      throw new Error('expected structured content blocks')
    }
    expect(list.items.every(item => item.listItemId.startsWith('list-item_'))).toBe(true)
    expect(metrics.metrics.every(metric => metric.metricId.startsWith('metric_'))).toBe(true)
    expect(table.columns.every(column => column.tableColumnId.startsWith('table-column_'))).toBe(true)
    expect(table.rows.every(row => row.tableRowId.startsWith('table-row_'))).toBe(true)
    expect(table.rows.flatMap(row => row.cells)
      .every(cell => cell.tableCellId.startsWith('table-cell_'))).toBe(true)
  })

  it('keeps the projection free of layout and rendering fields', () => {
    const keys = new Set(allKeys(buildPresentationProjection(projectionInput(), deterministicIds())))
    for (const forbidden of [
      'font', 'fontSize', 'fontWeight', 'color', 'x', 'y', 'w', 'h',
      'rotation', 'template', 'layout', 'css', 'master',
    ]) {
      expect(keys.has(forbidden), forbidden).toBe(false)
    }
  })

  it('rejects unknown topics, duplicate findings and empty key messages', () => {
    const base = projectionInput()
    expect(() => buildPresentationProjection({
      ...base,
      findings: [{ ...base.findings[0]!, topicKey: 'unknown-topic' }],
    }, deterministicIds())).toThrow('PRESENTATION_PROJECTION_TOPIC_UNKNOWN')

    expect(() => buildPresentationProjection({
      ...base,
      findings: [base.findings[0]!, { ...base.findings[0]! }],
    }, deterministicIds())).toThrow('PRESENTATION_PROJECTION_FINDING_DUPLICATE')

    expect(() => buildPresentationProjection({
      ...base,
      findings: [{ ...base.findings[0]!, keyMessage: '   ' }],
    }, deterministicIds())).toThrow('PRESENTATION_PROJECTION_KEY_MESSAGE_REQUIRED')
  })
})
