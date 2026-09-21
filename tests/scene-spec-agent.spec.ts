import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveChildAgentOptions } from '@deepseek-ai/dsh-subagent'
import { SceneSpecificationAgent } from '../src/visual/scene-spec-agent.ts'
import { SCENE_SPEC_VERSION } from '../src/report/manuscript/scene-spec.ts'
import type { ImageSlotBrief } from '../src/visual/image-policy.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const route = { provider: 'fixture', model: 'text' }
const brief: ImageSlotBrief = { id: 'funding:main', version: 'test', pageId: 'funding', conclusion: '分项组织投入',
  subjects: ['公共服务投入、经营主体投入与后续扩展资金的分工'], activities: ['资金分工'], environment: '资金构成对照',
  scale: 'scene', allowedKinds: ['photo','render'], allowedSources: ['project','web','generated'], locale: 'domestic' }
const context = { usageId: brief.id, pageTitle: '组织建设投入', intent: brief.subjects[0]!, sources: [
  { path: 'body[0]', text: '林下步道与遮雨廊亭' }, { path: 'body[1]', text: '城市公园' }, { path: 'body[2]', text: '步行休憩' } ] }
const specification = { usageId: brief.id, subjects: [{ text: '林下步道与遮雨廊亭', sourcePath: 'body[0]' }],
  activities: [{ text: '步行休憩', sourcePath: 'body[2]' }], environment: { text: '城市公园', sourcePath: 'body[1]' } }
