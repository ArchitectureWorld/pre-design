import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { WORKFLOW_AUTHOR_PROJECTION_VERSION, createWorkflowAuthorAudit, createWorkflowAuthorContext, compileWorkflowAuthorProjection } from '../src/runtime/workflow-author-projection.ts'
import { replayWorkflowNativeReceipt } from '../src/runtime/workflow-native-receipt-replay.ts'

const jsonHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function fixture() {
  const upstream = { object_id: 'PS02', project_id: 'project', revision: 6, data: { decision: '工作假设', evidence_refs: [{ claim_class: 'assumption' }] } }
  const context = createWorkflowAuthorContext({ projectId: 'project', targetObjectId: 'PS03', capturedAt: '2026-09-26T13:00:00Z',
    upstream: [{ objectId: 'PS02', revision: 6, value: upstream }] })
  const raw = { projectionVersion: WORKFLOW_AUTHOR_PROJECTION_VERSION, data: { scope: '历史范围，需补测', evidence_refs: [
    { upstream: 'U1', pointer: '/data/decision', claimClass: 'assumption', notes: '限制仍保留' },
  ] }, quality: { completeness: 0.7 }, qualityEvidence: { confidence: 0.6, assumptions: ['需补测'] } }
  const audit = createWorkflowAuthorAudit(raw, context, 'native-child')
  const compiled = compileWorkflowAuthorProjection(raw, context)
  return { projectId: 'project', targetObjectId: 'PS03', requiredUpstream: ['PS02'], expectedChildId: 'native-child',
    expectedModel: { provider: 'provider', model: 'model' },
    state: { ...compiled.payload, source_snapshot: { PS02: 6 } },
    committedSnapshot: { PS02: structuredClone(upstream) },
    trace: { occurredAt: '2026-09-26T13:01:00Z', payload: { authorProjection: audit, evidenceRecords: [],
      researchValidation: { acceptedEvidenceIds: [] }, analysisTrace: { parameters: {
        upstreamSnapshots: [{ objectId: 'PS02', revision: 6, contentHash: jsonHash(upstream) }],
      } } } },
    receipt: { childId: 'native-child', calls: [{ seq: 4, turn: 1, callId: 'call', arguments: structuredClone(raw) }],
      results: [{ seq: 5, turn: 1, callId: 'call', isError: false }], requests: [{ seq: 3, turn: 1, model: { provider: 'provider', model: 'model' } }],
      endings: [{ seq: 6, turn: 1, reason: { kind: 'completed' } }] },
  }
}

