import { createHash } from 'node:crypto'
import type { ImageBlock } from '@deepseek-ai/dsh-llm'
import type { ActorRef } from '../state/types.ts'
import { normalizeSiteBoundaryGeometry } from './site-boundary-geometry.ts'
import { SiteBoundaryAssetStore } from './site-boundary-asset-store.ts'
import { renderSiteBoundarySvg } from './site-boundary-svg.ts'
import { SITE_BOUNDARY_PROVISIONAL_REVISION, type GovernanceRepository } from './repository.ts'
import type { SiteBoundaryAttachmentEvidence, SiteBoundaryOrigin, SiteBoundaryRecord, VisualAssetRecord } from './types.ts'

const CONFIRMATION_STATEMENT = '该图是本项目采用的总平图或红线图，且图中明确表达项目边界'
const GUIDANCE: Readonly<Record<string, string>> = {
  SITE_BOUNDARY_CONTEXT_INVALID: '场地边界只能由当前 DSH 自然人命令登记。',
  SITE_BOUNDARY_SYNTHETIC_NOT_CONFIRMABLE: '模拟研究范围不可正式确认，请由项目负责人提交真实边界。',
  SITE_BOUNDARY_PERMISSION_DENIED: '仅项目负责人可以登记或确认场地边界。',
  SITE_BOUNDARY_ATTACHMENT_INVALID: '附件必须是已核验的 PNG、JPEG 或 WebP 场地资料。',
  SITE_BOUNDARY_OPERATION_ABORTED: '场地边界提交已取消，未写入任何资料。',
  SITE_BOUNDARY_SYNTHETIC_REPLAY_FORBIDDEN: '模拟研究附件不能重放或升级为人工正式边界，请提交不同的真实资料。',
  SITE_BOUNDARY_LEGACY_ASSET_INVALID: '旧版 assetId 仅兼容当前项目已采用且可核验的人工图像证据。',
  SITE_BOUNDARY_PENDING_NOT_FOUND: '未找到可确认的场地边界记录。',
  SITE_BOUNDARY_REVISION_INVALID: '确认 Revision 必须与待确认边界的提交 Revision 一致。',
  SITE_BOUNDARY_CONFIRMATION_ACKNOWLEDGEMENT_REQUIRED: '确认场地边界必须显式提交规范声明。',
  SITE_BOUNDARY_CONFIRMATION_ACKNOWLEDGEMENT_INVALID: '确认声明必须绑定当前边界、Revision 与内容 SHA。',
  SITE_BOUNDARY_INTEGRITY_FAILED: '场地边界附件或派生图完整性校验失败，请重新提交。',
  SITE_BOUNDARY_FILE_MISSING: '场地边界附件、派生图或校验记录缺失，请重新提交。',
  SITE_BOUNDARY_FILE_SHA_MISMATCH: '场地边界附件或派生图内容已变化，请重新提交。',
  SITE_BOUNDARY_LINEAGE_MISMATCH: '场地边界记录与采用资产来源不一致，请重新提交。',
  SITE_BOUNDARY_FORMAL_NOT_FOUND: '当前 Revision 没有可用的正式场地边界。',
}

type BoundaryPort = Pick<GovernanceRepository, 'readProject' | 'putSiteBoundary' | 'putPendingSiteBoundary' | 'confirmSiteBoundary'>
type BoundaryAssetSource = 'approved_site_plan' | 'approved_redline'

export interface SiteBoundaryExecutionContext {
  readonly actor: ActorRef
  readonly channel: 'dsh_human_command' | 'synthetic_fixture'
}

export interface SiteBoundaryAcknowledgement {
  readonly boundaryId: string
  readonly submittedRevision: number
  readonly contentSha256: string
  readonly statement: string
}

function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function fail(code: keyof typeof GUIDANCE): never {
  throw new Error(`${code}：${GUIDANCE[code]}`)
}

function geometryFailure(error: unknown): never {
  const code = error instanceof Error ? error.message.match(/^SITE_BOUNDARY_[A-Z_]+/u)?.[0] : undefined
  if (code !== undefined) throw new Error(`${code}：场地边界坐标或 GeoJSON 不符合要求，请核对 CRS、闭合关系和自相交后重试。`)
  fail('SITE_BOUNDARY_INTEGRITY_FAILED')
}

function originFor(
  channel: SiteBoundaryExecutionContext['channel'],
  userOrigin: Exclude<SiteBoundaryOrigin, 'synthetic'>,
): SiteBoundaryOrigin {
  return channel === 'synthetic_fixture' ? 'synthetic' : userOrigin
}

