import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { ReportImagePipeline, type ReportImageDemand } from '../src/presentation/report-image-pipeline.ts'
import { imageBriefHash } from '../src/visual/image-policy.ts'
import { imageSourceContextHash } from '../src/visual/image-inspection.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'
import { png, resize, scene } from './support/image-identity/fixtures.ts'

const input = { projectId: 'local-fill', projectName: '林间公园', revision: 1,
  generatedAt: '2026-09-21', recommendation: '林下休憩', decisionItems: [], gates: [], visualAssets: [], stateObjects: [] } as FrozenProjectInput
const classes = { settings: () => ({ routes: { image: { provider: 'Comfyui-PIC', model: 'Klein', llm: { provider: 'fixture', model: 'llm' } },
  review: { provider: 'fixture', model: 'vision' } } }), execution: () => ({ classId: 'review', status: 'completed', actual: { provider: 'fixture', model: 'vision' } }) } as never
const demand = (id: string): ReportImageDemand => ({ findingId: id, brief: { id: `${id}:main`, pageId: id, version: 'fixture',
  conclusion: '林下休息', subjects: ['林下座椅'], activities: [], environment: '公园', scale: 'scene',
  allowedKinds: ['render'], allowedSources: ['web', 'generated'], locale: 'domestic' } })

