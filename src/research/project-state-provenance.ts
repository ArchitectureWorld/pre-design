import { createHash } from 'node:crypto'
import type { StateObjectRecord } from '../state/types.ts'
import type { EvidenceRecord } from './types.ts'
import { applyResearchSelector } from './selector.ts'

const uncertainClasses = ['missing', 'assumption', 'agent_inference'] as const
const stateAssets = new Set(['project-state', 'project-state-store', 'research:project-state', 'research:project-state-store'])
const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined
const escape = (key: string) => key.replace(/~/gu, '~0').replace(/\//gu, '~1')
const isStateUri = (value: string) => value.startsWith('state://') || value.startsWith('project-state://')

/** Only explicit structured classes are propagated; prose and semantic support are not certified. */
export function projectStateClaimClass(root: unknown, pointer = ''): EvidenceRecord['claimClass'] {
  const classes = new Set<unknown>()
  const authority = new Set<'decision' | 'user_statement' | 'source_conclusion'>()
  const add = (value: unknown, includeAuthority: boolean) => {
    classes.add(value)
    if (!includeAuthority) return
    if (value === 'decision' || value === 'user_statement') authority.add(value)
    if (value === 'fact' || value === 'source_conclusion') authority.add('source_conclusion')
  }
  const collect = (value: unknown, includeAuthority: boolean) => {
    if (Array.isArray(value)) { value.forEach(child => collect(child, includeAuthority)); return }
    const row = object(value)
    if (row === undefined) return
    add(row.claim_class, includeAuthority)
    Object.values(row).forEach(child => collect(child, includeAuthority))
  }
  const tokens = pointer === '' ? [] : pointer.slice(1).split('/')
  const ancestors: { row: Record<string, unknown>; length: number }[] = []
  // Uncertainty remains conservative across qualifying ancestor evidence.
  // Explicit ancestor classes also bind descendants, unlike source registers.
  for (let length = 0; length < tokens.length; length += 1) {
    const ancestor = object(applyResearchSelector('', root, { type: 'json_pointer', pointer: length === 0 ? '' : `/${tokens.slice(0, length).join('/')}` }).rawValue)
    if (ancestor !== undefined) {
      ancestors.push({ row: ancestor, length })
      add(ancestor.claim_class, true)
      // When selecting one citation, its siblings do not qualify that citation.
      // Selecting the entire array still collects all classes below as usual.
      if (tokens[length] !== 'evidence_refs') collect(ancestor.evidence_refs, false)
    }
  }
  // Only the directly owning business envelope can qualify a scalar using its
  // citations. Root/data registers aggregate sources for unrelated fields.
  const owner = ancestors.at(-1)
  if (owner !== undefined && owner.length > 0 && !(owner.length === 1 && tokens[0] === 'data')
    && tokens[owner.length] !== 'evidence_refs') collect(owner.row.evidence_refs, true)
  collect(applyResearchSelector('', root, { type: 'json_pointer', pointer }).rawValue, true)
  const uncertain = uncertainClasses.find(value => classes.has(value))
  if (uncertain !== undefined) return uncertain
  if (authority.size > 1) throw new Error(`PROJECT_STATE_CLASS_AMBIGUOUS: selected source mixes ${[...authority].join(', ')}; use a more precise JSON Pointer`)
  return authority.values().next().value ?? 'source_conclusion'
}

interface ProvenanceOptions {
  readonly projectId: string
  readonly stateObjects: readonly StateObjectRecord[]
  readonly researchEvidence?: readonly EvidenceRecord[]
  readonly unresolvedObjectIds?: ReadonlySet<string>
}

/** Check newly published business envelopes before downstream acquisition needs
 * them. Root/data source registers and independent list rows retain their own
 * authorities; the author, never this validator, classifies composite claims. */
export function validatePublishedClaimClasses(payload: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  let rejected = 0
  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) { value.forEach((child, index) => visit(child, `${path}/${index}`)); return }
    const row = object(value)
    if (row === undefined) return
    if (path !== '/data' && Array.isArray(row.evidence_refs)) {
      try { projectStateClaimClass(payload, path) }
      catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('PROJECT_STATE_CLASS_AMBIGUOUS:')) throw error
        rejected++
        if (errors.length < 16) errors.push(`PUBLISHED_CLAIM_CLASS_AMBIGUOUS ${path}: ${error.message}; classify the business judgment explicitly without changing its source references`)
      }
    }
    for (const [key, child] of Object.entries(row)) {
      if (key !== 'evidence_refs') visit(child, `${path}/${escape(key)}`)
    }
  }
  visit(object(payload)?.data, '/data')
  if (rejected > errors.length) errors.push(`PUBLISHED_CLAIM_CLASS_AMBIGUOUS: ${rejected - errors.length} further business envelopes remain rejected`)
  return { valid: rejected === 0, errors }
}

