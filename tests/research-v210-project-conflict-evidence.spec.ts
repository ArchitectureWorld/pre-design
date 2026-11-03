import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { materialCorpusFingerprint } from '../src/materials/research-evidence.ts'
import { getModuleAuthorGroupOutputSchemaPrompt } from '../src/research-v2/module-author-groups.ts'
import { moduleRecoveryFeedback } from '../src/research-v2/module-recovery-feedback.ts'
import { verifyModuleSourceValues } from '../src/research-v2/module-claims.ts'
import { sha256CanonicalJson as hash } from '../src/presentation/canonical-json.ts'

const quote = 'Synthetic Reservoir Management Plan (2021-2025)'
const document = { path: 'original.txt', text: quote, byteLength: Buffer.byteLength(quote),
  contentHash: createHash('sha256').update(quote).digest('hex') }
const base = { documents: [document], limitations: [] }, corpus = { ...base, fingerprint: materialCorpusFingerprint(base) }
const target = { port: 'project_brief', recordId: 'PB-SYNTHETIC', field: 'conflicts', at: '/0' }
const rawValue = 'The historical reservoir plan does not establish the current planning commission.'
const rejected = { groupId: 'project_brief:4', outputs: { project_brief: { records: [{ recordId: target.recordId,
  conflicts: { value: [rawValue], claimClass: 'agent_inference', limitations: ['Current commission unverified'] } }] } },
  evidence: [{ target, kind: 'source', source: { path: document.path, quote, valueQuote: 'Synthetic Reservoir' } }] }

it('gives the initial project-conflict author the distinction between literal source leaves and inferred identity conclusions', () => {
  const prompt = getModuleAuthorGroupOutputSchemaPrompt('1.01', 'project_brief:4', [])
  expect(prompt).toContain('project-identity-conflict-evidence.v1')
  expect(prompt).toContain('text-synthesis-evidence.v1')
  expect(prompt).toContain('source.valueQuote')
  expect(prompt).toContain('整个文本叶值')
  expect(prompt).toContain('真实local或upstream')
})

it('sends the same specific guidance for a checkpoint rejection while preserving the original native draft and source', () => {
  const audit = { reviewReceipts: [], attempts: [{ classId: 'text', groupId: 'project_brief:4', status: 'failed',
    error: 'MODULE_SOURCE_VALUE_TEXT: source-synthetic', structuredOutput: rejected }] }
  const before = hash({ audit, corpus })
  const feedback = moduleRecoveryFeedback({ module: { id: '1.01' }, resumeExecutionAudit: audit, corpus } as any, 'project_brief:4')
  expect(feedback).toContain('project-identity-conflict-evidence.v1')
  expect(feedback).toContain('source.valueQuote')
  const receipt = JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(receipt.diagnosticExcerpt).toMatchObject({ completeSubmission: false, originalSubmissionHash: hash(rejected),
    fieldTextConflicts: [{ target, diagnosticCode: 'MODULE_SOURCE_VALUE_TEXT', rawValueHash: hash(rawValue) }] })
  expect(hash({ audit, corpus })).toBe(before)
  expect(moduleRecoveryFeedback({ module: { id: '1.01' }, resumeExecutionAudit: audit, corpus } as any, 'project_brief:3')).toBe('')
})

it('still rejects a narrative source leaf when valueQuote contains only its supporting project name', () => {
  expect(() => verifyModuleSourceValues(corpus, [{ sourceId: 'source-synthetic', path: document.path,
    contentHash: document.contentHash, quote, valueQuote: 'Synthetic Reservoir', rawValue }])).toThrow('MODULE_SOURCE_VALUE_TEXT')
  expect(verifyModuleSourceValues(corpus, [{ sourceId: 'literal-synthetic', path: document.path,
    contentHash: document.contentHash, quote, rawValue: 'Synthetic Reservoir' }])).toHaveLength(1)
})
