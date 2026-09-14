import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ResearchExecutionService } from '../src/research/execution-service.ts'
import { OfficialWebResearchProvider } from '../src/research/official-web-provider.ts'
import { ResearchRegistry } from '../src/research/registry.ts'
import { ResearchProviderRouter } from '../src/research/router.ts'
import { WorkspaceResearchProvider } from '../src/research/workspace-provider.ts'

const researchRoot = new URL('../research/v2.0.1/', import.meta.url)
const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function response(body: string, url: string, contentType = 'text/plain; charset=utf-8') {
  const value = new Response(body, { status: 200, headers: { 'content-type': contentType } })
  Object.defineProperty(value, 'url', { value: url })
  return value
}

describe('Pre 2.0.1 deployment research smoke', () => {
  it('runs Workspace field evidence through router, execution service, and independent Evidence Validator', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pre-v201-deploy-smoke-'))
    cleanup.push(root)
    await mkdir(join(root, 'inputs'))
    await writeFile(join(root, 'inputs', 'project.json'), JSON.stringify({
      project: {
        name: '武汉站改造',
        location: '武汉市',
        trigger: '既有站房更新与服务能力提升',
      },
    }), 'utf8')

    const registry = await ResearchRegistry.open(researchRoot)
    const workspace = new WorkspaceResearchProvider({
      rootDir: root,
      clock: () => new Date('2026-09-14T05:30:00.000Z'),
    })
    const service = new ResearchExecutionService(registry, new ResearchProviderRouter([workspace]))
    const base = {
      sourceId: 'workspace-project-files',
      request: {
        mode: 'workspace_file' as const,
        locator: 'inputs/project.json',
        workflowId: 'preplan.wf.01.01',
      },
    }

    const result = await service.execute('preplan.wf.01.01', [
      { ...base, request: { ...base.request, dataPointId: 'canonical-name', selector: { type: 'json_pointer' as const, pointer: '/project/name' } } },
      { ...base, request: { ...base.request, dataPointId: 'project-location', selector: { type: 'json_pointer' as const, pointer: '/project/location' } } },
      { ...base, request: { ...base.request, dataPointId: 'project-trigger', selector: { type: 'json_pointer' as const, pointer: '/project/trigger' } } },
    ], '2026-09-14T06:00:00.000Z')

    expect(result.validation).toMatchObject({ valid: true, coverage: 1, missingDataPointIds: [] })
    expect(result.records.map(record => record.normalizedValue)).toEqual([
      '武汉站改造', '武汉市', '既有站房更新与服务能力提升',
    ])
    for (const record of result.records) {
      expect(record.locator).toMatchObject({ selectorType: 'json_pointer' })
      expect(record.locator.fragmentHash).toMatch(/^[a-f0-9]{64}$/u)
      expect(registry.validateEvidenceRecord(record)).toEqual({ valid: true, errors: [] })
    }
  })

  it('produces allowlisted official-page EvidenceRecord without relying on live internet in CI', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const web = new OfficialWebResearchProvider({
      fetchImpl: async () => response(
        '政策标题\n现行政策要求：项目应结合国土空间规划和建设条件开展论证。\n发布机关：国务院',
        'https://www.gov.cn/zhengce/example.htm',
      ),
      clock: () => new Date('2026-09-14T05:30:00.000Z'),
    })

    const result = await web.fetch(registry.source('cn-gov-policy'), {
      mode: 'web_page',
      locator: 'https://www.gov.cn/zhengce/example.htm',
      workflowId: 'preplan.wf.02.01',
      dataPointId: 'applicable-policies',
      selector: { type: 'text_lines', startLine: 2, endLine: 2 },
    })

    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      sourceId: 'cn-gov-policy',
      workflowId: 'preplan.wf.02.01',
      dataPointId: 'applicable-policies',
      normalizedValue: '现行政策要求：项目应结合国土空间规划和建设条件开展论证。',
      claimClass: 'source_conclusion',
    })
    expect(registry.validateEvidenceRecord(result.records[0])).toEqual({ valid: true, errors: [] })
  })
})
