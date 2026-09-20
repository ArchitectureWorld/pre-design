import { createHash } from 'node:crypto'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.geojson', '.csv', '.yaml', '.yml', '.xml'])
const SOURCE_DIRECTORIES = new Set(['原始资料', 'source-materials'])
const GENERATED_FILES = new Set(['project.json', 'rules.json', 'outline.json', 'manifest.json'])
const MAX_FILES = 64
const MAX_DEPTH = 4

export interface MaterialReadInput {
  readonly path: string
  readonly startPage?: number
  readonly maxPages?: number
  readonly startLine?: number
  readonly maxLines?: number
}

export interface MaterialInventory {
  readonly files: readonly { path: string; byteLength: number; readable: boolean; format: string }[]
  readonly truncated: boolean
}

export interface MaterialReadResult {
  readonly path: string
  readonly contentHash: string
  readonly byteLength: number
  readonly status: 'ok' | 'needs_ocr' | 'empty'
  readonly truncated: boolean
  readonly pageCount?: number
  readonly pages?: readonly { page: number; text: string; truncated: boolean; needsOcr: boolean }[]
  readonly nextPage?: number | null
  readonly text?: string
  readonly startLine?: number
  readonly endLine?: number
  readonly nextLine?: number | null
}

function positiveInteger(name: string, value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}`)
  return value
}

function inside(root: string, target: string): boolean {
  const suffix = relative(root, target)
  return suffix !== '' && suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}

export class WorkspaceMaterialReader {
  private readonly maxChars: number
  private readonly maxBytes: number

  constructor(options: { maxChars?: number; maxBytes?: number } = {}) {
    this.maxChars = positiveInteger('maxChars', options.maxChars ?? 24_000, 200_000)
    this.maxBytes = positiveInteger('maxBytes', options.maxBytes ?? 64 * 1024 * 1024, 128 * 1024 * 1024)
  }

  async list(workspaceRoot: string, signal?: AbortSignal): Promise<MaterialInventory> {
    signal?.throwIfAborted()
    const root = await realpath(workspaceRoot)
    const files: MaterialInventory['files'][number][] = []
    let truncated = false
    const walk = async (directory: string, depth: number): Promise<void> => {
      signal?.throwIfAborted()
      const rows = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      for (const row of rows) {
        signal?.throwIfAborted()
        if (row.name.startsWith('.') || row.isSymbolicLink()) continue
        const requested = join(directory, row.name)
        if (row.isDirectory()) {
          if (depth === 0 && !SOURCE_DIRECTORIES.has(row.name)) continue
          if (depth >= MAX_DEPTH) { truncated = true; continue }
          const target = await realpath(requested)
          if (inside(root, target)) await walk(target, depth + 1)
          continue
        }
        if (!row.isFile() || GENERATED_FILES.has(row.name)) continue
        const extension = extname(row.name).toLowerCase()
        if (depth === 0 && extension !== '.pdf' && !TEXT_EXTENSIONS.has(extension)) continue
        if (files.length >= MAX_FILES) { truncated = true; return }
        const target = await realpath(requested)
        if (!inside(root, target)) continue
        const info = await stat(target)
        files.push({ path: relative(root, target).split(sep).join('/'), byteLength: info.size,
          readable: (extension === '.pdf' || TEXT_EXTENSIONS.has(extension)) && info.size <= this.maxBytes,
          format: extension.slice(1) || 'unknown' })
      }
    }
    await walk(root, 0)
    return { files, truncated }
  }

  async read(workspaceRoot: string, input: MaterialReadInput, signal?: AbortSignal): Promise<MaterialReadResult> {
    signal?.throwIfAborted()
    const root = await realpath(workspaceRoot)
    const requested = resolve(root, input.path)
    if (!input.path.trim() || !inside(root, requested)) throw new Error('material path must be inside the bound workspace')
    const target = await realpath(requested)
    if (!inside(root, target)) throw new Error('material resolves outside the bound workspace')
    const extension = extname(target).toLowerCase()
    if (extension !== '.pdf' && !TEXT_EXTENSIONS.has(extension)) {
      throw new Error(`unsupported material format '${extension}'; CAD/Office/images/archives require a dedicated extractor; no content was read`)
    }
    const file = await open(target, 'r')
    let bytes: Buffer
    try {
      const info = await file.stat()
      if (!info.isFile()) throw new Error('material must be a regular file')
      if (info.size > this.maxBytes) throw new Error(`material exceeds maxBytes (${this.maxBytes})`)
      // Bound the actual read as well as the stat, even if the source grows.
      const buffer = Buffer.alloc(Math.min(info.size + 1, this.maxBytes + 1))
      let offset = 0
      while (offset < buffer.length) {
        signal?.throwIfAborted()
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset)
        if (bytesRead === 0) break
        offset += bytesRead
      }
      if (offset > this.maxBytes || offset > info.size) throw new Error('material changed or exceeds maxBytes; retry with a stable source')
      bytes = buffer.subarray(0, offset)
    } finally { await file.close() }
    signal?.throwIfAborted()
    const source = { path: relative(root, target).split(sep).join('/'), byteLength: bytes.length,
      contentHash: createHash('sha256').update(bytes).digest('hex') }
    if (extension === '.pdf') return { ...source, ...await this.pdf(bytes, input, signal) }

    const startLine = positiveInteger('startLine', input.startLine ?? 1, 10_000_000)
    const maxLines = positiveInteger('maxLines', input.maxLines ?? 200, 1_000)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n')
    const lines = text.split('\n')
    if (startLine > lines.length) throw new Error('startLine is past the end of the material')
    const selected = lines.slice(startLine - 1, startLine - 1 + maxLines)
    const content = selected.join('\n')
    const endLine = startLine + selected.length - 1
    return { ...source, status: content.trim() ? 'ok' : 'empty', text: content.slice(0, this.maxChars),
      startLine, endLine, nextLine: endLine < lines.length ? endLine + 1 : null, truncated: content.length > this.maxChars }
  }

  private async pdf(bytes: Uint8Array, input: MaterialReadInput, signal?: AbortSignal) {
    const startPage = positiveInteger('startPage', input.startPage ?? 1, 100_000)
    const maxPages = positiveInteger('maxPages', input.maxPages ?? 3, 10)
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    signal?.throwIfAborted()
    const packageRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
    const task = getDocument({ data: Uint8Array.from(bytes),
      useSystemFonts: true, disableFontFace: true, verbosity: 0,
      cMapUrl: join(packageRoot, 'cmaps').split(sep).join('/') + '/', cMapPacked: true,
      standardFontDataUrl: join(packageRoot, 'standard_fonts').split(sep).join('/') + '/',
      useWorkerFetch: false })
    const abort = () => { void task.destroy().catch(() => undefined) }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      signal?.throwIfAborted()
      const document = await task.promise
      if (startPage > document.numPages) throw new Error(`requested page exceeds page count ${document.numPages}`)
      const pages: NonNullable<MaterialReadResult['pages']>[number][] = []
      let remaining = this.maxChars
      for (let pageNumber = startPage; pageNumber <= Math.min(document.numPages, startPage + maxPages - 1); pageNumber += 1) {
        signal?.throwIfAborted()
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        signal?.throwIfAborted()
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim()
        pages.push({ page: pageNumber, text: text.slice(0, remaining), truncated: text.length > remaining, needsOcr: !text.trim() })
        remaining -= Math.min(remaining, text.length)
        page.cleanup()
        if (remaining === 0) break
      }
      const lastPage = pages.at(-1)!.page
      return { status: pages.every(page => page.needsOcr) ? 'needs_ocr' as const : 'ok' as const,
        pageCount: document.numPages, pages, nextPage: lastPage < document.numPages ? lastPage + 1 : null,
        truncated: pages.some(page => page.truncated) }
    } catch (error) {
      signal?.throwIfAborted()
      throw error
    } finally {
      signal?.removeEventListener('abort', abort)
      await task.destroy()
    }
  }
}
