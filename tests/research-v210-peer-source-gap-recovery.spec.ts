import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createModuleResearchCommands } from '../src/research-v2/module-command.ts'
import * as execution from '../src/research-v2/module-execution.ts'
import * as acquisition from '../src/research-v2/module-web-acquisition.ts'
import { captureMaterialCorpus, materialCorpusFingerprint } from '../src/materials/research-evidence.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'

const roots: string[] = []
const checkpoint = 'RUN-11111111-1111-1111-1111-111111111111'
const review = { executionId: 'native-review', childId: 'native-review-child', stopReason: 'completed', verdict: 'limited',
  actualModel: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'xhigh' },
  checks: [{ criterion: '抽查图上一格能找到具体商户/产品原始页面或记录。', status: 'limited', rationale: '两张图缺失，缺产品原始页面。', claimRefs: [] }],
  limitations: ['缺同规格价格、人数、适用日和权益。'], candidateHash: 'a'.repeat(64) }
const peerReview = { ...review, executionId: 'peer-native-review', childId: 'peer-native-review-child',
  checks: [{ criterion: '地图搜索上限命中时应提示覆盖可能不全，不继续声称全量。', status: 'limited',
    rationale: '已取得三条网页查询，但地图范围、翻页、服务返回上限及停止依据不可核。', claimRefs: [] }],
  limitations: ['客群边界、主体消歧、经营日期及冻结样本未核。'], authorGroupsHash: 'b'.repeat(64) }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function commandFixture(complete = false, prepare = true, itemId = '3.05') {
  const root = await mkdtemp(join(tmpdir(), 'peer-source-recovery-')); roots.push(root)
  await writeFile(join(root, 'project.json'), JSON.stringify({ projectId: 'standard-test' }))
  await mkdir(join(root, '原始资料')); await writeFile(join(root, '原始资料/brief.txt'), '项目位于湖北省武汉市新洲区少潭河水库。')
  const original = await captureMaterialCorpus(root)
  const queries = complete ? acquisition.moduleWebQueries([itemId]) : acquisition.moduleWebQueries(['3.04'])
  const priorContent = { ...original, acquisition: { version: 'module-web-acquisition.v1' as const, originalFingerprint: original.fingerprint,
    bundles: [], queries: queries.map(q => ({ key: q.key, moduleId: q.moduleId, queryIndex: q.queryIndex, status: 'searched-empty' as const, sourcePaths: [] })) } }
  const prior = { ...priorContent, fingerprint: materialCorpusFingerprint(priorContent) }
  await mkdir(join(root, 'research/runs', checkpoint), { recursive: true })
  const snapshotPath = join(root, 'research/runs', checkpoint, 'snapshot.json'), snapshot = JSON.stringify({ corpus: prior })
  await writeFile(snapshotPath, snapshot)
  vi.spyOn(acquisition, 'replayModuleWebCorpus').mockImplementation(async (_root, corpus) => corpus)
  vi.spyOn(execution, 'readModuleExecutionSummary').mockResolvedValue({ projectId: 'p1', selectedModuleIds: [itemId],
    results: [{ itemId, execution: { reviewReceipts: [itemId === '3.04' ? peerReview : review] } }] } as never)
  const nextContent = { ...prior, limitations: itemId === '3.04' ? [...prior.limitations, '新的原生检索记录仍须独立审查。'] : prior.limitations,
    acquisition: { ...prior.acquisition,
    queries: acquisition.moduleWebQueries([itemId]).map(q => ({ key: q.key, moduleId: q.moduleId, queryIndex: q.queryIndex, status: 'searched-empty' as const, sourcePaths: [] })) } }
  const next = { ...nextContent, fingerprint: materialCorpusFingerprint(nextContent) }
  const prepareSources = vi.fn(async (_parent: unknown, _request: unknown) => next), execute = vi.fn(async (_parent: unknown, _request: unknown) => ({ status: 'partial', moduleRuns: [], results: [] }))
  const service = createModuleResearchCommands({ readContext: () => ({ project: { projectId: 'p1', currentRevision: 0 } }),
    resolveBinding: () => ({ root, standardProjectId: 'standard-test' }), now: () => new Date(),
    ...(prepare ? { prepareSources } : {}), runtime: { execute } } as never)
  const invocation = { agent: { id: 'session', session: { header: { cwd: root } } }, rawInput: `--all-modules --item=${itemId} --resume=${checkpoint}` }
  return { root, service, invocation, prior, next, prepareSources, execute, snapshot, snapshotPath }
}
describe('peer module resume with absent public product queries', () => {
  it('acquires a new snapshot and retains explicit checkpoint identities for verified per-module reuse', async () => {
    const f = await commandFixture()
    expect((await f.service.commands[0].handler(f.invocation as never)).kind).toBe('success')
    await f.service.whenIdle('p1')
    expect(f.prepareSources).toHaveBeenCalledOnce()
    expect(f.prepareSources.mock.calls[0]?.[1]).toMatchObject({ sourceRecovery: { checkpoint, moduleId: '3.05',
      queryKeys: ['3.05:0', '3.05:1', '3.05:2'], review } })
    const request = f.execute.mock.calls[0]?.[1] as any
    expect(request.corpus).toEqual(f.next)
    expect(request).toMatchObject({resumeRunIds:[checkpoint],allowInputReuse:true})
    expect(request.taskBrief).not.toContain(review.executionId)
    expect(request.taskBrief).not.toContain(review.checks[0].rationale)
    expect(request.taskBrief).not.toContain(review.limitations[0])
    expect(request.taskBrief).not.toContain('sourceRecovery')
    expect(await readFile(f.snapshotPath, 'utf8')).toBe(f.snapshot)
  })
  it('preserves ordinary same-snapshot resume when all three product queries exist', async () => {
    const f = await commandFixture(true)
    await f.service.commands[0].handler(f.invocation as never); await f.service.whenIdle('p1')
    expect(f.prepareSources).not.toHaveBeenCalled()
    expect(f.execute.mock.calls[0]?.[1]).toMatchObject({ resumeRunIds: [checkpoint], corpus: f.prior })
  })
  it('preserves the frozen source-recovery brief and snapshot identity on a later partial resume', async () => {
    const f = await commandFixture(true)
    const taskBrief = '原生补采后冻结的任务背景\n' + JSON.stringify({ sourceRecovery: { checkpoint, review } })
    const snapshot = JSON.stringify({ corpus: f.prior, taskBrief })
    await writeFile(f.snapshotPath, snapshot)
    await f.service.commands[0].handler(f.invocation as never); await f.service.whenIdle('p1')
    const request = f.execute.mock.calls[0]?.[1] as any
    expect(f.prepareSources).not.toHaveBeenCalled()
    expect(request.taskBrief).toBe(taskBrief)
    expect(request.resumeRunIds).toEqual([checkpoint])
    expect(request.snapshotId).toBe('snapshot-' + sha256CanonicalJson({
      context: { projectId: 'p1', root: request.workspaceRoot, standardProjectId: 'standard-test' },
      fingerprint: f.prior.fingerprint, flags: request.flags, taskBrief,
    }))
    expect(await readFile(f.snapshotPath, 'utf8')).toBe(snapshot)
  })
  it('does not call a model when the acquisition integration is unavailable', async () => {
    const f = await commandFixture(false, false)
    await f.service.commands[0].handler(f.invocation as never); await f.service.whenIdle('p1')
    expect(f.execute).not.toHaveBeenCalled()
    expect((await f.service.commands[1].handler(f.invocation as never)).text).toContain('MODULE_WEB_RECOVERY_UNAVAILABLE')
  })
  it('rejects unchanged incomplete acquisition before starting another empty author revision', async () => {
    const f = await commandFixture()
    f.prepareSources.mockResolvedValue(f.prior as never)
    await f.service.commands[0].handler(f.invocation as never); await f.service.whenIdle('p1')
    expect(f.execute).not.toHaveBeenCalled()
    expect((await f.service.commands[1].handler(f.invocation as never)).text).toContain('MODULE_WEB_INCOMPLETE')
  })
  it('also repairs an original-only checkpoint instead of running with no acquisition record', async () => {
    const f = await commandFixture()
    const content = { documents: f.prior.documents, limitations: f.prior.limitations }
    await writeFile(f.snapshotPath, JSON.stringify({ corpus: { ...content, fingerprint: materialCorpusFingerprint(content) } }))
    await f.service.commands[0].handler(f.invocation as never); await f.service.whenIdle('p1')
    expect(f.prepareSources.mock.calls[0]?.[1]).toMatchObject({ sourceRecovery: { queryKeys: ['3.05:0', '3.05:1', '3.05:2'] } })
    expect(f.execute.mock.calls[0]?.[1]).toMatchObject({resumeRunIds:[checkpoint],allowInputReuse:true})
  })
  it('reacquires a failed declared query without mislabeling the other two query records missing', async () => {
    const f = await commandFixture(true)
    const content = { ...f.prior, acquisition: { ...f.prior.acquisition,
      queries: f.prior.acquisition.queries.map((q, index) => index === 1 ? { ...q, status: 'failed' as const, error: 'MODULE_WEB_HTTP_503' } : q) } }
    await writeFile(f.snapshotPath, JSON.stringify({ corpus: { ...content, fingerprint: materialCorpusFingerprint(content) } }))
    await f.service.commands[0].handler(f.invocation as never); await f.service.whenIdle('p1')
    expect(f.prepareSources.mock.calls[0]?.[1]).toMatchObject({ sourceRecovery: { queryKeys: ['3.05:1'] } })
    expect(f.execute.mock.calls[0]?.[1]).toMatchObject({resumeRunIds:[checkpoint],allowInputReuse:true})
  })
  it('rejects another project checkpoint before any discovery or author call', async () => {
    const f = await commandFixture()
    vi.mocked(execution.readModuleExecutionSummary).mockResolvedValue({ projectId: 'other-project', results: [] } as never)
    await f.service.commands[0].handler(f.invocation as never); await f.service.whenIdle('p1')
    expect(f.prepareSources).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
    expect((await f.service.commands[1].handler(f.invocation as never)).text).toContain('MODULE_CHECKPOINT_PROJECT_MISMATCH')
  })
})

