import { describe, expect, it } from 'vitest'
import { ResearchRegistry } from '../src/research/registry.ts'
import { OfficialWebResearchProvider } from '../src/research/official-web-provider.ts'

const researchRoot = new URL('../research/v2.0.1/', import.meta.url)

function response(body: string, options: { url: string; status?: number; contentType?: string }) {
  const value = new Response(body, {
    status: options.status ?? 200,
    headers: { 'content-type': options.contentType ?? 'text/plain; charset=utf-8' },
  })
  Object.defineProperty(value, 'url', { value: options.url })
  return value
}

describe('Pre 2.0.1 official web research provider', () => {
  it('fetches an allowed official page and returns selected traceable evidence', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const source = registry.source('cn-nbs')
    const provider = new OfficialWebResearchProvider({
      fetchImpl: async () => response('标题\n2025年常住人口 100 万人\n来源说明', {
        url: 'https://www.stats.gov.cn/sj/example.html',
      }),
      clock: () => new Date('2026-09-14T04:00:00.000Z'),
    })

    const result = await provider.fetch(source, {
      mode: 'web_page',
      locator: 'https://www.stats.gov.cn/sj/example.html',
      workflowId: 'preplan.wf.02.05',
      dataPointId: 'population',
      selector: { type: 'text_lines', startLine: 2, endLine: 2 },
    })

    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      workflowId: 'preplan.wf.02.05',
      dataPointId: 'population',
      sourceId: 'cn-nbs',
      sourceType: 'web_page',
      sourceUri: 'https://www.stats.gov.cn/sj/example.html',
      capturedAt: '2026-09-14T04:00:00.000Z',
      rawValue: '2025年常住人口 100 万人',
      normalizedValue: '2025年常住人口 100 万人',
      reliability: 'A',
      claimClass: 'source_conclusion',
    })
    expect(result.records[0].locator).toMatchObject({
      httpStatus: 200,
      contentType: 'text/plain; charset=utf-8',
      selectorType: 'text_lines',
      startLine: 2,
      endLine: 2,
    })
    expect(result.records[0].contentHash).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('rejects redirects that leave the source allowlist', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const provider = new OfficialWebResearchProvider({
      fetchImpl: async () => response('reposted', { url: 'https://example.com/repost' }),
    })

    await expect(provider.fetch(registry.source('cn-nbs'), {
      mode: 'web_page',
      locator: 'https://www.stats.gov.cn/sj/example.html',
      workflowId: 'preplan.wf.02.05',
      dataPointId: 'population',
    })).rejects.toThrow(/redirected outside allowed domains/u)
  })

  it('rejects non-success and binary responses instead of manufacturing evidence', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const source = registry.source('cn-nbs')
    const failed = new OfficialWebResearchProvider({
      fetchImpl: async () => response('unavailable', {
        url: 'https://www.stats.gov.cn/sj/example.html', status: 503,
      }),
    })
    await expect(failed.fetch(source, {
      mode: 'web_page', locator: 'https://www.stats.gov.cn/sj/example.html',
      workflowId: 'preplan.wf.02.05', dataPointId: 'population',
    })).rejects.toThrow(/HTTP 503/u)

    const binary = new OfficialWebResearchProvider({
      fetchImpl: async () => response('%PDF-1.7', {
        url: 'https://www.stats.gov.cn/sj/example.pdf', contentType: 'application/pdf',
      }),
    })
    await expect(binary.fetch(source, {
      mode: 'web_page', locator: 'https://www.stats.gov.cn/sj/example.pdf',
      workflowId: 'preplan.wf.02.05', dataPointId: 'population',
    })).rejects.toThrow(/unsupported web content type/u)
  })
})
