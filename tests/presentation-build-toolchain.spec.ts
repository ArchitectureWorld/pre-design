import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  engines?: Record<string, string>
  scripts?: Record<string, string>
}

const PRESENTATION_SCHEMA_SET_FILE = '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc  schemas/0.1.0\n'

describe('Pre 2.0.0 build toolchain', () => {
  it('uses the shared Node 24.11 baseline and native TypeScript config loading', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as PackageManifest

    expect(manifest.engines?.node).toBe('>=24.11.0')
    expect(manifest.scripts?.build).toMatch(/^tsdown --config-loader native\b/)
    expect(manifest.scripts?.build).not.toContain('--config-loader tsx')
  })

  it('tracks the exact pinned Contract SCHEMASET file so build leaves the checkout clean', async () => {
    const schemaSet = await readFile(new URL('../SCHEMASET.sha256', import.meta.url), 'utf8')

    expect(schemaSet).toBe(PRESENTATION_SCHEMA_SET_FILE)
  })
})
