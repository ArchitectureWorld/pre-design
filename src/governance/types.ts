import type { ActorRef } from '../state/types.ts'

export type ConfirmationMode = 'manual' | 'automatic'
export type ReportDepth = 'standard' | 'extended'
export type WorkflowRunStatus =
  | 'not_started'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'pending_review'
  | 'confirmed'
  | 'not_applicable'
  | 'superseded'
export type GateDecisionSource = 'human_review' | 'automation_authorization'

export interface ProjectPolicyRecord {
  readonly projectId: string
  readonly mode: ConfirmationMode
  readonly reportDepth: ReportDepth
  readonly visualPolicyId?: string
  readonly automationAuthorizationId?: string
  readonly updatedAt: string
}

export interface AutomationAuthorizationScope {
  readonly chapterIds: readonly string[]
  readonly workflowIds: readonly string[]
  readonly gateIds: readonly string[]
  readonly maxVisualGenerations: number
  readonly maxModelTurns: number
  readonly stopOnBlocking: boolean
}

export interface AutomationAuthorizationRecord {
  readonly authorizationId: string
  readonly projectId: string
  readonly grantedBy: ActorRef
  readonly startingRevision: number
  readonly scope: AutomationAuthorizationScope
  readonly status: 'active' | 'revoked' | 'expired'
  readonly grantedAt: string
  readonly expiresAt?: string
  readonly revokedAt?: string
  readonly revokedBy?: ActorRef
  readonly revocationReason?: string
}

export interface WorkflowRunRecord {
  readonly runId: string
  readonly projectId: string
  readonly workflowId: string
  readonly chapterId: string
  readonly workItemId: string
  readonly targetObjectId: string
  readonly status: WorkflowRunStatus
  readonly attempt: number
  readonly proposalId?: string
  readonly confirmedRevision?: number
  readonly blockedReason?: string
  readonly updatedAt: string
}

export interface GateDecisionRecord {
  readonly decisionId: string
  readonly projectId: string
  readonly gateId: string
  readonly revision: number
  readonly decision: 'approved' | 'approved_with_conditions' | 'returned' | 'blocked'
  readonly source: GateDecisionSource
  readonly authorizationId?: string
  readonly decidedBy: ActorRef
  readonly decidedAt: string
  readonly reason?: string
  readonly snapshot?: Readonly<Record<string, unknown>>
}

export interface VisualGenerationPolicyRecord {
  readonly policyId: string
  readonly projectId: string
  readonly enabled: boolean
  readonly targetConceptImages: number
  readonly maxAttemptsPerTask: number
  readonly allowedMimeTypes: readonly ('image/png' | 'image/jpeg' | 'image/webp')[]
  readonly minWidth: number
  readonly minHeight: number
  readonly projectGenerationBudget: number
  readonly updatedAt: string
}

export interface VisualTaskRecord {
  readonly taskId: string
  readonly projectId: string
  readonly chapterId: string
  readonly workItemId: string
  readonly kind: 'evidence' | 'deterministic' | 'concept'
  readonly required: boolean
  readonly status: 'queued' | 'running' | 'candidate_ready' | 'adopted' | 'blocked' | 'failed'
  readonly attempts: number
  readonly childId?: string
  readonly blockedReason?: string
  readonly updatedAt: string
}

export interface VisualQualityRecord {
  readonly accepted: boolean
  readonly score: number
  readonly issues: readonly string[]
}

export interface VisualAssetRecord {
  readonly assetId: string
  readonly taskId: string
  readonly projectId: string
  readonly kind: 'evidence' | 'deterministic' | 'concept'
  readonly required: boolean
  readonly status: 'candidate' | 'adopted' | 'rejected' | 'blocked'
  readonly referenceAssetIds?: readonly string[]
  readonly provider?: string
  readonly model?: string
  readonly promptSummary?: string
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml'
  readonly fileName: string
  readonly sha256: string
  readonly boundaryGeometrySha256?: string
  readonly boundaryEvidence?: SiteBoundaryAttachmentEvidence
  readonly width: number
  readonly height: number
  readonly quality?: VisualQualityRecord
  readonly createdAt: string
  readonly adoptedRevision?: number
}

