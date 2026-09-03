import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it, vi } from 'vitest'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('installed Host Presentation runtime', () => {
  it('initializes a Presentation standard project from the built npm artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preplanning-built-host-'))
    roots.push(root)
    vi.stubEnv('PRE_DESIGN_PRESENTATION_PROJECT_ROOT', join(root, 'presentation-projects'))

    const HostPlugin = await import(
      pathToFileURL(resolve(packageRoot, 'lib/index.js')).href
    ) as typeof import('../src/index.ts')
    const ctx = new Context()
    contexts.push(ctx)
    const commands: CommandDefinition[] = []

    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    ctx.provide('commands', {
      register: (definition: CommandDefinition) => { commands.push(definition); return () => undefined },
    } as never)
    ctx.provide('tools', { register: (_definition: unknown) => () => undefined } as never)
    ctx.provide('attachments', { readImage: vi.fn() } as never)
    ctx.provide('llm', { listModels: vi.fn(async () => []) } as never)
    ctx.provide('sessions', { get: vi.fn() } as never)
    ctx.provide('subagents', {
      listChildren: vi.fn(async () => []),
      startContinuable: vi.fn(),
      followup: vi.fn(),
    } as never)
    ctx.provide('systemPrompt', { section: (_definition: unknown) => () => undefined } as never)
    ctx.provide('webServer', { register: (_definition: unknown) => () => undefined } as never)

    await ctx.plugin(HostPlugin)

    const created = await commands.find(definition => definition.name === 'preplan-new')?.handler({
      rawInput: '安装包回归测试', agent: { id: 'session-1' },
    } as never)
    expect(created?.kind).toBe('success')

    const synchronized = await commands.find(
      definition => definition.name === 'preplan-presentation-sync',
    )?.handler({ rawInput: '', agent: { id: 'session-1' } } as never)

    expect(synchronized).toMatchObject({
      kind: 'success',
      text: expect.stringContaining('PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS'),
    })
  })
})
