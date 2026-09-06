import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import * as react from 'react'
import * as reactDom from 'react-dom'
import * as jsxRuntime from 'react/jsx-runtime'

interface ClientRow {
  id: string
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

interface PackedFile {
  path: string
}

interface PackedPackage {
  files: PackedFile[]
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const execFile = promisify(execFileCallback)

async function packedFilePaths(): Promise<string[]> {
  const packArguments = ['pack', '--dry-run', '--json', '--ignore-scripts']
  const command = process.platform === 'win32'
    ? process.env.ComSpec ?? 'cmd.exe'
    : 'npm'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm', ...packArguments]
    : packArguments
  const { stdout } = await execFile(
    command,
    args,
    { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  )
  const rows = JSON.parse(stdout) as PackedPackage[]
  if (!Array.isArray(rows) || rows.length !== 1 || !Array.isArray(rows[0]?.files)) {
    throw new Error('npm pack --dry-run returned an unexpected result')
  }
  return rows[0].files.map(file => file.path.replaceAll('\\', '/')).sort()
}

describe('built npm package', () => {
  it('registers the current-page candidate tool and frozen fail-closed capability from the built Host', async () => {
    const storageRoot = await mkdtemp(resolve(tmpdir(), 'pre-built-visual-'))
    const ctx = new Context()
    try {
      await ctx.plugin(Storage); await ctx.plugin(StorageJson, { root: storageRoot }); await ctx.plugin(StorageDomain, { backend: 'json' })
      const tools: ToolDefinition[] = []
      ctx.provide('commands', { register: () => () => {} } as never)
      ctx.provide('tools', { register: (tool: ToolDefinition) => { tools.push(tool); return () => {} } } as never)
      ctx.provide('attachments', {} as never); ctx.provide('llm', {} as never); ctx.provide('sessions', {} as never); ctx.provide('subagents', {} as never)
      ctx.provide('systemPrompt', { section: () => () => {} } as never); ctx.provide('webServer', { register: () => () => {} } as never)
      const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
      const host = await import(pathToFileURL(resolve(root, manifest.exports['.'].default)).href)
      await host.apply(ctx)
      expect(tools.map(tool => tool.name)).toContain('preplanning_generate_page_visual')
      expect(Object.isFrozen(ctx.preplanning.designVisualBridge)).toBe(true)
      await expect(ctx.preplanning.designVisualBridge.generate({ id: 'session' } as never, { runId: 'run', studioProjectId: 'studio', pageId: 'page', sourceStateHash: 'a'.repeat(64), requestId: 'request', prompt: '概念图' })).rejects.toThrow('RESOLVER_UNAVAILABLE')
    } finally { await ctx.fiber.dispose(); await rm(storageRoot, { recursive: true, force: true }) }
  })
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
    const requestedExternals = new Set<string>()
    const browser = row!.factory((specifier) => {
      requestedExternals.add(specifier)
      if (specifier === 'react') return react
      if (specifier === 'react/jsx-runtime') return jsxRuntime
      if (specifier === 'react-dom') return reactDom
      throw new Error(`unexpected client external: ${specifier}`)
    })
    expect(browser.inject).toEqual([
      'conversationEvents',
      'remote',
      'remote.commands',
      'sessions',
      'slots',
    ])
    expect(typeof browser.apply).toBe('function')
    expect([...requestedExternals].sort()).toEqual(['react', 'react-dom', 'react/jsx-runtime'].sort())
    expect(Buffer.byteLength(source, 'utf8')).toBeLessThan(100_000)
  })

  it('packs every generated Host chunk and the pinned Presentation Contract runtime assets', async () => {
    const paths = await packedFilePaths()
    const builtJavaScript = (await readdir(resolve(root, 'lib')))
      .filter(name => name.endsWith('.js'))
      .sort()
    for (const name of builtJavaScript) {
      expect(paths).toContain(`lib/${name}`)
    }

    expect(paths).toContain('SCHEMASET.sha256')
    expect(paths).toEqual(expect.arrayContaining([
      'schemas/0.1.0/asset-manifest.schema.json',
      'schemas/0.1.0/common.schema.json',
      'schemas/0.1.0/draft-page-document.schema.json',
      'schemas/0.1.0/outline-document.schema.json',
      'schemas/0.1.0/page-manifest.schema.json',
      'schemas/0.1.0/project-manifest.schema.json',
      'schemas/0.1.0/project-rules-document.schema.json',
      'schemas/0.1.0/source-material-manifest.schema.json',
    ]))
  })
})
