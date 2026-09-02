import { describe, expect, it } from 'vitest'
import type { FrozenProjectInput, FrozenStateObject } from '../src/report/types.ts'
import { adaptFrozenProjectToPresentationFindings } from '../src/presentation/projector/frozen-project-adapter.ts'

const OBJECT_FAMILIES = [
  ['PS', '01', 7],
  ['BL', '02', 8],
  ['DG', '03', 6],
  ['OB', '04', 6],
  ['OP', '05', 7],
  ['PG', '06', 7],
  ['SP', '07', 8],
  ['IM', '08', 8],
] as const

function stateObjects(): FrozenStateObject[] {
  return OBJECT_FAMILIES.flatMap(([prefix, chapterId, count]) =>
    Array.from({ length: count }, (_, index) => {
      const sequence = String(index + 1).padStart(2, '0')
      const objectId = `${prefix}${sequence}`
      return {
        objectId,
        chapterId,
        workItemId: `${chapterId}-${sequence}`,
        title: `${objectId} 专业成果`,
        summary: `${objectId} 已形成可追溯的专业判断`,
        facts: [
          { label: '核心要点', value: `${objectId} 要点`, basis: '项目冻结资料' },
        ],
      }
    }),
  )
}

function input(overrides: Partial<FrozenProjectInput> = {}): FrozenProjectInput {
  return {
    projectId: 'preplan-project-1',
    projectName: '示例前期策划项目',
    revision: 42,
    generatedAt: '2026-09-02T12:00:00.000Z',
    recommendation: '形成完整汇报叙事。',
    decisionItems: ['确认项目定位', '确认首期边界'],
    stateObjects: stateObjects(),
    gates: [],
    visualAssets: [
      {
        assetId: 'asset-program',
        chapterId: '06',
        workItemId: '06-04',
        kind: 'deterministic',
        caption: '产品体系图',
        sourcePath: '/tmp/program.svg',
        mimeType: 'image/svg+xml',
      },
      {
        assetId: 'asset-spatial-not-adopted',
        chapterId: '07',
        workItemId: '07-07',
        kind: 'deterministic',
        caption: '空间结构图',
        sourcePath: '/tmp/spatial.svg',
        mimeType: 'image/svg+xml',
      },
    ],
    adoptedAssetIds: ['asset-program'],
    ...overrides,
  }
}

describe('adaptFrozenProjectToPresentationFindings', () => {
  it('consolidates all 57 professional objects into ten narrative findings without losing provenance', () => {
    const findings = adaptFrozenProjectToPresentationFindings(input())

    expect(findings).toHaveLength(10)
    expect(findings.map(finding => finding.topicKey)).toEqual([
      'project_brief',
      'diagnosis',
      'diagnosis',
      'opportunity',
      'positioning',
      'positioning',
      'program_product',
      'spatial_strategy',
      'delivery_model',
      'decision_next_steps',
    ])

    const sourceIds = findings.flatMap(finding => finding.objectIds)
    expect(sourceIds).toHaveLength(57)
    expect(new Set(sourceIds).size).toBe(57)
    expect([...sourceIds].sort()).toEqual(stateObjects().map(object => object.objectId).sort())
    expect(findings.find(finding => finding.findingId === 'pre-design:decision')?.objectIds).toEqual(['IM02'])
    expect(findings.find(finding => finding.findingId === 'pre-design:delivery')?.objectIds).not.toContain('IM02')
  })

  it('is deterministic when the frozen object order changes', () => {
    const forward = adaptFrozenProjectToPresentationFindings(input())
    const reversed = adaptFrozenProjectToPresentationFindings(input({
      stateObjects: [...stateObjects()].reverse(),
    }))

    expect(reversed).toEqual(forward)
  })

  it('uses only adopted matching assets and turns decision items into a semantic list', () => {
    const findings = adaptFrozenProjectToPresentationFindings(input())
    const product = findings.find(finding => finding.findingId === 'pre-design:product')
    const spatial = findings.find(finding => finding.findingId === 'pre-design:spatial')
    const decision = findings.find(finding => finding.findingId === 'pre-design:decision')

    expect(product?.assetIds).toEqual(['asset-program'])
    expect(spatial?.assetIds).toEqual([])
    expect(decision?.supportingBlocks).toContainEqual({
      type: 'list',
      role: 'steps',
      listStyle: 'ordered',
      items: ['确认项目定位', '确认首期边界'],
    })
    expect(JSON.stringify(findings)).not.toMatch(/"(?:x|y|w|h|font|color|layout)"\s*:/u)
  })

  it('omits narrative findings whose professional source group is empty', () => {
    const findings = adaptFrozenProjectToPresentationFindings(input({
      stateObjects: stateObjects().filter(object => object.chapterId === '01'),
      visualAssets: [],
      adoptedAssetIds: [],
    }))

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      findingId: 'pre-design:project-brief',
      topicKey: 'project_brief',
      objectIds: ['PS01', 'PS02', 'PS03', 'PS04', 'PS05', 'PS06', 'PS07'],
    })
  })
})
