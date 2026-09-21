import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { ReportImagePipeline, type ReportImageDemand, type GeneratedReportImage } from '../src/presentation/report-image-pipeline.ts'
import { imageBriefHash } from '../src/visual/image-policy.ts'
import { imageSourceContextHash } from '../src/visual/image-inspection.ts'
import { manuscriptSourceFingerprint } from '../src/report/manuscript/source.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'
import { png, resize, scene } from './support/image-identity/fixtures.ts'

const route = { provider: 'fixture', model: 'vision' }
const classes = { settings: () => ({ routes: { review: route, image: { provider: 'Comfyui-PIC', model: 'Klein', llm: route } } }),
  execution: () => ({ classId: 'review', status: 'completed', actual: route }) } as never

it('fills independent physical continuations despite a missing factual source and resumes the same demands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'independent-continuations-'))
  try {
    const base: FrozenProjectInput = { projectId: 'continuations', projectName: '林间公园', revision: 1, generatedAt: 'fixture',
      recommendation: '林下休憩', decisionItems: [], gates: [], visualAssets: [],
      stateObjects: [{ objectId: 's', chapterId: 'spatial', workItemId: 's', title: '游园', summary: '林下休憩', facts: [] }] }
    const input: FrozenProjectInput = { ...base, manuscript: { schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: 'fixture',
      projectId: base.projectId, sourceRevision: 1, sourceFingerprint: manuscriptSourceFingerprint(base), generatedAt: 'fixture', title: '林间公园',
      chapters: [{ id: 'spatial', title: '游园体验', thesis: '林下休憩', pages: [{ id: 'walk', kind: 'argument', editorialSummary: true,
        title: '沿线服务与游园体验', claim: '让步行与休息构成连续的公共活动。',
        body: Array.from({ length: 6 }, (_, i) => `第${i + 1}处林下座椅为游人提供休息空间，步道衔接各个活动场所，保持树荫覆盖的慢行环境。`),
        notes: [], sourceRefs: [], visual: { kind: 'concept', subject: '林下座椅', purpose: '步行与休息', caption: '公共活动' } }] }] } }
    const saved = new Map<string, GeneratedReportImage>(), resolved: ReportImageDemand[] = [], generated: string[] = []
    const make = async (demand: ReportImageDemand) => {
      generated.push(demand.brief.id)
      const sourcePath = join(root, `image-${saved.size}.png`)
      await writeFile(sourcePath, png(resize(scene(7 + saved.size * 137), 1600, 900)))
      const result: GeneratedReportImage = { material: { sourceKey: demand.brief.id, sourcePath, originalFileName: 'image.png',
        displayName: demand.brief.subjects.join('；'), mimeType: 'image/png', semanticRole: 'concept_visual', createdAt: 'fixture', adoptedAt: 'fixture',
        objectIds: [], evidenceIds: [], origin: { type: 'generated_by_plugin', parentAssetKeys: [], sourceMaterialKeys: [], sourceTool: null,
          method: JSON.stringify({ usageId: demand.brief.id }) } }, adopt: async () => {} }
      saved.set(demand.brief.id, result); return result
    }
    const pipeline = new ReportImagePipeline({ classes, candidates: async () => [],
      resolveDemands: async demands => {
        resolved.push(...demands)
        if (!demands.some(d => d.brief.id === 'cover:main')) return demands
        const original = demands.find(d => d.brief.pageId === 'walk')!
        return [...demands, { ...original, findingId: 'missing-case', sourceMaterialKey: 'real-case-original',
          brief: { ...original.brief, id: 'missing-case:main', pageId: 'missing-case', allowedSources: ['project'] } }]
      }, recover: async demand => saved.get(demand.brief.id), generate: make,
      inspection: { inspect: async (_parent: unknown, request: any) => request.slots.map((slot: any) => {
        const accepted = JSON.parse(request.sourceContext).usageId === slot.brief.id
        return { schemaVersion: 'pre-design.image-inspection.v1', imageSha256: createHash('sha256').update(request.bytes).digest('hex'),
          requirementHash: imageBriefHash(slot.brief), usageId: slot.brief.id, placementHash: slot.placementHash,
          inspectedAt: 'fixture', actualImageInput: true, actualModel: route, executionId: 'fixture-run', contentKind: 'render',
          relevant: accepted, matchedSubjects: accepted ? slot.brief.subjects : [], mismatches: accepted ? [] : ['different-scene'],
          domesticContext: 'supported', textLanguages: [], textLegible: true, watermark: 'none', quality: 'pass',
          essentialBounds: [{ x: 0, y: 0, width: 1, height: 1 }], decision: accepted ? 'approved' : 'rejected',
          sourceContextHash: imageSourceContextHash(request) }
      }) } as never })
    await expect(pipeline.prepare(input, root, {} as never, AbortSignal.timeout(60000), () => {})).rejects.toThrow('REPORT_IMAGE_GAPS')
    const continuations = generated.filter(id => id.startsWith('walk:continuation:'))
    expect(continuations.length).toBeGreaterThan(0)
    expect(new Set(generated).size).toBe(generated.length)
    const contexts = resolved.filter(d => continuations.includes(d.brief.id))
    expect(contexts.length).toBe(continuations.length)
    expect(contexts.every(d => d.sceneContext?.usageId === d.brief.id && d.sceneContext.nodeLabel === undefined)).toBe(true)
    expect(contexts.every(d => d.sceneContext!.sources.some(s => s.path.startsWith('body[') && s.text.includes('林下座椅')))).toBe(true)
    const gaps = JSON.parse(await readFile(join(root, '.pre-design/report-image-gaps.json'), 'utf8')).gaps
    expect(gaps.map((gap: any) => gap.id)).toEqual(['missing-case:main'])
    const before = generated.length
    await expect(pipeline.prepare(input, root, {} as never, AbortSignal.timeout(60000), () => {}, { maxGenerations: 0 })).rejects.toThrow('REPORT_IMAGE_GAPS')
    expect(generated.length).toBe(before)
    expect(JSON.parse(await readFile(join(root, '.pre-design/report-image-gaps.json'), 'utf8')).gaps.map((gap: any) => gap.id)).toEqual(['missing-case:main'])
  } finally { await rm(root, { recursive: true, force: true }) }
})
