import { describe, expect, it } from 'vitest'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { planClientPages } from '../src/report/page-plan.ts'
import type { ClientReport } from '../src/report/client-types.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const BASE = createClientReportBundle(REPORT_INPUT, CLIENT_PROFILE).report

describe('report analytical evidence policy', () => {
  it('does not fabricate audience/daypart levels when an operation evidence block has no evidence assets', () => {
    const operation = BASE.chapters.find(chapter => chapter.role === 'operation')
    expect(operation).toBeDefined()
    const report: ClientReport = {
      ...BASE,
      products: [],
      chapters: BASE.chapters.map(chapter => chapter.id !== operation!.id
        ? chapter
        : {
            ...chapter,
            claim: '运营需求关系仍待真实客流、访谈与时段数据验证',
            blocks: [{
              type: 'evidence' as const,
              headline: '运营需求证据缺口',
              evidenceIds: [],
              assetIds: [],
            }],
          }),
    }

    const pages = planClientPages(report, 'pptx').pages.filter(page => page.chapterId === operation!.id)
    const serialized = JSON.stringify(pages)

    expect(pages.some(page => page.analyticalVisual?.kind === 'daypart-matrix')).toBe(false)
    expect(serialized).not.toContain('社区居民')
    expect(serialized).not.toContain('城市家庭')
    expect(serialized).not.toContain('青年客群')
    expect(serialized).not.toContain('"高"')
    expect(serialized).not.toContain('"中"')
    expect(serialized).not.toContain('"低"')
  })
})
