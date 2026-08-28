import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const actorSchema = z.object({
  actorId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
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
})

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
    report_packages: domainTable<string, z.infer<typeof reportPackageSchema>>(reportPackageSchema),
  },
})
