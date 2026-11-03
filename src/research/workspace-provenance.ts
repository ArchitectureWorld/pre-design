import type { EvidenceRecord } from './types.ts'

const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined
const escape = (key: string) => key.replace(/~/gu, '~0').replace(/\//gu, '~1')
const pathsOf = (record: EvidenceRecord): string[] => [record.sourceUri, record.locator.relativePath]
  .filter((value): value is string => typeof value === 'string' && value !== '')

/** Bind embedded citations to the independently acquired workspace originals.
 * Other provider types and unregistered unknown/assumption references retain
 * their existing contracts. This checks identity, not semantic claim support,
 * and never repairs a candidate or treats a file hash as a fragment hash. */
export function validateCandidateWorkspaceProvenance(payload: unknown, options: {
  readonly researchEvidence?: readonly EvidenceRecord[]
  readonly acceptedEvidenceIds?: readonly string[]
}): { valid: boolean; errors: string[] } {
  const records = (options.researchEvidence ?? []).filter(record => record.sourceType === 'workspace_file'
    && /^[a-f0-9]{64}$/iu.test(record.contentHash))
  const byId = new Map(records.map(record => [record.evidenceId, record]))
  const accepted = options.acceptedEvidenceIds === undefined ? undefined : new Set(options.acceptedEvidenceIds)
  const knownPaths = new Set(records.flatMap(pathsOf))
  const knownAssets = new Set([...knownPaths, ...records.map(record => `research:${record.sourceId}`)])
  const errors: string[] = []
  const check = (ref: Record<string, unknown>, path: string) => {
    const record = byId.get(String(ref.evidence_id))
    const locator = object(ref.locator) ?? {}
    const section = typeof locator.section === 'string' ? locator.section : undefined
    if (record === undefined && !knownAssets.has(String(ref.asset_id)) && !knownPaths.has(section?.split(' | ')[0] ?? '')) return
    const fail = (message: string) => errors.push(`PROVENANCE ${path}: ${message}`)
    if (record === undefined || (accepted !== undefined && !accepted.has(record.evidenceId))) {
      fail('workspace original citation requires an accepted evidence_id')
      return
    }
    const paths = pathsOf(record)
    const providerAsset = ref.asset_id === `research:${record.sourceId}`
    if (!paths.includes(String(ref.asset_id)) && !(providerAsset && paths.includes(section?.split(' | ')[0] ?? ''))) {
      fail('workspace asset/path does not match its accepted evidence')
    }
    if (ref.version_id !== record.contentHash) fail('workspace version_id must equal its verified contentHash')
    if (ref.claim_class !== record.claimClass) fail('workspace claim_class must preserve its accepted evidence classification')
    for (const key of ['page', 'slide', 'sheet', 'cell_range', 'bbox', 'geometry_ref']) {
      const expected = record.locator[key] ?? null
      if (JSON.stringify(locator[key] ?? null) !== JSON.stringify(expected)) fail(`workspace locator.${key} differs from its accepted evidence`)
    }
    const pointer = record.locator.jsonPointer ?? record.locator.selector
    const detail = typeof pointer === 'string' ? `JSON Pointer ${pointer}`
      : typeof record.locator.startLine === 'number' && typeof record.locator.endLine === 'number'
        ? `lines ${record.locator.startLine}-${record.locator.endLine}` : undefined
    const allowedSections = detail === undefined ? paths
      : [...paths.map(value => `${value} | ${detail}`), typeof pointer === 'string' ? pointer : detail]
    if ((detail !== undefined && section === undefined) || (section !== undefined && !allowedSections.includes(section))) {
      fail('workspace locator selector does not match its accepted evidence')
    }
    if (ref.quote_hash !== undefined && ref.quote_hash !== null
      && ref.quote_hash !== record.locator.fragmentHash) fail('workspace quote_hash does not match its verified fragmentHash')
  }
  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${path}/${index}`)); return }
    const row = object(value)
    if (row === undefined) return
    for (const [key, child] of Object.entries(row)) {
      const childPath = `${path}/${escape(key)}`
      if (key === 'evidence_refs' && Array.isArray(child)) child.forEach((ref, index) => {
        const citation = object(ref)
        if (citation !== undefined) check(citation, `${childPath}/${index}`)
      })
      else visit(child, childPath)
    }
  }
  visit(payload, '')
  return { valid: errors.length === 0, errors }
}
