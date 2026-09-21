import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PNG } from 'pngjs'
import { createNativeReportImagePipeline } from '../src/presentation/report-image-runtime.ts'
import { ReportImagePipeline, reportImageInspectionSource, type ReportImageDemand, type GeneratedReportImage } from '../src/presentation/report-image-pipeline.ts'
import { imageBriefHash, REPORT_IMAGE_POLICY_VERSION, type ImageInspection } from '../src/visual/image-policy.ts'
import { imageSourceContextHash, saveImageInspection } from '../src/visual/image-inspection.ts'
import { normalizeReportRaster } from '../src/visual/report-raster.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'
import type { VisualAssetRecord } from '../src/governance/types.ts'
import type { VisualGenerationTask } from '../src/visual/types.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const project: FrozenProjectInput = { projectId: 'correction-project', projectName: '公共公园', revision: 3, generatedAt: 'fixture',
  recommendation: '林下休憩', decisionItems: [], gates: [], visualAssets: [],
  stateObjects: [{ objectId: 'o', chapterId: 'spatial', workItemId: 's', title: '公园', summary: '公园', facts: [] }] }
const demand: ReportImageDemand = { findingId: 'scene', brief: { id: 'scene:main', pageId: 'scene', version: 'fixture',
  conclusion: '林下休憩', subjects: ['林下座椅'], activities: ['休息'], environment: '公园', scale: 'scene',
  allowedKinds: ['render'], allowedSources: ['generated'], locale: 'domestic' } }
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const taskIdFor = (requested: ReportImageDemand) => `report-image-${hash(JSON.stringify([project.projectId, project.revision, imageBriefHash(requested.brief)]))}`
type Callbacks = ConstructorParameters<typeof ReportImagePipeline>[0]

async function fixture(normalized = false) {
  const root = await mkdtemp(join(tmpdir(), 'image-correction-')); roots.push(root)
  const bytes = PNG.sync.write(new PNG({ width: normalized ? 2400 : 1200, height: normalized ? 1800 : 800 }))
  const sourcePath = join(root, 'original.png'); await writeFile(sourcePath, bytes)
  const original: VisualAssetRecord = { projectId: project.projectId, taskId: taskIdFor(demand), assetId: 'original', status: 'adopted',
    kind: 'concept', required: false, fileName: sourcePath, mimeType: 'image/png', sha256: hash(bytes), width: 1200, height: 800,
    quality: { accepted: true, score: 1, issues: [] }, createdAt: 'fixture' }
  const assets = new Map([[original.taskId, original]])
  let validExecution = true
  const classes = { execution: () => validExecution ? { classId: 'review', status: 'completed', actual: { provider: 'fixture', model: 'vision' } } : undefined }
  const generate = vi.fn(async (_parent: unknown, task: VisualGenerationTask) => {
    const asset = { ...original, taskId: task.taskId, assetId: `correction-${assets.size}`, status: 'candidate' as const }
    assets.set(task.taskId, asset); return asset
  })
  const adopt = vi.fn(async () => {})
  const pipeline = createNativeReportImagePipeline({ classes: classes as never, inspection: {} as never, web: {} as never,
    sceneSpecs: {} as never, visual: { findCandidate: (_project: string, taskId: string) => assets.get(taskId), generate, adopt } as never,
    resolveAsset: file => file })
  const api = (pipeline as unknown as { dependencies: Callbacks }).dependencies
  const call = (mode: 'recover' | 'generate', requested = demand) => api[mode]!(requested, {} as never, AbortSignal.timeout(5000), project, root)
  const initial = (await call('recover'))!
  const review = async (result: GeneratedReportImage, decision: 'approved' | 'rejected', requested = demand) => {
    const material = result.material
    const prepared = await normalizeReportRaster({ bytes: await readFile(material.sourcePath), mimeType: 'image/png' })
    const context = prepared.normalized ? { ...material, imagePreparation: { version: 'report-raster-v1' as const,
      sourcePath: material.sourcePath, sourceSha256: prepared.sourceSha256 } } : material
    const receipt: ImageInspection = { schemaVersion: 'pre-design.image-inspection.v1', imageSha256: hash(prepared.bytes),
      requirementHash: imageBriefHash(requested.brief), usageId: requested.brief.id, placementHash: `${REPORT_IMAGE_POLICY_VERSION}:full-original`,
      inspectedAt: 'fixture', actualImageInput: true, actualModel: { provider: 'fixture', model: 'vision' }, executionId: 'native-review',
      contentKind: 'render', relevant: true, matchedSubjects: requested.brief.subjects, mismatches: decision === 'rejected' ? ['标识含英文且中文不可读'] : [],
      domesticContext: 'supported', textLanguages: decision === 'rejected' ? ['en'] : [], textLegible: decision === 'approved',
      watermark: 'none', quality: 'pass', essentialBounds: [{ x: 0, y: 0, width: 1, height: 1 }], decision,
      sourceContextHash: imageSourceContextHash(reportImageInspectionSource(context, project)) }
    await saveImageInspection(root, requested.brief, receipt); return receipt
  }
  return { root, original, assets, initial, generate, adopt, call, review, invalidateExecution: () => { validExecution = false } }
}