const parent = { id: 'parent', options: { provider: 'fixture', model: 'text', maxTokens: 2048 }, session: { requestHeader: () => undefined } } as never
async function fixture(output: string | readonly string[] = JSON.stringify({ items: [specification] }), stopReason = 'completed') {
  const root = await mkdtemp(join(tmpdir(), 'scene-spec-agent-')); roots.push(root)
  const run = { id: 'run', classId: 'text', selected: route, status: 'starting', actual: undefined as undefined | typeof route,
    childStopReason: 'completed' as string | undefined }
  const runs = new Map([[run.id, run]])
  let begun = 0, returned = 0
  const classes = { begin: vi.fn(async () => {
    const next = begun++ === 0 ? run : { ...run, id: `run-${begun}`, status: 'starting', actual: undefined }
    runs.set(next.id, next); return next
  }), attach: vi.fn(), finish: vi.fn(async (id: string, status: string) => { const entry = runs.get(id)!; entry.status = status; entry.actual = route }),
    execution: (id: string) => runs.get(id) }
  const dispose = vi.fn(), start = vi.fn(async (_provider: string, _request: any) => ({ id: `child-${returned}`, dispose,
    result: Promise.resolve({ stopReason, output: [{ type: 'text', text: typeof output === 'string' ? output : output[Math.min(returned++, output.length - 1)]! }] }) }))
  const service = new SceneSpecificationAgent({ classes, subagents: { start } } as never)
  return { root, run, runs, classes, start, dispose, service }
}
const secondBrief = { ...brief, id: 'operation:main' }
const secondContext = { ...context, usageId: secondBrief.id }
const secondSpecification = { ...specification, usageId: secondBrief.id }
const pair = [{ brief, context }, { brief: secondBrief, context: secondContext }]
it('translates independent batches with five real children in flight and reuses all completed receipts', async () => {
  const items = Array.from({ length: 48 }, (_, i) => ({ brief: { ...brief, id: `parallel-${i}:main` }, context: { ...context, usageId: `parallel-${i}:main` } }))
  const f = await fixture('unused')
  let release!: () => void, active = 0, peak = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  f.start.mockImplementation(async (_provider: string, request: any) => {
    const requested = JSON.parse(request.prompt[0].text.match(/资料：(.*)。只输出JSON/u)![1])
    active++; peak = Math.max(peak, active)
    const result = gate.then(() => { active--; return { stopReason: 'completed', output: [{ type: 'text',
      text: JSON.stringify({ items: requested.map((item: any) => ({ ...specification, usageId: item.brief.id })) }) }] } })
    return { id: `child-${requested[0].brief.id}`, dispose: f.dispose, result }
  })
  const work = f.service.resolve(parent, 'project', f.root, items, AbortSignal.timeout(5000))
  try { await vi.waitFor(() => expect(peak).toBe(5), { timeout: 1000, interval: 10 }) }
  finally { release(); await work }
  const result = await work
  expect(peak).toBe(5)
  expect(active).toBe(0)
  expect(result.size).toBe(48)
  expect(f.start).toHaveBeenCalledTimes(6)
  expect((await savedEntries(f.root)).every(row => row.status === 'completed')).toBe(true)
  await f.service.resolve(parent, 'project', f.root, items, AbortSignal.timeout(5000))
  expect(f.start).toHaveBeenCalledTimes(6)
})
it('settles a successful sibling and its receipts before returning an independent batch failure', async () => {
  const items = Array.from({ length: 16 }, (_, i) => ({ brief: { ...brief, id: `drain-${i}:main` }, context: { ...context, usageId: `drain-${i}:main` } }))
  const f = await fixture('unused')
  let release!: () => void, settled = false
  const gate = new Promise<void>(resolve => { release = resolve })
  f.start.mockImplementation(async (_provider: string, request: any) => {
    const requested = JSON.parse(request.prompt[0].text.match(/资料：(.*)。只输出JSON/u)![1])
    const result = requested[0].brief.id === 'drain-0:main' ? Promise.resolve({ stopReason: 'failed', output: [] })
      : gate.then(() => ({ stopReason: 'completed', output: [{ type: 'text', text: JSON.stringify({ items: requested.map((item: any) => ({ ...specification, usageId: item.brief.id })) }) }] }))
    return { id: `child-${requested[0].brief.id}`, dispose: f.dispose, result }
  })
  const work = f.service.resolve(parent, 'project', f.root, items, AbortSignal.timeout(5000)).then(() => { settled = true; return undefined }, error => { settled = true; return error })
  try {
    await vi.waitFor(() => expect(f.classes.finish).toHaveBeenCalledWith(expect.any(String), 'failed', 'SCENE_SPEC_FAILED: failed'), { timeout: 1000 })
    expect(settled).toBe(false)
    expect(f.start).toHaveBeenCalledTimes(2)
  } finally { release(); await work }
  expect((await work).message).toBe('SCENE_SPEC_FAILED: failed')
  expect((await savedEntries(f.root)).filter(row => row.status === 'completed').map(row => row.specification.usageId).sort())
    .toEqual(items.slice(8).map(item => item.brief.id).sort())
})
it('continues scene translation past a failed cached item and a failed batch, preserving usable later results', async () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ brief: { ...brief, id: `scene-${i}:main` }, context: { ...context, usageId: `scene-${i}:main` } }))
  const f = await fixture('unused')
  const prior = await legacyEntry(f, items[0]!, { status: 'failed', error: 'transport failed' })
  f.start.mockImplementation(async (_provider: string, request: any) => ({ id: 'child', dispose: f.dispose,
    result: Promise.resolve(request.prompt[0].text.includes('scene-9:main')
      ? { stopReason: 'completed', output: [{ type: 'text', text: JSON.stringify({ items: [{ ...specification, usageId: 'scene-9:main' }] }) }] }
      : { stopReason: 'failed', output: [] }) }))
  const failures = new Map<string, string>()
  const result = await f.service.resolve(parent, 'project', f.root, items, AbortSignal.timeout(5000), {
    onError: (id, error) => { failures.set(id, String(error)) },
  })
  expect([...result.keys()]).toEqual(['scene-9:main'])
  expect([...failures.keys()]).toEqual(items.slice(0, 9).map(item => item.brief.id))
  expect(await readFile(prior.path, 'utf8')).toBe(prior.content)
  expect((await savedEntries(f.root)).filter(row => row.status === 'completed')).toHaveLength(1)
})
async function savedEntries(root: string) {
  const directory = join(root, '.pre-design', 'scene-specifications')
  return Promise.all((await readdir(directory)).map(async name => JSON.parse(await readFile(join(directory, name), 'utf8'))))
}
async function legacyEntry(f: Awaited<ReturnType<typeof fixture>>, item: typeof pair[number], overrides: Record<string, unknown> = {}) {
  const directory = join(f.root, '.pre-design', 'scene-specifications')
  await mkdir(directory, { recursive: true })
  const key = createHash('sha256').update(JSON.stringify({ version: SCENE_SPEC_VERSION,
    ...(overrides.dispatchVersion ? { dispatchVersion: overrides.dispatchVersion } : {}), item })).digest('hex')
  const executionId = `legacy-${item.brief.id}`
  const record = { version: SCENE_SPEC_VERSION, key, status: 'completed', executionId, error: undefined as string | undefined,
    specification: { ...specification, usageId: item.brief.id }, attemptExecutionIds: [executionId], ...overrides }
  const path = join(directory, `${key}.json`), content = JSON.stringify(record, null, 2) + '\n'
  await writeFile(path, content)
  f.runs.set(executionId, { ...f.run, id: executionId, status: record.status, actual: route })
  return { record, path, content, executionId }
}
it.each([undefined, 'scene-spec-dispatch-2026-09-20.1'])('corrects only a newly rejected cached condition while preserving its original receipt and other valid cached scenes (%s)', async dispatchVersion => {
  const condition = '必要设施以减少地表扰动、避让茶树种植带为原则'
  const source = `林下步道与遮雨廊亭；${condition}`
  const item = { brief, context: { ...context, sources: context.sources.map(row => row.path === 'body[0]' ? { ...row, text: source } : row) } }
  const f = await fixture()
  const bad = await legacyEntry(f, item, { ...(dispatchVersion ? { dispatchVersion } : {}), specification: {
    ...specification, subjects: [...specification.subjects, { text: condition, sourcePath: 'body[0]' }],
  } })
  const good = await legacyEntry(f, pair[1]!)
  const result = await f.service.resolve(parent, 'project', f.root, [item, pair[1]!], AbortSignal.timeout(1000))
  expect(result.get(brief.id)?.subjects).toEqual(['林下步道与遮雨廊亭'])
  expect(result.get(brief.id)?.sceneGrounding?.sources).toEqual(expect.arrayContaining([{ path: 'body[0]', text: source }]))
  expect(result.get(secondBrief.id)?.subjects).toEqual(['林下步道与遮雨廊亭'])
  expect(f.start).toHaveBeenCalledTimes(1)
  expect(await readFile(bad.path, 'utf8')).toBe(bad.content)
  expect(await readFile(good.path, 'utf8')).toBe(good.content)
  expect(f.runs.get(bad.executionId)?.status).toBe('completed')
  const correction = (await savedEntries(f.root)).find(row => row.executionId === 'run')
  expect(correction.history).toEqual(expect.arrayContaining([expect.objectContaining({ key: bad.record.key, executionId: bad.executionId })]))
  await f.service.resolve(parent, 'project', f.root, [item, pair[1]!], AbortSignal.timeout(1000))
  expect(f.start).toHaveBeenCalledTimes(1)
})

