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
        projectId: 'project-1', objectId: 'PS01', revision: 3,
        value: { data: { canonical_name: '武汉站改造', project_location: '武汉市' } },
        updatedAt: '2026-09-14T06:00:00.000Z',
      }],
      clock: () => new Date('2026-09-14T06:10:00.000Z'),
    })

    const result = await provider.readProjectState(registry.source('project-state-store'), {
      mode: 'project_state', workflowId: 'preplan.wf.01.02', dataPointId: 'canonical-name',
      locator: 'PS01', selector: { type: 'json_pointer', pointer: '/data/canonical_name' },
    })

    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      workflowId: 'preplan.wf.01.02', dataPointId: 'canonical-name', sourceId: 'project-state-store',
      sourceType: 'project_state', sourceUri: 'state://project-1/PS01?revision=3',
      normalizedValue: '武汉站改造', reliability: 'A', claimClass: 'source_conclusion',
      locator: { objectId: 'PS01', revision: 3, selectorType: 'json_pointer', selector: '/data/canonical_name' },
    })
    expect(registry.validateEvidenceRecord(result.records[0])).toEqual({ valid: true, errors: [] })
  })
})
