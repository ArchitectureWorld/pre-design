import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createClientReportBundle, createClientResearchPreviewBundle } from '../src/report/client-projection.ts'
import type { ClientAssetBinding, ClientProjectProfile, ClientResearchPreviewBundle } from '../src/report/client-types.ts'
import type { FrozenProjectInput, ReportAsset } from '../src/report/types.ts'
import * as ArtifactValidation from '../src/report/validate-artifacts.ts'
import { validateAndHashReportArtifacts, type ArtifactManifestIdentity } from '../src/report/validate-artifacts.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const previewAssetSha256 = '9'.repeat(64)
const previewAsset: ReportAsset = {
  assetId: 'research-boundary-asset', chapterId: '07', kind: 'evidence', caption: '研究范围图',
  sourcePath: 'C:/fixtures/research-boundary.png', mimeType: 'image/png',
  sha256: previewAssetSha256, width: 1600, height: 1000,
}
const previewBinding: ClientAssetBinding = {
  assetId: previewAsset.assetId, role: 'map', chapterId: 'chapter-07', sha256: previewAssetSha256,
  width: 1600, height: 1000, analysisKind: 'site-boundary',
  provenance: {
    sourceLabel: '研究范围图', sourceDate: '2026-08-28', locator: '研究资料',
    sourceFileSha256: previewAssetSha256, evidenceIds: ['evidence-1'],
  },
  cartography: {
    boundary: 'research', disclosures: ['研究范围（待核）', '非法定红线', '非测绘成果'],
    legend: 'present', northArrow: 'present', scale: { kind: 'nts' },
  },
}

function researchPreview() {
  const input = {
    ...REPORT_INPUT,
    visualAssets: [...REPORT_INPUT.visualAssets, previewAsset],
    adoptedAssetIds: REPORT_INPUT.adoptedAssetIds ?? [],
    siteBoundary: {
      status: 'synthetic_research', boundaryId: 'research-boundary-1', source: 'approved_redline',
      assetId: previewAsset.assetId, assetSha256: previewAssetSha256,
      declarations: ['研究范围（待核）', '非法定红线', '非测绘成果'],
    },
  } as unknown as FrozenProjectInput
  const profile: ClientProjectProfile = {
    ...CLIENT_PROFILE,
    assetBindings: [...CLIENT_PROFILE.assetBindings, previewBinding],
  }
  return createClientResearchPreviewBundle(input, profile)
}

function formalBundle(projectId = 'project-1') {
  return createClientReportBundle({ ...REPORT_INPUT, projectId }, {
    ...CLIENT_PROFILE,
    identity: { ...CLIENT_PROFILE.identity, projectId },
  })
}

function formalValidatorTypeAssertions(preview: ClientResearchPreviewBundle, identity: ArtifactManifestIdentity): void {
  // @ts-expect-error formal validation requires an authentic formal bundle
  void validateAndHashReportArtifacts('unused', identity, undefined)
  // @ts-expect-error research-preview bundles cannot enter formal validation
  void validateAndHashReportArtifacts('unused', identity, undefined, preview)
}
void formalValidatorTypeAssertions

describe('validateAndHashReportArtifacts', () => {
  it.each([
    ['省略 bundle', undefined],
    ['research-preview bundle', researchPreview()],
    ['结构伪造 formal bundle', { ...createClientReportBundle(REPORT_INPUT, CLIENT_PROFILE), kind: 'formal', publishable: true }],
  ])('%s 在读取或哈希正式 artifacts 前被拒绝', async (_label, bundle) => {
    const absentRoot = join(tmpdir(), `preplan-formal-validator-untrusted-${Date.now()}`)

    await expect((validateAndHashReportArtifacts as unknown as (
      root: string, identity: Record<string, unknown>, sensitive: undefined, bundle?: unknown,
    ) => Promise<unknown>)(absentRoot, {
      manifestId: 'manifest-1', packageId: 'package-1', projectId: 'golden-project',
      sourceRevision: 57, createdAt: '2026-08-28T10:00:00.000Z',
    }, undefined, bundle)).rejects.toThrow('SITE_BOUNDARY_RESEARCH_PREVIEW_NOT_PUBLISHABLE')
  })

  it('returns non-publishable research evidence without manifest or package identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-preview-validate-'))
    roots.push(root)
    await mkdir(join(root, 'html'), { recursive: true })
    await writeFile(join(root, 'html', 'index.html'), '<html data-report-revision="57"></html>')
    await writeFile(join(root, 'report.pptx'), Buffer.from('PK report'))
    await writeFile(join(root, 'report.pdf'), Buffer.from('%PDF-1.7\n%%EOF'))
    const validatePreview = (ArtifactValidation as unknown as {
      readonly validateAndHashResearchPreviewArtifacts?: (
        root: string,
        identity: Readonly<{ projectId: string; sourceRevision: number; createdAt: string }>,
        preview: unknown,
        formats?: readonly ('html' | 'pptx' | 'pdf')[],
      ) => Promise<Record<string, unknown>>
    }).validateAndHashResearchPreviewArtifacts
    expect(validatePreview, '独立 research-preview evidence validator 尚未实现').toBeTypeOf('function')
    if (validatePreview === undefined) return

    const evidence = await validatePreview(root, {
      projectId: 'golden-project', sourceRevision: 57, createdAt: '2026-08-28T10:00:00.000Z',
    }, researchPreview(), ['html', 'pptx', 'pdf'])
    expect(evidence).toMatchObject({
      kind: 'research_preview_evidence', publishable: false,
      projectId: 'golden-project', sourceRevision: 57,
      researchBoundary: {
        boundaryId: 'research-boundary-1', assetId: previewAsset.assetId, assetSha256: previewAssetSha256,
      },
      artifacts: expect.arrayContaining([
        expect.objectContaining({ format: 'html' }),
        expect.objectContaining({ format: 'pptx' }),
        expect.objectContaining({ format: 'pdf' }),
      ]),
    })
    expect(evidence).not.toHaveProperty('manifestId')
    expect(evidence).not.toHaveProperty('packageId')
  })

  it('rejects an artifact set with a different invisible recommendation identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-validate-'))
    roots.push(root)
    await mkdir(join(root, 'html'), { recursive: true })
    await writeFile(join(root, 'html', 'index.html'), '<html><head><meta name="preplan-project-id" content="project-1"><meta name="preplan-source-revision" content="57"><meta name="preplan-recommendation-id" content="recommendation-other"><meta name="preplan-adopted-assets" content="concept-1"></head><body>成果</body></html>')
    await writeFile(join(root, 'report.pptx'), Buffer.from('PK report'))
    await writeFile(join(root, 'report.pdf'), Buffer.from('%PDF-1.7\n%%EOF'))

    await expect(validateAndHashReportArtifacts(root, {
      manifestId: 'manifest-1', packageId: 'package-1', projectId: 'project-1',
      sourceRevision: 57, createdAt: '2026-08-28T10:00:00.000Z',
      recommendationId: 'recommendation-r57-cultural-riverfront',
      adoptedAssetIds: ['concept-1'],
    }, undefined, formalBundle())).rejects.toThrow(/recommendation identity/iu)
  })

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
    }, undefined, formalBundle())).rejects.toThrow(/revision/u)
  })
})
