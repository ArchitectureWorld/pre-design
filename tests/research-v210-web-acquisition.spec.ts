import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { captureMaterialCorpus } from '../src/materials/research-evidence.ts'
import { acquireModuleWebCorpus, replayModuleWebCorpus, assertModuleAcquisition, verifyModuleWebNative } from '../src/research-v2/module-web-acquisition.ts'
import { getResearchModuleSpec } from '../src/research-v2/specification.ts'
import sharp from 'sharp'
import { moduleCompletionStatus } from '../src/research-v2/module-execution.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'
import { nativeWebSearchCalls, nativeWebSourceSubmission } from '../src/agent-classes/web-query.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'module-web-')); roots.push(root)
  await mkdir(join(root, '原始资料')); await writeFile(join(root, '原始资料/brief.txt'), '项目位于湖北省武汉市新洲区少潭河水库。')
  const corpus = await captureMaterialCorpus(root)
  const web = { query: vi.fn(async (_parent?: unknown, _project?: string, _request?: string) => ({ executionId: 'web-1', childId: 'child-1', verifiedEvidence: false,
    summary: JSON.stringify([{ url: 'https://example.gov.cn/report', quote: '全区常住人口 100 万人。' }]),
    retrievals: [{ tool: 'web_search', callId: 'call-1', text: 'https://example.gov.cn/report' }] })) }
  const fetcher = vi.fn<typeof fetch>(async () => new Response('<html><body><p>2025年统计公报</p><p>全区常住人口 100 万人。</p></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }))
  const request = { workspaceRoot: root, projectId: 'project', corpus, moduleIds: ['3.01'], signal: new AbortController().signal }
  return { root, corpus, web, fetcher, request }
}
it('refreshes only the requested query, binds its untrusted hints and QA to native discovery, and preserves the old immutable corpus', async () => {
  const f = await fixture()
  const old = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })
  f.web.query.mockImplementation(async (_parent, _project, request) => {
    expect(request).toContain('https://example.gov.cn/new-data')
    for (const criterion of getResearchModuleSpec('3.01').qa) expect(request).toContain(criterion)
    return { executionId: 'web-new', childId: 'child-new', verifiedEvidence: false,
      summary: JSON.stringify([{ url: 'https://example.gov.cn/new-data', quote: '最新统计常住人口 101 万人。' }]),
      retrievals: [{ tool: 'web_fetch', callId: 'call-new', text: 'https://example.gov.cn/new-data' }] }
  })
  f.fetcher.mockImplementation(async () => new Response('最新统计常住人口 101 万人。', { headers: { 'content-type': 'text/plain' } }))
  const refreshed = await acquireModuleWebCorpus({} as never, { ...f.request, refresh: { queryKey: '3.01:0', sourceHints: ['https://example.gov.cn/new-data'] } }, { web: f.web as never, fetch: f.fetcher })
  expect(refreshed.acquisition!.queries[0].sourcePaths).not.toEqual(old.acquisition!.queries[0].sourcePaths)
  expect(refreshed.acquisition!.queries[1]).toEqual(old.acquisition!.queries[1])
  expect(refreshed.documents.some(doc => doc.text?.includes('101 万人'))).toBe(true)
  expect(refreshed.fingerprint).not.toBe(old.fingerprint)
  expect(await replayModuleWebCorpus(f.root, old)).toEqual(old)
  expect(await replayModuleWebCorpus(f.root, refreshed)).toEqual(refreshed)
})
it('reuses immutable public discoveries when only private source photos change and never sends photograph metadata to search', async () => {
  const f = await fixture()
  const old = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })
  const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#abc' } }).jpeg().toBuffer()
  await writeFile(join(f.root, '原始资料', 'private-site.jpg'), bytes)
  const original = await captureMaterialCorpus(f.root)
  f.web.query.mockImplementation(async () => { throw Error('Unnecessary rediscovery of unchanged public context') })
  const current = await acquireModuleWebCorpus({} as never, { ...f.request, corpus: original }, { web: f.web as never, fetch: f.fetcher })
  expect(current.acquisition!.bundles).toEqual(old.acquisition!.bundles)
  expect(current.fingerprint).not.toBe(old.fingerprint)
  expect(current.documents.some(doc => doc.image)).toBe(true)
  expect(await replayModuleWebCorpus(f.root, current)).toEqual(current)
  await expect(replayModuleWebCorpus(f.root, old)).rejects.toThrow('MODULE_WEB_SOURCE_CHANGED')
  await writeFile(join(f.root, '原始资料', 'brief.txt'), 'Changed public project location')
  const changed = await acquireModuleWebCorpus({} as never, { ...f.request, corpus: await captureMaterialCorpus(f.root) }, { web: f.web as never, fetch: f.fetcher })
  expect(changed.acquisition!.queries.every(row => row.status === 'failed')).toBe(true)
})

