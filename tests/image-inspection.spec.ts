import { expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'
import { resolveChildAgentOptions } from '@deepseek-ai/dsh-subagent'
import { ImageInspectionAgent, parseImageAssessment, inspectionCacheKey, readImageInspection, saveImageInspection, imageSourceContextHash } from '../src/visual/image-inspection.ts'
import { imageBriefHash, type ImageSlotBrief } from '../src/visual/image-policy.ts'

const brief: ImageSlotBrief = { id: 'a:one', pageId: 'a', version: 'test', conclusion: '林下步行', subjects: ['树荫步道'], activities: ['步行'], environment: '国内公园', scale: 'scene', allowedKinds: ['photo'], allowedSources: ['web'], locale: 'domestic' }
const item = { usageId: brief.id, contentKind: 'photo', relevant: true, matchedSubjects: ['树荫步道'], mismatches: [], domesticContext: 'supported', textLanguages: [], textLegible: true, watermark: 'none', quality: 'pass', essentialBounds: [{ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }] }
const verifiedSource = { sourceType: 'web' as const, sourceLocation: '中国浙江', sourceLocationVerified: true }
function inspector(output: string, stopReason = 'completed') {
  const png = PNG.sync.write(new PNG({ width: 64, height: 64 })), route = { provider: 'native', model: 'vision' }
  const classes = { begin: vi.fn(async () => ({ id: 'run', selected: route })), attach: vi.fn(), finish: vi.fn(),
    execution: () => ({ classId: 'review', status: 'completed', actual: route }) }
  const dispose = vi.fn()
  const start = vi.fn(async (_provider: string, _request: any) => ({ id: 'child', dispose,
    result: Promise.resolve({ stopReason, output: [{ type: 'text', text: output }] }) }))
  const service = new ImageInspectionAgent({ classes, subagents: { start },
    attachments: { saveImage: async () => ({ attachmentId: 'image' }) }, challenge: () => ({ bytes: png, answer: ['red', 'blue', 'green', 'yellow'] }) } as never)
  return { service, classes, dispose, start, input: { projectId: 'p', bytes: png, mimeType: 'image/png' as const,
    slots: [{ brief, placementHash: 'place' }], ...verifiedSource } }
}
const outputFor = (assessment: unknown) => JSON.stringify({ probe: ['red', 'blue', 'green', 'yellow'], items: [assessment] })
it.each(['vision', 'parent-text'])('lets the selected review model resolve its output budget instead of inheriting the %s parent cap', async parentModel => {
  const { service, start, input } = inspector(outputFor(item))
  const parent = { id: 'parent', options: { provider: 'native', model: parentModel, maxTokens: 2048 },
    session: { requestHeader: () => undefined } } as never
  await service.inspect(parent, input, AbortSignal.timeout(1000))
  // Exercise native delegation: omitting maxTokens would silently inherit 2048.
  const options = resolveChildAgentOptions(parent, start.mock.calls[0]![1].agentOptions, 1)
  expect(options).toMatchObject({ provider: 'native', model: 'vision' })
  expect(options.maxTokens).toBeUndefined()
})
it('rejects a token-limited native result even when its text parses and does not silently spend another task', async () => {
  const { service, classes, start, dispose, input } = inspector(outputFor(item), 'max-tokens')
  await expect(service.inspect({ id: 'parent' } as never, input, AbortSignal.timeout(1000))).rejects.toThrow('IMAGE_REVIEW_FAILED: max-tokens')
  expect(classes.finish).toHaveBeenCalledWith('run', 'failed', 'IMAGE_REVIEW_FAILED: max-tokens')
  expect(start).toHaveBeenCalledOnce()
  expect(dispose).toHaveBeenCalledOnce()
})
it('rejects a claimed scene that is actually a composite, foreign context or obstructed', () => {
  expect(parseImageAssessment(item, brief).decision).toBe('approved')
  for (const patch of [{ contentKind: 'composite' }, { domesticContext: 'unverified' }, { textLanguages: ['en'] }, { watermark: 'obstructive' }, { textLegible: false }])
    expect(parseImageAssessment({ ...item, ...patch }, brief).decision).toBe('rejected')
  expect(() => parseImageAssessment({ ...item, essentialBounds: [{ x: 0.8, y: 0, width: 0.8, height: 1 }] }, brief)).toThrow()
})
it('invalidates review when pixels, brief or final placement change', () => {
  const key = inspectionCacheKey('a'.repeat(64), brief, 'place')
  expect(inspectionCacheKey('b'.repeat(64), brief, 'place')).not.toBe(key)
  expect(inspectionCacheKey('a'.repeat(64), { ...brief, conclusion: '骑行' }, 'place')).not.toBe(key)
  expect(inspectionCacheKey('a'.repeat(64), brief, 'other')).not.toBe(key)
})
it('requires every required subject verbatim and rejects empty or repeated subject evidence', () => {
  const compound = { ...brief, subjects: ['树荫步道', '休息座椅'] }
  expect(parseImageAssessment(item, compound).decision).toBe('rejected')
  expect(parseImageAssessment({ ...item, matchedSubjects: ['树荫步道', '树荫步道'] }, compound).decision).toBe('rejected')
  expect(parseImageAssessment({ ...item, matchedSubjects: ['树荫步道', '休息座椅'] }, compound).decision).toBe('approved')
  for (const evidence of ['', '  ', '不在需求中的主体']) {
    if (evidence.trim()) expect(parseImageAssessment({ ...item, matchedSubjects: [evidence] }, brief).decision).toBe('rejected')
    else expect(() => parseImageAssessment({ ...item, matchedSubjects: [evidence] }, brief)).toThrow('IMAGE_REVIEW_OUTPUT_INVALID')
  }
})
it('reports malformed model output without exposing the model text in errors or execution records', async () => {
  for (const malformed of ['PRIVATE_MODEL_TEXT: { broken', outputFor({ ...item, essentialBounds: [{ x: 2, y: 0, width: 1, height: 1 }] })]) {
    const { service, classes, dispose, input } = inspector(malformed)
    await expect(service.inspect({ id: 'parent' } as never, input, AbortSignal.timeout(1000))).rejects.toThrow(/^IMAGE_REVIEW_OUTPUT_INVALID$/u)
    expect(classes.finish).toHaveBeenCalledWith('run', 'failed', 'IMAGE_REVIEW_OUTPUT_INVALID')
    expect(dispose).toHaveBeenCalledOnce()
  }
})
it('records missing subjects with empty bounds as rejected without aborting the other batch results', async () => {
  const absentBrief = { ...brief, id: 'a:absent', subjects: ['不在图片里的设施'] }
  const absent = { ...item, usageId: absentBrief.id, relevant: false, matchedSubjects: [], mismatches: ['缺少必需主体'], essentialBounds: [] }
  const { service, classes, input } = inspector(JSON.stringify({ probe: ['red','blue','green','yellow'], items: [item, absent] }))
  const results = await service.inspect({ id: 'parent' } as never, { ...input, slots: [...input.slots, { brief: absentBrief, placementHash: 'place' }] }, AbortSignal.timeout(1000))
  expect(results.map(row => [row.usageId, row.decision])).toEqual([[brief.id,'approved'],[absentBrief.id,'rejected']])
  expect(results[1]?.essentialBounds).toEqual([])
  expect(classes.finish).toHaveBeenCalledWith('run', 'completed')
})
it('never approves an image without protected subject bounds, even if the model claims relevance', () => {
  expect(parseImageAssessment({ ...item, essentialBounds: [] }, brief).decision).toBe('rejected')
})
it('does not accept a model assertion of domestic photography without verified source location', async () => {
  const { service, input } = inspector(outputFor(item))
  const [review] = await service.inspect({ id: 'parent' } as never, { ...input, sourceLocationVerified: false }, AbortSignal.timeout(1000))
  expect(review).toMatchObject({ decision: 'rejected', domesticContext: 'unverified' })
})
it('allows generated render context without presenting it as a verified photographic location', async () => {
  const renderBrief = { ...brief, allowedKinds: ['render'] as const, allowedSources: ['generated'] as const }
  const { service, input } = inspector(outputFor({ ...item, contentKind: 'render' }))
  const [review] = await service.inspect({ id: 'parent' } as never, { ...input, sourceType: 'generated', sourceLocationVerified: false,
    slots: [{ brief: renderBrief, placementHash: 'place' }] }, AbortSignal.timeout(1000))
  expect(review?.decision).toBe('approved')
})
it('gives generated scenery a representation check instead of asking for proof of a real shooting location', async () => {
  const { service, input, start } = inspector(outputFor({ ...item, contentKind: 'render' }))
  await service.inspect({ id: 'parent' } as never, { ...input, sourceType: 'generated', sourceLocationVerified: false,
    sourceContext: JSON.stringify({ prompt: '中国乡村林下步道，中文标识' }),
    slots: [{ brief: { ...brief, allowedKinds: ['render'], allowedSources: ['generated'] }, placementHash: 'place' }] }, AbortSignal.timeout(1000))
  const request = start.mock.calls[0]![1]
  const prompt = request.prompt.find((block: any) => block.type === 'text').text
  expect(prompt).toContain('生成场景地域审核')
  expect(prompt).toContain('不要求真实拍摄地点证明')
  expect(prompt).not.toContain('地点依据已核验：否')
  expect(prompt).toContain('中国乡村林下步道，中文标识')
  expect(request.persona).not.toContain('缺少可靠地点依据时domesticContext为unverified')
})
it('does not turn an unverified or foreign generated scene into domestic approval', async () => {
  for (const domesticContext of ['unverified', 'international']) {
    const { service, input } = inspector(outputFor({ ...item, contentKind: 'render', domesticContext }))
    const [review] = await service.inspect({ id: 'parent' } as never, { ...input, sourceType: 'generated', sourceLocationVerified: false,
      slots: [{ brief: { ...brief, allowedKinds: ['render'], allowedSources: ['generated'] }, placementHash: 'place' }] }, AbortSignal.timeout(1000))
    expect(review?.decision).toBe('rejected')
    expect(review?.domesticContext).toBe(domesticContext)
  }
})
it('invalidates generated reviews from the ambiguous location policy while retaining photographic source keys', () => {
  const legacy = (source: typeof verifiedSource | { sourceType: 'generated' }) => createHash('sha256').update(JSON.stringify({
    sourceType: source.sourceType, sourceLocation: 'sourceLocation' in source ? source.sourceLocation : null,
    sourceLocationVerified: 'sourceLocationVerified' in source && source.sourceLocationVerified, sourceEvidenceHash: null,
  })).digest('hex')
  expect(imageSourceContextHash({ sourceType: 'generated' })).not.toBe(legacy({ sourceType: 'generated' }))
  expect(imageSourceContextHash(verifiedSource)).toBe(legacy(verifiedSource))
})
it('rejects inconsistent cached decisions and invalidates cached domestic approval when source proof changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'image-inspection-'))
  try {
    const { service, classes, input } = inspector(outputFor(item))
    const [review] = await service.inspect({ id: 'parent' } as never, input, AbortSignal.timeout(1000))
    await saveImageInspection(root, brief, review!)
    expect(await readImageInspection(root, review!.imageSha256, brief, 'place', classes as never, verifiedSource)).toMatchObject({ decision: 'approved' })
    expect(await readImageInspection(root, review!.imageSha256, brief, 'place', classes as never, { ...verifiedSource, sourceLocationVerified: false })).toBeUndefined()
    expect(await readImageInspection(root, review!.imageSha256, brief, 'place', classes as never, { ...verifiedSource, sourceLocation: '日本东京' })).toBeUndefined()
    await saveImageInspection(root, brief, { ...review!, quality: 'fail', decision: 'approved' })
    expect(await readImageInspection(root, review!.imageSha256, brief, 'place', classes as never, verifiedSource)).toBeUndefined()
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('sends actual images to an isolated native child and requires a successful unpredictable pixel challenge', async () => {
  const png = PNG.sync.write(new PNG({ width: 64, height: 64 }))
  const route = { provider: 'native', model: 'vision' }
  const classes = { begin: vi.fn(async () => ({ id: 'run', selected: route })), attach: vi.fn(), finish: vi.fn(), execution: () => ({ status: 'completed', actual: route }) }
  const start = vi.fn(async (_provider: string, request: any) => {
    expect(request.prompt.filter((b: any) => b.type === 'image')).toHaveLength(2)
    expect(request.toolFilter).toEqual({ allow: [] })
    return { id: 'child', dispose: vi.fn(), result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: JSON.stringify({ probe: ['red', 'blue', 'green', 'yellow'], items: [item] }) }] }) }
  })
  const service = new ImageInspectionAgent({ classes, subagents: { start }, attachments: { saveImage: async () => ({ attachmentId: 'image' }) },
    challenge: () => ({ bytes: png, answer: ['red', 'blue', 'green', 'yellow'] }) } as never)
  const [review] = await service.inspect({ id: 'parent' } as never, { projectId: 'p', bytes: png, mimeType: 'image/png', slots: [{ brief, placementHash: 'place' }], ...verifiedSource }, AbortSignal.timeout(1000))
  expect(review).toMatchObject({ actualImageInput: true, actualModel: route, requirementHash: imageBriefHash(brief), decision: 'approved' })
  expect(classes.begin).toHaveBeenCalledWith('p', 'review', expect.any(String), expect.anything(), expect.any(AbortSignal))
})
it('does not treat guessing or prose as proof of image capability', async () => {
  const png = PNG.sync.write(new PNG({ width: 64, height: 64 }))
  const classes = { begin: async () => ({ id: 'run', selected: { provider: 'p', model: 'm' } }), attach: vi.fn(), finish: vi.fn() }
  const service = new ImageInspectionAgent({ classes, subagents: { start: async () => ({ id: 'c', dispose: vi.fn(), result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: JSON.stringify({ probe: ['blue', 'blue', 'blue', 'blue'], items: [item] }) }] }) }) }, attachments: { saveImage: async () => ({ attachmentId: 'x' }) }, challenge: () => ({ bytes: png, answer: ['red', 'blue', 'green', 'yellow'] }) } as never)
  await expect(service.inspect({ id: 'p' } as never, { projectId: 'p', bytes: png, mimeType: 'image/png', slots: [{ brief, placementHash: 'place' }] }, AbortSignal.timeout(1000))).rejects.toThrow('IMAGE_INPUT_CAPABILITY_UNVERIFIED')
  expect(classes.finish).toHaveBeenCalledWith('run', 'failed', expect.any(String))
})

