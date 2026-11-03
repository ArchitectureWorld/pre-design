import { sessionToolReceipts } from '../session/tool-results.ts'
import { validateJsonSchemaValue, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { SessionEventLike } from '../visual/session-image-collector.ts'
import { sha256CanonicalJson } from '../presentation/canonical-json.ts'

export interface NativeSchemaStallAudit {
  readonly version: 'native-schema-stall.v1'
  readonly repeatedCalls: number
  readonly argumentHash: string
  readonly validationErrors: readonly string[]
  readonly callIds: readonly string[]
  readonly match?: 'identical-arguments' | 'same-validation-errors'
  readonly argumentHashes?: readonly string[]
  readonly validationHash?: string
}
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

/** Observe only call/result metadata. Never coerce arguments or read assistant
 * content. Changed schema errors, pending, successful and completed attempts
 * remain useful activity. Text changes cannot hide an unchanged type error. */
export function findRepeatedNativeSchemaFailure(events: readonly SessionEventLike[], schema: ObjectJsonSchema): NativeSchemaStallAudit | undefined {
  if (events.some((event, i) => !Number.isSafeInteger(event.seq) || i > 0 && event.seq <= events[i - 1].seq)) return
  const start = events.findLastIndex(event => event.type === 'turn/start')
  if (start < 0) return
  const turn = object(events[start].data).turn, current = events.slice(start)
  if (!Number.isSafeInteger(turn) || current.some(event => event.type === 'turn/end')) return
  let previousHash: string | undefined, previousValidationHash: string | undefined,
    callIds: string[] = [], argumentHashes: string[] = [], validationErrors: string[] = []
  const calls = current.filter(event => event.type === 'tool/call')
  if (new Set(calls.map(event => object(event.data).callId)).size !== calls.length) return
  for (const call of calls) {
    const data = object(call.data)
    const results = current.filter(event => event.type === 'tool/result').flatMap(event => {
      const result = object(event.data)
      return sessionToolReceipts(result).filter(block => block.toolCallId === data.callId).map(block => ({ event, result, block }))
    })
    const matched = results.length === 1 ? results[0] : undefined
    if (data.name !== 'structured_output' || data.turn !== turn || !data.callId || typeof data.arguments !== 'string'
      || !matched || matched.event.seq <= call.seq || matched.result.turn !== turn || matched.result.step !== data.step
      || matched.block.isError !== true) { previousHash = undefined; previousValidationHash = undefined; callIds = []; argumentHashes = []; continue }
    // Independently diagnose the original args against the actual native schema.
    // Tool error text is untrusted and never copied into the new prompt/audit.
    let errors: string[]
    try { errors = validateJsonSchemaValue(schema, JSON.parse(data.arguments)) }
    catch { errors = ['structured_output arguments must be valid JSON'] }
    if (!errors.length) { previousHash = undefined; previousValidationHash = undefined; callIds = []; argumentHashes = []; continue }
    const argumentHash = sha256CanonicalJson(data.arguments)
    // Hash every independently computed error before truncating diagnostics.
    // No provider/tool error text can authorize a cancellation or route switch.
    const validationHash = sha256CanonicalJson([...new Set(errors)].sort())
    if (validationHash !== previousValidationHash) { callIds = []; argumentHashes = [] }
    previousHash = argumentHash; previousValidationHash = validationHash
    callIds.push(data.callId); argumentHashes.push(argumentHash)
    validationErrors = errors.slice(0, 8).map(error => error.slice(0, 400))
  }
  if (callIds.length < 3 || !previousHash) return
  return { version: 'native-schema-stall.v1', repeatedCalls: callIds.length, argumentHash: previousHash, validationErrors, callIds,
    match: new Set(argumentHashes).size === 1 ? 'identical-arguments' : 'same-validation-errors', argumentHashes,
    validationHash: previousValidationHash }
}

export class NativeSchemaStallError extends Error {
  constructor(readonly audit: NativeSchemaStallAudit) {
    super(`MODULE_NATIVE_TOOL_STALLED: ${JSON.stringify(audit)}`)
  }
}

/** Owns no model result: cancellation returns to the existing finite correction
 * path. Reader failures preserve the original model deadline and acceptance. */
export function watchNativeSchemaStall(readEvents: () => Promise<readonly SessionEventLike[] | undefined>, schema: ObjectJsonSchema,
  controller: AbortController): () => void {
  let stopped = false, reading = false
  async function inspect() {
    if (stopped || reading || controller.signal.aborted) return
    reading = true
    try {
      const events = await readEvents()
      if (stopped || controller.signal.aborted || !events) return
      const audit = findRepeatedNativeSchemaFailure(events, schema)
      if (audit) controller.abort(new NativeSchemaStallError(audit))
    } catch { /* No readable receipt is not proof of a schema loop. */ }
    finally { reading = false }
  }
  const timer = setInterval(() => { void inspect() }, 30_000)
  timer.unref()
  void inspect()
  return () => { stopped = true; clearInterval(timer) }
}
