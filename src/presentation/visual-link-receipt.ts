const IDENTITY_FIELDS = [
  'projectId',
  'runId',
  'pageId',
  'sourceStateHash',
  'requestId',
] as const

export interface VisualRequestIdentity {
  readonly projectId: string
  readonly runId: string
  readonly pageId: string
  readonly sourceStateHash: string
  readonly requestId: string
}

export interface VisualLinkReceipt extends VisualRequestIdentity {
  readonly kind: 'report-studio.visual-link-receipt.v1'
  readonly sessionId: string
  readonly proposalId: string
  readonly assetId: string
  readonly pageAssetId: string
  readonly revision: number
  readonly linkedAt: string
  readonly receiptHash: string
}

export interface PreVisualLinkRecord {
  readonly projectId: string
  readonly runId?: string
  readonly pageId: string
  readonly sourceStateHash: string
  readonly requestId: string
  readonly assetId: string
  readonly status: 'generated' | 'adopted_unlinked' | 'linked'
  readonly linkReceipt?: VisualLinkReceipt
}

function fail(code: string): never {
  throw Object.assign(new Error(code), { code })
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`invalid_visual_request_identity:${field}`)
  return value
}

function canonicalIdentity(value: VisualRequestIdentity): VisualRequestIdentity {
  return {
    projectId: requiredText(value.projectId, 'projectId'),
    runId: requiredText(value.runId, 'runId'),
    pageId: requiredText(value.pageId, 'pageId'),
    sourceStateHash: requiredText(value.sourceStateHash, 'sourceStateHash'),
    requestId: requiredText(value.requestId, 'requestId'),
  }
}

export function preVisualRequestIdentityKey<T extends VisualRequestIdentity>(value: T): string {
  const identity = canonicalIdentity(value)
  return IDENTITY_FIELDS
    .map(field => `${field.length}:${field}=${identity[field].length}:${identity[field]}`)
    .join('|')
}

function recordIdentityMatches(record: PreVisualLinkRecord, receipt: VisualLinkReceipt): boolean {
  if (record.projectId !== receipt.projectId) return false
  if (record.pageId !== receipt.pageId) return false
  if (record.sourceStateHash !== receipt.sourceStateHash) return false
  if (record.requestId !== receipt.requestId) return false
  return record.runId === undefined || record.runId === receipt.runId
}

function validateReceipt(receipt: VisualLinkReceipt): void {
  if (receipt.kind !== 'report-studio.visual-link-receipt.v1') fail('invalid_visual_link_receipt_kind')
  preVisualRequestIdentityKey(receipt)
  requiredText(receipt.sessionId, 'sessionId')
  requiredText(receipt.proposalId, 'proposalId')
  requiredText(receipt.assetId, 'assetId')
  requiredText(receipt.pageAssetId, 'pageAssetId')
  requiredText(receipt.linkedAt, 'linkedAt')
  requiredText(receipt.receiptHash, 'receiptHash')
  if (!Number.isSafeInteger(receipt.revision) || receipt.revision < 0) fail('invalid_visual_link_revision')
}

export function acknowledgePreVisualLink(
  record: PreVisualLinkRecord,
  receipt: VisualLinkReceipt,
): PreVisualLinkRecord {
  validateReceipt(receipt)
  if (!recordIdentityMatches(record, receipt)) fail('visual_request_identity_mismatch')
  if (record.assetId !== receipt.assetId) fail('visual_link_asset_mismatch')
  if (record.status !== 'adopted_unlinked' && record.status !== 'linked') fail('visual_link_not_adopted')

  if (record.linkReceipt) {
    if (
      record.status === 'linked'
      && record.linkReceipt.receiptHash === receipt.receiptHash
      && preVisualRequestIdentityKey(record.linkReceipt) === preVisualRequestIdentityKey(receipt)
      && record.linkReceipt.assetId === receipt.assetId
    ) return record
    fail('visual_link_receipt_conflict')
  }

  return {
    ...record,
    runId: receipt.runId,
    status: 'linked',
    linkReceipt: Object.freeze({ ...receipt }),
  }
}
