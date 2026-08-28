import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as PreplanningPlugin from '../src/index.ts'

const PACKAGE_NAME = '@architectureworld/dsh-preplanning-agent'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('real Loader composition', () => {
  it('loads the Host half and removes its service on teardown', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-preplanning-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- id: preplanning-agent',
      `  name: '${PACKAGE_NAME}'`,
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Storage)
    await context.plugin(StorageJson, { root: join(root, 'storage') })
    await context.plugin(StorageDomain, { backend: 'json' })
    context.provide('commands', { register: () => () => undefined } as never)
    context.provide('tools', { register: () => () => undefined } as never)
    context.provide('systemPrompt', { section: () => () => undefined } as never)
    context.provide('webServer', { register: () => () => undefined } as never)
    context.provide('attachments', { readImage: async () => undefined } as never)
    context.provide('llm', { listModels: async () => [] } as never)
    context.provide('sessions', { get: () => undefined } as never)
    context.provide('subagents', {
      listChildren: async () => [], startContinuable: async () => undefined, followup: async () => undefined,
    } as never)
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier !== PACKAGE_NAME) throw new Error(`unexpected Loader import: ${specifier}`)
        return PreplanningPlugin
      },
    } as unknown as NonNullable<typeof context.loader.internal>

    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    const unloaded = [...context.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect(context.get('preplanning')).toMatchObject({
      pluginId: 'preplanning-agent',
      contractVersion: '0.6.0',
    })

    const entry = [...context.loader.entries()].find(item => item.options.name === PACKAGE_NAME)
    expect(entry?.fiber).toBeDefined()
    await entry?.fiber?.dispose()
    expect(context.get('preplanning')).toBeUndefined()
  })
})
