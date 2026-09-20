import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrozenProjectInput } from '../src/report/types.ts'
import type { PlanningManuscriptPage } from '../src/report/manuscript/types.ts'
import type { VisualAssetRecord, VisualTaskRecord } from '../src/governance/types.ts'
import { makeSourceIndex, manuscriptSourceFingerprint } from '../src/report/manuscript/source.ts'
import { sceneRequirements, sceneIdentity } from '../src/report/manuscript/visual-scenes.ts'
import { PageVisualFillService, DEFAULT_PAGE_VISUAL_STYLE } from '../src/presentation/page-visual-fill.ts'
import { readPageVisualState, savePageVisualRequest, type PageVisualRequest } from '../src/presentation/page-visual-state.ts'
import { prepareReportSceneVisuals } from '../src/presentation/report-scene-visuals.ts'
import { preparePresentationMaterials } from '../src/presentation/material-registry.ts'
import { adoptedPresentationAssets } from '../src/presentation/runtime-integration.ts'
import { createAutomaticVisualCompletion } from '../src/presentation/automatic-visuals.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'
import { VisualAgentError, VisualAgentService } from '../src/visual/agent.ts'
import { VisualAssetStore } from '../src/visual/asset-store.ts'
import { SessionImageCollector, type SessionEventLike } from '../src/visual/session-image-collector.ts'

const roots: string[] = []
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const hash = createHash('sha256').update(png).digest('hex')
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function workspace() { const root = await mkdtemp(join(tmpdir(), 'report-scenes-')); roots.push(root); return root }
function project(place = '工业遗产园区'): FrozenProjectInput {
  const input: FrozenProjectInput = { projectId: 'scene-project', projectName: `${place}前期策划`, revision: 8, generatedAt: '2026-09-18T00:00:00Z',
    recommendation: `组织${place}日间游览`, decisionItems: [], gates: [], visualAssets: [], adoptedAssetIds: [],
    stateObjects: [{ objectId: 'IM01', chapterId: '08', workItemId: '08-01', title: '开放安排', summary: `${place}安排到达、步行游览和运营维护。`, facts: [] }] }
  const sourceRefs = [makeSourceIndex(input)[0]!.id]
  const page = (id: string, subject: string, kind: PlanningManuscriptPage['visual']['kind']): PlanningManuscriptPage => ({
    id, kind: 'argument', title: subject, claim: `${subject}承接日间游览。`, body: [`${place}将场所服务与使用活动串联。`], sourceRefs, notes: [],
    visual: { kind, subject, purpose: subject, caption: subject },
  })
  const source = page('launch-photo', `${place}到达与集散服务`, 'concept')
  const flow = page('launch-route', `${place}到达与步行游览`, 'diagram')
  const withGraph: PlanningManuscriptPage = { ...flow, visual: { ...flow.visual, diagram: { nodes: [
    { id: 'arrival', label: `${place}集散到达`, column: 0, row: 0 },
    { id: 'walk', label: `${place}步行游览`, column: 1, row: 0 },
    { id: 'condition', label: '满足开放条件', column: 2, row: 0 },
  ], edges: [{ from: 'arrival', to: 'walk' }, { from: 'walk', to: 'condition' }] } } }
  const operations = { ...page('launch-operation', `${place}运营维护`, 'none'), table: { columns: ['设施', '安排'], rows: [['入口', '开放服务']] } }
  return { ...input, manuscript: { schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: 'test', projectId: input.projectId,
    sourceRevision: input.revision, sourceFingerprint: manuscriptSourceFingerprint(input), generatedAt: input.generatedAt,
    title: input.projectName, chapters: [{ id: 'launch', title: '实施组织', thesis: input.recommendation,
      pages: [source, withGraph, operations, page('launch-site-photo', `${place}现场`, 'source'), page('case-reference', '真实项目案例', 'source')] }] } }
}
function replacePages(input: FrozenProjectInput, edit: (pages: readonly PlanningManuscriptPage[]) => readonly PlanningManuscriptPage[]): FrozenProjectInput {
  return { ...input, manuscript: { ...input.manuscript!, chapters: input.manuscript!.chapters.map(chapter => ({ ...chapter, pages: edit(chapter.pages) })) } }
}
async function adoptedImage(input: FrozenProjectInput, root: string, assetId = 'accepted-image') {
  const path = join(root, `${assetId}.png`); await writeFile(path, png)
  const source = { ...input, adoptedAssetIds: [assetId], visualAssets: [{ assetId, kind: 'concept' as const, taskId: `page-fill-${'a'.repeat(64)}`,
    chapterId: '08', workItemId: '08-01', caption: input.manuscript!.chapters[0]!.pages[0]!.title, sourcePath: path,
    mimeType: 'image/png' as const, sha256: hash, width: 1, height: 1 }] }
  const asset = { ...adoptedPresentationAssets(source)[0]!, pageBindingOnly: true,
    pageBindings: [{ findingId: 'manuscript:launch-photo', role: 'primary' as const }] }
  const request: PageVisualRequest = { taskId: `page-fill-${'a'.repeat(64)}`, findingId: 'manuscript:launch-photo', briefHash: 'a'.repeat(64),
    prompt: '明确对应来源页场所的效果图', style: '统一风格', status: 'adopted', assetId }
  return { source, asset, request }
}

