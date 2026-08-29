import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runGoldenProject } from '../scripts/build-golden-project.ts'
import { inspectClientArtifacts } from '../scripts/inspect-client-artifacts.ts'

const fixtureRoot = fileURLToPath(new URL('./fixtures/golden-project/', import.meta.url))
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Golden Project full flow', () => {
  it('publishes the v0.8 engineering Golden without overwriting an existing manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-golden-v080-'))
    roots.push(root)
    const outputRoot = join(root, 'engineering-golden')

    const result = await runGoldenProject(fixtureRoot, outputRoot, { browserExecutable: edge })

    expect(result.manifest.artifacts.map(row => row.format).sort()).toEqual(['html', 'pdf', 'pptx'])
    expect(result.client).toMatchObject({
      schemaVersion: 'preplan.client-report.v1',
      pptxPages: 36,
      pdfPages: 48,
      forbiddenTermHits: [],
    })
    await expect(runGoldenProject(fixtureRoot, outputRoot, { browserExecutable: edge }))
      .rejects.toThrow(/refusing to overwrite published Golden/u)
  }, 60_000)

  it('uses the same core value and adopted assets in all three formats', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-golden-v080-'))
    roots.push(root)
    const outputRoot = join(root, 'engineering-golden')
    await runGoldenProject(fixtureRoot, outputRoot, { browserExecutable: edge })

    const inspection = await inspectClientArtifacts(outputRoot)

    expect(inspection.identitiesEqual).toBe(true)
    expect(inspection.coreValueOccurrences).toEqual({ html: 1, pptx: 1, pdfSource: 1 })
    expect(inspection.missingAssetIds).toEqual([])
    expect(inspection.forbiddenTermHits).toEqual([])
  }, 60_000)
})
