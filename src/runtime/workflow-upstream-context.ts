interface EncodedUpstream {
  readonly encoding: 'workflow-upstream-strings-v1' | 'workflow-upstream-evidence-v2'
  readonly referenceKey: string
  readonly strings: readonly string[]
  readonly upstream: unknown
  readonly evidenceKey?: string
  readonly evidenceColumns?: readonly (readonly string[])[]
}

/** A transport view only. Author validation, hashes and pointer selection always
 * use the complete original upstream objects, never this encoded view. */
export function workflowUpstreamPromptView(upstream: readonly unknown[]): readonly unknown[] | EncodedUpstream {
  const counts = new Map<string, number>(), keys = new Set<string>()
  function scan(value: unknown): void {
    if (typeof value === 'string' && value.length >= 16) counts.set(value, (counts.get(value) ?? 0) + 1)
    else if (Array.isArray(value)) value.forEach(scan)
    else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) { keys.add(key); scan(child) }
    }
  }
  scan(upstream)
  const strings = [...counts].filter(([value, count]) => count > 1 && (count - 1) * JSON.stringify(value).length > count * 16 + 32)
    .map(([value]) => value)
  let referenceKey = '@S'
  while (keys.has(referenceKey)) referenceKey += '_'
  let evidenceKey = '@E'
  while (keys.has(evidenceKey)) evidenceKey += '_'
  const indices = new Map(strings.map((value, index) => [value, index]))
  const evidenceColumns: string[][] = [], columnIndices = new Map<string, number>()
  function encode(value: unknown, table = false, evidence = false): unknown {
    if (typeof value === 'string') return indices.has(value) ? { [referenceKey]: indices.get(value)! } : value
    if (Array.isArray(value)) return value.map(child => encode(child, table, evidence))
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value)
      const encoded = entries.map(([key, child]) => [key, encode(child, table, key === 'evidence_refs' && Array.isArray(child))] as const)
      if (table && evidence) {
        const columns = entries.map(([key]) => key), signature = JSON.stringify(columns)
        let index = columnIndices.get(signature)
        if (index === undefined) { index = evidenceColumns.length; evidenceColumns.push(columns); columnIndices.set(signature, index) }
        return { [evidenceKey]: [index, encoded.map(([, child]) => child)] }
      }
      return Object.fromEntries(encoded)
    }
    return value
  }
  const view: EncodedUpstream = { encoding: 'workflow-upstream-strings-v1', referenceKey, strings, upstream: encode(upstream) }
  // Do not make a small input harder to read for a negligible character saving.
  const stringView = strings.length && JSON.stringify(view).length < JSON.stringify(upstream).length * 0.9 ? view : upstream
  const tabular: EncodedUpstream = { encoding: 'workflow-upstream-evidence-v2', referenceKey, strings,
    evidenceKey, evidenceColumns, upstream: encode(upstream, true) }
  return evidenceColumns.length && JSON.stringify(tabular).length < JSON.stringify(stringView).length * 0.9 ? tabular : stringView
}

/** Deterministic inverse for transport/audit verification. No text is inferred. */
export function expandWorkflowUpstreamPromptView(view: unknown): unknown {
  if (Array.isArray(view)) return structuredClone(view)
  const invalid = (): never => { throw new Error('WORKFLOW_UPSTREAM_VIEW_INVALID') }
  if (view === null || typeof view !== 'object') return invalid()
  const encoded = view as EncodedUpstream
  if (!['workflow-upstream-strings-v1', 'workflow-upstream-evidence-v2'].includes(encoded.encoding) || typeof encoded.referenceKey !== 'string' || !encoded.referenceKey
    || !Array.isArray(encoded.strings) || encoded.strings.some(value => typeof value !== 'string') || !Array.isArray(encoded.upstream)) return invalid()
  const tables = encoded.encoding === 'workflow-upstream-evidence-v2'
  const tableKey = encoded.evidenceKey
  const tableColumns = encoded.evidenceColumns
  if (tables && (typeof tableKey !== 'string' || !tableKey || tableKey === encoded.referenceKey
    || !Array.isArray(tableColumns) || tableColumns.some(columns => !Array.isArray(columns)
      || columns.some(key => typeof key !== 'string' || key === tableKey || key === encoded.referenceKey)
      || new Set(columns).size !== columns.length))) return invalid()
  function decode(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(decode)
    if (value !== null && typeof value === 'object') {
      if (Object.hasOwn(value, encoded.referenceKey)) {
        const index = (value as Record<string, unknown>)[encoded.referenceKey]
        if (Object.keys(value).length !== 1 || typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= encoded.strings.length) return invalid()
        return encoded.strings[index]
      }
      if (tables && Object.hasOwn(value, tableKey!)) {
        const row = (value as Record<string, unknown>)[tableKey!]
        if (Object.keys(value).length !== 1 || !Array.isArray(row) || row.length !== 2) return invalid()
        const [index, cells] = row
        if (!Number.isSafeInteger(index) || index < 0 || index >= tableColumns!.length || !Array.isArray(cells)) return invalid()
        const columns = tableColumns![index]!
        if (columns.length !== cells.length) return invalid()
        return Object.fromEntries(columns.map((key, cell) => [key, decode(cells[cell])]))
      }
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decode(child)]))
    }
    return value
  }
  return decode(encoded.upstream)
}
