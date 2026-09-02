import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { PresentationBindingRepository } from '../src/presentation/binding-repository.ts'
import { createAwaitingPresentationBinding } from '../src/presentation/types.ts'

const roots: string[] = []
const contexts: Context[] = []
const createdAt = '2026-09-02T13:30:00.000Z'

async function openStorage() {
  const root = await mkdtemp(join(tmpdir(), 'pre-design-presentation-binding-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  return { ctx, root }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('PresentationBindingRepository', () => {
  it('persists an awaiting-contract binding without inventing Presentation fields', async () => {
    const { ctx } = await openStorage()
    const repository = await PresentationBindingRepository.open(ctx.storage.domain)
    const awaiting = createAwaitingPresentationBinding({
      preDesignProjectId: 'preplan-binding-1',
      createdAt,
    })

    await expect(repository.put(awaiting)).resolves.toEqual(awaiting)
    expect(repository.read('preplan-binding-1')).toEqual(awaiting)
    expect(repository.listByState('awaiting_contract')).toEqual([awaiting])

    await repository.close()
    const reopened = await PresentationBindingRepository.open(ctx.storage.domain)
    expect(reopened.read('preplan-binding-1')).toEqual(awaiting)
  })

  it('stores a complete contract-backed transition and enforces unique Presentation identity', async () => {
    const { ctx, root } = await openStorage()
    const repository = await PresentationBindingRepository.open(ctx.storage.domain)
    const first = createAwaitingPresentationBinding({
      preDesignProjectId: 'preplan-binding-1',
      createdAt,
    })
    await repository.put(first)

    const creating = {
      ...first,
      presentationProjectId: 'presentation-project-1',
      directoryRoot: join(root, 'projects', 'presentation-project-1-campus-renewal'),
      standardVersion: 'test-contract-version',
      state: 'creating' as const,
      updatedAt: '2026-09-02T13:31:00.000Z',
    }
    await expect(repository.put(creating)).resolves.toEqual(creating)
    expect(repository.read('preplan-binding-1')).toEqual(creating)

    const duplicateIdentity = {
      ...creating,
      preDesignProjectId: 'preplan-binding-2',
    }
    await expect(repository.put(duplicateIdentity))
      .rejects.toThrow('PRESENTATION_PROJECT_ALREADY_BOUND')
    expect(repository.read('preplan-binding-2')).toBeUndefined()
  })

  it('rejects invalid ready state before any storage write', async () => {
    const { ctx } = await openStorage()
    const repository = await PresentationBindingRepository.open(ctx.storage.domain)
    const invalid = {
      ...createAwaitingPresentationBinding({
        preDesignProjectId: 'preplan-binding-invalid',
        createdAt,
      }),
      state: 'ready' as const,
    }

    await expect(repository.put(invalid))
      .rejects.toThrow('PRESENTATION_BINDING_READY_INCOMPLETE')
    expect(repository.read('preplan-binding-invalid')).toBeUndefined()
  })
})
