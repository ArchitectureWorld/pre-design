import { describe, expect, it } from 'vitest'
import { findRepeatedNativeSchemaFailure } from '../src/research-v2/native-tool-stall.ts'
import type { SessionEventLike } from '../src/visual/session-image-collector.ts'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'

const schema: ObjectJsonSchema = { type: 'object', additionalProperties: false, required: ['outputs'],
  properties: { outputs: { type: 'object', additionalProperties: false, properties: {} } } }
function logs(values: unknown[], errors = values.map(() => true)): SessionEventLike[] {
  return [{ seq: 1, type: 'turn/start', data: { turn: 1 } }, ...values.flatMap((value, i) => [
    { seq: 2 + i * 2, type: 'tool/call', data: { turn: 1, step: i, name: 'structured_output', callId: `call-${i}`, arguments: JSON.stringify(value) } },
    { seq: 3 + i * 2, type: 'tool/result', data: { turn: 1, step: i, message: { content: [{ type: 'tool-result', toolCallId: `call-${i}`, isError: errors[i],
      content: [{ type: 'text', text: 'Untrusted error or thought marker must not enter diagnostics' }] }] } } },
  ])]
}
const invalid = { outputs: '{}' }
describe('repeated native schema rejection guard', () => {
  it('requires three consecutive identical rejected arguments and diagnoses them against the unchanged schema', () => {
    const events = logs([invalid, invalid, invalid]), before = JSON.stringify(events)
    const result = findRepeatedNativeSchemaFailure(events, schema)!
    expect(result.repeatedCalls).toBe(3)
    expect(result.validationErrors).toEqual(['"value.outputs" must be an object'])
    expect(result.argumentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.callIds).toEqual(['call-0', 'call-1', 'call-2'])
    expect(JSON.stringify(result)).not.toContain('Untrusted')
    expect(JSON.stringify(events)).toBe(before)
  })
  it('detects three different rejected drafts that preserve the same independently verified structure error', () => {
    const result = findRepeatedNativeSchemaFailure(logs([invalid, { outputs: 'different' }, { outputs: 'another' }]), schema)!
    expect(result.repeatedCalls).toBe(3)
    expect(result.validationErrors).toEqual(['"value.outputs" must be an object'])
    expect(result.match).toBe('same-validation-errors')
    expect(new Set(result.argumentHashes).size).toBe(3)
  })
  it.each([
    [invalid, invalid],
    [invalid, { outputs: { unexpected: true } }, invalid],
    [invalid, invalid, { outputs: {} }],
  ].map(values => [values]))('preserves useful activity or fewer than three repetitions: %j', values => {
    expect(findRepeatedNativeSchemaFailure(logs(values), schema)).toBeUndefined()
  })
  it('does not treat a valid schema value with a failed tool result as a schema loop', () => {
    expect(findRepeatedNativeSchemaFailure(logs([{ outputs: {} }, { outputs: {} }, { outputs: {} }]), schema)).toBeUndefined()
  })
  it('does not abort a completed turn, a successful submission or a fresh pending call', () => {
    const events = logs([invalid, invalid, invalid])
    expect(findRepeatedNativeSchemaFailure([...events, { seq: 8, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }], schema)).toBeUndefined()
    expect(findRepeatedNativeSchemaFailure(logs([invalid, invalid, invalid], [true, true, false]), schema)).toBeUndefined()
    expect(findRepeatedNativeSchemaFailure([...events, { seq: 8, type: 'tool/call', data: { turn: 1, step: 3, name: 'structured_output', callId: 'fresh', arguments: '{"outputs":{}}' } }], schema)).toBeUndefined()
  })
  it('requires matching call identities, turn, step and strictly ordered sequence', () => {
    for (const mutate of [
      (events: any[]) => { events[6].data.message.content[0].toolCallId = 'unrelated' },
      (events: any[]) => { events[6].data.turn = 2 },
      (events: any[]) => { events[6].data.step = 10 },
      (events: any[]) => { events[6].seq = 2 },
    ]) {
      const events = logs([invalid, invalid, invalid]); mutate(events)
      expect(findRepeatedNativeSchemaFailure(events, schema)).toBeUndefined()
    }
  })
  it('ignores rejected arguments from previous turns and all assistant content', () => {
    const events = logs([invalid, invalid, invalid])
    events.push({ seq: 8, type: 'turn/start', data: { turn: 2 } },
      { seq: 9, type: 'assistant/message', data: { message: { content: [{ type: 'thinking', text: 'private marker' }] } } })
    expect(findRepeatedNativeSchemaFailure(events, schema)).toBeUndefined()
  })
})
