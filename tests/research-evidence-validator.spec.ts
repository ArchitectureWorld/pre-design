import { describe, expect, it } from 'vitest'
import { validateWorkflowEvidence } from '../src/research/evidence-validator.ts'
import { ResearchRegistry } from '../src/research/registry.ts'
import type { EvidenceRecord } from '../src/research/types.ts'

const researchRoot = new URL('../research/v2.0.1/', import.meta.url)
const NOW = '2026-09-12T12:00:00.000Z'

function evidence(overrides: Partial<EvidenceRecord>): EvidenceRecord {
  return {
    evidenceId: 'evidence-1',
    workflowId: 'preplan.wf.02.01',
    dataPointId: 'applicable-policies',
    sourceId: 'workspace-project-files',
    sourceType: 'workspace_file',
    sourceUri: 'workspace://planning-condition.pdf',
    sourceTitle: '规划条件',
    publisher: '项目业主',
    publishedAt: '2026-09-01T00:00:00.000Z',
    capturedAt: NOW,
    asOf: '2026-09-01',
    locator: { page: 1 },
    rawValue: '正式规划条件',
    normalizedValue: '正式规划条件',
    unit: null,
    contentHash: 'a'.repeat(64),
    reliability: 'A',
    claimClass: 'fact',
    ...overrides,
  }
}

describe('Pre 2.0.1 independent workflow evidence validator', () => {
  it('passes a high-risk statutory workflow only when every required data point has fresh authoritative evidence', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const rows = [
      ['applicable-policies', 'cn-gov-policy', 'web_page', 'https://www.gov.cn/zhengce/'],
      ['statutory-planning', 'workspace-project-files', 'workspace_file', 'workspace://planning.pdf'],
      ['land-boundary-conditions', 'workspace-project-files', 'workspace_file', 'workspace://redline.dwg'],
      ['applicable-standards', 'cn-standards', 'web_page', 'https://std.samr.gov.cn/'],
    ] as const
    const result = validateWorkflowEvidence(registry, 'preplan.wf.02.01', rows.map(([dataPointId, sourceId, sourceType, sourceUri], index) =>
      evidence({ evidenceId: `ev-${index}`, dataPointId, sourceId, sourceType, sourceUri })), NOW)
    expect(result).toMatchObject({
      valid: true,
      missingRequiredDataPointIds: [],
      staleEvidenceIds: [],
      highAuthorityCount: 4,
      independentSourceCount: 3,
      hasGradeA: true,
    })
  })

  it('fails closed when a required data point has no evidence', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const result = validateWorkflowEvidence(registry, 'preplan.wf.02.01', [
      evidence({ dataPointId: 'applicable-policies' }),
    ], NOW)
    expect(result.valid).toBe(false)
    expect(result.missingRequiredDataPointIds).toEqual(expect.arrayContaining([
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
      sourceId: 'dsh-user-statement', sourceType: 'session_context', sourceUri: 'session://current/messages/1',
      reliability: 'C', claimClass: 'user_statement', normalizedValue: 5200, unit: 'CNY/m2',
    })
    const result = validateWorkflowEvidence(registry, 'preplan.wf.08.02', [invalid], NOW)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('does not support data kind')
  })
})
