import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { MaterialCorpus, MaterialCorpusDocument } from '../src/materials/research-evidence.ts'
import type { ModuleCorpusSlice } from '../src/research-v2/module-prompt-context.ts'
import { readSourceImageMetadata } from '../src/materials/source-image.ts'
import sharp from 'sharp'

const url = new URL('../src/research-v2/module-prompt-context.ts', import.meta.url)
async function api() { expect(existsSync(url), 'traceable module corpus slicing is implemented').toBe(true); return import(url.href) }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function corpus(documents: MaterialCorpusDocument[]): MaterialCorpus {
  const limitations = ['历史资料，尚未核实当前情况。']
  return { documents, limitations, fingerprint: hash(JSON.stringify({ documents, limitations })) }
}
function pdf(path: string, texts: string[]): MaterialCorpusDocument {
  return { path, contentHash: hash(texts.join('\n')), byteLength: 1234, pages: texts.map((text, i) => ({ page: i + 1, text })) }
}

describe('traceable bounded module prompt corpus', () => {
  it('keeps complete ASCII originals above the worst-case character allowance when their serialized UTF-8 bytes fit', async () => {
    const { sliceModuleCorpus } = await api()
    const text = JSON.stringify({ record: 'original', details: 'a'.repeat(24000) })
    const input = corpus([pdf('original.pdf', [text, '原文名称'])]), before = JSON.stringify(input)
    expect(() => sliceModuleCorpus(input, { query: 'original', maxMaterialChars: 22813 })).toThrow('MODULE_PROMPT_BUDGET_EXCEEDED')
    const result: ModuleCorpusSlice = sliceModuleCorpus(input, { query: 'original', maxMaterialChars: 48000, maxMaterialUtf8Bytes: 22813 * 3 })
    expect(result.documents[0].pages![0].text).toBe(text)
    expect(result.selection.maxMaterialUtf8Bytes).toBe(22813 * 3)
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(22813 * 3)
    expect(JSON.stringify(input)).toBe(before)
  })
  it('rejects mandatory multibyte originals whose actual serialized bytes exceed the allowance', async () => {
    const { sliceModuleCorpus } = await api()
    const input = corpus([pdf('original.pdf', ['原'.repeat(24000)])])
    expect(() => sliceModuleCorpus(input, { query: '原文', maxMaterialChars: 48000, maxMaterialUtf8Bytes: 22813 * 3 }))
      .toThrow(/MODULE_PROMPT_BUDGET_EXCEEDED:.*UTF-8 bytes/)
  })
  it('uses both ceilings when adding complete passages and preserves their exact omissions and offsets', async () => {
    const { sliceModuleCorpus } = await api()
    const input = corpus([pdf('original.pdf', ['cover', 'intro', '主题'.repeat(700), '主题'.repeat(700), 'ASCII'.repeat(200)])])
    const result: ModuleCorpusSlice = sliceModuleCorpus(input, { query: '主题', maxMaterialChars: 48000, maxMaterialUtf8Bytes: 4000 })
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(4000)
    const visible = result.documents[0].pages!
    const omitted = result.selection.omitted[0].pages!
    expect([...visible.map(page => page.page), ...omitted].sort()).toEqual([1, 2, 3, 4, 5])
    for (const page of visible) expect(page.text).toBe(input.documents[0].pages![page.page - 1].text)
    expect(omitted).toContain(3)
    expect(omitted).toContain(4)
  })
  it.each([0, -1, 1.5, NaN, Infinity])('rejects an invalid serialized UTF-8 byte allowance %s', async maxMaterialUtf8Bytes => {
    const { sliceModuleCorpus } = await api()
    expect(() => sliceModuleCorpus(corpus([pdf('original.pdf', ['cover'])]), { query: 'cover', maxMaterialUtf8Bytes }))
      .toThrow('MODULE_PROMPT_OPTIONS_INVALID')
  })
  it('keeps a complete acquired policy text with its exact whitespace, identity, clauses and exceptions', async () => {
    const { sliceModuleCorpus } = await api()
    const text = '\n\n导航\n\n武汉市湖泊水库水上交通安全管理规定\n\n'
      + Array.from({ length: 30 }, (_, i) => `第${i + 1}条 原始条款与适用例外。${'完整上下文。'.repeat(12)}`).join('\n\n') + '\n\n'
    const document = { path: 'research/policy.txt', text, contentHash: hash(text), byteLength: Buffer.byteLength(text),
      provenance: { sourceUri: 'https://example.gov.cn/policy', retrievedAt: '2026-09-28T00:00:00Z', rawHash: hash(text),
        claimClass: 'source_conclusion' as const, queryKeys: ['1.03:1'] } }
    const input = corpus([document]), before = JSON.stringify(input)
    const slice: ModuleCorpusSlice = sliceModuleCorpus(input, { moduleId: '1.03', query: '政策条款', maxMaterialChars: 7000 })
    const spans = slice.documents[0].paragraphs!
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ startOffset: 0, endOffset: text.length, text })
    expect(spans[0].endParagraph).toBeGreaterThan(1)
    expect(slice.selection.omitted).toEqual([])
    expect(JSON.stringify(slice).length).toBeLessThanOrEqual(7000)
    expect(JSON.stringify(input)).toBe(before)
  })
  it('rejects an acquired policy that cannot fit instead of presenting isolated clauses as its complete context', async () => {
    const { sliceModuleCorpus } = await api()
    const text = Array.from({ length: 50 }, (_, i) => `第${i + 1}条 ${'条款与例外原文。'.repeat(20)}`).join('\n\n')
    const document = { path: 'research/policy.txt', text, contentHash: hash(text), byteLength: Buffer.byteLength(text),
      provenance: { sourceUri: 'https://example.gov.cn/policy', retrievedAt: '2026-09-28T00:00:00Z', rawHash: hash(text),
        claimClass: 'source_conclusion' as const, queryKeys: ['1.03:1'] } }
    expect(() => sliceModuleCorpus(corpus([document]), { moduleId: '1.03', query: '条款', maxMaterialChars: 3000 }))
      .toThrow('MODULE_PROMPT_BUDGET_EXCEEDED')
    const otherModule: ModuleCorpusSlice = sliceModuleCorpus(corpus([document]), { moduleId: '1.04', query: '条款', maxMaterialChars: 3000 })
    expect(otherModule.documents).toEqual([])
  })
  it('keeps every exact top-level search-log entry when the caller requires that complete frozen document', async () => {
    const { sliceModuleCorpus } = await api()
    const text = JSON.stringify({ version: 'native-search-log.v1', queryKey: '3.04:0', executionId: 'synthetic-execution',
      childId: 'synthetic-child', retrievedAt: '2026-10-06T00:00:00Z', toolCallBudget: 9,
      calls: Array.from({ length: 8 }, (_, index) => ({ tool: 'web_search', query: 'query-'+index, result: '原始搜索回执'.repeat(90) })), boundary: '搜索不等于事实或通过。' })
    const log = { path: 'research/search-log.json', text, contentHash: hash(text), byteLength: Buffer.byteLength(text),
      provenance: { sourceUri: 'workspace:native-web-query/synthetic-query', retrievedAt: '2026-10-06T00:00:00Z', rawHash: hash(text), claimClass: 'source_conclusion' as const, queryKeys: ['3.04:0'] } }
    const input = corpus([pdf('original.pdf', ['封面', '目录', '同类项目身份和位置。'.repeat(1600)]), log]), before = JSON.stringify(input)
    const result: ModuleCorpusSlice = sliceModuleCorpus(input, { moduleId: '3.04', query: '同类项目', maxMaterialChars: 20000, requiredDocumentPaths: [log.path] })
    expect(result.selection.omitted.some(doc => doc.path === log.path)).toBe(false)
    const spans = result.documents.find(doc => doc.path === log.path)!.paragraphs!
    expect(spans).toHaveLength(8)
    expect(spans.find(span => span.jsonPointer === '/calls')!.text).toBe('"calls":'+JSON.stringify(JSON.parse(text).calls))
    for (const span of spans) expect(text.slice(span.startOffset, span.endOffset)).toBe(span.text)
    expect(JSON.stringify(input)).toBe(before)
  })
  it('refuses a missing required frozen document instead of silently losing its audit log', async () => {
    const { sliceModuleCorpus } = await api()
    expect(() => sliceModuleCorpus(corpus([pdf('original.pdf', ['原件'])]), { query: '资料', requiredDocumentPaths: ['missing-log.json'] }))
      .toThrow('MODULE_PROMPT_REQUIRED_SOURCE_MISSING')
  })
  it('shows the station record identified by a peer acquisition URL even when professional QA contains no proper name', async () => {
    const { sliceModuleCorpus } = await api()
    const rows = Array.from({ length: 90 }, (_, i) => ({ code: String(10000+i), name: '其他站', detail: '站点位置说明'.repeat(30) }))
    rows[70] = { code: '57492', name: '新洲', detail: '站点位置说明'.repeat(30) }
    const text = JSON.stringify(rows)
    const provenance = (uri: string) => ({ sourceUri: uri, retrievedAt: '2026-09-29T00:00:00Z', rawHash: hash(uri), claimClass: 'source_conclusion' as const, queryKeys: ['1.05:2'] })
    const document = { path: 'research/stations.json', text, contentHash: hash(text), byteLength: Buffer.byteLength(text), provenance: provenance('https://example.gov.cn/stations?province=420') }
    const peer = { path: 'research/rainfall.json', text: '[{"month":1,"value":44.5}]', contentHash: hash('rain'), byteLength: 30, provenance: provenance('https://example.gov.cn/rainfall?stationID=57492') }
    const slice: ModuleCorpusSlice = sliceModuleCorpus(corpus([document,peer]), { moduleId:'1.05',query: '站点位置 时段 降雨', maxMaterialChars: 4200 })
    expect(slice.documents.find(d=>d.path===document.path)?.paragraphs?.some(p=>p.text.includes('57492')&&p.text.includes('新洲'))).toBe(true)
    const unrelated = {...peer,provenance:{...peer.provenance,queryKeys:['2.01:0']}}
    const isolated: ModuleCorpusSlice = sliceModuleCorpus(corpus([document,unrelated]), { moduleId:'1.05',query: '站点位置 时段 降雨', maxMaterialChars: 4200 })
    expect(isolated.documents.find(d=>d.path===document.path)?.paragraphs?.some(p=>p.text.includes('57492'))).toBe(false)
  })
  it('selects complete JSON station records with exact offsets and array positions instead of requiring a province table', async () => {
    const { sliceModuleCorpus } = await api()
    const rows = Array.from({ length: 120 }, (_, i) => ({ id: String(i), name: '其他站点', note: '原始观测说明'.repeat(20), nested: { literal: '逗号,括号}与引号"' } }))
    rows[80] = { id: '57492', name: '新洲', note: '地区气象站', nested: { literal: '坐标114.83,30.83' } }
    const text = JSON.stringify(rows)
    const document = { path: 'research/stations.json', text, contentHash: hash(text), byteLength: Buffer.byteLength(text) }
    const input = corpus([document]), before = JSON.stringify(input)
    const slice: ModuleCorpusSlice = sliceModuleCorpus(input, { query: '新洲 57492', maxMaterialChars: 5000 })
    const spans = slice.documents[0].paragraphs!
    const station = spans.find(span => span.text.includes('57492'))!
    expect(JSON.parse(station.text)).toEqual(rows[80])
    expect(station).toMatchObject({ jsonPointer: '/80' })
    for (const span of spans) expect(text.slice(span.startOffset, span.endOffset)).toBe(span.text)
    expect(slice.selection.omitted[0].paragraphs?.length ?? slice.selection.omitted[0].paragraphRanges?.length).toBeGreaterThan(0)
    expect(JSON.stringify(slice).length).toBeLessThanOrEqual(5000)
    expect(JSON.stringify(input)).toBe(before)
  })
  it('preserves complete JSON property values and escaped key identities without rewriting numeric text', async () => {
    const { sliceModuleCorpus } = await api()
    const text = '{"version":1,"source":"原图","unrelated":"' + '无关记录'.repeat(900) + '","climate~/station":{"name":"新洲","longitude":114.8300,"nested":[1,{"label":"comma,quote\\\""}]}}'
    const document = { path: '原始资料/data.json', text, contentHash: hash(text), byteLength: Buffer.byteLength(text) }
    const slice: ModuleCorpusSlice = sliceModuleCorpus(corpus([document]), { query: '新洲', maxMaterialChars: 2200 })
    const station = slice.documents[0].paragraphs!.find(span => span.text.includes('新洲'))!
    expect(station).toMatchObject({ jsonPointer: '/climate~0~1station' })
    expect(station.text).toContain('114.8300')
    expect(JSON.parse('{'+station.text+'}')['climate~/station'].name).toBe('新洲')
    expect(text.slice(station.startOffset,station.endOffset)).toBe(station.text)
    expect(slice.selection.omitted[0].paragraphs).toEqual([3])
  })
  it('keeps representative photo records and substantive originals within budget while identifying the remaining photographs', async () => {
    const { sliceModuleCorpus } = await api()
    const metadata = await readSourceImageMetadata(await sharp({ create: { width: 40, height: 20, channels: 3, background: '#abc' } }).jpeg().toBuffer())
    const photos = Array.from({ length: 50 }, (_, i) => ({ path: `原始资料/点位${i}/照片.jpg`, contentHash: hash(String(i)), byteLength: 100,
      text: metadata.text, image: metadata.image }))
    const source = corpus([...photos, pdf('原始资料/说明.pdf', ['封面'.repeat(4000), '目录'.repeat(4000), '气象站位于水库大坝背后管理房顶。'])])
    const slice: ModuleCorpusSlice = sliceModuleCorpus(source, { moduleId: '1.07', query: '照片 拍摄 站点', focusQueries: ['气象站 管理房顶'], maxMaterialChars: 40000 })
    expect(JSON.stringify(slice).length).toBeLessThanOrEqual(40000)
    expect(slice.documents.filter(doc => doc.path.endsWith('.jpg')).length).toBeGreaterThanOrEqual(16)
    expect(slice.documents.find(doc => doc.path.endsWith('.pdf'))?.pages?.some(page => page.page === 3)).toBe(true)
    expect(slice.selection.omitted.some(doc => doc.path.endsWith('.jpg') && (doc.paragraphs?.includes(1) || doc.paragraphRanges?.some(([lo, hi]) => lo <= 1 && hi >= 1)))).toBe(true)
  })
  it('keeps QA-specific original pages alongside current web bodies under a crowded shared budget', async () => {
    const { sliceModuleCorpus } = await api()
    const original = pdf('原始资料/environment.pdf', ['历史封面', '历史目录',
      '水源保护、生态、环境与防洪条件。'.repeat(90),
      '水文气象。四季分明，日照充足。'.repeat(20),
      '水库管理房顶有雨量观测站，2016年建成自动监测设备。多年平均值统计期未注明。'.repeat(20),
      '生态环境保护约束。'.repeat(90)])
    const terrain = { path: '原始资料/georeference.json', contentHash: hash('terrain'), byteLength: 6000, text: '地形配准记录。'.repeat(750) }
    const webpages = Array.from({ length: 8 }, (_, index) => {
      const text = `首页\n\n导航\n\n生态环境保护${index}。\n\n${'自然环境保护的实质正文。'.repeat(30)}\n\n${'生态敏感对象与保护条件。'.repeat(50)}\n\n尾部`
      return { path: `research/web-${index}.json`, text, contentHash: hash(text), byteLength: Buffer.byteLength(text),
        provenance: { sourceUri: `https://example.gov.cn/environment-${index}`, retrievedAt: '2026-09-29T00:00:00Z', rawHash: hash(text), claimClass: 'source_conclusion' as const, queryKeys: ['1.05:0'] } }
    })
    const input = corpus([original, terrain, ...webpages]), before = JSON.stringify(input)
    const result = sliceModuleCorpus(input, { moduleId: '1.05', query: '自然环境 生态敏感对象 保护条件',
      focusQueries: ['抽一项气象结论能找到站点与时间覆盖。'], maxMaterialChars: 20000 })
    const pages = result.documents.find((d: any) => d.path === original.path).pages
    expect(pages.some((p: any) => p.page === 5 && p.text === original.pages![4].text)).toBe(true)
    expect(pages.some((p: any) => p.page === 4)).toBe(true)
    for (const webpage of webpages) {
      const spans = result.documents.find((d: any) => d.path === webpage.path).paragraphs
      expect(spans.some((p: any) => /实质正文|生态敏感对象/.test(p.text)), JSON.stringify({ path: webpage.path, chars: JSON.stringify(result).length, visible: spans.map((p: any) => p.paragraph) })).toBe(true)
      for (const span of spans) expect(webpage.text.slice(span.startOffset, span.endOffset)).toBe(span.text)
    }
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(20000)
    expect(JSON.stringify(input)).toBe(before)
    const included = new Set(pages.map((p: any) => p.page))
    expect(result.selection.omitted.find((d: any) => d.path === original.path)?.pages ?? []).toEqual(original.pages!.filter(p => !included.has(p.page)).map(p => p.page))
  })

  it('preserves every omitted paragraph ordinal without letting a large index consume the source budget', async () => {
    const { sliceModuleCorpus } = await api()
    const text = ['封面', '前言', ...Array.from({ length: 2500 }, (_, i) => `无关段落${i}。`.repeat(80)), '气象站点实际观测与时间覆盖。'].join('\n\n')
    const document = { path: '原始资料/observation.txt', text, contentHash: hash(text), byteLength: Buffer.byteLength(text) }
    const result = sliceModuleCorpus(corpus([document]), { query: '气象站点 时间覆盖', maxMaterialChars: 2000 })
    const spans = result.documents[0].paragraphs
    expect(spans.some((p: any) => p.paragraph === 2503)).toBe(true)
    const omission = result.selection.omitted[0]
    expect(omission.paragraphRanges.length).toBeLessThan(6)
    const missing: number[] = omission.paragraphRanges.flatMap(([start, end]: [number, number]) => Array.from({ length: end - start + 1 }, (_, i) => start + i))
    const visible = spans.map((p: any) => p.paragraph)
    expect([...missing, ...visible].sort((a, b) => a - b)).toEqual(Array.from({ length: 2503 }, (_, i) => i + 1))
    for (const span of spans) expect(text.slice(span.startOffset, span.endOffset)).toBe(span.text)
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2000)
  })

  it('gives each acquired page relevant body context before large highly ranked archival pages consume the remainder', async () => {
    const { sliceModuleCorpus } = await api()
    const query = '项目身份 委托范围 编制主体 工程性质 实施周期 决策目的 来源版本 时间要求'
    const original = pdf('原始资料/archive.pdf', ['原件封面。'.repeat(4200), '目录', ...Array.from({ length: 4 }, () => query.repeat(90))])
    const documents = Array.from({ length: 6 }, (_, index) => {
      const text = `首页\n\n导航\n\n项目身份\n\n少潭河第${index}项工程。\n\n${'委托范围及来源版本的实质正文。'.repeat(35)}\n\n页脚`
      return { path: `research/runs/RUN-${index}/sources/body.json`, text, contentHash: hash(text), byteLength: Buffer.byteLength(text),
        provenance: { sourceUri: `https://example.gov.cn/source-${index}`, retrievedAt: '2026-09-28T00:00:00Z', rawHash: hash(text), claimClass: 'source_conclusion' as const, queryKeys: ['1.01:0'] } }
    })
    const result = sliceModuleCorpus(corpus([original, ...documents]), { moduleId: '1.01', query })
    for (const document of documents) {
      const visible = result.documents.find((d: any) => d.path === document.path).paragraphs
      expect(visible.some((p: any) => p.text.includes('实质正文'))).toBe(true)
      expect(visible.some((p: any) => p.text.includes('少潭河'))).toBe(true)
      for (const p of visible) expect(document.text.slice(p.startOffset, p.endOffset)).toBe(p.text)
    }
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(result.selection.maxMaterialChars)
    expect(result.selection.maxMaterialChars).toBeLessThanOrEqual(48_000)
  })

  it('reserves default budget for substantive source paragraphs beyond large mandatory originals and web navigation', async () => {
    const { sliceModuleCorpus } = await api()
    const original = pdf('原始资料/long-cover.pdf', ['历史原件封面与说明。'.repeat(2300), '历史资料目录。', '项目身份与委托范围的历史记载。'.repeat(100)])
    const webpages = Array.from({ length: 6 }, (_, index) => {
      const body = `第${index}篇项目身份与委托范围的真实正文。`.repeat(65)
      const text = `首页\n\n智能问答\n\n${body}\n\n版权所有`
      return { path: `research/runs/RUN-${index}/sources/web.json`, contentHash: hash(text), byteLength: Buffer.byteLength(text), text,
        provenance: { sourceUri: `https://example.gov.cn/article-${index}`, retrievedAt: '2026-09-28T00:00:00Z', rawHash: hash(text), claimClass: 'source_conclusion' as const, queryKeys: ['1.01:0'] } }
    })
    const input = corpus([original, ...webpages]), before = JSON.stringify(input)
    const result = sliceModuleCorpus(input, { moduleId: '1.01', query: '项目身份与委托范围' })
    for (const doc of webpages) {
      const spans = result.documents.find((d: any) => d.path === doc.path).paragraphs
      expect(spans.some((span: any) => span.text.includes('真实正文'))).toBe(true)
      for (const span of spans) expect(doc.text.slice(span.startOffset, span.endOffset)).toBe(span.text)
    }
    expect(result.documents.find((d: any) => d.path === original.path).pages.map((p: any) => p.page)).toContain(3)
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(result.selection.maxMaterialChars)
    expect(result.selection.maxMaterialChars).toBeLessThanOrEqual(48_000)
    expect(JSON.stringify(input)).toBe(before)
    expect(() => sliceModuleCorpus(input, { moduleId: '1.01', query: '项目身份', maxMaterialChars: 12_000 })).toThrow('MODULE_PROMPT_BUDGET_EXCEEDED')
  })

  it('keeps a full 121-query acquisition from overflowing each module with unrelated paragraph indexes', async () => {
    const { sliceModuleCorpus } = await api()
    const documents = Array.from({ length: 363 }, (_, index) => ({ path: `research/runs/RUN-${index}/sources/${'a'.repeat(64)}.json`, contentHash: hash(String(index)), byteLength: 1000,
      text: Array.from({ length: 12 }, (_, paragraph) => `公开原文段落 ${index}-${paragraph}`).join('\n\n'),
      provenance: { sourceUri: 'https://example.gov.cn/page', retrievedAt: '2026-09-27T00:00:00Z', rawHash: hash(String(index)), claimClass: 'source_conclusion' as const, queryKeys: [index < 3 ? '1.01:0' : '3.01:0'] } }))
    const result = sliceModuleCorpus(corpus(documents), { moduleId: '1.01', query: '项目概况' })
    expect(result.documents).toHaveLength(3)
    expect(result.selection.excludedAcquisition?.documentCount).toBe(360)
    expect(JSON.stringify(result).length).toBeLessThan(12_000)
    expect(result.documents[0].provenance?.sourceUri).toBe('https://example.gov.cn/page')
  })
  it('keeps whole original pages and necessary initial pages, ranks relevant pages before unrelated pages, and reports every omission', async () => {
    const { sliceModuleCorpus } = await api()
    const input = corpus([pdf('原始资料/report.pdf', ['项目封面。', '历史前言。', '无关说明。'.repeat(100), '防洪安全。'.repeat(100), '项目委托范围与编制主体。'.repeat(60)])])
    const before = JSON.stringify(input)
    const result = sliceModuleCorpus(input, { query: '项目委托范围 编制主体', maxMaterialChars: 1700 })
    expect(result.documents[0].pages.map((p: any) => p.page)).toEqual([1, 2, 5])
    expect(result.documents[0].pages[2].text).toBe(input.documents[0].pages![4].text)
    expect(result.documents[0].contentHash).toBe(input.documents[0].contentHash)
    expect(result.originalFingerprint).toBe(input.fingerprint)
    expect(result.selection.omitted).toEqual([{ path: '原始资料/report.pdf', contentHash: input.documents[0].contentHash, pages: [3, 4] }])
    expect(result.selection.boundary).toMatch(/不得.*未选/)
    expect(result.limitations).toEqual(input.limitations)
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1700)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('uses stable path/page ordering independent of incoming document and page order', async () => {
    const { sliceModuleCorpus } = await api()
    const a = pdf('原始资料/a.pdf', ['封面 A', '前言 A', '等分相关主题 A']), b = pdf('原始资料/b.pdf', ['封面 B', '前言 B', '等分相关主题 B'])
    const first = sliceModuleCorpus(corpus([a, b]), { query: '相关主题' })
    const second = sliceModuleCorpus(corpus([{ ...b, pages: [...b.pages!].reverse() }, { ...a, pages: [...a.pages!].reverse() }]), { query: '相关主题' })
    expect(second.documents).toEqual(first.documents)
    expect(second.selection.omitted).toEqual(first.selection.omitted)
  })

  it('keeps text paragraphs as exact offset-bearing spans without manufacturing adjacency', async () => {
    const { sliceModuleCorpus } = await api()
    const text = '封面项目。\r\n\r\n' + '无关段落。'.repeat(200) + '\n\n' + '编制主体及委托范围，原文结束。'
    const document = { path: '原始资料/brief.txt', contentHash: hash(text), byteLength: Buffer.byteLength(text), text }
    const result = sliceModuleCorpus(corpus([document]), { query: '编制主体 委托范围', maxMaterialChars: 1200, initialPagesPerDocument: 1 })
    expect(result.documents[0].paragraphs.map((p: any) => p.paragraph)).toEqual([1, 3])
    for (const span of result.documents[0].paragraphs) expect(text.slice(span.startOffset, span.endOffset)).toBe(span.text)
    expect(result.documents[0]).not.toHaveProperty('text')
    expect(result.selection.omitted[0].paragraphs).toEqual([2])
  })

  it('pins exact source quote pages even when they do not match the query', async () => {
    const { sliceModuleCorpus } = await api()
    const document = pdf('原始资料/source.pdf', ['封面', '前言', '无关文本'.repeat(350), '面积 12.5 平方米。'])
    const requiredSources = [{ sourceId: 'area', path: document.path, contentHash: document.contentHash, page: 4, quote: '面积 12.5 平方米。', rawValue: 12.5, valueQuote: '12.5' }]
    const result = sliceModuleCorpus(corpus([document]), { query: '委托范围', maxMaterialChars: 1400, requiredSources })
    expect(result.documents[0].pages.map((p: any) => p.page)).toEqual([1, 2, 4])
    expect(result.documents[0].pages[2].text).toBe('面积 12.5 平方米。')
  })

  it('preserves a required quote across text paragraph boundaries as one exact contiguous span', async () => {
    const { sliceModuleCorpus } = await api()
    const text = '第一段原文。\n\n第二段原文。\n\n第三段原文。'
    const document = { path: '原始资料/source.txt', contentHash: hash(text), byteLength: 100, text }
    const result = sliceModuleCorpus(corpus([document]), { query: '第一段', requiredSources: [{ sourceId: 'source', path: document.path,
      contentHash: document.contentHash, quote: '第一段原文。 第二段原文。', rawValue: '第一段原文。' }] })
    expect(result.documents[0].paragraphs.some((span: any) => span.text.includes('第一段原文。\n\n第二段原文。'))).toBe(true)
  })

  it('rejects a budget too small for mandatory pages rather than truncating source text', async () => {
    const { sliceModuleCorpus } = await api()
    expect(() => sliceModuleCorpus(corpus([pdf('原始资料/large.pdf', ['完整原文'.repeat(1000)])]), { query: '原文', maxMaterialChars: 1200 })).toThrow(/MODULE_PROMPT_BUDGET_EXCEEDED/)
  })
  it('adapts the default budget for mandatory original pages within a fixed ceiling', async () => {
    const { sliceModuleCorpus } = await api()
    const input = corpus([pdf('原始资料/terrain.pdf', ['配准记录完整原文。'.repeat(2300)])])
    const result = sliceModuleCorpus(input, { query: '配准' })
    expect(result.documents[0].pages[0].text).toBe(input.documents[0].pages![0].text)
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(result.selection.maxMaterialChars)
    expect(result.selection.maxMaterialChars).toBeLessThanOrEqual(48000)
    expect(()=>sliceModuleCorpus(corpus([pdf('原始资料/too-large.pdf',['原'.repeat(48000)])]),{query:'原文'})).toThrow('MODULE_PROMPT_BUDGET_EXCEEDED')
  })

  it('rejects a missing required source location rather than silently dropping the citation', async () => {
    const { sliceModuleCorpus } = await api()
    const input = corpus([pdf('原始资料/report.pdf', ['封面', '前言'])])
    expect(() => sliceModuleCorpus(input, { query: '项目', requiredSources: [{ sourceId: 'missing', path: input.documents[0].path,
      contentHash: input.documents[0].contentHash, page: 99, quote: '不存在', rawValue: '不存在' }] })).toThrow(/MODULE_PROMPT_REQUIRED_SOURCE_MISSING/)
  })
})
