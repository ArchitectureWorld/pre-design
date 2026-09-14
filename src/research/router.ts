import { validateResearchRequest, type ResearchProvider, type ResearchProviderResult, type ResearchRequest } from './provider.ts'
import type { DataSourceDefinition, ResearchAccessMode } from './types.ts'

function providerMethod(
  provider: ResearchProvider,
  mode: ResearchAccessMode,
): ((source: DataSourceDefinition, request: ResearchRequest, signal?: AbortSignal) => Promise<ResearchProviderResult>) | undefined {
  switch (mode) {
    case 'web_search': return provider.search?.bind(provider)
    case 'api': return provider.queryApi?.bind(provider)
    case 'project_state': return provider.readProjectState?.bind(provider)
    case 'session_context': return provider.readSessionContext?.bind(provider)
    case 'model_output': return provider.readModelOutput?.bind(provider)
    case 'professional_tool': return provider.runProfessionalTool?.bind(provider)
    case 'workspace_file':
    case 'web_page':
    case 'manual_import':
      return provider.fetch?.bind(provider)
  }
}

export class ResearchProviderRouter {
  private readonly providers: readonly ResearchProvider[]

  constructor(providers: readonly ResearchProvider[]) {
    const ids = new Set<string>()
    for (const provider of providers) {
      if (ids.has(provider.providerId)) throw new Error(`duplicate research provider id '${provider.providerId}'`)
      ids.add(provider.providerId)
    }
    this.providers = Object.freeze([...providers])
  }

  async execute(
    source: DataSourceDefinition,
    request: ResearchRequest,
    signal?: AbortSignal,
  ): Promise<ResearchProviderResult> {
    const validation = validateResearchRequest(source, request)
    if (!validation.valid) throw new Error(`invalid research request: ${validation.errors.join('; ')}`)

    const candidates = this.providers
      .filter(provider => provider.accessModes.includes(request.mode))
      .map(provider => ({ provider, method: providerMethod(provider, request.mode) }))
      .filter((row): row is { provider: ResearchProvider; method: NonNullable<ReturnType<typeof providerMethod>> } => row.method !== undefined)

    if (candidates.length === 0) {
      throw new Error(`no research provider can execute access mode '${request.mode}' for source '${source.sourceId}'`)
    }
    if (candidates.length > 1) {
      throw new Error(`ambiguous research provider route for access mode '${request.mode}': ${candidates.map(row => row.provider.providerId).join(', ')}`)
    }

    return candidates[0].method(source, request, signal)
  }
}