describe('generic report scene requirements', () => {
  it('covers main, table and every graph node, but excludes source photographs and real cases', () => {
    const input = project(), scenes = sceneRequirements(input)
    expect(scenes.length).toBeGreaterThanOrEqual(3)
    const bindings = scenes.flatMap(scene => scene.bindings)
    for (const id of ['launch-photo', 'launch-operation']) expect(bindings.some(binding => binding.pageId === id && !binding.nodeIds)).toBe(true)
    expect(bindings.filter(binding => binding.pageId === 'launch-route').flatMap(binding => binding.nodeIds ?? []).sort()).toEqual(['arrival', 'condition', 'walk'])
    expect(bindings.some(binding => ['launch-site-photo', 'case-reference'].includes(binding.pageId))).toBe(false)
    expect(scenes.every(scene => scene.chapterId === '08' && scene.workItemId === '08-01')).toBe(true)
  })
  it.each(['工业遗产园区', '海滨生态公园'])('derives %s scenes without a tea-project fallback', name => {
    const scenes = sceneRequirements(project(name))
    expect(scenes.every(scene => !scene.prompt.includes('茶') && !scene.topic.includes('tea:'))).toBe(true)
    expect(scenes.every(scene => scene.prompt.includes(name))).toBe(true)
  })
  it('has stable identities after page reordering, but rejects a stale source version', () => {
    const input = project(), first = sceneRequirements(input)
    expect(sceneRequirements(replacePages(input, pages => [...pages].reverse()))).toEqual(first)
    expect(() => sceneRequirements({ ...input, revision: 9 })).toThrow('REPORT_SCENE_SOURCE_CHANGED')
    expect(() => sceneRequirements({ ...input, stateObjects: [{ ...input.stateObjects[0]!, summary: '来源发生变化' }] })).toThrow('REPORT_SCENE_SOURCE_CHANGED')
    const changed = replacePages(input, pages => pages.map(page => page.id === 'launch-route' ? { ...page, body: ['调整同一场所的开放时段。'] } : page))
    expect(sceneRequirements(changed).find(scene => scene.brief.pageId === 'launch-route' && scene.brief.nodeId === 'arrival')?.contentHash).not.toBe(first.find(scene => scene.brief.pageId === 'launch-route' && scene.brief.nodeId === 'arrival')?.contentHash)
  })
  it('uses independent scenes for unrecognized subjects instead of broadly matching unrelated objects', () => {
    const input = replacePages(project(), pages => pages.slice(0, 2).map((page, index) => ({ ...page, title: `独立主题${index}`, body: ['条件安排'],
      visual: { kind: 'none', subject: `唯一对象${index}`, purpose: '具体表达', caption: '主题' } })))
    expect(new Set(sceneRequirements(input).map(scene => scene.sceneKey)).size).toBe(2)
  })
  it('matches the physical subject before incidental purpose words and landscape setting names', () => {
    const input = replacePages(project('茶园'), pages => [
      { ...pages[0]!, id: 'maintenance', visual: { kind: 'none', subject: '茶园运营维护', purpose: '组织日常维护', caption: '运营维护' } },
      { ...pages[0]!, id: 'walking', visual: { kind: 'concept', subject: '茶山梯田上的架空步道', purpose: '协调水利管护和步行', caption: '茶山步道' } },
      { ...pages[0]!, id: 'waste', visual: { kind: 'none', subject: '污废物密闭收集', purpose: '茶园服务', caption: '收集设施' } },
    ])
    const scenes = sceneRequirements(input)
    expect(scenes.find(scene => scene.bindings.some(binding => binding.pageId === 'maintenance'))?.topic).toBe('tea:operation')
    expect(scenes.find(scene => scene.bindings.some(binding => binding.pageId === 'walking'))?.topic).toBe('tea:walking')
    expect(scenes.find(scene => scene.bindings.some(binding => binding.pageId === 'waste'))?.topic).toBe('tea:sanitation')
  })
  it('never generates a requested real photograph even when an old manuscript mislabeled its visual kind', () => {
    const input = replacePages(project(), pages => [{ ...pages[0]!, visual: { kind: 'diagram', subject: '旧厂房真实现状照片或记录', purpose: '说明已有条件', caption: '旧厂房' } }])
    expect(sceneRequirements(input)).toEqual([])
  })
  it('keeps related concept scenes for graph stages when the page main image requires source evidence', () => {
    const input = replacePages(project(), pages => [{ ...pages[1]!, visual: { ...pages[1]!.visual, subject: '旧厂房真实现状照片或记录' } }])
    const scenes = sceneRequirements(input), bindings = scenes.flatMap(scene => scene.bindings)
    expect(bindings.every(binding => binding.nodeIds?.length)).toBe(true)
    expect(bindings.flatMap(binding => binding.nodeIds ?? []).sort()).toEqual(['arrival', 'condition', 'walk'])
    expect(scenes.every(scene => !scene.prompt.includes('真实现状照片'))).toBe(true)
  })
})

