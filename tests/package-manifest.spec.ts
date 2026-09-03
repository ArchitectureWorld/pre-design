import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  name?: string
  exports?: Record<string, unknown>
  files?: string[]
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  dsh?: {
    bundle?: { patch?: string }
    client?: { platform?: string; inject?: string[] }
  }
}

describe('DSH package manifest', () => {
  it('advertises one package as both the Host bundle and Web client plugin', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as PackageManifest

    expect(manifest.name).toBe('@architectureworld/dsh-preplanning-agent')
    expect(manifest.dsh).toEqual({
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', inject: [] },
    })
    expect(manifest.exports).toMatchObject({
      '.': expect.any(Object),
      './client': expect.any(Object),
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    })
    expect(manifest.files).toEqual(expect.arrayContaining([
      'lib/**',
      'SCHEMASET.sha256',
      'schemas/0.1.0/*.schema.json',
      'cordis.patch.yml',
      'contracts/v0.6/**',
      'compatibility/dsh-baseline.json',
    ]))
  })

  it('regenerates and packs the immutable Presentation Contract runtime assets', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as PackageManifest

    expect(manifest.scripts).toMatchObject({
      'prepare:presentation-runtime-assets': 'node scripts/prepare-presentation-contract-runtime-assets.mjs',
      prebuild: 'pnpm prepare:presentation-runtime-assets',
      prepack: 'pnpm build',
    })
    expect(manifest.scripts?.['test:built']).toContain('tests/built-presentation-runtime.spec.ts')
  })

  it('ships Schemastery while sharing the Host Cordis runtime', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as PackageManifest

    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/schemastery': '3.18.1',
    })
    expect(manifest.peerDependencies).toEqual({
      '@deepseek-ai/cordis': '4.0.1',
    })
  })
})
