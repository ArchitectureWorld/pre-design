import { moduleInferenceBasisDiagnostic } from './module-claims.ts'
import { readJsonPointer } from './regional-schema.ts'
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Inspect old partial receipts without copying numeric values or source prose. */
export function moduleInferenceBasisDiagnostics(projections: readonly { outputs: unknown; evidence: unknown; groupId?: string }[], groupId?: string): string[] {
  const errors: string[] = []
  for (const projection of projections) {
    if (groupId !== undefined && projection.groupId !== groupId || !object(projection.outputs) || !Array.isArray(projection.evidence)) continue
    for (const entry of projection.evidence) {
      if (!object(entry) || entry.kind !== 'inference' || !object(entry.target)) continue
      const t = entry.target
      if (!['port', 'recordId', 'field', 'at'].every(k => typeof t[k] === 'string')) continue
      const port = projection.outputs[t.port as string]
      if (!object(port) || !Array.isArray(port.records)) continue
      const record = port.records.find(r => object(r) && r.recordId === t.recordId)
      if (!object(record) || !object(record[t.field as string])) continue
      try {
        const value = readJsonPointer(record[t.field as string], `/value${t.at}`)
        const diagnostic = moduleInferenceBasisDiagnostic(value, Array.isArray(entry.inputRefs) ? entry.inputRefs : undefined)
        if (diagnostic) errors.push(`MODULE_CLAIM_INFERENCE_BASIS: ${projection.groupId ? `group=${projection.groupId}; ` : ''}target=${JSON.stringify({ port: t.port, recordId: t.recordId, field: t.field, at: t.at })}; ${diagnostic}`)
      } catch { continue }
      if (errors.length === 8) return [...errors, 'Additional inference targets may remain invalid; omitted targets are not accepted.']
    }
  }
  return errors
}