describe('independent native workflow receipt acceptance', () => {
  it('replays the actual versioned native call against independently stored committed upstream values', () => {
    expect(replayWorkflowNativeReceipt(fixture())).toMatchObject({ protocol: WORKFLOW_AUTHOR_PROJECTION_VERSION,
      childId: 'native-child', callId: 'call', upstreamBindings: [{ objectId: 'PS02', revision: 6, contentHash: expect.any(String) }] })
  })

  it.each(['raw', 'data', 'quality', 'child', 'model', 'nativeResult', 'nativeEnd', 'snapshotValue', 'snapshotRevision',
    'snapshotProject', 'snapshotMissing', 'snapshotOrder', 'traceHash', 'sourceSnapshot', 'futureCapture', 'unknownVersion', 'mixedEnvelope'] as const)
    ('rejects %s drift instead of accepting a self-consistent audit', (change) => {
      const input = fixture() as any
      if (change === 'raw') input.receipt.calls[0].arguments.data.scope = 'other'
      if (change === 'data') input.state.data.scope = 'other'
      if (change === 'quality') input.state.quality.completeness = 1
      if (change === 'child') input.receipt.childId = 'another-child'
      if (change === 'model') input.receipt.requests[0].model.model = 'another-model'
      if (change === 'nativeResult') input.receipt.results[0].isError = true
      if (change === 'nativeEnd') input.receipt.endings[0].reason.kind = 'error'
      if (change === 'snapshotValue') input.committedSnapshot.PS02.data.decision = 'other'
      if (change === 'snapshotRevision') input.committedSnapshot.PS02.revision = 7
      if (change === 'snapshotProject') input.committedSnapshot.PS02.project_id = 'other-project'
      if (change === 'snapshotMissing') delete input.committedSnapshot.PS02
      if (change === 'snapshotOrder') input.requiredUpstream = ['PS02', 'PS01']
      if (change === 'traceHash') input.trace.payload.analysisTrace.parameters.upstreamSnapshots[0].contentHash = 'wrong'
      if (change === 'sourceSnapshot') input.state.source_snapshot.PS02 = 7
      if (change === 'futureCapture') input.trace.occurredAt = '2026-09-26T12:00:00Z'
      if (change === 'unknownVersion') input.trace.payload.authorProjection.version = 'unknown'
      if (change === 'mixedEnvelope') input.receipt.calls[0].arguments.payload = { data: input.state.data }
      expect(() => replayWorkflowNativeReceipt(input)).toThrow()
    })

  it('compares exact native text even when Unicode normalization hashes would agree', () => {
    const input = fixture() as any
    input.trace.payload.authorProjection.raw.data.scope = 'e\u0301'
    input.receipt.calls[0].arguments.data.scope = 'é'
    expect(() => replayWorkflowNativeReceipt(input)).toThrow()
  })

  it('retains explicitly identified legacy full-payload receipts without inventing a new-protocol audit', () => {
    const input = fixture() as any
    delete input.trace.payload.authorProjection
    input.receipt.calls[0].arguments = { payload: structuredClone(input.state), qualityEvidence: { confidence: 0.6 } }
    expect(replayWorkflowNativeReceipt(input)).toMatchObject({ protocol: 'legacy-full-payload', childId: 'native-child', callId: 'call' })
    input.receipt.calls[0].arguments.projectionVersion = WORKFLOW_AUTHOR_PROJECTION_VERSION
    expect(() => replayWorkflowNativeReceipt(input)).toThrow()
  })

  it('does not reinterpret a new projection as a legacy receipt when its audit is missing', () => {
    const input = fixture() as any
    delete input.trace.payload.authorProjection
    expect(() => replayWorkflowNativeReceipt(input)).toThrow()
  })

  it.each(['unrelatedRequest', 'laterCompletedTurn', 'earlierCompletedTurn', 'wrongTurn', 'resultAfterTerminal'])
    ('binds the adopted call to its own request and completed turn: %s', (change) => {
      const input = fixture() as any
      if (change === 'unrelatedRequest') {
        input.receipt.requests[0].model.model = 'wrong-model'
        input.receipt.requests.push({ seq: 8, turn: 2, model: input.expectedModel })
        input.receipt.endings.push({ seq: 10, turn: 2, reason: { kind: 'completed' } })
      }
      if (change === 'laterCompletedTurn') {
        input.receipt.endings[0].reason.kind = 'error'
        input.receipt.endings.push({ seq: 10, turn: 2, reason: { kind: 'completed' } })
      }
      if (change === 'earlierCompletedTurn') {
        input.receipt.endings[0].reason.kind = 'error'
        input.receipt.endings.unshift({ seq: 1, turn: 0, reason: { kind: 'completed' } })
      }
      if (change === 'wrongTurn') input.receipt.calls[0].turn = 2
      if (change === 'resultAfterTerminal') input.receipt.results[0].seq = 9
      expect(() => replayWorkflowNativeReceipt(input)).toThrow()
    })

  it('retains an earlier accepted completed call when a later independent turn fails', () => {
    const input = fixture() as any
    input.receipt.requests.push({ seq: 8, turn: 2, model: { provider: 'other-provider', model: 'other-model' } })
    input.receipt.endings.push({ seq: 10, turn: 2, reason: { kind: 'error' } })
    expect(replayWorkflowNativeReceipt(input).callId).toBe('call')
  })

  it('requires explicit request/turn binding for a new-protocol receipt', () => {
    const input = fixture() as any
    for (const rows of [input.receipt.calls, input.receipt.results, input.receipt.requests, input.receipt.endings]) {
      for (const row of rows) delete row.turn
    }
    delete input.receipt.results[0].seq
    expect(() => replayWorkflowNativeReceipt(input)).toThrow()
    delete input.trace.payload.authorProjection
    input.receipt.calls[0].arguments = { payload: input.state, qualityEvidence: { confidence: 0.6 } }
    expect(replayWorkflowNativeReceipt(input).nativeBinding.mode).toBe('sequence-v1')
  })

  it('does not borrow the previous completed turn request or another step for its call', () => {
    const input = fixture() as any
    input.receipt.endings.unshift({ seq: 3, turn: 0, reason: { kind: 'completed' } })
    input.receipt.requests[0].seq = 2
    expect(() => replayWorkflowNativeReceipt(input)).toThrow()
    const wrongStep = fixture() as any
    wrongStep.receipt.calls[0].step = 2
    wrongStep.receipt.requests[0].step = 1
    wrongStep.receipt.results[0].step = 2
    expect(() => replayWorkflowNativeReceipt(wrongStep)).toThrow()
  })
})