it('does not automatically retry a failed correction of a formerly completed cached scene', async () => {
  const condition = '按合作协议分配可分配收益'
  const item = { brief, context: { ...context, sources: [...context.sources, { path: 'body[3]', text: condition }] } }
  const f = await fixture(JSON.stringify({ items: [specification] }), 'aborted')
  const original = await legacyEntry(f, item, { specification: { ...specification,
    activities: [{ text: condition, sourcePath: 'body[3]' }],
  } })
  await expect(f.service.resolve(parent, 'project', f.root, [item], AbortSignal.timeout(1000))).rejects.toThrow('SCENE_SPEC_FAILED')
  await expect(f.service.resolve(parent, 'project', f.root, [item], AbortSignal.timeout(1000))).rejects.toThrow('SCENE_SPEC_ATTEMPT_REQUIRES_ATTENTION')
  expect(f.start).toHaveBeenCalledTimes(1)
  expect(await readFile(original.path, 'utf8')).toBe(original.content)
  expect(f.runs.get(original.executionId)?.status).toBe('completed')
})

it('grounds an abstract photo demand in source text, preserves its identity and reuses only a completed native result', async () => {
  const f = await fixture(), input = [{ brief, context }], original = JSON.stringify(input)
  const result = await f.service.resolve(parent, 'project', f.root, input, AbortSignal.timeout(1000))
  expect(result.get(brief.id)).toMatchObject({ id: brief.id, pageId: brief.pageId, conclusion: brief.conclusion,
    subjects: ['林下步道与遮雨廊亭'], activities: ['步行休憩'], environment: '城市公园', allowedKinds: ['photo','render'] })
  expect(JSON.stringify(input)).toBe(original)
  expect(f.classes.begin).toHaveBeenCalledWith('project', 'text', expect.any(String), parent, expect.any(AbortSignal))
  const request = f.start.mock.calls[0]![1]
  expect(resolveChildAgentOptions(parent, request.agentOptions, 1).maxTokens).toBeUndefined()
  expect(JSON.stringify(request.prompt)).toContain('林下步道与遮雨廊亭')
  expect(request.toolFilter).toEqual({ allow: [] })
  expect(await f.service.resolve(parent, 'project', f.root, input, AbortSignal.timeout(1000))).toEqual(result)
  expect(f.start).toHaveBeenCalledOnce()
  f.run.status = 'failed'
  await expect(f.service.resolve(parent, 'project', f.root, input, AbortSignal.timeout(1000))).rejects.toThrow('SCENE_SPEC_CACHE_UNVERIFIED')
  expect(f.start).toHaveBeenCalledOnce()
})
it('keeps a concrete physical demand unchanged without a paid planning call', async () => {
  const f = await fixture(), concrete = { ...brief, subjects: ['林下步道与遮雨廊亭'], activities: ['步行休憩'], environment: '城市公园' }
  expect((await f.service.resolve(parent, 'project', f.root, [{ brief: concrete, context }], AbortSignal.timeout(1000))).get(brief.id)).toEqual(concrete)
  expect(f.start).not.toHaveBeenCalled(); expect(f.classes.begin).not.toHaveBeenCalled()
})
it('uses the original visual intent when an apparently concrete main slot belongs to a relationship diagram', async () => {
  const f = await fixture(), concrete = { ...brief, subjects: ['林下步道与遮雨廊亭'], activities: ['步行休憩'], environment: '城市公园' }
  const diagramContext = { ...context, sources: [...context.sources, { path: 'visual.caption', text: '实施关系示意：游线与服务同步就绪' }] }
  const result = await f.service.resolve(parent, 'project', f.root, [{ brief: concrete, context: diagramContext }], AbortSignal.timeout(1000))
  expect(f.start).toHaveBeenCalledOnce()
  expect(result.get(brief.id)?.sceneGrounding?.sources).toContainEqual(context.sources[0])
  await f.service.resolve(parent, 'project', f.root, [{ brief: concrete, context: diagramContext }], AbortSignal.timeout(1000))
  expect(f.start).toHaveBeenCalledOnce()
})
it('rejects an abstract demand with no manuscript context before spending a task', async () => {
  const f = await fixture()
  await expect(f.service.resolve(parent, 'project', f.root, [{ brief }], AbortSignal.timeout(1000))).rejects.toThrow('SCENE_SPEC_CONTEXT_REQUIRED')
  expect(f.classes.begin).not.toHaveBeenCalled()
})
it.each(['invented-source', 'max-tokens'] as const)('preserves the failed %s attempts and never returns the old abstract brief as fallback', async failure => {
  const f = await fixture(JSON.stringify({ items: [{ ...specification, ...(failure === 'invented-source' ? { environment: { text: '海外度假村', sourcePath: 'body[1]' } } : {}) }] }), failure === 'max-tokens' ? 'max-tokens' : 'completed')
  await expect(f.service.resolve(parent, 'project', f.root, [{ brief, context }], AbortSignal.timeout(1000))).rejects.toThrow(/SCENE_SPEC/u)
  const entries = await readdir(join(f.root,'.pre-design','scene-specifications'))
  const saved = JSON.parse(await readFile(join(f.root,'.pre-design','scene-specifications',entries[0]!), 'utf8'))
  const attempts = failure === 'max-tokens' ? 1 : 3
  expect(saved).toMatchObject({ status: 'failed', executionId: attempts === 1 ? 'run' : 'run-3' })
  await expect(f.service.resolve(parent, 'project', f.root, [{ brief, context }], AbortSignal.timeout(1000))).rejects.toThrow('SCENE_SPEC_ATTEMPT_REQUIRES_ATTENTION')
  expect(f.start).toHaveBeenCalledTimes(attempts); expect(f.dispose).toHaveBeenCalledTimes(attempts)
  expect([...f.runs.values()].every(run => run.status === 'failed')).toBe(true)
})
it('invalidates derived scene requirements when their supporting source text changes', async () => {
  const f = await fixture()
  await f.service.resolve(parent, 'project', f.root, [{ brief, context }], AbortSignal.timeout(1000))
  const changed = { ...context, sources: [...context.sources, { path: 'body[3]', text: '新增日间开放条件' }] }
  await f.service.resolve(parent, 'project', f.root, [{ brief, context: changed }], AbortSignal.timeout(1000))
  expect(f.start).toHaveBeenCalledTimes(2)
})

