import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createStandardFrozenProject } from './presentation-standard-fixture.ts'
import { preparePresentationMaterials } from '../src/presentation/material-registry.ts'
import { buildPresentationStandardProject } from '../src/presentation/standard-project-adapter.ts'
import { publishPresentationStandardProjectIntoWorkspace } from '../src/presentation/workspace-project-writer.ts'
import { adoptedPresentationAssets } from '../src/presentation/runtime-integration.ts'
import type { VisualAssetRecord } from '../src/governance/types.ts'

const roots: string[] = []
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('explicit page visual fill', () => {
  it.each([
    ['empty', Buffer.alloc(0)],
    ['not an image', Buffer.from('not PNG data')],
    ['truncated PNG', PNG_1X1.subarray(0, 24)],
    ['damaged PNG payload', Buffer.from(PNG_1X1.map((byte, index) => index === 45 ? byte ^ 0xff : byte))],
  ] as const)('does not count a registered %s PNG as covered', async (_label, bytes) => {
    const { PageVisualFillService } = await import('../src/presentation/page-visual-fill.ts')
    const root = await mkdtemp(join(tmpdir(), 'pre-page-fill-invalid-image-')); roots.push(root)
    const source = createStandardFrozenProject()
    await mkdir(join(root, '.pre-design'))
    await writeFile(join(root, 'concept.png'), bytes)
    await writeFile(join(root, '.pre-design/materials.json'), JSON.stringify({ version: 1, projectId: source.projectId, materials: [{
      sourceKey: 'concept', sourcePath: 'concept.png', mimeType: 'image/png', importedAt: source.generatedAt,
      metadata: { widthPx: 1, heightPx: 1 }, pageBindings: [{ findingId: 'pre-design:project-brief', role: 'primary' }],
      provenance: { kind: 'ai_concept', tool: { name: 'test-image-tool', version: '1' }, model: 'test-model', prompt: '实际概念图提示词' },
    }] }))
    const service = new PageVisualFillService({} as never)
    const plan = await service.plan({ frozenProject: source, workspaceRoot: root })
    expect(plan.pages.find(page => page.findingId === 'pre-design:project-brief')).toMatchObject({ covered: false, imageCount: 0 })
    expect(plan.warnings.join('\n')).toContain('PAGE_VISUAL_IMAGE_UNAVAILABLE')
    expect(await readFile(join(root, 'concept.png'))).toEqual(bytes)
    await expect(readFile(join(root, '.pre-design/page-visual-fill.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('counts a structurally valid PNG but rejects falsely declared dimensions without changing its bytes', async () => {
    const { PageVisualFillService } = await import('../src/presentation/page-visual-fill.ts')
    const root = await mkdtemp(join(tmpdir(), 'pre-page-fill-valid-image-')); roots.push(root)
    const source = createStandardFrozenProject()
    await mkdir(join(root, '.pre-design'))
    await writeFile(join(root, 'image.png'), PNG_1X1)
    const service = new PageVisualFillService({} as never)
    for (const widthPx of [1, 2]) {
      await writeFile(join(root, '.pre-design/materials.json'), JSON.stringify({ version: 1, projectId: source.projectId, materials: [{
        sourceKey: 'image', sourcePath: 'image.png', mimeType: 'image/png', importedAt: source.generatedAt,
        metadata: { widthPx, heightPx: 1 }, pageBindings: [{ findingId: 'pre-design:project-brief', role: 'primary' }],
      }] }))
      const plan = await service.plan({ frozenProject: source, workspaceRoot: root })
      expect(plan.pages.find(page => page.findingId === 'pre-design:project-brief')).toMatchObject({ covered: widthPx === 1, imageCount: widthPx === 1 ? 1 : 0 })
      expect(plan.warnings.length).toBe(widthPx === 1 ? 0 : 1)
    }
    expect(await readFile(join(root, 'image.png'))).toEqual(PNG_1X1)
  })
  it.each(['candidate', 'adopted', 'generating', 'adopted-stale-candidate'] as const)('does not charge again or downgrade persisted %s with another process stale governance snapshot', async status => {
    const { PageVisualFillService } = await import('../src/presentation/page-visual-fill.ts')
    const root = await mkdtemp(join(tmpdir(), 'pre-page-fill-stale-')); roots.push(root)
    const source = createStandardFrozenProject()
    const records: VisualAssetRecord[] = []
    const staleRecords: VisualAssetRecord[] = []
    let calls = 0
    const visual = {
      generate: async (_parent: unknown, task: { taskId: string }) => {
        calls += 1
        const bytes = Buffer.from('candidate image bytes')
        const asset: VisualAssetRecord = { assetId: `candidate-${calls}`, taskId: task.taskId, projectId: source.projectId,
          kind: 'concept', required: false, status: 'candidate', mimeType: 'image/png', fileName: `candidate-${calls}.png`,
          sha256: createHash('sha256').update(bytes).digest('hex'), width: 1600, height: 900,
          createdAt: source.generatedAt, quality: { accepted: true, score: 1, issues: [] } }
        await writeFile(join(root, asset.fileName), bytes)
        records.push(asset)
        return asset
      },
      adopt: async (_projectId: string, assetId: string, revision: number) => {
        const index = records.findIndex(asset => asset.assetId === assetId)
        records[index] = { ...records[index]!, status: 'adopted', adoptedRevision: revision }
        return records[index]!
      },
    }
    const dependencies = { visual, resolveAsset: (fileName: string) => join(root, fileName) }
    const writer = new PageVisualFillService({ ...dependencies, governance: { readProject: () => ({ visualAssets: records }) } } as never)
    const staleReader = new PageVisualFillService({ ...dependencies, governance: { readProject: () => ({ visualAssets: staleRecords }) } } as never)
    const input = { frozenProject: source, workspaceRoot: root, findingId: 'pre-design:project-brief', prompt: '陆侧安全公共空间' }
    const generated = await writer.generate({} as never, input)
    if (status === 'adopted-stale-candidate') staleRecords.push({ ...records[0]! })
    if (status === 'adopted' || status === 'adopted-stale-candidate') await writer.adopt({ ...input, assetId: generated.assetId })
    const statePath = join(root, '.pre-design/page-visual-fill.json')
    if (status === 'generating') {
      const state = JSON.parse(await readFile(statePath, 'utf8'))
      state.requests[0].status = 'generating'
      delete state.requests[0].assetId
      await writeFile(statePath, JSON.stringify(state))
    }
    const before = await readFile(statePath, 'utf8')
    await expect(staleReader.generate({} as never, input)).rejects.toThrow('PAGE_VISUAL_RECOVERY_REQUIRED')
    expect(calls).toBe(1)
    expect(await readFile(statePath, 'utf8')).toBe(before)
  })
  it('reuses in-flight, persisted candidate and adopted requests while changed content gets a new identity', async () => {
    const { PageVisualFillService } = await import('../src/presentation/page-visual-fill.ts')
    const root = await mkdtemp(join(tmpdir(), 'pre-page-fill-')); roots.push(root)
    const source = createStandardFrozenProject()
    const records: VisualAssetRecord[] = []
    let requests = 0
    const dependencies = {
      governance: { readProject: () => ({ visualAssets: records }) },
      visual: {
        generate: async (_parent: unknown, task: { taskId: string }) => {
          requests += 1
          const asset: VisualAssetRecord = { assetId: `candidate-${requests}`, taskId: task.taskId, projectId: source.projectId,
            kind: 'concept', required: true, status: 'candidate', mimeType: 'image/png', fileName: 'candidate.png', sha256: createHash('sha256').update('candidate image bytes').digest('hex'),
            width: 1600, height: 900, createdAt: source.generatedAt, quality: { accepted: true, score: 1, issues: [] } }
          await writeFile(join(root, asset.fileName), 'candidate image bytes')
          records.push(asset)
          return asset
        },
        adopt: async (_projectId: string, assetId: string, revision: number) => {
          const i = records.findIndex(asset => asset.assetId === assetId)
          records[i] = { ...records[i]!, status: 'adopted', adoptedRevision: revision }
          return records[i]!
        },
      },
      resolveAsset: (fileName: string) => join(root, fileName),
    }
    const service = new PageVisualFillService(dependencies as never)
    const input = { frozenProject: source, workspaceRoot: root, findingId: 'pre-design:project-brief', prompt: '陆侧公共空间的概念示意', style: '克制、自然材料、无文字' }
    const [first, duplicate] = await Promise.all([service.generate({} as never, input), service.generate({} as never, input)])
    expect(first.assetId).toBe(duplicate.assetId)
    expect(requests).toBe(1)
    const restored = new PageVisualFillService(dependencies as never)
    expect(await restored.generate({} as never, input)).toMatchObject({ assetId: first.assetId, reused: true, status: 'candidate' })
    await expect(restored.adopt({ ...input, assetId: 'another-page-candidate' })).rejects.toThrow('PAGE_VISUAL_CANDIDATE_MISMATCH')
    const changedSource = { ...source, stateObjects: source.stateObjects.map(object => object.objectId === 'PS01'
      ? { ...object, facts: [{ label: '新增服务范围', value: '增加调蓄设施并核对征地范围', basis: '修订后的任务书' }] } : object) }
    await expect(restored.adopt({ ...input, frozenProject: changedSource, assetId: first.assetId })).rejects.toThrow('PAGE_VISUAL_BRIEF_CHANGED')
    expect(records[0]?.status).toBe('candidate')
    expect(await restored.adopt({ ...input, assetId: first.assetId })).toMatchObject({ status: 'adopted', assetId: first.assetId })
    expect(await restored.generate({} as never, input)).toMatchObject({ assetId: first.assetId, reused: true, status: 'adopted' })
    expect(requests).toBe(1)
    const adoptedInput = { sourceKey: first.assetId, sourcePath: join(root, 'candidate.png'), originalFileName: 'candidate.png',
      displayName: '概念候选', mimeType: 'image/png', semanticRole: 'concept_visual', widthPx: 1600, heightPx: 900,
      createdAt: source.generatedAt, adoptedAt: source.generatedAt, objectIds: ['PS01'], evidenceIds: [],
      origin: { type: 'generated_by_plugin' as const, sourceMaterialKeys: [], parentAssetKeys: [], method: 'generated by pre-design', sourceTool: { name: 'pre-design', version: '2.0.0' } } }
    const prepared = await preparePresentationMaterials({ frozenProject: source, workspaceRoot: root, assets: [adoptedInput] })
    expect(prepared.assets[0]?.pageBindingOnly).toBe(true)
    const build = await buildPresentationStandardProject({ frozenProject: source, ...prepared })
    await mkdir(join(root, 'layouts'))
    await writeFile(join(root, 'layouts/manual.json'), '{"manualFrame":"keep"}')
    const published = await publishPresentationStandardProjectIntoWorkspace({ directoryRoot: root, build, operationId: 'adopted-page-first' })
    const repeated = await preparePresentationMaterials({ frozenProject: source, workspaceRoot: root, assets: [adoptedInput],
      previous: { stableIds: build.stableIds, lastExportedFileHashes: published.fileHashes } })
    const rebuilt = await buildPresentationStandardProject({ frozenProject: source, ...repeated, stableIds: build.stableIds })
    const pages = (build.documents['pages/manifest.json'] as any).pages
    expect(pages.filter((page: any) => (rebuilt.documents[page.draftPath] as any).pageAssets.length > 0).map((page: any) => page.pageId))
      .toEqual([build.stableIds['page:finding:pre-design:project-brief']])
    for (const page of pages) expect((rebuilt.documents[page.draftPath] as any).pageAssets).toEqual((build.documents[page.draftPath] as any).pageAssets)
    const republished = await publishPresentationStandardProjectIntoWorkspace({ directoryRoot: root, build: rebuilt, operationId: 'adopted-page-second', expectedExistingFileHashes: published.fileHashes })
    expect(republished.validation.valid).toBe(true)
    expect(await readFile(join(root, 'layouts/manual.json'), 'utf8')).toBe('{"manualFrame":"keep"}')
    expect((rebuilt.documents['assets/manifest.json'] as any).assets[0].origin.type).toBe('generated_by_plugin')
    const changed = await restored.generate({} as never, { ...input, prompt: '公共空间的人视概念图' })
    expect(changed.taskId).not.toBe(first.taskId)
    expect(requests).toBe(2)
    const changedContent = await restored.generate({} as never, { ...input, frozenProject: changedSource })
    expect(changedContent.taskId).not.toBe(first.taskId)
    expect(requests).toBe(3)
    const state = JSON.parse(await readFile(join(root, '.pre-design/page-visual-fill.json'), 'utf8'))
    expect(state.requests.map((request: { findingId: string }) => request.findingId)).toEqual([input.findingId, input.findingId, input.findingId])
  })

  it('restores exact page bindings after the sidecar disappears despite fresh broad adopted inputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pre-page-fill-recovery-')); roots.push(root)
    const source = createStandardFrozenProject()
    const liveSource = { ...source, adoptedAssetIds: ['adopted-concept'], visualAssets: [{
      assetId: 'adopted-concept', kind: 'concept' as const, workItemId: source.stateObjects.find(object => object.objectId === 'PS01')!.workItemId,
      caption: '已采用概念图', sourcePath: join(root, 'candidate.png'), mimeType: 'image/png' as const, width: 1, height: 1,
    }] }
    await mkdir(join(root, '.pre-design'))
    await mkdir(join(root, 'layouts'))
    await writeFile(join(root, 'layouts/manual.json'), '{"manualFrame":"keep"}')
    await writeFile(join(root, 'candidate.png'), PNG_1X1)
    const sidecarPath = join(root, '.pre-design/page-visual-fill.json')
    await writeFile(sidecarPath, JSON.stringify({ version: 1, projectId: source.projectId, requests: [{
      taskId: `page-fill-${'a'.repeat(64)}`, briefHash: 'a'.repeat(64), findingId: 'pre-design:project-brief',
      prompt: '陆侧安全公共空间', style: '低饱和', status: 'adopted', assetId: 'adopted-concept',
    }] }))
    const rawAssets = adoptedPresentationAssets(liveSource)
    expect(rawAssets[0]?.pageBindingOnly).toBeUndefined()
    const prepared = await preparePresentationMaterials({ frozenProject: liveSource, workspaceRoot: root, assets: rawAssets })
    const build = await buildPresentationStandardProject({ frozenProject: liveSource, ...prepared })
    const published = await publishPresentationStandardProjectIntoWorkspace({ directoryRoot: root, build, operationId: 'before-sidecar-recovery' })
    await unlink(sidecarPath)
    const recovered = await preparePresentationMaterials({ frozenProject: liveSource, workspaceRoot: root, assets: adoptedPresentationAssets(liveSource),
      previous: { stableIds: build.stableIds, lastExportedFileHashes: published.fileHashes } })
    expect(recovered.assets[0]?.pageBindingOnly).toBe(true)
    expect(recovered.assets[0]?.origin).toMatchObject(prepared.assets[0]!.origin)
    const recoveredBuild = await buildPresentationStandardProject({ frozenProject: liveSource, ...recovered, stableIds: build.stableIds })
    const pages = (build.documents['pages/manifest.json'] as any).pages
    for (const page of pages) expect((recoveredBuild.documents[page.draftPath] as any).pageAssets).toEqual((build.documents[page.draftPath] as any).pageAssets)
    expect(pages.filter((page: any) => (recoveredBuild.documents[page.draftPath] as any).pageAssets.length > 0).map((page: any) => page.pageId))
      .toEqual([build.stableIds['page:finding:pre-design:project-brief']])
    await publishPresentationStandardProjectIntoWorkspace({ directoryRoot: root, build: recoveredBuild, operationId: 'after-sidecar-recovery', expectedExistingFileHashes: published.fileHashes })
    expect(await readFile(join(root, 'layouts/manual.json'), 'utf8')).toBe('{"manualFrame":"keep"}')
    await expect(readFile(sidecarPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects unknown pages and cancellation before creating state or calling a model', async () => {
    const { PageVisualFillService } = await import('../src/presentation/page-visual-fill.ts')
    const root = await mkdtemp(join(tmpdir(), 'pre-page-fill-')); roots.push(root)
    const service = new PageVisualFillService({ visual: { generate: () => { throw new Error('MODEL_MUST_NOT_RUN') } } } as never)
    const input = { frozenProject: createStandardFrozenProject(), workspaceRoot: root, findingId: 'not-a-page', prompt: '概念', style: '自然' }
    await expect(service.generate({} as never, input)).rejects.toThrow('PAGE_VISUAL_FINDING_NOT_FOUND')
    await expect(service.generate({} as never, { ...input, findingId: 'pre-design:project-brief', signal: AbortSignal.abort(new Error('cancelled')) })).rejects.toThrow('cancelled')
    await expect(readFile(join(root, '.pre-design/page-visual-fill.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('records a failed generation without adoption or false coverage and blocks a second process lock', async () => {
    const { PageVisualFillService } = await import('../src/presentation/page-visual-fill.ts')
    const root = await mkdtemp(join(tmpdir(), 'pre-page-fill-')); roots.push(root)
    let calls = 0
    const service = new PageVisualFillService({ governance: { readProject: () => ({ visualAssets: [] }) },
      visual: { generate: async () => { calls += 1; throw new Error('fixed model unavailable') } } } as never)
    const input = { frozenProject: createStandardFrozenProject(), workspaceRoot: root, findingId: 'pre-design:project-brief', prompt: '安全陆侧公共空间', style: '低饱和' }
    await expect(service.generate({} as never, input)).rejects.toThrow('fixed model unavailable')
    const state = JSON.parse(await readFile(join(root, '.pre-design/page-visual-fill.json'), 'utf8'))
    expect(state.requests[0]).toMatchObject({ status: 'failed', message: 'fixed model unavailable' })
    const plan = await service.plan(input)
    expect(plan.pages.find(page => page.findingId === input.findingId)).toMatchObject({ covered: false, requestStatus: 'failed' })
    expect(plan.warnings.join()).toContain('fixed model unavailable')
    await writeFile(join(root, '.pre-design/page-visual-fill.lock'), '')
    await expect(service.generate({} as never, input)).rejects.toThrow('PAGE_VISUAL_BUSY')
    expect(calls).toBe(1)
  })
  it('does not count CAD or reference images as covered', async () => {
    const { PageVisualFillService } = await import('../src/presentation/page-visual-fill.ts')
    const root = await mkdtemp(join(tmpdir(), 'pre-page-fill-')); roots.push(root)
    await mkdir(join(root, '.pre-design'))
    await writeFile(join(root, 'plan.dwg'), 'AC1032')
    const source = createStandardFrozenProject()
    await writeFile(join(root, '.pre-design/materials.json'), JSON.stringify({ version: 1, projectId: source.projectId, materials: [{
      sourceKey: 'cad', sourcePath: 'plan.dwg', mimeType: 'image/vnd.dwg', importedAt: source.generatedAt,
      pageBindings: [{ findingId: 'pre-design:project-brief', role: 'primary' }],
    }] }))
    const service = new PageVisualFillService({ governance: { readProject: () => ({ visualAssets: [] }) },
      visual: { generate: () => { throw new Error('MODEL_MUST_NOT_RUN') } } } as never)
    const result = await service.plan({ frozenProject: source, workspaceRoot: root })
    expect(result.pages.find(page => page.findingId === 'pre-design:project-brief')).toMatchObject({ covered: false, imageCount: 0 })
    expect((await preparePresentationMaterials({ frozenProject: source, workspaceRoot: root })).assets).toHaveLength(1)
    await writeFile(join(root, 'reference.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"/>')
    await writeFile(join(root, '.pre-design/materials.json'), JSON.stringify({ version: 1, projectId: source.projectId, materials: [{
      sourceKey: 'reference', sourcePath: 'reference.svg', mimeType: 'image/svg+xml', importedAt: source.generatedAt,
      metadata: { widthPx: 800, heightPx: 600 }, pageBindings: [{ findingId: 'pre-design:project-brief', role: 'reference' }],
    }] }))
    expect((await service.plan({ frozenProject: source, workspaceRoot: root })).pages.find(page => page.findingId === 'pre-design:project-brief')?.covered).toBe(false)
    await writeFile(join(root, '.pre-design/materials.json'), JSON.stringify({ version: 1, projectId: source.projectId, materials: [{
      sourceKey: 'reference', sourcePath: 'reference.svg', mimeType: 'image/svg+xml', importedAt: source.generatedAt,
      metadata: { widthPx: 800, heightPx: 600 }, pageBindings: [{ findingId: 'pre-design:project-brief', role: 'primary' }],
    }] }))
    expect((await service.plan({ frozenProject: source, workspaceRoot: root })).pages.find(page => page.findingId === 'pre-design:project-brief'))
      .toMatchObject({ covered: true, imageCount: 1 })
    await expect(service.generate({} as never, { frozenProject: source, workspaceRoot: root, findingId: 'pre-design:project-brief', prompt: '不替换已有图' }))
      .rejects.toThrow('PAGE_VISUAL_ALREADY_COVERED')
    await expect(readFile(join(root, '.pre-design/page-visual-fill.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
