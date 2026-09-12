import { describe, expect, it } from 'vitest'
import { ResearchRegistry } from '../src/research/registry.ts'
import { validateWorkflowEvidence } from '../src/research/evidence-validator.ts'
import type { EvidenceRecord } from '../src/research/types.ts'

const researchRoot = new URL('../research/v2.0.1/', import.meta.url)
const NOW = '2026-09-12T00:00:00.000Z'

function evidence(overrides: Partial<EvidenceRecord> & Pick<EvidenceRecord, 'evidenceId' | 'sourceId' | 'sourceType' | 'sourceUri' | 'workflowId' | 'dataPointId'>): EvidenceRecord {
  return {
    evidenceId: overrides.evidenceId,
    workflowId: overrides.workflowId,
    dataPointId: overrides.dataPointId,
    sourceId: overrides.sourceId,
    sourceType: overrides.sourceType,
    sourceUri: overrides.sourceUri,
    sourceTitle: overrides.sourceTitle ?? overrides.sourceId,
    publisher: overrides.publisher ?? overrides.sourceId,
    publishedAt: overrides.publishedAt ?? null,
    capturedAt: overrides.capturedAt ?? NOW,
    asOf: overrides.asOf ?? NOW,
    locator: overrides.locator ?? { section: 'test' },
    rawValue: overrides.rawValue ?? 'raw',
    normalizedValue: overrides.normalizedValue ?? 'normalized',
    unit: overrides.unit ?? null,
    contentHash: overrides.contentHash ?? 'a'.repeat(64),
    reliability: overrides.reliability ?? 'A',
    claimClass: overrides.claimClass ?? 'fact',
    notes: overrides.notes ?? 'test evidence',
  }
}

describe('Pre 2.0.1 independent workflow evidence validator', () => {
  it('passes a high-risk statutory workflow only when every required data point has fresh authoritative evidence', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const records: EvidenceRecord[] = [
      evidence({ evidenceId: 'policy', workflowId: 'preplan.wf.02.01', dataPointId: 'applicable-policies', sourceId: 'cn-gov-policy', sourceType: 'web_page', sourceUri: 'https://www.gov.cn/zhengce/' }),
      evidence({ evidenceId: 'planning', workflowId: 'preplan.wf.02.01', dataPointId: 'statutory-planning', sourceId: 'cn-mnr', sourceType: 'web_page', sourceUri: 'https://www.mnr.gov.cn/' }),
      evidence({ evidenceId: 'boundary', workflowId: 'preplan.wf.02.01', dataPointId: 'land-boundary-conditions', sourceId: 'workspace-project-files', sourceType: 'workspace_file', sourceUri: '/workspace/redline.geojson' }),
      evidence({ evidenceId: 'standard', workflowId: 'preplan.wf.02.01', dataPointId: 'applicable-standards', sourceId: 'cn-standards', sourceType: 'web_page', sourceUri: 'https://std.samr.gov.cn/' }),
    ]

    const result = validateWorkflowEvidence(registry, 'preplan.wf.02.01', records, NOW)
    expect(result.valid).toBe(true)
    expect(result.coverage).toBe(1)
    expect(result.highAuthorityCount).toBeGreaterThanOrEqual(1)
    expect(result.independentSourceCount).toBeGreaterThanOrEqual(2)
    expect(result.gradeACount).toBeGreaterThanOrEqual(1)
  })

  it('fails closed when a required data point has no evidence', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const records: EvidenceRecord[] = [
      evidence({ evidenceId: 'policy', workflowId: 'preplan.wf.02.01', dataPointId: 'applicable-policies', sourceId: 'cn-gov-policy', sourceType: 'web_page', sourceUri: 'https://www.gov.cn/zhengce/' }),
    ]
    const result = validateWorkflowEvidence(registry, 'preplan.wf.02.01', records, NOW)
    expect(result.valid).toBe(false)
    expect(result.missingDataPointIds).toEqual(expect.arrayContaining([
      'statutory-planning', 'land-boundary-conditions', 'applicable-standards',
    ]))
  })

  it('rejects stale evidence according to the source freshness policy', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const stale = evidence({
      evidenceId: 'policy-old', workflowId: 'preplan.wf.02.01', dataPointId: 'applicable-policies',
      sourceId: 'cn-gov-policy', sourceType: 'web_page', sourceUri: 'https://www.gov.cn/zhengce/',
      capturedAt: '2026-07-01T00:00:00.000Z',
    })
    const result = validateWorkflowEvidence(registry, 'preplan.wf.02.01', [stale], NOW)
    expect(result.valid).toBe(false)
    expect(result.staleEvidenceIds).toContain('policy-old')
  })

  it('rejects evidence whose source does not support the required data kind', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const invalid = evidence({
      evidenceId: 'fake-cost', workflowId: 'preplan.wf.08.02', dataPointId: 'unit-rates',
      sourceId: 'dsh-user-statement', sourceType: 'manual_import', sourceUri: 'dsh://session/message/1',
      reliability: 'C', claimClass: 'user_statement', normalizedValue: 5200, unit: 'CNY/m2',
    })
    const result = validateWorkflowEvidence(registry, 'preplan.wf.08.02', [invalid], NOW)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('does not support data kind')
  })
})
