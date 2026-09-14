import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateResearchRequest, type ResearchProvider, type ResearchProviderResult, type ResearchRequest } from './provider.ts'
import { applyResearchSelector } from './selector.ts'
import type { DataSourceDefinition, EvidenceRecord } from './types.ts'

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024
const SUPPORTED_TEXT_EXTENSIONS = new Set([
  '.csv', '.geojson', '.gml', '.ifc', '.json', '.md', '.txt', '.xml', '.yaml', '.yml',
])

export interface WorkspaceResearchProviderOptions {
  readonly rootDir: string
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

function normalizedRelativePath(root: string, target: string): string {
  return relative(root, target).split('\\').join('/')
}

function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel)
}

function normalizedText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes).normalize('NFC').replace(/\r\n?/gu, '\n')
}

function normalizedFileValue(extension: string, text: string): unknown {
  if (extension === '.json' || extension === '.geojson') {
    try {
      return JSON.parse(text)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`invalid JSON workspace file: ${message}`)
    }
  }
  return text
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

export class WorkspaceResearchProvider implements ResearchProvider {
  readonly providerId = 'workspace-research-provider'
  readonly accessModes = ['workspace_file'] as const

  private readonly rootDir: string
  private readonly maxBytes: number
  private readonly clock: () => Date

  constructor(options: WorkspaceResearchProviderOptions) {
    const rootDir = options.rootDir.normalize('NFC').trim()
    if (rootDir === '') throw new Error('workspace provider rootDir must be non-empty')
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('workspace provider maxBytes must be a positive safe integer')
    this.rootDir = resolve(rootDir)
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
    if (request.mode !== 'workspace_file') throw new Error(`workspace provider cannot handle access mode '${request.mode}'`)

    const root = await realpath(this.rootDir)
    assertNotAborted(signal)
    const requestedPath = isAbsolute(request.locator) ? request.locator : resolve(root, request.locator)
    const target = await realpath(requestedPath)
    if (!isInsideRoot(root, target)) throw new Error(`workspace locator is outside workspace root: ${request.locator}`)

    const extension = extname(target).toLowerCase()
    if (!SUPPORTED_TEXT_EXTENSIONS.has(extension)) {
      throw new Error(`unsupported workspace file extension '${extension || '(none)'}'; use the DSH attachment/material extractor for binary documents`)
    }

    const fileStat = await stat(target)
    if (!fileStat.isFile()) throw new Error(`workspace locator is not a file: ${request.locator}`)
    if (fileStat.size > this.maxBytes) throw new Error(`workspace file exceeds maxBytes (${fileStat.size} > ${this.maxBytes})`)

    assertNotAborted(signal)
    const bytes = await readFile(target)
    assertNotAborted(signal)
    let text: string
    try {
      text = normalizedText(bytes)
    } catch {
      throw new Error(`workspace file is not valid UTF-8 text: ${request.locator}`)
    }
    const parsedValue = normalizedFileValue(extension, text)
    const selection = applyResearchSelector(text, parsedValue, request.selector)
    const contentHash = sha256(bytes)
    const fragmentHash = sha256(stableValueText(selection.rawValue))
    const relativePath = normalizedRelativePath(root, target)
    const capturedAt = this.clock().toISOString()
    const selectorIdentity = JSON.stringify(selection.locator)
    const evidenceId = `ev-${sha256(`${request.workflowId}\n${request.dataPointId}\n${source.sourceId}\n${relativePath}\n${selectorIdentity}\n${contentHash}`).slice(0, 32)}`

    const record: EvidenceRecord = {
      evidenceId,
      workflowId: request.workflowId,
      dataPointId: request.dataPointId,
      sourceId: source.sourceId,
      sourceType: 'workspace_file',
      sourceUri: pathToFileURL(target).href,
      sourceTitle: basename(target),
      publisher: source.publisher,
      publishedAt: null,
      capturedAt,
      asOf: null,
      locator: {
        relativePath,
        byteLength: bytes.byteLength,
        modifiedAt: fileStat.mtime.toISOString(),
        extension,
        ...selection.locator,
        fragmentHash,
      },
      rawValue: selection.rawValue,
      normalizedValue: selection.normalizedValue,
      unit: null,
      contentHash,
      reliability: source.reliabilityGrade,
      claimClass: 'fact',
      notes: request.selector === undefined
        ? 'Workspace source snapshot. No field selector was supplied, so the full supported text/JSON file is the evidence value.'
        : 'Workspace field-level evidence snapshot. The full file hash and exact selector/fragment hash are preserved for reproduction. Binary PDF/Office/CAD extraction remains delegated to DSH material/attachment extractors.',
    }

    return { records: Object.freeze([Object.freeze(record)]) }
  }
}