function requireDecisionOwner(context: SiteBoundaryExecutionContext): void {
  if (context.actor.role !== 'decision_owner') fail('SITE_BOUNDARY_PERMISSION_DENIED')
}

function requireHumanCommand(context: SiteBoundaryExecutionContext): void {
  requireDecisionOwner(context)
  if (context.channel !== 'dsh_human_command') fail('SITE_BOUNDARY_CONTEXT_INVALID')
}

function assetForSidecar(asset: VisualAssetRecord): VisualAssetRecord {
  const { adoptedRevision: _adoptedRevision, ...candidate } = asset
  return { ...candidate, status: 'candidate' }
}

function sameActor(left: ActorRef, right: ActorRef): boolean {
  return left.actorId === right.actorId && left.name === right.name && left.role === right.role
}

function sameEvidence(left: SiteBoundaryAttachmentEvidence, right: SiteBoundaryAttachmentEvidence): boolean {
  return left.origin === right.origin
    && left.attachmentId === right.attachmentId
    && left.mediaType === right.mediaType
    && left.displayName === right.displayName
    && left.bytes === right.bytes
    && left.width === right.width
    && left.height === right.height
    && left.storageSha256 === right.storageSha256
    && sameActor(left.submittedBy, right.submittedBy)
    && left.submittedRevision === right.submittedRevision
}

function isProvisional(record: SiteBoundaryRecord): boolean {
  return record.status === 'confirmed_formal_boundary' && record.confirmedRevision === SITE_BOUNDARY_PROVISIONAL_REVISION
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error !== null && typeof error === 'object' && (error as { readonly name?: unknown }).name === 'AbortError')
}

function classifiedIntegrityFailure(error: unknown): keyof typeof GUIDANCE | undefined {
  const code = error !== null && typeof error === 'object'
    ? (error as NodeJS.ErrnoException).code
    : undefined
  if (code === 'ENOENT') return 'SITE_BOUNDARY_FILE_MISSING'
  const message = error instanceof Error ? error.message : ''
  if (message === 'canonical sidecar is missing or unreadable') return 'SITE_BOUNDARY_FILE_MISSING'
  if (message === 'visual asset integrity SHA-256 drift detected') return 'SITE_BOUNDARY_FILE_SHA_MISMATCH'
  if (message === 'visual asset does not match its canonical sidecar identity'
    || message.startsWith('canonical sidecar')) return 'SITE_BOUNDARY_LINEAGE_MISMATCH'
  return undefined
}

function isStrictHumanEvidence(asset: VisualAssetRecord): boolean {
  return asset.kind === 'evidence'
    && asset.boundaryEvidence?.origin === 'user_image'
    && asset.boundaryEvidence.storageSha256 === asset.sha256
    && asset.provider === undefined && asset.model === undefined && asset.promptSummary === undefined
}

export function boundaryIntegrityDigest(record: SiteBoundaryRecord): string {
  return sha({
    boundaryId: record.boundaryId,
    confirmedRevision: record.confirmedRevision,
    source: record.source,
    sourceSha256: record.sourceAsset?.sha256,
    geometrySha256: record.geometry?.sha256,
  })
}

export function selectConfirmedSiteBoundary(
  records: readonly SiteBoundaryRecord[],
  revision: number,
): SiteBoundaryRecord | undefined {
  return records
    .filter(record => record.status === 'confirmed_formal_boundary'
      && record.origin !== 'synthetic'
      && record.submissionChannel === 'dsh_human_command'
      && record.confirmationChannel === 'dsh_human_command'
      && record.confirmedBy?.role === 'decision_owner'
      && record.confirmedAt !== undefined
      && record.confirmationStatement === CONFIRMATION_STATEMENT
      && record.confirmationSourceSha256 === (record.sourceAsset?.sha256 ?? record.geometry?.sha256)
      && record.confirmedRevision !== undefined && record.confirmedRevision !== SITE_BOUNDARY_PROVISIONAL_REVISION && record.confirmedRevision <= revision
      && ((record.source === 'approved_site_plan' || record.source === 'approved_redline')
        ? record.sourceAsset?.sha256 !== undefined && record.sourceAsset.attachment !== undefined
        : (record.source === 'closed_coordinates' || record.source === 'geojson') && record.geometry?.sha256 !== undefined))
    .sort((left, right) => (right.confirmedRevision! - left.confirmedRevision!)
      || right.confirmedAt!.localeCompare(left.confirmedAt!)
      || right.boundaryId.localeCompare(left.boundaryId))[0]
}

