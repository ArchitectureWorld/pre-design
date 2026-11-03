import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import type { EvidenceRecord } from '../research/types.ts'
import { WORKFLOW_AUTHOR_PROJECTION_VERSION, replayWorkflowAuthorProjection, type WorkflowAuthorAudit } from './workflow-author-projection.ts'

interface NativeEventPosition { readonly seq: number; readonly turn?: number; readonly step?: number }
interface NativeReceipt {
  readonly childId: string
  readonly calls: readonly (NativeEventPosition & { readonly callId: string; readonly arguments: Record<string, any> })[]
  readonly results: readonly (Partial<NativeEventPosition> & { readonly callId: string; readonly isError: boolean })[]
  readonly requests: readonly (NativeEventPosition & { readonly model: { readonly provider: string; readonly model: string } })[]
  readonly endings: readonly (NativeEventPosition & { readonly reason?: { readonly kind?: string } })[]
}
interface ReceiptReplayInput {
  readonly projectId: string
  readonly targetObjectId: string
  readonly requiredUpstream: readonly string[]
  readonly expectedChildId: string
  readonly expectedModel: { readonly provider: string; readonly model: string }
  readonly state: Record<string, any>
  /** Actual repository revision.stateSnapshot at the target's committed revision. */
  readonly committedSnapshot: Readonly<Record<string, any>>
  readonly trace?: { readonly occurredAt: string; readonly payload: {
    readonly authorProjection?: WorkflowAuthorAudit
    readonly evidenceRecords?: readonly EvidenceRecord[]
    readonly researchValidation?: { readonly acceptedEvidenceIds?: readonly string[] }
    readonly analysisTrace?: { readonly parameters?: { readonly upstreamSnapshots?: unknown } }
  } }
  readonly receipt: NativeReceipt
}

const rawJsonHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function fail(code: string): never { throw new Error(`NATIVE_RECEIPT_${code}`) }

function bindNativeCall(call: NativeReceipt['calls'][number], input: ReceiptReplayInput) {
  const { receipt, expectedModel } = input
  if (!Number.isSafeInteger(call.seq)) fail('CALL_SEQUENCE')
  const request = receipt.requests.filter(row => Number.isSafeInteger(row.seq) && row.seq < call.seq).sort((a, b) => b.seq - a.seq)[0]
  const terminal = receipt.endings.filter(row => Number.isSafeInteger(row.seq) && row.seq > call.seq).sort((a, b) => a.seq - b.seq)[0]
  const previousTerminal = receipt.endings.filter(row => Number.isSafeInteger(row.seq) && row.seq < call.seq).sort((a, b) => b.seq - a.seq)[0]
  if (request === undefined || terminal === undefined || (previousTerminal !== undefined && request.seq <= previousTerminal.seq)) fail('REQUEST_TURN_SEQUENCE')
  if (request.model?.provider !== expectedModel.provider || request.model?.model !== expectedModel.model) fail('REQUEST_MODEL')
  if (terminal.reason?.kind !== 'completed') fail('CALL_TURN_NOT_COMPLETED')
  const results = receipt.results.filter(row => row.callId === call.callId)
  if (results.length !== 1 || results[0]!.isError !== false) fail('CALL_RESULT')
  const result = results[0]!
  // Existing stored v1 receipts retain request/call/terminal seq and callId but
  // omit result seq and turn. Accept their unambiguous sequence binding only.
  const hasTurn = [call, request, terminal, result].some(row => row.turn !== undefined)
  if (hasTurn && (call.turn === undefined || request.turn !== call.turn || terminal.turn !== call.turn || result.turn !== call.turn)) fail('CALL_TURN_IDENTITY')
  if (call.step !== undefined && (request.step !== call.step || result.step !== call.step)) fail('CALL_STEP_IDENTITY')
  if ((hasTurn || result.seq !== undefined) && (!Number.isSafeInteger(result.seq) || result.seq! <= call.seq || result.seq! >= terminal.seq)) fail('RESULT_SEQUENCE')
  return { mode: hasTurn ? 'turn-sequence-v2' as const : 'sequence-v1' as const,
    requestSeq: request.seq, callSeq: call.seq, ...(result.seq === undefined ? {} : { resultSeq: result.seq }), terminalSeq: terminal.seq,
    ...(call.turn === undefined ? {} : { turn: call.turn }), ...(call.step === undefined ? {} : { step: call.step }) }
}