/** Validates embedded Project State citations. External sources require their own provider validation. */
export function validateCandidateStateProvenance(payload: unknown, options: ProvenanceOptions): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const states = new Map(options.stateObjects.filter(row => row.projectId === options.projectId).map(row => [row.objectId, row]))
  const check = (ref: Record<string, unknown>, path: string) => {
    const version = typeof ref.version_id === 'string' ? ref.version_id : ''
    const section = object(ref.locator)?.section
    const direct = /^([A-Za-z][A-Za-z0-9_-]*)@(0|[1-9]\d*)$/u.exec(version)
    const sectionText = typeof section === 'string' ? section : ''
    const stateUri = isStateUri(sectionText)
    const assetId = typeof ref.asset_id === 'string' ? ref.asset_id : ''
    const knownStateAsset = states.has(assetId)
    const assetUri = isStateUri(assetId)
    const research = options.researchEvidence?.find(row => row.evidenceId === ref.evidence_id && row.sourceType === 'project_state')
    const stateVersion = direct !== null && (states.has(direct[1]!) || /^(?:[A-Z]{2}\d{2}|ProjectSeed)$/u.test(direct[1]!))
    // A malformed version must not hide an otherwise explicit state citation.
    // Bare asset IDs qualify only when present in this project's state store.
    if (!stateAssets.has(assetId) && !knownStateAsset && !assetUri && !stateVersion && !stateUri && research === undefined) return
    try {
      let objectId = direct?.[1]
      let revision = direct === null ? undefined : Number(direct[2])
      let pointer = sectionText.startsWith('/') || sectionText === '' ? sectionText : undefined
      const uris = [stateUri ? sectionText.split(' | JSON Pointer ')[0] : undefined,
        assetUri ? assetId : undefined, !stateUri && !assetUri ? research?.sourceUri : undefined].filter((uri): uri is string => uri !== undefined)
      for (const uri of new Set(uris)) {
        const parsed = new URL(uri)
        if (!['state:', 'project-state:'].includes(parsed.protocol) || decodeURIComponent(parsed.hostname) !== options.projectId) {
          throw new Error('source project identity does not match the candidate project')
        }
        const parts = parsed.pathname.slice(1).split('/').map(decodeURIComponent)
        const uriId = parts[0]
        const revisionText = parsed.searchParams.get('revision') ?? (parsed.protocol === 'project-state:' ? parts[1] : undefined)
        if (revisionText === undefined || revisionText === null || !/^(0|[1-9]\d*)$/u.test(revisionText)) throw new Error('source revision identity is missing')
        const uriRevision = Number(revisionText)
        if (objectId !== undefined && (objectId !== uriId || revision !== uriRevision)) throw new Error('conflicting source identity/revision')
        objectId = uriId
        revision = uriRevision
      }
      if (knownStateAsset && objectId !== undefined && objectId !== assetId) throw new Error('conflicting source asset identity')
      if (stateUri) pointer = sectionText.includes(' | JSON Pointer ') ? sectionText.split(' | JSON Pointer ').slice(1).join(' | JSON Pointer ') : ''
      if (objectId === undefined || revision === undefined || !Number.isSafeInteger(revision)) throw new Error('unresolvable state identity; use OBJECT@revision and locator.section with an RFC6901 JSON Pointer')
      const state = states.get(objectId)
      if (state === undefined) throw new Error(`source '${objectId}' is unavailable`)
      if (options.unresolvedObjectIds?.has(objectId)) throw new Error(`source '${objectId}' has an unresolved workflow revision`)
      if (revision !== state.revision) throw new Error(`source revision ${revision} differs from current ${objectId}@${state.revision}`)
      if (direct === null && version !== sha256(state.value)) throw new Error('source content hash does not match the current snapshot')
      if (pointer === undefined) throw new Error('locator.section must be an RFC6901 JSON Pointer, not a field label')
      if (research !== undefined) {
        const trustedUri = new URL(research.sourceUri)
        const trustedParts = trustedUri.pathname.slice(1).split('/').map(decodeURIComponent)
        const trustedRevision = trustedUri.searchParams.get('revision') ?? (trustedUri.protocol === 'project-state:' ? trustedParts[1] : undefined)
        const trustedPointer = typeof research.locator.jsonPointer === 'string' ? research.locator.jsonPointer : ''
        if (decodeURIComponent(trustedUri.hostname) !== options.projectId || trustedParts[0] !== objectId
          || String(revision) !== trustedRevision || research.contentHash !== sha256(state.value)
          || (research.locator.objectId !== undefined && research.locator.objectId !== objectId)
          || (research.locator.revision !== undefined && research.locator.revision !== revision)
          || pointer !== trustedPointer) {
          throw new Error('citation conflicts with its trusted Research evidence identity, revision, content hash or selector')
        }
      }
      const selected = applyResearchSelector('', state.value, { type: 'json_pointer', pointer }).rawValue
      if (ref.quote_hash !== undefined && ref.quote_hash !== null && ref.quote_hash !== sha256(selected)) throw new Error('fragment quote_hash does not match the selected source value')
      const inherited = projectStateClaimClass(state.value, pointer)
      if (inherited !== 'source_conclusion' && ref.claim_class !== inherited) {
        throw new Error(`selected source inherits '${inherited}'; preserve that claim_class rather than upgrading it`)
      }
    } catch (error) {
      errors.push(`PROVENANCE ${path}: ${error instanceof Error ? error.message : 'source validation failed'}`)
    }
  }
  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${path}/${index}`)); return }
    const row = object(value)
    if (row === undefined) return
    for (const [key, child] of Object.entries(row)) {
      const childPath = `${path}/${escape(key)}`
      if (key === 'evidence_refs' && Array.isArray(child)) child.forEach((ref, index) => {
        const record = object(ref)
        if (record !== undefined) check(record, `${childPath}/${index}`)
      })
      else visit(child, childPath)
    }
  }
  visit(payload, '')
  return { valid: errors.length === 0, errors }
}
