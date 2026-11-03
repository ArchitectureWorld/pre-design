import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { canonicalizeJson, sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { projectStateClaimClass, validateCandidateStateProvenance } from '../research/project-state-provenance.ts'
import { applyResearchSelector } from '../research/selector.ts'
import type { EvidenceRecord } from '../research/types.ts'

export const WORKFLOW_AUTHOR_PROJECTION_VERSION = 'legacy-workflow-author-v1' as const
type JsonObject = Readonly<Record<string, unknown>>
export interface WorkflowAuthorUpstream {
  readonly objectId: string
  readonly revision: number
  readonly value: unknown
}
export interface WorkflowAuthorTrustedContext {
  readonly projectId: string
  readonly targetObjectId: string
  readonly researchEvidence?: readonly EvidenceRecord[]
  readonly acceptedEvidenceIds?: readonly string[]
  readonly upstream: readonly WorkflowAuthorUpstream[]
  /** Current repository records used only to verify accepted Research state rows. */
  readonly availableStates?: readonly (WorkflowAuthorUpstream & { readonly projectId: string })[]
  readonly unresolvedObjectIds?: ReadonlySet<string>
}
export interface WorkflowAuthorContext {
  readonly projectId: string
  readonly targetObjectId: string
  readonly capturedAt: string
  readonly research: readonly { readonly alias: string; readonly record: EvidenceRecord }[]
  readonly upstream: readonly (WorkflowAuthorUpstream & { readonly alias: string })[]
  readonly researchStates?: readonly WorkflowAuthorUpstream[]
}
export interface WorkflowAuthorCompiled {
  readonly payload: JsonObject
  readonly qualityEvidence: JsonObject
}
export interface WorkflowAuthorAudit {
  readonly version: typeof WORKFLOW_AUTHOR_PROJECTION_VERSION
  readonly childId: string
  readonly raw: JsonObject
  readonly context: WorkflowAuthorContext
  readonly rawHash: string
  readonly contextHash: string
  readonly compiledHash: string
}

export class WorkflowAuthorProjectionError extends Error {
  constructor(message: string, readonly authorPointer?: string) { super(message) }
}
function fail(code: string, detail = '', authorPointer?: string): never {
  throw new WorkflowAuthorProjectionError(`WORKFLOW_AUTHOR_${code}${detail ? ': ' + detail : ''}`, authorPointer)
}
const object = (value: unknown): JsonObject | undefined => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonObject : undefined
const jsonHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const escape = (value: string) => value.replace(/~/gu, '~0').replace(/\//gu, '~1')
const upstreamClasses = ['source_conclusion', 'user_statement', 'agent_inference', 'assumption', 'decision', 'missing'] as const
// These five v0.6 contracts name their top-level EvidenceRef arrays differently.
// Bind to the exact target/path so ordinary business `sources` remain untouched.
const namedReferencePaths: Readonly<Record<string, string>> = {
  BL04: '/data/photo_refs', BL08: '/data/survey_refs', OB02: '/data/baseline_refs',
  OB03: '/data/sources', OB04: '/data/sources',
}
function jsonInput(value: unknown): void {
  try { canonicalizeJson(value) } catch (error) { fail('NON_JSON', error instanceof Error ? error.message : '') }
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

/** Acquisition metadata and source values are copied once before native admission.
 * Only independently accepted Research rows receive an addressable R alias. */
export function createWorkflowAuthorContext(input: WorkflowAuthorTrustedContext & { readonly capturedAt: string }): WorkflowAuthorContext {
  if (!input.projectId || !input.targetObjectId || !Number.isFinite(Date.parse(input.capturedAt))) fail('CONTEXT_IDENTITY')
  const accepted = new Set(input.acceptedEvidenceIds ?? [])
  const evidence = (input.researchEvidence ?? []).filter(row => accepted.has(row.evidenceId))
  const researchIds = new Set(evidence.filter(row => row.sourceType === 'project_state').map(row => {
    try { return decodeURIComponent(new URL(row.sourceUri).pathname.slice(1).split('/')[0]!) }
    catch { return fail('CONTEXT_RESEARCH_IDENTITY', row.evidenceId) }
  }))
  const upstreamIds = new Set(input.upstream.map(row => row.objectId))
  const researchStates = (input.availableStates ?? []).filter(row => row.projectId === input.projectId
    && researchIds.has(row.objectId) && !upstreamIds.has(row.objectId)).sort((a, b) => a.objectId.localeCompare(b.objectId))
  if (new Set(evidence.map(row => row.evidenceId)).size !== evidence.length
    || new Set(researchStates.map(row => row.objectId)).size !== researchStates.length
    || new Set(input.upstream.map(row => row.objectId)).size !== input.upstream.length) fail('CONTEXT_DUPLICATE')
  for (const row of [...input.upstream, ...researchStates]) {
    if (!row.objectId || !Number.isSafeInteger(row.revision) || row.revision < 1) fail('CONTEXT_UPSTREAM')
    if (input.unresolvedObjectIds?.has(row.objectId)) fail('UNRESOLVED_UPSTREAM', row.objectId)
  }
  const result: WorkflowAuthorContext = {
    projectId: input.projectId, targetObjectId: input.targetObjectId, capturedAt: input.capturedAt,
    research: evidence.map((record, index) => ({ alias: `R${index + 1}`, record: structuredClone(record) })),
    upstream: input.upstream.map((row, index) => ({ alias: `U${index + 1}`, objectId: row.objectId, revision: row.revision, value: structuredClone(row.value) })),
    ...(researchStates.length ? { researchStates: researchStates.map(({ objectId, revision, value }) => ({ objectId, revision, value: structuredClone(value) })) } : {}),
  }
  jsonInput(result)
  return freeze(result)
}

/** Prompt guidance from the same frozen provenance rule used at admission.
 * This exposes existing reference constraints; it never classifies new claims,
 * mutates submissions, or overrides the authoritative compiler validation. */
export function workflowAuthorReferenceGuide(context: WorkflowAuthorContext, submitted?: unknown): {
  readonly entries: readonly { readonly upstream: string; readonly pointer: string;
    readonly claimClass?: EvidenceRecord['claimClass']; readonly error?: string }[]
  readonly visitedNodes: number; readonly omittedSubtrees: number; readonly complete: boolean
} {
  const entries: { upstream: string; pointer: string; claimClass?: EvidenceRecord['claimClass']; error?: string }[] = []
  let visitedNodes = 0, omittedSubtrees = 0
  if (submitted !== undefined) {
    const seen = new Set<string>()
    const visit = (value: unknown, path: string): void => {
      if (visitedNodes >= 1024 || entries.length >= 128) { omittedSubtrees++; return }
      visitedNodes++
      if (Array.isArray(value)) { value.forEach((child, index) => visit(child, `${path}/${index}`)); return }
      const row = object(value)
      if (row === undefined) return
      for (const [key, child] of Object.entries(row)) {
        const childPath = `${path}/${escape(key)}`
        if (key !== 'evidence_refs' && namedReferencePaths[context.targetObjectId] !== childPath) { visit(child, childPath); continue }
        if (!Array.isArray(child)) continue
        for (const value of child) {
          if (visitedNodes >= 1024 || entries.length >= 128) { omittedSubtrees++; continue }
          visitedNodes++
          const ref = object(value)
          if (typeof ref?.upstream !== 'string' || typeof ref.pointer !== 'string') continue
          const identity = JSON.stringify([ref.upstream, ref.pointer])
          if (seen.has(identity)) continue
          seen.add(identity)
          const selected = { upstream: ref.upstream, pointer: ref.pointer }
          const source = context.upstream.find(item => item.alias === ref.upstream)
          if (source === undefined) { entries.push({ ...selected, error: 'WORKFLOW_AUTHOR_UNKNOWN_UPSTREAM' }); continue }
          try {
            applyResearchSelector('', source.value, { type: 'json_pointer', pointer: ref.pointer })
            const claimClass = projectStateClaimClass(source.value, ref.pointer)
            if (claimClass !== 'source_conclusion') entries.push({ ...selected, claimClass })
          } catch (error) {
            entries.push({ ...selected, error: error instanceof Error ? error.message : String(error) })
          }
        }
      }
    }
    const input = object(submitted)
    visit(input?.data, '/data')
    visit(input?.quality, '/quality')
    return freeze({ entries, visitedNodes, omittedSubtrees, complete: omittedSubtrees === 0 })
  }
  for (const upstream of context.upstream) {
    const root = object(upstream.value)
    if (root === undefined || !Object.hasOwn(root, 'data')) continue
    const visit = (value: unknown, pointer: string) => {
      if (visitedNodes >= 1024 || entries.length >= 128) { omittedSubtrees += 1; return }
      visitedNodes += 1
      try {
        const claimClass = projectStateClaimClass(upstream.value, pointer)
        // This fallback does not constrain the author's explicit classification.
        if (claimClass !== 'source_conclusion') entries.push({ upstream: upstream.alias, pointer, claimClass })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.startsWith('PROJECT_STATE_CLASS_AMBIGUOUS:')) throw error
        entries.push({ upstream: upstream.alias, pointer, error: message })
      }
      if (Array.isArray(value)) value.forEach((child, index) => visit(child, `${pointer}/${index}`))
      else if (object(value) !== undefined) for (const [key, child] of Object.entries(value as JsonObject)) {
        if (key !== 'evidence_refs') visit(child, `${pointer}/${escape(key)}`)
      }
    }
    visit(root.data, '/data')
  }
  return freeze({ entries, visitedNodes, omittedSubtrees, complete: omittedSubtrees === 0 })
}

/** Same closed EvidenceRef locator mapping used by proposal envelopes. This
 * never copies provider-only fields or substitutes a file hash for a quote. */
export function workflowResearchEvidenceRef(record: EvidenceRecord): JsonObject {
  const pointer = record.locator.jsonPointer ?? record.locator.selector
  const detail = typeof pointer === 'string' ? `JSON Pointer ${pointer}`
    : typeof record.locator.startLine === 'number' && typeof record.locator.endLine === 'number'
      ? `lines ${record.locator.startLine}-${record.locator.endLine}` : undefined
  const location = Object.fromEntries(['page', 'slide', 'sheet', 'cell_range', 'bbox', 'geometry_ref']
    .filter(key => record.locator[key] !== undefined).map(key => [key, structuredClone(record.locator[key])]))
  const fragmentHash = record.locator.fragmentHash
  return {
    evidence_id: record.evidenceId, asset_id: `research:${record.sourceId}`, version_id: record.contentHash,
    claim_class: record.claimClass,
    locator: { ...location, section: [record.sourceUri, detail].filter(value => value !== undefined).join(' | ') },
    quote_hash: typeof fragmentHash === 'string' && fragmentHash.trim() !== '' ? fragmentHash : null,
    captured_at: record.capturedAt, reliability: record.reliability === 'inference' ? 'unknown' : record.reliability,
    notes: `${record.sourceTitle} — ${record.publisher}`,
  }
}

export const WORKFLOW_SHORT_REFERENCE_SCHEMA: JsonObject = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['source'], properties: { source: { type: 'string' }, notes: { type: 'string' } } },
    { type: 'object', additionalProperties: false, required: ['upstream', 'pointer', 'claimClass'], properties: {
      upstream: { type: 'string' }, pointer: { type: 'string' }, claimClass: { type: 'string', enum: upstreamClasses }, notes: { type: 'string' },
    } },
  ],
}

