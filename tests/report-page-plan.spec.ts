import { describe, expect, it } from 'vitest'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { planClientPages, validateClientPagePlan } from '../src/report/page-plan.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const CLIENT_REPORT = createClientReportBundle(REPORT_INPUT, CLIENT_PROFILE).report

describe('planClientPages', () => {
  it('creates the three-step opening and a 32-48 slide PPTX plan', () => {
    const plan = planClientPages(CLIENT_REPORT, 'pptx')

    expect(plan.pages.slice(0, 4).map(page => page.kind)).toEqual([
      'cover', 'opening-claim', 'opening-claim', 'opening-claim',
    ])
    expect(plan.pages).toHaveLength(36)
    expect(plan.layoutContract).toEqual({
      safeMarginRatio: 0.06,
      minimumTitle: 24,
      minimumBody: 14,
      minimumCaption: 10,
    })
    const bodyKinds = plan.pages.slice(4).map(page => page.kind)
    expect(bodyKinds.some((kind, index) =>
      index >= 2 && kind === bodyKinds[index - 1] && kind === bodyKinds[index - 2])).toBe(false)
    expect(validateClientPagePlan(plan)).toEqual([])
  })

  it('adds evidence appendix pages to a 48-72 page PDF plan', () => {
    const plan = planClientPages(CLIENT_REPORT, 'pdf')

    expect(plan.pages).toHaveLength(48)
    expect(plan.pages.filter(page => page.kind === 'appendix')).toHaveLength(12)
    expect(validateClientPagePlan(plan)).toEqual([])
  })
})