export class SiteBoundaryService {
  constructor(
    private readonly governance: BoundaryPort,
    private readonly assets: SiteBoundaryAssetStore,
    private readonly now: () => string,
    _createId: () => string,
  ) {}

  async registerImageAttachment(
    projectId: string,
    input: { readonly source: BoundaryAssetSource; readonly block: ImageBlock; readonly submittedRevision: number; readonly signal: AbortSignal },
    context: SiteBoundaryExecutionContext,
  ): Promise<SiteBoundaryRecord> {
    requireDecisionOwner(context)
    if (input.signal.aborted) fail('SITE_BOUNDARY_OPERATION_ABORTED')
    let asset: VisualAssetRecord
    try {
      asset = await this.assets.ingestImage({ ...input, projectId, actor: context.actor })
    } catch (error) {
      if (isAbort(error, input.signal)) fail('SITE_BOUNDARY_OPERATION_ABORTED')
      fail('SITE_BOUNDARY_ATTACHMENT_INVALID')
    }
    if (input.signal.aborted) fail('SITE_BOUNDARY_OPERATION_ABORTED')
    if (!isStrictHumanEvidence(asset) || asset.boundaryEvidence === undefined) fail('SITE_BOUNDARY_ATTACHMENT_INVALID')
    if (!sameActor(asset.boundaryEvidence.submittedBy, context.actor) || asset.boundaryEvidence.submittedRevision !== input.submittedRevision) {
      fail('SITE_BOUNDARY_SYNTHETIC_REPLAY_FORBIDDEN')
    }
    return this.putPending(projectId, input.submittedRevision, input.source, originFor(context.channel, 'user_image'), context, {
      sourceAsset: { assetId: asset.assetId, fileName: asset.fileName, sha256: asset.sha256, attachment: asset.boundaryEvidence },
    }, asset)
  }

  async registerLegacyAsset(
    projectId: string,
    input: { readonly source: BoundaryAssetSource; readonly assetId: string; readonly submittedRevision: number },
    context: SiteBoundaryExecutionContext,
  ): Promise<SiteBoundaryRecord> {
    requireHumanCommand(context)
    const asset = this.governance.readProject(projectId).visualAssets.find(candidate => candidate.assetId === input.assetId)
    if (asset === undefined || asset.projectId !== projectId || asset.status !== 'adopted' || !isStrictHumanEvidence(asset)
      || asset.boundaryEvidence === undefined) fail('SITE_BOUNDARY_LEGACY_ASSET_INVALID')
    if (this.hasProvisionalReference(projectId, asset.assetId)) fail('SITE_BOUNDARY_INTEGRITY_FAILED')
    await this.verifyAsset(asset)
    return this.putPending(projectId, input.submittedRevision, input.source, 'user_image', context, {
      sourceAsset: { assetId: asset.assetId, fileName: asset.fileName, sha256: asset.sha256, attachment: asset.boundaryEvidence },
    })
  }

  async registerGeometry(
    projectId: string,
    input: { readonly crs: string; readonly payload: unknown; readonly submittedRevision: number; readonly projectName: string },
    context: SiteBoundaryExecutionContext,
  ): Promise<SiteBoundaryRecord> {
    requireDecisionOwner(context)
    let geometry: ReturnType<typeof normalizeSiteBoundaryGeometry>
    let rendered: ReturnType<typeof renderSiteBoundarySvg>
    try {
      geometry = normalizeSiteBoundaryGeometry(input.crs.trim(), input.payload)
      rendered = renderSiteBoundarySvg({ projectName: input.projectName, sourceDate: this.now().slice(0, 10), geometry })
    } catch (error) {
      geometryFailure(error)
    }
    let asset: VisualAssetRecord
    try {
      asset = await this.assets.saveGeometrySvg({ projectId, source: geometry.source, geometrySha256: geometry.sha256, svg: rendered.svg })
    } catch {
      fail('SITE_BOUNDARY_INTEGRITY_FAILED')
    }
    if (asset.kind !== 'deterministic' || asset.boundaryGeometrySha256 !== geometry.sha256 || asset.sha256 !== rendered.sha256) {
      fail('SITE_BOUNDARY_INTEGRITY_FAILED')
    }
    return this.putPending(projectId, input.submittedRevision, geometry.source, originFor(context.channel, geometry.source === 'geojson' ? 'user_geojson' : 'user_coordinates'), context, {
      geometry: {
        crs: geometry.crs, coordinates: geometry.coordinates, sha256: geometry.sha256,
        derivedAssetId: asset.assetId, derivedFileName: asset.fileName, derivedSha256: asset.sha256,
      },
    }, asset)
  }

