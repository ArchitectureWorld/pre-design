import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { assertClientReportPolicy } from '../src/report/client-policy.ts'
import { planClientPages } from '../src/report/page-plan.ts'
import { renderHtml } from '../src/report/render-html.ts'
import { renderPdf } from '../src/report/render-pdf.ts'
import { renderPptx } from '../src/report/render-pptx.ts'
import { renderPrintHtml } from '../src/report/render-print-html.ts'
import { validateAndHashReportArtifacts } from '../src/report/validate-artifacts.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'
import { inspectPptx } from './support/pptx-inspector.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const body = (value: string) => value.match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu)?.[1] ?? ''
const visibleBody = (value: string) => body(value).replace(/<script\b[\s\S]*?<\/script>/giu, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/giu, ' ').replace(/<[^>]+>/gu, ' ')
const compactVisibleText = (value: string) => value.replace(/\s+/gu, '')

describe('formal boundary artifact identity', () => {
  it('binds the trusted formal boundary digest through HTML, PPTX, print/PDF and production validation, then rejects a print mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-formal-boundary-artifacts-'))
    roots.push(root)
    const image = join(root, 'redline.png')
    await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    const sha256 = createHash('sha256').update(await readFile(image)).digest('hex')
    const digest = 'd'.repeat(64)
    const profile = {
      ...CLIENT_PROFILE,
      assetBindings: [], requiredVisualRoles: ['map' as const],
    }
    const input = {
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, kind: 'evidence' as const, sourcePath: image, sha256, width: 1, height: 1 }],
      siteBoundary: { boundaryId: 'boundary-1', assetId: 'concept-1', status: 'confirmed' as const, confirmedRevision: 57, source: 'approved_redline' as const, sourceSha256: sha256, assetSha256: sha256, integrityDigest: digest },
    }
    const bundle = createClientReportBundle(input, profile)
    expect(bundle.identity).toMatchObject({
      siteBoundaryId: 'boundary-1', siteBoundaryAssetId: 'concept-1',
      siteBoundaryAssetSha256: sha256, siteBoundaryIntegrityDigest: digest,
    })
    const contexts = {
      html: { report: bundle.report, plan: planClientPages(bundle.report, 'html'), identity: bundle.identity },
      pptx: { report: bundle.report, plan: planClientPages(bundle.report, 'pptx'), identity: bundle.identity },
      pdf: { report: bundle.report, plan: planClientPages(bundle.report, 'pdf'), identity: bundle.identity },
    }
    await renderHtml(contexts.html, root)
    const print = await renderPrintHtml(contexts.pdf, root)
    await renderPptx(contexts.pptx, join(root, 'report.pptx'))
    await renderPdf(print, join(root, 'report.pdf'), 'fake-edge.exe', async () => { await writeFile(join(root, 'report.pdf'), Buffer.from('%PDF-1.7\n%%EOF')) })

    const manifest = await validateAndHashReportArtifacts(root, {
      manifestId: 'manifest-1', packageId: 'package-1', projectId: 'golden-project', sourceRevision: 57,
      recommendationId: 'recommendation-r57-cultural-riverfront', adoptedAssetIds: ['concept-1'], siteBoundaryIntegrityDigest: digest,
      createdAt: '2026-08-28T10:00:00.000Z',
    }, undefined, bundle)
    const html = await readFile(join(root, 'html', 'index.html'), 'utf8')
    const printHtml = await readFile(print, 'utf8')
    const pptx = (await inspectPptx(join(root, 'report.pptx'))).slideTexts.join('\n')
    expect(manifest.siteBoundaryIntegrityDigest).toBe(digest)
    for (const [medium, text] of [
      ['HTML', visibleBody(html)],
      ['打印 HTML', visibleBody(printHtml)],
      ['PPTX', pptx],
    ] as const) {
      expect(compactVisibleText(text), `${medium} 缺少已确认项目边界声明`)
        .toContain('项目边界：已由项目资料确认')
    }
    expect(html).toContain(`<meta name="preplan-site-boundary-digest" content="${digest}">`)
    expect(printHtml).toContain(`<meta name="preplan-site-boundary-digest" content="${digest}">`)
    expect(body(html)).not.toContain(digest)
    expect(body(printHtml)).not.toContain(digest)
    expect(pptx).not.toContain(digest)
    expect([visibleBody(html), visibleBody(printHtml), pptx].join('\n')).not.toMatch(
      /attachment\s*id|asset\s*id|sha(?:-?256)?|boundary-1|concept-1|Revision|确认日志|Gate|Workflow/iu,
    )

    for (const leaked of [
      'attachment ID: internal-only',
      'boundary ID: internal-only',
      '边界 ID：internal-only',
      'boundary-1',
      'concept-1',
    ]) {
      await writeFile(join(root, 'html', 'index.html'), html.replace('<body>', `<body><p>${leaked}</p>`), 'utf8')
      await expect(validateAndHashReportArtifacts(root, {
        manifestId: 'manifest-1', packageId: 'package-1', projectId: 'golden-project', sourceRevision: 57,
        recommendationId: 'recommendation-r57-cultural-riverfront', adoptedAssetIds: ['concept-1'], siteBoundaryIntegrityDigest: digest,
        createdAt: '2026-08-28T10:00:00.000Z',
      }, { siteBoundary: { boundaryId: 'boundary-1', assetId: 'concept-1' } }, bundle))
        .rejects.toThrow('forbidden client-visible term')
    }
    await writeFile(join(root, 'html', 'index.html'), html, 'utf8')

    await writeFile(print, printHtml.replace(digest, 'e'.repeat(64)), 'utf8')
    await expect(validateAndHashReportArtifacts(root, {
      manifestId: 'manifest-1', packageId: 'package-1', projectId: 'golden-project', sourceRevision: 57,
      recommendationId: 'recommendation-r57-cultural-riverfront', adoptedAssetIds: ['concept-1'], siteBoundaryIntegrityDigest: digest,
      createdAt: '2026-08-28T10:00:00.000Z',
    }, undefined, bundle)).rejects.toThrow('site boundary identity')
  })

  it('binds a closed-coordinate geometry to its governed derived map without equating geometry and image file SHA values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-coordinate-boundary-artifacts-'))
    roots.push(root)
    const image = join(root, 'derived-boundary.svg')
    await writeFile(image, '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>')
    const derivedMapSha256 = createHash('sha256').update(await readFile(image)).digest('hex')
    const coordinates = [[0, 0], [4, 0], [0, 3], [0, 0]] as const
    const geometrySha256 = createHash('sha256').update(JSON.stringify({ crs: 'EPSG:4490', coordinates })).digest('hex')
    const digest = 'c'.repeat(64)
    const profile = {
      ...CLIENT_PROFILE,
      assetBindings: [{ ...CLIENT_PROFILE.assetBindings[0]!, sha256: derivedMapSha256, width: 1, height: 1 }],
      requiredVisualRoles: ['product-scene' as const, 'map' as const],
    }
    const input = {
      ...REPORT_INPUT,
      visualAssets: [
        ...REPORT_INPUT.visualAssets.map(asset => ({ ...asset, sourcePath: image, sha256: derivedMapSha256, width: 1, height: 1 })),
        { assetId: 'derived-boundary-map', kind: 'deterministic' as const, caption: '闭合坐标派生边界图', sourcePath: image, mimeType: 'image/svg+xml' as const, sha256: derivedMapSha256, width: 1, height: 1, boundaryGeometrySha256: geometrySha256 },
      ],
      adoptedAssetIds: [...(REPORT_INPUT.adoptedAssetIds ?? ['concept-1']), 'derived-boundary-map'],
      siteBoundary: { boundaryId: 'coordinate-boundary-1', assetId: 'derived-boundary-map', status: 'confirmed' as const, confirmedRevision: 57, source: 'closed_coordinates' as const, geometrySha256, assetSha256: derivedMapSha256, integrityDigest: digest },
    }

    const bundle = createClientReportBundle(input, profile)
    expect(bundle.identity).toMatchObject({
      siteBoundaryId: 'coordinate-boundary-1', siteBoundaryAssetId: 'derived-boundary-map',
      siteBoundaryAssetSha256: derivedMapSha256, siteBoundaryGeometrySha256: geometrySha256,
      siteBoundaryIntegrityDigest: digest,
    })
    assertClientReportPolicy(bundle.report)
    const contexts = {
      html: { report: bundle.report, plan: planClientPages(bundle.report, 'html'), identity: bundle.identity },
      pptx: { report: bundle.report, plan: planClientPages(bundle.report, 'pptx'), identity: bundle.identity },
      pdf: { report: bundle.report, plan: planClientPages(bundle.report, 'pdf'), identity: bundle.identity },
    }
    await renderHtml(contexts.html, root)
    const print = await renderPrintHtml(contexts.pdf, root)
    await renderPptx(contexts.pptx, join(root, 'report.pptx'))
    await renderPdf(print, join(root, 'report.pdf'), 'fake-edge.exe', async () => { await writeFile(join(root, 'report.pdf'), Buffer.from('%PDF-1.7\n%%EOF')) })

    await expect(validateAndHashReportArtifacts(root, {
      manifestId: 'manifest-coordinate-1', packageId: 'package-coordinate-1', projectId: 'golden-project', sourceRevision: 57,
      recommendationId: 'recommendation-r57-cultural-riverfront', adoptedAssetIds: ['concept-1', 'derived-boundary-map'], siteBoundaryIntegrityDigest: digest,
      createdAt: '2026-08-28T10:00:00.000Z',
    }, undefined, bundle)).resolves.toMatchObject({ siteBoundaryIntegrityDigest: digest })
    expect(derivedMapSha256).not.toBe(geometrySha256)
    await expect(() => createClientReportBundle({
      ...input,
      visualAssets: input.visualAssets.map(asset => asset.assetId === 'derived-boundary-map'
        ? { ...asset, boundaryGeometrySha256: 'e'.repeat(64) }
        : asset),
    }, profile)).toThrow('SITE_BOUNDARY_SOURCE_MISMATCH')
    await expect(() => createClientReportBundle({
      ...input,
      visualAssets: input.visualAssets.map(asset => asset.assetId === 'derived-boundary-map'
        ? { ...asset, kind: 'concept' as const }
        : asset),
    }, profile)).toThrow('SITE_BOUNDARY_PROFILE_CONFLICT')
  })
})