it('does not turn hinted URLs into retrieved evidence or fall back to a previous accepted query after refresh fails', async () => {
  const f = await fixture()
  const old = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })
  f.web.query.mockImplementation(async () => ({ executionId: 'web-new', childId: 'child-new', verifiedEvidence: false,
    summary: JSON.stringify([{ url: 'https://example.gov.cn/hint-only', quote: '最新统计常住人口 101 万人。' }]),
    retrievals: [{ tool: 'web_search', callId: 'call-new', text: 'No matching result.' }] }))
  const refreshed = await acquireModuleWebCorpus({} as never, { ...f.request, refresh: { queryKey: '3.01:0', sourceHints: ['https://example.gov.cn/hint-only'] } }, { web: f.web as never, fetch: f.fetcher })
  expect(refreshed.acquisition!.queries[0]).toMatchObject({ status: 'failed', sourcePaths: [], error: 'MODULE_WEB_URL_NOT_RETRIEVED' })
  expect(refreshed.acquisition!.queries[1]).toEqual(old.acquisition!.queries[1])
  expect(() => assertModuleAcquisition(refreshed, ['3.01'])).toThrow('MODULE_WEB_INCOMPLETE')
})

it.each([
  { queryKey: '1.05:2', sourceHints: [] },
  { queryKey: '3.01:99', sourceHints: [] },
  { queryKey: '3.01:0', sourceHints: ['https://127.0.0.1/private'] },
  { queryKey: '3.01:0', sourceHints: ['https://example.gov.cn/?token=secret'] },
])('rejects an out-of-scope or unsafe refresh before producing evidence: %j', async refresh => {
  const f = await fixture()
  await expect(acquireModuleWebCorpus({} as never, { ...f.request, refresh }, { web: f.web as never, fetch: f.fetcher })).rejects.toThrow(/MODULE_WEB_(REFRESH_QUERY_INVALID|URL_INVALID)/u)
  await expect(readdir(join(f.root, 'research/runs'))).rejects.toMatchObject({ code: 'ENOENT' })
})
it('executes real discovery per specification query, freezes response bytes and replays field-readable sources without modifying originals', async () => {
  const f = await fixture()
  const corpus = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher, now: () => new Date('2026-09-27') })
  expect(f.web.query).toHaveBeenCalledTimes(2)
  expect(f.fetcher).toHaveBeenCalled()
  expect(corpus.documents.at(-1)).toMatchObject({ text: expect.stringContaining('全区常住人口 100 万人。'), provenance: { sourceUri: 'https://example.gov.cn/report', claimClass: 'source_conclusion' } })
  expect(corpus.fingerprint).not.toBe(f.corpus.fingerprint)
  assertModuleAcquisition(corpus, ['3.01'])
  const reused = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher, now: () => new Date('2026-09-28') })
  expect(reused).toEqual(corpus)
  expect(f.web.query).toHaveBeenCalledTimes(2)
  expect(await replayModuleWebCorpus(f.root, corpus, { now: new Date('2026-09-28') })).toEqual(corpus)
  expect(await readFile(join(f.root, '原始资料/brief.txt'), 'utf8')).toContain('少潭河')
  await expect(replayModuleWebCorpus(f.root, corpus, { now: new Date('2027-09-28') })).rejects.toThrow('MODULE_WEB_EXPIRED')
  await writeFile(join(f.root, corpus.documents.at(-1)!.path), 'rewritten')
  await expect(replayModuleWebCorpus(f.root, corpus, { now: new Date('2026-09-28') })).rejects.toThrow()
})
it('never turns search snippets, fabricated quotes or absent successful retrievals into evidence', async () => {
  const f = await fixture()
  f.fetcher.mockImplementation(async () => new Response('<html>无数据</html>', { headers: { 'content-type': 'text/html' } }))
  const corpus = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })
  expect(corpus.documents).toEqual(f.corpus.documents)
  expect(() => assertModuleAcquisition(corpus, ['3.01'])).toThrow('MODULE_WEB_INCOMPLETE')
  expect(moduleCompletionStatus({ itemId: '3.01', execution: { reviewReceipts: [{ checks: [{ status: 'pass' }] }] } } as never, corpus)).toBe('limited')
  f.web.query.mockImplementation(async () => ({ executionId: 'web-2', childId: 'child-2', verifiedEvidence: false, summary: '[]', retrievals: [] }))
  const empty = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })
  expect(() => assertModuleAcquisition(empty, ['3.01'])).toThrow('MODULE_WEB_INCOMPLETE')
})
it('rejects old local-only corpora and an omitted query when judging current research coverage', async () => {
  const f = await fixture()
  expect(() => assertModuleAcquisition(f.corpus, ['3.01'])).toThrow('MODULE_WEB_REQUIRED')
  const corpus = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })
  expect(() => assertModuleAcquisition(corpus, ['3.01', '3.02'])).toThrow('MODULE_WEB_INCOMPLETE')
})

