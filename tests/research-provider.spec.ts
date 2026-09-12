import { describe, expect, it } from 'vitest'
import { ResearchRegistry } from '../src/research/registry.ts'
import { validateResearchRequest } from '../src/research/provider.ts'

const researchRoot = new URL('../research/v2.0.1/', import.meta.url)

describe('Pre 2.0.1 research provider boundary', () => {
  it('allows declared workspace-file collection for project materials', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const result = validateResearchRequest(registry.source('workspace-project-files'), {
      mode: 'workspace_file',
      locator: 'D:/project/taskbook.pdf',
    })
    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('allows official-domain web fetches and rejects third-party replacements', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const source = registry.source('cn-nbs')
    expect(validateResearchRequest(source, {
      mode: 'web_page',
      locator: 'https://www.stats.gov.cn/sj/',
    }).valid).toBe(true)
    const invalid = validateResearchRequest(source, {
      mode: 'web_page',
      locator: 'https://example.com/repost/statistics',
    })
    expect(invalid.valid).toBe(false)
    expect(invalid.errors.join(' ')).toContain('allowed domain')
  })

  it('rejects access modes not declared by the source catalog', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    const result = validateResearchRequest(registry.source('cn-gsxt'), {
      mode: 'api',
      locator: 'https://www.gsxt.gov.cn/api',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('access mode')
  })
})
