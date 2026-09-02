import { describe, expect, it } from 'vitest'
import * as ClientProjection from '../src/report/client-projection.ts'
import { createClientReportBundle, injectGovernedSiteBoundaryBinding } from '../src/report/client-projection.ts'
import type { ClientAssetBinding, ClientProjectProfile, ClientReportBundle, ClientResearchPreviewBundle } from '../src/report/client-types.ts'
import type { FrozenProjectInput, ReportAsset } from '../src/report/types.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const assetSha256 = '9'.repeat(64)
const integrityDigest = '8'.repeat(64)
const governedBoundaryAsset: ReportAsset = {
  assetId: 'governed-boundary-asset',
  chapterId: '07',
  kind: 'evidence',
  caption: '项目红线图',
  sourcePath: 'C:/fixtures/governed-boundary.png',
  mimeType: 'image/png',
  sha256: assetSha256,
  width: 1600,
  height: 1000,
}
const formalInput: FrozenProjectInput = {
  ...REPORT_INPUT,
  visualAssets: [...REPORT_INPUT.visualAssets, governedBoundaryAsset],
  adoptedAssetIds: [...(REPORT_INPUT.adoptedAssetIds ?? []), governedBoundaryAsset.assetId],
  siteBoundary: {
    status: 'confirmed',
    boundaryId: 'governed-boundary-1',
    assetId: governedBoundaryAsset.assetId,
    confirmedRevision: 57,
    source: 'approved_redline',
    sourceSha256: assetSha256,
    assetSha256,
    integrityDigest,
  },
}
const governedBinding: ClientAssetBinding = {
  assetId: governedBoundaryAsset.assetId,
  role: 'map',
  chapterId: 'chapter-07',
  sha256: assetSha256,
  width: 1600,
  height: 1000,
  analysisKind: 'site-boundary',
  provenance: {
    sourceLabel: '项目红线图',
    sourceDate: '2026-08-28',
    locator: '项目资料',
    sourceFileSha256: assetSha256,
    evidenceIds: ['evidence-1'],
  },
  cartography: {
    boundary: 'confirmed',
    boundarySourceSha256: assetSha256,
    legend: 'present',
    northArrow: 'present',
    scale: { kind: 'nts' },
  },
}
const researchBinding: ClientAssetBinding = {
  ...governedBinding,
  cartography: {
    boundary: 'research',
    disclosures: ['研究范围（待核）', '非法定红线', '非测绘成果'],
    legend: 'present',
    northArrow: 'present',
    scale: { kind: 'nts' },
  },
}
const researchInput = {
  ...formalInput,
  adoptedAssetIds: (formalInput.adoptedAssetIds ?? []).filter(assetId => assetId !== governedBoundaryAsset.assetId),
  siteBoundary: {
    status: 'synthetic_research',
    boundaryId: 'research-1',
    source: 'approved_redline',
    assetId: governedBoundaryAsset.assetId,
    assetSha256,
    declarations: ['研究范围（待核）', '非法定红线', '非测绘成果'],
  },
} as unknown as FrozenProjectInput

function profileWith(...bindings: readonly ClientAssetBinding[]): ClientProjectProfile {
  return {
    ...CLIENT_PROFILE,
    assetBindings: [...CLIENT_PROFILE.assetBindings, ...bindings],
  }
}

function typeSeparation(preview: ClientResearchPreviewBundle): void {
  // @ts-expect-error research preview is intentionally not assignable to a formal publishable bundle
  const formal: ClientReportBundle = preview
  void formal
}
void typeSeparation