it('reads the sole explicit JSON fence from a native search response without treating surrounding prose as evidence', async () => {
  const f = await fixture()
  f.web.query.mockImplementation(async () => ({ executionId: 'web-1', childId: 'child-1', verifiedEvidence: false,
    summary: '已完成检索，返回：\n```json\n[]\n```\n缺口：未找到原发页面。',
    retrievals: [{ tool: 'web_search', callId: 'call-1', text: 'No results found.' }] }))
  const corpus = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })
  expect(corpus.acquisition!.queries.map(row => row.status)).toEqual(['searched-empty', 'searched-empty'])
  expect(corpus.documents).toEqual(f.corpus.documents)
})

it('applies the same query deadline to host source downloads and records failure before stopping', async () => {
  const f = await fixture(), deadline = new AbortController()
  const timer = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 1_200_000 ? deadline.signal : new AbortController().signal)
  try {
    f.fetcher.mockImplementation(async (_url, init) => {
      deadline.abort(new DOMException('query expired', 'TimeoutError'))
      init?.signal?.throwIfAborted()
      return new Response('全区常住人口 100 万人。', { headers: { 'content-type': 'text/plain' } })
    })
    await expect(acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })).rejects.toThrow('MODULE_WEB_QUERY_TIMEOUT')
    const names = await readdir(join(f.root, 'research/runs'))
    expect(names).toHaveLength(1)
    const receipt = JSON.parse(await readFile(join(f.root, 'research/runs', names[0], 'acquisition.json'), 'utf8'))
    expect(receipt).toMatchObject({ status: 'failed', sources: [], error: 'MODULE_WEB_QUERY_TIMEOUT' })
  } finally { timer.mockRestore() }
})

it('verifies and archives quoted source bytes when the sole JSON payload is surrounded by commentary', async () => {
  const f = await fixture()
  f.web.query.mockImplementation(async () => ({ executionId: 'web-1', childId: 'child-1', verifiedEvidence: false,
    summary: '以下是原发页面：\n```json\n[{"url":"https://example.gov.cn/report","quote":"全区常住人口 100 万人。"}]\n```\n正文说明不是额外事实。',
    retrievals: [{ tool: 'web_search', callId: 'call-1', text: 'https://example.gov.cn/report' }] }))
  const corpus = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })
  expect(corpus.acquisition!.queries.map(row => row.status)).toEqual(['acquired', 'acquired'])
  expect(corpus.documents.at(-1)).toMatchObject({ provenance: { sourceUri: 'https://example.gov.cn/report' } })
  expect(await replayModuleWebCorpus(f.root, corpus)).toEqual(corpus)
})

