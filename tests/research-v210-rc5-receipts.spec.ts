import { expect, it } from 'vitest'
import { nativeWebRetrievals, nativeWebSearchCalls, nativeWebSourceSubmission } from '../src/agent-classes/web-query.ts'
import { replayReportReview } from '../src/report/native-review-replay.ts'
import { findRejectedNativeSchemaSubmission } from '../src/research-v2/native-schema-recovery.ts'
import { findRepeatedNativeSchemaFailure } from '../src/research-v2/native-tool-stall.ts'
import { verifyOwnedModelCallDeadline } from '../src/agent-classes/model-call-deadline.ts'

const route = { provider: 'test', model: 'test' }
const schema = { type: 'object' as const, required: ['ok'], properties: { ok: { type: 'boolean' as const } } }
function receipt(callId: string, isError: boolean, content: unknown[] = []) {
  return { role: 'tool', toolCallId: callId, isError, content }
}
function rows(output: unknown, rejected = false): any[] {
  return [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'request/header', data: { header: { config: route, tools: [{ name: 'structured_output', parameters: schema }] } } },
    { seq: 3, type: 'tool/call', data: { turn: 1, step: 0, name: 'structured_output', callId: 'c', arguments: JSON.stringify(output) } },
    { seq: 4, type: 'tool/result', data: { turn: 1, step: 0, message: receipt('c', rejected) } },
    { seq: 5, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}
it('replays a current tool-role research approval and keeps missing/error/foreign receipts invalid', () => {
  const output = { ok: true }
  expect(replayReportReview(rows(output), route, output)).toEqual({ callId: 'c', callSeq: 3, resultSeq: 4, terminalSeq: 5 })
  for (const invalid of [{ isError: true }, { isError: undefined }, { toolCallId: 'other' }]) {
    const events = rows(output); Object.assign(events[3].data.message, invalid)
    expect(() => replayReportReview(events, route, output)).toThrow('REPORT_REVIEW_NATIVE')
  }
})
it('accepts real current web receipts and native source submission without accepting structured output as retrieval', () => {
  const sources = [{ url: 'https://example.com/page', quote: 'source' }]
  const events = rows({ sources })
  events.unshift({ seq: -1, type: 'tool/call', data: { callId: 'web', name: 'web_fetch', arguments: '{"url":"https://example.com/page"}' } },
    { seq: 0, type: 'tool/result', data: { message: receipt('web', false, [{ type: 'text', text: 'source' }]) } })
  expect(nativeWebRetrievals(events)).toEqual([{ tool: 'web_fetch', callId: 'web', text: 'source' }])
  expect(nativeWebSearchCalls(events)[0]).toMatchObject({ status: 'succeeded', resultChars: 6 })
  expect(nativeWebSourceSubmission(events, { sources }, 2)).toMatchObject({ receiptVerified: true, callId: 'c' })
})
it('diagnoses current rejected arguments and schema stalls using their correlated receipts', () => {
  expect(findRejectedNativeSchemaSubmission(rows({ ok: 'invalid' }, true), schema)?.originalSubmission).toEqual({ ok: 'invalid' })
  const events = rows({ ok: 'invalid' }, true).slice(0, 4)
  for (let i = 1; i < 3; i++) {
    events.push({ seq: 3 + i * 2, type: 'tool/call', data: { turn: 1, step: i, name: 'structured_output', callId: `c${i}`, arguments: '{"ok":"invalid"}' } },
      { seq: 4 + i * 2, type: 'tool/result', data: { turn: 1, step: i, message: receipt(`c${i}`, true) } })
  }
  expect(findRepeatedNativeSchemaFailure(events, schema)?.repeatedCalls).toBe(3)
})
it('verifies a real owned timeout with current schema rejection receipts', () => {
  const startedAt = Date.now() - 5000, expiredAt = startedAt + 1000
  const events = rows({ ok: 'invalid' }, true)
  events[0].time = startedAt; events[4].time = expiredAt; events[4].data.reason.kind = 'aborted'
  expect(verifyOwnedModelCallDeadline(events, route, { kind: 'owned-model-call-deadline.v1', startedAt, timeoutMs: 1000, expiredAt })).toBe(true)
})