/** Offline replay of actual tool arguments. Trust comes from the separate
 * repository revision snapshot and Research trace, never the audit alone. */
export function replayWorkflowNativeReceipt(input: ReceiptReplayInput) {
  const { receipt, trace, state } = input
  if (receipt.childId !== input.expectedChildId) fail('CHILD_IDENTITY')
  const successful = receipt.calls.flatMap(call => {
    try { return [{ call, binding: bindNativeCall(call, input) }] } catch { return [] }
  })
  const audit = trace?.payload.authorProjection
  if (audit === undefined) {
    const adopted = successful.find(({ call }) => Object.keys(call.arguments).every(key => ['payload', 'qualityEvidence'].includes(key))
      && call.arguments.payload?.data !== undefined && isDeepStrictEqual(call.arguments.payload.data, state.data))
    if (adopted === undefined) fail('LEGACY_SUBMISSION_NOT_FOUND')
    return { protocol: 'legacy-full-payload' as const, childId: receipt.childId, callId: adopted.call.callId, nativeBinding: adopted.binding,
      submittedHash: sha256CanonicalJson(adopted.call.arguments.payload.data), upstreamBindings: [] }
  }
  if (audit.version !== WORKFLOW_AUTHOR_PROJECTION_VERSION || audit.childId !== input.expectedChildId) fail('AUDIT_IDENTITY')
  if (!Number.isFinite(Date.parse(trace!.occurredAt)) || Date.parse(audit.context.capturedAt) > Date.parse(trace!.occurredAt)) fail('FUTURE_CAPTURE')
  const adopted = successful.find(({ call }) => isDeepStrictEqual(call.arguments, audit.raw))
  if (adopted === undefined) fail('AUTHOR_SUBMISSION_NOT_FOUND')
  if (adopted.binding.mode !== 'turn-sequence-v2') fail('AUTHOR_TURN_REQUIRED')
  const { call } = adopted
  const upstream = input.requiredUpstream.filter(id => id !== 'ProjectSeed').map(objectId => {
    const value = input.committedSnapshot[objectId]
    if (value === undefined || value.object_id !== objectId || value.project_id !== input.projectId) fail('UPSTREAM_SNAPSHOT_IDENTITY')
    return { objectId, revision: value.revision as number, value }
  })
  if (!isDeepStrictEqual(state.source_snapshot, Object.fromEntries(upstream.map(row => [row.objectId, row.revision])))) fail('SOURCE_SNAPSHOT')
  const upstreamBindings = upstream.map(({ objectId, revision, value }) => ({ objectId, revision, contentHash: rawJsonHash(value) }))
  const traceBindings = trace?.payload.analysisTrace?.parameters?.upstreamSnapshots
  if (traceBindings !== undefined && !isDeepStrictEqual(traceBindings, upstreamBindings)) fail('UPSTREAM_TRACE_HASH')
  const compiled = replayWorkflowAuthorProjection(audit, { childId: receipt.childId, raw: call.arguments }, {
    projectId: input.projectId, targetObjectId: input.targetObjectId, upstream,
    researchEvidence: trace?.payload.evidenceRecords, acceptedEvidenceIds: trace?.payload.researchValidation?.acceptedEvidenceIds,
  })
  if (!isDeepStrictEqual(compiled.payload.data, state.data)) fail('COMMITTED_DATA')
  if (!isDeepStrictEqual(compiled.payload.quality, state.quality)) fail('COMMITTED_QUALITY')
  return { protocol: WORKFLOW_AUTHOR_PROJECTION_VERSION, childId: receipt.childId, callId: call.callId, nativeBinding: adopted.binding,
    submittedHash: sha256CanonicalJson(compiled.payload.data), compiledHash: sha256CanonicalJson(compiled), upstreamBindings }
}