describe('approved scene reuse and node bindings', () => {
  it('keeps an explicitly bound picture on its own position and does not fan out a topic', async () => {
    const root = await workspace(), { source, asset, request } = await adoptedImage(project(), root)
    const result = await prepareReportSceneVisuals({ frozenProject: source, assets: [asset], requests: [request] })
    const scene = result.requirements.find(scene => scene.topic.endsWith(':arrival'))!
    expect(result.coveredSceneKeys).toEqual([scene.sceneKey])
    expect(result.assets[0]!.pageBindings).toEqual([{ findingId: 'manuscript:launch-photo', role: 'primary' }])
    expect(result.assets[0]!.pageBindings!.some(binding => binding.findingId.startsWith('report-scene:'))).toBe(false)
    expect(result.assets[0]!.pageBindings!.some(binding => binding.findingId === 'manuscript:launch-site-photo')).toBe(false)
    expect(await prepareReportSceneVisuals({ frozenProject: source, assets: result.assets, requests: [request] })).toEqual(result)
  })
  it('does not reuse a tea image for an industrial or seaside page, or count deterministic SVGs', async () => {
    const root = await workspace(), initial = project('茶园'), { source, asset, request } = await adoptedImage(initial, root)
    const mixed = replacePages(source, pages => [...pages, { ...pages[1]!, id: 'launch-industry', title: '工业厂房步行游览',
      body: ['工业厂房保留机器展陈。'], visual: { kind: 'none', subject: '工业厂房步行游览', purpose: '步行参观', caption: '厂房参观' } },
    { ...pages[1]!, id: 'launch-coastal', title: '海滨到达服务', body: ['海滨入口停车接驳。'],
      visual: { kind: 'none', subject: '海滨到达服务', purpose: '到达服务', caption: '海滨入口' } }])
    const result = await prepareReportSceneVisuals({ frozenProject: mixed, assets: [asset, { ...asset, sourceKey: 'diagram', mimeType: 'image/svg+xml' }], requests: [request] })
    expect(result.assets[0]!.pageBindings!.some(binding => ['manuscript:launch-industry', 'manuscript:launch-coastal'].includes(binding.findingId))).toBe(false)
    expect(result.coverage.every(row => row.assetSourceKey === asset.sourceKey)).toBe(true)
  })
  it.each(['rejected', 'corrupt', 'not-adopted'] as const)('does not count a %s picture as scene coverage', async failure => {
    const root = await workspace(), { source, asset, request } = await adoptedImage(project(), root)
    if (failure === 'corrupt') await writeFile(asset.sourcePath, 'corrupt image')
    const result = await prepareReportSceneVisuals({ frozenProject: failure === 'not-adopted' ? { ...source, adoptedAssetIds: [] } : source,
      assets: [asset], requests: [{ ...request, status: failure === 'rejected' ? 'failed' : request.status }] })
    expect(result.coverage).toEqual([])
  })
  it('removes prior managed scene bindings when every relevant page becomes source evidence', async () => {
    const root = await workspace(), { source, asset, request } = await adoptedImage(project(), root)
    const first = await prepareReportSceneVisuals({ frozenProject: source, assets: [asset], requests: [request] })
    const revised = replacePages(source, pages => pages.map(page => ({ ...page, visual: { ...page.visual, kind: 'source' } })))
    const next = await prepareReportSceneVisuals({ frozenProject: revised, assets: first.assets, requests: [request] })
    expect(next.requirements).toEqual([])
    expect(next.assets[0]!.pageBindings).toEqual([])
    expect(next.assets[0]!.origin.method).not.toContain('reportScenes')
  })
})

