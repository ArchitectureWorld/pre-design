import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { ContractRegistry } from '../src/contracts/registry.ts'
import { DshSubagentWorkflowAnalyzer } from '../src/runtime/subagent-workflow-analyzer.ts'
import { AutomationWorkflowCommitter } from '../src/runtime/automation-workflow-committer.ts'
import { WORKFLOW_AUTHOR_PROJECTION_VERSION, replayWorkflowAuthorProjection } from '../src/runtime/workflow-author-projection.ts'

let registry: ContractRegistry
beforeAll(async () => { registry = await ContractRegistry.open(new URL('../contracts/v0.6/', import.meta.url)) })
async function harness(stateResearch = false) {
  const descriptor = registry.workflow('preplan.wf.01.03')
  const example = structuredClone(registry.stateExample('PS03')) as any
  const qualityEvidence = { completionChecks: [], evidenceChecks: [], assumptions: [], blockers: [], confidence: 0.79 }
  const record = { evidenceId: 'ev-original', sourceType: 'workspace_file', sourceId: 'workspace', dataPointId: 'scope', workflowId: descriptor.workflowId,
    sourceUri: 'file:///D:/original.pdf', sourceTitle: '历史范围', publisher: '原件', capturedAt: '2026-09-26T12:00:00Z', asOf: null,
    contentHash: 'a'.repeat(64), locator: { relativePath: 'original.pdf', page: 18, fragmentHash: 'b'.repeat(64) },
    normalizedValue: '历史管理范围', rawValue: '历史管理范围', unit: null, reliability: 'B', claimClass: 'source_conclusion' }
  example.data.study_scope.evidence_refs = [{ source: 'R1', notes: '仅历史范围，不能作为现行法定边界。' }]
  const raw = { projectionVersion: WORKFLOW_AUTHOR_PROJECTION_VERSION, data: example.data,
    ...(example.quality === undefined ? {} : { quality: example.quality }), qualityEvidence }
  const research = { records: [record], validation: { valid: true, acceptedEvidenceIds: [record.evidenceId], errors: [] } }
  const context = { project: { projectId: 'project', name: 'projection', currentRevision: 6 },
    stateObjects: [{ projectId: 'project', objectId: 'PS02', revision: 6, value: registry.stateExample('PS02') }] }
  if (stateResearch) {
    const value = { data: { facilities: { description: '历史设施记录', evidence_refs: [{ claim_class: 'source_conclusion' }] } } }
    const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
    context.stateObjects.push({ projectId: 'project', objectId: 'BL06', revision: 5, value })
    Object.assign(record, { sourceType: 'project_state', sourceId: 'project-state-store', sourceUri: 'state://project/BL06?revision=5',
      contentHash: hash(value), rawValue: value.data.facilities, normalizedValue: value.data.facilities,
      locator: { objectId: 'BL06', revision: 5, jsonPointer: '/data/facilities', fragmentHash: hash(value.data.facilities) } })
  }
  const start = vi.fn(async (_provider: string, _request: any) => ({ id: 'native-child', dispose: async () => undefined,
    result: Promise.resolve({ stopReason: 'completed', structured: raw }) }))
  const analyzer = new DshSubagentWorkflowAnalyzer({ registry, repository: { readContext: () => context },
    subagents: { getProvider: () => ({}), start } } as never)
  const candidate = await analyzer.analyze({ id: 'parent' } as never, 'project', descriptor, undefined, undefined, research as never)
  const putAuditEvent = vi.fn(), submitProposal = vi.fn(async () => ({ proposalId: 'proposal' })), commitProposal = vi.fn(async () => ({ revision: 7 }))
  const governance = { policy: { mode: 'automatic', automationAuthorizationId: 'authorized' }, workflowRuns: [] as any[] }
  const committer = new AutomationWorkflowCommitter({ registry, repository: { readContext: () => context, putAuditEvent },
    governance: { readProject: () => governance }, gateway: { submitProposal, commitProposal } } as never)
  const report = { workflowId: descriptor.workflowId, targetObjectId: 'PS03', disposition: 'auto_pass', assumptions: [] } as never
  return { descriptor, context, research, raw, start, candidate, committer, putAuditEvent, submitProposal, commitProposal, governance, report }
}

