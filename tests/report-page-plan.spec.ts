import { describe, expect, it } from 'vitest'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { planClientPages, validateClientPagePlan } from '../src/report/page-plan.ts'
import type { ClientReport, ClientVisualRole } from '../src/report/client-types.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const CLIENT_REPORT = createClientReportBundle(REPORT_INPUT, CLIENT_PROFILE).report

function reportWithProfessionalEvidence(): ClientReport {
  const roles = ['map', 'diagram', 'chart'] as const satisfies readonly ClientVisualRole[]
  const professionalAssets = roles.map((role, index) => ({
    ...CLIENT_REPORT.assets[0]!,
    assetId: `professional-${role}`,
    role,
    chapterId: CLIENT_REPORT.chapters[index]!.id,
    caption: `${role} professional evidence`,
  }))
  return {
    ...CLIENT_REPORT,
    assets: [...CLIENT_REPORT.assets, ...professionalAssets],
    chapters: CLIENT_REPORT.chapters.map((chapter, index) => index >= roles.length
      ? chapter
      : {
          ...chapter,
          blocks: chapter.blocks.map((block, blockIndex) => blockIndex === 0
            ? {
                type: 'evidence' as const,
                headline: `${roles[index]} evidence headline`,
                evidenceIds: block.type === 'narrative' ? block.evidenceIds : [],
                assetIds: [professionalAssets[index]!.assetId],
              }
            : block),
        }),
  }
}

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

  it('promotes maps, diagrams, and charts into role-aware visual evidence pages', () => {
    const plan = planClientPages(reportWithProfessionalEvidence(), 'pptx')
    const visualPages = plan.pages.filter(page => page.kind === 'visual-evidence')

    expect(visualPages.map(page => page.visualRole)).toEqual(['map', 'diagram', 'chart'])
    expect(visualPages.map(page => page.layoutVariant)).toEqual(['editorial', 'editorial', 'editorial'])
    expect(visualPages.every(page => page.primaryFocus.type === 'asset')).toBe(true)
    expect(validateClientPagePlan(plan)).toEqual([])
  })
})