describe('governed site-boundary profile binding', () => {
  it('projects one explicit synthetic research asset only through the non-publishable preview API', () => {
    const preview = (ClientProjection as unknown as {
      readonly createClientResearchPreviewBundle?: (input: FrozenProjectInput, profile: ClientProjectProfile) => ClientReportBundle
    }).createClientResearchPreviewBundle
    expect(preview, '独立 research-preview projection 尚未实现').toBeTypeOf('function')
    if (preview === undefined) return

    expect(() => createClientReportBundle(researchInput, profileWith(researchBinding)))
      .toThrow('SITE_BOUNDARY_PROFILE_CONFLICT')
    const bundle = preview(researchInput, profileWith(researchBinding))
    expect(bundle).toMatchObject({
      kind: 'research_preview', publishable: false,
      researchBoundary: { boundaryId: 'research-1', assetId: governedBoundaryAsset.assetId, assetSha256 },
    })
    expect(bundle.report.assets.filter(asset => asset.analysisKind === 'site-boundary')).toEqual([
      expect.objectContaining({
        assetId: governedBoundaryAsset.assetId,
        sha256: assetSha256,
        cartography: {
          boundary: 'research',
          disclosures: ['研究范围（待核）', '非法定红线', '非测绘成果'],
          legend: 'present',
          northArrow: 'present',
          scale: { kind: 'nts' },
        },
      }),
    ])
    expect(bundle.identity.siteBoundaryIntegrityDigest).toBeUndefined()
  })

  it.each([
    ['different input asset id', { ...researchInput, siteBoundary: { ...researchInput.siteBoundary, assetId: 'different-asset' } }, profileWith(researchBinding)],
    ['different input SHA', { ...researchInput, siteBoundary: { ...researchInput.siteBoundary, assetSha256: '7'.repeat(64) } }, profileWith(researchBinding)],
    ['duplicate binding', researchInput, profileWith(researchBinding, researchBinding)],
    ['different binding SHA', researchInput, profileWith({ ...researchBinding, sha256: '7'.repeat(64) })],
    ['confirmed profile claim', researchInput, profileWith({ ...researchBinding, cartography: { ...researchBinding.cartography!, boundary: 'confirmed' } })],
    ['incomplete disclosures', researchInput, profileWith({ ...researchBinding, cartography: { ...researchBinding.cartography!, disclosures: ['研究范围（待核）'] } })],
    ['adopted research asset', { ...researchInput, adoptedAssetIds: [...(researchInput.adoptedAssetIds ?? []), governedBoundaryAsset.assetId] }, profileWith(researchBinding)],
    ['missing adopted asset list', { ...researchInput, adoptedAssetIds: undefined }, profileWith(researchBinding)],
    ['duplicate frozen boundary asset', { ...researchInput, visualAssets: [...researchInput.visualAssets, governedBoundaryAsset] }, profileWith(researchBinding)],
    ['concept boundary asset', {
      ...researchInput,
      visualAssets: researchInput.visualAssets.map(asset => asset.assetId === governedBoundaryAsset.assetId ? { ...asset, kind: 'concept' as const } : asset),
    }, profileWith(researchBinding)],
  ])('rejects unsafe research-preview projection: %s', (_label, input, profile) => {
    const preview = (ClientProjection as unknown as {
      readonly createClientResearchPreviewBundle?: (input: FrozenProjectInput, profile: ClientProjectProfile) => ClientReportBundle
    }).createClientResearchPreviewBundle
    expect(preview, '独立 research-preview projection 尚未实现').toBeTypeOf('function')
    if (preview === undefined) return
    expect(() => preview(input as FrozenProjectInput, profile)).toThrow('SITE_BOUNDARY_RESEARCH_PREVIEW_CONFLICT')
  })

  it.each([
    ['not_provided', { status: 'not_provided' as const }],
    ['pending_confirmation', { status: 'pending_confirmation' as const, boundaryId: 'pending-1', source: 'approved_redline' as const }],
    ['synthetic_research', {
      status: 'synthetic_research' as const, boundaryId: 'research-1', source: 'approved_redline' as const,
      declarations: ['研究范围（待核）', '非法定红线', '非测绘成果'] as const,
    }],
  ])('rejects a profile-created formal boundary while governance is %s', (_status, siteBoundary) => {
    expect(() => createClientReportBundle({ ...formalInput, siteBoundary }, profileWith(governedBinding)))
      .toThrow('SITE_BOUNDARY_PROFILE_CONFLICT')
  })

  it.each([
    ['not_provided', { status: 'not_provided' as const }, 'research' as const],
    ['not_provided', { status: 'not_provided' as const }, 'confirmed' as const],
    ['pending_confirmation', { status: 'pending_confirmation' as const, boundaryId: 'pending-1', source: 'approved_redline' as const }, 'research' as const],
    ['pending_confirmation', { status: 'pending_confirmation' as const, boundaryId: 'pending-1', source: 'approved_redline' as const }, 'confirmed' as const],
    ['synthetic_research', {
      status: 'synthetic_research' as const, boundaryId: 'research-1', source: 'approved_redline' as const,
      declarations: ['研究范围（待核）', '非法定红线', '非测绘成果'] as const,
    }, 'research' as const],
    ['synthetic_research', {
      status: 'synthetic_research' as const, boundaryId: 'research-1', source: 'approved_redline' as const,
      declarations: ['研究范围（待核）', '非法定红线', '非测绘成果'] as const,
    }, 'confirmed' as const],
  ])('rejects a profile-created research or confirmed cartography boundary while governance is %s',
    (_status, siteBoundary, boundaryClaim) => {
      const { analysisKind: _analysisKind, ...bindingWithoutAnalysisKind } = governedBinding
      const profileBoundary = {
        ...bindingWithoutAnalysisKind,
        cartography: {
          ...bindingWithoutAnalysisKind.cartography!,
          boundary: boundaryClaim,
          disclosures: ['研究范围（待核）', '非法定红线', '非测绘成果'],
        },
      }

      expect(() => createClientReportBundle({ ...formalInput, siteBoundary }, profileWith(profileBoundary)))
        .toThrow('SITE_BOUNDARY_PROFILE_CONFLICT')
    })

  it('injects exactly one governed binding when the profile omits it', () => {
    const bundle = createClientReportBundle(formalInput, profileWith())
    const boundaries = bundle.report.assets.filter(asset => asset.analysisKind === 'site-boundary')

    expect(boundaries).toHaveLength(1)
    expect(boundaries[0]).toMatchObject({
      assetId: governedBoundaryAsset.assetId,
      sha256: assetSha256,
      sourceKind: 'project-source',
      cartography: { boundary: 'confirmed', boundarySourceSha256: assetSha256 },
    })
    expect(bundle.identity).toMatchObject({
      siteBoundaryId: 'governed-boundary-1',
      siteBoundaryAssetId: governedBoundaryAsset.assetId,
      siteBoundaryAssetSha256: assetSha256,
      siteBoundaryIntegrityDigest: integrityDigest,
    })
  })

  it('accepts one profile binding only when it is identical to the governed binding', () => {
    expect(injectGovernedSiteBoundaryBinding(formalInput, profileWith()).assetBindings.at(-1))
      .toEqual(governedBinding)
    const bundle = createClientReportBundle(formalInput, profileWith(governedBinding))

    expect(bundle.report.assets.filter(asset => asset.analysisKind === 'site-boundary'))
      .toEqual([expect.objectContaining({ assetId: governedBoundaryAsset.assetId, sha256: assetSha256 })])
  })

  it.each([
    ['duplicate governed binding', profileWith(governedBinding, governedBinding)],
    ['different asset id', profileWith({ ...governedBinding, assetId: 'different-boundary-asset' })],
    ['different asset SHA', profileWith({ ...governedBinding, sha256: '7'.repeat(64) })],
    ['different source SHA', profileWith({
      ...governedBinding,
      provenance: { ...governedBinding.provenance!, sourceFileSha256: '6'.repeat(64) },
    })],
    ['different geometry lineage', profileWith({
      ...governedBinding,
      cartography: { ...governedBinding.cartography!, boundaryGeometrySha256: '5'.repeat(64) },
    })],
    ['ai-concept boundary', profileWith({
      ...CLIENT_PROFILE.assetBindings[0]!,
      role: 'map',
      analysisKind: 'site-boundary',
      cartography: governedBinding.cartography,
    })],
  ])('fails closed on a conflicting profile boundary: %s', (_label, profile) => {
    expect(() => createClientReportBundle(formalInput, profile))
      .toThrow('SITE_BOUNDARY_PROFILE_CONFLICT')
  })
})
