import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  deriveVisualAssetsFromSources,
  type SourceVisualDerivationAdapter,
} from '../src/presentation/source-visual-pipeline.ts'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600"/></svg>'
const SVG_SHA256 = createHash('sha256').update(SVG).digest('hex')

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pre-source-visual-pipeline-'))
  await mkdir(join(root, 'source-materials'), { recursive: true })
  const sources = [
    { sourceKey: 'brief-pdf', sourceMaterialId: 'source-material-pdf', sourcePath: join(root, 'source-materials', 'brief.pdf'), originalFileName: 'brief.pdf', mimeType: 'application/pdf', importedAt: '2026-09-09T00:00:00.000Z' },
    { sourceKey: 'site-cad', sourceMaterialId: 'source-material-cad', sourcePath: join(root, 'source-materials', 'site.dwg'), originalFileName: 'site.dwg', mimeType: 'image/vnd.dwg', importedAt: '2026-09-09T00:00:00.000Z' },
    { sourceKey: 'terrain-archive', sourceMaterialId: 'source-material-rar', sourcePath: join(root, 'source-materials', 'terrain.rar'), originalFileName: 'terrain.rar', mimeType: 'application/vnd.rar', importedAt: '2026-09-09T00:00:00.000Z' },
  ] as const
  await Promise.all(sources.map(source => writeFile(source.sourcePath, source.originalFileName)))
  const rendered = join(root, 'rendered.svg')
  await writeFile(rendered, SVG)
  return { root, sources, rendered }
}

function adapter(rendered: string, calls: unknown[]): SourceVisualDerivationAdapter {
  return {
    tool: { name: 'fixture-renderer', version: '1.0.0' },
    async plan(input) {
      calls.push({ phase: 'plan', kind: input.kind, sourceKey: input.source.sourceKey, sourcePath: input.source.sourcePath })
      return [{ key: 'preview', displayName: `${input.source.sourceKey} preview`, semanticRole: 'source_preview', method: `${input.kind}-preview`,
        pageBindings: [{ findingId: 'pre-design:project-brief', role: 'supporting' }] }]
    },
    async derive(input) {
      calls.push({ phase: 'derive', kind: input.kind, sourceKey: input.source.sourceKey, planKey: input.plan.key })
      return { sourcePath: rendered, originalFileName: 'preview.svg', mimeType: 'image/svg+xml', widthPx: 800, heightPx: 600 }
    },
  }
}

