import { createHash } from 'node:crypto'
import { z } from 'zod'
import { materialCorpusFingerprint, type MaterialCorpus } from '../materials/research-evidence.ts'
import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { readJsonPointer } from './regional-schema.ts'
import {verifyPhotoCoordinateMapping} from './photo-coordinate-mapping.ts'
import {verifyPhotoDateMapping} from './photo-date-mapping.ts'
import {verifySourceCalendarDateMapping,assertSourceCalendarDateMappingClaimTarget} from './source-calendar-date-mapping.ts'
import {verifyNativeQueryStringMapping} from './native-query-string-mapping.ts'
import {moduleSourceQuoteAnchorCandidates} from './module-source-quote-anchors.ts'

const label = z.string().trim().min(1).max(1000)
const sourceSchema = z.object({ sourceId: label, path: label, contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  page: z.number().int().positive().optional(), quote: z.string().min(1).max(200_000),
  rawValue: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]), valueQuote: z.string().min(1).optional(),
  coordinateMapping:z.object({kind:z.literal('photo-gps-axis-order.v1'),axisOrder:z.enum(['xy','yx']),xValueQuote:z.string().min(1),yValueQuote:z.string().min(1)}).strict().optional(),
  dateMapping:z.union([z.object({kind:z.literal('photo-exif-calendar-date.v1'),dateTimeOriginalQuote:z.string().min(1)}).strict(),
    z.object({kind:z.literal('source-calendar-date.v1'),calendarDateQuote:z.string().min(1)}).strict()]).optional(),
  queryMapping:z.object({kind:z.literal('native-search-query-json-string.v1'),callId:z.string().min(1),queryIndex:z.number().int().nonnegative()}).strict().optional(),
}).strict()
const refSchema = z.object({ moduleId: label, claimId: label }).strict()
const scenarioAssumptionSchema=z.object({value:z.number().finite(),unit:label,rationale:z.string().trim().min(1).max(20_000)}).strict()
const operandSchema = z.union([z.object({ sourceId: label }).strict(), z.object({ claimId: label, moduleId: label.optional() }).strict(),
  z.object({scenarioAssumption:scenarioAssumptionSchema}).strict()])
const claimSchema = z.object({ claimId: label, selector: z.string().startsWith('/outputs/').max(2000),
  kind: z.enum(['source', 'calculation', 'assumption', 'proposal', 'inference', 'missing']), value: z.unknown(), unit: label.optional(),
  sourceId: label.optional(), inputRefs: z.array(refSchema).max(200).optional(), rationale: z.string().trim().min(1).max(20_000).optional(),
  calculation: z.object({ operation: z.enum(['sum', 'difference', 'product', 'ratio', 'weighted_mean', 'min', 'max']),
    basis: z.enum(['source', 'scenario']).optional(),
    operands: z.array(operandSchema).min(1).max(1000), weights: z.array(operandSchema).min(1).max(1000).optional() }).strict().optional(),
}).strict()
export type ModuleSourceValue = z.infer<typeof sourceSchema>
export type ModuleClaim = z.infer<typeof claimSchema>
export type ModuleClaimReference = z.infer<typeof refSchema>
export type ModuleOperand = z.infer<typeof operandSchema>
export interface ClaimUpstream { readonly moduleId: string; readonly claims: readonly ModuleClaim[] }
// PDF extraction inserts spaces/single line wraps within Chinese words. Match
// those layout-only gaps without joining Latin words, digits or paragraphs.
// Original corpus/quote bytes and their hashes are always retained unchanged.
const norm = (v: string) => v.normalize('NFKC').replace(/\s+/gu, ' ').trim()
const pdfLayoutNorm = (v: string) => v.normalize('NFKC')
  .replace(/(?<=\p{Script=Han})(?:[ \t]+|[ \t]*\r?\n[ \t]*)(?=\p{Script=Han})/gu, '')
  .replace(/(?<=[。、《》〈〉【】「」『』〔〕])(?:[ \t]+|[ \t]*\r?\n[ \t]*)(?=\S)/gu, '')
  .replace(/(?<=\S)(?:[ \t]+|[ \t]*\r?\n[ \t]*)(?=[。、《》〈〉【】「」『』〔〕])/gu, '')
  .replace(/\s+/gu, ' ').trim()
