import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateDocumentWithAjv } from '@architectureworld/presentation-contracts'
import { buildPresentationStandardProject } from '../src/presentation/standard-project-adapter.ts'
import { createStandardFrozenProject } from './presentation-standard-fixture.ts'
import type { PresentationAdoptedAssetInput } from '../src/presentation/standard-project-types.ts'

const planner = vi.hoisted(() => ({ compile: vi.fn() }))
vi.mock('../src/presentation/projector/report-outline.ts', () => ({ compileReportOutline: planner.compile }))
const roots: string[] = []
afterEach(async () => { planner.compile.mockReset(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
function page(id: string, evidenceIds: string[] = [], assetIds: string[] = []) {
  return { findingId: id, topicKey: 'diagnosis', sectionKey: 'conditions', sectionTitle: '建设条件', sectionOrder: 0, order: 0,
    title: id, keyMessage: '明确场地现状与建设条件。', contentNature: 'fact', objectIds: ['BL01'], evidenceIds, assetIds,
    supportingBlocks: [{ type: 'text', role: 'body', content: '场地调研结论。' }], speakerNotes: ['场地调研结论。'] }
}
async function asset(overrides: Partial<PresentationAdoptedAssetInput> = {}): Promise<PresentationAdoptedAssetInput> {
  const root = await mkdtemp(join(tmpdir(), 'pre-material-association-'))
  roots.push(root)
  const sourcePath = join(root, '现场.svg')
  await writeFile(sourcePath, '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="green"/></svg>')
  return { sourceKey: 'site-photo', sourcePath, originalFileName: '现场.svg', displayName: '现状现场', mimeType: 'image/svg+xml', semanticRole: 'evidence',
    widthPx: 800, heightPx: 600, createdAt: '2026-09-03T00:00:00Z', adoptedAt: '2026-09-03T00:00:00Z',
    objectIds: ['BL01'], evidenceIds: ['ev-photo'], origin: { type: 'human_added', sourceMaterialKeys: [], parentAssetKeys: [], method: '现场资料', sourceTool: null }, ...overrides }
}
describe('per-page material associations', () => {
  it('links aliases/evidence explicitly and does not spread the same image over unrelated pages', async () => {
    planner.compile.mockReturnValue([page('photo-page', ['ev-photo']), page('unrelated-page'), page('alias-page', [], ['old-photo'])])
    const image = await asset({ aliases: ['old-photo'], role: 'background', objectIds: ['SP07'] })
    const build = await buildPresentationStandardProject({ frozenProject: createStandardFrozenProject(), assets: [image] })
    const pages = (build.documents['pages/manifest.json'] as any).pages
    const library = (id: string) => (build.documents[pages.find((item: any) => item.pageId === build.stableIds[`page:finding:${id}`]).draftPath] as any).pageAssets
    expect(library('photo-page')).toHaveLength(1)
    expect(library('photo-page')[0].role).toBe('background')
    expect(library('alias-page')).toHaveLength(1)
    expect(library('unrelated-page')).toEqual([])
  })
  it('applies explicit per-page roles and deduplicates two references to the same physical image', async () => {
    planner.compile.mockReturnValue([page('photo-page'), page('unrelated-page')])
    const image = await asset({ sourceKey: 'photo-a', objectIds: [], evidenceIds: [], pageBindings: [{ findingId: 'photo-page', role: 'background' }], role: 'reference' })
    const build = await buildPresentationStandardProject({ frozenProject: createStandardFrozenProject(), assets: [image, { ...image, sourceKey: 'photo-b' }] })
    const records = (build.documents['pages/manifest.json'] as any).pages
    const drafts = records.map((item: any) => build.documents[item.draftPath] as any)
    expect(drafts.flatMap((draft: any) => draft.pageAssets)).toHaveLength(1)
    expect(drafts.flatMap((draft: any) => draft.pageAssets)[0].role).toBe('background')
  })
  it('keeps CAD in the library as a non-image reference without raster dimensions', async () => {
    planner.compile.mockReturnValue([page('cad-page', ['ev-cad'])])
    const image = await asset()
    const cadPath = join(roots[0]!, '总平面.dwg')
    await writeFile(cadPath, 'AC1032CAD-test')
    const cad = { ...image, sourceKey: 'cad', sourcePath: cadPath, originalFileName: '总平面.dwg', mimeType: 'image/vnd.dwg',
      widthPx: undefined, heightPx: undefined, evidenceIds: ['ev-cad'], role: 'reference' as const }
    const build = await buildPresentationStandardProject({ frozenProject: createStandardFrozenProject(), assets: [cad] })
    const manifest = build.documents['assets/manifest.json'] as any
    expect(manifest.assets[0]).toMatchObject({ mediaType: 'other', category: 'other' })
    const pageRecord = (build.documents['pages/manifest.json'] as any).pages[0]
    const draft = build.documents[pageRecord.draftPath] as any
    expect(draft.pageAssets[0].role).toBe('reference')
    expect((await validateDocumentWithAjv('DraftPageDocument', draft)).valid).toBe(true)
  })
})
