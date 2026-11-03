import type { MaterialCorpus, MaterialCorpusDocument } from '../materials/research-evidence.ts'
import { sourceImageCoverage } from '../materials/source-image.ts'
import { assertMaterialCorpus, verifyModuleSourceValues, type ModuleSourceValue } from './module-claims.ts'
import {moduleReferencePromptView} from './module-reference-context.ts'

export interface ModuleCorpusSliceOptions {
  readonly moduleId?: string
  /** Module title, approved fields and/or task terms. Ranking never creates evidence. */
  readonly query: string
  /** Independent professional/QA questions, so a narrow source need is not lost in the broad title score. */
  readonly focusQueries?: readonly string[]
  /** Full serialized slice budget, including locations, omissions and limitations; not a token count. */
  readonly maxMaterialChars?: number
  /** Optional complete serialized UTF-8 byte ceiling, including every audit field. */
  readonly maxMaterialUtf8Bytes?: number
  /** Capacity fallback measures the existing lossless readonly transport, including its audit metadata. */
  readonly materialByteEncoding?: 'readonly-reference'
  /** Always keep the first N available pages/paragraphs of each document. */
  readonly initialPagesPerDocument?: number
  /** Already validated bindings whose complete source spans must stay visible. */
  readonly requiredSources?: readonly ModuleSourceValue[]
  /** Complete audit documents (for example native search logs), identified in the frozen corpus. */
  readonly requiredDocumentPaths?: readonly string[]
}
export interface PromptCorpusDocument {
  readonly provenance?: MaterialCorpusDocument['provenance']
  readonly path: string; readonly contentHash: string; readonly byteLength: number
  readonly pages?: readonly { readonly page: number; readonly text: string }[]
  /** Separate exact spans; never concatenate nonadjacent paragraphs into fictitious original prose. */
  readonly paragraphs?: readonly { readonly paragraph: number; readonly endParagraph?: number; readonly startOffset: number; readonly endOffset: number; readonly text: string; readonly jsonPointer?: string }[]
}
export interface ModuleCorpusSlice {
  /** The complete corpus remains held by the validator. This slice is not a new MaterialCorpus. */
  readonly originalFingerprint: string
  readonly documents: readonly PromptCorpusDocument[]
  readonly limitations: readonly string[]
  readonly selection: {
    readonly method: 'whole-source-span-v3'; readonly maxMaterialChars: number; readonly boundary: string
    readonly maxMaterialUtf8Bytes?: number
    readonly materialByteEncoding?: 'readonly-reference'
    readonly omitted: readonly { readonly path: string; readonly contentHash: string; readonly pages?: readonly number[]; readonly paragraphs?: readonly number[];
      /** Inclusive exact ranges, used only when shorter than the explicit ordinal list. */
      readonly pageRanges?: readonly (readonly [number, number])[]; readonly paragraphRanges?: readonly (readonly [number, number])[] }[]
    readonly excludedAcquisition?: { readonly documentCount: number; readonly reason: string }
  }
}
interface Unit {
  document: MaterialCorpusDocument; ordinal: number; text: string; page?: number
  paragraphs?: number[]; startOffset?: number; endOffset?: number; jsonPointer?: string; required: boolean
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const norm = (text: string) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim()
const fail = (code: string, detail: string): never => { throw new Error(`${code}: ${detail}`) }

/** Whole top-level JSON entries, retaining original lexemes and offset identity.
 * JSON.parse validates syntax only; it never reserializes the source values. */
function jsonUnits(document: MaterialCorpusDocument): Unit[] | undefined {
  const text = document.text!, start = text.search(/\S/u), open = text[start]
  if (document.image || text.length < 2000 || !['[', '{'].includes(open)) return
  try { JSON.parse(text) } catch { return }
  const units: Unit[] = []
  let depth = 1, inString = false, escaped = false, entryStart = start + 1
  const add = (end: number) => {
    let from = entryStart, to = end
    while (from < to && /\s/u.test(text[from])) from++
    while (to > from && /\s/u.test(text[to - 1])) to--
    if (from === to) return
    const source = text.slice(from, to)
    const key = open === '[' ? String(units.length) : JSON.parse(source.match(/^"(?:[^"\\]|\\.)*"/u)![0]) as string
    const ordinal = units.length + 1
    units.push({ document, ordinal, paragraphs: [ordinal], startOffset: from, endOffset: to, text: source,
      jsonPointer: '/' + key.replace(/~/gu, '~0').replace(/\//gu, '~1'), required: false })
  }
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
    } else if (char === '"') inString = true
    else if (char === '[' || char === '{') depth++
    else if (char === ']' || char === '}') { if (--depth === 0) { add(i); break } }
    else if (char === ',' && depth === 1) { add(i); entryStart = i + 1 }
  }
  return units.length ? units : undefined
}

function paragraphUnits(document: MaterialCorpusDocument): Unit[] {
  const entries = jsonUnits(document)
  if (entries) return entries
  const text = document.text!, units: Unit[] = []
  let start = 0, ordinal = 0
  for (const match of text.matchAll(/\r?\n[\t ]*\r?\n/gu)) {
    const end = match.index!
    if (text.slice(start, end).trim()) units.push({ document, ordinal: ++ordinal, paragraphs: [ordinal], startOffset: start, endOffset: end, text: text.slice(start, end), required: false })
    start = end + match[0].length
  }
  if (text.slice(start).trim()) units.push({ document, ordinal: ++ordinal, paragraphs: [ordinal], startOffset: start, endOffset: text.length, text: text.slice(start), required: false })
  return units
}
function terms(query: string): string[] {
  const result = new Set<string>()
  for (const match of query.normalize('NFKC').toLowerCase().matchAll(/[a-z0-9_]{2,}|\p{Script=Han}+/gu)) {
    const text = match[0]
    if (/^[a-z0-9_]+$/u.test(text) || text.length < 2) result.add(text)
    else for (let i = 0; i < text.length - 1; i++) result.add(text.slice(i, i + 2))
  }
  return [...result].sort(compare)
}

function omittedOrdinals(kind: 'pages' | 'paragraphs', values: number[]) {
  const ranges: [number, number][] = []
  for (const value of values) {
    const last = ranges.at(-1)
    if (last && last[1] + 1 === value) last[1] = value
    else ranges.push([value, value])
  }
  const explicit = { [kind]: values }, compact = { [kind === 'pages' ? 'pageRanges' : 'paragraphRanges']: ranges }
  return JSON.stringify(compact).length < JSON.stringify(explicit).length ? compact : explicit
}

/** Pure prompt projection. The original corpus and all candidate/output fields stay untouched. */
export function sliceModuleCorpus(corpus: MaterialCorpus, options: ModuleCorpusSliceOptions): ModuleCorpusSlice {
  assertMaterialCorpus(corpus)
  let maxMaterialChars = options.maxMaterialChars ?? 12_000
  const maxMaterialUtf8Bytes = options.maxMaterialUtf8Bytes
  const materialByteEncoding=options.materialByteEncoding
  const materialBytes=(serialized:string)=>Buffer.byteLength(materialByteEncoding==='readonly-reference'
    ?JSON.stringify(moduleReferencePromptView(JSON.parse(serialized),true)):serialized,'utf8')
  const initial = options.initialPagesPerDocument ?? 2
  if (!Number.isSafeInteger(maxMaterialChars) || maxMaterialChars < 1 || !Number.isSafeInteger(initial) || initial < 1
    || maxMaterialUtf8Bytes !== undefined && (!Number.isSafeInteger(maxMaterialUtf8Bytes) || maxMaterialUtf8Bytes < 1)
    || materialByteEncoding!==undefined&&materialByteEncoding!=='readonly-reference') {
    fail('MODULE_PROMPT_OPTIONS_INVALID', 'positive integer budget and initial page count required')
  }
  const requiredSources = options.requiredSources ?? []
  const requiredDocumentPaths = new Set(options.requiredDocumentPaths ?? [])
  for (const path of requiredDocumentPaths) {
    if (typeof path !== 'string' || !path.trim()) fail('MODULE_PROMPT_OPTIONS_INVALID', 'required frozen document path must be non-empty')
    if (!corpus.documents.some(document => document.path === path)) fail('MODULE_PROMPT_REQUIRED_SOURCE_MISSING', 'required frozen document is unavailable')
  }
  try { verifyModuleSourceValues(corpus, requiredSources) }
  catch (error) { fail('MODULE_PROMPT_REQUIRED_SOURCE_MISSING', error instanceof Error ? error.message : String(error)) }
  const documents = corpus.documents.filter(document => requiredDocumentPaths.has(document.path) || !options.moduleId || !document.provenance
    || document.provenance.queryKeys.some(key => key.startsWith(options.moduleId + ':')) || requiredSources.some(source => source.path === document.path && source.contentHash === document.contentHash))
    .sort((a, b) => compare(a.path, b.path))
  const excludedAcquisition = corpus.documents.length - documents.length
  const photoCoverage = new Set(sourceImageCoverage(documents).map(doc => doc.path))
  const allUnits: Unit[] = []
  for (const document of documents) {
    const completePolicySource = options.moduleId === '1.03'
      && document.provenance?.queryKeys.some(key => key.startsWith('1.03:'))
    let units: Unit[] = document.pages
      ? [...document.pages].sort((a, b) => a.page - b.page).map(({ page, text }, index) => ({ document, ordinal: index + 1, page, text, required: false }))
      : paragraphUnits(document)
    const bindings = requiredSources.filter(source => source.path === document.path && source.contentHash === document.contentHash)
    // Policy identities, amendments and exceptions require the complete acquired
    // original, rather than independently ranked paragraphs. A single exact span
    // keeps original whitespace and offsets without repeating per-paragraph metadata.
    // Cross-paragraph bound quotes require the same contiguous representation.
    if (!document.pages && (completePolicySource || bindings.some(source => !units.some(unit => norm(unit.text).includes(norm(source.quote)))))) {
      units = [{ document, ordinal: 1, paragraphs: units.flatMap(unit => unit.paragraphs!), startOffset: 0, endOffset: document.text!.length,
        text: document.text!, required: true }]
    }
    for (const unit of units) {
      // Each photo keeps its complete capture record; repeated metadata caveats
      // are already preserved once in corpus limitations and remain addressable.
      unit.required ||= completePolicySource || requiredDocumentPaths.has(document.path) || unit.ordinal <= (document.image ? Number(photoCoverage.has(document.path)) : initial) && (!document.provenance || !options.moduleId || document.provenance.queryKeys.some(key => key.startsWith(options.moduleId + ':'))) || bindings.some(source => document.pages
        ? source.page === unit.page : norm(unit.text).includes(norm(source.quote)))
      allUnits.push(unit)
    }
  }
  const selected = new Set(allUnits.filter(unit => unit.required))
  const build = (): ModuleCorpusSlice => {
    const visible: PromptCorpusDocument[] = [], omitted: ModuleCorpusSlice['selection']['omitted'][number][] = []
    for (const document of documents) {
      const units = allUnits.filter(unit => unit.document === document), included = units.filter(unit => selected.has(unit)), excluded = units.filter(unit => !selected.has(unit))
      if (included.length) visible.push({ path: document.path, contentHash: document.contentHash, byteLength: document.byteLength,
        ...(document.provenance ? { provenance: document.provenance } : {}),
        ...(document.pages ? { pages: included.map(unit => ({ page: unit.page!, text: unit.text })) }
          : { paragraphs: included.map(unit => ({ paragraph: unit.paragraphs![0],
            ...(unit.paragraphs!.length > 1 ? { endParagraph: unit.paragraphs!.at(-1)! } : {}),
            startOffset: unit.startOffset!, endOffset: unit.endOffset!, text: unit.text,
            ...(unit.jsonPointer !== undefined ? { jsonPointer: unit.jsonPointer } : {}) })) }) })
      if (excluded.length) omitted.push({ path: document.path, contentHash: document.contentHash,
        ...omittedOrdinals(document.pages ? 'pages' : 'paragraphs', document.pages ? excluded.map(unit => unit.page!) : excluded.flatMap(unit => unit.paragraphs!)) })
    }
    return { originalFingerprint: corpus.fingerprint, documents: visible, limitations: [...corpus.limitations],
      selection: { method: 'whole-source-span-v3', maxMaterialChars,
        ...(maxMaterialUtf8Bytes === undefined ? {} : { maxMaterialUtf8Bytes }),
        ...(materialByteEncoding===undefined?{}:{materialByteEncoding}),
        boundary: '仅含按模块相关性选择的完整物理页、原文段落或JSON顶层条目。jsonPointer标识JSON条目，paragraph为条目序号，偏移始终对应原文；片段不代表完整JSON。遗漏清单中的内容未提供；pageRanges/paragraphRanges为首尾均包含的完整编号区间，不得推断未选页或段落的事实、缺失、否定结论；需要时补充原文。文件名和排序得分不是事实证据。中央校验仍使用完整冻结原文。',
        omitted, ...(excludedAcquisition ? { excludedAcquisition: { documentCount: excludedAcquisition,
          reason: '其他模块的网页原文未提供；完整文档清单绑定originalFingerprint并保存在冻结corpus，不得声称读过这些原文。' } } : {}) } }
  }
  const mandatory = build(), mandatoryChars = JSON.stringify(mandatory).length
  // Required covers and navigation must not consume the entire adaptive budget.
  // Keep room for relevance-ranked, whole source passages as well. Explicit
  // caller limits and the native ceiling stay strict; no source is truncated.
  if (options.maxMaterialChars === undefined) maxMaterialChars = Math.min(48_000,
    Math.max(maxMaterialChars, Math.ceil((mandatoryChars + 12_000) / 1000) * 1000))
  if (mandatoryChars > maxMaterialChars) fail('MODULE_PROMPT_BUDGET_EXCEEDED', `mandatory original spans and metadata require ${mandatoryChars} characters; budget ${maxMaterialChars}`)
  const mandatoryUtf8Bytes = materialBytes(JSON.stringify(build()))
  if (maxMaterialUtf8Bytes !== undefined && mandatoryUtf8Bytes > maxMaterialUtf8Bytes) {
    fail('MODULE_PROMPT_BUDGET_EXCEEDED', `mandatory original spans and metadata require ${mandatoryUtf8Bytes} UTF-8 bytes; budget ${maxMaterialUtf8Bytes}`)
  }
  // A public data endpoint may identify a record only in its query parameters.
  // Use identifiers from the SAME acquisition query to rank its companion
  // table. They are search hints only, never source assertions or join results.
  const linkedTerms = new Map(documents.map(document => [document, terms(documents.filter(peer =>
    peer.provenance?.queryKeys.some(key => document.provenance?.queryKeys.includes(key)))
    .flatMap(peer => { try { return [...new URL(peer.provenance!.sourceUri).searchParams.values()] } catch { return [] } }).join(' '))]))
  const rank = (units: readonly Unit[], query: string) => {
    const queryTerms = terms(query)
    return units.map(unit => {
    const text = norm(unit.text).toLowerCase()
    return { unit, score: [...new Set([...queryTerms, ...linkedTerms.get(unit.document) ?? []])].reduce((score, term) => score + Number(text.includes(term)), 0) }
    }).sort((a, b) => b.score - a.score || compare(a.unit.document.path, b.unit.document.path) || a.unit.ordinal - b.unit.ordinal)
  }
  const ranked = rank(allUnits.filter(unit => !selected.has(unit)), options.query)
  const tryInclude = (units: readonly Unit[], limit = maxMaterialChars, byteLimit = maxMaterialUtf8Bytes) => {
    const added = units.filter(unit => !selected.has(unit))
    for (const unit of added) selected.add(unit)
    const serialized = JSON.stringify(build())
    if (serialized.length > limit || byteLimit !== undefined && materialBytes(serialized) > byteLimit) {
      for (const unit of added) selected.delete(unit)
      return false
    }
    return true
  }
  const adjacent = (unit: Unit) => allUnits.filter(other => other.document === unit.document && Math.abs(other.ordinal - unit.ordinal) <= 1)
  // Reserve at most half the remaining space for relevant original passages.
  // Web navigation/body text must not starve user originals, and a large original
  // must not starve acquired bodies. Whole spans and the total ceiling stay strict.
  const originalLimit = Math.floor((JSON.stringify(build()).length + maxMaterialChars) / 2)
  const originalByteLimit = maxMaterialUtf8Bytes === undefined ? undefined : Math.floor((mandatoryUtf8Bytes + maxMaterialUtf8Bytes) / 2)
  const originals = documents.filter(document => !document.provenance)
  for (const queries of [options.focusQueries ?? [], [options.query]]) {
    const originalPassages: Unit[] = []
    for (const query of queries) for (const document of originals) {
      const first = rank(allUnits.filter(unit => unit.document === document && !unit.required), query).find(row => row.score > 0)?.unit
      if (first && !originalPassages.includes(first)) originalPassages.push(first)
    }
    // Cover separate QA questions before expanding any one neighborhood; their
    // source context takes priority over broad-title matches such as contents pages.
    for (const unit of originalPassages) tryInclude([unit], originalLimit, originalByteLimit)
    for (const unit of originalPassages) if (selected.has(unit)) for (const neighbor of adjacent(unit)) tryInclude([neighbor], originalLimit, originalByteLimit)
  }
  // Give each acquisition a substantive passage before taking additional ones.
  // Neighbors keep table labels/values and article context together; ranking
  // does not itself establish relevance, currentness, or factual quality.
  const acquired = documents.filter(document => document.provenance && (!options.moduleId
    || document.provenance.queryKeys.some(key => key.startsWith(options.moduleId + ':'))))
  const passages = acquired.map(document => ranked.filter(row => row.unit.document === document && row.score > 0).slice(0, 3))
  for (const candidates of passages) if (candidates[0]) tryInclude([candidates[0].unit])
  for (let round = 0; round < 3; round++) for (const candidates of passages) {
    const unit = candidates[round]?.unit
    if (unit) tryInclude(adjacent(unit))
  }
  for (const { unit } of ranked) {
    if (!selected.has(unit)) tryInclude([unit])
  }
  return build()
}
