import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { EvidenceRecord } from '../research/types.ts'
import { WorkspaceMaterialReader, type MaterialInventory, type MaterialReadResult } from './workspace-materials.ts'
import { SOURCE_IMAGE_EXTENSIONS, SOURCE_IMAGE_LIMITATIONS, type SourceImageIdentity } from './source-image.ts'

const MAX_CORPUS_CHARS = 180_000
const TEXT_FORMATS = new Set(['txt', 'md', 'json', 'geojson', 'csv', 'yaml', 'yml', 'xml'])

export interface MaterialCorpusDocument {
  readonly image?: SourceImageIdentity
  readonly path: string
  readonly contentHash: string
  readonly byteLength: number
  readonly pages?: readonly { page: number; text: string }[]
  readonly text?: string
  readonly provenance?: { readonly sourceUri: string; readonly retrievedAt: string; readonly rawHash: string; readonly claimClass: 'source_conclusion'; readonly queryKeys: readonly string[] }
}

export interface MaterialCorpus {
  readonly documents: readonly MaterialCorpusDocument[]
  readonly limitations: readonly string[]
  readonly fingerprint: string
  readonly acquisition?: { readonly version: 'module-web-acquisition.v1'; readonly originalFingerprint: string; readonly bundles: readonly { readonly runId: string; readonly manifestHash: string }[];
    readonly queries: readonly { readonly key: string; readonly moduleId: string; readonly queryIndex: number; readonly status: 'acquired' | 'searched-empty' | 'failed'; readonly sourcePaths: readonly string[]; readonly error?: string }[] }
}

export function materialCorpusFingerprint(corpus: Omit<MaterialCorpus, 'fingerprint'>): string {
  return createHash('sha256').update(JSON.stringify({ documents: corpus.documents, limitations: corpus.limitations,
    ...(corpus.acquisition ? { acquisition: corpus.acquisition } : {}) })).digest('hex')
}

