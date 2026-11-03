import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { materialCorpusFingerprint } from '../src/materials/research-evidence.ts'
import { getModuleAuthorFieldGroups, validateModuleAuthorGroup, MODULE_AUTHOR_GROUP_VERSION } from '../src/research-v2/module-author-groups.ts'
import { moduleRecoveryFeedback } from '../src/research-v2/module-recovery-feedback.ts'
import { recoverModuleAuthorGroups } from '../src/research-v2/module-group-recovery.ts'
import { verifyModuleSourceValues } from '../src/research-v2/module-claims.ts'

function fixture() {
  const base = { documents: [], limitations: [] }, corpus = { ...base, fingerprint: materialCorpusFingerprint(base) }
  const group = getModuleAuthorFieldGroups('2.01')[0]
  const target = { port: group.port, recordId: 'r1', field: 'projectPosition', at: '' }
  const raw = { projectionVersion: MODULE_AUTHOR_GROUP_VERSION, groupId: group.groupId,
    outputs: { regional_context: { type: 'planning.regional_context.v1.2', quality: 'limited', scope: 'Research region', asOf: '2026-09-30', limitations: ['Needs verification'],
      records: [{ recordId: 'r1', resultClass: 'analysis_judgment', ...Object.fromEntries(group.fields.map(f => [f, { value: null, claimClass: 'missing', limitations: ['Missing source'] }])),
        scale: { value: 'regional', claimClass: 'decision', limitations: ['Research choice'] },
        projectPosition: { value: { x: 12.5, y: 30.5, crs: 'EPSG:4326', axisOrder: 'xy' }, claimClass: 'agent_inference', limitations: ['Unverified candidate'] } }] } },
    evidence: [{ target: { ...target, field: 'scale' }, kind: 'proposal', rationale: 'Research choice' },
      { target, kind: 'inference', inputRefs: [{ local: { ...target, field: 'scale' } }], rationale: 'Source should justify each numeric coordinate' }],
    limitations: ['Unverified'], stepResults: Object.fromEntries([1, 2, 3, 4].map(n => ['step' + n, { status: 'limited', summary: 'Review original inputs', fieldRefs: [{ ...target, field: 'scale' }], limitations: ['Unverified'] }])) }
  return { raw, target, corpus }
}
it('rejects numeric inference at the author group boundary with the exact target and without changing the draft', () => {
  const f = fixture(), before = structuredClone(f.raw)
  expect(() => validateModuleAuthorGroup('2.01', f.raw, [], f.corpus, [])).toThrow(/MODULE_CLAIM_INFERENCE_BASIS.*projectPosition.*numeric/)
  expect(f.raw).toEqual(before)
})
it('gives the native author group-scoped numeric inference guidance from a formerly completed receipt', () => {
  const f = fixture(), audit = { attempts: [{ classId: 'text', status: 'completed', groupId: f.raw.groupId, structuredOutput: f.raw }], reviewReceipts: [] }
  const before = structuredClone(audit), feedback = moduleRecoveryFeedback({ resumeExecutionAudit: audit }, f.raw.groupId)
  expect(feedback).toContain('MODULE_CLAIM_INFERENCE_BASIS')
  expect(feedback).toContain('数值归一化证据协议 numeric-normalization.v1')
  expect(feedback).toContain('projectPosition'); expect(feedback).toContain('numeric')
  expect(feedback).not.toContain('12.5'); expect(feedback).not.toContain('30.5')
  expect(moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'regional_context:2')).toBe('')
  expect(audit).toEqual(before)
})
it('reauthors an invalid numeric inference prefix instead of failing recovery before dispatch', async () => {
  const f = fixture(), context = { module: { id: '2.01' }, signal: new AbortController().signal, upstream: [],
    resumeExecutionAudit: { attempts: [{ classId: 'text', status: 'completed', groupId: f.raw.groupId, structuredOutput: f.raw }], reviewReceipts: [] } }
  const before = structuredClone(context.resumeExecutionAudit)
  await expect(recoverModuleAuthorGroups(context as any, {} as any, {} as any)).resolves.toEqual({ submissions: [], attempts: [] })
  expect(context.resumeExecutionAudit).toEqual(before)
})
it('diagnoses exact source numeric spelling mismatch without relaxing equality or saving source prose', () => {
  const text = 'private-note longitude 114.96884911111111', document = { path: 'original/photo.jpg', contentHash: createHash('sha256').update(text).digest('hex'), byteLength: Buffer.byteLength(text), text }
  const base = { documents: [document], limitations: [] }, corpus = { ...base, fingerprint: materialCorpusFingerprint(base) }
  const source = { sourceId: 's1', path: document.path, contentHash: document.contentHash, quote: '114.96884911111111', valueQuote: '114.96884911111111', rawValue: 114.96884911111113 }
  expect(() => verifyModuleSourceValues(corpus, [source])).toThrow(/MODULE_SOURCE_VALUE_NUMBER.*numberDiagnostic=.*valueQuoteParsesToRawValue":false/)
  expect(() => verifyModuleSourceValues(corpus, [{ ...source, rawValue: Number(source.valueQuote) }])).not.toThrow()
})
it('adds bounded exact numeric mismatch rules to historical author failures without changing the rejected value', () => {
  const f = fixture(), record = f.raw.outputs.regional_context.records[0] as any
  record.projectPosition.value.x = 114.96884911111113
  const evidence = f.raw.evidence[1] as any
  evidence.kind = 'source'; evidence.target.at = '/x'; evidence.source = { path: 'original/photo.jpg', quote: 'private-note longitude 114.96884911111111', valueQuote: '114.96884911111111' }
  const audit = { attempts: [{ classId: 'text', status: 'failed', groupId: f.raw.groupId, error: 'MODULE_SOURCE_VALUE_NUMBER: s1', structuredOutput: f.raw }], reviewReceipts: [] }
  const before = structuredClone(audit), feedback = moduleRecoveryFeedback({ resumeExecutionAudit: audit }, f.raw.groupId)
  expect(feedback).toContain('valueQuoteParsesToRawValue')
  expect(feedback).toContain('Number(valueQuote) must equal rawValue')
  expect(feedback).not.toContain('private-note')
  expect(audit).toEqual(before)
})