it('corrects a normally completed empty scene using safe field feedback and caches only the verified corrected execution', async () => {
  const invalid = { ...specification, subjects: [], environment: { text: '', sourcePath: '' }, privatePayload: 'do-not-echo-provider-secret' }
  const f = await fixture([JSON.stringify({items:[invalid]}), JSON.stringify({items:[specification]})])
  const result = await f.service.resolve(parent, 'project', f.root, [{brief,context}], AbortSignal.timeout(1000))
  expect(result.get(brief.id)?.subjects).toEqual(['林下步道与遮雨廊亭'])
  expect([...f.runs.values()].map(run => run.status)).toEqual(['failed','completed'])
  const correction = JSON.stringify(f.start.mock.calls[1]![1].prompt)
  expect(correction).toContain('subjects'); expect(correction).toContain(brief.id)
  expect(correction).not.toContain('do-not-echo-provider-secret')
  expect(JSON.stringify(f.start.mock.calls[0]![1].prompt)).toContain('当前节点')
  const [filename] = await readdir(join(f.root,'.pre-design','scene-specifications'))
  expect(JSON.parse(await readFile(join(f.root,'.pre-design','scene-specifications',filename!), 'utf8'))).toMatchObject({status:'completed',executionId:'run-2'})
  await f.service.resolve(parent, 'project', f.root, [{brief,context}], AbortSignal.timeout(1000))
  expect(f.start).toHaveBeenCalledTimes(2)
})