/** Retain every business schema constraint. Unrestricted objects (including
 * Scope) declare evidence_refs; typed maps must not gain a metadata exception. */
export function workflowAuthorSchema(stateSchema: JsonObject, qualityEvidenceSchema: unknown): JsonObject {
  const shortArray = { type: 'array', items: WORKFLOW_SHORT_REFERENCE_SCHEMA }
  const project = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(project)
    const node = object(value)
    if (node === undefined) return value
    if (node.$ref === '#/$defs/EvidenceRef') return structuredClone(WORKFLOW_SHORT_REFERENCE_SCHEMA)
    const result = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, project(child)]))
    if (node.type === 'object') {
      const properties = object(result.properties) ?? {}
      if (Object.hasOwn(properties, 'evidence_refs') || node.additionalProperties === true || node.additionalProperties === undefined) {
        result.properties = { ...properties, evidence_refs: { ...object(properties.evidence_refs), ...structuredClone(shortArray) } }
      }
    }
    return result
  }
  const properties = object(stateSchema.properties) ?? {}
  const definitions = project(stateSchema.$defs ?? {}) as Record<string, unknown>
  const projected: Record<string, unknown> = {
    type: 'object', additionalProperties: false, required: ['projectionVersion', 'data', 'qualityEvidence'],
    properties: {
      projectionVersion: { type: 'string', const: WORKFLOW_AUTHOR_PROJECTION_VERSION },
      data: project(properties.data ?? { type: 'object', additionalProperties: true }),
      ...(properties.quality === undefined ? {} : { quality: project(properties.quality) }),
      qualityEvidence: structuredClone(qualityEvidenceSchema),
    },
  }
  // Do not send unused protected-envelope definitions to the author.
  const used = new Set<string>()
  const collect = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(collect); return }
    const node = object(value)
    if (node === undefined) return
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/')) {
      const key = node.$ref.slice('#/$defs/'.length)
      if (!used.has(key)) { used.add(key); collect(definitions[key]) }
    }
    Object.values(node).forEach(collect)
  }
  collect(projected)
  if (used.size) projected.$defs = Object.fromEntries([...used].map(key => [key, definitions[key]]))
  return projected
}

