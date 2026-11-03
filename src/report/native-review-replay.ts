import { sessionToolReceipts } from '../session/tool-results.ts'
import type { SessionEventLike } from '../visual/session-image-collector.ts'
import type { LlmRoute } from '../agent-classes/types.ts'
import { verifyModuleNativeSubmission } from '../research-v2/module-group-recovery.ts'

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const fail = (): never => { throw new Error('REPORT_REVIEW_NATIVE_INVALID: 原生审查提交、模型或结束状态不一致。') }

/** Replay the model's immutable tool arguments, never a locally asserted pass. */
export function replayReportReview(events: readonly SessionEventLike[], route: LlmRoute, output: unknown) {
  // Native structured_output may reject an invalid argument and accept the
  // model's corrected call. Reuse the strict verifier, which requires exactly
  // one final success and validates every earlier rejection and model route.
  try { verifyModuleNativeSubmission(events, route, output) } catch { return fail() }
  const start = events.findLastIndex(e => e.type === 'turn/start')
  if (start < 0) return fail()
  const turn = object(events[start]!.data).turn
  const current = events.slice(start), terminal = current.findLast(e => e.type === 'turn/end')
  if (!terminal || object(terminal.data).turn !== turn || object(object(terminal.data).reason).kind !== 'completed') return fail()
  const calls = current.filter(e => e.type === 'tool/call' && object(e.data).name === 'structured_output')
  const call = calls.at(-1)!, data = object(call.data)
  if (data.turn !== turn || typeof data.arguments !== 'string' || !data.callId || call.seq >= terminal.seq) return fail()
  const results = current.filter(e => e.type === 'tool/result').flatMap(e => {
    const r = object(e.data)
    return sessionToolReceipts(r).filter(block => block.toolCallId === data.callId).map(block => ({ e, r, block }))
  })
  if (results.length !== 1) return fail()
  const result = results[0]!
  if (result.block.isError !== false || result.r.turn !== turn || result.r.step !== data.step || result.e.seq <= call.seq || result.e.seq >= terminal.seq) return fail()
  return { callId: String(data.callId), callSeq: call.seq, resultSeq: result.e.seq, terminalSeq: terminal.seq }
}
