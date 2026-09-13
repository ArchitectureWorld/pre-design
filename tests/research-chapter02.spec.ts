import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { ResearchRegistry } from '../src/research/registry.ts'

const researchRoot = new URL('../research/v2.0.1/', import.meta.url)

function sourceIds(registry: ResearchRegistry, workflowId: string): string[] {
  return registry.workflow(workflowId).preferredSources.map(row => row.sourceId)
}

describe('Pre 2.0.1 Chapter 02 traceable research coverage', () => {
  it('maps all eight Chapter 02 workflows as part of the complete 57-workflow research map', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const chapter02 = registry.workflows().filter(row => row.workflowId.startsWith('preplan.wf.02.'))
    expect(chapter02.map(row => row.workflowId)).toEqual([
      'preplan.wf.02.01', 'preplan.wf.02.02', 'preplan.wf.02.03', 'preplan.wf.02.04',
      'preplan.wf.02.05', 'preplan.wf.02.06', 'preplan.wf.02.07', 'preplan.wf.02.08',
    ])
    expect(registry.workflows()).toHaveLength(57)
    for (const spec of chapter02) {
      expect(spec.researchSteps.length, spec.workflowId).toBeGreaterThanOrEqual(6)
      expect(spec.requiredDataPoints.length, spec.workflowId).toBeGreaterThan(0)
      expect(spec.outputClaims.length, spec.workflowId).toBeGreaterThan(0)
      expect(spec.researchSteps.at(-1)?.produces, spec.workflowId).toBe('claims')
    }
  })

  it('uses domain-appropriate official sources instead of one generic web list', async () => {
    const registry = await ResearchRegistry.open(researchRoot)

    expect(sourceIds(registry, 'preplan.wf.02.02')).toEqual(expect.arrayContaining([
      'workspace-project-files', 'cn-mnr', 'cn-gsxt',
    ]))
    expect(sourceIds(registry, 'preplan.wf.02.03')).toEqual(expect.arrayContaining([
      'workspace-project-files', 'cn-cma', 'cn-mee', 'cn-mem',
    ]))
    expect(sourceIds(registry, 'preplan.wf.02.05')).toEqual(expect.arrayContaining([
      'workspace-project-files', 'cn-nbs', 'cn-local-gov-official',
    ]))
    expect(sourceIds(registry, 'preplan.wf.02.06')).toEqual(expect.arrayContaining([
      'workspace-project-files', 'cn-local-gov-official', 'cn-moe', 'cn-nhc',
    ]))
    expect(sourceIds(registry, 'preplan.wf.02.07')).toEqual(expect.arrayContaining([
      'workspace-project-files', 'cn-nbs', 'cn-local-gov-official', 'cn-ndrc', 'cn-miit',
    ]))
    expect(sourceIds(registry, 'preplan.wf.02.08')).toEqual(expect.arrayContaining([
      'workspace-project-files', 'cn-mot', 'cn-mohurd', 'cn-mem',
    ]))
  })

  it('keeps Chapter 02 baseline facts dependent on project/local evidence and never upgrades national context into site facts', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    for (const workflowId of ['preplan.wf.02.02', 'preplan.wf.02.03', 'preplan.wf.02.04', 'preplan.wf.02.08']) {
      const spec = registry.workflow(workflowId)
      expect(spec.preferredSources.find(row => row.sourceId === 'workspace-project-files')?.required, workflowId).toBe(true)
      expect(spec.fallbackPolicy, workflowId).toMatch(/unknown|blocked_external|不得|不能/u)
    }
    expect(registry.workflow('preplan.wf.02.02').minimumEvidence.highRiskRequiresGradeA).toBe(true)
    expect(registry.workflow('preplan.wf.02.08').minimumEvidence.highRiskRequiresGradeA).toBe(true)
  })

  it('publishes an audit status for every newly declared public official source', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const audit = JSON.parse(await readFile(new URL('source-audit-status.json', researchRoot), 'utf8')) as {
      checks: Array<{ sourceId: string; status: string; note: string }>
    }
    const auditById = new Map(audit.checks.map(row => [row.sourceId, row]))
    for (const sourceId of ['cn-mee', 'cn-mem', 'cn-moe', 'cn-nhc', 'cn-mot', 'cn-local-gov-official']) {
      expect(registry.source(sourceId), sourceId).toBeDefined()
      expect(auditById.get(sourceId)?.status, sourceId).toBeTruthy()
      expect(auditById.get(sourceId)?.status, sourceId).not.toBe('not_checked')
    }
  })
})
