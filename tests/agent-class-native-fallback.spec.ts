import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { PNG } from 'pngjs'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentClassService } from '../src/agent-classes/service.ts'
import { ImageInspectionAgent } from '../src/visual/image-inspection.ts'
import { SceneSpecificationAgent } from '../src/visual/scene-spec-agent.ts'
import { VisualAgentService } from '../src/visual/agent.ts'
import { VisualAssetStore } from '../src/visual/asset-store.ts'
import { SessionImageCollector, type SessionEventLike } from '../src/visual/session-image-collector.ts'
import { DshSubagentWorkflowAnalyzer } from '../src/runtime/subagent-workflow-analyzer.ts'
import { PlanningManuscriptService } from '../src/report/manuscript/service.ts'
import { PlanningManuscriptEditor } from '../src/report/manuscript/editorial-service.ts'
import { makeSourceIndex, manuscriptSourceFingerprint } from '../src/report/manuscript/source.ts'
import { PLANNING_CHAPTER_IDS, PLANNING_MANUSCRIPT_POLICY_VERSION, type PlanningManuscript } from '../src/report/manuscript/types.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'
import type { ImageSlotBrief } from '../src/visual/image-policy.ts'

const a = { provider: 'test', model: 'a' }, b = { provider: 'test', model: 'b' }
const parent = { id: 'parent', options: a } as never
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture(respond: (request: any) => any, failPrimary = true) {
  const root = await mkdtemp(join(tmpdir(), 'native-fallback-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context(); cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage); await ctx.plugin(StorageJson, { root }); await ctx.plugin(StorageDomain, { backend: 'json' })
  const childEvents = new Map<string, { type: string; data: unknown }[]>()
  const classes = await AgentClassService.open(ctx.storage.domain, {
    llm: { listProviders: () => [{ id: 'test', name: 'Test' }], listConfigurableProviders: () => [],
      listModels: async () => [a, b].map(r => ({ provider: r.provider, id: r.model, name: r.model })) } as never,
    sessions: { get: id => ({ snapshotEvents: () => childEvents.get(id) ?? [] }) },
  })
  await classes.save(0, { image: a, web: a, review: a, text: a }, { image: [b], web: [b], review: [b], text: [b] })
  const dispose = vi.fn(async () => undefined)
  const record = (id: string, route: typeof a, code?: string) => childEvents.set(id, [
    { type: 'request/header', data: { header: { config: route } } },
    { type: 'turn/end', data: { reason: code ? { kind: 'error', error: { code, message: 'provider unavailable' } } : { kind: 'completed' } } },
  ])
  let count = 0
  const start = vi.fn(async (_provider: string, request: any) => {
    const id = `child-${++count}`, failed = failPrimary && request.agentOptions.model === 'a'
    record(id, request.agentOptions, failed ? 'TRANSPORT' : undefined)
    return { id, dispose, result: Promise.resolve(failed ? { stopReason: 'error', output: [] } : respond(request)) }
  })
  return { root, classes, childEvents, record, dispose, start, subagents: { start, getProvider: () => ({}) } }
}
const signal = () => AbortSignal.timeout(5000)
const brief: ImageSlotBrief = { id: 'one:main', pageId: 'one', version: 'test', conclusion: '林下步行', subjects: ['树荫步道'],
  activities: ['步行'], environment: '国内公园', scale: 'scene', allowedKinds: ['photo'], allowedSources: ['web'], locale: 'domestic' }
const image = PNG.sync.write(new PNG({ width: 64, height: 64 }))
const probe = ['red', 'blue', 'green', 'yellow']
const assessment = { usageId: brief.id, contentKind: 'photo', relevant: true, matchedSubjects: brief.subjects, mismatches: [],
  domesticContext: 'supported', textLanguages: [], textLegible: true, watermark: 'none', quality: 'pass', essentialBounds: [{ x: 0, y: 0, width: 1, height: 1 }] }
const inspectInput = { projectId: 'p', bytes: image, mimeType: 'image/png' as const, slots: [{ brief, placementHash: 'placement' }],
  sourceType: 'web' as const, sourceLocation: '中国', sourceLocationVerified: true }
it('uses a separately recorded review backup and binds the pixel receipt to its actual execution', async () => {
  const f = await fixture(() => ({ stopReason: 'completed', output: [{ type: 'text', text: JSON.stringify({ probe, items: [assessment] }) }] }))
  const review = new ImageInspectionAgent({ classes: f.classes, subagents: f.subagents,
    attachments: { saveImage: async () => ({ attachmentId: 'image' }) }, challenge: () => ({ bytes: image, answer: probe }) } as never)
  const [receipt] = await review.inspect(parent, inspectInput, signal())
  expect(receipt).toMatchObject({ decision: 'approved', actualModel: b })
  expect(f.classes.execution(receipt!.executionId)).toMatchObject({ status: 'completed', routeIndex: 1, actual: b })
  expect(f.start.mock.calls.map(c => c[1].agentOptions.model)).toEqual(['a', 'b'])
  expect(f.dispose).toHaveBeenCalledTimes(2)
})
it.each(['invalid-json', 'bad-pixels', 'rejected'] as const)('does not use configured backups to bypass review %s', async mode => {
  const f = await fixture(() => ({ stopReason: 'completed', output: [{ type: 'text', text: mode === 'invalid-json' ? 'invalid'
    : JSON.stringify({ probe: mode === 'bad-pixels' ? ['blue', 'blue', 'blue', 'blue'] : probe,
      items: [{ ...assessment, quality: mode === 'rejected' ? 'fail' : 'pass' }] }) }] }), false)
  const review = new ImageInspectionAgent({ classes: f.classes, subagents: f.subagents,
    attachments: { saveImage: async () => ({ attachmentId: 'image' }) }, challenge: () => ({ bytes: image, answer: probe }) } as never)
  if (mode === 'rejected') expect((await review.inspect(parent, inspectInput, signal()))[0]?.decision).toBe('rejected')
  else await expect(review.inspect(parent, inspectInput, signal())).rejects.toThrow(/IMAGE_(REVIEW_OUTPUT_INVALID|INPUT_CAPABILITY_UNVERIFIED)/u)
  expect(f.start.mock.calls.map(call => call[1].agentOptions.model)).toEqual(mode === 'invalid-json' ? ['a', 'a', 'a'] : ['a'])
  expect(await f.classes.executions('p')).toHaveLength(mode === 'invalid-json' ? 3 : 1)
})
it('retains every scene translation attempt and does not charge an availability switch as a content correction', async () => {
  const sceneBrief = { ...brief, subjects: ['公共服务投入与经营投入的分工'], activities: ['资金分工'], environment: '资金构成对照' }
  const context = { usageId: brief.id, pageTitle: '组织建设投入', intent: sceneBrief.subjects[0]!,
    sources: [{ path: 'body[0]', text: '树荫步道' }, { path: 'body[1]', text: '国内公园' }, { path: 'body[2]', text: '步行' }] }
  const specification = { usageId: brief.id, subjects: [{ text: '树荫步道', sourcePath: 'body[0]' }],
    activities: [{ text: '步行', sourcePath: 'body[2]' }], environment: { text: '国内公园', sourcePath: 'body[1]' } }
  const f = await fixture(() => ({ stopReason: 'completed', output: [{ type: 'text', text: JSON.stringify({ items: [specification] }) }] }))
  const result = await new SceneSpecificationAgent({ classes: f.classes, subagents: f.subagents } as never)
    .resolve(parent, 'p', f.root, [{ brief: sceneBrief, context }], signal())
  expect(result.get(brief.id)?.subjects).toEqual(['树荫步道'])
  const folder = join(f.root, '.pre-design', 'scene-specifications')
  const receipt = JSON.parse(await readFile(join(folder, (await readdir(folder))[0]!), 'utf8'))
  expect(receipt.attemptExecutionIds).toHaveLength(2)
  expect(receipt.history.map((h: any) => h.status)).toEqual(['failed', 'completed'])
  expect(f.start.mock.calls.map(c => c[1].agentOptions.model)).toEqual(['a', 'b'])
  expect(f.start.mock.calls[1]![1].prompt).toEqual(f.start.mock.calls[0]![1].prompt)
})
it('uses the text backup for workflow analysis without consuming the independent timeout retry', async () => {
  const candidate = { payload: { data: { canonical_name: '少潭河' } }, qualityEvidence: { completionChecks: [], evidenceChecks: [], assumptions: [], blockers: [], confidence: 0.9 } }
  const f = await fixture(() => ({ stopReason: 'completed', structured: candidate }))
  const analyzer = new DshSubagentWorkflowAnalyzer({ agentClasses: f.classes, subagents: f.subagents,
    repository: { readContext: () => ({ project: { projectId: 'p', name: '少潭河', currentRevision: 0 }, stateObjects: [] }) },
    registry: { stateSchema: () => ({}), stateExample: () => ({}) } } as never)
  const result = await analyzer.analyze(parent, 'p', { workflowId: 'preplan.wf.01.01', targetObjectId: 'PS01', requiredUpstream: ['ProjectSeed'], title: '项目身份', atomicToolIds: [] } as never, signal())
  expect(result.payload).toEqual(candidate.payload)
  expect(f.start.mock.calls.map(c => c[1].agentOptions.model)).toEqual(['a', 'b'])
  expect(f.start.mock.calls[1]![1].prompt).toEqual(f.start.mock.calls[0]![1].prompt)
  expect(new Set((await f.classes.executions('p')).map(e => e.chainId)).size).toBe(1)
})
it.each(['live', 'cold', 'wrong-route', 'cancelled'] as const)('recovers only a verified %s failed-stream raster without declaring its native execution successful', async mode => {
  const f = await fixture(() => undefined, false), visualTasks: any[] = [], visualAssets: any[] = []
  const task = { taskId: 'raster', projectId: 'p', chapterId: '03', workItemId: '03-01', kind: 'concept' as const, required: true, prompt: '树林步行' }
  const childId = 'preplanning-visual-' + createHash('sha256').update('p\0raster\x001').digest('hex').slice(0, 24)
  const raster = PNG.sync.write(new PNG({ width: 1024, height: 768 }))
  const events: SessionEventLike[] = [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'step/start', data: { step: 1 } },
    { seq: 3, type: 'request/header', data: { header: { config: mode === 'wrong-route' ? b : a } } },
    { seq: 4, type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [
      { type: 'text-chunks', index: 0, texts: [`![scene](data:image/png;base64,${raster.toString('base64')})`] },
    ] } },
  ]
  const terminal = () => events.push({ seq: 5, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'parent' } } } })
  const startContinuable = vi.fn(async (spec: any) => {
    expect(spec.childId).toBe(childId)
    f.childEvents.set(childId, events)
    return { childId, messageId: 'one' }
  })
  const interrupt = vi.fn(terminal)
  let originalExecution: string | undefined
  if (mode === 'cold' || mode === 'cancelled') {
    const run = await f.classes.begin('p', 'image', task.prompt, parent, signal())
    originalExecution = run.id
    await f.classes.attach(run.id, childId)
    f.childEvents.set(childId, events); terminal()
    await f.classes.finish(run.id, mode === 'cancelled' ? 'cancelled' : 'failed', 'original native failure')
    f.childEvents.delete(childId)
    visualTasks.push({ ...task, attempts: 1, childId, executionId: run.id, modelRoute: a, status: 'failed', updatedAt: new Date().toISOString() })
  }
  const collector = new SessionImageCollector({
    sessions: { get: () => mode === 'cold' || mode === 'cancelled' ? undefined : ({ seq: events.length, snapshotEvents: () => events }) },
    readPersistedEvents: async () => events,
    attachments: { readImage: vi.fn() }, waitForEvent: async () => { throw Error('terminal must already be observed') },
  })
  const service = new VisualAgentService({ agentClasses: f.classes, llm: {} as never,
    governance: { readProject: () => ({ visualTasks, visualAssets }), putVisualTask: async (value: any) => { visualTasks[0] = value },
      putVisualAsset: async (value: any) => { visualAssets.push(value) } } as never,
    subagents: { startContinuable, interrupt } as never, collector, store: new VisualAssetStore(f.root),
  })
  const result = service.generate(parent, task, signal(), { preserveUncertain: true, recoveryOnly: mode === 'cold' || mode === 'cancelled' })
  if (mode === 'wrong-route' || mode === 'cancelled') {
    await expect(result).rejects.toThrow()
    expect(visualAssets).toHaveLength(0)
    expect(visualTasks[0].status).not.toBe('candidate_ready')
  } else {
    const asset = await result
    expect(asset).toMatchObject({ status: 'candidate', provider: 'test', model: 'a',
      recoveredFrom: { childId, executionId: visualTasks[0].executionId, eventSeq: 4, turn: 1, step: 1 } })
    expect(asset.sha256).toBe(createHash('sha256').update(raster).digest('hex'))
    expect(visualTasks[0]).toMatchObject({ attempts: 1, status: 'candidate_ready', childId })
    expect(f.classes.execution(visualTasks[0].executionId)).toMatchObject({ status: 'failed', actual: a, childStopReason: 'aborted' })
    if (originalExecution) expect(f.classes.execution(originalExecution)).toMatchObject({ error: 'original native failure' })
  }
  if (mode === 'cold' || mode === 'cancelled') { expect(startContinuable).not.toHaveBeenCalled(); expect(interrupt).not.toHaveBeenCalled() }
  else { expect(startContinuable).toHaveBeenCalledOnce(); expect(interrupt).toHaveBeenCalledOnce() }
  expect(await f.classes.executions('p')).toHaveLength(1)
})
it.each(['terminal', 'unknown'] as const)('handles %s image failure while preserving paid attempt identities', async mode => {
  const f = await fixture(() => undefined), visualTasks: any[] = [], visualAssets: any[] = []
  const startContinuable = vi.fn(async (spec: any) => {
    f.record(spec.childId, spec.request.agentOptions, spec.request.agentOptions.model === 'a' ? 'SERVER' : undefined)
    if (mode === 'unknown') f.childEvents.get(spec.childId)!.pop()
    return { childId: spec.childId, messageId: 'message' }
  })
  const service = new VisualAgentService({ agentClasses: f.classes, llm: {} as never,
    governance: { readProject: () => ({ visualTasks, visualAssets }), putVisualTask: async (task: any) => { visualTasks[0] = task }, putVisualAsset: async (asset: any) => { visualAssets.push(asset) } } as never,
    subagents: { startContinuable, interrupt: vi.fn() } as never,
    collector: { hasCompleted: async () => mode === 'terminal', waitForImage: async () => {
      if (visualTasks[0].modelRoute.model === 'a') throw new Error('provider failure')
      return { mimeType: 'image/png', data: new Uint8Array([1, 2, 3]), width: 1600, height: 900 }
    } } as never,
    store: { saveCandidate: async (task: any) => ({ assetId: 'image', ...task, status: 'candidate', mimeType: 'image/png', fileName: 'image.png', sha256: 'a'.repeat(64), width: 1600, height: 900, createdAt: new Date().toISOString() }) } as never,
  })
  const result = service.generate(parent, { taskId: 'image', projectId: 'p', chapterId: '03', workItemId: '03-01', kind: 'concept', required: true, prompt: '树林步行' }, signal(), { preserveUncertain: true })
  if (mode === 'unknown') {
    await expect(result).rejects.toMatchObject({ code: 'visual-recovery-required' })
    expect(startContinuable).toHaveBeenCalledOnce(); expect(visualTasks[0]).toMatchObject({ attempts: 1, status: 'running' })
  } else {
    await expect(result).resolves.toMatchObject({ status: 'candidate', provider: 'test', model: 'b' })
    expect(visualTasks[0]).toMatchObject({ attempts: 2, status: 'candidate_ready' })
    expect(startContinuable.mock.calls.map(c => c[0].request.agentOptions.model)).toEqual(['a', 'b'])
    expect(new Set(startContinuable.mock.calls.map(c => c[0].childId)).size).toBe(2)
    const history = await f.classes.executions('p')
    expect(history.find(h => h.selected.model === 'a')).toMatchObject({ status: 'failed', actual: a })
    expect(history.find(h => h.selected.model === 'b')).toMatchObject({ status: 'completed', actual: b, fallbackFromExecutionId: history.find(h => h.selected.model === 'a')!.id })
  }
})
const input: FrozenProjectInput = { projectId: 'p', projectName: '山地体验', revision: 1, generatedAt: '2026-09-18T00:00:00Z', recommendation: '拟采用预约制组织游览', decisionItems: [], gates: [], visualAssets: [], stateObjects: [{ objectId: 'PG04', chapterId: '6', title: '体验产品', summary: '拟依托现有道路组织游览', facts: [] }] }
function draft(): PlanningManuscript {
  return { schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: PLANNING_MANUSCRIPT_POLICY_VERSION, projectId: 'p', sourceRevision: 1,
    generatedAt: input.generatedAt, sourceFingerprint: manuscriptSourceFingerprint(input), title: '山地体验策划',
    chapters: PLANNING_CHAPTER_IDS.map(id => ({ id, title: '山地体验与' + id, thesis: '拟以道路串联观察与休憩活动。', pages: [{ id: id + '-walk', kind: id === 'products' ? 'product' : 'argument',
      title: '林间漫游', claim: '沿现有道路组织步行，串联观察与休息。', body: ['拟结合场地使用条件设置休息点。'], sourceRefs: makeSourceIndex(input).map(s => s.id), notes: [],
      visual: { kind: 'concept', subject: '林间漫游', purpose: '展示步行体验', caption: '拟议步行体验' },
      ...(id === 'products' ? { product: { name: '林间漫游', audience: '周末家庭', experience: '观察林木与步行休憩', location: '具备开放条件的道路', scale: '接待人数由可用道路、服务人员与活动时长共同确定', operations: '预约导览' } } : {}),
    }] })) }
}
it.each(['writer', 'editor'] as const)('preserves %s checkpoints and correction allowance across provider fallback', async role => {
  const f = await fixture(request => {
    const chapter = draft().chapters.find(c => c.id === request.label.split(':').at(-1))!
    return { stopReason: 'completed', structured: role === 'writer' ? chapter : { chapters: [chapter] } }
  })
  const dependencies = { agentClasses: f.classes, subagents: f.subagents, maxConcurrency: 1 }
  const result = role === 'writer' ? await new PlanningManuscriptService(dependencies as never).prepare(input, f.root, parent, signal(), () => {})
    : await new PlanningManuscriptEditor(dependencies as never).edit(draft(), input, f.root, parent, signal(), () => {}, 2)
  expect(result.chapters).toHaveLength(7)
  expect(f.start.mock.calls.map(c => c[1].agentOptions.model)).toEqual(Array.from({ length: 7 }, () => ['a', 'b']).flat())
  const history = await f.classes.executions('p')
  expect(history).toHaveLength(14); expect(history.filter(e => e.status === 'failed')).toHaveLength(7)
  expect(new Set(history.map(e => e.chainId)).size).toBe(7)
  const folder = join(f.root, '.pre-design', role === 'writer' ? 'report-manuscript-checkpoints' : 'report-manuscript-editorial')
  if (role === 'writer') {
    const checkpoint = JSON.parse(await readFile(join(folder, (await readdir(folder))[0]!, 'chapters.json'), 'utf8'))
    expect(checkpoint.correctionsUsed).toBe(0)
    for (const chapter of Object.values(checkpoint.chapters) as any[]) expect(chapter.attempts.map((a: any) => [a.status, a.validationCorrection])).toEqual([['failed', false], ['completed', false]])
  } else {
    for (const file of await readdir(folder)) {
      const checkpoint = JSON.parse(await readFile(join(folder, file), 'utf8'))
      expect(checkpoint.attempts.map((a: any) => [a.status, a.correction])).toEqual([['failed', false], ['completed', false]])
    }
  }
})
