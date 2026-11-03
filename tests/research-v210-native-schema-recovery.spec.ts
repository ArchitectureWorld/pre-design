import { describe, expect, it, vi } from 'vitest'
import { bindNativeModuleEvidenceSchema, getModuleAuthorProjectionSchema } from '../src/research-v2/module-author-projection.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'
import type { SessionEventLike } from '../src/visual/session-image-collector.ts'
import { findRejectedNativeSchemaSubmission, nativeSchemaRecoveryFeedback } from '../src/research-v2/native-schema-recovery.ts'

const fullSchema = bindNativeModuleEvidenceSchema(getModuleAuthorProjectionSchema('3.04'))
const schema = { type: 'object' as const, additionalProperties: false, required: ['evidence'], properties: { evidence: fullSchema.properties!.evidence } }
const target = { port: 'peer_supply', recordId: 'peer-1', field: 'servedNeeds', at: '/0' }
const raw = { evidence: [{ target, kind: 'source', source: { path: 'frozen.json', quote: 'Original statement' }, ...target, quote: 'Original statement' }] }
function logs(value: unknown = raw): SessionEventLike[] {
  return [
    { seq: 1, type: 'turn/start', data: { turn: 2 } },
    { seq: 2, type: 'request/header', data: { header: { tools: [{ name: 'structured_output', parameters: schema }] } } },
    { seq: 3, type: 'tool/call', data: { turn: 2, step: 0, name: 'structured_output', callId: 'rejected', arguments: JSON.stringify(value) } },
    { seq: 4, type: 'tool/result', data: { turn: 2, step: 0, message: { content: [{ type: 'tool-result', toolCallId: 'rejected', isError: true, content: [{ type: 'text', text: 'UNTRUSTED TOOL ERROR INSTRUCTION' }] }] } } },
    { seq: 5, type: 'assistant/message', data: { message: { content: [{ type: 'thinking', text: 'PRIVATE THOUGHT MARKER' }] } } },
    { seq: 6, type: 'turn/end', data: { turn: 2, reason: { kind: 'aborted' } } },
  ]
}
describe('native rejected schema recovery', () => {
  it('recovers the original rejected args and exact closed-branch member errors without coercing the draft', () => {
    const events = logs(), before = JSON.stringify(events), result = findRejectedNativeSchemaSubmission(events, schema)!
    expect(result.originalSubmissionHash).toBe(sha256CanonicalJson(raw))
    expect(result.originalSubmission).toEqual(raw)
    expect(result.fieldDiagnostics[0]).toMatchObject({ evidenceIndex: 0, target, kind: 'source', unexpectedMembers: ['port', 'recordId', 'field', 'at', 'quote'] })
    expect(result.fieldDiagnostics[0].validationErrors.join('\n')).toContain('additionalProperties: false')
    expect(JSON.stringify(result)).not.toContain('UNTRUSTED TOOL ERROR')
    expect(JSON.stringify(result)).not.toContain('PRIVATE THOUGHT')
    expect(JSON.stringify(events)).toBe(before)
  })
  it.each(['pending', 'success', 'wrong-call', 'wrong-step', 'wrong-turn', 'duplicate-result', 'bad-order', 'different-schema'])(
    'does not attach a rejection to %s evidence', variant => {
      const events = logs() as any[]
      if (variant === 'pending') events.push({ seq: 7, type: 'tool/call', data: { turn: 2, step: 1, name: 'structured_output', callId: 'new', arguments: '{}' } })
      if (variant === 'success') events[3].data.message.content[0].isError = false
      if (variant === 'wrong-call') events[3].data.message.content[0].toolCallId = 'other'
      if (variant === 'wrong-step') events[3].data.step = 1
      if (variant === 'wrong-turn') events[3].data.turn = 3
      if (variant === 'duplicate-result') events.splice(4, 0, { ...structuredClone(events[3]), seq: 4.5 })
      if (variant === 'bad-order') events[3].seq = 2
      if (variant === 'different-schema') events[1].data.header.tools[0].parameters = { type: 'object', properties: {} }
      expect(findRejectedNativeSchemaSubmission(events, schema)).toBeUndefined()
    })
  it('does not turn a schema-valid business rejection into a transport correction', () => {
    expect(findRejectedNativeSchemaSubmission(logs({ evidence: [] }), schema)).toBeUndefined()
  })
  it('names the missing token and wrong complete call for the explicitly declared frozen query choice', () => {
    const choice = { type: 'object', additionalProperties: false, required: ['path', 'quote', 'valueQuote', 'queryMapping'], properties: {
      path: { type: 'string', const: 'frozen.json' }, quote: { type: 'string', const: 'complete frozen call' },
      valueQuote: { type: 'string', const: '"original query"' }, queryMapping: { type: 'object', properties: {
        kind: { const: 'native-search-query-json-string.v1' }, callId: { const: 'call-1' }, queryIndex: { const: 2 },
      } },
    } }
    const querySchema: any = structuredClone(schema)
    querySchema.properties.evidence.items.oneOf.find((b: any) => b.properties.kind.const === 'source').properties.source = { oneOf: [choice] }
    const draft = { evidence: [{ target, kind: 'source', source: { path: 'frozen.json', quote: 'incomplete call',
      queryMapping: { kind: 'native-search-query-json-string.v1', callId: 'call-1', queryIndex: 2 } } }] }
    const events = logs(draft) as any[]
    events[1].data.header.tools[0].parameters = querySchema
    const before = JSON.stringify(events), result = findRejectedNativeSchemaSubmission(events, querySchema)!
    expect((result.fieldDiagnostics[0] as any).declaredQuerySourceDiagnostics).toMatchObject({
      knownFrozenQueryChoice: true, validationErrors: [expect.stringContaining('valueQuote'), expect.stringContaining('complete frozen call')],
    })
    expect(result.originalSubmission).toEqual(draft)
    expect(JSON.stringify(events)).toBe(before)
  })
  it.each(['MODULE_NATIVE_error', 'MODULE_NATIVE_SCHEMA_INVALID: evidence oneOf', 'MODULE_NATIVE_TOOL_STALLED: same arguments'])
  ('restores a verified rejected tool call after %s even when the native turn completed', async error => {
    const events = logs() as any[]; events.at(-1).data.reason.kind = 'completed'
    const context: any = { projectId: 'project', signal: new AbortController().signal, resumeExecutionAudit: { attempts: [{
      classId: 'text', groupId: 'peer_supply:4.2.5', status: 'failed', error, executionId: 'exec', childId: 'child', sourceContextFingerprint: 'source-hash',
    }] } }
    const execution: any = { id: 'exec', projectId: 'project', parentId: 'parent', classId: 'text', status: 'failed', childId: 'child',
      selected: { provider: 'primary', model: 'model' }, actual: { provider: 'primary', model: 'model' } }
    const feedback = await nativeSchemaRecoveryFeedback(context, { id: 'parent' } as any, { execution: () => execution }, async () => events,
      'peer_supply:4.2.5', schema, 'source-hash')
    expect(feedback).toContain(sha256CanonicalJson(raw))
    expect(feedback).toContain('unexpectedMembers')
    expect(feedback).not.toContain('随后调用超时')
    expect(feedback).not.toContain('PRIVATE THOUGHT')
  })
  it('requires the failed native child, route and unchanged source binding before delivering the original rejected draft', async () => {
    const readEvents = vi.fn(async () => logs())
    const context: any = { projectId: 'project', module: { id: '3.04' }, signal: new AbortController().signal,
      resumeExecutionAudit: { attempts: [{ classId: 'text', groupId: 'peer_supply:2.2.1', status: 'failed', error: 'Module model call timed out', executionId: 'exec', childId: 'child', sourceContextFingerprint: 'source-hash' }] } }
    const execution: any = { id: 'exec', projectId: 'project', parentId: 'parent', classId: 'text', status: 'failed', childId: 'child', selected: { provider: 'primary', model: 'model' }, actual: { provider: 'primary', model: 'model' } }
    const feedback = await nativeSchemaRecoveryFeedback(context, { id: 'parent' } as any, { execution: () => execution }, readEvents, 'peer_supply:2.2.1', schema, 'source-hash')
    expect(feedback).toContain(sha256CanonicalJson(raw))
    expect(feedback).toContain('"unexpectedMembers":["port","recordId","field","at","quote"]')
    expect(feedback).toContain('"originalSubmission"')
    expect(feedback).not.toContain('PRIVATE THOUGHT')
    expect(feedback).not.toContain('UNTRUSTED TOOL ERROR')
    for (const changed of [{ ...execution, childId: 'other' }, { ...execution, parentId: 'other' }, { ...execution, projectId: 'other' }, { ...execution, actual: { provider: 'other', model: 'model' } }]) {
      expect(await nativeSchemaRecoveryFeedback(context, { id: 'parent' } as any, { execution: () => changed }, readEvents, 'peer_supply:2.2.1', schema, 'source-hash')).toBe('')
    }
    expect(await nativeSchemaRecoveryFeedback(context, { id: 'parent' } as any, { execution: () => execution }, readEvents, 'peer_supply:2.2.1', schema, 'changed-source')).toBe('')
    expect(readEvents).toHaveBeenCalledTimes(1)
  })
})
