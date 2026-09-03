import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

describe('Pre 2.0.0 development package metadata', () => {
  it('retains the governance contracts and reproducible Golden report command', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      name: string
      version: string
      files: string[]
      scripts: Record<string, string>
    }

    expect(manifest.name).toBe('@architectureworld/dsh-preplanning-agent')
    expect(manifest.version).toBe('2.0.0')
    expect(manifest.files).toContain('contracts/v0.7/**')
    expect(manifest.scripts['golden:build']).toBe('tsx scripts/build-golden-project-cli.ts')
  })
})
