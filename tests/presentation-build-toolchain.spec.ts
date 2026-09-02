import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  scripts?: Record<string, string>
  devDependencies?: Record<string, string>
}

describe('Presentation Phase 0 build toolchain', () => {
  it('uses an installed TypeScript config loader on the Node 20 CI baseline', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as PackageManifest

    expect(manifest.devDependencies?.tsx).toBe('4.23.12')
    expect(manifest.scripts?.build).toMatch(/^tsdown --config-loader tsx\b/)
  })
})