it('returns a rejected URL or quote to the native researcher and keeps only the verified correction in the corpus', async () => {
  const f = await fixture()
  let attempt = 0
  f.web.query.mockImplementation(async (_parent, _project, request) => {
    attempt++
    const quote = attempt === 1 ? '全区常住人口 | 100 万人。' : '全区常住人口 100 万人。'
    if (attempt === 2) expect(request).toContain('MODULE_WEB_QUOTE_UNVERIFIED')
    return { executionId: `web-${attempt}`, childId: `child-${attempt}`, verifiedEvidence: false,
      summary: JSON.stringify([{ url: 'https://example.gov.cn/report', quote }]),
      retrievals: [{ tool: 'web_fetch', callId: `call-${attempt}`, text: 'https://example.gov.cn/report' }] }
  })
  const corpus = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })
  expect(corpus.acquisition!.queries.map(row => row.status)).toEqual(['acquired', 'acquired'])
  expect(corpus.acquisition!.bundles).toHaveLength(2)
  const receipts = await Promise.all((await readdir(join(f.root, 'research/runs'))).map(async name =>
    JSON.parse(await readFile(join(f.root, 'research/runs', name, 'acquisition.json'), 'utf8'))))
  expect(receipts.map(row => row.status).sort()).toEqual(['acquired', 'acquired', 'failed'])
  expect(await replayModuleWebCorpus(f.root, corpus)).toEqual(corpus)
})

it.each([
  '```json\n[]\n```\n```json\n[{"url":"https://example.gov.cn/report","quote":"全区常住人口 100 万人。"}]\n```',
  '没有原文。请使用 https://example.gov.cn/report，摘录：全区常住人口 100 万人。',
  '```json\n[{"url":"https://example.gov.cn/report","quote":"全区常住人口 100 万人。",}]\n```',
])('keeps ambiguous, prose-only or malformed native source output failed: %s', async summary => {
  const f = await fixture()
  f.web.query.mockImplementation(async () => ({ executionId: 'web-1', childId: 'child-1', verifiedEvidence: false, summary,
    retrievals: [{ tool: 'web_search', callId: 'call-1', text: 'https://example.gov.cn/report' }] }))
  const corpus = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })
  expect(corpus.acquisition!.queries.map(row => row.status)).toEqual(['failed', 'failed'])
  expect(corpus.documents).toEqual(f.corpus.documents)
  expect(f.web.query).toHaveBeenCalledTimes(6)
})

it('revises only rejected source candidates and retains the verified original sources and both native receipts', async () => {
  const f = await fixture()
  f.fetcher.mockImplementation(async url => new Response('全区常住人口 100 万人。 ' + String(url), { headers: { 'content-type': 'text/plain' } }))
  let attempt = 0
  f.web.query.mockImplementation(async (_parent, _project, request) => {
    attempt++
    return { executionId: `mixed-${attempt}`, childId: `mixed-child-${attempt}`, verifiedEvidence: false,
      summary: JSON.stringify([...(attempt === 2 ? [] : [{ url: 'https://example.gov.cn/report', quote: '全区常住人口 100 万人。' }]),
        { url: 'https://example.gov.cn/second', quote: attempt === 1 ? '全区常住人口 | 100 万人。' : '全区常住人口 100 万人。' }]),
      retrievals: [{ tool: 'web_fetch', callId: `call-${attempt}`, text: 'https://example.gov.cn/report https://example.gov.cn/second' }] }
  })
  const corpus = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })
  const correctionRequest = f.web.query.mock.calls[1]![2]!
  expect(correctionRequest).toContain('只修订')
  expect(correctionRequest).toContain('MODULE_WEB_QUOTE_UNVERIFIED')
  expect(correctionRequest).toContain('全区常住人口 100 万人。')
  const correctionOptions = (f.web.query.mock.calls[1] as unknown[])[4]
  expect(correctionOptions).toMatchObject({ sourceCandidateLimit: 1, maxToolCalls: 2 })
  expect(correctionOptions).not.toHaveProperty('correctionOf')
  expect(corpus.acquisition!.queries[0].sourcePaths).toHaveLength(2)
  expect(corpus.acquisition!.queries.every(row => row.status === 'acquired' && row.error === undefined)).toBe(true)
  expect(f.web.query).toHaveBeenCalledTimes(3)
  const bundleId = corpus.acquisition!.bundles[0].runId
  const receipt = JSON.parse(await readFile(join(f.root, 'research/runs', bundleId, 'acquisition.json'), 'utf8'))
  expect(receipt.discovery.executionId).toBe('mixed-1')
  expect(receipt.sourceCorrections).toHaveLength(1)
  expect(receipt.sourceCorrections[0]).toMatchObject({ discovery: { executionId: 'mixed-2' }, candidateLimit: 1, toolCallBudget: 2 })
  expect(await replayModuleWebCorpus(f.root, corpus)).toEqual(corpus)
})

