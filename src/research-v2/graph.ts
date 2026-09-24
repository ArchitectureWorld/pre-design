import { canonicalizeJson } from '../presentation/canonical-json.ts'
import { CONDITION_FIELDS, type Condition, type ConditionValue, type ResearchFlags, type PlanningEdge } from './types.ts'

export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
export function normalizeFlags(input: ResearchFlags): Record<typeof CONDITION_FIELDS[number], ConditionValue> {
  canonicalizeJson(input) // Reject accessors, custom prototypes and non-JSON values before reading them.
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('CONDITION_INVALID: expected object')
  for (const key of Object.keys(input)) if (!(CONDITION_FIELDS as readonly string[]).includes(key)) throw new Error(`CONDITION_INVALID: ${key}`)
  const flags = {} as Record<typeof CONDITION_FIELDS[number], ConditionValue>
  for (const key of CONDITION_FIELDS) {
    const value = Object.hasOwn(input,key) ? input[key] : null
    if (value !== null && value !== 'unknown' && typeof value !== 'boolean') throw new Error(`CONDITION_INVALID: ${key}`)
    flags[key] = value === null ? 'unknown' : value
  }
  return flags
}
export function evaluate(condition: Condition, flags: ReturnType<typeof normalizeFlags>): ConditionValue {
  if (condition.op === 'always') return true
  const value = flags[condition.field]
  return value === 'unknown' ? 'unknown' : value === condition.value
}
export function topologicalWaves(ids: readonly string[], edges: readonly Pick<PlanningEdge,'source'|'target'>[]): string[][] {
  const remaining = new Set(ids), known = new Set(ids), waves: string[][] = []
  for (const e of edges) if (!known.has(e.source) || !known.has(e.target)) throw new Error('CATALOG_INVALID: dangling edge')
  while (remaining.size) {
    const wave = [...remaining].filter(id => !edges.some(e => e.target === id && remaining.has(e.source))).sort()
    if (!wave.length) throw new Error('CATALOG_INVALID: dependency cycle')
    waves.push(wave); for (const id of wave) remaining.delete(id)
  }
  return waves
}