describe('dedicated scene generation lifecycle', () => {
  async function serviceFixture() {
    const root = await workspace(), source = project(), assets: VisualAssetRecord[] = [], generation: unknown[] = []
    const visual = {
      generate: async (_parent: unknown, task: { taskId: string; projectId: string; prompt: string }, _signal: unknown, options: unknown) => {
        generation.push({ task, options })
        const raster = new PNG({ width: 1, height: 1 }); raster.data.set([20 + assets.length * 20, 40, 180, 255]); const generatedPng = PNG.sync.write(raster)
        const asset: VisualAssetRecord = { assetId: `scene-image-${assets.length}`, taskId: task.taskId, projectId: source.projectId, kind: 'concept', required: false,
          status: 'candidate', mimeType: 'image/png', fileName: `scene-image-${assets.length}.png`, sha256: createHash('sha256').update(generatedPng).digest('hex'), width: 1, height: 1, createdAt: source.generatedAt,
          quality: { accepted: true, score: 1, issues: [] } }
        await writeFile(join(root, asset.fileName), generatedPng); assets.push(asset); return asset
      },
      adopt: async (_projectId: string, assetId: string, revision: number) => {
        const index = assets.findIndex(asset => asset.assetId === assetId)
        assets[index] = { ...assets[index]!, status: 'adopted', adoptedRevision: revision }; return assets[index]!
      },
    }
    const frozen = (): FrozenProjectInput => ({ ...source, adoptedAssetIds: assets.filter(asset => asset.status === 'adopted').map(asset => asset.assetId),
      visualAssets: assets.filter(asset => asset.status === 'adopted').map(asset => ({ assetId: asset.assetId, taskId: asset.taskId, kind: 'concept', chapterId: '08', workItemId: '08-01',
        caption: '相关空间场景', sourcePath: join(root, asset.fileName), mimeType: 'image/png', sha256: asset.sha256, width: 1, height: 1 })) })
    const dependencies = { visual, governance: { readProject: () => ({ visualAssets: assets }) }, resolveAsset: (name: string) => join(root, name), adoptedAssets: adoptedPresentationAssets }
    return { root, source, assets, generation, visual, frozen, dependencies, service: new PageVisualFillService(dependencies as never) }
  }
  it('generates once, quality-checks, adopts and rebinds a shared scene without a fake standard finding', async () => {
    const fixture = await serviceFixture(), { service, root, source, generation } = fixture
    const scene = sceneRequirements(source)[0]!, input = { frozenProject: source, workspaceRoot: root, sceneKey: scene.sceneKey }
    const [generated, duplicate] = await Promise.all([service.generateScene({} as never, input), service.generateScene({} as never, input)])
    expect(generated.assetId).toBe(duplicate.assetId); expect(generation).toHaveLength(1)
    expect(await service.generateScene({} as never, input)).toMatchObject({ reused: true, status: 'candidate' })
    await service.adoptScene({ ...input, assetId: generated.assetId })
    const current = { ...input, frozenProject: fixture.frozen() }
    expect(await service.generateScene({} as never, current)).toMatchObject({ reused: true, status: 'adopted' })
    expect(generation).toHaveLength(1)
    const materials = await preparePresentationMaterials({ ...current, assets: adoptedPresentationAssets(current.frozenProject) })
    expect(materials.assets[0]!.pageBindings).toEqual([])
    const bound = await prepareReportSceneVisuals({ ...current, assets: materials.assets })
    expect(bound.coveredSceneKeys).toContain(scene.sceneKey)
    expect(bound.assets[0]!.pageBindings!.every(binding => binding.findingId.startsWith('manuscript:'))).toBe(true)
    const state = await readPageVisualState(root, source.projectId)
    expect(state.requests[0]!.scene).toEqual(sceneIdentity(scene))
  })
  it('rejects source changes and changed scene content before adopting a stale candidate', async () => {
    const { service, root, source, assets } = await serviceFixture(), scene = sceneRequirements(source)[0]!
    const input = { frozenProject: source, workspaceRoot: root, sceneKey: scene.sceneKey }
    const generated = await service.generateScene({} as never, input)
    await expect(service.adoptScene({ ...input, frozenProject: { ...source, revision: 9 }, assetId: generated.assetId })).rejects.toThrow('REPORT_SCENE_SOURCE_CHANGED')
    const changed = replacePages(source, pages => pages.map(page => ({ ...page, body: ['同一项目新增具体实施内容。'] })))
    await expect(service.adoptScene({ ...input, frozenProject: changed, assetId: generated.assetId })).rejects.toThrow('REPORT_SCENE_CANDIDATE_MISMATCH')
    expect(assets[0]!.status).toBe('candidate')
  })
  it('keeps uncertain dispatch in recovery mode instead of issuing a fresh paid request', async () => {
    const fixture = await serviceFixture(), { source, root } = fixture, scene = sceneRequirements(source)[0]!
    const identity = sceneIdentity(scene), briefHash = sha256CanonicalJson({ scene: identity, prompt: scene.prompt, style: DEFAULT_PAGE_VISUAL_STYLE })
    await savePageVisualRequest(root, source.projectId, { taskId: `page-fill-${briefHash}`, findingId: scene.findingId, scene: identity,
      briefHash, prompt: scene.prompt, style: DEFAULT_PAGE_VISUAL_STYLE, status: 'generating' })
    let recovery = false
    const service = new PageVisualFillService({ ...fixture.dependencies, visual: { ...fixture.visual,
      generate: async (_parent: unknown, _task: unknown, _signal: unknown, options: { recoveryOnly: boolean }) => {
        recovery = options.recoveryOnly; throw new VisualAgentError('visual-recovery-required', '等待原子会话回传')
      } } } as never)
    await expect(service.generateScene({} as never, { frozenProject: source, workspaceRoot: root, sceneKey: scene.sceneKey })).rejects.toThrow('等待原子会话回传')
    expect(recovery).toBe(true)
    expect((await readPageVisualState(root, source.projectId)).requests[0]!.status).toBe('recovery_required')
    expect(fixture.generation).toHaveLength(0)
  })
  it('does not accept a scene identity edited independently from its durable request hash', async () => {
    const { service, root, source } = await serviceFixture(), scene = sceneRequirements(source)[0]!
    await service.generateScene({} as never, { frozenProject: source, workspaceRoot: root, sceneKey: scene.sceneKey })
    const path = join(root, '.pre-design/page-visual-fill.json'), state = JSON.parse(await readFile(path, 'utf8'))
    state.requests[0].scene.sourceRevision++
    await writeFile(path, JSON.stringify(state))
    await expect(readPageVisualState(root, source.projectId)).rejects.toThrow('场景请求身份与来源版本不匹配')
  })
  it('fills all missing themes on demand, then a repeated automatic run makes no model calls', async () => {
    const fixture = await serviceFixture(), { source, root, service, generation } = fixture
    let syncs = 0
    const complete = createAutomaticVisualCompletion({ pageVisualFill: service, input: async () => ({ frozenProject: fixture.frozen(), workspaceRoot: root }),
      target: () => Infinity, sync: async () => { syncs++ }, assertCurrent: () => {} })
    await complete(source.projectId, source.revision, {} as never, new AbortController().signal)
    expect(generation).toHaveLength(sceneRequirements(source).length)
    const count = generation.length
    await complete(source.projectId, source.revision, {} as never, new AbortController().signal)
    expect(generation).toHaveLength(count)
    expect(syncs).toBeGreaterThan(0)
    const receipt = JSON.parse(await readFile(join(root, '.pre-design/visual-delivery.json'), 'utf8'))
    expect(receipt.results.every((row: { state: string }) => row.state === 'covered')).toBe(true)
  })
  it('does not let automatic covered-scene skipping bypass a live quality revocation', async () => {
    const fixture = await serviceFixture(), { source, root, service, generation, assets } = fixture
    const scene = sceneRequirements(source)[0]!, input = { frozenProject: source, workspaceRoot: root, sceneKey: scene.sceneKey }
    const generated = await service.generateScene({} as never, input)
    await service.adoptScene({ ...input, assetId: generated.assetId })
    const snapshot = fixture.frozen(), count = generation.length
    assets[0] = { ...assets[0]!, quality: { accepted: false, score: 0, issues: ['验收撤销'] } }
    const complete = createAutomaticVisualCompletion({ pageVisualFill: service, input: async () => ({ frozenProject: snapshot, workspaceRoot: root }),
      target: () => Infinity, sync: async () => {}, assertCurrent: () => {} })
    await expect(complete(source.projectId, source.revision, {} as never, new AbortController().signal)).rejects.toThrow('REPORT_SCENE_ADOPTION_UNVERIFIED')
    expect(generation).toHaveLength(count)
  })
})