it('repairs rejected quotes even when another page exceeds the archive limit without rediscovering verified sources', async () => {
  const f = await fixture()
  f.fetcher.mockImplementation(async url => new Response(String(url).endsWith('/oversized') ? 'x'.repeat(1024 * 1024 + 1)
    : '全区常住人口 100 万人。 ' + String(url), { headers: { 'content-type': 'text/plain' } }))
  f.web.query.mockImplementation(async (...args: any[]) => {
    const targeted = args[4].sourceCandidateLimit === 1, index = f.web.query.mock.calls.length
    return { executionId: 'mixed-errors-' + index, childId: 'mixed-errors-child-' + index, verifiedEvidence: false,
      summary: JSON.stringify(targeted ? [{ url: 'https://example.gov.cn/second', quote: '全区常住人口 100 万人。' }]
        : [{ url: 'https://example.gov.cn/report', quote: '全区常住人口 100 万人。' },
          { url: 'https://example.gov.cn/second', quote: '全区常住人口 | 100 万人。' },
          { url: 'https://example.gov.cn/oversized', quote: '全区常住人口 100 万人。' }]),
      retrievals: [{ tool: 'web_fetch', callId: 'call-' + index,
        text: 'https://example.gov.cn/report https://example.gov.cn/second https://example.gov.cn/oversized' }] }
  })
  const corpus = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })
  expect((f.web.query.mock.calls[1] as unknown[])[4]).toMatchObject({ sourceCandidateLimit: 1, maxToolCalls: 2 })
  expect(f.web.query.mock.calls[1]![2]).toContain('只修订')
  expect(f.web.query).toHaveBeenCalledTimes(4)
  expect(corpus.acquisition!.queries.every(row => row.sourcePaths.length === 2 && row.error === 'MODULE_WEB_TOO_LARGE')).toBe(true)
  expect(corpus.limitations.some(value => value.includes('MODULE_WEB_TOO_LARGE'))).toBe(true)
  expect(corpus.documents.every(doc => doc.provenance?.sourceUri !== 'https://example.gov.cn/oversized')).toBe(true)
  const receipt = JSON.parse(await readFile(join(f.root, 'research/runs', corpus.acquisition!.bundles[0].runId, 'acquisition.json'), 'utf8'))
  expect(receipt.discovery.executionId).toBe('mixed-errors-1')
  expect(receipt.sourceCorrections).toHaveLength(1)
  expect(receipt.sourceCorrections[0].request).not.toContain('MODULE_WEB_TOO_LARGE')
  expect(await replayModuleWebCorpus(f.root, corpus)).toEqual(corpus)
})

