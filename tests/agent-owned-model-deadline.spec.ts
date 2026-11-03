import { expect, it } from 'vitest'
import { verifyOwnedModelCallDeadline } from '../src/agent-classes/model-call-deadline.ts'

const route = { provider: 'test', model: 'primary' }
const schema = { type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false }
type Event = { seq: number; time: number; type: string; data: any }
function fixture(count = 1, malformedJson = false) {
  const startedAt = Date.now() - 1300, proof = { kind: 'owned-model-call-deadline.v1' as const, startedAt, timeoutMs: 1000, expiredAt: startedAt + 1000 }
  const events: Event[] = [
    { seq: 1, time: startedAt, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, time: startedAt + 1, type: 'request/header', data: { header: { config: route, tools: [{ name: 'structured_output', parameters: schema }] } } },
  ]
  for (let index = 0; index < count; index++) {
    events.push({ seq: events.length + 1, time: startedAt + 10 + index * 2, type: 'tool/call', data: { turn: 1, step: index + 1, callId: `rejected-${index}`, name: 'structured_output', arguments: malformedJson ? '{' : '{"value":"invalid"}' } })
    events.push({ seq: events.length + 1, time: startedAt + 11 + index * 2, type: 'tool/result', data: { turn: 1, step: index + 1, message: { content: [{ type: 'tool-result', toolCallId: `rejected-${index}`, isError: true }] } } })
  }
  events.push({ seq: events.length + 1, time: proof.expiredAt + 1, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } })
  return { events, proof }
}

it.each([0, 1, 4])('verifies an owner deadline after %i independently proven schema rejections', count => {
  const { events, proof } = fixture(count)
  expect(verifyOwnedModelCallDeadline(events, route, proof)).toBe(true)
})
it('permits recovery after rejected invalid JSON without using the malformed draft', () => {
  const { events, proof } = fixture(1, true)
  expect(verifyOwnedModelCallDeadline(events, route, proof)).toBe(true)
})
it.each(['pending', 'successful', 'valid-content', 'missing-schema', 'wrong-turn', 'wrong-step', 'wrong-result-id', 'duplicate-result', 'duplicate-call', 'after-terminal', 'wrong-route', 'late-request'] as const)(
  'refuses owner deadline recovery for %s tool evidence', damage => {
    const { events, proof } = fixture(), call = events[2]!, result = events[3]!
    if (damage === 'pending') events.splice(3, 1)
    if (damage === 'successful') result.data.message.content[0].isError = false
    if (damage === 'valid-content') call.data.arguments = '{"value":1}'
    if (damage === 'missing-schema') events[1]!.data.header.tools = []
    if (damage === 'wrong-turn') result.data.turn = 2
    if (damage === 'wrong-step') result.data.step = 9
    if (damage === 'wrong-result-id') result.data.message.content[0].toolCallId = 'other'
    if (damage === 'duplicate-result') events.splice(4, 0, structuredClone(result))
    if (damage === 'duplicate-call') events.splice(4, 0, structuredClone(call), structuredClone(result))
    if (damage === 'after-terminal') events.push(...events.splice(3, 1))
    if (damage === 'wrong-route') events[1]!.data.header.config = { ...route, model: 'other' }
    if (damage === 'late-request') events.splice(3, 0, ...events.splice(1, 1))
    events.forEach((event, index) => { event.seq = index + 1 })
    expect(verifyOwnedModelCallDeadline(events, route, proof)).toBe(false)
  })