function expandReference(value: unknown, context: WorkflowAuthorContext, path: string): JsonObject {
  const ref = object(value)
  if (ref === undefined) fail('REFERENCE_SHAPE', path, path)
  if (ref.notes !== undefined && typeof ref.notes !== 'string') fail('REFERENCE_NOTES', path, path)
  const withNotes = (result: JsonObject) => ({ ...result, ...(ref.notes === undefined ? {} : { notes: ref.notes }) })
  if (typeof ref.source === 'string') {
    if (Object.keys(ref).some(key => !['source', 'notes'].includes(key))) fail('REFERENCE_FIELDS', path, path)
    const source = context.research.find(row => row.alias === ref.source)
    if (source === undefined) fail('UNKNOWN_SOURCE', `${path}: ${ref.source}`, path)
    const result = withNotes(workflowResearchEvidenceRef(source.record))
    const validated = validateCandidateStateProvenance({ evidence_refs: [result] }, {
      projectId: context.projectId, stateObjects: [...context.upstream, ...context.researchStates ?? []].map(row => ({ ...row, projectId: context.projectId })) as never,
      researchEvidence: context.research.map(row => row.record),
    })
    if (!validated.valid) fail('RESEARCH_PROVENANCE', `${path}: ${validated.errors.join('; ')}`, path)
    return result
  }
  if (typeof ref.upstream !== 'string' || typeof ref.pointer !== 'string'
    || typeof ref.claimClass !== 'string' || !upstreamClasses.includes(ref.claimClass as typeof upstreamClasses[number])
    || Object.keys(ref).some(key => !['upstream', 'pointer', 'claimClass', 'notes'].includes(key))) fail('REFERENCE_FIELDS', path, path)
  const source = context.upstream.find(row => row.alias === ref.upstream)
  if (source === undefined) fail('UNKNOWN_UPSTREAM', `${path}: ${ref.upstream}`, path)
  try {
    const selection = applyResearchSelector('', source.value, { type: 'json_pointer', pointer: ref.pointer })
    if (selection.locator.jsonPointer !== ref.pointer) fail('POINTER_NORMALIZATION', path)
    const inherited = projectStateClaimClass(source.value, ref.pointer)
    if (inherited !== 'source_conclusion' && ref.claimClass !== inherited) fail('UPSTREAM_CLASS', `${path}: preserve ${inherited}`)
    // The author must explicitly classify an otherwise unqualified upstream
    // conclusion. The host never promotes it to fact or chooses its class.
    const result = withNotes({ evidence_id: source.objectId, asset_id: source.objectId,
      version_id: `${source.objectId}@${source.revision}`, claim_class: ref.claimClass,
      locator: { section: ref.pointer }, quote_hash: jsonHash(selection.rawValue),
      captured_at: context.capturedAt, reliability: 'unknown' })
    const validated = validateCandidateStateProvenance({ evidence_refs: [result] }, {
      projectId: context.projectId, stateObjects: context.upstream.map(row => ({ ...row, projectId: context.projectId })) as never,
    })
    if (!validated.valid) fail('UPSTREAM_PROVENANCE', validated.errors.join('; '))
    return result
  } catch (error) { fail('UPSTREAM_REFERENCE', `${path}: ${error instanceof Error ? error.message : 'invalid selector'}`, path) }
}

