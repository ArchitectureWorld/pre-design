import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { ResearchRegistry } from '../src/research/registry.ts'

const researchRoot = new URL('../research/v2.0.1/', import.meta.url)
const chapterCounts: Record<string, number> = {
  '01': 7,
  '02': 8,
  '03': 6,
  '04': 6,
  '05': 7,
  '06': 7,
  '07': 8,
  '08': 8,
}
const handAuthoredIds = new Set([
  'preplan.wf.01.01', 'preplan.wf.01.02', 'preplan.wf.01.03', 'preplan.wf.01.04',
  'preplan.wf.01.05', 'preplan.wf.01.06', 'preplan.wf.01.07', 'preplan.wf.02.01',
  'preplan.wf.08.02',
])

function dataPoint(registry: ResearchRegistry, workflowId: string, dataPointId: string) {
  const spec = registry.workflow(workflowId)
  return [...spec.requiredDataPoints, ...spec.optionalDataPoints].find(row => row.dataPointId === dataPointId)
}

describe('Pre 2.0.1 complete traceable research coverage', () => {
  it('maps all 57 canonical workflows with the exact chapter distribution', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    expect(registry.workflows()).toHaveLength(57)
    for (const [chapter, expected] of Object.entries(chapterCounts)) {
      const rows = registry.workflows().filter(row => row.workflowId.startsWith(`preplan.wf.${chapter}.`))
      expect(rows, `chapter ${chapter}`).toHaveLength(expected)
    }
  })

  it('gives every workflow a complete step-data-source-analysis-claim chain', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const catalogIds = new Set(registry.sources().map(source => source.sourceId))

    for (const spec of registry.workflows()) {
      expect(spec.requiredDataPoints.length, spec.workflowId).toBeGreaterThan(0)
      expect(spec.researchSteps.length, spec.workflowId).toBeGreaterThanOrEqual(6)
      expect(spec.researchSteps.at(-1)?.produces, spec.workflowId).toBe('claims')
      expect(spec.outputClaims.length, spec.workflowId).toBeGreaterThan(0)
      expect(spec.crossCheckRules.length, spec.workflowId).toBeGreaterThan(0)
      expect(spec.freshnessRules.length, spec.workflowId).toBeGreaterThan(0)
      expect(spec.fallbackPolicy.length, spec.workflowId).toBeGreaterThan(0)
      expect(spec.minimumEvidence.minIndependentSources, spec.workflowId).toBeGreaterThanOrEqual(1)

      const preferredIds = new Set(spec.preferredSources.map(row => row.sourceId))
      expect([...preferredIds].some(id => id !== 'llm-inference' && id !== 'dsh-user-statement'), spec.workflowId).toBe(true)
      for (const sourceId of preferredIds) expect(catalogIds.has(sourceId), `${spec.workflowId}:${sourceId}`).toBe(true)
      for (const query of spec.queryTemplates) expect(preferredIds.has(query.sourceId), `${spec.workflowId}:${query.sourceId}`).toBe(true)
      for (const step of spec.researchSteps) {
        for (const sourceId of step.sourceIds) expect(preferredIds.has(sourceId), `${spec.workflowId}:${step.stepId}:${sourceId}`).toBe(true)
      }
    }
  })

  it('preserves upstream Project State provenance for every newly generated downstream workflow', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    for (const spec of registry.workflows()) {
      const chapter = spec.workflowId.split('.')[2]
      if (Number(chapter) < 2 || handAuthoredIds.has(spec.workflowId)) continue
      const stateSource = spec.preferredSources.find(row => row.sourceId === 'project-state-store')
      expect(stateSource, spec.workflowId).toBeDefined()
      expect(spec.researchSteps.some(step => step.action === 'upstream_state_read' && step.sourceIds.includes('project-state-store')), spec.workflowId).toBe(true)
    }
  })

  it('requires deterministic calculation steps whenever a professional-tool source is declared', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    for (const spec of registry.workflows()) {
      if (!spec.preferredSources.some(row => row.sourceId === 'professional-tool-output')) continue
      expect(spec.researchSteps.some(step => step.action === 'deterministic_calculation' && step.sourceIds.includes('professional-tool-output')), spec.workflowId).toBe(true)
    }
  })

  it('keeps automatic mode free of mandatory human approval semantics in all 57 research specs', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const forbidden = /人工(?:确认|审批|审核|复核|澄清|裁决)|needs_human|pending_review/u
    for (const spec of registry.workflows()) expect(JSON.stringify(spec), spec.workflowId).not.toMatch(forbidden)
  })

  it('uses field semantics instead of accidental substring matches when assigning data kinds', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    expect(dataPoint(registry, 'preplan.wf.04.01', 'strategic-role')).toMatchObject({ label: '战略角色', dataKind: 'project_analysis' })
    expect(dataPoint(registry, 'preplan.wf.05.01', 'evaluation-model-version')).toMatchObject({ label: '评价模型版本', dataKind: 'project_analysis' })
    expect(dataPoint(registry, 'preplan.wf.06.01', 'peak-demands')).toMatchObject({ label: '高峰需求', dataKind: 'population' })
    expect(dataPoint(registry, 'preplan.wf.07.01', 'area-balance')).toMatchObject({ label: '面积平衡', dataKind: 'spatial_planning' })
    expect(dataPoint(registry, 'preplan.wf.08.01', 'quantities')).toMatchObject({ label: '工程量', dataKind: 'cost' })
  })

  it('does not classify strategic fit as cost because "rate" appears inside "strategic"', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    expect(dataPoint(registry, 'preplan.wf.03.06', 'strategic-fit')).toMatchObject({ dataKind: 'project_analysis' })
  })

  it('renders explicit reasons for each source choice and each research step in the audit HTML', async () => {
    const html = await readFile(new URL('source-audit.html', researchRoot), 'utf8')
    expect(html).toContain('为什么选择这个来源')
    expect(html).toContain('为什么做这一步')
    expect(html).toContain('为什么这样汇总与分析')
    expect(html).toContain('来源权威性')
    expect(html).toContain('该来源在本 Workflow 中的用途')
  })
})