const fail = (code: string, detail: string): never => { throw new Error(`${code}: ${detail}`) }
const equal = (a: unknown, b: unknown) => sha256CanonicalJson(a) === sha256CanonicalJson(b)
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Explain exact submitted numeric bindings, never suggest a new business value. */
export function moduleSourceNumberDiagnostic(source: Pick<ModuleSourceValue, 'rawValue' | 'valueQuote' | 'quote'>) {
  if (typeof source.rawValue !== 'number' || typeof source.valueQuote !== 'string') return undefined
  const spelling = source.valueQuote.trim()
  const numericSpelling = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(spelling)
  const valueQuoteParsesToRawValue = numericSpelling && Number(spelling) === source.rawValue
  const tokens: string[] = norm(source.quote).match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []
  const valueQuoteIsWholeNumericToken = tokens.includes(spelling)
  if (valueQuoteParsesToRawValue && valueQuoteIsWholeNumericToken) return undefined
  return { rule: 'Number(valueQuote) must equal rawValue and valueQuote must be a whole numeric token in the exact source quote',
    ...(numericSpelling && spelling.length <= 220 ? { valueQuote: spelling } : {}),
    valueQuoteParsesToRawValue, valueQuoteIsWholeNumericToken,
    boundary: 'Recheck the original source and author the exact supported value. Do not round, add tolerance, relabel evidence or mechanically rewrite the draft to pass.' }
}

/** Shared by partial author checks and final claims: the evidence gate is unchanged. */
export function moduleInferenceBasisDiagnostic(value: unknown, inputRefs?: readonly unknown[]): string | undefined {
  const problems = []
  if (!inputRefs?.length) problems.push('inference requires at least one valid inputRefs dependency')
  if (containsNumber(value)) problems.push('inference must not contain numeric leaves; numbers require exact source or independently checked calculation evidence')
  return problems.length ? problems.join('; ') + '; recheck source support, preserve unsupported values as missing; do not relabel or invent evidence to pass' : undefined
}

/** The existing complete-claim unit rule, also usable before complete merge. */
export function moduleClaimUnitConflict(outputs:Record<string,unknown>,claim:Pick<ModuleClaim,'selector'|'unit'>){
  if(!claim.unit||!/\/(?:value|amount)$/u.test(claim.selector))return undefined
  const container=readJsonPointer({outputs},claim.selector.slice(0,claim.selector.lastIndexOf('/')))
  if(isObject(container)&&(container.unit??container.currency)!==claim.unit)
    return {declaredUnit:claim.unit,containerUnit:container.unit??container.currency??null}
  return undefined
}

/** Bounded exact source excerpt for a rejected quote, never a suggested replacement
 * value or a relaxed match. The original text and submitted quote remain intact. */