describe('workflow author projection at native and commit boundaries', () => {
  it('compiles and replays accepted research from a state outside requiredUpstream without exposing new upstream aliases', async () => {
    const h = await harness(true)
    expect(h.descriptor.requiredUpstream).not.toContain('BL06')
    expect(h.candidate.authorProjection!.context.upstream.map(row => row.objectId)).toEqual(['PS02'])
    expect(h.candidate.payload.data).toMatchObject({ study_scope: { evidence_refs: [{ asset_id: 'research:project-state-store' }] } })
    await h.committer.commit({ id: 'parent' } as never, 'project', h.descriptor, h.candidate, h.report)
    expect(h.submitProposal).toHaveBeenCalledOnce()
  })

  it.each(['revision', 'value', 'unresolved', 'missing'] as const)('refuses changed supplementary research state %s at commit', async mutation => {
    const h = await harness(true)
    if (mutation === 'revision') h.context.stateObjects[1]!.revision++
    if (mutation === 'value') h.context.stateObjects[1]!.value = { data: { facilities: 'changed' } }
    if (mutation === 'missing') h.context.stateObjects.pop()
    if (mutation === 'unresolved') h.governance.workflowRuns.push({ targetObjectId: 'BL06', status: 'superseded' })
    await expect(h.committer.commit({ id: 'parent' } as never, 'project', h.descriptor, h.candidate, h.report)).rejects.toThrow()
    expect(h.submitProposal).not.toHaveBeenCalled()
  })

  it('captures one native projection, commits through the full state schema, and persists replayable original submission', async () => {
    const h = await harness()
    expect(h.start).toHaveBeenCalledOnce()
    expect(h.start.mock.calls[0]![1].outputSchema.required).toContain('projectionVersion')
    expect(h.candidate.payload).not.toHaveProperty('created_by')
    expect(h.candidate.payload.data).toMatchObject({ study_scope: { evidence_refs: [{ evidence_id: 'ev-original' }] } })
    expect(h.candidate.qualityEvidence).toEqual(h.raw.qualityEvidence)
    await h.committer.commit({ id: 'parent' } as never, 'project', h.descriptor, h.candidate, h.report)
    const envelope = (h.submitProposal.mock.calls as unknown as any[][])[0]![0]
    expect(registry.validateStateObject('PS03', envelope.change_set.payload)).toEqual({ valid: true, errors: [] })
    const audit = (h.putAuditEvent.mock.calls[0]![0] as any).payload.authorProjection
    expect(audit.raw).toEqual(h.raw)
    expect(audit.childId).toBe('native-child')
    const replayed = replayWorkflowAuthorProjection(audit, { childId: 'native-child', raw: h.raw }, {
      projectId: 'project', targetObjectId: 'PS03', researchEvidence: h.research.records as never,
      acceptedEvidenceIds: h.research.validation.acceptedEvidenceIds, upstream: h.context.stateObjects,
    })
    expect(replayed.payload.data).toEqual(envelope.change_set.payload.data)
  })

  it.each(['data', 'quality', 'qualityEvidence', 'raw', 'source', 'revision', 'unresolved'] as const)('still refuses a tampered or stale %s at commit', async (mutation) => {
    const h = await harness()
    const candidate = structuredClone(h.candidate) as any
    if (mutation === 'data') candidate.payload.data.basis = '宿主不可代写的新事实'
    if (mutation === 'quality') candidate.payload.quality = { confidence: 1 }
    if (mutation === 'qualityEvidence') candidate.qualityEvidence.confidence = 1
    if (mutation === 'raw') candidate.authorProjection.raw.data.basis = '更改回执'
    if (mutation === 'source') candidate.researchEvidence[0].contentHash = 'f'.repeat(64)
    if (mutation === 'revision') h.context.stateObjects[0]!.revision = 7
    if (mutation === 'unresolved') h.governance.workflowRuns.push({ targetObjectId: 'PS02', status: 'superseded' })
    await expect(h.committer.commit({ id: 'parent' } as never, 'project', h.descriptor, candidate, h.report)).rejects.toThrow()
    expect(h.submitProposal).not.toHaveBeenCalled()
    expect(h.commitProposal).not.toHaveBeenCalled()
  })
})
