import { describe, expect, it } from 'vitest'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

describe('createClientReportBundle', () => {
  it('keeps governance identity outside the client report', () => {
    const bundle = createClientReportBundle(REPORT_INPUT, CLIENT_PROFILE)

    expect(bundle.report.identity.projectName).toBe('滨江文化活力区前期策划')
    expect(bundle.report.chapters.map(chapter => chapter.role)).toEqual([
      'brief', 'diagnosis', 'opportunity', 'positioning', 'strategy',
      'product', 'spatial', 'operation', 'implementation', 'decision',
    ])
    expect(JSON.stringify(bundle.report)).not.toMatch(/Gate|Revision|Workflow|R57/iu)
    expect(bundle.identity).toEqual({
      projectId: 'golden-project',
      sourceRevision: 57,
      recommendationId: 'recommendation-r57-cultural-riverfront',
      adoptedAssetIds: ['concept-1'],
    })
    expect(bundle.governanceAppendix.gateDecisions).toHaveLength(8)
  })

  it('rejects a chapter blueprint that cites a missing frozen object', () => {
    const broken = {
      ...CLIENT_PROFILE,
      chapters: CLIENT_PROFILE.chapters.map((chapter, index) =>
        index === 0 ? { ...chapter, sourceObjectIds: ['missing-object'] } : chapter),
    }

    expect(() => createClientReportBundle(REPORT_INPUT, broken))
      .toThrow(/missing frozen object missing-object/u)
  })
})