export function moduleSourceQuoteDiagnostic(corpus: MaterialCorpus, source: Pick<ModuleSourceValue, 'path' | 'page' | 'quote'>) {
  const document = corpus.documents.find(row => row.path === source.path)
  const original = document?.pages ? document.pages.find(page => page.page === source.page)?.text
    : source.page === undefined ? document?.text : undefined
  if (!norm(source.quote) || original !== undefined && (norm(original).includes(norm(source.quote))
    || document?.pages !== undefined && pdfLayoutNorm(original).includes(pdfLayoutNorm(source.quote)))) return undefined
  const anchor = source.quote.slice(0, 12), position = anchor.length >= 8 ? original?.indexOf(anchor) ?? -1 : -1
  const uniqueAnchor = original !== undefined && position >= 0 && original.lastIndexOf(anchor) === position
  const start = uniqueAnchor ? Math.max(0, position - 80) : 0
  // Locate the original quote only. These frozen identities are diagnostic
  // candidates; the verifier never switches paths or accepts another source.
  const quoteLocationMatches: {path:string;contentHash:string;page?:number;literalExactMatch:boolean}[] = []
  if (norm(source.quote)) locations: for (const candidate of corpus.documents) {
    const locations = candidate.pages ?? [{page:undefined,text:candidate.text!}]
    for (const location of locations) {
      if (candidate.path === source.path && location.page === source.page) continue
      if (!norm(location.text).includes(norm(source.quote))
        && !(candidate.pages !== undefined && pdfLayoutNorm(location.text).includes(pdfLayoutNorm(source.quote)))) continue
      quoteLocationMatches.push({path:candidate.path,contentHash:candidate.contentHash,
        ...(location.page === undefined ? {} : {page:location.page}),literalExactMatch:location.text.includes(source.quote)})
      if (quoteLocationMatches.length === 4) break locations
    }
  }
  // Display original gap characters explicitly: models may silently clean spaces
  // around punctuation even when an exact PDF excerpt was already provided.
  // This is diagnostic data only; it never participates in quote matching.
  const focusEnd = Math.min(start + 640, position + Math.min(source.quote.length, 320) + 32)
  const sourceWhitespaceContexts = uniqueAnchor && original !== undefined ? [...original.slice(position, focusEnd).matchAll(/\s+/gu)].slice(0, 8).map(match => {
    const offset = position + match.index!
    return { sourceOffset: offset, codePoints: [...match[0]].slice(0, 8).map(character => 'U+' + character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')),
      before: original.slice(Math.max(position, offset - 7), offset), after: original.slice(offset + match[0].length, Math.min(focusEnd, offset + match[0].length + 7)) }
  }) : []
  const quoteAnchorCandidates = quoteLocationMatches.length ? [] : moduleSourceQuoteAnchorCandidates(corpus,source.quote)
  // A PDF excerpt can omit its prefix yet already reach the physical page end.
  // Explain that boundary without joining pages or changing evidence matching.
  const pageTail = uniqueAnchor && original !== undefined ? pdfLayoutNorm(original.slice(position)) : ''
  const normalizedQuote = pdfLayoutNorm(source.quote)
  const nextPage = document?.pages?.find(page => page.page === (source.page ?? 0) + 1)
  const sourcePageBoundaryDiagnostic = document?.pages && original !== undefined ? {
    diagnosticOnly: true, physicalPage: source.page, contentHash: document.contentHash, sourceChars: original.length,
    sourceExcerptStart: start, sourceExcerptEnd: Math.min(start + 640, original.length),
    excerptPrefixOmitted: start > 0, excerptSuffixOmitted: original.length > start + 640,
    sourceExcerptReachesPageEnd: original.length <= start + 640,
    pageEndingExcerpt: original.slice(-160), wholeQuoteVerified: false,
    submittedQuoteRunsPastPageEnd: pageTail.length >= 16 && normalizedQuote.startsWith(pageTail) && normalizedQuote.length > pageTail.length,
    ...(nextPage ? { nextPhysicalPage: { page: nextPage.page, beginningExcerpt: nextPage.text.slice(0, 160) } } : {}),
    rule: 'A quote bound to a physical page must stay within that page. Prefix omission does not imply more text after its end. These exact ending and next-page snippets are diagnostics only, not an accepted cross-page quote or replacement field value. Native author must recheck each field and its literal page-specific support, revise its own complete submission, and retain unsupported conclusions as missing. No page, quote or business value is rewritten or approved.'
  } : undefined
  return { diagnosticOnly: true, path: source.path, ...(source.page === undefined ? {} : { page: source.page }), boundSourceLocationExists: original !== undefined,
    ...(original === undefined ? {} : {sourceExcerpt: original.slice(start, start + 640), sourceExcerptStart: start,excerptTruncated: start > 0 || original.length > start + 640}),
    submittedQuote: source.quote.slice(0, 320), quoteTruncated: source.quote.length > 320,
    ...(sourcePageBoundaryDiagnostic ? { sourcePageBoundaryDiagnostic } : {}),
    ...(quoteAnchorCandidates.length?{quoteAnchorCandidates:quoteAnchorCandidates.slice(0,3),quoteAnchorCandidatesTruncated:quoteAnchorCandidates.length>3,
      quoteAnchorRule:'Exact interior segments only locate bounded continuous original excerpts. The complete submitted quote has NOT passed the unchanged verifier, even at these locations. Native author must recheck literal punctuation, field support, date, scope and applicability, and author its own complete revision. No binding or value is replaced or accepted.'}:{}),
    ...(quoteLocationMatches.length ? {quoteLocationMatches:quoteLocationMatches.slice(0,3),quoteLocationMatchesTruncated:quoteLocationMatches.length>3,
      quoteLocationRule:'Other frozen locations contain the submitted quote under the unchanged source verifier. Native author must recheck the original date, scope, unit and object applicability before authoring a binding. These identities are diagnostics, not approved evidence or a replacement draft; no path, quote or business value is rewritten.'} : {}),
    ...(sourceWhitespaceContexts.length ? { sourceWhitespaceContexts,
      correctionRule: 'Recheck the original excerpt and preserve its literal whitespace, including U+0020 beside punctuation. These bounded original contexts are diagnostics, not a replacement quote or business value. The native author must revise quote and its bound field value consistently; unchanged verification and fresh independent review still apply.' } : {}) }
}

export function assertMaterialCorpus(corpus: MaterialCorpus): void {
  sha256CanonicalJson(corpus)
  if (!Array.isArray(corpus.documents) || !Array.isArray(corpus.limitations)
    || corpus.fingerprint !== materialCorpusFingerprint(corpus)) {
    fail('MODULE_CORPUS_HASH_MISMATCH', 'frozen source text changed')
  }
  const paths = new Set<string>()
  for (const document of corpus.documents) {
    if (!document.path || paths.has(document.path) || !/^[a-f0-9]{64}$/.test(document.contentHash)
      || !Number.isSafeInteger(document.byteLength) || document.byteLength < 0
      || (document.pages === undefined) === (document.text === undefined)) fail('MODULE_CORPUS_INVALID', document.path)
    paths.add(document.path)
    if (document.pages && (new Set(document.pages.map(p => p.page)).size !== document.pages.length
      || document.pages.some(p => !Number.isSafeInteger(p.page) || p.page < 1 || typeof p.text !== 'string'))) fail('MODULE_CORPUS_INVALID', document.path)
  }
}

/** A model may suggest these bindings, but never supplies a trusted numeric constant. */
export function verifyModuleSourceValues(corpus: MaterialCorpus, candidates: readonly ModuleSourceValue[]): ModuleSourceValue[] {
  assertMaterialCorpus(corpus)
  const values = z.array(sourceSchema).max(10_000).parse(candidates), ids = new Set<string>()
  const verify = (source: ModuleSourceValue) => {
    if (ids.has(source.sourceId)) fail('MODULE_SOURCE_VALUE_DUPLICATE', source.sourceId)
    ids.add(source.sourceId)
    const document = corpus.documents.find(d => d.path === source.path && d.contentHash === source.contentHash)
    if (!document || (document.pages !== undefined && source.page === undefined) || (document.pages === undefined && source.page !== undefined)) fail('MODULE_SOURCE_VALUE_LOCATION', source.sourceId)
    const original = document!.pages ? document!.pages.find(p => p.page === source.page)?.text : document!.text
    const contains = (whole: string, part: string) => norm(whole).includes(norm(part))
      || document!.pages !== undefined && pdfLayoutNorm(whole).includes(pdfLayoutNorm(part))
    if (original === undefined || !norm(source.quote) || !contains(original, source.quote)) fail('MODULE_SOURCE_VALUE_QUOTE', source.sourceId)
    if([source.coordinateMapping,source.dateMapping,source.queryMapping].filter(Boolean).length>1)fail('MODULE_SOURCE_DATE_MAPPING','Conflicting representation declarations')
    if (source.queryMapping) {
      verifyNativeQueryStringMapping({...source,queryMapping:source.queryMapping},document!)
    } else if (source.dateMapping) {
      if(source.dateMapping.kind==='source-calendar-date.v1')verifySourceCalendarDateMapping({...source,dateMapping:source.dateMapping},document!)
      else verifyPhotoDateMapping({...source,dateMapping:source.dateMapping},document!)
    } else if (source.coordinateMapping) {
      verifyPhotoCoordinateMapping({...source,coordinateMapping:source.coordinateMapping},document!)
    } else if (typeof source.rawValue === 'string') {
      if (!norm(source.rawValue) || !contains(source.quote, source.rawValue)) fail('MODULE_SOURCE_VALUE_TEXT', source.sourceId)
    } else {
      const raw = source.valueQuote
      if (!raw || !norm(source.quote).includes(norm(raw))) fail('MODULE_SOURCE_VALUE_RAW_REQUIRED', source.sourceId)
      if (typeof source.rawValue === 'number') {
        // No unit conversions, percent scaling, inferred digits or comma stripping.
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw!.trim()) || Number(raw) !== source.rawValue) fail('MODULE_SOURCE_VALUE_NUMBER', source.sourceId)
        const tokens: string[] = [...(norm(source.quote).match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [])]
        if (!tokens.includes(raw!.trim())) fail('MODULE_SOURCE_VALUE_NUMBER', source.sourceId)
      } else if (raw!.trim() !== String(source.rawValue)) fail('MODULE_SOURCE_VALUE_PRIMITIVE', source.sourceId)
    }
  }
  const errors: string[] = []
  for (const [index, source] of values.entries()) {
    try { verify(source) }
    catch (error) {
      const quoteDiagnostic = error instanceof Error && error.message.startsWith('MODULE_SOURCE_VALUE_QUOTE:')
        ? moduleSourceQuoteDiagnostic(corpus, source) : undefined
      const numberDiagnostic = error instanceof Error && error.message.startsWith('MODULE_SOURCE_VALUE_NUMBER:')
        ? moduleSourceNumberDiagnostic(source) : undefined
      errors.push(`${error instanceof Error ? error.message : String(error)}; source=${JSON.stringify({ path: source.path,
        ...(source.page === undefined ? {} : { page: source.page }),
        rawValue: typeof source.rawValue === 'string' ? source.rawValue.slice(0, 220) : source.rawValue })}${quoteDiagnostic ? '; quoteDiagnostic=' + JSON.stringify(quoteDiagnostic) : ''}${numberDiagnostic ? '; numberDiagnostic=' + JSON.stringify(numberDiagnostic) : ''}`)
      if (errors.length === 16) {
        if (index < values.length - 1) errors.push('另有来源尚未核验；整份候选仍被拒绝，必须修正全部问题。')
        break
      }
    }
  }
  if (errors.length) throw new Error(errors.join('\n'))
  return values
}

