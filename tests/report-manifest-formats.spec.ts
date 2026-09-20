import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readReportFormats } from '../src/report/read-report-formats.ts'
import type { ArtifactRecord, ReportPackageRecord } from '../src/governance/types.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function fixture(formats: readonly ArtifactRecord['format'][] = ['html']) {
  const root = await mkdtemp(join(tmpdir(), 'report-link-formats-'))
  roots.push(root)
  const record: ReportPackageRecord = { packageId: 'package-57', projectId: 'project-1', sourceRevision: 57,
    status: 'generated_conditional', artifactManifestId: 'manifest-57', createdAt: '2026-09-18T10:00:00Z',
    generatedAt: '2026-09-18T10:00:00Z', sectionIds: [], adoptedAssetIds: [], warnings: [] }
  const manifest = { manifestId: record.artifactManifestId, packageId: record.packageId, projectId: record.projectId,
    sourceRevision: record.sourceRevision, createdAt: record.createdAt, deliveryMode: 'conditional', publishable: false,
    artifacts: formats.map(format => ({ format, fileName: format === 'html' ? 'html/index.html' : `report.${format}`, sha256: 'a'.repeat(64), bytes: 20 })) }
  await mkdir(join(root, record.packageId))
  const path = join(root, record.packageId, 'artifact-manifest.json')
  await writeFile(path, JSON.stringify(manifest))
  return { root, record, manifest, path }
}

describe('report manifest format reader', () => {
  it.each([['html'], ['html', 'pptx', 'pdf']] as const)('reads the actual stored format set: %s', async (...formats) => {
    const h = await fixture(formats)
    expect(readReportFormats(h.root, h.record)).toEqual(formats)
  })

  it('preserves legacy formal three-format downloads without requiring conditional metadata', async () => {
    const h = await fixture(['html', 'pptx', 'pdf'])
    const { deliveryMode, publishable, ...formal } = h.manifest
    await writeFile(h.path, JSON.stringify(formal))
    expect(readReportFormats(h.root, { ...h.record, status: 'published' })).toEqual(['html', 'pptx', 'pdf'])
  })

  it('does not infer formats when a manifest is missing, malformed or belongs to another package', async () => {
    const h = await fixture()
    await rm(h.path)
    expect(readReportFormats(h.root, h.record)).toBeUndefined()
    await writeFile(h.path, '{')
    expect(readReportFormats(h.root, h.record)).toBeUndefined()
    await writeFile(h.path, JSON.stringify({ ...h.manifest, projectId: 'other-project' }))
    expect(readReportFormats(h.root, h.record)).toBeUndefined()
    expect(readReportFormats(h.root, { ...h.record, packageId: '../other' })).toBeUndefined()
  })

  it.each(['docx', 'duplicate', 'wrong-path', 'empty'])('rejects untrusted manifest format data: %s', async mutation => {
    const h = await fixture()
    const artifact = h.manifest.artifacts[0]!
    const artifacts = mutation === 'docx' ? [{ ...artifact, format: 'docx' }]
      : mutation === 'duplicate' ? [artifact, artifact]
        : mutation === 'wrong-path' ? [{ ...artifact, fileName: '../private.html' }] : []
    await writeFile(h.path, JSON.stringify({ ...h.manifest, artifacts }))
    expect(readReportFormats(h.root, h.record)).toBeUndefined()
  })
})