it('reserves a fresh authorization task for a correction and stops before dispatch when the budget is exhausted', async () => {
  const f = await fixture(JSON.stringify({items:[{...specification,subjects:[]}]}))
  f.classes.begin.mockImplementationOnce(async () => f.run).mockRejectedValueOnce(new Error('PREPLANNING_MODEL_TURN_LIMIT: exhausted'))
  await expect(f.service.resolve(parent,'project',f.root,[{brief,context}],AbortSignal.timeout(1000))).rejects.toThrow('PREPLANNING_MODEL_TURN_LIMIT')
  expect(f.start).toHaveBeenCalledOnce()
  expect(f.run.status).toBe('failed')
  const [filename] = await readdir(join(f.root,'.pre-design','scene-specifications'))
  const stopped = await readFile(join(f.root,'.pre-design','scene-specifications',filename!), 'utf8')
  expect(JSON.parse(stopped)).toMatchObject({status:'not-started',attemptExecutionIds:['run']})
  await expect(f.service.resolve(parent,'project',f.root,[{brief,context}],AbortSignal.timeout(1000))).rejects.toThrow('SCENE_SPEC_ATTEMPT_REQUIRES_ATTENTION')
  expect(f.start).toHaveBeenCalledOnce()
  expect(await readFile(join(f.root,'.pre-design','scene-specifications',filename!), 'utf8')).toBe(stopped)
})

it('does not dispatch a correction after cancellation or a transport failure', async () => {
  const f = await fixture(JSON.stringify({items:[{...specification,subjects:[]}]})), controller = new AbortController()
  f.classes.finish.mockImplementation(async (id: string, status: string) => { f.runs.get(id)!.status = status; controller.abort() })
  await expect(f.service.resolve(parent,'project',f.root,[{brief,context}],controller.signal)).rejects.toThrow()
  expect(f.start).toHaveBeenCalledOnce()
  const g = await fixture()
  g.start.mockRejectedValueOnce(new Error('transport unavailable'))
  await expect(g.service.resolve(parent,'project',g.root,[{brief,context}],AbortSignal.timeout(1000))).rejects.toThrow('transport unavailable')
  expect(g.start).toHaveBeenCalledOnce()
})

it('corrects only failed items and preserves each accepted item with its original native execution', async () => {
  const f = await fixture([
    JSON.stringify({ items: [specification, { ...secondSpecification, subjects: [] }] }),
    JSON.stringify({ items: [secondSpecification] }),
  ])
  const result = await f.service.resolve(parent, 'project', f.root, pair, AbortSignal.timeout(1000))
  expect([...result.values()].map(value => value.subjects)).toEqual([['林下步道与遮雨廊亭'], ['林下步道与遮雨廊亭']])
  expect(f.start).toHaveBeenCalledTimes(2)
  const correction = JSON.stringify(f.start.mock.calls[1]![1].prompt)
  expect(correction).toContain(secondBrief.id)
  expect(correction).not.toContain(brief.id)
  expect([...f.runs.values()].map(value => value.status)).toEqual(['completed', 'completed'])
  const saved = await savedEntries(f.root)
  expect(saved.find(value => value.specification?.usageId === brief.id)).toMatchObject({
    status: 'completed', executionId: 'run', attemptExecutionIds: ['run'],
  })
  expect(saved.find(value => value.specification?.usageId === secondBrief.id)).toMatchObject({
    status: 'completed', executionId: 'run-2', attemptExecutionIds: ['run', 'run-2'],
    history: [expect.objectContaining({ executionId: 'run', status: 'failed', error: expect.stringContaining('subjects') }),
      expect.objectContaining({ executionId: 'run-2', status: 'completed' })],
  })
  expect(await f.service.resolve(parent, 'project', f.root, pair, AbortSignal.timeout(1000))).toEqual(result)
  expect(f.start).toHaveBeenCalledTimes(2)
})

