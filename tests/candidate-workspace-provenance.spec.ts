import { describe, expect, it, vi } from 'vitest'
import { AutomationWorkflowCommitter } from '../src/runtime/automation-workflow-committer.ts'

const record = { evidenceId: 'ev-original', sourceType: 'workspace_file', sourceId: 'workspace-project-files',
  sourceUri: 'file:///workspace/source.pdf', contentHash: 'a'.repeat(64), claimClass: 'source_conclusion',
  locator: { relativePath: '原始资料/source.pdf', page: 6, fragmentHash: 'b'.repeat(64) } }
const reference = (overrides = {}) => ({ evidence_id: record.evidenceId, asset_id: record.locator.relativePath,
  version_id: record.contentHash, claim_class: record.claimClass, locator: { page: 6 }, quote_hash: record.locator.fragmentHash, ...overrides })
const descriptor = { workflowId: 'preplan.wf.01.02', targetObjectId: 'PS02', requiredUpstream: [], chapterId: '01', workItemId: '01-02' } as never
function harness(ref: unknown, records: unknown[] = [record], acceptedEvidenceIds = records.map(row => (row as typeof record).evidenceId)) {
  const submitProposal = vi.fn(async () => ({ proposalId: 'proposal' }))
  const committer = new AutomationWorkflowCommitter({
    repository: { readContext: () => ({ project: { projectId: 'project', currentRevision: 1 }, stateObjects: [] }), putAuditEvent: async () => undefined },
    registry: { validateStateObject: () => ({ valid: true, errors: [] }), stateExample: () => ({}) },
    governance: { readProject: () => ({ policy: { mode: 'automatic', automationAuthorizationId: 'auth' } }) },
    gateway: { submitProposal, commitProposal: async () => ({ proposalId: 'proposal', revision: 2 }) },
  } as never)
  const candidate = { payload: { data: { nested: [{ evidence_refs: [ref] }] } }, researchEvidence: records,
    researchValidation: { valid: true, acceptedEvidenceIds, errors: [] } } as never
  return { submitProposal, validate: () => committer.validateCandidate({ id: 'parent' } as never, 'project', descriptor, candidate),
    commit: () => committer.commit({ id: 'parent' } as never, 'project', descriptor, candidate,
      { workflowId: 'preplan.wf.01.02', targetObjectId: 'PS02', disposition: 'auto_pass', assumptions: [] } as never) }
}

describe('accepted original workspace citation binding', () => {
  it('accepts the original ID, path, page, version, fragment and classification without changing them', async () => {
    const ref = reference(), original = structuredClone(ref), h = harness(ref)
    expect(h.validate()).toEqual({ valid: true, errors: [] })
    await h.commit()
    expect(ref).toEqual(original)
    expect(h.submitProposal).toHaveBeenCalledOnce()
  })
  it.each([
    ['unknown version', { version_id: 'unknown' }, 'version'],
    ['wrong version', { version_id: 'c'.repeat(64) }, 'version'],
    ['wrong asset', { asset_id: '原始资料/other.pdf' }, 'asset'],
    ['unknown asset', { asset_id: 'unknown' }, 'asset'],
    ['wrong page', { locator: { page: 7 } }, 'page'],
    ['missing page', { locator: {} }, 'page'],
    ['wrong section', { locator: { page: 6, section: 'other.pdf' } }, 'selector'],
    ['forged ID on known original', { evidence_id: 'fake' }, 'accepted'],
    ['forged ID disguised as missing', { evidence_id: 'fake', claim_class: 'missing' }, 'accepted'],
    ['wrong fragment hash', { quote_hash: 'd'.repeat(64) }, 'quote_hash'],
    ['upgraded fact', { claim_class: 'fact' }, 'claim_class'],
    ['reclassified assumption', { claim_class: 'assumption' }, 'claim_class'],
  ])('rejects %s at both preflight and commit', async (_label, overrides, error) => {
    const h = harness(reference(overrides))
    expect(h.validate().errors.join(' ')).toContain(error)
    await expect(h.commit()).rejects.toThrow('PROVENANCE')
    expect(h.submitProposal).not.toHaveBeenCalled()
  })
  it('rejects a known source URI with a forged ID and unknown generic asset', () => {
    expect(harness(reference({ evidence_id: 'fake', asset_id: 'unknown', locator: { page: 6, section: record.sourceUri } })).validate().valid).toBe(false)
  })
  it('does not let a nonaccepted record authorize a known original citation', () => {
    expect(harness(reference(), [record], []).validate().errors.join(' ')).toContain('accepted')
  })
  it('permits null or omitted fragment hashes without replacing them with a file hash', () => {
    expect(harness(reference({ quote_hash: null })).validate().valid).toBe(true)
    expect(harness(reference({ quote_hash: undefined })).validate().valid).toBe(true)
  })
  it('accepts a provider asset only when the section also binds the exact source file', () => {
    const ref = reference({ asset_id: 'research:workspace-project-files', locator: { page: 6, section: record.sourceUri } })
    expect(harness(ref).validate().valid).toBe(true)
    expect(harness({ ...ref, locator: { page: 6 } }).validate().valid).toBe(false)
  })
  it.each([
    [{ relativePath: '原始资料/source.pdf', jsonPointer: '/data/name', fragmentHash: 'b'.repeat(64) }, '/data/name', '/data/other'],
    [{ relativePath: '原始资料/source.pdf', selector: '/name', fragmentHash: 'b'.repeat(64) }, `${record.sourceUri} | JSON Pointer /name`, '/other'],
    [{ relativePath: '原始资料/source.pdf', startLine: 3, endLine: 5, fragmentHash: 'b'.repeat(64) }, `${record.sourceUri} | lines 3-5`, `${record.sourceUri} | lines 4-5`],
  ])('binds an original text or JSON selector without guessing from its quote', (locator, section, wrong) => {
    const evidence = { ...record, locator }
    expect(harness(reference({ locator: { section } }), [evidence]).validate().valid).toBe(true)
    expect(harness(reference({ locator: { section: wrong } }), [evidence]).validate().errors.join(' ')).toContain('selector')
  })
  it('leaves session evidence, other source types and unrelated unknown assumptions to their own contracts', () => {
    for (const sourceType of ['session_context', 'web_page', 'manual_import']) {
      expect(harness(reference({ version_id: 'unknown' }), [{ ...record, sourceType }]).validate().valid).toBe(true)
    }
    expect(harness(reference({ evidence_id: 'new-assumption', asset_id: 'unknown', version_id: 'unknown', claim_class: 'assumption', locator: {} })).validate().valid).toBe(true)
    expect(harness(reference({ version_id: 'unknown' }), [{ ...record, contentHash: '' }]).validate().valid).toBe(true)
  })
  it('requires an explicit root JSON selector rather than treating an omitted selector as the root', () => {
    const evidence = { ...record, locator: { relativePath: record.locator.relativePath, jsonPointer: '', fragmentHash: record.locator.fragmentHash } }
    expect(harness(reference({ locator: { section: '' } }), [evidence]).validate().valid).toBe(true)
    expect(harness(reference({ locator: {} }), [evidence]).validate().valid).toBe(false)
  })
})
