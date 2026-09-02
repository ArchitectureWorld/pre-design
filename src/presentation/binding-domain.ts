import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const presentationBindingSchema = z.object({
  preDesignProjectId: z.string().min(1),
  presentationProjectId: z.string().min(1).optional(),
  directoryRoot: z.string().min(1).optional(),
  standardVersion: z.string().min(1).optional(),
  state: z.enum([
    'awaiting_contract',
    'creating',
    'ready',
    'recovery_required',
  ]),
  lastExportedPreDesignRevision: z.number().int().nonnegative().optional(),
  lastExportedAt: z.string().min(1).optional(),
  lastExportedObjectHashes: z.record(
    z.string().min(1),
    z.string().regex(/^[a-f0-9]{64}$/u),
  ),
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
