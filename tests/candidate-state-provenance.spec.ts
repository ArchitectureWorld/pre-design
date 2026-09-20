import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AutomationWorkflowCommitter } from '../src/runtime/automation-workflow-committer.ts'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const descriptor = { workflowId: 'preplan.wf.06.06', targetObjectId: 'PG06', requiredUpstream: ['PG03'], chapterId: '06', workItemId: '06-06' } as never
const parent = { id: 'session-1' } as never
const source = { projectId: 'project-1', objectId: 'PG03', revision: 70, updatedAt: '2026-09-17T06:00:00Z',
  value: { data: { rows: [{ id: 'ROW-AREA', area: 965 }], design: { amount: 30, evidence_refs: [{ claim_class: 'agent_inference' }] } } } }
const reference = (overrides = {}) => ({ evidence_id: 'ev-upstream', asset_id: 'project-state-store', version_id: 'PG03@70',
  claim_class: 'source_conclusion', locator: { section: '/data/rows/0' }, quote_hash: null, ...overrides })

function harness(ref: unknown, options: { state?: typeof source; workflowRuns?: unknown[]; workflowRevisions?: unknown[]; researchEvidence?: unknown[] } = {}) {
  let current = options.state ?? structuredClone(source)
  const submitProposal = vi.fn(async () => ({ proposalId: 'proposal-1' }))
  const committer = new AutomationWorkflowCommitter({
    repository: { readContext: () => ({ project: { projectId: 'project-1', currentRevision: 74 }, stateObjects: [current] }), putAuditEvent: vi.fn() },
    governance: { readProject: () => ({ policy: { mode: 'automatic', automationAuthorizationId: 'auth-1' }, workflowRuns: options.workflowRuns ?? [], workflowRevisions: options.workflowRevisions ?? [] }) },
    registry: { validateStateObject: () => ({ valid: true, errors: [] }), stateExample: () => ({}) },
    gateway: { submitProposal, commitProposal: vi.fn(async () => ({ proposalId: 'proposal-1', revision: 75 })) },
  } as never)
  const candidate = { payload: { data: { items: [{ evidence_refs: [ref] }] } }, researchEvidence: options.researchEvidence ?? [] } as never
  return { committer, candidate, submitProposal, replaceSource: (value: typeof source) => { current = value },
    validate: () => committer.validateCandidate(parent, 'project-1', descriptor, candidate) }
}