it.each([false, true])('replaces only a verified rejection, preserving shared original provenance (normalized=%s)', async normalized => {
  const f = await fixture(normalized), oldMethod = f.initial.material.origin.method
  await f.review(f.initial, 'rejected')
  // A recovery pass must not spend another model call.
  expect(await f.call('recover')).toBeUndefined()
  expect(f.generate).not.toHaveBeenCalled()
  const replacement = (await f.call('generate'))!
  expect(f.generate).toHaveBeenCalledOnce()
  const task = f.generate.mock.calls[0]![1]
  expect(task.taskId).not.toBe(f.original.taskId)
  expect(task.prompt).toContain('标识含英文且中文不可读')
  expect(task.prompt).toContain('画面中不绘制任何文字')
  expect(replacement.material.origin.method).not.toBe(oldMethod)
  expect(f.original.status).toBe('adopted')
  expect(f.initial.material.origin.method).toBe(oldMethod)
  expect(f.adopt).not.toHaveBeenCalled()
  await f.review(replacement, 'approved')
  expect((await f.call('recover'))?.material).toEqual(replacement.material)
  expect((await f.call('generate'))?.material).toEqual(replacement.material)
  expect(f.generate).toHaveBeenCalledOnce()
})

it('reuses the deterministic correction task after an uncertain request and never changes unrelated usage', async () => {
  const f = await fixture(); await f.review(f.initial, 'rejected')
  f.generate.mockImplementation(async () => { throw new Error('visual-recovery-required') })
  await expect(f.call('generate')).rejects.toThrow('visual-recovery-required')
  await expect(f.call('generate')).rejects.toThrow('visual-recovery-required')
  expect(f.generate.mock.calls[0]![1]).toEqual(f.generate.mock.calls[1]![1])
  const other = { ...demand, brief: { ...demand.brief, id: 'other:main', pageId: 'other' } }
  f.assets.set(taskIdFor(other), { ...f.original, taskId: taskIdFor(other) })
  const recovered = (await f.call('recover', other))!
  await f.review(recovered, 'approved', other)
  expect((await f.call('generate', other))?.material).toEqual(recovered.material)
  expect(f.generate).toHaveBeenCalledTimes(2)
})

it('follows multiple rejected corrections and recovers the newest approved result without resubmission', async () => {
  const f = await fixture(); await f.review(f.initial, 'rejected')
  const first = (await f.call('generate'))!; await f.review(first, 'rejected')
  const second = (await f.call('generate'))!; await f.review(second, 'approved')
  expect(new Set(f.generate.mock.calls.map(call => call[1].taskId)).size).toBe(2)
  expect((await f.call('recover'))?.material).toEqual(second.material)
  expect(f.generate).toHaveBeenCalledTimes(2)
})

it('does not treat an unverified review or altered bytes as permission to generate another image', async () => {
  const f = await fixture(); await f.review(f.initial, 'rejected'); f.invalidateExecution()
  expect((await f.call('generate'))?.material).toEqual(f.initial.material)
  expect(f.generate).not.toHaveBeenCalled()
  const g = await fixture(); await g.review(g.initial, 'rejected')
  const changed = new PNG({ width: 1200, height: 800 }); changed.data.fill(255)
  await writeFile(g.original.fileName, PNG.sync.write(changed))
  expect((await g.call('generate'))?.material).toEqual(g.initial.material)
  expect(g.generate).not.toHaveBeenCalled()
})

it('never applies a corrective generation to a real case source', async () => {
  const f = await fixture(); await f.review(f.initial, 'rejected')
  const factual = { ...demand, caseSource: { caseId: 'real', name: '真实案例', location: '中国', mediaPurpose: '整体' } }
  expect(await f.call('recover', factual)).toBeUndefined()
  await expect(f.call('generate', factual)).rejects.toThrow('REPORT_IMAGE_SOURCE_REQUIRED')
  expect(f.generate).not.toHaveBeenCalled()
})
