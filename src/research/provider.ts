import type { ResearchSelector } from './selector.ts'
import type {
  DataSourceDefinition,
  EvidenceRecord,
  ResearchAccessMode,
  ResearchValidationResult,
} from './types.ts'

export interface ResearchRequest {
  readonly mode: ResearchAccessMode
  /** Workflow that will own every EvidenceRecord produced by this request. */
  readonly workflowId: string
  /** Workflow data point that this request is intended to satisfy. */
  readonly dataPointId: string
  /** Workspace path, Project State locator, URL, API URL, or provider-specific locator. */
  readonly locator: string
  /** Optional exact fragment selector. Providers must record it in EvidenceRecord.locator. */
  readonly selector?: ResearchSelector
  /** Required for web_search so the router can enforce the source whitelist. */
  readonly domain?: string
  readonly query?: string
}

export interface ResearchProviderResult {
  readonly records: readonly EvidenceRecord[]
}

export interface ResearchProvider {
  readonly providerId: string
  readonly accessModes: readonly ResearchAccessMode[]
  search?(source: DataSourceDefinition, request: ResearchRequest, signal?: AbortSignal): Promise<ResearchProviderResult>
  fetch?(source: DataSourceDefinition, request: ResearchRequest, signal?: AbortSignal): Promise<ResearchProviderResult>
  queryApi?(source: DataSourceDefinition, request: ResearchRequest, signal?: AbortSignal): Promise<ResearchProviderResult>
  readProjectState?(source: DataSourceDefinition, request: ResearchRequest, signal?: AbortSignal): Promise<ResearchProviderResult>
  readSessionContext?(source: DataSourceDefinition, request: ResearchRequest, signal?: AbortSignal): Promise<ResearchProviderResult>
  readModelOutput?(source: DataSourceDefinition, request: ResearchRequest, signal?: AbortSignal): Promise<ResearchProviderResult>
  runProfessionalTool?(source: DataSourceDefinition, request: ResearchRequest, signal?: AbortSignal): Promise<ResearchProviderResult>
}

function normalizedDomain(value: string): string {
  return value.normalize('NFC').trim().toLowerCase().replace(/^\.+|\.+$/gu, '')
}

export function researchDomainAllowed(host: string, allowedDomains: readonly string[]): boolean {
  const normalizedHost = normalizedDomain(host)
  return allowedDomains.some((domain) => {
    const normalized = normalizedDomain(domain)
    return normalizedHost === normalized || normalizedHost.endsWith(`.${normalized}`)
  })
}

function urlHost(locator: string): string | undefined {
  try {
    return new URL(locator).hostname
  } catch {
    return undefined
  }
}

export function validateResearchRequest(
  source: DataSourceDefinition,
  request: ResearchRequest,
): ResearchValidationResult {
  const errors: string[] = []
  const locator = request.locator.normalize('NFC').trim()
  const workflowId = request.workflowId.normalize('NFC').trim()
  const dataPointId = request.dataPointId.normalize('NFC').trim()
  if (locator === '') errors.push('research request locator must be non-empty')
  if (!/^preplan\.wf\.\d{2}\.\d{2}$/u.test(workflowId)) errors.push('research request workflowId must be a canonical preplan workflow id')
  if (dataPointId === '') errors.push('research request dataPointId must be non-empty')
  if (!source.accessModes.includes(request.mode)) {
    errors.push(`source '${source.sourceId}' does not declare access mode '${request.mode}'`)
  }

  if ((request.mode === 'web_page' || request.mode === 'api') && locator !== '') {
    const host = urlHost(locator)
    if (host === undefined) {
      errors.push(`${request.mode} locator must be an absolute URL`)
    } else if (source.allowedDomains.length === 0 || !researchDomainAllowed(host, source.allowedDomains)) {
      errors.push(`locator host '${host}' is outside the allowed domain list for source '${source.sourceId}'`)
    }
  }

  if (request.mode === 'web_search') {
    const domain = request.domain === undefined ? '' : normalizedDomain(request.domain)
    if (domain === '') {
      errors.push(`web_search for source '${source.sourceId}' requires an explicit allowed domain`)
    } else if (!researchDomainAllowed(domain, source.allowedDomains)) {
      errors.push(`search domain '${domain}' is outside the allowed domain list for source '${source.sourceId}'`)
    }
  }

  return errors.length === 0
    ? { valid: true, errors: [] }
    : { valid: false, errors: Object.freeze(errors) }
}