  async confirm(
    projectId: string,
    boundaryId: string,
    confirmedRevision: number,
    context: SiteBoundaryExecutionContext,
  ): Promise<SiteBoundaryRecord>
  async confirm(
    projectId: string,
    boundaryId: string,
    confirmedRevision: number,
    acknowledgement: SiteBoundaryAcknowledgement,
    context: SiteBoundaryExecutionContext,
  ): Promise<SiteBoundaryRecord>
  async confirm(
    projectId: string,
    boundaryId: string,
    confirmedRevision: number,
    acknowledgementOrContext: SiteBoundaryAcknowledgement | SiteBoundaryExecutionContext,
    context?: SiteBoundaryExecutionContext,
  ): Promise<SiteBoundaryRecord> {
    if (context === undefined) {
      const legacyContext = acknowledgementOrContext as SiteBoundaryExecutionContext
      const legacyRecord = this.governance.readProject(projectId).siteBoundaries.find(candidate => candidate.boundaryId === boundaryId)
      if (legacyContext.channel === 'synthetic_fixture' || legacyRecord?.origin === 'synthetic') {
        fail('SITE_BOUNDARY_SYNTHETIC_NOT_CONFIRMABLE')
      }
      fail('SITE_BOUNDARY_CONFIRMATION_ACKNOWLEDGEMENT_REQUIRED')
    }
    const acknowledgement = acknowledgementOrContext as SiteBoundaryAcknowledgement
    if (context.channel === 'synthetic_fixture') fail('SITE_BOUNDARY_SYNTHETIC_NOT_CONFIRMABLE')
    requireHumanCommand(context)
    const project = this.governance.readProject(projectId)
    const pending = project.siteBoundaries.find(candidate => candidate.boundaryId === boundaryId
      && (candidate.status === 'pending_confirmation' || isProvisional(candidate)))
    if (pending === undefined) fail('SITE_BOUNDARY_PENDING_NOT_FOUND')
    if (pending.origin === 'synthetic' || pending.submissionChannel !== 'dsh_human_command') fail('SITE_BOUNDARY_SYNTHETIC_NOT_CONFIRMABLE')
    if (pending.submittedBy.role !== 'decision_owner' || confirmedRevision !== pending.submittedRevision) fail('SITE_BOUNDARY_REVISION_INVALID')
    const contentSha256 = pending.sourceAsset?.sha256 ?? pending.geometry?.sha256
    if (acknowledgement.boundaryId !== pending.boundaryId
      || acknowledgement.submittedRevision !== pending.submittedRevision
      || acknowledgement.contentSha256 !== contentSha256
      || acknowledgement.statement !== CONFIRMATION_STATEMENT) {
      fail('SITE_BOUNDARY_CONFIRMATION_ACKNOWLEDGEMENT_INVALID')
    }
    const assetId = pending.sourceAsset?.assetId ?? pending.geometry?.derivedAssetId
    const asset = assetId === undefined ? undefined : project.visualAssets.find(candidate => candidate.assetId === assetId)
    if (asset === undefined || asset.projectId !== projectId) fail('SITE_BOUNDARY_INTEGRITY_FAILED')
    await this.verifyRecordAsset(pending, asset)
    const formal: SiteBoundaryRecord = {
      ...pending, status: 'confirmed_formal_boundary', confirmedBy: context.actor, confirmedAt: this.now(), confirmedRevision,
      confirmationChannel: 'dsh_human_command', confirmationStatement: acknowledgement.statement,
      confirmationSourceSha256: acknowledgement.contentSha256,
    }
    if (asset.status === 'candidate') {
      return this.governance.confirmSiteBoundary({
        formal, candidate: asset, adopted: { ...asset, status: 'adopted', adoptedRevision: confirmedRevision },
      })
    }
    if (asset.status !== 'adopted' || asset.adoptedRevision !== confirmedRevision) fail('SITE_BOUNDARY_INTEGRITY_FAILED')
    return this.governance.putSiteBoundary(formal)
  }

