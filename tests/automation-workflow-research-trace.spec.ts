import { describe, expect, it, vi } from 'vitest'
import { AutomationWorkflowCommitter } from '../src/runtime/automation-workflow-committer.ts'
import { ContractRegistry } from '../src/contracts/registry.ts'

const descriptor = {
  workflowId: 'preplan.wf.01.01', chapterId: '01', workItemId: '01-01',
  targetObjectId: 'PS01', targetSchemaId: 'urn:preplan:v0.6:state:PS01', gateId: 'G1',
  title: '项目基本情况与启动原因', purpose: '建立项目身份', risk: 'M', requiredUpstream: ['ProjectSeed'],
  atomicToolIds: [],
} as never

const quality = {
  workflowId: 'preplan.wf.01.01', targetObjectId: 'PS01', disposition: 'auto_pass' as const,
  score: 1, completionCoverage: 1, evidenceCoverage: 1, confidence: 0.95,
  attempt: 1, maxAttempts: 3, reasons: [], blockers: [], assumptions: [],
}

const evidence = {
  evidenceId: 'ev-workspace-name', workflowId: 'preplan.wf.01.01', dataPointId: 'canonical-name',
  sourceId: 'workspace-project-files', sourceType: 'workspace_file' as const,
  sourceUri: 'file:///workspace/project.json', sourceTitle: 'project.json', publisher: '项目正式资料',
  publishedAt: null, capturedAt: '2026-09-14T06:00:00.000Z', asOf: null,
  locator: { relativePath: 'project.json', selectorType: 'json_pointer', selector: '/canonical_name', fragmentHash: 'a'.repeat(64) },
  rawValue: '武汉站改造', normalizedValue: '武汉站改造', unit: null,
  contentHash: 'b'.repeat(64), reliability: 'A' as const, claimClass: 'fact' as const,
}

const analysisTrace = {
  traceId: 'trace-preplan-wf-01-01-r0', workflowId: 'preplan.wf.01.01', claimId: 'PS01',
  inputEvidenceIds: ['ev-workspace-name'], inputObjectIds: [], methodId: 'project-identity-analysis', methodVersion: '1.0.0',
  parameters: {}, calculationSteps: [{ step: 1, description: '基于已验证证据形成候选对象', inputEvidenceIds: ['ev-workspace-name'], output: { canonical_name: '武汉站改造' } }],
  outputValue: { canonical_name: '武汉站改造' }, confidence: 0.95, limitations: [],
}

describe('automatic workflow research provenance persistence', () => {
  it.each([
    { ...evidence, locator: { ...evidence.locator, jsonPointer: '/canonical_name' }, section: 'file:///workspace/project.json | JSON Pointer /canonical_name' },
    { ...evidence, sourceUri: 'https://example.org/official.txt', locator: { selectorType: 'text_lines', startLine: 3, endLine: 5 }, section: 'https://example.org/official.txt | lines 3-5' },
    { ...evidence, sourceType: 'project_state', sourceUri: 'project-state://project-1/PS01/2', locator: { objectId: 'PS01', revision: 2, jsonPointer: '/data/canonical_name' }, section: 'project-state://project-1/PS01/2 | JSON Pointer /data/canonical_name' },
  ])('writes contract-valid Research references and lossless audit provenance for $sourceUri', async ({ section, ...record }) => {
    const contracts = await ContractRegistry.open(new URL('../contracts/v0.6/', import.meta.url))
    const submitProposal = vi.fn(async (envelope: any) => {
      const validation = contracts.validateProposalEnvelope(envelope)
      expect(validation.errors).toEqual([])
      expect(validation.valid).toBe(true)
      return { proposalId: envelope.proposal_id, projectId: 'project-1', expectedRevision: 0, status: 'pending_review' }
    })
    const commitProposal = vi.fn(async (proposalId: string) => ({
      projectId: 'project-1', proposalId, revision: 1, replayed: false, status: 'confirmed',
    }))
    const putAuditEvent = vi.fn(async (event: any) => event)
    const committer = new AutomationWorkflowCommitter({
      repository: {
        readContext: vi.fn(() => ({
          project: { projectId: 'project-1', currentRevision: 0 },
          stateObjects: [],
        })),
        putAuditEvent,
      } as never,
      governance: { readProject: vi.fn(() => ({ policy: { mode: 'automatic', automationAuthorizationId: 'auth-1' } })) } as never,
      registry: {
        validateStateObject: vi.fn(() => ({ valid: true, errors: [] })),
        stateExample: vi.fn(() => ({ object_type: 'ProjectIdentity', schema_version: '0.6.0', approval: { required_role: 'chapter_reviewer', conditions: [] } })),
      } as never,
      gateway: { submitProposal, commitProposal } as never,
      createId: () => 'fixed',
      now: () => '2026-09-14T06:10:00.000Z',
    })

    await committer.commit({ id: 'session-1' } as never, 'project-1', descriptor, {
      payload: { data: { canonical_name: '武汉站改造' } },
      qualityEvidence: { completionChecks: [], evidenceChecks: [], assumptions: [], blockers: [], confidence: 0.95 },
      researchEvidence: [record],
      analysisTrace,
    } as never, quality)

    const envelope = submitProposal.mock.calls[0]?.[0]
    expect(envelope.evidence_refs).toHaveLength(1)
    expect(envelope.evidence_refs[0]).toMatchObject({
      evidence_id: 'ev-workspace-name',
      asset_id: 'research:workspace-project-files',
      version_id: 'b'.repeat(64),
      claim_class: 'fact',
      locator: { section },
      captured_at: evidence.capturedAt,
      reliability: 'A',
    })
    expect(putAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'research.trace', projectId: 'project-1', revision: 1,
      payload: expect.objectContaining({ workflowId: 'preplan.wf.01.01', evidenceRecords: [record], analysisTrace }),
    }))
  })
})
