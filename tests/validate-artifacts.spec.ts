import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateAndHashReportArtifacts } from '../src/report/validate-artifacts.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('validateAndHashReportArtifacts', () => {
  it('rejects a package whose HTML was generated from a different revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-validate-'))
    roots.push(root)
    await mkdir(join(root, 'html'), { recursive: true })
    await writeFile(join(root, 'html', 'index.html'), '<html data-report-revision="56"></html>')
    await writeFile(join(root, 'report.pptx'), Buffer.from('PK report'))
    await writeFile(join(root, 'report.pdf'), Buffer.from('%PDF-1.7\n%%EOF'))

    await expect(validateAndHashReportArtifacts(root, {
      manifestId: 'manifest-1', packageId: 'package-1', projectId: 'project-1',
      sourceRevision: 57, createdAt: '2026-08-28T10:00:00.000Z',
    })).rejects.toThrow(/revision/u)
  })
})