it('independently replays every corrective native receipt and rejects a substituted prompt or failed correction', async () => {
  const f = await fixture(), pages = new Map<string, { type: string; data: any }[]>(), executions: any[] = []
  f.fetcher.mockImplementation(async url => new Response('全区常住人口 100 万人。 ' + String(url), { headers: { 'content-type': 'text/plain' } }))
  f.web.query.mockImplementation(async (...args: any[]) => {
    const request = args[2], limit = args[4].sourceCandidateLimit, index = pages.size
    const childId = `native-${index}`, executionId = `discovery-${index}`, callId = `operation-${index}`
    const sources = index === 1 ? [{ url: 'https://example.gov.cn/second', quote: '全区常住人口 100 万人。' }]
      : [{ url: 'https://example.gov.cn/report', quote: '全区常住人口 100 万人。' },
        { url: 'https://example.gov.cn/second', quote: index === 0 ? '全区常住人口 | 100 万人。' : '全区常住人口 100 万人。' }]
    const events = [
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '网络查询任务：' + request }] } },
      { type: 'tool/call', data: { name: 'web_fetch', callId, arguments: JSON.stringify({ url: 'https://example.gov.cn/second' }) } },
      { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: callId, isError: false, content: [{ type: 'text', text: 'https://example.gov.cn/report https://example.gov.cn/second' }] }] } } },
      { type: 'tool/call', data: { name: 'structured_output', callId: 'submit-' + index, arguments: JSON.stringify({ sources }) } },
      { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'submit-' + index, isError: false, content: [{ type: 'text', text: 'submitted' }] }] } } },
    ]
    pages.set(childId, events)
    executions.push({ id: executionId, projectId: 'project', parentId: 'parent', classId: 'web', status: 'completed', childId,
      childStopReason: 'completed', actual: { provider: 'provider', model: 'model' }, task: request.slice(0, 300) })
    return { executionId, childId, verifiedEvidence: false, summary: JSON.stringify(sources),
      retrievals: [{ tool: 'web_fetch', callId, text: 'https://example.gov.cn/report https://example.gov.cn/second' }],
      searchCalls: nativeWebSearchCalls(events), nativeSubmission: nativeWebSourceSubmission(events, { sources }, limit) }
  })
  const corpus = await acquireModuleWebCorpus({ id: 'parent' } as never, f.request, { web: f.web as never, fetch: f.fetcher })
  const readEvents = async (id: string) => pages.get(id)
  await verifyModuleWebNative(f.root, corpus, 'project', 'parent', executions, readEvents)
  expect(corpus.documents.filter(doc => doc.text?.includes('native-web-search-log.v1'))).toHaveLength(3)
  const correctiveEvents = pages.get('native-1')!, originalPrompt = correctiveEvents[0].data.content[0].text
  correctiveEvents[0].data.content[0].text += ' substituted'
  await expect(verifyModuleWebNative(f.root, corpus, 'project', 'parent', executions, readEvents)).rejects.toThrow('REPORT_MODULE_WEB_NATIVE_UNVERIFIED')
  correctiveEvents[0].data.content[0].text = originalPrompt
  executions[1].status = 'failed'
  await expect(verifyModuleWebNative(f.root, corpus, 'project', 'parent', executions, readEvents)).rejects.toThrow('REPORT_MODULE_WEB_NATIVE_UNVERIFIED')
  expect(await replayModuleWebCorpus(f.root, corpus)).toEqual(corpus)
})

it('quarantines an unrepaired quote and exposes its limitation without rediscovering verified sources', async () => {
  const f = await fixture()
  f.fetcher.mockImplementation(async url => new Response('全区常住人口 100 万人。 ' + String(url), { headers: { 'content-type': 'text/plain' } }))
  f.web.query.mockImplementation(async (...args: any[]) => {
    const correction = args[4].sourceCandidateLimit === 1, index = f.web.query.mock.calls.length
    return { executionId: 'partial-' + index, childId: 'partial-child-' + index, verifiedEvidence: false,
      summary: JSON.stringify(correction ? [{ url: 'https://example.gov.cn/second', quote: '全区常住人口 | 100 万人。' }]
        : [{ url: 'https://example.gov.cn/report', quote: '全区常住人口 100 万人。' }, { url: 'https://example.gov.cn/second', quote: '全区常住人口 | 100 万人。' }]),
      retrievals: [{ tool: 'web_fetch', callId: 'call-' + index, text: 'https://example.gov.cn/report https://example.gov.cn/second' }] }
  })
  const corpus = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })
  expect(f.web.query).toHaveBeenCalledTimes(6)
  expect(corpus.acquisition!.queries.every(row => row.sourcePaths.length === 1 && row.error === 'MODULE_WEB_QUOTE_UNVERIFIED')).toBe(true)
  expect(corpus.limitations.some(value => value.includes('MODULE_WEB_QUOTE_UNVERIFIED'))).toBe(true)
  expect(corpus.documents.every(doc => doc.provenance?.sourceUri !== 'https://example.gov.cn/second')).toBe(true)
  expect(await replayModuleWebCorpus(f.root, corpus)).toEqual(corpus)
})

