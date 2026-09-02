import { describe, expect, it } from 'vitest'
import { assertClientReportPolicy, validateClientReportPolicy } from '../src/report/client-policy.ts'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const CLIENT_REPORT = createClientReportBundle(REPORT_INPUT, CLIENT_PROFILE).report

function professionalVisualReport() {
  const analyses = [
    'regional-context', 'site-boundary', 'existing-condition',
    'accessibility', 'circulation', 'constraints',
  ] as const
  const chartTopics = [
    'existing-condition', 'audience-demand', 'accessibility',
    'operation-investment', 'implementation-phasing', 'operation-investment',
  ] as const
  const baseAsset = CLIENT_REPORT.assets[0]!
  const provenance = {
    sourceLabel: '工程夹具图件资料',
    sourceDate: '2026-08-28',
    locator: '项目简报·专业图件',
    sourceFileSha256: 'b'.repeat(64),
    evidenceIds: ['evidence-1'],
  }
  const assets = [
    ...analyses.map((analysisKind, index) => ({
      ...baseAsset,
      assetId: `analysis-${index + 1}`,
      role: index < 3 ? 'map' as const : 'diagram' as const,
      analysisKind,
      sha256: String(index + 1).repeat(64),
      sourceKind: 'ai-concept' as const,
      provenance,
      cartography: {
        boundary: analysisKind === 'site-boundary' ? 'confirmed' as const : 'not-applicable' as const,
        ...(analysisKind === 'site-boundary' ? { boundarySourceSha256: 'b'.repeat(64) } : {}),
        legend: 'present' as const,
        northArrow: 'present' as const,
        scale: { kind: 'nts' as const },
      },
    })),
    ...chartTopics.map((chartTopic, index) => ({
      ...baseAsset,
      assetId: `chart-${index + 1}`,
      role: 'chart' as const,
      chartTopic,
      sha256: String.fromCharCode(97 + index).repeat(64),
      sourceKind: 'ai-concept' as const,
      provenance,
      chartContract: { unit: '人次/日', methodology: '按工程夹具统计口径汇总' },
    })),
  ]
  return {
    ...CLIENT_REPORT,
    visualContractVersion: 'architectural-v1' as const,
    assets,
    chapters: CLIENT_REPORT.chapters.map((chapter, index) => index >= 6 ? chapter : {
      ...chapter,
      blocks: [{
        type: 'evidence' as const,
        headline: `专业场地分析 ${index + 1}`,
        evidenceIds: ['evidence-1'],
        assetIds: [`analysis-${index + 1}`],
      }, ...chapter.blocks.map(block => block.type === 'evidence'
        ? { ...block, assetIds: [`chart-${index + 1}`] }
        : block),
      ],
    }),
  }
}