it('keeps accepted items after later corrections fail and never implicitly retries the exhausted dispatch', async () => {
  const f = await fixture([
    JSON.stringify({ items: [specification, { ...secondSpecification, subjects: [] }] }),
    JSON.stringify({ items: [{ ...secondSpecification, subjects: [] }] }),
  ])
  await expect(f.service.resolve(parent, 'project', f.root, pair, AbortSignal.timeout(1000))).rejects.toThrow('SCENE_SPEC_OUTPUT_INVALID')
  expect(f.start).toHaveBeenCalledTimes(3)
  expect([...f.runs.values()].map(value => value.status)).toEqual(['completed', 'failed', 'failed'])
  const saved = await savedEntries(f.root)
  const accepted = saved.find(value => value.status === 'completed')
  expect(accepted).toMatchObject({ executionId: 'run', attemptExecutionIds: ['run'], specification })
  const rejected = saved.find(value => value.status === 'failed')
  expect(rejected).toMatchObject({ executionId: 'run-3', attemptExecutionIds: ['run', 'run-2', 'run-3'],
    history: ['run', 'run-2', 'run-3'].map(executionId => expect.objectContaining({ executionId, status: 'failed', error: expect.stringContaining('subjects') })) })
  for (const call of f.start.mock.calls.slice(1)) expect(JSON.stringify(call[1].prompt)).not.toContain(brief.id)
  await expect(f.service.resolve(parent, 'project', f.root, pair, AbortSignal.timeout(1000))).rejects.toThrow('SCENE_SPEC_ATTEMPT_REQUIRES_ATTENTION')
  expect((await f.service.resolve(parent, 'project', f.root, [pair[0]!], AbortSignal.timeout(1000))).get(brief.id)?.subjects).toEqual(['林下步道与遮雨廊亭'])
  expect(await savedEntries(f.root)).toEqual(saved)
  expect(f.start).toHaveBeenCalledTimes(3)
})

it('does not cache partially valid output when the native execution identity cannot be verified', async () => {
  const f = await fixture(JSON.stringify({ items: [specification, { ...secondSpecification, subjects: [] }] }))
  f.classes.finish.mockImplementation(async (id: string, status: string) => { f.runs.get(id)!.status = status })
  await expect(f.service.resolve(parent, 'project', f.root, pair, AbortSignal.timeout(1000))).rejects.toThrow('SCENE_SPEC_MODEL_UNVERIFIED')
  expect(f.start).toHaveBeenCalledOnce()
  expect((await savedEntries(f.root)).every(value => value.status === 'failed')).toBe(true)
})

it('preserves accepted items when a correction has no remaining authorization budget', async () => {
  const f = await fixture(JSON.stringify({ items: [specification, { ...secondSpecification, subjects: [] }] }))
  f.classes.begin.mockImplementationOnce(async () => f.run).mockRejectedValueOnce(new Error('PREPLANNING_MODEL_TURN_LIMIT: exhausted'))
  await expect(f.service.resolve(parent, 'project', f.root, pair, AbortSignal.timeout(1000))).rejects.toThrow('PREPLANNING_MODEL_TURN_LIMIT')
  expect(f.start).toHaveBeenCalledOnce()
  expect(f.run.status).toBe('completed')
  const saved = await savedEntries(f.root)
  expect(saved.find(value => value.status === 'completed')).toMatchObject({ executionId: 'run', specification })
  expect(saved.find(value => value.status === 'not-started')).toMatchObject({ attemptExecutionIds: ['run'],
    history: [expect.objectContaining({ executionId: 'run', status: 'failed' }),
      expect.objectContaining({ status: 'not-started', error: expect.stringContaining('PREPLANNING_MODEL_TURN_LIMIT') })] })
  await expect(f.service.resolve(parent, 'project', f.root, pair, AbortSignal.timeout(1000))).rejects.toThrow('SCENE_SPEC_ATTEMPT_REQUIRES_ATTENTION')
  expect(f.classes.begin).toHaveBeenCalledTimes(2)
})

