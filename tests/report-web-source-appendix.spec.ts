import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { captureMaterialCorpus } from '../src/materials/research-evidence.ts'
import { acquireModuleWebCorpus } from '../src/research-v2/module-web-acquisition.ts'
import { writeReportWebSourceAppendix } from '../src/report/web-source-appendix.ts'
import { reportAcceptanceResources } from '../src/report/acceptance.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'
const sources = vi.hoisted(() => ({ paths: [] as string[] }))
vi.mock('../src/report/manuscript/source.ts', () => ({ makeSourceIndex: () => [{ id: 'source-1', moduleLineage: { sources: sources.paths.map(path => ({ source: { path } })) } }], manuscriptSourceFingerprint: () => 'fixture' }))
let root: string
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })
it('packages linked, hash-bound offline responses and renders source text without executing source HTML', async () => {
  root = await mkdtemp(join(tmpdir(), 'source-appendix-'))
  await mkdir(join(root, '原始资料')); await writeFile(join(root, '原始资料/site.txt'), '测试地区。')
  const corpus = await acquireModuleWebCorpus({ id: 'parent' } as never, { workspaceRoot: root, projectId: 'p', corpus: await captureMaterialCorpus(root), moduleIds: ['3.01'], signal: new AbortController().signal }, {
    web: { query: async () => ({ executionId: 'web', childId: 'child', summary: '[{"url":"https://example.gov.cn/data","quote":"全区人口100万人，仅用于测试。"}]',
      retrievals: [{ tool: 'web_fetch', callId: 'c', text: 'https://example.gov.cn/data' }], verifiedEvidence: false, guidance: 'fixture' }) },
    fetch: async () => new Response('<html><script>alert("unsafe")</script><body>全区人口100万人，仅用于测试。</body></html>', { headers: { 'content-type': 'text/html' } }),
  })
  const documents = corpus.documents.filter(document => document.provenance); sources.paths = documents.map(document => document.path)
  const input = { manuscript: { chapters: [{ pages: [{ sourceRefs: ['source-1'] }] }] }, moduleResearch: { documents } } as never
  const output = join(root, 'report'); await mkdir(join(output, 'html'), { recursive: true })
  await writeFile(join(output, 'html/index.html'), 'report'); await writeFile(join(output, 'planning-sources.html'), '<html><body>资料依据</body></html>')
  await writeReportWebSourceAppendix(input, root, output); await writeReportWebSourceAppendix(input, root, output)
  const html = await readFile(join(output, 'planning-sources.html'), 'utf8')
  expect(html).toContain('href="sources/web/'); expect(html).toContain('全区人口100万人，仅用于测试。'); expect(html).not.toContain('<script>')
  expect(html.match(/id="web-source-archive"/g)).toHaveLength(1)
  const resources = await reportAcceptanceResources(output)
  expect(resources.filter(resource => resource.path.startsWith('sources/web/'))).toHaveLength(1)
  const archive = JSON.parse(await readFile(join(output, `sources/web/${documents[0].contentHash}.json`), 'utf8'))
  expect(Buffer.from(archive.rawBase64, 'base64').toString()).toContain('<script>')
})

it('identifies linked native query evidence as an execution record instead of an external original page', async () => {
  root = await mkdtemp(join(tmpdir(), 'search-log-appendix-'))
  await mkdir(join(root, '原始资料')); await writeFile(join(root, '原始资料/site.txt'), '测试地区。')
  const corpus = await acquireModuleWebCorpus({ id: 'parent' } as never, { workspaceRoot: root, projectId: 'p', corpus: await captureMaterialCorpus(root), moduleIds: ['3.01'], signal: new AbortController().signal }, {
    web: { query: async () => ({ executionId: 'web', childId: 'child', summary: '[]', retrievals: [{ tool: 'web_search', callId: 's', text: 'empty public search' }],
      searchCalls: [{ tool: 'web_search', callId: 's', request: { queries: ['公开查询测试'] }, status: 'succeeded', resultHash: sha256CanonicalJson('empty public search'), resultChars: 19 }],
      verifiedEvidence: false, guidance: 'fixture' }) },
  })
  const documents = corpus.documents.filter(document => document.provenance); sources.paths = documents.map(document => document.path)
  const input = { manuscript: { chapters: [{ pages: [{ sourceRefs: ['source-1'] }] }] }, moduleResearch: { documents } } as never
  const output = join(root, 'report'); await mkdir(output)
  await writeFile(join(output, 'planning-sources.html'), '<html><body>资料依据</body></html>')
  await writeReportWebSourceAppendix(input, root, output)
  const html = await readFile(join(output, 'planning-sources.html'), 'utf8')
  expect(html).toContain('检索执行记录')
  expect(html).toContain('公开查询测试')
  expect(html).not.toContain('href="workspace:')
  expect(html).not.toContain('原发页面')
  expect(html).toContain('不能替代外部业务原文')
})
