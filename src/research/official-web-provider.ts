import { createHash } from 'node:crypto'
import { researchDomainAllowed, validateResearchRequest, type ResearchProvider, type ResearchProviderResult, type ResearchRequest } from './provider.ts'
import { applyResearchSelector } from './selector.ts'
import type { DataSourceDefinition, EvidenceRecord } from './types.ts'

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const TEXT_CONTENT_TYPES = [
  'application/json', 'application/geo+json', 'application/xml', 'application/xhtml+xml',
  'text/',
]

export interface OfficialWebResearchProviderOptions {
  readonly fetchImpl?: typeof fetch
  readonly maxBytes?: number
  readonly clock?: () => Date
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableValueText(value: unknown): string {
  if (typeof value === 'string') return value
  const json = JSON.stringify(value)
  return json === undefined ? String(value) : json
}

function normalizedHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    throw new Error(`official web provider received invalid final URL '${url}'`)
  }
}

function supportedContentType(value: string): boolean {
  const lower = value.toLowerCase()
  return TEXT_CONTENT_TYPES.some(prefix => prefix.endsWith('/') ? lower.startsWith(prefix) : lower.includes(prefix))
}

function charsetOf(contentType: string): string {
  const match = /charset\s*=\s*["']?([^;"'\s]+)/iu.exec(contentType)
  return match?.[1]?.toLowerCase() ?? 'utf-8'
}

function decodeText(bytes: Uint8Array, contentType: string): string {
  const charset = charsetOf(contentType)
  try {
    return new TextDecoder(charset, { fatal: true }).decode(bytes).normalize('NFC').replace(/\r\n?/gu, '\n')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`official web response cannot be decoded as ${charset}: ${message}`)
  }
}

function parsedValue(contentType: string, text: string): unknown {
  if (/\b(?:application\/json|application\/geo\+json)\b/iu.test(contentType)) {
    try {
      return JSON.parse(text)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`invalid JSON official web response: ${message}`)
    }
  }
  return text
}

function pageTitle(text: string, finalUrl: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(text)
  const title = match?.[1]?.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim()
  if (title) return title
  try {
    const url = new URL(finalUrl)
    return `${url.hostname}${url.pathname}`
  } catch {
    return finalUrl
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

export class OfficialWebResearchProvider implements ResearchProvider {
  readonly providerId = 'official-web-research-provider'
  readonly accessModes = ['web_page'] as const

  private readonly fetchImpl: typeof fetch
  private readonly maxBytes: number
  private readonly clock: () => Date

  constructor(options: OfficialWebResearchProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('official web provider maxBytes must be a positive safe integer')
    this.maxBytes = maxBytes
    this.clock = options.clock ?? (() => new Date())
  }

  async fetch(
    source: DataSourceDefinition,
    request: ResearchRequest,
    signal?: AbortSignal,
  ): Promise<ResearchProviderResult> {
    assertNotAborted(signal)
    const validation = validateResearchRequest(source, request)
    if (!validation.valid) throw new Error(`invalid research request: ${validation.errors.join('; ')}`)
    if (request.mode !== 'web_page') throw new Error(`official web provider cannot handle access mode '${request.mode}'`)

    const response = await this.fetchImpl(request.locator, {
      method: 'GET',
      redirect: 'follow',
      signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/json,text/plain,application/xml;q=0.9,*/*;q=0.1',
        'user-agent': 'Pre-design/2.0.1 Source-Traceable-Research',
      },
    })
    assertNotAborted(signal)

    const finalUrl = response.url || request.locator
    const finalHost = normalizedHost(finalUrl)
    if (!researchDomainAllowed(finalHost, source.allowedDomains)) {
      throw new Error(`official web request redirected outside allowed domains for source '${source.sourceId}': ${finalHost}`)
    }
    if (!response.ok) throw new Error(`official web request failed with HTTP ${response.status}`)

    const contentType = response.headers.get('content-type')?.trim() || 'application/octet-stream'
    if (!supportedContentType(contentType)) throw new Error(`unsupported web content type '${contentType}'`)
    const declaredLength = Number(response.headers.get('content-length') ?? '')
    if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
      throw new Error(`official web response exceeds maxBytes (${declaredLength} > ${this.maxBytes})`)
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    assertNotAborted(signal)
    if (bytes.byteLength > this.maxBytes) throw new Error(`official web response exceeds maxBytes (${bytes.byteLength} > ${this.maxBytes})`)
    const text = decodeText(bytes, contentType)
    const parsed = parsedValue(contentType, text)
    const selection = applyResearchSelector(text, parsed, request.selector)
    const contentHash = sha256(bytes)
    const fragmentHash = sha256(stableValueText(selection.rawValue))
    const capturedAt = this.clock().toISOString()
    const selectorIdentity = JSON.stringify(selection.locator)
    const evidenceId = `ev-${sha256(`${request.workflowId}\n${request.dataPointId}\n${source.sourceId}\n${finalUrl}\n${selectorIdentity}\n${contentHash}`).slice(0, 32)}`

    const record: EvidenceRecord = {
      evidenceId,
      workflowId: request.workflowId,
      dataPointId: request.dataPointId,
      sourceId: source.sourceId,
      sourceType: 'web_page',
      sourceUri: finalUrl,
      sourceTitle: pageTitle(text, finalUrl),
      publisher: source.publisher,
      publishedAt: null,
      capturedAt,
      asOf: null,
      locator: {
        requestedUrl: request.locator,
        finalUrl,
        httpStatus: response.status,
        contentType,
        byteLength: bytes.byteLength,
        ...selection.locator,
        fragmentHash,
      },
      rawValue: selection.rawValue,
      normalizedValue: selection.normalizedValue,
      unit: null,
      contentHash,
      reliability: source.reliabilityGrade,
      claimClass: 'source_conclusion',
      notes: 'Official web source snapshot. Initial and final redirect hosts are constrained by the source catalog; search snippets and third-party reposts are not upgraded to official evidence.',
    }

    return { records: Object.freeze([Object.freeze(record)]) }
  }
}