export type SiteBoundaryStatus = 'pending_confirmation' | 'confirmed_formal_boundary'
export type SiteBoundarySource = 'approved_site_plan' | 'approved_redline' | 'closed_coordinates' | 'geojson'
export type SiteBoundaryOrigin =
  | 'user_image'
  | 'user_coordinates'
  | 'user_geojson'
  | 'synthetic'
export type SiteBoundarySubmissionChannel =
  | 'dsh_human_command'
  | 'synthetic_fixture'

export interface SiteBoundaryAttachmentEvidence {
  readonly origin: 'user_image'
  readonly attachmentId: string
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  readonly displayName?: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly storageSha256: string
  readonly submittedBy: ActorRef
  readonly submittedRevision: number
}

export interface SiteBoundaryGeometryRecord {
  readonly crs: string
  readonly coordinates: readonly (readonly [number, number])[]
  readonly sha256: string
  readonly derivedAssetId: string
  readonly derivedFileName: string
  readonly derivedSha256: string
}

export type SiteBoundaryStateSummary =
  | { readonly kind: 'not_provided'; readonly label: '尚未提供场地边界'; readonly nextAction: string }
  | { readonly kind: 'pending_confirmation'; readonly boundaryId: string; readonly source: SiteBoundarySource; readonly label: string; readonly nextAction: string }
  | { readonly kind: 'confirmed_formal_boundary'; readonly boundaryId: string; readonly source: SiteBoundarySource; readonly label: string; readonly nextAction: string }
  | { readonly kind: 'synthetic_research'; readonly boundaryId: string; readonly source: SiteBoundarySource; readonly label: '模拟研究范围（不可正式确认）'; readonly nextAction: string }

export interface SiteBoundaryRecord {
  readonly boundaryId: string
  readonly projectId: string
  readonly submittedRevision: number
  readonly status: SiteBoundaryStatus
  readonly source: SiteBoundarySource
  readonly origin: SiteBoundaryOrigin
  readonly submissionChannel: SiteBoundarySubmissionChannel
  readonly sourceAsset?: Readonly<{
    assetId: string
    fileName: string
    sha256: string
    attachment?: SiteBoundaryAttachmentEvidence
  }>
  readonly geometry?: SiteBoundaryGeometryRecord
  readonly submittedBy: ActorRef
  readonly submittedAt: string
  readonly confirmedBy?: ActorRef
  readonly confirmedAt?: string
  readonly confirmedRevision?: number
  readonly confirmationChannel?: SiteBoundarySubmissionChannel
  readonly confirmationStatement?: string
  readonly confirmationSourceSha256?: string
}

export interface ReportPackageRecord {
  readonly packageId: string
  readonly projectId: string
  readonly sourceRevision: number
  readonly status: 'staging' | 'published' | 'failed'
  readonly sectionIds: readonly string[]
  readonly adoptedAssetIds: readonly string[]
  readonly warnings: readonly string[]
  readonly artifactManifestId?: string
  readonly createdAt: string
  readonly publishedAt?: string
}

export interface ArtifactRecord {
  readonly format: 'pptx' | 'pdf' | 'html'
  readonly fileName: string
  readonly sha256: string
  readonly bytes: number
}

export interface ArtifactManifestRecord {
  readonly manifestId: string
  readonly packageId: string
  readonly projectId: string
  readonly sourceRevision: number
  readonly recommendationId?: string
  readonly adoptedAssetIds?: readonly string[]
  readonly artifacts: readonly ArtifactRecord[]
  readonly createdAt: string
  readonly siteBoundaryIntegrityDigest?: string
}

export interface GovernanceProjectContext {
  readonly projectId: string
  readonly policy?: ProjectPolicyRecord
  readonly authorizations: readonly AutomationAuthorizationRecord[]
  readonly workflowRuns: readonly WorkflowRunRecord[]
  readonly gateDecisions: readonly GateDecisionRecord[]
  readonly visualPolicies: readonly VisualGenerationPolicyRecord[]
  readonly visualTasks: readonly VisualTaskRecord[]
  readonly visualAssets: readonly VisualAssetRecord[]
  readonly siteBoundaries: readonly SiteBoundaryRecord[]
  readonly reportPackages: readonly ReportPackageRecord[]
}
