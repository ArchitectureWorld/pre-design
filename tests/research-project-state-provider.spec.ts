import { describe, expect, it } from 'vitest'
import { ProjectStateResearchProvider } from '../src/research/project-state-provider.ts'
import { ResearchRegistry } from '../src/research/registry.ts'

const researchRoot = new URL('../research/v2.0.1/', import.meta.url)

describe('Pre 2.0.1 Project State research provider', () => {
  it('extracts an exact field from a confirmed upstream state object with revision provenance', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const provider = new ProjectStateResearchProvider({
      projectId: 'project-1',
      stateObjects: [{
        projectId: 'project-1', objectId: 'BL08', revision: 12,
        value: {
          issues: [{ id: 'issue-1', summary: '站前空间高峰拥堵' }],
          baseline: '现状高峰拥堵明显',
          reference_standard: '现行规范',
          gap_value: '待核定',
          location: '站前广场',
          affected_groups: ['旅客'],
          severity: 'high',
          evidence_refs: ['ev-upstream-1'],
          confidence: 0.9,
          status: 'confirmed',
        },
        updatedAt: '2026-09-14T06:00:00.000Z',
      }],
      clock: () => new Date('2026-09-14T06:10:00.000Z'),
    })

    const result = await provider.readProjectState(registry.source('project-state-store'), {
      mode: 'project_state', workflowId: 'preplan.wf.03.01', dataPointId: 'issues',
      locator: 'BL08', selector: { type: 'json_pointer', pointer: '/issues' },
    })

    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      workflowId: 'preplan.wf.03.01', dataPointId: 'issues', sourceId: 'project-state-store',
      sourceType: 'project_state', sourceUri: 'state://project-1/BL08?revision=12',
      normalizedValue: [{ id: 'issue-1', summary: '站前空间高峰拥堵' }],
      reliability: 'A', claimClass: 'source_conclusion',
      locator: { objectId: 'BL08', revision: 12, selectorType: 'json_pointer', jsonPointer: '/issues' },
    })
    expect(registry.validateEvidenceRecord(result.records[0])).toEqual({ valid: true, errors: [] })
  })
})
