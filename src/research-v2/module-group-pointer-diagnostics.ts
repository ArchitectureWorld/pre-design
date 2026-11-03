import { parseModuleProjectionOutputsJson } from './module-author-projection.ts'
import { readJsonPointer } from './regional-schema.ts'
import { sha256CanonicalJson } from '../presentation/canonical-json.ts'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Describe rejected addresses only; never repair an author's pointer or copy its field value. */
export function moduleGroupPointerDiagnostics(raw: unknown): string[] {
  if (!object(raw) || !Array.isArray(raw.evidence)) return []
  let outputs: unknown
  try { outputs = raw.outputs ?? (typeof raw.outputsJson === 'string' ? parseModuleProjectionOutputsJson(raw.outputsJson) : undefined) } catch { return [] }
  if (!object(outputs)) return []
  const errors: string[] = []
  for (const [index, entry] of raw.evidence.entries()) {
    if (!object(entry) || !object(entry.target)) continue
    const target = entry.target
    if (typeof target.port !== 'string' || typeof target.field !== 'string' || typeof target.at !== 'string') continue
    const port = outputs[target.port]
    if (!object(port) || !Array.isArray(port.records)) continue
    const row = port.records.find(row => object(row) && row.recordId === target.recordId)
    if (!object(row) || !object(row[target.field])) continue
    const field = row[target.field] as Record<string, unknown>
    try {
      if (target.at !== '' && (!target.at.startsWith('/') || /~(?![01])/u.test(target.at))) throw new Error('invalid pointer syntax')
      readJsonPointer({ value: field.value }, `/value${target.at}`)
    } catch {
      const valueStructure = {
        type: Array.isArray(field.value) ? 'array' : field.value === null ? 'null' : typeof field.value,
        ...(Array.isArray(field.value) ? { arrayLength: field.value.length } : {}),
        ...(object(field.value) ? { objectKeys: Object.keys(field.value).slice(0, 8), objectKeyCount: Object.keys(field.value).length } : {}),
        ...(field.value === undefined ? {} : { rawValueHash: sha256CanonicalJson(field.value) }),
      }
      const hint = field.value !== null && typeof field.value !== 'object'
        ? 'the scalar root is at=""; do not add /value'
        : 'select an existing value-relative address from the submitted array/object; the field wrapper is not part of this pointer'
      errors.push(`/evidence/${index}/target/at: target=${JSON.stringify(target)} does not resolve relative to field.value; valueStructure=${JSON.stringify(valueStructure)}; ${hint}; author must correct it from the original field`)
      if (errors.length === 8) return [...errors, 'Additional pointers may be invalid; omitted references are not accepted.']
    }
  }
  return errors
}