describe('candidate project-state provenance at the central commit boundary', () => {
  it('accepts an existing pointer and exact fragment hash, without claiming semantic support', () => {
    expect(harness(reference({ quote_hash: hash(source.value.data.rows[0]) })).validate()).toEqual({ valid: true, errors: [] })
  })
  it('does not misclassify an external document version as a Project State citation', () => {
    expect(harness(reference({ asset_id: 'registered-document', version_id: 'edition@1', locator: { section: 'Chapter 3' } })).validate().valid).toBe(true)
  })
  it.each([
    ['stale version', { version_id: 'PG03@69' }, 'revision'],
    ['unknown object', { version_id: 'OP07@67' }, 'unavailable'],
    ['named array identifier', { locator: { section: '/data/rows/ROW-AREA' } }, 'index'],
    ['missing pointer', { locator: { section: '/data/absent' } }, 'Pointer'],
    ['invalid escape', { locator: { section: '/data/~2' } }, 'escape'],
    ['wrong hash', { quote_hash: 'a'.repeat(64) }, 'hash'],
    ['ambiguous state alias', { version_id: 'current' }, 'identity'],
  ])('rejects %s before a passing schema/quality can submit it', async (_label, overrides, error) => {
    const h = harness(reference(overrides))
    expect(h.validate().valid).toBe(false)
    expect(h.validate().errors.join(' ')).toContain(error)
    await expect(h.committer.commit(parent, 'project-1', descriptor, h.candidate, {
      workflowId: 'preplan.wf.06.06', targetObjectId: 'PG06', disposition: 'auto_pass', assumptions: [],
    } as never)).rejects.toThrow('PROVENANCE')
    expect(h.submitProposal).not.toHaveBeenCalled()
  })
  it('keeps ancestor inference on a scalar selection and permits explicit inference', () => {
    const locator = { section: '/data/design/amount' }
    expect(harness(reference({ locator })).validate().errors.join(' ')).toContain('agent_inference')
    expect(harness(reference({ locator, claim_class: 'agent_inference' })).validate().valid).toBe(true)
  })
  const mixedEvidenceSource = { ...source, value: { data: { ...source.value.data,
    evidence_refs: [{ claim_class: 'fact' }, { claim_class: 'missing' }, { claim_class: 'agent_inference' }],
  } } }
  it.each(['/data/evidence_refs/0', '/data/evidence_refs/0/claim_class'])('does not contaminate a selected citation %s with sibling citation classes', (pointer) => {
    const h = harness(reference({ locator: { section: pointer }, claim_class: 'fact' }), { state: mixedEvidenceSource })
    expect(h.validate()).toEqual({ valid: true, errors: [] })
  })
  it.each(['/data/evidence_refs/1', '/data/evidence_refs', '/data/rows/0/area'])('retains missing classification where the selected source %s actually carries or inherits it', (pointer) => {
    const ref = reference({ locator: { section: pointer }, claim_class: 'fact' })
    expect(harness(ref, { state: mixedEvidenceSource }).validate().errors.join(' ')).toContain('missing')
    expect(harness({ ...ref, claim_class: 'missing' }, { state: mixedEvidenceSource }).validate().valid).toBe(true)
  })
  it('still validates the exact revision, pointer and hash of a selected evidence item', () => {
    const ref = reference({ locator: { section: '/data/evidence_refs/0' }, claim_class: 'fact', quote_hash: hash(mixedEvidenceSource.value.data.evidence_refs[0]) })
    expect(harness(ref, { state: mixedEvidenceSource }).validate().valid).toBe(true)
    for (const override of [{ version_id: 'PG03@69' }, { locator: { section: '/data/evidence_refs/99' } }, { quote_hash: 'f'.repeat(64) }]) {
      expect(harness({ ...ref, ...override }, { state: mixedEvidenceSource }).validate().valid).toBe(false)
    }
  })
  it('rejects sources that are currently reopened, even if the old snapshot still exists', () => {
    const h = harness(reference(), { workflowRuns: [{ targetObjectId: 'PG03', status: 'superseded', revisionRequest: { requestId: 'rev-1' } }] })
    expect(h.validate().errors.join(' ')).toContain('unresolved')
  })
  it('rejects a pending journal source before its workflow row has been reopened', () => {
    const h = harness(reference(), { workflowRevisions: [{ status: 'pending', affectedObjectIds: ['PG03'] }] })
    expect(h.validate().errors.join(' ')).toContain('unresolved')
  })
  it('rechecks the latest source on commit after successful preflight', async () => {
    const h = harness(reference())
    expect(h.validate().valid).toBe(true)
    h.replaceSource({ ...source, revision: 71 })
    await expect(h.committer.commit(parent, 'project-1', descriptor, h.candidate, {
      workflowId: 'preplan.wf.06.06', targetObjectId: 'PG06', disposition: 'auto_pass', assumptions: [],
    } as never)).rejects.toThrow('revision')
    expect(h.submitProposal).not.toHaveBeenCalled()
  })
  it('validates generated state URI citations and rejects a forged content hash or cross-project URI', () => {
    const ref = reference({ asset_id: 'research:project-state-store', version_id: hash(source.value),
      locator: { section: 'state://project-1/PG03?revision=70 | JSON Pointer /data/rows/0' } })
    expect(harness(ref).validate().valid).toBe(true)
    expect(harness({ ...ref, version_id: 'b'.repeat(64) }).validate().errors.join(' ')).toContain('hash')
    expect(harness({ ...ref, locator: { section: 'state://other-project/PG03?revision=70 | JSON Pointer /data/rows/0' } }).validate().errors.join(' ')).toContain('project')
  })
  it('resolves a hash citation only from its matching trusted research record', () => {
    const ref = reference({ version_id: hash(source.value) })
    const research = { evidenceId: 'ev-upstream', sourceType: 'project_state', sourceId: 'project-state-store', contentHash: hash(source.value),
      sourceUri: 'state://project-1/PG03?revision=70', locator: { objectId: 'PG03', revision: 70, jsonPointer: '/data/rows/0' } }
    expect(harness(ref, { researchEvidence: [research] }).validate().valid).toBe(true)
    expect(harness(ref).validate().valid).toBe(false)
  })
  it.each(['object', 'selector', 'hash'])('rejects rebinding a trusted evidence ID to another %s', (conflict) => {
    const research = { evidenceId: 'ev-upstream', sourceType: 'project_state', sourceId: 'project-state-store', contentHash: conflict === 'hash' ? 'f'.repeat(64) : hash(source.value),
      sourceUri: `state://project-1/${conflict === 'object' ? 'OP07' : 'PG03'}?revision=70`,
      locator: { objectId: conflict === 'object' ? 'OP07' : 'PG03', revision: 70, jsonPointer: conflict === 'selector' ? '/data/rows/0/area' : '/data/rows/0' } }
    const ref = reference({ version_id: hash(source.value), locator: { section: 'state://project-1/PG03?revision=70 | JSON Pointer /data/rows/0' } })
    expect(harness(ref, { researchEvidence: [research] }).validate().errors.join(' ')).toContain('trusted')
  })
})