  async assertFormalBoundaryIntegrity(projectId: string, revision: number): Promise<{
    readonly record: SiteBoundaryRecord
    readonly asset: VisualAssetRecord
    readonly integrityDigest: string
  }> {
    const { bytes: _bytes, ...integrity } = await this.captureFormalBoundarySnapshot(projectId, revision)
    return integrity
  }

  async captureFormalBoundarySnapshot(projectId: string, revision: number): Promise<{
    readonly record: SiteBoundaryRecord
    readonly asset: VisualAssetRecord
    readonly integrityDigest: string
    readonly bytes: Buffer
  }> {
    const project = this.governance.readProject(projectId)
    const record = selectConfirmedSiteBoundary(project.siteBoundaries, revision)
    if (record === undefined || record.projectId !== projectId) fail('SITE_BOUNDARY_FORMAL_NOT_FOUND')
    const assetId = record.sourceAsset?.assetId ?? record.geometry?.derivedAssetId
    const asset = assetId === undefined ? undefined : project.visualAssets.find(candidate => candidate.assetId === assetId)
    if (asset === undefined || asset.projectId !== projectId || asset.status !== 'adopted' || asset.adoptedRevision !== record.confirmedRevision) {
      fail('SITE_BOUNDARY_LINEAGE_MISMATCH')
    }
    const bytes = await this.verifyRecordAsset(record, asset, true)
    return { record, asset, integrityDigest: boundaryIntegrityDigest(record), bytes }
  }

  private async verifyRecordAsset(
    record: SiteBoundaryRecord,
    asset: VisualAssetRecord,
    classifyForExport = false,
  ): Promise<Buffer> {
    const direct = record.sourceAsset
    const geometry = record.geometry
    const matches = direct === undefined
      ? geometry !== undefined && asset.kind === 'deterministic' && asset.assetId === geometry.derivedAssetId
        && asset.fileName === geometry.derivedFileName && asset.sha256 === geometry.derivedSha256 && asset.boundaryGeometrySha256 === geometry.sha256
      : isStrictHumanEvidence(asset) && asset.assetId === direct.assetId && asset.fileName === direct.fileName && asset.sha256 === direct.sha256
        && direct.attachment !== undefined && asset.boundaryEvidence !== undefined
        && sameEvidence(asset.boundaryEvidence, direct.attachment)
        && sameActor(direct.attachment.submittedBy, record.submittedBy)
        && direct.attachment.submittedRevision === record.submittedRevision
    if (!matches) fail(classifyForExport ? 'SITE_BOUNDARY_LINEAGE_MISMATCH' : 'SITE_BOUNDARY_INTEGRITY_FAILED')
    return this.verifyAsset(asset, classifyForExport)
  }

  private async verifyAsset(asset: VisualAssetRecord, classifyForExport = false): Promise<Buffer> {
    try {
      return (await this.assets.readVerifiedVisualAsset(assetForSidecar(asset))).bytes
    } catch (error) {
      if (classifyForExport) {
        const classified = classifiedIntegrityFailure(error)
        if (classified !== undefined) fail(classified)
      }
      fail('SITE_BOUNDARY_INTEGRITY_FAILED')
    }
  }

  private hasProvisionalReference(projectId: string, assetId: string): boolean {
    return this.governance.readProject(projectId).siteBoundaries.some(record => isProvisional(record)
      && (record.sourceAsset?.assetId === assetId || record.geometry?.derivedAssetId === assetId))
  }

  private putPending(
    projectId: string,
    submittedRevision: number,
    source: SiteBoundaryRecord['source'],
    origin: SiteBoundaryOrigin,
    context: SiteBoundaryExecutionContext,
    payload: Pick<SiteBoundaryRecord, 'sourceAsset' | 'geometry'>,
    asset?: VisualAssetRecord,
  ): Promise<SiteBoundaryRecord> {
    const contentSha256 = payload.sourceAsset?.sha256 ?? payload.geometry?.sha256
    if (contentSha256 === undefined) fail('SITE_BOUNDARY_INTEGRITY_FAILED')
    const boundaryId = createHash('sha256')
      .update(`${projectId}\u0000${source}\u0000${origin}\u0000${contentSha256}`)
      .digest('hex')
    return this.governance.putPendingSiteBoundary({
      boundaryId, projectId, submittedRevision, status: 'pending_confirmation', source, origin,
      submissionChannel: context.channel, submittedBy: context.actor, submittedAt: this.now(), ...payload,
    }, asset)
  }
}