describe('source material visual derivation', () => {
  it('turns PDF, CAD and archive sources into traceable visual records through injected tools', async () => {
    const { sources, rendered } = await fixture()
    const calls: unknown[] = []

    const result = await deriveVisualAssetsFromSources({
      sourceMaterials: sources,
      adapters: { pdf: adapter(rendered, calls), cad: adapter(rendered, calls), archive: adapter(rendered, calls) },
      now: () => '2026-09-09T01:02:03.000Z',
    })

    expect(result.blockers).toEqual([])
    expect(result.records.map(record => ({
      sourceMaterialIds: record.sourceMaterialIds,
      mimeType: record.mimeType,
      widthPx: record.widthPx,
      heightPx: record.heightPx,
      sha256: record.sha256,
      origin: record.asset.origin,
      pageBindings: record.asset.pageBindings,
    }))).toEqual([
      { sourceMaterialIds: ['source-material-pdf'], mimeType: 'image/svg+xml', widthPx: 800, heightPx: 600, sha256: SVG_SHA256,
        origin: { type: 'derived_source_material', sourceMaterialKeys: ['brief-pdf'], parentAssetKeys: [], method: 'pdf-preview', sourceTool: { name: 'fixture-renderer', version: '1.0.0' } },
        pageBindings: [{ findingId: 'pre-design:project-brief', role: 'supporting' }] },
      { sourceMaterialIds: ['source-material-cad'], mimeType: 'image/svg+xml', widthPx: 800, heightPx: 600, sha256: SVG_SHA256,
        origin: { type: 'derived_source_material', sourceMaterialKeys: ['site-cad'], parentAssetKeys: [], method: 'cad-preview', sourceTool: { name: 'fixture-renderer', version: '1.0.0' } },
        pageBindings: [{ findingId: 'pre-design:project-brief', role: 'supporting' }] },
      { sourceMaterialIds: ['source-material-rar'], mimeType: 'image/svg+xml', widthPx: 800, heightPx: 600, sha256: SVG_SHA256,
        origin: { type: 'derived_source_material', sourceMaterialKeys: ['terrain-archive'], parentAssetKeys: [], method: 'archive-preview', sourceTool: { name: 'fixture-renderer', version: '1.0.0' } },
        pageBindings: [{ findingId: 'pre-design:project-brief', role: 'supporting' }] },
    ])
    expect(calls).toEqual([
      { phase: 'plan', kind: 'pdf', sourceKey: 'brief-pdf', sourcePath: sources[0].sourcePath },
      { phase: 'derive', kind: 'pdf', sourceKey: 'brief-pdf', planKey: 'preview' },
      { phase: 'plan', kind: 'cad', sourceKey: 'site-cad', sourcePath: sources[1].sourcePath },
      { phase: 'derive', kind: 'cad', sourceKey: 'site-cad', planKey: 'preview' },
      { phase: 'plan', kind: 'archive', sourceKey: 'terrain-archive', sourcePath: sources[2].sourcePath },
      { phase: 'derive', kind: 'archive', sourceKey: 'terrain-archive', planKey: 'preview' },
    ])
  })

  it('does not call a renderer twice when the same derived source key already exists', async () => {
    const { sources, rendered } = await fixture()
    const initialCalls: unknown[] = []
    const initial = await deriveVisualAssetsFromSources({ sourceMaterials: [sources[0]], adapters: { pdf: adapter(rendered, initialCalls) } })
    const repeatCalls: unknown[] = []

    const repeated = await deriveVisualAssetsFromSources({ sourceMaterials: [sources[0]], existingAssets: initial.assets,
      adapters: { pdf: adapter(rendered, repeatCalls) } })

    expect(repeated.assets).toEqual(initial.assets)
    expect(repeated.records[0]?.reused).toBe(true)
    expect(repeatCalls).toEqual([{ phase: 'plan', kind: 'pdf', sourceKey: 'brief-pdf', sourcePath: sources[0].sourcePath }])
  })

  it('reports an explicit blocker rather than pretending that unavailable CAD or RAR input is an image', async () => {
    const { sources } = await fixture()

    const result = await deriveVisualAssetsFromSources({ sourceMaterials: [sources[1], sources[2]] })

    expect(result.assets).toEqual([])
    expect(result.blockers).toEqual([
      { code: 'SOURCE_VISUAL_TOOL_UNAVAILABLE', sourceMaterialId: 'source-material-cad', sourceKey: 'site-cad', kind: 'cad', message: 'CAD source requires an injected renderer.' },
      { code: 'SOURCE_VISUAL_TOOL_UNAVAILABLE', sourceMaterialId: 'source-material-rar', sourceKey: 'terrain-archive', kind: 'archive', message: 'Archive source requires an injected extractor/renderer.' },
    ])
  })

  it('rejects a DWG-labelled output even when an adapter claims an image MIME type', async () => {
    const { sources, root } = await fixture()
    const masquerade = join(root, 'fake.dwg')
    await writeFile(masquerade, 'not a rendered image')
    const fake: SourceVisualDerivationAdapter = {
      tool: { name: 'unsafe-adapter', version: '1.0.0' },
      async plan() { return [{ key: 'bad', displayName: 'bad', semanticRole: 'source_preview', method: 'fake' }] },
      async derive() { return { sourcePath: masquerade, originalFileName: 'fake.dwg', mimeType: 'image/vnd.dwg', widthPx: 800, heightPx: 600 } },
    }

    await expect(deriveVisualAssetsFromSources({ sourceMaterials: [sources[1]], adapters: { cad: fake } }))
      .rejects.toThrow('SOURCE_VISUAL_OUTPUT_NOT_RENDERABLE')
  })
})
