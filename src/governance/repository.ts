import type { Domain, DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { isDeepStrictEqual } from 'node:util'
import {
  preplanningGovernanceDomainSpec,
  preplanningSyntheticBoundaryFingerprintDomainSpec,
  validateSiteBoundaryRecord,
} from './domain.ts'
import type { SiteBoundaryStorageRecord, SyntheticBoundaryFingerprintStorageRecord } from './domain.ts'
import type {
  AutomationAuthorizationRecord,
  GateDecisionRecord,
  GovernanceProjectContext,
  ProjectPolicyRecord,
  ReportPackageRecord,
  SiteBoundaryRecord,
  VisualAssetRecord,
  VisualGenerationPolicyRecord,
  VisualTaskRecord,
  WorkflowRunRecord,
} from './types.ts'

type GovernanceDomain = Domain<typeof preplanningGovernanceDomainSpec>
type SyntheticFingerprintDomain = Domain<typeof preplanningSyntheticBoundaryFingerprintDomainSpec>

export const SITE_BOUNDARY_PROVISIONAL_REVISION = Number.MAX_SAFE_INTEGER

export interface SiteBoundaryConfirmationWrite {
  readonly formal: SiteBoundaryRecord
  readonly candidate: VisualAssetRecord
  readonly adopted: VisualAssetRecord
}

export type SiteBoundaryFingerprint =
  | Readonly<{ readonly storageSha256: string; readonly geometrySha256?: never }>
  | Readonly<{ readonly storageSha256?: never; readonly geometrySha256: string }>

export interface SyntheticBoundaryFingerprintMatch extends SyntheticBoundaryFingerprintStorageRecord {
  readonly record?: SiteBoundaryRecord
}

function boundaryIdentity(record: SiteBoundaryRecord): Pick<SiteBoundaryRecord,
  'boundaryId' | 'projectId' | 'submittedRevision' | 'source' | 'origin' | 'submissionChannel' | 'sourceAsset' | 'geometry' | 'submittedBy' | 'submittedAt'
> {
  const { boundaryId, projectId, submittedRevision, source, origin, submissionChannel, sourceAsset, geometry, submittedBy, submittedAt } = record
  return { boundaryId, projectId, submittedRevision, source, origin, submissionChannel, sourceAsset, geometry, submittedBy, submittedAt }
}

function pendingBoundaryIdentity(record: SiteBoundaryRecord): Omit<ReturnType<typeof boundaryIdentity>, 'submittedAt'> {
  const { submittedAt: _submittedAt, ...identity } = boundaryIdentity(record)
  return identity
}

function isCandidate(asset: VisualAssetRecord | undefined, candidate: VisualAssetRecord): boolean {
  return asset !== undefined && asset.status === 'candidate' && isDeepStrictEqual(asset, candidate)
}

function isAdopted(asset: VisualAssetRecord | undefined, adopted: VisualAssetRecord): boolean {
  return asset !== undefined && asset.status === 'adopted' && isDeepStrictEqual(asset, adopted)
}

function sha256(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error('SITE_BOUNDARY_FINGERPRINT_INVALID')
  return value
}

function fingerprintKey(input: SiteBoundaryFingerprint): string {
  if (input.storageSha256 !== undefined && input.geometrySha256 === undefined) return `image:${sha256(input.storageSha256)}`
  if (input.geometrySha256 !== undefined && input.storageSha256 === undefined) return `geometry:${sha256(input.geometrySha256)}`
  throw new Error('SITE_BOUNDARY_FINGERPRINT_INVALID')
}

function recordFingerprint(record: SiteBoundaryRecord): SiteBoundaryFingerprint {
  const storageSha256 = record.sourceAsset?.attachment?.storageSha256
  if (storageSha256 !== undefined && record.geometry === undefined) return { storageSha256 }
  if (record.geometry?.sha256 !== undefined && record.sourceAsset === undefined) return { geometrySha256: record.geometry.sha256 }
  throw new Error('SITE_BOUNDARY_FINGERPRINT_INVALID')
}

function sameAssetIdentity(left: VisualAssetRecord, right: VisualAssetRecord): boolean {
  const { status: _leftStatus, adoptedRevision: _leftAdoptedRevision, ...leftIdentity } = left
  const { status: _rightStatus, adoptedRevision: _rightAdoptedRevision, ...rightIdentity } = right
  return isDeepStrictEqual(leftIdentity, rightIdentity)
}

export class GovernanceRepository {
  private chain: Promise<void> = Promise.resolve()

  private constructor(
    private readonly domain: GovernanceDomain,
    private readonly syntheticFingerprints: SyntheticFingerprintDomain,
  ) {}

  static async open(facility: DomainFacility): Promise<GovernanceRepository> {
    const domain = await facility.open(preplanningGovernanceDomainSpec)
    const syntheticFingerprints = await facility.open(preplanningSyntheticBoundaryFingerprintDomainSpec)
    return new GovernanceRepository(domain, syntheticFingerprints)
  }

  async close(): Promise<void> {
    await this.domain.close()
    await this.syntheticFingerprints.close()
  }

  createPolicy(record: ProjectPolicyRecord): Promise<ProjectPolicyRecord> {
    return this.serialize(async () => {
      const table = this.domain.table('project_policies')
      if (table.get(record.projectId) !== undefined) {
        throw new Error(`project policy '${record.projectId}' already exists`)
      }
      await table.put(record.projectId, record)
      return record
    })
  }

  putPolicy(record: ProjectPolicyRecord): Promise<ProjectPolicyRecord> {
    return this.put(this.domain.table('project_policies'), record.projectId, record)
  }

  putAuthorization(record: AutomationAuthorizationRecord): Promise<AutomationAuthorizationRecord> {
    return this.put(this.domain.table('authorizations'), record.authorizationId, record)
  }

  putWorkflowRun(record: WorkflowRunRecord): Promise<WorkflowRunRecord> {
    return this.put(this.domain.table('workflow_runs'), record.runId, record)
  }

  putGateDecision(record: GateDecisionRecord): Promise<GateDecisionRecord> {
    return this.put(this.domain.table('gate_decisions'), record.decisionId, record)
  }

  putVisualPolicy(record: VisualGenerationPolicyRecord): Promise<VisualGenerationPolicyRecord> {
    return this.put(this.domain.table('visual_policies'), record.policyId, record)
  }

  putVisualTask(record: VisualTaskRecord): Promise<VisualTaskRecord> {
    return this.put(this.domain.table('visual_tasks'), record.taskId, record)
  }

  putVisualAsset(record: VisualAssetRecord): Promise<VisualAssetRecord> {
    return this.put(this.domain.table('visual_assets'), record.assetId, record)
  }

  putSiteBoundary(record: SiteBoundaryRecord): Promise<SiteBoundaryRecord> {
    return this.serialize(async () => {
      const validated = validateSiteBoundaryRecord(record)
      await this.domain.table('site_boundaries').put(validated.boundaryId, validated as unknown as SiteBoundaryStorageRecord)
      return validated
    })
  }

  findSyntheticBoundaryByFingerprint(input: SiteBoundaryFingerprint): SyntheticBoundaryFingerprintMatch | undefined {
    return this.findSyntheticFingerprintMatch(fingerprintKey(input))
  }

  putPendingSiteBoundary(record: SiteBoundaryRecord, asset?: VisualAssetRecord): Promise<SiteBoundaryRecord> {
    return this.serialize(async () => {
      const pending = validateSiteBoundaryRecord(record)
      if (pending.status !== 'pending_confirmation') throw new Error('SITE_BOUNDARY_PENDING_CONFLICT')
      const key = fingerprintKey(recordFingerprint(pending))
      const boundaries = this.domain.table('site_boundaries')
      const assets = this.domain.table('visual_assets')
      const claims = this.syntheticFingerprints.table('fingerprints')

      if (pending.origin === 'synthetic') {
        const existingClaim = claims.get(key)
        if (existingClaim !== undefined && existingClaim.boundaryId !== pending.boundaryId) {
          throw new Error('SITE_BOUNDARY_SYNTHETIC_REPLAY_FORBIDDEN')
        }
        if (existingClaim === undefined) {
          await claims.put(key, { fingerprint: key, boundaryId: pending.boundaryId, createdAt: pending.submittedAt })
        }
      } else if (this.findSyntheticFingerprintMatch(key) !== undefined) {
        throw new Error('SITE_BOUNDARY_SYNTHETIC_REPLAY_FORBIDDEN')
      }

      const currentBoundary = boundaries.get(pending.boundaryId) as SiteBoundaryRecord | undefined
      if (currentBoundary !== undefined) {
        if (!isDeepStrictEqual(pendingBoundaryIdentity(currentBoundary), pendingBoundaryIdentity(pending))) {
          throw new Error('SITE_BOUNDARY_PENDING_CONFLICT')
        }
        return currentBoundary
      }

      if (asset !== undefined) {
        if (asset.projectId !== pending.projectId) throw new Error('SITE_BOUNDARY_PENDING_CONFLICT')
        const currentAsset = assets.get(asset.assetId) as unknown as VisualAssetRecord | undefined
        if (currentAsset === undefined) await assets.put(asset.assetId, asset as never)
        else if (!sameAssetIdentity(currentAsset, asset)) throw new Error('SITE_BOUNDARY_PENDING_CONFLICT')
      }
      await boundaries.put(pending.boundaryId, pending as unknown as SiteBoundaryStorageRecord)
      return pending
    })
  }

  confirmSiteBoundary(input: SiteBoundaryConfirmationWrite): Promise<SiteBoundaryRecord> {
    return this.serialize(async () => {
      const formal = validateSiteBoundaryRecord(input.formal)
      const provisional = validateSiteBoundaryRecord({ ...formal, confirmedRevision: SITE_BOUNDARY_PROVISIONAL_REVISION })
      const boundaries = this.domain.table('site_boundaries')
      const assets = this.domain.table('visual_assets')
      const currentBoundary = boundaries.get(formal.boundaryId) as SiteBoundaryRecord | undefined
      const currentAsset = assets.get(input.adopted.assetId) as unknown as VisualAssetRecord | undefined
      if (currentBoundary?.status === 'confirmed_formal_boundary' && currentBoundary.confirmedRevision !== SITE_BOUNDARY_PROVISIONAL_REVISION) {
        if (isDeepStrictEqual(currentBoundary, formal) && isAdopted(currentAsset, input.adopted)) return currentBoundary
        throw new Error('SITE_BOUNDARY_CONFIRMATION_STALE')
      }
      if (currentBoundary === undefined || !isDeepStrictEqual(boundaryIdentity(currentBoundary), boundaryIdentity(formal))) {
        throw new Error('SITE_BOUNDARY_CONFIRMATION_STALE')
      }
      if (currentBoundary.status === 'confirmed_formal_boundary' && currentBoundary.confirmedRevision === SITE_BOUNDARY_PROVISIONAL_REVISION
        && isAdopted(currentAsset, input.adopted)) {
        await boundaries.put(formal.boundaryId, formal as unknown as SiteBoundaryStorageRecord)
        return formal
      }
      if (!isCandidate(currentAsset, input.candidate)) throw new Error('SITE_BOUNDARY_CONFIRMATION_STALE')
      await boundaries.put(provisional.boundaryId, provisional as unknown as SiteBoundaryStorageRecord)
      await assets.put(input.adopted.assetId, input.adopted as never)
      try {
        await boundaries.put(formal.boundaryId, formal as unknown as SiteBoundaryStorageRecord)
      } catch (error) {
        await assets.put(input.candidate.assetId, input.candidate as never)
        throw error
      }
      return formal
    })
  }

  putReportPackage(record: ReportPackageRecord): Promise<ReportPackageRecord> {
    return this.put(this.domain.table('report_packages'), record.packageId, record)
  }

  readProject(projectId: string): GovernanceProjectContext {
    return {
      projectId,
      policy: this.domain.table('project_policies').get(projectId),
      authorizations: this.forProject(this.domain.table('authorizations').entries(), projectId, 'grantedAt'),
      workflowRuns: this.forProject(this.domain.table('workflow_runs').entries(), projectId, 'workflowId'),
      gateDecisions: this.forProject(this.domain.table('gate_decisions').entries(), projectId, 'decisionId'),
      visualPolicies: this.forProject(this.domain.table('visual_policies').entries(), projectId, 'policyId'),
      visualTasks: this.forProject(this.domain.table('visual_tasks').entries(), projectId, 'taskId'),
      visualAssets: this.forProject(this.domain.table('visual_assets').entries(), projectId, 'assetId'),
      siteBoundaries: this.forProject(this.domain.table('site_boundaries').entries(), projectId, 'boundaryId') as SiteBoundaryRecord[],
      reportPackages: this.forProject(this.domain.table('report_packages').entries(), projectId, 'packageId'),
    }
  }

  private put<R>(
    table: KvTable<string, R>,
    key: string,
    record: R,
  ): Promise<R> {
    return this.serialize(async () => {
      await table.put(key, record)
      return record
    })
  }

  private findSyntheticFingerprintMatch(key: string): SyntheticBoundaryFingerprintMatch | undefined {
    const claim = this.syntheticFingerprints.table('fingerprints').get(key)
    if (claim !== undefined) {
      const record = this.domain.table('site_boundaries').get(claim.boundaryId) as SiteBoundaryRecord | undefined
      return { ...claim, ...(record === undefined ? {} : { record }) }
    }
    for (const [, candidate] of this.domain.table('site_boundaries').entries()) {
      const record = candidate as SiteBoundaryRecord
      if (record.origin !== 'synthetic') continue
      try {
        if (fingerprintKey(recordFingerprint(record)) === key) {
          return { fingerprint: key, boundaryId: record.boundaryId, createdAt: record.submittedAt, record }
        }
      } catch {
        // Invalid legacy rows are ignored here and remain subject to their normal domain validation.
      }
    }
    return undefined
  }

  private forProject<R extends { readonly projectId: string }, K extends keyof R>(
    entries: IterableIterator<[string, R]>,
    projectId: string,
    sortKey: K,
  ): R[] {
    const records = [...entries].map(([, record]) => record)
    return records
      .filter(record => record.projectId === projectId)
      .sort((left, right) => String(left[sortKey]).localeCompare(String(right[sortKey])))
  }

  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const result = this.chain.then(job)
    this.chain = result.then(() => undefined, () => undefined)
    return result
  }
}
