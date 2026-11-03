import { describe, expect, it, vi } from 'vitest'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'
import type { SessionEventLike } from '../src/visual/session-image-collector.ts'
import { findRejectedNativeSchemaSubmission, nativeSchemaCorrectionFeedback, nativeSchemaRecoveryFeedback } from '../src/research-v2/native-schema-recovery.ts'

const schema = {
  type: 'object' as const, additionalProperties: false, required: ['outputs', 'evidence', 'stepResults'],
  properties: {
    outputs: { type: 'object' as const, additionalProperties: false, properties: {} },
    evidence: { type: 'array' as const, items: { type: 'object' as const, additionalProperties: false,
      required: ['target', 'kind'], properties: { target: { type: 'object' as const }, kind: { const: 'proposal' } } } },
    stepResults: { type: 'object' as const, additionalProperties: false, required: ['step4'], properties: {
      step4: { type: 'object' as const, required: ['fieldRefs'], properties: {
        fieldRefs: { type: 'array' as const, items: { type: 'object' as const, additionalProperties: false,
          required: ['port', 'recordId', 'field', 'at'], properties: {
            port: { type: 'string' as const, const: 'peer_products' }, recordId: { type: 'string' as const }, field: { type: 'string' as const }, at: { type: 'string' as const },
          } } },
      } },
    } },
  },
}
const valid = { outputs: {}, evidence: [], stepResults: { step4: { fieldRefs: [] } } }
const misplaced = { outputs: { stepResults: valid.stepResults }, evidence: [] }
const wrongRef = { ...valid, stepResults: { step4: { fieldRefs: [{ port: 'peer_supply', field: 'name', at: '' }] } } }
const missingEvidence = { outputs: { evidence: [] }, stepResults: valid.stepResults }
function events(value: unknown): SessionEventLike[] {
  return [
    { seq: 1, type: 'turn/start', data: { turn: 2 } },
    { seq: 2, type: 'request/header', data: { header: { tools: [{ name: 'structured_output', parameters: schema }] } } },
    { seq: 3, type: 'tool/call', data: { turn: 2, step: 0, name: 'structured_output', callId: 'rejected', arguments: JSON.stringify(value) } },
    { seq: 4, type: 'tool/result', data: { turn: 2, step: 0, message: { content: [{ type: 'tool-result', toolCallId: 'rejected', isError: true,
      content: [{ type: 'text', text: 'UNTRUSTED ERROR TEXT' }] }] } } },
    { seq: 5, type: 'assistant/message', data: { message: { content: [{ type: 'thinking', text: 'PRIVATE THOUGHT' }] } } },
    { seq: 6, type: 'turn/end', data: { reason: { kind: 'completed' } } },
  ]
}
describe('native structural schema rejection feedback', () => {
  it.each([
    [misplaced, 'value.stepResults', 'value.outputs.stepResults'],
    [wrongRef, 'value.stepResults.step4.fieldRefs[0].recordId', 'value.stepResults.step4.fieldRefs[0].port'],
    [missingEvidence, 'value.evidence', 'value.outputs.evidence'],
  ])('preserves a matched rejected draft and whole-schema member errors even when evidence branches have no errors', (value, first, second) => {
    const log = events(value), before = JSON.stringify(log), result: any = findRejectedNativeSchemaSubmission(log, schema)
    expect(result).toBeDefined()
    expect(result.originalSubmission).toEqual(value)
    expect(result.originalSubmissionHash).toBe(sha256CanonicalJson(value))
    expect(result.schemaValidationErrors.join('\n')).toContain(first)
    expect(result.schemaValidationErrors.join('\n')).toContain(second)
    expect(result.fieldDiagnostics).toEqual([])
    expect(JSON.stringify(log)).toBe(before)
    expect(JSON.stringify(result)).not.toContain('PRIVATE THOUGHT')
    expect(JSON.stringify(result)).not.toContain('UNTRUSTED ERROR TEXT')
  })
  it('delivers those exact errors and the untouched submission to the next native author', () => {
    const feedback = nativeSchemaCorrectionFeedback(events(wrongRef), schema, 'execution', 'child')
    expect(feedback).toContain('schemaValidationErrors')
    expect(feedback).toContain('value.stepResults.step4.fieldRefs[0].recordId')
    expect(feedback).toContain(sha256CanonicalJson(wrongRef))
    expect(feedback).toContain('"acceptanceGranted":false')
    expect(feedback).not.toContain('PRIVATE THOUGHT')
    expect(feedback).not.toContain('UNTRUSTED ERROR TEXT')
  })
  it('still excludes valid business rejections and unmatched or pending tool results', () => {
    expect(findRejectedNativeSchemaSubmission(events(valid), schema)).toBeUndefined()
    const log = events(wrongRef) as any[]
    log[3].data.message.content[0].toolCallId = 'different'
    expect(findRejectedNativeSchemaSubmission(log, schema)).toBeUndefined()
    expect(findRejectedNativeSchemaSubmission(events(wrongRef).slice(0, 3), schema)).toBeUndefined()
  })
  it('does not revive an earlier schema draft after a newer structured source rejection in the same group', async () => {
    const readEvents = vi.fn(async () => events(wrongRef)), groupId = 'peer_products:5.1.1'
    const context: any = { projectId: 'project', signal: new AbortController().signal, resumeExecutionAudit: { attempts: [
      { classId: 'text', groupId, status: 'failed', error: 'MODULE_NATIVE_error', executionId: 'earlier', childId: 'child', sourceContextFingerprint: 'source-hash' },
      { classId: 'text', groupId, status: 'failed', error: 'MODULE_SOURCE_VALUE_TEXT: current rejection', executionId: 'latest', childId: 'latest-child', sourceContextFingerprint: 'source-hash' },
    ] } }
    const execution: any = { id: 'earlier', projectId: 'project', parentId: 'parent', classId: 'text', status: 'failed', childId: 'child',
      selected: { provider: 'primary', model: 'model' }, actual: { provider: 'primary', model: 'model' } }
    const feedback = await nativeSchemaRecoveryFeedback(context, { id: 'parent' } as any, { execution: () => execution }, readEvents, groupId, schema, 'source-hash')
    expect(feedback).toBe('')
    expect(readEvents).not.toHaveBeenCalled()
  })
})