it('stops an empty corrective retrieval and keeps the verified source and explicit gap', async () => {
  const f = await fixture()
  f.fetcher.mockImplementation(async url => new Response('全区常住人口 100 万人。 ' + String(url), { headers: { 'content-type': 'text/plain' } }))
  f.web.query.mockImplementation(async (...args: any[]) => {
    const index = f.web.query.mock.calls.length
    return { executionId: 'empty-' + index, childId: 'empty-child-' + index, verifiedEvidence: false,
      summary: args[4].sourceCandidateLimit === 1 ? '[]' : JSON.stringify([
        { url: 'https://example.gov.cn/report', quote: '全区常住人口 100 万人。' }, { url: 'https://example.gov.cn/second', quote: '全区常住人口 | 100 万人。' }]),
      retrievals: [{ tool: 'web_fetch', callId: 'call-' + index, text: 'https://example.gov.cn/report https://example.gov.cn/second' }] }
  })
  const corpus = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })
  expect(f.web.query).toHaveBeenCalledTimes(4)
  expect(corpus.acquisition!.queries.every(row => row.sourcePaths.length === 1 && row.error === 'MODULE_WEB_QUOTE_UNVERIFIED')).toBe(true)
  expect(corpus.limitations.some(value => value.includes('MODULE_WEB_QUOTE_UNVERIFIED'))).toBe(true)
  expect(await replayModuleWebCorpus(f.root, corpus)).toEqual(corpus)
})

it('replays historical partial acquisition without adding new correction limitations to its frozen fingerprint', async () => {
  const f = await fixture()
  f.web.query.mockImplementation(async () => ({ executionId: 'historical', childId: 'historical-child', verifiedEvidence: false,
    summary: JSON.stringify([{ url: 'https://example.gov.cn/report', quote: '全区常住人口 100 万人。' }, { url: 'https://example.gov.cn/second', quote: '全区常住人口 100 万人。' }]),
    retrievals: [{ tool: 'web_fetch', callId: 'call', text: 'https://example.gov.cn/report https://example.gov.cn/second' }] }))
  f.fetcher.mockImplementation(async url => String(url).endsWith('/second') ? new Response('unavailable', { status: 403 })
    : new Response('全区常住人口 100 万人。', { headers: { 'content-type': 'text/plain' } }))
  const historical = await acquireModuleWebCorpus({} as never, f.request, { web: f.web as never, fetch: f.fetcher })
  expect(historical.acquisition!.queries.every(row => row.error === 'MODULE_WEB_HTTP_403')).toBe(true)
  expect(historical.limitations).toEqual(f.corpus.limitations)
  expect(await replayModuleWebCorpus(f.root, historical)).toEqual(historical)
})