function calculate(operation: NonNullable<ModuleClaim['calculation']>['operation'], values: number[], weights?: number[]): number {
  let result: number
  switch (operation) {
    case 'sum': result = values.reduce((a, b) => a + b, 0); break
    case 'product': result = values.reduce((a, b) => a * b, 1); break
    case 'difference': if (values.length !== 2) fail('MODULE_CALCULATION_ARITY', operation); result = values[0] - values[1]; break
    case 'ratio': if (values.length !== 2 || values[1] === 0) fail('MODULE_CALCULATION_DENOMINATOR', operation); result = values[0] / values[1]; break
    case 'min': result = Math.min(...values); break
    case 'max': result = Math.max(...values); break
    case 'weighted_mean': {
      if (!weights || weights.length !== values.length || weights.some(w => w < 0) || weights.reduce((a, b) => a + b, 0) <= 0) fail('MODULE_CALCULATION_WEIGHTS', operation)
      result = values.reduce((sum, value, i) => sum + value * weights![i], 0) / weights!.reduce((a, b) => a + b, 0)
      break
    }
  }
  if (!Number.isFinite(result)) fail('MODULE_CALCULATION_NONFINITE', operation)
  return result
}

const containsNumber = (v: unknown): boolean => typeof v === 'number' || (Array.isArray(v) ? v.some(containsNumber) : isObject(v) && Object.values(v).some(containsNumber))
function assertCovered(value: unknown, pointer: string, claims: readonly Pick<ModuleClaim, 'selector'>[]): void {
  if (claims.some(claim => claim.selector === pointer)) return
  if (Array.isArray(value) && value.length) {
    value.forEach((entry, index) => assertCovered(entry, `${pointer}/${index}`, claims)); return
  }
  if (isObject(value) && Object.keys(value).length) {
    for (const [key, entry] of Object.entries(value)) {
      // Quantity notation is checked by the professional schema and independent
      // review. Every data value, including all coordinates, still needs a claim.
      if (['unit', 'currency', 'basis'].includes(key)) continue
      assertCovered(entry, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, claims)
    }
    return
  }
  fail('MODULE_CLAIM_VALUE_UNCOVERED', pointer)
}

