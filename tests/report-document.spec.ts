import { describe, expect, it } from 'vitest'
import { buildReportDocument, EXPECTED_REPORT_SECTIONS } from '../src/report/build-document.ts'
import { REPORT_INPUT } from './report-fixture.ts'

describe('buildReportDocument', () => {
  it('builds 17 client-facing sections from one frozen revision without debug vocabulary', () => {
    const document = buildReportDocument(REPORT_INPUT)

    expect(document.sections.map(section => section.id)).toEqual(EXPECTED_REPORT_SECTIONS)
    expect(document.meta.sourceRevision).toBe(57)
    expect(document.meta.projectName).toBe('滨江文化活力区前期策划')
    expect(JSON.stringify(document)).not.toMatch(/debug|raw json|tool call/iu)
    expect(document.sections[0]).toMatchObject({
      id: 'executive-decision', title: '核心结论与需甲方决策事项',
    })
    expect(document.sections.flatMap(section => section.nodes).some(node => node.type === 'decision')).toBe(true)
    expect(document.sections.flatMap(section => section.nodes).filter(node => node.type === 'chart')).toHaveLength(17)
    expect(document.meta).toMatchObject({
      recommendationId: 'recommendation-r57-cultural-riverfront',
      adoptedAssetIds: ['concept-1'],
    })
  })
})
