import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const actorSchema = z.object({
  actorId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
}).strict()

const projectSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  currentRevision: z.number().int().nonnegative(),
  currentStage: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()

const stateObjectSchema = z.object({
  projectId: z.string().min(1),
  objectId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  value: z.json(),
  updatedAt: z.string().min(1),
}).strict()

const revisionSchema = z.object({
  revisionId: z.string().min(1),
  projectId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  parentRevision: z.number().int().nonnegative().nullable(),
  committedAt: z.string().min(1),
  committedBy: actorSchema,
  stateSnapshot: z.record(z.string(), z.json()),
}).strict()

const eventSchema = z.object({
  eventId: z.string().min(1),
  projectId: z.string().min(1),
  eventType: z.string().min(1),
  revision: z.number().int().nonnegative(),
  actor: actorSchema,
  occurredAt: z.string().min(1),
  payload: z.json(),
}).strict()

const bindingSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  boundAt: z.string().min(1),
}).strict()

const proposalSchema = z.object({
  proposalId: z.string().min(1),
  projectId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(8),
  envelope: z.json(),
  status: z.enum(['pending_review', 'provisionally_committed', 'confirmed', 'returned', 'validation_failed', 'rejected']),
  createdAt: z.string().min(1),
  committedAt: z.string().min(1).optional(),
  committedBy: actorSchema.optional(),
  confirmedAt: z.string().min(1).optional(),
  confirmedBy: actorSchema.optional(),
  committedRevision: z.number().int().positive().optional(),
}).strict()

const questionSchema = z.object({
  questionId: z.string().min(1),
  projectId: z.string().min(1),
  prompt: z.string().min(1),
  priority: z.number().int(),
  workflowId: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
  dueAt: z.string().min(1).optional(),
  blockingLevel: z.enum(['none', 'soft', 'hard']).optional(),
  evidenceIds: z.array(z.string().min(1)).optional(),
  status: z.enum(['open', 'resolved']),
  createdAt: z.string().min(1),
  resolvedAt: z.string().min(1).optional(),
  resolvedRevision: z.number().int().positive().optional(),
}).strict()

const idempotencySchema = z.object({
  projectId: z.string().min(1),
  idempotencyKey: z.string().min(8),
  proposalId: z.string().min(1),
  eventId: z.string().min(1),
  revision: z.number().int().positive(),
  createdAt: z.string().min(1),
}).strict()

// Storage Domain identifiers must match ^[a-z][a-z0-9_]*$.
export const preplanningDomainSpec = defineDomain({
  name: 'preplanning_agent',
  version: 1,
  tables: {
    projects: domainTable<string, z.infer<typeof projectSchema>>(projectSchema),
    state_objects: domainTable<string, z.infer<typeof stateObjectSchema>>(stateObjectSchema),
    revisions: domainTable<string, z.infer<typeof revisionSchema>>(revisionSchema),
    events: domainTable<string, z.infer<typeof eventSchema>>(eventSchema),
    bindings: domainTable<string, z.infer<typeof bindingSchema>>(bindingSchema),
    proposals: domainTable<string, z.infer<typeof proposalSchema>>(proposalSchema),
    questions: domainTable<string, z.infer<typeof questionSchema>>(questionSchema),
    idempotency: domainTable<string, z.infer<typeof idempotencySchema>>(idempotencySchema),
  },
})