describe('explicit peer resume after an independent limited source review', () => {
  it('reacquires only the map query with the exact latest review and permits proof-bound reuse', async () => {
    const f = await commandFixture(true, true, '3.04')
    await f.service.commands[0].handler(f.invocation as never); await f.service.whenIdle('p1')
    expect(f.prepareSources.mock.calls[0]?.[1]).toMatchObject({ moduleIds: expect.arrayContaining(['1.01', '3.01', '3.04']),
      sourceRecovery: { checkpoint, moduleId: '3.04', queryKeys: ['3.04:2'], reason: 'independent-review-source-gaps', review: peerReview } })
    const request = f.execute.mock.calls[0]?.[1] as any
    expect(request.corpus).toEqual(f.next)
    expect(request).toMatchObject({resumeRunIds:[checkpoint],allowInputReuse:true})
    expect(request.taskBrief).not.toContain(JSON.stringify(peerReview))
    expect(request.taskBrief).not.toContain('sourceRecovery')
    expect(request.corpus.fingerprint).not.toBe(f.prior.fingerprint)
    expect(await readFile(f.snapshotPath, 'utf8')).toBe(f.snapshot)
  })
  it.each(['pass', 'absent'])('keeps ordinary frozen resume when the latest final review is %s', async verdict => {
    const f = await commandFixture(true, true, '3.04'), taskBrief = '原快照绑定的研究任务背景'
    await writeFile(f.snapshotPath, JSON.stringify({ corpus: f.prior, taskBrief }))
    vi.mocked(execution.readModuleExecutionSummary).mockResolvedValue({ projectId: 'p1', results: verdict === 'absent' ? [] : [
      { itemId: '3.04', execution: { reviewReceipts: [{ ...peerReview, verdict,
        checks: peerReview.checks.map(check => ({ ...check, status: 'pass' })), limitations: [] }] } }] } as never)
    await f.service.commands[0].handler(f.invocation as never); await f.service.whenIdle('p1')
    expect(f.prepareSources).not.toHaveBeenCalled()
    expect(f.execute.mock.calls[0]?.[1]).toMatchObject({ resumeRunIds: [checkpoint], corpus: f.prior, taskBrief })
  })
  it('cannot start authors when limited-review acquisition is unavailable', async () => {
    const f = await commandFixture(true, false, '3.04')
    await f.service.commands[0].handler(f.invocation as never); await f.service.whenIdle('p1')
    expect(f.execute).not.toHaveBeenCalled()
    expect((await f.service.commands[1].handler(f.invocation as never)).text).toContain('MODULE_WEB_RECOVERY_UNAVAILABLE')
  })
  it('also reads the exact final review from a validated module-bundle checkpoint', async () => {
    const f = await commandFixture(true, true, '3.04')
    vi.mocked(execution.readModuleExecutionSummary).mockRejectedValue(new Error('MODULE_RUN_MANIFEST_EXPECTED'))
    vi.spyOn(execution, 'readModuleExecutionResult').mockResolvedValue({ projectId: 'p1', itemId: '3.04',
      execution: { reviewReceipts: [peerReview] } } as never)
    await f.service.commands[0].handler(f.invocation as never); await f.service.whenIdle('p1')
    expect(f.prepareSources.mock.calls[0]?.[1]).toMatchObject({ sourceRecovery: { moduleId: '3.04', review: peerReview } })
    expect(f.execute.mock.calls[0]?.[1]).toMatchObject({resumeRunIds:[checkpoint],allowInputReuse:true})
  })
  it('rejects a complete but unchanged corpus instead of repeating the same empty author cycle', async () => {
    const f = await commandFixture(true, true, '3.04'); f.prepareSources.mockResolvedValue(f.prior as never)
    await f.service.commands[0].handler(f.invocation as never); await f.service.whenIdle('p1')
    expect(f.execute).not.toHaveBeenCalled()
    expect((await f.service.commands[1].handler(f.invocation as never)).text).toContain('MODULE_WEB_RECOVERY_UNCHANGED')
  })
  it('rejects missing recovered queries before starting authors', async () => {
    const f = await commandFixture(true, true, '3.04'), content = { ...f.next,
      acquisition: { ...f.next.acquisition, queries: f.next.acquisition.queries.slice(0, 2) } }
    f.prepareSources.mockResolvedValue({ ...content, fingerprint: materialCorpusFingerprint(content) } as never)
    await f.service.commands[0].handler(f.invocation as never); await f.service.whenIdle('p1')
    expect(f.execute).not.toHaveBeenCalled()
    expect((await f.service.commands[1].handler(f.invocation as never)).text).toContain('MODULE_WEB_INCOMPLETE: 3.04:2')
  })
  it('rejects another project before public recovery discovery', async () => {
    const f = await commandFixture(true, true, '3.04')
    vi.mocked(execution.readModuleExecutionSummary).mockResolvedValue({ projectId: 'other-project', results: [
      { itemId: '3.04', execution: { reviewReceipts: [peerReview] } }] } as never)
    await f.service.commands[0].handler(f.invocation as never); await f.service.whenIdle('p1')
    expect(f.prepareSources).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
    expect((await f.service.commands[1].handler(f.invocation as never)).text).toContain('MODULE_CHECKPOINT_PROJECT_MISMATCH')
  })
  it('keeps explicit refresh incompatible with frozen checkpoint resume', async () => {
    const f = await commandFixture(true, true, '3.04')
    const response = await f.service.commands[0].handler({ ...f.invocation, rawInput: f.invocation.rawInput + ' --refreshQuery=3.04:0' } as never)
    expect(response.kind).toBe('error'); expect(response.text).toContain('MODULE_WEB_REFRESH_REQUIRES_NEW_SNAPSHOT')
    expect(f.prepareSources).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
  })
})

