import { expect, it } from 'vitest'
import { moduleFieldProtocolDiagnostic } from '../src/research-v2/module-field-protocol-diagnostics.ts'
import { moduleRecoveryFeedback } from '../src/research-v2/module-recovery-feedback.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'

const rejection = 'MODULE_PROJECTION_OUTPUT_INVALID: local_resources.records.0.resourceId: Invalid input; local_resources.records.1.recordId: Invalid string; local_resources.records.1.resourceId: Invalid input'
const draft = () => ({ groupId: 'local_resources:1.1', outputs: { local_resources: { records: [
  { recordId: 'RESOURCE-01', resourceId: { value: 'RESOURCE-01', claimClass: 'decision', limitations: ['工作编号，非官方身份。'], notApplicableReason: '工作编号选择' } },
  { recordId: 'RESOURCE-汉字', resourceId: { value: 'RESOURCE-汉字', claimClass: 'decision', limitations: ['工作编号，非官方身份。'] } },
] } }, evidence: [], limitations: ['测试拒稿，未获任何业务验收。'] })

it('explains rejected field envelope members and ID patterns from the original contract without rewriting the draft', () => {
  const raw = draft(), before = structuredClone(raw)
  const diagnostic = moduleFieldProtocolDiagnostic(rejection, raw, [], '1.06')
  expect(diagnostic).toMatchObject({ completeSubmission: false, originalSubmissionHash: sha256CanonicalJson(raw),
    fieldEnvelopeConflicts: expect.arrayContaining([
      expect.objectContaining({ target: { port: 'local_resources', recordId: 'RESOURCE-01', field: 'resourceId', at: '' }, reason: 'non-null-envelope-extra-members', unexpectedMembers: ['notApplicableReason'] }),
      expect.objectContaining({ target: { port: 'local_resources', recordId: 'RESOURCE-汉字', field: 'recordId', at: '' }, reason: 'invalid-id-pattern' }),
      expect.objectContaining({ target: { port: 'local_resources', recordId: 'RESOURCE-汉字', field: 'resourceId', at: '' }, reason: 'invalid-id-pattern' }),
    ]) })
  expect(raw).toEqual(before)
})

it('carries the latest structured schema diagnosis across an empty transport failure into native recovery feedback', () => {
  const raw = draft(), audit = { attempts: [
    { classId: 'text', status: 'failed', groupId: raw.groupId, error: rejection, structuredOutput: raw },
    { classId: 'text', status: 'failed', groupId: raw.groupId, error: 'MODULE_NATIVE_error', submissionState: 'not-submitted' },
    { classId: 'text', status: 'failed', groupId: raw.groupId, error: 'Module model call timed out', submissionState: 'not-submitted' },
  ], reviewReceipts: [] }, before = structuredClone(audit)
  const feedback = moduleRecoveryFeedback({ module: { id: '1.06' }, resumeExecutionAudit: audit, resumeExecutionError: 'Module model call timed out' } as any, raw.groupId)
  const previous = JSON.parse(feedback.split('\n').at(-1)!).previousRejection, diagnostic = previous.diagnosticExcerpt
  expect(previous.authorErrors.some((error: string) => error.includes(rejection))).toBe(true)
  expect(diagnostic).toMatchObject({ originalSubmissionHash: sha256CanonicalJson(raw), fieldEnvelopeConflicts: expect.any(Array) })
  expect(feedback).toContain('notApplicableReason')
  expect(feedback).toContain('fieldEnvelopeConflicts')
  expect(audit).toEqual(before)
})
