import { describe, expect, it } from 'vitest'
import { createConditionalReportBundle, planConditionalPages, conditionalReportDetails } from '../src/report/conditional-report.ts'
import { assertPublishableClientReportBundle } from '../src/report/client-projection.ts'
import { assertClientReportPolicy } from '../src/report/client-policy.ts'
import { assertClientPagePlan } from '../src/report/page-plan.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'

export const conditionalInput: FrozenProjectInput = {
  projectId: 'project', projectName: '少潭河', revision: 103, generatedAt: '2026-09-17T10:00:00Z',
  recommendation: '未作最终审核', decisionItems: [], gates: [], visualAssets: [], siteBoundary: { status: 'not_provided' },
  stateObjects: [{ objectId: 'PS01', chapterId: '01', workItemId: '01-01', title: '项目任务',
    summary: '文旅休闲开发', facts: [], reportSections: [{ key: 'scope', title: '研究范围', entries: [
      { key: 'unknown', text: '法定边界未知；投资条件待核。', basis: '项目资料不足，保留未知', fieldPath: '/data/scope' },
    ] }] }],
}

describe('conditional planning report projection', () => {
  it('moves repetitive original text to the appendix while keeping the client body short', () => {
    const summary = '逐行条件\n'.repeat(80)
    const bundle = createConditionalReportBundle({ ...conditionalInput, stateObjects: [{ ...conditionalInput.stateObjects[0]!, summary, reportSections: [] }] })
    const text = bundle.report.chapters[1]!.blocks.map(block => block.type === 'narrative' ? block.statement : '')
    expect(conditionalReportDetails(bundle.report)[0]!.entries[0]).toBe(summary)
    expect(text.join('').length).toBeLessThan(summary.length)
    expect(text.every(page => page.split('\n').length <= 14)).toBe(true)
  })
  it('retains frozen content and missing conditions without inventing boundary or default-profile products', () => {
    const bundle = createConditionalReportBundle(conditionalInput)
    expect(bundle.publishable).toBe(false)
    expect(bundle.kind).toBe('conditional')
    expect(JSON.stringify(bundle.report)).toContain('条件式策划成果')
    expect(JSON.stringify(bundle.report)).toContain('法定边界未知；投资条件待核。')
    expect(bundle.report.products).toEqual([])
    expect(bundle.report.assets).toEqual([])
    expect(bundle.identity.siteBoundaryId).toBeUndefined()
    expect(() => assertPublishableClientReportBundle(bundle)).toThrow()
    expect(Object.isFrozen(bundle.report.chapters)).toBe(true)
  })

  it('allows controlled conditional layouts in all formats while keeping formal requirements', () => {
    const bundle = createConditionalReportBundle(conditionalInput)
    expect(() => assertClientReportPolicy(bundle.report)).not.toThrow()
    for (const medium of ['html', 'pptx', 'pdf'] as const) {
      const plan = planConditionalPages(bundle, medium)
      expect(() => assertClientPagePlan(plan, bundle.report)).not.toThrow()
      expect(plan.pages.length).toBeGreaterThan(1)
      expect(() => assertClientPagePlan({ ...plan, pages: [{ ...plan.pages[1]!, chapterId: 'absent' }] }, bundle.report)).toThrow()
    }
    expect(() => assertClientReportPolicy(structuredClone(bundle.report))).toThrow()
  })

  it('retains long source clauses in the appendix without turning the body into a transcript', () => {
    const text = '内容与条件。'.repeat(150) + '结尾必须保留'
    const input = { ...conditionalInput, stateObjects: [{ ...conditionalInput.stateObjects[0]!,
      reportSections: [{ key: 'long', title: '长内容', entries: [{ key: 'long', text, basis: '资料依据', fieldPath: '/data/long' }] }],
    }] }
    const bundle = createConditionalReportBundle(input)
    const blocks = bundle.report.chapters.flatMap(row => row.blocks)
    expect(conditionalReportDetails(bundle.report).flatMap(row => row.entries).join('')).toContain(text)
    expect(blocks.every(block => block.type !== 'narrative' || block.statement.length <= 420)).toBe(true)
  })
})
