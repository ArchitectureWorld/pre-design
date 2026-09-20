import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { MAX_CLASS_FALLBACKS } from './types.ts'

export const routeSchema = z.object({ provider: z.string().trim().min(1).max(200), model: z.string().trim().min(1).max(300) }).strict()
export const routesSchema = z.object({ image: routeSchema.nullable(), web: routeSchema.nullable(), text: routeSchema.nullable(), review: routeSchema.nullable().optional() }).strict()
export const fallbacksSchema = z.object({ image: z.array(routeSchema).max(MAX_CLASS_FALLBACKS).readonly().optional(),
  web: z.array(routeSchema).max(MAX_CLASS_FALLBACKS).readonly().optional(), text: z.array(routeSchema).max(MAX_CLASS_FALLBACKS).readonly().optional(),
  review: z.array(routeSchema).max(MAX_CLASS_FALLBACKS).readonly().optional() }).strict()
const settingsSchema = z.object({ revision: z.number().int().nonnegative(), routes: routesSchema, fallbacks: fallbacksSchema.optional() }).strict()
const executionSchema = z.object({
  id: z.string().min(1), projectId: z.string().min(1), classId: z.enum(['image', 'web', 'text', 'review']),
  task: z.string().min(1), parentId: z.string().min(1), configurationRevision: z.number().int().nonnegative(),
  automationAuthorizationId: z.string().min(1).optional(),
  selected: routeSchema, actual: routeSchema.optional(), childId: z.string().min(1).optional(),
  chainId: z.string().min(1).optional(), routeChain: z.array(routeSchema).min(1).max(MAX_CLASS_FALLBACKS + 1).readonly().optional(),
  routeIndex: z.number().int().nonnegative().optional(), fallbackFromExecutionId: z.string().min(1).optional(),
  availabilityFailure: z.enum(['catalog', 'provider', 'transport', 'rate-limit', 'server']).optional(),
  status: z.enum(['starting', 'running', 'completed', 'failed', 'cancelled', 'recovery_required']),
  childStopReason: z.string().optional(),
  error: z.string().optional(), startedAt: z.string(), updatedAt: z.string(),
}).strict()
export const agentClassDomain = defineDomain({ name: 'preplanning_agent_classes', version: 1, tables: {
  settings: domainTable<string, z.infer<typeof settingsSchema>>(settingsSchema),
  executions: domainTable<string, z.infer<typeof executionSchema>>(executionSchema),
} })