describe('native peer source review recovery', () => {
  it('skips all three cached peer queries, delivers the exact latest review and preserves replayable old archives', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peer-review-web-recovery-')); roots.push(root)
    await mkdir(join(root, '原始资料')); await writeFile(join(root, '原始资料/brief.txt'), '项目位于湖北省武汉市新洲区少潭河水库。')
    const corpus = await captureMaterialCorpus(root), quote = '公开原发资料列明武汉新洲区同类景区位置。'; let count = 0
    const web = { query: vi.fn(async (_parent?: unknown, _project?: string, _request?: string, _signal?: unknown, _options?: unknown) => ({
      executionId: 'web-'+(++count), childId: 'child-'+count, verifiedEvidence: false,
      summary: JSON.stringify([{ url: 'https://example.gov.cn/peers', quote }]),
      searchCalls: [{ tool: 'web_fetch', callId: 'call-'+count, request: { url: 'https://example.gov.cn/peers' }, status: 'succeeded' }],
      retrievals: [{ tool: 'web_fetch', callId: 'call-'+count, text: 'https://example.gov.cn/peers' }] })) }
    const fetcher = vi.fn<typeof fetch>(async () => new Response(quote, { headers: { 'content-type': 'text/plain' } }))
    const request = { workspaceRoot: root, projectId: 'p1', corpus, signal: new AbortController().signal, moduleIds: ['3.04'] }
    const old = await acquisition.acquireModuleWebCorpus({ id: 'session' } as never, request, { web: web as never, fetch: fetcher })
    const oldFingerprint = old.fingerprint, before = web.query.mock.calls.length
    const recovered = await acquisition.acquireModuleWebCorpus({ id: 'session' } as never, { ...request,
      sourceRecovery: { checkpoint, moduleId: '3.04', queryKeys: ['3.04:0','3.04:1','3.04:2'], reason: 'independent-review-source-gaps', review: peerReview } } as never,
      { web: web as never, fetch: fetcher })
    expect(web.query.mock.calls.length - before).toBe(3)
    for (const call of web.query.mock.calls.slice(before) as any[]) {
      expect(call[2]).toContain(JSON.stringify(peerReview))
      expect(call[2]).toContain('原独审指出本模块来源证据缺口')
      expect(call[2]).not.toContain('旧快照漏采本模块查询。')
      expect(call[2]).toContain('不能替代本次原件或QA')
      expect(call[4]).toMatchObject({ maxToolCalls: 20 })
    }
    expect(recovered.fingerprint).not.toBe(oldFingerprint)
    expect(old.fingerprint).toBe(oldFingerprint)
    expect(await acquisition.replayModuleWebCorpus(root, old)).toEqual(old)
    acquisition.assertModuleAcquisition(recovered, ['3.04'])
  })
})

