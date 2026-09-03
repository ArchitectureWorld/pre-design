import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  engines?: Record<string, string>
  scripts?: Record<string, string>
}

describe('Pre 2.0.0 build toolchain', () => {
  it('uses Node 22 native TypeScript config loading instead of the tsx loader', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as PackageManifest

    expect(manifest.engines?.node).toBe('>=22.0.0')
    expect(manifest.scripts?.build).toMatch(/^tsdown --config-loader native\b/)
    expect(manifest.scripts?.build).not.toContain('--config-loader tsx')
  })
})
