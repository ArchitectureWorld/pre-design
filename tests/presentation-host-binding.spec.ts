import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as HostPlugin from '../src/index.ts'
import { PresentationBindingRepository } from '../src/presentation/binding-repository.ts'
import { createAwaitingPresentationBinding } from '../src/presentation/types.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Preplanning Host presentation binding composition', () => {
  it('opens, exposes and persists the contract-neutral binding repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplanning-presentation-host-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)

    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    ctx.provide('commands', { register: () => () => undefined } as never)
    ctx.provide('tools', { register: () => () => undefined } as never)
    ctx.provide('attachments', { readImage: vi.fn() } as never)
    ctx.provide('llm', { listModels: vi.fn(async () => []) } as never)
    ctx.provide('sessions', { get: vi.fn() } as never)
    ctx.provide('subagents', {
      listChildren: vi.fn(async () => []),
      startContinuable: vi.fn(),
      followup: vi.fn(),
    } as never)
    ctx.provide('systemPrompt', { section: () => () => undefined } as never)
    ctx.provide('webServer', { register: () => () => undefined } as never)

    await ctx.plugin(HostPlugin)
    await vi.waitFor(() => expect(ctx.get('preplanning')).toBeDefined())

    const bindings = ctx.get('preplanning')?.presentationBindings
    expect(bindings).toBeInstanceOf(PresentationBindingRepository)
    if (bindings === undefined) throw new Error('presentation binding repository was not provided')

    await bindings.put(createAwaitingPresentationBinding({
      preDesignProjectId: 'preplan-project-1',
      createdAt: '2026-09-02T12:00:00.000Z',
    }))
    expect(bindings.read('preplan-project-1')).toMatchObject({
      preDesignProjectId: 'preplan-project-1',
      state: 'awaiting_contract',
      lastExportedObjectHashes: {},
    })
  })
})
