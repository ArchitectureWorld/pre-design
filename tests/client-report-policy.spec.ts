import { describe, expect, it } from 'vitest'
import { assertClientReportPolicy, validateClientReportPolicy } from '../src/report/client-policy.ts'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const CLIENT_REPORT = createClientReportBundle(REPORT_INPUT, CLIENT_PROFILE).report

describe('client report policy', () => {
  it('accepts the complete client fixture', () => {
    expect(validateClientReportPolicy(CLIENT_REPORT)).toEqual([])
  })

  it('reports the exact client path for internal governance vocabulary', () => {
    const report = {
      ...CLIENT_REPORT,
      chapters: CLIENT_REPORT.chapters.map((chapter, index) =>
        index === 0 ? { ...chapter, claim: 'Gate G1 已通过 Revision 57' } : chapter),
    }

    expect(validateClientReportPolicy(report)).toContainEqual({
      code: 'CLIENT_FORBIDDEN_TERM',
      path: 'chapters[0].claim',
      message: expect.stringMatching(/Gate/u),
    })
  })

  it('rejects unsupported evidence and undisclosed AI assets', () => {
    const report = {
      ...CLIENT_REPORT,
      evidence: CLIENT_REPORT.evidence.map((evidence, index) =>
        index === 0 ? { ...evidence, sourceLabel: '' } : evidence),
      assets: CLIENT_REPORT.assets.map((asset, index) =>
        index === 0 ? { ...asset, disclosure: undefined } : asset),
    }

    expect(() => assertClientReportPolicy(report)).toThrow(
      /EVIDENCE_SOURCE_MISSING[\s\S]*AI_DISCLOSURE_MISSING/u,
    )
  })
})