export interface MaterialEvidenceBinding {
  readonly dataPointId: string
  readonly path: string
  readonly contentHash: string
  /** Required for a PDF: the physical, one-based page number. */
  readonly page?: number
  readonly quote: string
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const normalizeQuote = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
const sourceFiles = (inventory: MaterialInventory) => {
  const originals = inventory.files.filter(file => file.path.startsWith('原始资料/'))
  // A capped listing may stop before reaching 原始资料. It cannot prove originals are absent.
  return originals.length || inventory.truncated ? originals : inventory.files.filter(file => file.path.startsWith('source-materials/'))
}

function assertHash(result: MaterialReadResult, expected: string): void {
  if (result.contentHash !== expected) throw new Error(`material content hash changed or does not match: ${result.path}`)
}

/** Bounded snapshots contain only extracted source text; filenames never become source assertions. */
export async function captureMaterialCorpus(
  workspaceRoot: string,
  options: { reader?: WorkspaceMaterialReader; maxChars?: number; signal?: AbortSignal } = {},
): Promise<MaterialCorpus> {
  const { signal } = options
  signal?.throwIfAborted()
  const maxChars = options.maxChars ?? MAX_CORPUS_CHARS
  if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > MAX_CORPUS_CHARS) {
    throw new Error(`maxChars must be an integer from 1 to ${MAX_CORPUS_CHARS}`)
  }
  const reader = options.reader ?? new WorkspaceMaterialReader({ maxChars: 200_000 })
  const inventory = await reader.list(workspaceRoot, signal)
  signal?.throwIfAborted()
  const limitations: string[] = inventory.truncated ? ['Material inventory truncated; additional files or deeper directories were not inspected.'] : []
  if (inventory.truncated && !sourceFiles(inventory).length) {
    limitations.push('Fallback source-materials withheld: the truncated inventory cannot establish that original source files are absent.')
  }
  const documents: MaterialCorpusDocument[] = []
  const hashes = new Set<string>()
  let remaining = maxChars
  for (const file of sourceFiles(inventory)) {
    signal?.throwIfAborted()
    if (!file.readable) {
      limitations.push(`${file.path}: ${file.format !== 'pdf' && !TEXT_FORMATS.has(file.format) && !SOURCE_IMAGE_EXTENSIONS.has(`.${file.format}`) ? 'unsupported format' : 'oversized material'}; no content extracted.`)
      continue
    }
    if (remaining === 0) {
      limitations.push(`${file.path}: not read because the corpus character limit was reached.`)
      continue
    }
    try {
      const pdf = file.format === 'pdf'
      let cursor = 1
      let contentHash: string | undefined
      let image: SourceImageIdentity | undefined
      let byteLength = 0
      let text = ''
      const pages: { page: number; text: string }[] = []
      let duplicate = false
      while (true) {
        const result = await reader.read(workspaceRoot, { path: file.path,
          ...(pdf ? { startPage: cursor, maxPages: 10 } : { startLine: cursor, maxLines: 1_000 }) }, signal)
        signal?.throwIfAborted()
        if (contentHash !== undefined) assertHash(result, contentHash)
        else {
          contentHash = result.contentHash
          byteLength = result.byteLength
          image = result.image
          if (hashes.has(contentHash)) { duplicate = true; break }
        }
        if (pdf) {
          for (const page of result.pages ?? []) {
            const selected = page.text.slice(0, remaining)
            pages.push({ page: page.page, text: selected })
            remaining -= selected.length
            if (page.truncated || selected.length < page.text.length) limitations.push(`${file.path}: page ${page.page} text truncated during extraction or at the corpus character limit.`)
            if (page.needsOcr) limitations.push(`${file.path}: page ${page.page} needs OCR; no source text was extracted.`)
          }
        } else {
          const content = (cursor === 1 ? '' : '\n') + (result.text ?? '')
          const selected = content.slice(0, remaining)
          text += selected
          remaining -= selected.length
          if (result.truncated || selected.length < content.length) limitations.push(`${file.path}: text truncated during extraction or at the corpus character limit.`)
          if (result.status === 'empty') limitations.push(`${file.path}: empty extracted text at line ${cursor}.`)
        }
        const next = pdf ? result.nextPage : result.nextLine
        if (next == null) break
        if (remaining === 0) {
          limitations.push(`${file.path}: remaining ${pdf ? 'pages' : 'lines'} starting at ${next} not read; corpus character limit reached.`)
          break
        }
        if (next <= cursor) throw new Error('material reader pagination did not advance')
        cursor = next
      }
      if (!duplicate && contentHash !== undefined) {
        hashes.add(contentHash)
        if (image && !documents.some(doc => doc.image)) limitations.push(...SOURCE_IMAGE_LIMITATIONS)
        documents.push({ path: file.path, contentHash, byteLength, ...(pdf ? { pages } : { text }), ...(image ? { image } : {}) })
      }
    } catch (error) {
      signal?.throwIfAborted()
      limitations.push(`${file.path}: extraction failed; ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  signal?.throwIfAborted()
  return { documents, limitations, fingerprint: sha256(JSON.stringify({ documents, limitations })) }
}

async function checkedSourcePath(root: string, path: string, allowed: ReadonlySet<string>): Promise<string> {
  if (!path.trim() || isAbsolute(path)) throw new Error('material path must identify a relative source inside the workspace')
  const requested = resolve(root, path)
  const suffix = relative(root, requested)
  if (suffix === '' || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
    throw new Error('material path is outside the workspace')
  }
  const target = await realpath(requested).catch(() => { throw new Error(`material source is missing: ${path}`) })
  const actual = relative(root, target).split(sep).join('/')
  if (!allowed.has(actual)) throw new Error(`material is not an inventoried original source inside the workspace: ${path}`)
  return target
}

/**
 * Re-read each binding, then match only a contiguous NFKC/whitespace-normalized quote.
 * Duplicate dataPointId bindings reject the entire batch; callers select one source per data point.
 * These records preserve historical source assertions and do not verify current legal/project facts.
 */
export async function verifyMaterialBindings(
  workspaceRoot: string,
  workflowId: string,
  bindings: readonly MaterialEvidenceBinding[],
  options: { reader?: WorkspaceMaterialReader; signal?: AbortSignal; now?: string } = {},
): Promise<EvidenceRecord[]> {
  const { signal } = options
  signal?.throwIfAborted()
  if (!workflowId.trim()) throw new Error('workflowId must be non-empty')
  const ids = new Set<string>()
  for (const binding of bindings) {
    if (typeof binding.dataPointId !== 'string' || !binding.dataPointId.trim()) throw new Error('dataPointId must be non-empty')
    if (ids.has(binding.dataPointId)) throw new Error(`duplicate dataPointId binding: ${binding.dataPointId}`)
    ids.add(binding.dataPointId)
    if (typeof binding.quote !== 'string' || !normalizeQuote(binding.quote)) throw new Error('material quote must be non-empty')
    if (binding.quote.length > 200_000) throw new Error('material quote exceeds extraction character limit')
    if (typeof binding.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(binding.contentHash)) throw new Error('material content hash must be SHA-256')
    if (typeof binding.path !== 'string') throw new Error('material source path must be a string')
  }
  const capturedAt = options.now ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error('now must be a valid timestamp')
  const reader = options.reader ?? new WorkspaceMaterialReader({ maxChars: 200_000 })
  const root = await realpath(workspaceRoot)
  const inventory = await reader.list(root, signal)
  const allowed = new Set(sourceFiles(inventory).filter(file => file.readable).map(file => file.path))
  const records: EvidenceRecord[] = []
  for (const binding of bindings) {
    signal?.throwIfAborted()
    const target = await checkedSourcePath(root, binding.path, allowed)
    signal?.throwIfAborted()
    const path = relative(root, target).split(sep).join('/')
    const pdf = extname(target).toLowerCase() === '.pdf'
    if (pdf && (!Number.isSafeInteger(binding.page) || binding.page! < 1)) throw new Error('PDF binding requires a physical page number')
    if (!pdf && binding.page !== undefined) throw new Error('text material bindings cannot specify a PDF page')
    const quote = normalizeQuote(binding.quote)
    let cursor = 1
    let tail = ''
    let matched = false
    let truncated = false
    let byteLength = 0
    while (true) {
      const result = await reader.read(root, { path, ...(pdf
        ? { startPage: binding.page, maxPages: 1 }
        : { startLine: cursor, maxLines: 1_000 }) }, signal)
      signal?.throwIfAborted()
      assertHash(result, binding.contentHash)
      byteLength = result.byteLength
      const content = pdf ? result.pages?.find(page => page.page === binding.page)?.text ?? '' : result.text ?? ''
      const normalized = normalizeQuote(tail + content)
      matched = normalized.includes(quote)
      truncated ||= result.truncated
      if (matched || pdf || result.nextLine == null) break
      if (result.nextLine <= cursor) throw new Error('material reader pagination did not advance')
      // Never join across text omitted by an extractor character limit.
      tail = result.truncated ? '' : normalized.slice(-quote.length) + '\n'
      cursor = result.nextLine
    }
    if (!matched) throw new Error(`material quote was not found contiguously in ${path}${pdf ? ` page ${binding.page}` : ''}${truncated ? '; extraction was truncated' : ''}`)
    const fragmentHash = sha256(binding.quote)
    const locator = { relativePath: path, ...(pdf ? { page: binding.page } : {}), quote: binding.quote, fragmentHash, byteLength }
    records.push({
      evidenceId: `ev-${sha256(JSON.stringify([workflowId, binding.dataPointId, path, binding.page ?? null, binding.contentHash, fragmentHash])).slice(0, 32)}`,
      workflowId, dataPointId: binding.dataPointId, sourceId: 'workspace-project-files', sourceType: 'workspace_file',
      sourceUri: pathToFileURL(target).href, sourceTitle: basename(target), publisher: '项目原始资料',
      publishedAt: null, capturedAt, asOf: null, locator, rawValue: binding.quote, normalizedValue: binding.quote,
      unit: null, contentHash: binding.contentHash, reliability: 'B', claimClass: 'source_conclusion',
      notes: 'Quote verified against the original file hash and extracted source text. Historical source assertion; current legal validity and project status are not independently verified.',
    })
  }
  signal?.throwIfAborted()
  return records
}
