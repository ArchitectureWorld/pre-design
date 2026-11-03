import { matchesModelRoute } from './model-options.ts'
import type { ModelRoute } from './types.ts'
import { assertObjectJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

export interface OwnedModelCallDeadline {
  readonly kind: 'owned-model-call-deadline.v1'
  readonly startedAt: number
  readonly timeoutMs: number
  readonly expiredAt: number
}
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}

/** A generic abort is never a deadline. Verify the owning timer against the
 * terminated native turn, route and absence of any structured submission. */
export function verifyOwnedModelCallDeadline(events: readonly { type: string; data: unknown }[], route: ModelRoute,
  proof: OwnedModelCallDeadline | undefined): boolean {
  if (!proof || proof.kind !== 'owned-model-call-deadline.v1'
    || ![proof.startedAt, proof.timeoutMs, proof.expiredAt].every(Number.isSafeInteger) || proof.timeoutMs < 1
    || proof.startedAt <= 0 || proof.expiredAt < proof.startedAt + proof.timeoutMs
    || proof.expiredAt > proof.startedAt + proof.timeoutMs + 60_000 || proof.expiredAt > Date.now()) return false
  const rows = events as readonly { seq?: number; time?: number; type: string; data: unknown }[]
  if (!rows.length || rows.some((row, index) => !Number.isSafeInteger(row.seq) || index > 0 && row.seq! <= rows[index - 1].seq!)) return false
  const start = rows.findLastIndex(row => row.type === 'turn/start'), latest = rows.findLast(row => row.type === 'turn/start' || row.type === 'turn/end')
  if (start < 0 || latest?.type !== 'turn/end') return false
  const current = rows.slice(start), first = current[0], turn = object(first.data).turn
  if (!Number.isSafeInteger(turn) || object(latest.data).turn !== turn || object(object(latest.data).reason).kind !== 'aborted'
    || !Number.isSafeInteger(first.time) || first.time! < proof.startedAt - 1000 || first.time! > proof.expiredAt
    || !Number.isSafeInteger(latest.time) || latest.time! < proof.expiredAt || latest.time! > proof.expiredAt + 60_000) return false
  const requests = current.filter(row => row.type === 'request/header')
  if (!requests.length || !requests.every(row => row.seq! < latest.seq!
    && matchesModelRoute(object(object(row.data).header).config as ModelRoute, route))) return false
  const calls = current.filter(row => row.type === 'tool/call' && object(row.data).name === 'structured_output')
  if (new Set(calls.map(row => object(row.data).callId)).size !== calls.length) return false
  for (const [index, call] of calls.entries()) {
    const data = object(call.data)
    if (data.turn !== turn || !Number.isSafeInteger(data.step) || typeof data.callId !== 'string' || !data.callId
      || typeof data.arguments !== 'string' || call.seq! >= latest.seq!) return false
    const results = current.filter(row => row.type === 'tool/result').flatMap(row => {
      const result = object(row.data), blocks = object(result.message).content
      return Array.isArray(blocks) ? blocks.filter(block => object(block).type === 'tool-result' && object(block).toolCallId === data.callId)
        .map(block => ({ event: row, data: result, block: object(block) })) : []
    })
    const result = results.length === 1 ? results[0] : undefined
    if (!result || result.data.turn !== turn || result.data.step !== data.step || result.block.isError !== true
      || result.event.seq! <= call.seq! || result.event.seq! >= (calls[index + 1]?.seq ?? latest.seq!)) return false
    // A rejected schema/JSON call never reached the submission handler. A
    // schema-valid content rejection, pending call or successful draft cannot
    // authorize a deadline fallback, regardless of the tool's error wording.
    const header = object(requests.findLast(row => row.seq! < call.seq!)?.data).header
    const tools = object(header).tools
    const definitions = Array.isArray(tools) ? tools.filter(tool => object(tool).name === 'structured_output') : []
    if (definitions.length !== 1) return false
    const schema = object(definitions[0]).parameters
    try { assertObjectJsonSchema(schema) } catch { return false }
    let value: unknown
    try { value = JSON.parse(data.arguments) } catch { continue }
    try { if (!validateJsonSchemaValue(schema, value).length) return false } catch { return false }
  }
  return true
}