it('preserves accepted items when the remaining correction is cancelled', async () => {
  const f = await fixture(JSON.stringify({ items: [specification, { ...secondSpecification, subjects: [] }] }))
  const controller = new AbortController(), start = f.start.getMockImplementation()!
  f.start.mockImplementationOnce(start).mockImplementationOnce(async (...args) => {
    controller.abort(new Error('fixture cancellation'))
    return start(...args)
  })
  await expect(f.service.resolve(parent, 'project', f.root, pair, controller.signal)).rejects.toThrow('fixture cancellation')
  expect(f.start).toHaveBeenCalledTimes(2)
  expect([...f.runs.values()].map(value => value.status)).toEqual(['completed', 'cancelled'])
  const saved = await savedEntries(f.root)
  expect(saved.find(value => value.status === 'completed')).toMatchObject({ executionId: 'run', specification })
  expect(saved.find(value => value.status === 'cancelled')).toMatchObject({ executionId: 'run-2', attemptExecutionIds: ['run', 'run-2'] })
  await expect(f.service.resolve(parent, 'project', f.root, pair, AbortSignal.timeout(1000))).rejects.toThrow('SCENE_SPEC_ATTEMPT_REQUIRES_ATTENTION')
  expect(f.start).toHaveBeenCalledTimes(2)
})

it('reuses 143 verified legacy completions without rewriting them and preserves old and new failure histories', async () => {
  const f = await fixture(JSON.stringify({ items: [{ ...specification, subjects: [] }] }))
  const inputs = Array.from({ length: 143 }, (_, index) => ({ brief: { ...brief, id: `cached-${index}:main` }, context: { ...context, usageId: `cached-${index}:main` } }))
  const old = await Promise.all(inputs.map(item => legacyEntry(f, item)))
  const reused = await f.service.resolve(parent, 'project', f.root, inputs, AbortSignal.timeout(5000))
  expect(reused.size).toBe(143)
  expect([...reused.values()].every(value => value.subjects[0] === '林下步道与遮雨廊亭')).toBe(true)
  expect(f.start).not.toHaveBeenCalled()
  const failed = await legacyEntry(f, pair[0]!, { status: 'failed', specification: undefined, error: 'SCENE_SPEC_OUTPUT_INVALID: subjects: missing' })
  await expect(f.service.resolve(parent, 'project', f.root, [...inputs, pair[0]!], AbortSignal.timeout(5000))).rejects.toThrow('SCENE_SPEC_OUTPUT_INVALID')
  expect(f.start).toHaveBeenCalledTimes(3)
  expect(f.runs.get(failed.executionId)?.status).toBe('failed')
  expect(f.classes.finish.mock.calls.some(call => call[0] === failed.executionId)).toBe(false)
  for (const entry of [...old, failed]) expect(await readFile(entry.path, 'utf8')).toBe(entry.content)
  const saved = await savedEntries(f.root), fresh = saved.find(value => value.dispatchVersion)
  expect(saved).toHaveLength(145)
  expect(fresh).toMatchObject({ version: SCENE_SPEC_VERSION, status: 'failed',
    attemptExecutionIds: [failed.executionId, 'run', 'run-2', 'run-3'],
    history: [expect.objectContaining({ key: failed.record.key, executionId: failed.executionId, status: 'failed', error: failed.record.error }),
      ...['run', 'run-2', 'run-3'].map(executionId => expect.objectContaining({ executionId, status: 'failed' }))] })
  expect(fresh.key).not.toBe(failed.record.key)
  await expect(f.service.resolve(parent, 'project', f.root, [...inputs, pair[0]!], AbortSignal.timeout(5000))).rejects.toThrow('SCENE_SPEC_ATTEMPT_REQUIRES_ATTENTION')
  expect(f.start).toHaveBeenCalledTimes(3)
})

it.each(['SCENE_SPEC_OUTPUT_INVALID', 'SCENE_SPEC_USAGE_MISMATCH'])('migrates the known legacy business failure %s without changing its execution', async error => {
  const f = await fixture()
  const legacy = await legacyEntry(f, pair[0]!, { status: 'failed', specification: undefined, error })
  // Legacy schema failures themselves prove native completion; the old class
  // receipt may predate persistence of childStopReason.
  f.runs.get(legacy.executionId)!.childStopReason = undefined
  expect((await f.service.resolve(parent, 'project', f.root, [pair[0]!], AbortSignal.timeout(1000))).get(brief.id)?.subjects).toEqual(['林下步道与遮雨廊亭'])
  expect(f.start).toHaveBeenCalledOnce()
  expect(f.runs.get(legacy.executionId)?.status).toBe('failed')
  expect(await readFile(legacy.path, 'utf8')).toBe(legacy.content)
  const fresh = (await savedEntries(f.root)).find(value => value.dispatchVersion)
  expect(fresh).toMatchObject({ status: 'completed', executionId: 'run', attemptExecutionIds: [legacy.executionId, 'run'],
    history: [expect.objectContaining({ key: legacy.record.key, executionId: legacy.executionId, status: 'failed', error }),
      expect.objectContaining({ executionId: 'run', status: 'completed' })] })
})

