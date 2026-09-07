import { describe, expect, it } from 'vitest'

import {
  acknowledgePreVisualLink,
  preVisualRequestIdentityKey,
  type PreVisualLinkRecord,
  type VisualLinkReceipt,
} from '../src/presentation/visual-link-receipt.js'

const identity = {
  projectId: 'project-01',
  runId: 'run-01',
  pageId: 'page-01',
  sourceStateHash: 'sha256:source-01',
  requestId: 'request-01',
} as const

const receipt: VisualLinkReceipt = {
  kind: 'report-studio.visual-link-receipt.v1',
  sessionId: 'session-01',
  ...identity,
  proposalId: 'proposal-01',
  assetId: 'asset-01',
  pageAssetId: 'page-asset-01',
  revision: 8,
  linkedAt: '2026-09-07T06:00:00.000Z',
  receiptHash: 'sha256:receipt-01',
}

const record: PreVisualLinkRecord = {
  assetId: 'asset-01',
  ...identity,
  status: 'adopted_unlinked',
}

describe('Pre visual link receipt boundary', () => {
  it('uses run, page, source hash and request id as the stable task identity', () => {
    expect(preVisualRequestIdentityKey(identity)).toBe(
      preVisualRequestIdentityKey({ ...identity, proposalId: 'internal-handle-is-irrelevant' }),
    )
  })

  it('closes adopted_unlinked only after the exact Presentation receipt arrives', () => {
    const linked = acknowledgePreVisualLink(record, receipt)
    expect(linked.status).toBe('linked')
    expect(linked.linkReceipt).toEqual(receipt)
    expect(acknowledgePreVisualLink(linked, receipt)).toBe(linked)
  })

  it('rejects a receipt from another run even when every other field matches', () => {
    expect(() => acknowledgePreVisualLink(record, { ...receipt, runId: 'run-02' }))
      .toThrow(/visual_request_identity_mismatch/)
  })

  it('rejects a receipt for another generated asset', () => {
    expect(() => acknowledgePreVisualLink(record, { ...receipt, assetId: 'asset-02' }))
      .toThrow(/visual_link_asset_mismatch/)
  })

  it('binds one legacy adopted_unlinked record to its first exact run receipt but never rebinds it', () => {
    const { runId: _runId, ...legacy } = record
    const linked = acknowledgePreVisualLink(legacy, receipt)
    expect(linked.runId).toBe('run-01')
    expect(() => acknowledgePreVisualLink(linked, { ...receipt, runId: 'run-02', receiptHash: 'sha256:receipt-02' }))
      .toThrow(/visual_request_identity_mismatch/)
  })
})