/** Field-local class and leaf coverage only; dependency and arithmetic verification remain mandatory separately. */
type FieldCoverageClaim = Pick<ModuleClaim, 'claimId' | 'selector' | 'kind' | 'value'> & {
  readonly calculation?: Pick<NonNullable<ModuleClaim['calculation']>, 'basis'>
}
export function assertModuleFieldClaimCoverage(value: { value: unknown; claimClass: string; claimRefs: readonly string[] }, prefix: string,
  claims: readonly FieldCoverageClaim[], portClaimRefs: readonly string[]): readonly string[] {
  if (value.claimClass === 'fact') fail('MODULE_CLAIM_FACT_REQUIRES_INDEPENDENT_VERIFICATION', prefix)
  if (value.value === null && value.claimClass === 'missing' && value.claimRefs.length === 0) return []
  const ids = value.claimRefs, byId = new Map(claims.map(claim => [claim.claimId, claim]))
  if (!ids.length) fail('MODULE_CLAIM_FIELD_MISSING', prefix)
  for (const id of ids) {
    const claim = byId.get(id)
    if (!claim || !portClaimRefs.includes(id) || !(claim.selector === `${prefix}/value` || claim.selector.startsWith(`${prefix}/value/`))) fail('MODULE_CLAIM_FIELD_REFERENCE', prefix)
    // A chosen boundary can be conditional, but its area still needs a source
    // or checked calculation. Scenario calculations retain their assumptions.
    if (/^\/outputs\/boundaries\/records\/\d+\/area$/u.test(prefix) && containsNumber(claim!.value)
      && !['source', 'calculation'].includes(claim!.kind)) fail('MODULE_BOUNDARY_AREA_EVIDENCE_REQUIRED', prefix)
    const allowed = claim!.kind === 'source' ? ['source_conclusion'] : claim!.kind === 'calculation'
      ? claim!.calculation?.basis === 'scenario' ? ['assumption'] : ['agent_inference', 'source_conclusion']
      : claim!.kind === 'assumption' ? ['assumption'] : claim!.kind === 'missing' ? ['missing'] : ['agent_inference', 'decision']
    if (!allowed.includes(String(value.claimClass))) fail('MODULE_CLAIM_CLASS_MISMATCH', prefix)
  }
  assertCovered(value.value, `${prefix}/value`, ids.map(id => byId.get(id)!))
  return ids
}

