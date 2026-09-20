import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { ReportImagePipeline, type ReportImageDemand } from '../src/presentation/report-image-pipeline.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'
import { png, resize, scene } from './support/image-identity/fixtures.ts'
import { imageBriefHash } from '../src/visual/image-policy.ts'
import { imageSourceContextHash } from '../src/visual/image-inspection.ts'

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const input: FrozenProjectInput = { projectId: 'parallel-acquisition', projectName: '滨水公园', revision: 1,
  generatedAt: '2026-09-20', recommendation: '慢行与休憩', decisionItems: [], gates: [], visualAssets: [], stateObjects: [] }
const demands = (count: number): ReportImageDemand[] => Array.from({ length: count }, (_, i) => ({ findingId: `finding-${i}`,
  brief: { id: `scene-${i}:main`, pageId: `scene-${i}`, version: 'parallel-fixture', conclusion: '滨水活动', subjects: [`场景${i}`],
    activities: [], environment: '河岸', scale: 'scene', allowedKinds: ['render'], allowedSources: ['web', 'generated'], locale: 'domestic' } }))
const classes = { settings: () => ({ routes: { review: { provider: 'fixture', model: 'vision' } } }) } as never

it('reviews and adopts successful siblings before propagating a generation failure, and records the remaining gaps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'partial-image-wave-')), adopt = vi.fn(async () => {})
  try {
    const sourcePath = join(root, 'success.png')
    await writeFile(sourcePath, png(resize(scene(47), 1600, 1000)))
    const inspect = vi.fn(async (_parent: unknown, request: any) => request.slots.map((slot: any) => ({
      schemaVersion: 'pre-design.image-inspection.v1', imageSha256: createHash('sha256').update(request.bytes).digest('hex'),
      requirementHash: imageBriefHash(slot.brief), usageId: slot.brief.id, placementHash: slot.placementHash,
      inspectedAt: 'fixture', actualImageInput: true, actualModel: { provider: 'fixture', model: 'vision' }, executionId: 'fixture-run',
      contentKind: 'render', relevant: slot.brief.id === 'scene-1:main', matchedSubjects: slot.brief.subjects,
      mismatches: [], domesticContext: 'supported', textLanguages: [], textLegible: true, watermark: 'none', quality: 'pass',
      essentialBounds: [{ x: 0, y: 0, width: 1, height: 1 }], decision: slot.brief.id === 'scene-1:main' ? 'approved' : 'rejected',
      sourceContextHash: imageSourceContextHash(request),
    })))
    const pipeline = new ReportImagePipeline({ classes, inspection: { inspect } as never, candidates: async () => [],
      resolveDemands: async () => demands(3), generate: async demand => {
        if (demand.brief.id !== 'scene-1:main') throw new Error('provider-unavailable')
        return { adopt, material: { sourceKey: 'success', sourcePath, originalFileName: 'success.png', displayName: '场景1',
          mimeType: 'image/png', widthPx: 1600, heightPx: 1000, semanticRole: 'concept_visual', createdAt: 'fixture', adoptedAt: 'fixture',
          objectIds: [], evidenceIds: [], origin: { type: 'generated_by_plugin', parentAssetKeys: [], sourceMaterialKeys: [], sourceTool: null, method: '{}' } } }
      } })
    await expect(pipeline.prepare(input, root, {} as never, AbortSignal.timeout(10_000), () => {})).rejects.toThrow('provider-unavailable')
    expect(adopt).toHaveBeenCalledOnce()
    expect((await readdir(join(root, '.pre-design', 'image-inspections'))).length).toBeGreaterThan(0)
    const receipt = JSON.parse(await readFile(join(root, '.pre-design', 'report-image-gaps.json'), 'utf8'))
    expect(receipt.gaps.map((gap: any) => gap.id).sort()).toEqual(['scene-0:main', 'scene-2:main'])
    expect(receipt.error).toBe('provider-unavailable')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('searches independent gaps in waves of five and visits each gap only once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'parallel-image-search-'))
  let active = 0, peak = 0
  const visited: string[] = []
  try {
    const search = vi.fn(async (demand: ReportImageDemand) => {
      visited.push(demand.brief.id); peak = Math.max(peak, ++active)
      await pause(20); active--; return []
    })
    const pipeline = new ReportImagePipeline({ classes, inspection: {} as never, candidates: async () => [],
      resolveDemands: async () => demands(12), search })
    await expect(pipeline.prepare(input, root, {} as never, AbortSignal.timeout(5000), () => {}, { maxGenerations: 0 }))
      .rejects.toThrow('REPORT_IMAGE_GAPS: 12 ')
    expect(peak).toBe(5); expect(active).toBe(0)
    expect(search).toHaveBeenCalledTimes(12); expect(new Set(visited).size).toBe(12)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it.each(['search', 'generation'] as const)('drains every started %s in a failed wave without dispatching the next wave', async mode => {
  const root = await mkdtemp(join(tmpdir(), 'parallel-image-failure-'))
  let active = 0, peak = 0, settled = 0
  const visited: string[] = [], searched = new Set<string>()
  try {
    const fail = async (demand: ReportImageDemand) => {
      if (mode === 'generation') expect(searched.has(demand.brief.id)).toBe(true)
      visited.push(demand.brief.id); peak = Math.max(peak, ++active)
      try { await pause(demand.brief.id === 'scene-0:main' ? 1 : 25); throw new Error(`failed:${demand.brief.id}`) }
      finally { active--; settled++ }
    }
    const pipeline = new ReportImagePipeline({ classes, inspection: {} as never, candidates: async () => [], resolveDemands: async () => demands(8),
      search: mode === 'search' ? fail : async demand => { searched.add(demand.brief.id); return [] },
      ...(mode === 'generation' ? { generate: fail } : {}) })
    await expect(pipeline.prepare(input, root, {} as never, AbortSignal.timeout(5000), () => {})).rejects.toThrow('failed:scene-0:main')
    expect(peak).toBe(5); expect(active).toBe(0); expect(settled).toBe(5)
    expect(visited).toEqual(demands(5).map(demand => demand.brief.id))
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('reserves the finite generation allowance before launching a wave', async () => {
  const root = await mkdtemp(join(tmpdir(), 'parallel-image-limit-'))
  let active = 0, peak = 0
  const generate = vi.fn(async () => {
    peak = Math.max(peak, ++active)
    try { await pause(20); throw new Error('generation-result-unavailable') } finally { active-- }
  })
  try {
    const pipeline = new ReportImagePipeline({ classes, inspection: {} as never, candidates: async () => [],
      resolveDemands: async () => demands(8), search: async () => [], generate })
    await expect(pipeline.prepare(input, root, {} as never, AbortSignal.timeout(5000), () => {}, { maxGenerations: 3 }))
      .rejects.toThrow('generation-result-unavailable')
    expect(generate).toHaveBeenCalledTimes(3); expect(peak).toBe(3); expect(active).toBe(0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('retains every retrieval target when a wave returns the same original under different labels', async () => {
  const root = await mkdtemp(join(tmpdir(), 'parallel-image-shared-source-'))
  const requested = demands(13).map((demand, index) => ({ ...demand, brief: { ...demand.brief,
    subjects: [index === 0 ? '独立入口' : index === 1 ? '临水平台' : '林下空间'] } }))
  const reviewed: string[] = []
  try {
    const bytes = png(resize(scene(47), 1600, 1000)), sourcePath = join(root, 'original.png')
    await writeFile(sourcePath, bytes)
    const inspect = vi.fn(async (_parent: unknown, request: any) => request.slots.map((slot: any) => {
      reviewed.push(slot.brief.id)
      return { schemaVersion: 'pre-design.image-inspection.v1', imageSha256: createHash('sha256').update(request.bytes).digest('hex'),
        requirementHash: imageBriefHash(slot.brief), usageId: slot.brief.id, placementHash: slot.placementHash, inspectedAt: 'fixture',
        actualImageInput: true, actualModel: { provider: 'fixture', model: 'vision' }, executionId: 'fixture-run', contentKind: 'render',
        relevant: true, matchedSubjects: slot.brief.subjects, mismatches: [], domesticContext: 'supported', textLanguages: [],
        textLegible: true, watermark: 'none', quality: 'pass', essentialBounds: [{ x: 0, y: 0, width: 1, height: 1 }],
        decision: 'approved', sourceContextHash: imageSourceContextHash(request) }
    }))
    const pipeline = new ReportImagePipeline({ classes: { settings: () => ({ routes: { review: { provider: 'fixture', model: 'vision' } } }),
      execution: () => ({ classId: 'review', status: 'completed', actual: { provider: 'fixture', model: 'vision' } }) } as never,
      inspection: { inspect } as never, candidates: async () => [], resolveDemands: async () => requested,
      search: async demand => demand.brief.id === 'scene-0:main' || demand.brief.id === 'scene-1:main' ? [{
        sourceKey: 'same-original', sourcePath, originalFileName: 'original.png', displayName: `${demand.brief.subjects[0]}；林下空间`,
        mimeType: 'image/png', widthPx: 1600, heightPx: 1000, semanticRole: 'concept_visual', createdAt: 'fixture', adoptedAt: 'fixture',
        objectIds: [], evidenceIds: [], origin: { type: 'generated_by_plugin', parentAssetKeys: [], sourceMaterialKeys: [], sourceTool: null, method: '{}' },
      }] : [] })
    await expect(pipeline.prepare(input, root, {} as never, AbortSignal.timeout(10000), () => {}, { maxGenerations: 0 }))
      .rejects.toThrow('REPORT_IMAGE_GAPS: 11 ')
    expect(reviewed).toContain('scene-0:main'); expect(reviewed).toContain('scene-1:main')
    expect(new Set(reviewed).size).toBe(reviewed.length)
  } finally { await rm(root, { recursive: true, force: true }) }
})