describe('client report policy', () => {
  it('rejects profile-only visual SHA spoofing instead of treating binding metadata as frozen asset truth', () => {
    const profile = { ...CLIENT_PROFILE, assetBindings: [{ ...CLIENT_PROFILE.assetBindings[0]!, sha256: 'b'.repeat(64) }] }
    const input = { ...REPORT_INPUT, visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sha256: 'a'.repeat(64), width: 1920, height: 1080 }] }
    expect(() => createClientReportBundle(input, profile)).toThrow('client asset binding does not match frozen asset')
  })

  it('uses stable boundary violations when research disclosures are incomplete or a formal source does not align', () => {
    const report = professionalVisualReport()
    const research = validateClientReportPolicy({
      ...report,
      assets: report.assets.map(asset => asset.assetId === 'analysis-2' ? {
        ...asset, cartography: { ...asset.cartography!, boundary: 'research', disclosures: ['研究范围（待核）'] },
      } : asset),
    } as never)
    const mismatch = validateClientReportPolicy({
      ...report,
      assets: report.assets.map(asset => asset.assetId === 'analysis-2' ? {
        ...asset, cartography: { ...asset.cartography!, boundary: 'confirmed', boundarySourceSha256: 'c'.repeat(64) },
      } : asset),
    } as never)

    expect(research).toContainEqual(expect.objectContaining({ code: 'SITE_BOUNDARY_DISCLOSURE_MISSING' }))
    expect(mismatch).toContainEqual(expect.objectContaining({ code: 'SITE_BOUNDARY_SOURCE_MISMATCH' }))
  })

  it('accepts the complete client fixture', () => {
    expect(validateClientReportPolicy(CLIENT_REPORT)).toEqual([])
  })

  it('reports the exact client path for internal governance vocabulary', () => {
    const report = {
      ...CLIENT_REPORT,
      chapters: CLIENT_REPORT.chapters.map((chapter, index) =>
        index === 0 ? { ...chapter, claim: 'Gate G1 已通过 Revision 57' } : chapter),
    }

    expect(validateClientReportPolicy(report)).toContainEqual({
      code: 'CLIENT_FORBIDDEN_TERM',
      path: 'chapters[0].claim',
      message: expect.stringMatching(/Gate/u),
    })
  })

  it.each([
    'mcp__internal__tool', 'gemini-3.1-flash-image', 'C:\\private\\source.png', '\\\\nas\\secret', '/srv/private/source.png',
    'a'.repeat(64), 'INFO requestId=abc', '{"internal":true}',
  ])('rejects internal tool, model, path, hash, log, and JSON text from client-visible copy: %s', value => {
    const report = {
      ...CLIENT_REPORT,
      chapters: CLIENT_REPORT.chapters.map((chapter, index) => index === 0 ? { ...chapter, claim: value } : chapter),
    }
    expect(validateClientReportPolicy(report)).toContainEqual(expect.objectContaining({
      code: 'CLIENT_FORBIDDEN_TERM', path: 'chapters[0].claim',
    }))
  })

  it('treats every image source the same while still rejecting unsupported evidence', () => {
    const report = {
      ...CLIENT_REPORT,
      evidence: CLIENT_REPORT.evidence.map((evidence, index) =>
        index === 0 ? { ...evidence, sourceLabel: '' } : evidence),
      assets: CLIENT_REPORT.assets.map((asset, index) =>
        index === 0 ? { ...asset, disclosure: undefined } : asset),
    }

    expect(() => assertClientReportPolicy(report)).toThrow(/EVIDENCE_SOURCE_MISSING/u)
    expect(validateClientReportPolicy(report).map(row => row.code)).not.toContain('AI_DISCLOSURE_MISSING')
  })

  it('rejects a contract-enabled report without six chart analyses and the required site-analysis series', () => {
    const report = {
      ...CLIENT_REPORT,
      visualContractVersion: 'architectural-v1' as const,
    }

    expect(validateClientReportPolicy(report).map(row => row.code)).toEqual(expect.arrayContaining([
      'DATA_CHART_COUNT_LOW',
      'DATA_CHART_TOPIC_COVERAGE_LOW',
      'SITE_ANALYSIS_SERIES_INCOMPLETE',
    ]))
  })

  it('accepts professionally contracted visuals regardless of source kind', () => {
    expect(validateClientReportPolicy(professionalVisualReport())).toEqual([])
  })

  it('separates provenance, site-drawing, and chart-contract failures with stable codes', () => {
    const report = professionalVisualReport()
    const violations = validateClientReportPolicy({
      ...report,
      assets: report.assets.map(asset => asset.assetId === 'analysis-1'
        ? { ...asset, provenance: { ...asset.provenance!, sourceDate: '2026-13-28' } }
        : asset.assetId === 'analysis-2'
          ? { ...asset, cartography: { ...asset.cartography!, boundary: 'not-applicable' as const } }
          : asset.assetId === 'chart-1'
            ? { ...asset, chartContract: { unit: '', methodology: '' } }
            : asset),
    })

    expect(violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'VISUAL_PROVENANCE_INVALID', path: 'assets[0].provenance.sourceDate' }),
      expect.objectContaining({ code: 'SITE_DRAWING_CONTRACT_INVALID', path: 'assets[1].cartography.boundary' }),
      expect.objectContaining({ code: 'CHART_CONTRACT_INVALID', path: 'assets[6].chartContract' }),
    ]))
  })

  it('turns malformed JSON-shaped visual contracts into stable violations without throwing', () => {
    const report = professionalVisualReport()
    const malformed = {
      ...report,
      assets: report.assets.map(asset => asset.assetId === 'analysis-1'
        ? { ...asset, provenance: {} }
        : asset.assetId === 'analysis-2'
          ? { ...asset, cartography: { boundary: 'unknown' } }
          : asset.assetId === 'chart-1'
            ? { ...asset, chartContract: {} }
            : asset),
    }

    expect(() => validateClientReportPolicy(malformed as never)).not.toThrow()
    expect(validateClientReportPolicy(malformed as never).map(row => row.code)).toEqual(expect.arrayContaining([
      'VISUAL_PROVENANCE_INVALID', 'SITE_DRAWING_CONTRACT_INVALID', 'CHART_CONTRACT_INVALID',
    ]))
  })

  it.each([
    ['sourceLabel', (report: ReturnType<typeof professionalVisualReport>) => ({ ...report.assets[0]!, provenance: { ...report.assets[0]!.provenance!, sourceLabel: undefined } }), 'VISUAL_PROVENANCE_INVALID', 'assets[0].provenance.sourceLabel'],
    ['sourceDate', (report: ReturnType<typeof professionalVisualReport>) => ({ ...report.assets[0]!, provenance: { ...report.assets[0]!.provenance!, sourceDate: 'invalid' } }), 'VISUAL_PROVENANCE_INVALID', 'assets[0].provenance.sourceDate'],
    ['locator', (report: ReturnType<typeof professionalVisualReport>) => ({ ...report.assets[0]!, provenance: { ...report.assets[0]!.provenance!, locator: '' } }), 'VISUAL_PROVENANCE_INVALID', 'assets[0].provenance.locator'],
    ['sourceFileSha256', (report: ReturnType<typeof professionalVisualReport>) => ({ ...report.assets[0]!, provenance: { ...report.assets[0]!.provenance!, sourceFileSha256: 'not-a-sha' } }), 'VISUAL_PROVENANCE_INVALID', 'assets[0].provenance.sourceFileSha256'],
    ['unknown evidence', (report: ReturnType<typeof professionalVisualReport>) => ({ ...report.assets[0]!, provenance: { ...report.assets[0]!.provenance!, evidenceIds: ['unknown-evidence'] } }), 'VISUAL_PROVENANCE_INVALID', 'assets[0].provenance.evidenceIds'],
    ['missing non-boundary marker', (report: ReturnType<typeof professionalVisualReport>) => ({ ...report.assets[0]!, cartography: { ...report.assets[0]!.cartography!, boundary: undefined } }), 'SITE_DRAWING_CONTRACT_INVALID', 'assets[0].cartography.boundary'],
    ['site boundary marked not applicable', (report: ReturnType<typeof professionalVisualReport>) => ({ ...report.assets[1]!, cartography: { ...report.assets[1]!.cartography!, boundary: 'not-applicable' } }), 'SITE_DRAWING_CONTRACT_INVALID', 'assets[1].cartography.boundary'],
    ['missing legend', (report: ReturnType<typeof professionalVisualReport>) => ({ ...report.assets[0]!, cartography: { ...report.assets[0]!.cartography!, legend: undefined } }), 'SITE_DRAWING_CONTRACT_INVALID', 'assets[0].cartography.legend'],
    ['missing north arrow', (report: ReturnType<typeof professionalVisualReport>) => ({ ...report.assets[0]!, cartography: { ...report.assets[0]!.cartography!, northArrow: undefined } }), 'SITE_DRAWING_CONTRACT_INVALID', 'assets[0].cartography.northArrow'],
    ['invalid scale', (report: ReturnType<typeof professionalVisualReport>) => ({ ...report.assets[0]!, cartography: { ...report.assets[0]!.cartography!, scale: undefined } }), 'SITE_DRAWING_CONTRACT_INVALID', 'assets[0].cartography.scale'],
    ['chart unit', (report: ReturnType<typeof professionalVisualReport>) => ({ ...report.assets[6]!, chartContract: { ...report.assets[6]!.chartContract!, unit: '' } }), 'CHART_CONTRACT_INVALID', 'assets[6].chartContract.unit'],
    ['chart methodology', (report: ReturnType<typeof professionalVisualReport>) => ({ ...report.assets[6]!, chartContract: { ...report.assets[6]!.chartContract!, methodology: '' } }), 'CHART_CONTRACT_INVALID', 'assets[6].chartContract.methodology'],
  ])('rejects invalid professional %s contract at the stable path', (_field, mutate, code, path) => {
    const report = professionalVisualReport()
    const asset = mutate(report)
    const violations = validateClientReportPolicy({
      ...report,
      assets: report.assets.map(candidate => candidate.assetId === asset.assetId ? asset : candidate),
    } as never)

    expect(violations).toContainEqual(expect.objectContaining({ code, path }))
  })

  it('rejects a SHA-256 reused between a map and a chart', () => {
    const report = professionalVisualReport()
    const violations = validateClientReportPolicy({
      ...report,
      assets: report.assets.map(asset => asset.assetId === 'chart-1'
        ? { ...asset, sha256: report.assets[0]!.sha256 }
        : asset),
    })

    expect(violations).toContainEqual(expect.objectContaining({
      code: 'PROFESSIONAL_ASSET_SHA_DUPLICATE',
      path: 'assets',
    }))
  })

  it('rejects incorrect professional roles, repeated professional content, and multiple professional assets on one block', () => {
    const report = professionalVisualReport()
    const violations = validateClientReportPolicy({
      ...report,
      assets: report.assets.map(asset => asset.assetId === 'analysis-1'
        ? { ...asset, role: 'hero' as const }
        : asset.assetId === 'chart-1'
          ? { ...asset, role: 'diagram' as const }
          : asset.assetId === 'analysis-2'
            ? { ...asset, sha256: report.assets[0]!.sha256 }
            : asset),
      chapters: report.chapters.map((chapter, index) => index === 0 ? {
        ...chapter,
        blocks: chapter.blocks.map((block, blockIndex) => blockIndex === 0 && block.type === 'evidence'
          ? { ...block, assetIds: ['analysis-1', 'analysis-2'] }
          : block),
      } : chapter),
    })

    expect(violations.map(row => row.code)).toEqual(expect.arrayContaining([
      'SITE_DRAWING_ROLE_INVALID', 'CHART_ROLE_INVALID', 'PROFESSIONAL_ASSET_SHA_DUPLICATE', 'PROFESSIONAL_ASSET_PAGE_INVALID',
    ]))
  })
})
