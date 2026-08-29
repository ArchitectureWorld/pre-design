import { describe, expect, it } from 'vitest'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { planClientPages } from '../src/report/page-plan.ts'
import { createClientTheme, DEFAULT_CLIENT_THEME } from '../src/report/theme.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const CLIENT_REPORT = createClientReportBundle(REPORT_INPUT, CLIENT_PROFILE).report

describe('replaceable client project profile', () => {
  it('plans a second project without project-specific renderer logic', () => {
    const report = {
      ...CLIENT_REPORT,
      identity: {
        ...CLIENT_REPORT.identity,
        projectName: '社区生活服务中心',
        reportTitle: '社区生活服务中心更新提案',
      },
      proposition: {
        ...CLIENT_REPORT.proposition,
        projectDefinition: '面向完整社区服务提升的公共项目',
      },
    }

    const plan = planClientPages(report, 'pptx')

    expect(plan.pages[0]?.headline).toBe('社区生活服务中心更新提案')
    expect(JSON.stringify(plan)).not.toMatch(/鄂州|明塘|洋澜湖/u)
  })

  it('overrides one project color without changing shared typography and geometry', () => {
    const theme = createClientTheme({ colors: { primary: '123456' } })

    expect(theme.tokens.colors.primary).toBe('123456')
    expect(theme.tokens.colors.background).toBe(DEFAULT_CLIENT_THEME.tokens.colors.background)
    expect(theme.tokens.fonts).toEqual(DEFAULT_CLIENT_THEME.tokens.fonts)
    expect(theme.tokens.grid).toEqual(DEFAULT_CLIENT_THEME.tokens.grid)
    expect(theme.tokens.motion).toEqual(DEFAULT_CLIENT_THEME.tokens.motion)
    expect(Object.isFrozen(theme.tokens.colors)).toBe(true)
  })
})