describe('automatic recovery of a late original scene image', () => {
  afterEach(() => vi.restoreAllMocks())

  async function recoveryFixture(options: {
    failure?: 'timeout' | 'transport'
    result?: 'image' | 'no-image' | 'unknown' | 'unreadable' | 'recovery-timeout'
    change?: 'parent-cancelled' | 'parent-during-recovery' | 'revision' | 'content' | 'content-after-recovery'
  } = {}) {
    const root = await workspace()
    let source = replacePages(project(), pages => [pages[0]!, pages[2]!])
    const original = source, parentSignal = new AbortController(), sceneDeadline = new AbortController(), recoveryDeadline = new AbortController()
    const recoveryLimits: number[] = []
    let firstChild: string | undefined, settlingFailure = false, failureSettled = false
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    let firstDeadlineAllocated = false
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      if (ms === 600_000 && !firstDeadlineAllocated) { firstDeadlineAllocated = true; return sceneDeadline.signal }
      if (failureSettled && options.result === 'recovery-timeout') { recoveryLimits.push(ms); return recoveryDeadline.signal }
      return timeout(ms)
    })
    const jpeg = await readFile(new URL('./fixtures/golden-project/assets/concept-01.jpg', import.meta.url))
    const tasks: VisualTaskRecord[] = [], assets: VisualAssetRecord[] = [], started: string[] = []
    const executions: { id: string; status: string }[] = [], recoverySignals: AbortSignal[] = []
    const events = new Map<string, readonly SessionEventLike[]>()
    const ended: readonly SessionEventLike[] = [{ seq: 1, type: 'turn/start', data: {} }, { seq: 3, type: 'turn/end', data: {} }]
    const withImage: readonly SessionEventLike[] = [ended[0]!, { seq: 2, type: 'assistant/message', data: {
      message: { content: [{ type: 'text', text: `data:image/jpeg;base64,${jpeg.toString('base64')}` }] },
    } }, ended[1]!]
    const changeContent = () => { source = replacePages(source, pages => pages.map(page => ({ ...page, body: ['场所活动与原始要求已不同。'] }))) }
    const governance = {
      readProject: () => ({ visualTasks: tasks, visualAssets: assets }),
      putVisualTask: async (record: VisualTaskRecord) => {
        const index = tasks.findIndex(task => task.taskId === record.taskId)
        if (index < 0) tasks.push(record); else tasks[index] = record
        return record
      },
      putVisualAsset: async (record: VisualAssetRecord) => {
        const index = assets.findIndex(asset => asset.assetId === record.assetId)
        if (index < 0) assets.push(record); else assets[index] = record
        return record
      },
    }
    const collector = new SessionImageCollector({ sessions: { get: () => undefined },
      attachments: { readImage: async () => { throw new Error('unexpected attachment') } },
      readPersistedEvents: async (id, signal) => {
        signal.throwIfAborted()
        if (settlingFailure && id === firstChild) {
          settlingFailure = false
          const snapshot = events.get(id)
          // Persist after the original failure's terminal check captured its snapshot.
          queueMicrotask(() => {
            failureSettled = true
            if ((options.result ?? 'image') === 'image') events.set(id, withImage)
            if (options.change === 'parent-cancelled') parentSignal.abort(new Error('parent cancelled'))
            if (options.change === 'revision') source = { ...source, revision: source.revision + 1 }
            if (options.change === 'content') changeContent()
          })
          return snapshot
        }
        if (failureSettled && id === firstChild) {
          recoverySignals.push(signal)
          if (options.change === 'parent-during-recovery') { parentSignal.abort(new Error('parent cancelled')); signal.throwIfAborted() }
          if (options.result === 'unreadable') throw new Error('persistent log unreadable')
          if (options.result === 'recovery-timeout') {
            queueMicrotask(() => recoveryDeadline.abort(new DOMException('recovery deadline exceeded', 'TimeoutError')))
            return await new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
          }
        }
        return events.get(id)
      },
      waitForEvent: async (id, signal) => {
        events.set(id, options.result === 'unknown' || options.result === 'unreadable' ? ended.slice(0, 1) : ended)
        settlingFailure = true
        if ((options.failure ?? 'timeout') === 'timeout') {
          sceneDeadline.abort(new DOMException('scene deadline exceeded', 'TimeoutError'))
          signal.throwIfAborted()
        }
        throw new Error('transport closed after submit')
      },
    })
    const store = new VisualAssetStore(join(root, 'visuals'))
    const visual = new VisualAgentService({ governance, collector, store, llm: { listModels: async () => [] },
      agentClasses: {
        begin: async () => { const execution = { id: `original-execution-${executions.length + 1}`, status: 'running' }; executions.push(execution)
          return { ...execution, selected: { provider: 'configured-image-provider', model: 'configured-image-model' } } },
        attach: async () => {},
        finish: async (id: string, status: string) => {
          executions.find(execution => execution.id === id)!.status = status
          if (options.change === 'content-after-recovery' && status === 'completed' && id === executions[0]!.id) changeContent()
        },
      },
      subagents: { startContinuable: async (spec: { childId: string }) => {
        started.push(spec.childId)
        if (firstChild === undefined) { firstChild = spec.childId; events.set(spec.childId, ended.slice(0, 1)) }
        else events.set(spec.childId, withImage)
        return { childId: spec.childId, messageId: 'generated-image' }
      }, interrupt: () => {} },
    } as never)
    const service = new PageVisualFillService({ visual, governance, resolveAsset: (name: string) => store.resolveAsset(name), adoptedAssets: adoptedPresentationAssets } as never)
    const frozen = (): FrozenProjectInput => ({ ...source, adoptedAssetIds: assets.filter(asset => asset.status === 'adopted').map(asset => asset.assetId),
      visualAssets: assets.filter(asset => asset.status === 'adopted').map(asset => ({ assetId: asset.assetId, taskId: asset.taskId, kind: 'concept', chapterId: '08', workItemId: '08-01',
        caption: '项目相关场景', sourcePath: store.resolveAsset(asset.fileName), mimeType: asset.mimeType, sha256: asset.sha256, width: asset.width, height: asset.height })) })
    const input = () => ({ frozenProject: frozen(), workspaceRoot: root })
    const complete = createAutomaticVisualCompletion({ pageVisualFill: service, input: async () => input(), target: () => Infinity,
      sync: async () => {}, assertCurrent: () => { if (source.revision !== original.revision) throw new Error('VISUAL_SOURCE_CHANGED') } })
    return { root, original, parentSignal, sceneDeadline, jpeg, tasks, assets, executions, started, recoverySignals, recoveryLimits, service, input,
      run: () => complete(original.projectId, original.revision, {} as never, parentSignal.signal) }
  }

  it.each(['timeout', 'transport'] as const)('recovers the original JPEG after %s, adopts it and continues without a replacement dispatch', async failure => {
    const fixture = await recoveryFixture({ failure })
    await fixture.run()
    expect(fixture.assets.map(asset => asset.status)).toEqual(['adopted', 'adopted'])
    expect(await readFile(join(fixture.root, 'visuals', fixture.assets[0]!.fileName))).toEqual(fixture.jpeg)
    expect(fixture.tasks.map(task => ({ attempts: task.attempts, executionId: task.executionId, status: task.status }))).toEqual([
      { attempts: 1, executionId: 'original-execution-1', status: 'adopted' },
      { attempts: 1, executionId: 'original-execution-2', status: 'adopted' },
    ])
    expect(fixture.started).toHaveLength(2)
    expect(fixture.executions).toEqual([{ id: 'original-execution-1', status: 'completed' }, { id: 'original-execution-2', status: 'completed' }])
    expect(fixture.recoverySignals.length).toBeGreaterThan(0)
    expect(fixture.recoverySignals.every(signal => signal !== fixture.sceneDeadline.signal && !signal.aborted)).toBe(true)
    const receipt = JSON.parse(await readFile(join(fixture.root, '.pre-design/visual-delivery.json'), 'utf8'))
    expect(receipt.results.map((row: { state: string }) => row.state)).toEqual(['adopted', 'adopted'])
  })

  it('forces an explicit recovery of a failed request to keep the original child and execution', async () => {
    const fixture = await recoveryFixture({ failure: 'transport' }), scene = sceneRequirements(fixture.original)[0]!
    const input = { ...fixture.input(), sceneKey: scene.sceneKey }
    await expect(fixture.service.generateScene({} as never, input)).rejects.toMatchObject({ code: 'visual-generation-failed' })
    expect((await readPageVisualState(fixture.root, fixture.original.projectId)).requests[0]!.status).toBe('failed')
    const recovered = await fixture.service.generateScene({} as never, { ...input, recoveryOnly: true })
    expect(recovered.status).toBe('candidate')
    expect(fixture.started).toHaveLength(1); expect(fixture.executions).toHaveLength(1)
    expect(fixture.tasks[0]).toMatchObject({ attempts: 1, executionId: 'original-execution-1', status: 'candidate_ready' })
  })

  it('does not turn a recovery with no original record into a model task or a success', async () => {
    const fixture = await recoveryFixture(), scene = sceneRequirements(fixture.original)[0]!
    await expect(fixture.service.generateScene({} as never, { ...fixture.input(), sceneKey: scene.sceneKey, recoveryOnly: true })).rejects.toThrow('PAGE_VISUAL_RECOVERY_REQUIRED')
    expect(fixture.started).toEqual([]); expect(fixture.tasks).toEqual([]); expect(fixture.assets).toEqual([])
  })

  it('does not dispatch a replacement when explicit recovery of a failed request has no image', async () => {
    const fixture = await recoveryFixture({ failure: 'transport', result: 'no-image' }), scene = sceneRequirements(fixture.original)[0]!
    const input = { ...fixture.input(), sceneKey: scene.sceneKey }
    await expect(fixture.service.generateScene({} as never, input)).rejects.toMatchObject({ code: 'visual-generation-failed' })
    await expect(fixture.service.generateScene({} as never, { ...input, recoveryOnly: true })).rejects.toMatchObject({ code: 'visual-generation-failed' })
    expect(fixture.started).toHaveLength(1); expect(fixture.executions).toHaveLength(1)
    expect(fixture.assets).toEqual([]); expect(fixture.tasks[0]!.attempts).toBe(1)
  })

  it.each(['no-image', 'unknown', 'unreadable', 'recovery-timeout'] as const)('keeps %s recovery unsuccessful and never advances or dispatches again', async result => {
    const fixture = await recoveryFixture({ failure: 'transport', result })
    await expect(fixture.run()).rejects.toBeInstanceOf(VisualAgentError)
    expect(fixture.started).toHaveLength(1); expect(fixture.executions).toHaveLength(1)
    expect(fixture.tasks[0]!.attempts).toBe(1); expect(fixture.assets).toEqual([])
    const receipt = JSON.parse(await readFile(join(fixture.root, '.pre-design/visual-delivery.json'), 'utf8'))
    expect(receipt.results).toHaveLength(1); expect(receipt.results[0].state).toBe('failed')
    expect((await readPageVisualState(fixture.root, fixture.original.projectId)).requests[0]!.status).toBe(result === 'no-image' ? 'failed' : 'recovery_required')
    if (result === 'recovery-timeout') {
      expect(fixture.recoveryLimits).toHaveLength(1)
      expect(fixture.recoveryLimits[0]).toBeGreaterThan(0); expect(fixture.recoveryLimits[0]).toBeLessThan(600_000)
    }
  })

  it.each(['parent-cancelled', 'parent-during-recovery', 'revision', 'content', 'content-after-recovery'] as const)('does not adopt or continue after %s', async change => {
    const fixture = await recoveryFixture({ failure: 'transport', change })
    if (change === 'parent-during-recovery') await expect(fixture.run()).rejects.toMatchObject({ code: 'visual-recovery-required' })
    else await expect(fixture.run()).rejects.toThrow(change === 'parent-cancelled' ? 'parent cancelled' : 'SOURCE_CHANGED')
    expect(fixture.started).toHaveLength(1); expect(fixture.executions).toHaveLength(1)
    expect(fixture.assets.every(asset => asset.status !== 'adopted')).toBe(true)
    if (change !== 'content-after-recovery') expect(fixture.assets).toEqual([])
    const receipt = JSON.parse(await readFile(join(fixture.root, '.pre-design/visual-delivery.json'), 'utf8'))
    expect(receipt.results).toHaveLength(1)
    expect(receipt.results[0].state).toBe(change.startsWith('parent-') ? 'interrupted' : 'failed')
  })
})
