import { describe, expect, it } from 'vitest'
import { ResearchRegistry } from '../src/research/registry.ts'
import { validateResearchRequest } from '../src/research/provider.ts'

const researchRoot = new URL('../research/v2.0.1/', import.meta.url)

describe('Pre 2.0.1 research provider boundary', () => {
  it('allows declared workspace-file collection for project materials', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const result = validateResearchRequest(registry.source('workspace-project-files'), {
      mode: 'workspace_file',
      workflowId: 'preplan.wf.01.01',
      dataPointId: 'canonical-name',
      locator: 'D:/project/taskbook.pdf',
    })
    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('allows official-domain web fetches and rejects third-party replacements', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const source = registry.source('cn-nbs')
    expect(validateResearchRequest(source, {
      mode: 'web_page',
      workflowId: 'preplan.wf.02.01',
      dataPointId: 'applicable-policies',
      locator: 'https://www.stats.gov.cn/sj/',
    }).valid).toBe(true)
    const invalid = validateResearchRequest(source, {
      mode: 'web_page',
      workflowId: 'preplan.wf.02.01',
      dataPointId: 'applicable-policies',
      locator: 'https://example.com/repost/statistics',
    })
    expect(invalid.valid).toBe(false)
    expect(invalid.errors.join(' ')).toContain('allowed domain')
  })

  it('rejects access modes not declared by the source catalog', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const result = validateResearchRequest(registry.source('cn-gsxt'), {
      mode: 'api',
      workflowId: 'preplan.wf.02.01',
      dataPointId: 'applicable-policies',
      locator: 'https://www.gsxt.gov.cn/api',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('access mode')
  })

  it('reads existing DSH user statements and model inference without modeling either as manual import', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const userStatement = registry.source('dsh-user-statement')
    const inference = registry.source('llm-inference')

    expect(userStatement.accessModes).toContain('session_context')
    expect(userStatement.accessModes).not.toContain('manual_import')
    expect(validateResearchRequest(userStatement, {
      mode: 'session_context',
      workflowId: 'preplan.wf.01.01',
      dataPointId: 'project-trigger',
      locator: 'session://current/messages',
    }).valid).toBe(true)

    expect(inference.accessModes).toContain('model_output')
    expect(inference.accessModes).not.toContain('manual_import')
    expect(validateResearchRequest(inference, {
      mode: 'model_output',
      workflowId: 'preplan.wf.01.01',
      dataPointId: 'project-trigger',
      locator: 'model://pre-design/current-run',
    }).valid).toBe(true)
  })
})