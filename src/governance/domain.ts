import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { SiteBoundaryRecord } from './types.ts'

const actorSchema = z.object({
  actorId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
}).strict()

const siteBoundaryAttachmentEvidenceSchema = z.object({
  origin: z.literal('user_image'),
  attachmentId: z.string().min(1),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  displayName: z.string().min(1).optional(),
  bytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  storageSha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  submittedBy: actorSchema,
  submittedRevision: z.number().int().nonnegative(),
}).strict()

const projectPolicySchema = z.object({
  projectId: z.string().min(1),
  mode: z.enum(['manual', 'automatic']),
  reportDepth: z.enum(['standard', 'extended']),
  visualPolicyId: z.string().min(1).optional(),
  automationAuthorizationId: z.string().min(1).optional(),
  updatedAt: z.string().min(1),
}).strict()

const authorizationSchema = z.object({
  authorizationId: z.string().min(1),
  projectId: z.string().min(1),
  grantedBy: actorSchema,
  startingRevision: z.number().int().nonnegative(),
  scope: z.object({
    chapterIds: z.array(z.string()),
    workflowIds: z.array(z.string()),
    gateIds: z.array(z.string()),
    maxVisualGenerations: z.number().int().nonnegative(),
    maxModelTurns: z.number().int().positive(),
    stopOnBlocking: z.boolean(),
  }).strict(),
  status: z.enum(['active', 'revoked', 'expired']),
  grantedAt: z.string().min(1),
  expiresAt: z.string().min(1).optional(),
  revokedAt: z.string().min(1).optional(),
  revokedBy: actorSchema.optional(),
  revocationReason: z.string().min(1).optional(),
}).strict()

const workflowRunSchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1),
  workflowId: z.string().min(1),
  chapterId: z.string().min(1),
  workItemId: z.string().min(1),
  targetObjectId: z.string().min(1),
  status: z.enum(['not_started', 'ready', 'running', 'blocked', 'pending_review', 'confirmed', 'not_applicable', 'superseded']),
  attempt: z.number().int().nonnegative(),
  proposalId: z.string().min(1).optional(),
  confirmedRevision: z.number().int().nonnegative().optional(),
  blockedReason: z.string().min(1).optional(),
  updatedAt: z.string().min(1),
}).strict()