it('freezes actual peer search operations as separate field-readable evidence and allows expanded candidates', async () => {
  const f = await fixture(), query = '武汉 周末亲子 研学 度假 异地同客群'
  f.fetcher.mockImplementation(async url => new Response('全区常住人口 100 万人。 ' + String(url), { headers: { 'content-type': 'text/plain' } }))
  let attempt = 0
  f.web.query.mockImplementation(async (_parent, _project, request) => {
    attempt++
    expect(request).toContain('异地')
    expect(request).toContain('停止')
    const urls = [0, 1, 2, 3].map(i => `https://example.gov.cn/peer-${i}`)
    return { executionId: `expanded-${attempt}`, childId: `expanded-child-${attempt}`, verifiedEvidence: false,
      summary: JSON.stringify(urls.map(url => ({ url, quote: '全区常住人口 100 万人。' }))),
      retrievals: [{ tool: 'web_search', callId: `search-${attempt}`, text: urls.join(' ') }],
      searchCalls: [{ tool: 'web_search', callId: `search-${attempt}`, request: { queries: [query] },
        status: 'succeeded', resultHash: sha256CanonicalJson(urls.join(' ')), resultChars: urls.join(' ').length }] }
  })
  const corpus = await acquireModuleWebCorpus({} as never, { ...f.request, moduleIds: ['3.04'] }, { web: f.web as never, fetch: f.fetcher })
  expect(corpus.acquisition!.queries.map(row => row.status)).toEqual(['acquired', 'acquired', 'acquired'])
  const logs = corpus.documents.filter(doc => doc.text?.includes('native-web-search-log.v1'))
  expect(logs).toHaveLength(3)
  expect(logs.every(doc => doc.text!.includes(query) && doc.provenance?.sourceUri.startsWith('workspace:'))).toBe(true)
  expect(corpus.acquisition!.queries.every(row => row.sourcePaths.length === 4)).toBe(true)
  expect(await replayModuleWebCorpus(f.root, corpus)).toEqual(corpus)
  expect(f.corpus.documents).toHaveLength(1)
  for (const call of f.web.query.mock.calls) expect((call as unknown[])[4]).toMatchObject({ maxToolCalls: 20 })
})

it('reacquires old peer receipts without native search evidence and still replays the old frozen corpus unchanged', async () => {
  const f = await fixture(), request = { ...f.request, moduleIds: ['3.04'] }
  const old = await acquireModuleWebCorpus({} as never, request, { web: f.web as never, fetch: f.fetcher })
  f.web.query.mockClear()
  const current = await acquireModuleWebCorpus({} as never, request, { web: f.web as never, fetch: f.fetcher })
  expect(f.web.query).toHaveBeenCalledTimes(3)
  expect(current.acquisition!.bundles).not.toEqual(old.acquisition!.bundles)
  expect(await replayModuleWebCorpus(f.root, old)).toEqual(old)
})

it('independently rejects a substituted native query even when the retrieved URLs and outer source hashes remain identical', async () => {
  const f = await fixture(), pages = new Map<string, { type: string; data: any }[]>(), executions: any[] = []
  f.web.query.mockImplementation(async (_parent, _project, request) => {
    const index = pages.size, childId = `native-${index}`, executionId = `discovery-${index}`, callId = `operation-${index}`
    const events = [
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '网络查询任务：' + request }] } },
      { type: 'tool/call', data: { name: 'web_search', callId, arguments: JSON.stringify({ queries: ['新洲统计公报'] }) } },
      { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: callId, isError: false, content: [{ type: 'text', text: 'https://example.gov.cn/report' }] }] } } },
    ]
    pages.set(childId, events)
    executions.push({ id: executionId, projectId: 'project', parentId: 'parent', classId: 'web', status: 'completed', childId,
      childStopReason: 'completed', actual: { provider: 'provider', model: 'model' }, task: request!.slice(0, 300) })
    return { executionId, childId, verifiedEvidence: false,
      summary: JSON.stringify([{ url: 'https://example.gov.cn/report', quote: '全区常住人口 100 万人。' }]),
      retrievals: [{ tool: 'web_search', callId, text: 'https://example.gov.cn/report' }], searchCalls: nativeWebSearchCalls(events) }
  })
  const corpus = await acquireModuleWebCorpus({ id: 'parent' } as never, f.request, { web: f.web as never, fetch: f.fetcher })
  await expect(verifyModuleWebNative(f.root, corpus, 'project', 'parent', executions, async id => pages.get(id))).resolves.toBeUndefined()
  pages.get('native-0')![1].data.arguments = JSON.stringify({ queries: ['替换后的虚构查询'] })
  await expect(verifyModuleWebNative(f.root, corpus, 'project', 'parent', executions, async id => pages.get(id))).rejects.toThrow('REPORT_MODULE_WEB_NATIVE_UNVERIFIED')
})
