import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import * as react from 'react'
import * as jsxRuntime from 'react/jsx-runtime'

interface ClientRow {
  id: string
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))

describe('built npm package', () => {
  it('loads the Host export path declared by package.json', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      exports: { '.': { default: string } }
    }
    const modulePath = resolve(root, manifest.exports['.'].default)
    const host = await import(pathToFileURL(modulePath).href)

    expect(Object.keys(host).sort()).toEqual(['Config', 'apply', 'inject', 'name'])
    expect(host.name).toBe('preplanning-agent')
  })

  it('executes the Browser artifact through the DSH ModuleLoader handshake', async () => {
    const source = await readFile(resolve(root, 'lib/client.js'), 'utf8')
    let row: ClientRow | undefined
    vm.runInNewContext(source, {
      window: {
        __ModuleLoader__: {
          load(value: ClientRow) {
            row = value
          },
        },
      },
    })

    expect(row?.id).toBe('@architectureworld/dsh-preplanning-agent')
    const browser = row!.factory((specifier) => {
      if (specifier === 'react') return react
      if (specifier === 'react/jsx-runtime') return jsxRuntime
      throw new Error(`unexpected client external: ${specifier}`)
    })
    expect(browser.inject).toEqual(['conversationEvents', 'remote', 'remote.commands', 'sessions', 'slots'])
    expect(typeof browser.apply).toBe('function')
  })
})
