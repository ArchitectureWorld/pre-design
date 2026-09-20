import { createHash } from 'node:crypto'
import type { StateObjectRecord } from '../state/types.ts'
import type { EvidenceRecord } from './types.ts'
import { applyResearchSelector } from './selector.ts'

const uncertain = ['missing', 'assumption', 'agent_inference'] as const
const stateAssets = new Set(['project-state', 'project-state-store', 'research:project-state', 'research:project-state-store'])
const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined
const escape = (key: string) => key.replace(/~/gu, '~0').replace(/\//gu, '~1')

/** Only explicit structured classes are propagated; prose and semantic support are not certified. */
export function projectStateClaimClass(root: unknown, pointer = ''): EvidenceRecord['claimClass'] {
  const classes = new Set<unknown>()
  const collect = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(collect); return }
    const row = object(value)
    if (row === undefined) return
    classes.add(row.claim_class)
    Object.values(row).forEach(collect)
  }
  const tokens = pointer === '' ? [] : pointer.slice(1).split('/')
  // Ancestor evidence qualifies a scalar or subfield; sibling fields do not.
  for (let length = 0; length < tokens.length; length += 1) {
    const ancestor = object(applyResearchSelector('', root, { type: 'json_pointer', pointer: length === 0 ? '' : `/${tokens.slice(0, length).join('/')}` }).rawValue)
    if (ancestor !== undefined) {
      classes.add(ancestor.claim_class)
      // When selecting one citation, its siblings do not qualify that citation.
      // Selecting the entire array still collects all classes below as usual.
      if (tokens[length] !== 'evidence_refs') collect(ancestor.evidence_refs)
    }
  }
  collect(applyResearchSelector('', root, { type: 'json_pointer', pointer }).rawValue)
  return uncertain.find(value => classes.has(value)) ?? 'source_conclusion'
}

interface ProvenanceOptions {
  readonly projectId: string
  readonly stateObjects: readonly StateObjectRecord[]
  readonly researchEvidence?: readonly EvidenceRecord[]
  readonly unresolvedObjectIds?: ReadonlySet<string>
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
    const stateUri = sectionText.startsWith('state://') || sectionText.startsWith('project-state://')
    const research = options.researchEvidence?.find(row => row.evidenceId === ref.evidence_id && row.sourceType === 'project_state')
    const stateVersion = direct !== null && (states.has(direct[1]!) || /^(?:[A-Z]{2}\d{2}|ProjectSeed)$/u.test(direct[1]!))
    if (!stateAssets.has(String(ref.asset_id)) && !stateVersion && !stateUri && research === undefined) return
    try {
      let objectId = direct?.[1]
      let revision = direct === null ? undefined : Number(direct[2])
      let pointer = sectionText.startsWith('/') || sectionText === '' ? sectionText : undefined
      const uri = stateUri ? sectionText.split(' | JSON Pointer ')[0] : research?.sourceUri
      if (uri !== undefined) {
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
        if (stateUri) pointer = sectionText.includes(' | JSON Pointer ') ? sectionText.split(' | JSON Pointer ').slice(1).join(' | JSON Pointer ') : ''
      }
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