it.each([
  ['starting', 'starting', 'SCENE_SPEC_OUTPUT_INVALID', true],
  ['cancelled', 'cancelled', 'SCENE_SPEC_OUTPUT_INVALID', true],
  ['failed', 'failed', 'SCENE_SPEC_FAILED: max-tokens', true],
  ['failed', 'failed', 'transport unavailable', true],
  ['failed', 'failed', 'SCENE_SPEC_MODEL_UNVERIFIED', true],
  ['failed', 'failed', 'SCENE_SPEC_OUTPUT_INVALID', false],
  ['failed', 'starting', 'SCENE_SPEC_OUTPUT_INVALID', true],
  ['failed', 'cancelled', 'SCENE_SPEC_OUTPUT_INVALID', true],
  ['failed', 'recovery_required', 'SCENE_SPEC_OUTPUT_INVALID', true],
] as const)('does not migrate ambiguous legacy state %s/%s/%s/actual=%s', async (status, executionStatus, error, actual) => {
  const f = await fixture()
  const legacy = await legacyEntry(f, pair[0]!, { status, specification: undefined, error })
  Object.assign(f.runs.get(legacy.executionId)!, { status: executionStatus, actual: actual ? route : undefined })
  await expect(f.service.resolve(parent, 'project', f.root, [pair[0]!], AbortSignal.timeout(1000))).rejects.toThrow('SCENE_SPEC_ATTEMPT_REQUIRES_ATTENTION')
  expect(f.classes.begin).not.toHaveBeenCalled()
  expect(await readFile(legacy.path, 'utf8')).toBe(legacy.content)
  expect(await savedEntries(f.root)).toHaveLength(1)
})

it('rejects a legacy completed receipt whose specification no longer validates without redispatching', async () => {
  const f = await fixture(), legacy = await legacyEntry(f, pair[0]!, { specification: { ...specification, subjects: [] } })
  await expect(f.service.resolve(parent, 'project', f.root, [pair[0]!], AbortSignal.timeout(1000))).rejects.toThrow('SCENE_SPEC_')
  expect(f.start).not.toHaveBeenCalled()
  expect(await readFile(legacy.path, 'utf8')).toBe(legacy.content)
})

it.each([null, false, 0])('treats a persisted %s dispatch receipt as unknown rather than absent', async corrupted => {
  const f = await fixture()
  await f.service.resolve(parent, 'project', f.root, [pair[0]!], AbortSignal.timeout(1000))
  const [saved] = await savedEntries(f.root)
  const path = join(f.root, '.pre-design', 'scene-specifications', `${saved.key}.json`)
  await writeFile(path, JSON.stringify(corrupted))
  await expect(f.service.resolve(parent, 'project', f.root, [pair[0]!], AbortSignal.timeout(1000))).rejects.toThrow('SCENE_SPEC_CACHE_UNVERIFIED')
  expect(f.start).toHaveBeenCalledOnce()
  expect(await readFile(path, 'utf8')).toBe(JSON.stringify(corrupted))
})

it('does not treat a not-started legacy receipt with an execution identity as an unused reservation', async () => {
  const f = await fixture(), legacy = await legacyEntry(f, pair[0]!, { status: 'not-started', attemptExecutionIds: [], specification: undefined })
  await expect(f.service.resolve(parent, 'project', f.root, [pair[0]!], AbortSignal.timeout(1000))).rejects.toThrow('SCENE_SPEC_ATTEMPT_REQUIRES_ATTENTION')
  expect(f.start).not.toHaveBeenCalled()
  expect(await readFile(legacy.path, 'utf8')).toBe(legacy.content)
})

it('allows a budget refusal before any execution to be attempted under a later authorization', async () => {
  const f = await fixture()
  f.classes.begin.mockRejectedValueOnce(new Error('PREPLANNING_MODEL_TURN_LIMIT: exhausted'))
  await expect(f.service.resolve(parent, 'project', f.root, [pair[0]!], AbortSignal.timeout(1000))).rejects.toThrow('PREPLANNING_MODEL_TURN_LIMIT')
  expect(f.start).not.toHaveBeenCalled()
  expect((await f.service.resolve(parent, 'project', f.root, [pair[0]!], AbortSignal.timeout(1000))).get(brief.id)?.subjects).toEqual(['林下步道与遮雨廊亭'])
  expect(f.start).toHaveBeenCalledOnce()
})
