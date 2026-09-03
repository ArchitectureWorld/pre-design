import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const hashMapSchema = z.record(
  z.string().min(1),
  z.string().regex(/^[a-f0-9]{64}$/u),
).default({})

const presentationBindingSchema = z.object({
  preDesignProjectId: z.string().min(1),
  presentationProjectId: z.string().min(1).optional(),
  projectSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).optional(),
  directoryRoot: z.string().min(1).optional(),
  standardVersion: z.string().min(1).optional(),
  state: z.enum([
    'awaiting_contract',
    'creating',
    'ready',
    'recovery_required',
  ]),
  stableIds: z.record(z.string().min(1), z.string().min(1)).default({}),
  lastExportedPreDesignRevision: z.number().int().nonnegative().optional(),
  lastExportedAt: z.string().min(1).optional(),
  lastExportedObjectHashes: hashMapSchema,
  lastExportedFileHashes: hashMapSchema,
  lastFailure: z.object({
    code: z.string().min(1),
    stage: z.string().min(1),
    message: z.string().min(1),
    failedAt: z.string().min(1),
  }).strict().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()

export const preplanningPresentationDomainSpec = defineDomain({
  name: 'preplanning_presentation',
  version: 1,
  tables: {
    bindings: domainTable<string, z.infer<typeof presentationBindingSchema>>(
      presentationBindingSchema,
    ),
  },
})