const gateDecisionSchema = z.object({
  decisionId: z.string().min(1),
  projectId: z.string().min(1),
  gateId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  decision: z.enum(['approved', 'approved_with_conditions', 'returned', 'blocked']),
  source: z.enum(['human_review', 'automation_authorization']),
  authorizationId: z.string().min(1).optional(),
  decidedBy: actorSchema,
  decidedAt: z.string().min(1),
  reason: z.string().min(1).optional(),
  snapshot: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((record, context) => {
  if (record.source === 'automation_authorization' && record.authorizationId === undefined) {
    context.addIssue({ code: 'custom', message: 'automation_authorization requires authorizationId' })
  }
})

const visualPolicySchema = z.object({
  policyId: z.string().min(1),
  projectId: z.string().min(1),
  enabled: z.boolean(),
  targetConceptImages: z.number().int().min(0).max(20),
  maxAttemptsPerTask: z.number().int().positive(),
  allowedMimeTypes: z.array(z.enum(['image/png', 'image/jpeg', 'image/webp'])).min(1),
  minWidth: z.number().int().positive(),
  minHeight: z.number().int().positive(),
  projectGenerationBudget: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
}).strict()

const visualTaskSchema = z.object({
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  chapterId: z.string().min(1),
  workItemId: z.string().min(1),
  kind: z.enum(['evidence', 'deterministic', 'concept']),
  required: z.boolean(),
  status: z.enum(['queued', 'running', 'candidate_ready', 'adopted', 'blocked', 'failed']),
  attempts: z.number().int().nonnegative(),
  childId: z.string().min(1).optional(),
  blockedReason: z.string().min(1).optional(),
  updatedAt: z.string().min(1),
}).strict()

const visualAssetSchema = z.object({
  assetId: z.string().min(1),
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  kind: z.enum(['evidence', 'deterministic', 'concept']),
  required: z.boolean(),
  status: z.enum(['candidate', 'adopted', 'rejected', 'blocked']),
  referenceAssetIds: z.array(z.string().min(1)).optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  promptSummary: z.string().min(1).optional(),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  fileName: z.string().min(1),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  boundaryGeometrySha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  boundaryEvidence: siteBoundaryAttachmentEvidenceSchema.optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  quality: z.object({
    accepted: z.boolean(),
    score: z.number().min(0).max(1),
    issues: z.array(z.string().min(1)),
  }).strict().optional(),
  createdAt: z.string().min(1),
  adoptedRevision: z.number().int().nonnegative().optional(),
}).strict().superRefine((record, context) => {
  if (record.status === 'adopted' && record.adoptedRevision === undefined) {
    context.addIssue({ code: 'custom', message: 'adopted asset requires adoptedRevision' })
  }
  if (record.boundaryGeometrySha256 !== undefined && record.kind === 'concept') {
    context.addIssue({ code: 'custom', message: 'boundary geometry lineage requires evidence or deterministic asset' })
  }
})

const siteBoundarySchema = z.object({
  boundaryId: z.string().min(1),
  projectId: z.string().min(1),
  submittedRevision: z.number().int().nonnegative(),
  status: z.enum(['pending_confirmation', 'confirmed_formal_boundary']),
  source: z.enum(['approved_site_plan', 'approved_redline', 'closed_coordinates', 'geojson']),
  origin: z.enum(['user_image', 'user_coordinates', 'user_geojson', 'synthetic']),
  submissionChannel: z.enum(['dsh_human_command', 'synthetic_fixture']),
  sourceAsset: z.object({
    assetId: z.string().min(1),
    fileName: z.string().min(1),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
    attachment: siteBoundaryAttachmentEvidenceSchema.optional(),
  }).strict().optional(),
  geometry: z.object({
    crs: z.string().min(1),
    coordinates: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(4),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
    derivedAssetId: z.string().min(1).optional(),
    derivedFileName: z.string().min(1).optional(),
    derivedSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  }).strict().optional(),
  submittedBy: actorSchema,
  submittedAt: z.string().min(1),
  confirmedBy: actorSchema.optional(),
  confirmedAt: z.string().min(1).optional(),
  confirmedRevision: z.number().int().nonnegative().optional(),
  confirmationChannel: z.enum(['dsh_human_command', 'synthetic_fixture']).optional(),
  confirmationStatement: z.string().min(1).optional(),
  confirmationSourceSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
}).strict().superRefine((record, context) => {
  const needsAsset = record.source === 'approved_site_plan' || record.source === 'approved_redline'
  const hasCompleteGeometry = record.geometry !== undefined
    && record.geometry.derivedAssetId !== undefined
    && record.geometry.derivedFileName !== undefined
    && record.geometry.derivedSha256 !== undefined
  const originMatchesSource = record.origin === 'synthetic'
    || (record.origin === 'user_image' && needsAsset)
    || (record.origin === 'user_coordinates' && record.source === 'closed_coordinates')
    || (record.origin === 'user_geojson' && record.source === 'geojson')
  const payloadMatchesSource = needsAsset
    ? record.sourceAsset?.attachment !== undefined && record.geometry === undefined
    : hasCompleteGeometry && record.sourceAsset === undefined
  const expectedSubmissionChannel = record.origin === 'synthetic'
    ? 'synthetic_fixture'
    : 'dsh_human_command'

  if (record.submissionChannel !== expectedSubmissionChannel) {
    context.addIssue({ code: 'custom', message: 'site boundary origin and submission channel mismatch' })
  }
  if (!originMatchesSource || !payloadMatchesSource) {
    context.addIssue({ code: 'custom', message: 'site boundary origin/source/payload mismatch' })
  }
  if (needsAsset && record.sourceAsset === undefined) context.addIssue({ code: 'custom', message: 'formal file boundary requires adopted source asset' })
  if ((record.source === 'closed_coordinates' || record.source === 'geojson') && record.geometry === undefined) context.addIssue({ code: 'custom', message: 'geometry boundary requires geometry' })
  if (record.geometry !== undefined
    && (record.geometry.derivedAssetId === undefined || record.geometry.derivedFileName === undefined || record.geometry.derivedSha256 === undefined)) {
    context.addIssue({ code: 'custom', message: 'geometry boundary requires derived map identity' })
  }
  if (record.origin === 'user_image' && record.sourceAsset?.attachment === undefined) {
    context.addIssue({ code: 'custom', message: 'image boundary requires attachment evidence' })
  }
  if ((record.origin === 'user_coordinates' || record.origin === 'user_geojson')
    && (record.geometry === undefined || record.geometry.derivedAssetId === undefined || record.geometry.derivedFileName === undefined || record.geometry.derivedSha256 === undefined)) {
    context.addIssue({ code: 'custom', message: 'geometry boundary requires derived map identity' })
  }
  if (record.status === 'confirmed_formal_boundary'
    && record.origin === 'synthetic') {
    context.addIssue({ code: 'custom', message: 'synthetic boundary cannot be formal' })
  }
  if (record.status === 'confirmed_formal_boundary'
    && record.confirmedRevision !== undefined
    && record.confirmedRevision < record.submittedRevision) {
    context.addIssue({ code: 'custom', message: 'confirmedRevision must be greater than or equal to submittedRevision' })
  }
  if (record.status === 'confirmed_formal_boundary'
    && (record.submissionChannel !== 'dsh_human_command'
      || record.confirmationChannel !== 'dsh_human_command'
      || record.confirmedBy?.role !== 'decision_owner'
      || record.confirmedAt === undefined
      || record.confirmedRevision === undefined
      || record.confirmationStatement !== '该图是本项目采用的总平图或红线图，且图中明确表达项目边界'
      || record.confirmationSourceSha256 !== (record.sourceAsset?.sha256 ?? record.geometry?.sha256))) {
    context.addIssue({ code: 'custom', message: 'formal boundary requires dsh_human_command confirmation' })
  }
})

export type SiteBoundaryStorageRecord = z.infer<typeof siteBoundarySchema>

const syntheticBoundaryFingerprintSchema = z.object({
  fingerprint: z.string().regex(/^(?:image|geometry):[a-f0-9]{64}$/u),
  boundaryId: z.string().min(1),
  createdAt: z.string().min(1),
}).strict()

export type SyntheticBoundaryFingerprintStorageRecord = z.infer<typeof syntheticBoundaryFingerprintSchema>

export const preplanningSyntheticBoundaryFingerprintDomainSpec = defineDomain({
  name: 'preplanning_synthetic_boundary_fingerprints',
  version: 1,
  tables: {
    fingerprints: domainTable<string, SyntheticBoundaryFingerprintStorageRecord>(syntheticBoundaryFingerprintSchema),
  },
})

export function validateSiteBoundaryRecord(record: unknown): SiteBoundaryRecord {
  const result = siteBoundarySchema.safeParse(record)
  if (!result.success) throw new Error(result.error.issues.map(issue => issue.message).join('; '))
  return result.data as SiteBoundaryRecord
}

const reportPackageSchema = z.object({
  packageId: z.string().min(1),
  projectId: z.string().min(1),
  sourceRevision: z.number().int().nonnegative(),
  status: z.enum(['staging', 'published', 'failed']),
  sectionIds: z.array(z.string().min(1)).min(1),
  adoptedAssetIds: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
  artifactManifestId: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  publishedAt: z.string().min(1).optional(),
}).strict().superRefine((record, context) => {
  if (record.status === 'published' && (record.artifactManifestId === undefined || record.publishedAt === undefined)) {
    context.addIssue({ code: 'custom', message: 'published report requires artifact manifest and publishedAt' })
  }
})

export const preplanningGovernanceDomainSpec = defineDomain({
  name: 'preplanning_governance',
  version: 1,
  tables: {
    project_policies: domainTable<string, z.infer<typeof projectPolicySchema>>(projectPolicySchema),
    authorizations: domainTable<string, z.infer<typeof authorizationSchema>>(authorizationSchema),
    workflow_runs: domainTable<string, z.infer<typeof workflowRunSchema>>(workflowRunSchema),
    gate_decisions: domainTable<string, z.infer<typeof gateDecisionSchema>>(gateDecisionSchema),
    visual_policies: domainTable<string, z.infer<typeof visualPolicySchema>>(visualPolicySchema),
    visual_tasks: domainTable<string, z.infer<typeof visualTaskSchema>>(visualTaskSchema),
    visual_assets: domainTable<string, z.infer<typeof visualAssetSchema>>(visualAssetSchema),
    site_boundaries: domainTable<string, z.infer<typeof siteBoundarySchema>>(siteBoundarySchema),
    report_packages: domainTable<string, z.infer<typeof reportPackageSchema>>(reportPackageSchema),
  },
})