it('propagates the classified native error to the export caller and disposes the child without retrying', async () => {
  const png = PNG.sync.write(new PNG({ width: 64, height: 64 })), dispose = vi.fn()
  const classified = 'MODEL_LOGIN_EXPIRED: 模型登录已失效，请在 DSH 设置中重新登录。'
  const classes = { begin: vi.fn(async () => ({ id: 'run', selected: { provider: 'p', model: 'm' } })), attach: vi.fn(),
    finish: vi.fn(), execution: () => ({ status: 'failed', error: classified }) }
  const start = vi.fn(async () => ({ id: 'child', dispose, result: Promise.resolve({ stopReason: 'error', output: [] }) }))
  const service = new ImageInspectionAgent({ classes, subagents: { start }, attachments: { saveImage: async () => ({ attachmentId: 'image' }) } } as never)
  await expect(service.inspect({ id: 'parent' } as never, { projectId: 'p', bytes: png, mimeType: 'image/png', slots: [{ brief, placementHash: 'place' }] }, AbortSignal.timeout(1000))).rejects.toThrow(classified)
  expect(classes.finish).toHaveBeenCalledWith('run', 'failed', 'IMAGE_REVIEW_FAILED: error')
  expect(start).toHaveBeenCalledOnce()
  expect(dispose).toHaveBeenCalledOnce()
})