it.each([true, false])('reviews local generation first; only rejected images require a web search (approved=%s)', async approved => {
  const root = await mkdtemp(join(tmpdir(), 'local-fill-')), order: string[] = [], target = demand('a-scene'), other = demand('z-source')
  try {
    const sourcePath = join(root, 'scene.png'), bytes = png(resize(scene(49), 1600, 1000))
    await writeFile(sourcePath, bytes)
    const adopt = vi.fn(async () => {})
    const inspect = vi.fn(async (_parent: unknown, request: any) => {
      order.push('review')
      return request.slots.map((slot: any) => ({ schemaVersion: 'pre-design.image-inspection.v1',
        imageSha256: createHash('sha256').update(request.bytes).digest('hex'), requirementHash: imageBriefHash(slot.brief),
        usageId: slot.brief.id, placementHash: slot.placementHash, inspectedAt: 'fixture', actualImageInput: true,
        actualModel: { provider: 'fixture', model: 'vision' }, executionId: 'fixture-run', contentKind: 'render', relevant: approved,
        matchedSubjects: approved ? slot.brief.subjects : [], mismatches: approved ? [] : ['missing-subject'], domesticContext: 'supported',
        textLanguages: [], textLegible: true, watermark: 'none', quality: 'pass', essentialBounds: [{ x: 0, y: 0, width: 1, height: 1 }],
        decision: approved ? 'approved' : 'rejected', sourceContextHash: imageSourceContextHash(request) }))
    })
    const search = vi.fn(async (d: ReportImageDemand) => { order.push(`search:${d.brief.id}`); return [] })
    const generate = vi.fn(async () => { order.push('generate'); return { adopt, material: {
      sourceKey: 'local-image', sourcePath, originalFileName: 'scene.png', displayName: '林下座椅', mimeType: 'image/png',
      semanticRole: 'concept_visual' as const, createdAt: 'fixture', adoptedAt: 'fixture', objectIds: [], evidenceIds: [],
      origin: { type: 'generated_by_plugin' as const, parentAssetKeys: [], sourceMaterialKeys: [], sourceTool: null, method: '{}' },
    } } })
    const pipeline = new ReportImagePipeline({ classes, candidates: async () => [], inspection: { inspect } as never,
      resolveDemands: async () => [target, { ...other, sourceMaterialKey: 'verified-source', brief: { ...other.brief, allowedSources: ['project'] } }],
      generate, search })
    await expect(pipeline.prepare(input, root, {} as never, AbortSignal.timeout(10000), () => {})).rejects.toThrow('REPORT_IMAGE_GAPS')
    expect(order.slice(0, 2)).toEqual(['generate', 'review'])
    expect(generate).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledTimes(approved ? 0 : 1)
    expect(adopt).toHaveBeenCalledTimes(approved ? 1 : 0)
    const gaps = JSON.parse(await readFile(join(root, '.pre-design/report-image-gaps.json'), 'utf8')).gaps
    expect(gaps.map((gap: any) => gap.id).sort()).toEqual(approved ? ['z-source:main'] : ['a-scene:main', 'z-source:main'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('continues local failures in waves of five, keeps case sources factual, and respects reuse-only mode', async () => {
  for (const maxGenerations of [Infinity, 0]) {
    const root = await mkdtemp(join(tmpdir(), 'local-fill-fallback-')), order: string[] = []
    let active = 0, peak = 0
    try {
      const scenes = Array.from({ length: 6 }, (_, i) => demand(`scene-${i}`))
      const caseDemand = { ...demand('case'), caseSource: { caseId: 'case', name: '真实公园', location: '中国', mediaPurpose: '全景' } }
      const generate = vi.fn(async (d: ReportImageDemand) => {
        order.push(`generate:${d.brief.id}`); peak = Math.max(peak, ++active)
        try { await new Promise(resolve => setTimeout(resolve, 10)); throw new Error('local-device-unavailable') } finally { active-- }
      })
      const search = vi.fn(async (d: ReportImageDemand) => { expect(active).toBe(0); order.push(`search:${d.brief.id}`); return [] })
      const pipeline = new ReportImagePipeline({ classes, candidates: async () => [], inspection: {} as never,
        resolveDemands: async () => [...scenes, caseDemand], generate, search })
      await expect(pipeline.prepare(input, root, {} as never, AbortSignal.timeout(5000), () => {}, { maxGenerations })).rejects.toThrow('REPORT_IMAGE_GAPS')
      expect(generate).toHaveBeenCalledTimes(maxGenerations === 0 ? 0 : 6)
      expect(search).toHaveBeenCalledTimes(7)
      expect(peak).toBeLessThanOrEqual(5)
      expect(generate.mock.calls.some(([d]) => d.caseSource)).toBe(false)
      if (maxGenerations !== 0) expect(order[0]).toMatch(/^generate:/u)
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

it.each([true, false])('defers speculative old-image matching and case retrieval until local scenes are attempted (approved=%s)', async approved => {
  const root = await mkdtemp(join(tmpdir(), 'local-priority-old-pool-')), order: string[] = []
  try {
    const oldPath = join(root, 'old.png'), newPath = join(root, 'new.png')
    await writeFile(oldPath, png(resize(scene(17), 1600, 1000)))
    await writeFile(newPath, png(resize(scene(48), 1600, 1000)))
    const material = (sourceKey: string, sourcePath: string) => ({ sourceKey, sourcePath, originalFileName: `${sourceKey}.png`,
      displayName: '林下座椅', mimeType: 'image/png', semanticRole: 'concept_visual' as const, createdAt: 'fixture', adoptedAt: 'fixture',
      objectIds: [], evidenceIds: [], origin: { type: 'generated_by_plugin' as const, parentAssetKeys: [], sourceMaterialKeys: [],
        sourceTool: null, method: JSON.stringify({ kind: 'ai-concept', sourceKey }) } })
    const target = demand('z-scene'), factual = { ...demand('a-case'), sourceMaterialKey: 'case-original',
      caseSource: { caseId: 'real', name: '真实公园', location: '中国', mediaPurpose: '整体' } }
    const inspect = vi.fn(async (_parent: unknown, request: any) => {
      const isOld = JSON.parse(request.sourceContext).sourceKey === 'old'
      order.push(isOld ? 'review-old' : 'review-new')
      const accepted = isOld || approved
      return request.slots.map((slot: any) => ({ schemaVersion: 'pre-design.image-inspection.v1',
        imageSha256: createHash('sha256').update(request.bytes).digest('hex'), requirementHash: imageBriefHash(slot.brief),
        usageId: slot.brief.id, placementHash: slot.placementHash, inspectedAt: 'fixture', actualImageInput: true,
        actualModel: { provider: 'fixture', model: 'vision' }, executionId: 'fixture-run', contentKind: 'render', relevant: accepted,
        matchedSubjects: accepted ? slot.brief.subjects : [], mismatches: accepted ? [] : ['missing-subject'], domesticContext: 'supported',
        textLanguages: [], textLegible: true, watermark: 'none', quality: 'pass', essentialBounds: [{ x: 0, y: 0, width: 1, height: 1 }],
        decision: accepted ? 'approved' : 'rejected', sourceContextHash: imageSourceContextHash(request) }))
    })
    const pipeline = new ReportImagePipeline({ classes, candidates: async () => [material('old', oldPath)], inspection: { inspect } as never,
      resolveDemands: async () => [factual, target], search: async d => { order.push(`search:${d.brief.id}`); return [] },
      generate: async d => { expect(d.caseSource).toBeUndefined(); order.push('generate'); return { material: material('new', newPath), adopt: async () => {} } } })
    await expect(pipeline.prepare(input, root, {} as never, AbortSignal.timeout(10000), () => {})).rejects.toThrow('REPORT_IMAGE_GAPS')
    expect(order.slice(0, 2)).toEqual(['generate', 'review-new'])
    expect(order.indexOf('search:a-case:main')).toBeGreaterThan(1)
    if (approved) expect(order).not.toContain('review-old')
    else expect(order.indexOf('review-old')).toBeGreaterThan(order.indexOf('search:a-case:main'))
    const gaps = JSON.parse(await readFile(join(root, '.pre-design/report-image-gaps.json'), 'utf8')).gaps
    expect(gaps.map((gap: any) => gap.id)).toEqual(['a-case:main'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('adopts generated images first assigned to another usage during the final broad matching pass', async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-cross-adoption-')), adopted: string[] = []
  try {
    const targets = [demand('a'), demand('b')], files: string[] = []
    for (const seed of [23, 67]) {
      const path = join(root, `${seed}.png`); await writeFile(path, png(resize(scene(seed), 1600, 1000))); files.push(path)
    }
    const inspect = async (_parent: unknown, request: any) => request.slots.map((slot: any) => {
      const accepted = JSON.parse(request.sourceContext).target !== slot.brief.id
      return { schemaVersion: 'pre-design.image-inspection.v1', imageSha256: createHash('sha256').update(request.bytes).digest('hex'),
        requirementHash: imageBriefHash(slot.brief), usageId: slot.brief.id, placementHash: slot.placementHash, inspectedAt: 'fixture',
        actualImageInput: true, actualModel: { provider: 'fixture', model: 'vision' }, executionId: 'fixture-run', contentKind: 'render',
        relevant: accepted, matchedSubjects: accepted ? slot.brief.subjects : [], mismatches: accepted ? [] : ['target-mismatch'],
        domesticContext: 'supported', textLanguages: [], textLegible: true, watermark: 'none', quality: 'pass',
        essentialBounds: [{ x: 0, y: 0, width: 1, height: 1 }], decision: accepted ? 'approved' : 'rejected',
        sourceContextHash: imageSourceContextHash(request) }
    })
    const pipeline = new ReportImagePipeline({ classes, candidates: async () => [], inspection: { inspect } as never,
      resolveDemands: async () => [...targets, { ...demand('source'), sourceMaterialKey: 'original', brief: { ...demand('source').brief, allowedSources: ['project'] } }],
      generate: async d => ({ adopt: async () => { adopted.push(d.brief.id) }, material: {
        sourceKey: d.brief.id, sourcePath: files[targets.indexOf(d)]!, originalFileName: 'scene.png', displayName: '林下座椅', mimeType: 'image/png',
        semanticRole: 'concept_visual', createdAt: 'fixture', adoptedAt: 'fixture', objectIds: [], evidenceIds: [],
        origin: { type: 'generated_by_plugin', parentAssetKeys: [], sourceMaterialKeys: [], sourceTool: null, method: JSON.stringify({ target: d.brief.id }) },
      } }) })
    await expect(pipeline.prepare(input, root, {} as never, AbortSignal.timeout(10000), () => {})).rejects.toThrow('REPORT_IMAGE_GAPS')
    expect(adopted.sort()).toEqual(['a:main', 'b:main'])
    const gaps = JSON.parse(await readFile(join(root, '.pre-design/report-image-gaps.json'), 'utf8')).gaps
    expect(gaps.map((gap: any) => gap.id)).toEqual(['source:main'])
  } finally { await rm(root, { recursive: true, force: true }) }
})
