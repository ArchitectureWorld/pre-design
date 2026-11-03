import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AutomationWorkflowCommitter } from '../src/runtime/automation-workflow-committer.ts'
import { projectStateClaimClass } from '../src/research/project-state-provenance.ts'

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
  it('rejects an unclassified mixed-source business judgment before committing an unreadable upstream', async () => {
    const h = harness(reference())
    const data = (h.candidate as any).payload.data
    data.gaps = [{ description: '地形精度与用户研究边界共同形成的缺口判断', evidence_refs: [
      { asset_id: 'original-terrain-guide', claim_class: 'source_conclusion' },
      { asset_id: 'user-scope', claim_class: 'user_statement' },
    ] }]
    const before = structuredClone(h.candidate)
    const result = h.validate()
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('PUBLISHED_CLAIM_CLASS_AMBIGUOUS /data/gaps/0')
    await expect(h.committer.commit(parent, 'project-1', descriptor, h.candidate, {
      workflowId: 'preplan.wf.06.06', targetObjectId: 'PG06', disposition: 'auto_pass', assumptions: [],
    } as never)).rejects.toThrow('PUBLISHED_CLAIM_CLASS_AMBIGUOUS')
    expect(h.submitProposal).not.toHaveBeenCalled()
    expect(h.candidate).toEqual(before)
    data.gaps[0].claim_class = 'agent_inference'
    expect(h.validate()).toEqual({ valid: true, errors: [] })
    expect(data.gaps[0].evidence_refs.map((r: any) => r.claim_class)).toEqual(['source_conclusion', 'user_statement'])
  })

  it('permits separate complete assertions and top-level source registers with different authorities', () => {
    const h = harness(reference())
    const data = (h.candidate as any).payload.data
    const historical = { asset_id: 'original-terrain-guide', claim_class: 'source_conclusion' }
    const stated = { asset_id: 'user-scope', claim_class: 'user_statement' }
    data.evidence_refs = [historical, stated]
    data.gaps = [{ description: '资料声明精度限制', evidence_refs: [historical] },
      { description: '用户限定本次范围', evidence_refs: [stated] }]
    expect(h.validate()).toEqual({ valid: true, errors: [] })
  })

  it.each(['OBJECT@PG03@70', 'current', '', 'PG03@0070'])('rejects malformed state version %s when asset_id names a known upstream object', async (version_id) => {
    const h = harness(reference({ asset_id: 'PG03', version_id }))
    expect(h.validate().valid).toBe(false)
    expect(h.validate().errors.join(' ')).toContain('identity')
    await expect(h.committer.commit(parent, 'project-1', descriptor, h.candidate, {
      workflowId: 'preplan.wf.06.06', targetObjectId: 'PG06', disposition: 'auto_pass', assumptions: [],
    } as never)).rejects.toThrow('PROVENANCE')
    expect(h.submitProposal).not.toHaveBeenCalled()
  })
  it('accepts a known object asset with its normal exact revision', () => {
    expect(harness(reference({ asset_id: 'PG03', version_id: 'PG03@70' })).validate()).toEqual({ valid: true, errors: [] })
  })
  it.each(['local-original', 'PS99'])('does not reinterpret unregistered original asset %s from malformed version text alone', (asset_id) => {
    expect(harness(reference({ asset_id, version_id: 'OBJECT@PG03@70', locator: { section: 'Chapter 3' } })).validate().valid).toBe(true)
  })
  it.each(['state://project-1/PG03?revision=70', 'project-state://project-1/PG03/70'])('recognizes the state identity in asset URI %s even when version_id is malformed', (asset_id) => {
    expect(harness(reference({ asset_id, version_id: 'OBJECT@PG03@70' })).validate().valid).toBe(false)
    expect(harness(reference({ asset_id, version_id: 'PG03@70' })).validate().valid).toBe(true)
    expect(harness(reference({ asset_id, version_id: hash(source.value) })).validate().valid).toBe(true)
  })
  it.each([
    ['state://other-project/PG03?revision=70', 'project'],
    ['project-state://project-1/PG03/69', 'revision'],
    ['state://project-1/PG03', 'revision'],
  ])('rejects conflicting or incomplete state asset URI %s', (asset_id, error) => {
    expect(harness(reference({ asset_id })).validate().errors.join(' ')).toContain(error)
  })
  it('does not let a valid section URI mask a conflicting state asset URI', () => {
    const ref = reference({ asset_id: 'state://other-project/PG03?revision=70',
      locator: { section: 'state://project-1/PG03?revision=70 | JSON Pointer /data/rows/0' } })
    expect(harness(ref).validate().errors.join(' ')).toContain('project')
  })
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
  it.each(['user_statement', 'decision'])('preserves the selected source authority class %s at central validation', (claim_class) => {
    const state = structuredClone(source)
    state.value.data.design.evidence_refs[0]!.claim_class = claim_class
    const locator = { section: '/data/design/amount' }
    expect(harness(reference({ locator, claim_class }), { state }).validate().valid).toBe(true)
    for (const upgrade of ['source_conclusion', 'fact']) {
      expect(harness(reference({ locator, claim_class: upgrade }), { state }).validate().errors.join(' ')).toContain(claim_class)
    }
  })
  it('does not let mixed root/data evidence registers classify an otherwise unqualified historical field', () => {
    const evidence_refs = [{ claim_class: 'source_conclusion' }, { claim_class: 'user_statement' }, { claim_class: 'decision' }]
    const value = { evidence_refs, data: { evidence_refs,
      time_constraints: [{ name: '历史方案周期', deadline: '2025-12-31', source: '原始方案第6页' }] } }
    expect(projectStateClaimClass(value, '/data/time_constraints/0')).toBe('source_conclusion')
    expect(projectStateClaimClass(value, '/data/time_constraints/0/deadline')).toBe('source_conclusion')
  })
  it.each(['user_statement', 'decision'])('keeps a homogeneous directly owning business envelope class %s', (claim_class) => {
    const value = { data: { evidence_refs: [{ claim_class: 'source_conclusion' }, { claim_class: 'decision' }],
      scope: { value: '只代表原有性质', evidence_refs: [{ claim_class }, { claim_class }] } } }
    expect(projectStateClaimClass(value, '/data/scope/value')).toBe(claim_class)
  })
  it.each(['user_statement', 'decision'])('keeps direct ancestor class %s regardless of shared source registers', (claim_class) => {
    const value = { claim_class, data: { evidence_refs: [{ claim_class: 'source_conclusion' }], scope: { nested: { value: '原有性质' } } } }
    expect(projectStateClaimClass(value, '/data/scope/nested/value')).toBe(claim_class)
  })
  it.each(['missing', 'assumption', 'agent_inference'])('retains conservative %s inherited from a shared ancestor register', (claim_class) => {
    const value = { data: { evidence_refs: [{ claim_class: 'source_conclusion' }, { claim_class }], scope: { value: '不确定' } } }
    expect(projectStateClaimClass(value, '/data/scope/value')).toBe(claim_class)
  })
  it.each([['user_statement', 'decision'], ['user_statement', 'source_conclusion'], ['decision', 'fact']])
    ('requires a precise pointer for a selected field mixing %s and %s', (first, second) => {
      const value = { data: { scope: { value: '混合性质', evidence_refs: [{ claim_class: first }, { claim_class: second }] } } }
      expect(() => projectStateClaimClass(value, '/data/scope')).toThrow(/AMBIGUOUS.*precise.*Pointer/u)
      expect(() => projectStateClaimClass(value, '/data/scope/value')).toThrow(/AMBIGUOUS.*precise.*Pointer/u)
      expect(projectStateClaimClass(value, '/data/scope/evidence_refs/0')).toBe(first === 'fact' ? 'source_conclusion' : first)
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