/** Verifies concrete selected values, field coverage, source quotes and finite calculations. */
export function validateModuleClaims(input: { outputs: Record<string, unknown>; claims: readonly ModuleClaim[]; sourceValues: readonly ModuleSourceValue[];
  moduleId: string; upstream: readonly ClaimUpstream[] }): { claims: ModuleClaim[]; limitations: string[] } {
  sha256CanonicalJson(input)
  const claims = z.array(claimSchema).max(20_000).parse(input.claims), byId = new Map(claims.map(c => [c.claimId, c]))
  if (byId.size !== claims.length) fail('MODULE_CLAIM_DUPLICATE', input.moduleId)
  const selectors = new Set(claims.map(c => c.selector))
  if (selectors.size !== claims.length) fail('MODULE_CLAIM_SELECTOR_DUPLICATE', input.moduleId)
  const sources = new Map(input.sourceValues.map(s => [s.sourceId, s])), checked = new Set<string>(), active = new Set<string>(), limitations: string[] = []
  const upstreamClaim = (moduleId: string, claimId: string): ModuleClaim => {
    const result = input.upstream.find(row => row.moduleId === moduleId), claim = result?.claims.find(c => c.claimId === claimId)
    if (!claim) fail('MODULE_CLAIM_UPSTREAM_MISSING', `${moduleId}/${claimId}`)
    if (claim!.kind === 'missing') fail('MODULE_CLAIM_UPSTREAM_MISSING', `${moduleId}/${claimId}`)
    return claim!
  }
  const verify = (claim: ModuleClaim): void => {
    if (checked.has(claim.claimId)) return
    if (active.has(claim.claimId)) fail('MODULE_CLAIM_CYCLE', claim.claimId)
    active.add(claim.claimId)
    if (!/^\/outputs\/[^/]+\/records\/\d+\/[^/]+(?:\/|$)/u.test(claim.selector) || !equal(readJsonPointer({ outputs: input.outputs }, claim.selector), claim.value)) fail('MODULE_CLAIM_VALUE_MISMATCH', claim.claimId)
    for (const ref of claim.inputRefs ?? []) {
      if (ref.moduleId !== input.moduleId) upstreamClaim(ref.moduleId, ref.claimId)
      else {
        const dependency = byId.get(ref.claimId)
        if (!dependency || dependency.kind === 'missing') fail('MODULE_CLAIM_LOCAL_INPUT_MISSING', ref.claimId)
        verify(dependency!)
      }
    }
    const operand = (ref: ModuleOperand): number => {
      let value: unknown
      if('scenarioAssumption' in ref){
        if(claim.calculation?.basis!=='scenario')fail('MODULE_CALCULATION_UNVERIFIED_OPERAND',claim.claimId)
        const assumption=ref.scenarioAssumption
        value=assumption.value
        limitations.push(`${claim.claimId} [scenario operand]: ${assumption.value} ${assumption.unit}；${assumption.rationale}；仅研究AI条件参数，非来源、报价或现场已核数值。`)
      }
      else if ('sourceId' in ref) { if (!sources.has(ref.sourceId)) fail('MODULE_CALCULATION_SOURCE_MISSING', ref.sourceId); value = sources.get(ref.sourceId)!.rawValue }
      else {
        const other = ref.moduleId && ref.moduleId !== input.moduleId ? upstreamClaim(ref.moduleId, ref.claimId) : byId.get(ref.claimId)
        if (!other) fail('MODULE_CALCULATION_CLAIM_MISSING', ref.claimId)
        if (!ref.moduleId || ref.moduleId === input.moduleId) verify(other!)
        const conditional = other!.kind === 'assumption' || other!.kind === 'calculation' && other!.calculation?.basis === 'scenario'
        if (!['source', 'calculation', 'assumption'].includes(other!.kind)
          || conditional && claim.calculation?.basis !== 'scenario') fail('MODULE_CALCULATION_UNVERIFIED_OPERAND', ref.claimId)
        value = other!.value
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('MODULE_CALCULATION_NONNUMERIC', claim.claimId)
      return value as number
    }
    if (claim.kind === 'source') {
      if (!claim.sourceId || claim.calculation || !sources.has(claim.sourceId) || !equal(sources.get(claim.sourceId)!.rawValue, claim.value)) fail('MODULE_CLAIM_SOURCE_MISMATCH', claim.claimId)
      if(sources.get(claim.sourceId!)?.dateMapping?.kind==='source-calendar-date.v1')assertSourceCalendarDateMappingClaimTarget(input.moduleId,claim.selector)
      limitations.push(`${claim.claimId} [source_conclusion]: 原始资料连续摘录；未独立核实其现时真实性、法律有效性或项目适用性。`)
    } else if (claim.kind === 'calculation') {
      if (!claim.calculation || claim.sourceId || typeof claim.value !== 'number') fail('MODULE_CALCULATION_REQUIRED', claim.claimId)
      const computation = claim.calculation!
      if (computation.basis === 'scenario' && !claim.rationale) fail('MODULE_CALCULATION_SCENARIO_RATIONALE_REQUIRED', claim.claimId)
      if (computation.operation !== 'weighted_mean' && computation.weights) fail('MODULE_CALCULATION_WEIGHTS', claim.claimId)
      const result = calculate(computation.operation, computation.operands.map(operand), computation.weights?.map(operand))
      if (Math.abs(result - (claim.value as number)) > 1e-12 * Math.max(1, Math.abs(result))) fail('MODULE_CALCULATION_MISMATCH', claim.claimId)
      limitations.push(computation.basis === 'scenario'
        ? `${claim.claimId} [scenario calculation]: 条件情景复算，继承全部输入假设、来源时点和适用限制；不是实际经营数据、现场实测或确定预测。${claim.rationale}`
        : `${claim.claimId} [calculation]: 仅按原始资料数值与已验证声明复算；继承来源的时点、口径及未独立核验限制。`)
    } else {
      if (!claim.rationale || claim.sourceId || claim.calculation) fail('MODULE_CLAIM_RATIONALE_REQUIRED', claim.claimId)
      if (claim.kind === 'missing' && claim.value !== null) fail('MODULE_CLAIM_MISSING_VALUE', claim.claimId)
      if (claim.kind === 'inference' && moduleInferenceBasisDiagnostic(claim.value, claim.inputRefs)) fail('MODULE_CLAIM_INFERENCE_BASIS', claim.claimId)
      limitations.push(`${claim.claimId} [${claim.kind}]: ${claim.rationale}`)
    }
    if (moduleClaimUnitConflict(input.outputs,claim)) fail('MODULE_CLAIM_UNIT_MISMATCH', claim.claimId)
    active.delete(claim.claimId); checked.add(claim.claimId)
  }
  for (const claim of claims) verify(claim)
  const used = new Set<string>()
  for (const [portName, raw] of Object.entries(input.outputs)) {
    if (!isObject(raw) || !Array.isArray(raw.records) || !Array.isArray(raw.claimRefs)) fail('MODULE_CLAIM_PORT_INVALID', portName)
    const port = raw as { records: Record<string, unknown>[]; claimRefs: string[]; quality: string }
    for (const id of port.claimRefs) if (!byId.has(id) || !byId.get(id)!.selector.startsWith(`/outputs/${portName}/records/`)) fail('MODULE_CLAIM_PORT_REFERENCE', id)
    for (const [index, record] of port.records.entries()) for (const [field, value] of Object.entries(record)) {
      if (['recordId', 'resultClass'].includes(field)) continue
      const prefix = `/outputs/${portName}/records/${index}/${field}`
      if (isObject(value) && Object.hasOwn(value, 'value') && Array.isArray(value.claimRefs)) {
        if (value.value === null && value.claimClass === 'missing' && value.claimRefs.length === 0) {
          limitations.push(`${prefix}: ${Array.isArray(value.limitations) ? value.limitations.join('; ') : 'missing'}`); continue
        }
        for (const id of assertModuleFieldClaimCoverage(value as { value: unknown; claimClass: string; claimRefs: string[] }, prefix, claims, port.claimRefs)) used.add(id)
      } else {
        const selected = claims.filter(c => c.selector === prefix || c.selector.startsWith(prefix + '/'))
        if (!selected.length || selected.some(c => !port.claimRefs.includes(c.claimId))) fail('MODULE_CLAIM_FIELD_MISSING', prefix)
        selected.forEach(c => used.add(c.claimId))
        assertCovered(value, prefix, selected)
      }
    }
    if (port.quality === 'accepted' && claims.some(c => c.selector.startsWith(`/outputs/${portName}/`)
      && (!['source', 'calculation'].includes(c.kind) || c.calculation?.basis === 'scenario'))) fail('MODULE_CLAIM_UNCERTAIN_ACCEPTED', portName)
  }
  if (claims.some(c => !used.has(c.claimId))) fail('MODULE_CLAIM_UNREFERENCED', input.moduleId)
  return { claims, limitations }
}
