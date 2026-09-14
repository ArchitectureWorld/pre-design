import { describe, expect, it } from 'vitest'
import { ResearchExecutionService } from '../src/research/execution-service.ts'
import { ResearchProviderRouter } from '../src/research/router.ts'
import type { ResearchProvider, ResearchProviderResult, ResearchRequest } from '../src/research/provider.ts'
import { ResearchRegistry } from '../src/research/registry.ts'
import type { DataSourceDefinition, EvidenceRecord } from '../src/research/types.ts'

const researchRoot = new URL('../research/v2.0.1/', import.meta.url)

function record(source: DataSourceDefinition, request: ResearchRequest): EvidenceRecord {
  return {
    evidenceId: `ev-${request.dataPointId}`,
    workflowId: request.workflowId,
    dataPointId: request.dataPointId,
    sourceId: source.sourceId,
    sourceType: request.mode,
    sourceUri: `file:///workspace/${request.dataPointId}.json`,
    sourceTitle: `${request.dataPointId}.json`,
    publisher: source.publisher,
    publishedAt: null,
    capturedAt: '2026-09-14T04:30:00.000Z',
    asOf: null,
    locator: { relativePath: `${request.dataPointId}.json` },
    rawValue: request.dataPointId,
    normalizedValue: request.dataPointId,
    unit: null,
    contentHash: 'a'.repeat(64),
    reliability: source.reliabilityGrade,
    claimClass: 'fact',
  }
}

const provider: ResearchProvider = {
  providerId: 'test-workspace-provider',
  accessModes: ['workspace_file'],
  async fetch(source: DataSourceDefinition, request: ResearchRequest): Promise<ResearchProviderResult> {
    return { records: [record(source, request)] }
  },
}

function acquisition(dataPointId: string) {
  return {
    sourceId: 'workspace-project-files',
    request: {
      mode: 'workspace_file' as const,
      locator: `inputs/${dataPointId}.json`,
      workflowId: 'preplan.wf.01.01',
      dataPointId,
    },
  }
}

describe('Pre 2.0.1 research execution service', () => {
  it('routes acquisitions, validates every EvidenceRecord, and independently passes complete workflow evidence', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const service = new ResearchExecutionService(registry, new ResearchProviderRouter([provider]))

    const result = await service.execute('preplan.wf.01.01', [
      acquisition('canonical-name'), acquisition('project-location'), acquisition('project-trigger'),
    ], '2026-09-14T05:00:00.000Z')

    expect(result.records).toHaveLength(3)
    expect(result.validation.valid).toBe(true)
    expect(result.validation.coverage).toBe(1)
    expect(result.validation.missingDataPointIds).toEqual([])
  })

  it('fails closed when a required DataPoint has no independently validated evidence', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const service = new ResearchExecutionService(registry, new ResearchProviderRouter([provider]))

    const result = await service.execute('preplan.wf.01.01', [
      acquisition('canonical-name'), acquisition('project-location'),
    ], '2026-09-14T05:00:00.000Z')

    expect(result.validation.valid).toBe(false)
    expect(result.validation.missingDataPointIds).toContain('project-trigger')
  })

  it('rejects provider output whose workflow/data-point identity does not match the acquisition', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const badProvider: ResearchProvider = {
      providerId: 'bad-provider', accessModes: ['workspace_file'],
      async fetch(source, request) {
        return { records: [{ ...record(source, request), dataPointId: 'project-trigger' }] }
      },
    }
    const service = new ResearchExecutionService(registry, new ResearchProviderRouter([badProvider]))

    await expect(service.execute('preplan.wf.01.01', [acquisition('canonical-name')], '2026-09-14T05:00:00.000Z'))
      .rejects.toThrow(/identity mismatch/u)
  })
})
