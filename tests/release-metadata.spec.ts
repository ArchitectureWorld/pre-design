import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

describe('0.7.0 release metadata', () => {
  it('publishes the governance contracts and a reproducible Golden report command', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      version: string
      files: string[]
      scripts: Record<string, string>
    }

    expect(manifest.version).toBe('0.7.0')
    expect(manifest.files).toContain('contracts/v0.7/**')
    expect(manifest.scripts['golden:build']).toBe('tsx scripts/build-golden-project-cli.ts')
  })
})