export function compileWorkflowAuthorProjection(raw: unknown, context: WorkflowAuthorContext): WorkflowAuthorCompiled {
  jsonInput(raw)
  const input = object(raw)
  if (input?.projectionVersion !== WORKFLOW_AUTHOR_PROJECTION_VERSION) fail('VERSION')
  if (Object.keys(input).some(key => !['projectionVersion', 'data', 'quality', 'qualityEvidence'].includes(key))
    || object(input.data) === undefined || object(input.qualityEvidence) === undefined
    || (input.quality !== undefined && object(input.quality) === undefined)) fail('ENVELOPE')
  const referenceErrors: WorkflowAuthorProjectionError[] = []
  let omittedErrors = 0
  const checkReference = (check: () => unknown): unknown => {
    try { return check() } catch (error) {
      if (!(error instanceof WorkflowAuthorProjectionError)) throw error
      if (referenceErrors.length < 16) referenceErrors.push(error)
      else omittedErrors++
      // The candidate is never returned if any reference failed. Continuing
      // traversal only collects other precise diagnostics from this submission.
      return null
    }
  }
  const visit = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) return value.map((item, index) => visit(item, `${path}/${index}`))
    const row = object(value)
    if (row === undefined) return value
    return Object.fromEntries(Object.entries(row).map(([key, child]) => {
      const childPath = `${path}/${escape(key)}`
      if (key !== 'evidence_refs' && namedReferencePaths[context.targetObjectId] !== childPath) return [key, visit(child, childPath)]
      if (!Array.isArray(child)) return [key, checkReference(() => fail('REFERENCE_ARRAY', childPath, childPath))]
      return [key, child.map((ref, index) => checkReference(() => expandReference(ref, context, `${childPath}/${index}`)))]
    }))
  }
  const result = {
    payload: { data: visit(input.data, '/data'), ...(input.quality === undefined ? {} : { quality: visit(input.quality, '/quality') }) },
    qualityEvidence: structuredClone(input.qualityEvidence as JsonObject),
  }
  if (referenceErrors.length === 1) throw referenceErrors[0]
  if (referenceErrors.length) throw new WorkflowAuthorProjectionError(
    ['WORKFLOW_AUTHOR_REFERENCES: rejected submission; correct all listed references.',
      ...referenceErrors.map(error => error.message),
      ...(omittedErrors ? [`${omittedErrors} additional reference errors omitted; remaining references are not accepted.`] : []),
    ].join('\n'), referenceErrors[0]!.authorPointer)
  return result
}

