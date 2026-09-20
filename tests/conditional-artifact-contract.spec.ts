import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GovernanceContractRegistry } from '../src/governance/contracts.ts'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { validateAndHashReportArtifacts } from '../src/report/validate-artifacts.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('conditional artifact format contracts', () => {
  it('accepts HTML-only conditional delivery while formal and legacy manifests still require three artifacts', async () => {
    const registry = await GovernanceContractRegistry.open(new URL('../contracts/v0.7/', import.meta.url))
    const manifest = { manifestId: 'manifest-1', packageId: 'package-1', projectId: 'project-1', sourceRevision: 103,
      createdAt: '2026-09-18T10:00:00Z', artifacts: [{ format: 'html', fileName: 'html/index.html', sha256: 'a'.repeat(64), bytes: 20 }] }
    expect(registry.validate('artifact-manifest', { ...manifest, deliveryMode: 'conditional', publishable: false }).valid).toBe(true)
    expect(registry.validate('artifact-manifest', { ...manifest, deliveryMode: 'conditional', publishable: true }).valid).toBe(false)
    expect(registry.validate('artifact-manifest', { ...manifest, deliveryMode: 'conditional', publishable: false, artifacts: [] }).valid).toBe(false)
    expect(registry.validate('artifact-manifest', manifest).valid).toBe(false)
    expect(registry.validate('artifact-manifest', { ...manifest, deliveryMode: 'formal' }).valid).toBe(false)
  })

  it('continues rejecting formal packages with only HTML files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'formal-formats-'))
    roots.push(root)
    await mkdir(join(root, 'html'))
    await writeFile(join(root, 'html/index.html'), '<html data-report-revision="57"></html>')
    const bundle = createClientReportBundle(REPORT_INPUT, CLIENT_PROFILE)
    await expect(validateAndHashReportArtifacts(root, {
      manifestId: 'manifest-1', packageId: 'package-1', projectId: REPORT_INPUT.projectId,
      sourceRevision: 57, createdAt: '2026-09-18T10:00:00Z',
    }, undefined, bundle)).rejects.toThrow(/ENOENT/u)
  })
})