describe('native product discovery recovery', () => {
  it('reacquires the three product queries with real tools, larger bounded discovery and verified public peer context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peer-web-recovery-')); roots.push(root)
    await mkdir(join(root, '原始资料')); await writeFile(join(root, '原始资料/brief.txt'), '项目位于湖北省武汉市新洲区少潭河水库。')
    const corpus = await captureMaterialCorpus(root), quote = '公开报道列明木兰花乡和问津缘景区。'
    let count = 0
    const web = { query: vi.fn(async (_parent?: unknown, _project?: string, _request?: string, _signal?: unknown, _options?: unknown) => ({ executionId: 'web-'+(++count), childId: 'child-'+count, verifiedEvidence: false,
      summary: JSON.stringify([{ url: 'https://example.gov.cn/peers', quote }]),
      searchCalls: [{ tool: 'web_fetch', callId: 'call-'+count, request: { url: 'https://example.gov.cn/peers' }, status: 'succeeded' }],
      retrievals: [{ tool: 'web_fetch', callId: 'call-'+count, text: 'https://example.gov.cn/peers' }] })) }
    const fetcher = vi.fn<typeof fetch>(async () => new Response(quote, { headers: { 'content-type': 'text/plain' } }))
    const request = { workspaceRoot: root, projectId: 'p1', corpus, signal: new AbortController().signal }
    const old = await acquisition.acquireModuleWebCorpus({ id: 'session' } as never, { ...request, moduleIds: ['3.04', '3.05'] }, { web: web as never, fetch: fetcher })
    const oldFingerprint = old.fingerprint, before = web.query.mock.calls.length
    const recovered = await acquisition.acquireModuleWebCorpus({ id: 'session' } as never,
      { ...request, moduleIds: ['3.04', '3.05'], sourceRecovery: { checkpoint, moduleId: '3.05', queryKeys: ['3.05:0','3.05:1','3.05:2'], review } } as never,
      { web: web as never, fetch: fetcher })
    expect(web.query.mock.calls.length-before).toBe(3)
    for (const call of web.query.mock.calls.slice(before) as any[]) {
      expect(call[2]).toContain(review.checks[0].rationale)
      expect(call[2]).toContain('木兰花乡')
      expect(call[2]).toContain('公开来源线索')
      expect(call[2]).toContain('不能当作已取得的产品原件')
      expect(call[4]).toMatchObject({ maxToolCalls: 20 })
    }
    expect(recovered.fingerprint).not.toBe(oldFingerprint)
    expect(old.fingerprint).toBe(oldFingerprint)
    expect(await acquisition.replayModuleWebCorpus(root, old)).toEqual(old)
    acquisition.assertModuleAcquisition(recovered, ['3.05'])
  })
})

it('全62项续跑不触发单项独审补采，缺失查询仍完整补采', async () => {
  const f = await commandFixture(true, true, '3.04')
  await f.service.commands[0].handler({ ...f.invocation, rawInput: '--all-modules --resume=' + checkpoint } as never)
  await f.service.whenIdle('p1')
  const intake = f.prepareSources.mock.calls[0]?.[1] as any
  expect(intake.corpus.fingerprint).toBe(f.prior.acquisition!.originalFingerprint)
  expect(intake).not.toHaveProperty('sourceRecovery')
  expect(intake.moduleIds).toHaveLength(62)
  expect(intake.moduleIds).toContain('3.04')
  expect(execution.readModuleExecutionSummary).not.toHaveBeenCalled()
  expect(f.execute.mock.calls[0]?.[1]).toMatchObject({ resumeRunIds: [checkpoint], allowInputReuse: true, corpus: f.next })
  expect(f.execute.mock.calls[0]?.[1]).not.toHaveProperty('moduleIds')
  expect(await readFile(f.snapshotPath, 'utf8')).toBe(f.snapshot)
})