export function createWorkflowAuthorAudit(raw: unknown, context: WorkflowAuthorContext, childId: string): WorkflowAuthorAudit {
  if (!childId) fail('CHILD_ID')
  const compiled = compileWorkflowAuthorProjection(raw, context)
  return { version: WORKFLOW_AUTHOR_PROJECTION_VERSION, childId, raw: structuredClone(raw) as JsonObject,
    context: structuredClone(context), rawHash: sha256CanonicalJson(raw), contextHash: sha256CanonicalJson(context),
    compiledHash: sha256CanonicalJson(compiled) }
}

/** Replay is bound both to an actual native receipt and independently supplied
 * trusted sources. A self-consistent but substituted audit is insufficient. */
export function replayWorkflowAuthorProjection(
  audit: WorkflowAuthorAudit,
  native: { readonly childId: string; readonly raw: unknown },
  trusted: WorkflowAuthorTrustedContext,
): WorkflowAuthorCompiled {
  jsonInput(audit)
  if (audit.version !== WORKFLOW_AUTHOR_PROJECTION_VERSION || audit.childId !== native.childId
    || !isDeepStrictEqual(audit.raw, native.raw) || audit.rawHash !== sha256CanonicalJson(native.raw)
    || audit.contextHash !== sha256CanonicalJson(audit.context)) fail('AUDIT_IDENTITY')
  const expected = createWorkflowAuthorContext({ ...trusted, capturedAt: audit.context.capturedAt })
  if (!isDeepStrictEqual(audit.context, expected)) fail('AUDIT_SOURCES')
  const result = compileWorkflowAuthorProjection(native.raw, expected)
  if (audit.compiledHash !== sha256CanonicalJson(result)) fail('AUDIT_COMPILED_HASH')
  return result
}
