import { z } from 'zod'
import { canonicalizeJson } from '../presentation/canonical-json.ts'
import { getResearchModuleSpec } from './specification.ts'
import { freeze } from './graph.ts'
import { PRIMARY_FIELDS, SHARED_FIELDS, EXTRA_PORT_FIELDS } from './module-contract-data.ts'

export const MODULE_CONTRACT_VERSION = 'planning-module-outputs.v1'
export const MODULE_CLAIM_CLASSES = ['fact', 'source_conclusion', 'user_statement', 'agent_inference', 'assumption', 'decision', 'missing'] as const
export const MODULE_RESULT_CLASSES = ['observation_summary', 'calculation', 'analysis_judgment', 'proposal', 'decision_record'] as const
const text = z.string().trim().min(1).max(8000)
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u)
const texts = z.array(text).max(500)
const ids = z.array(id).max(500)
const finite = z.number().finite()
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value =>
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'actual calendar date required')
const point = z.array(finite).min(2).max(3)
const line = z.array(point).min(2).max(100000)
const ring = z.array(point).min(4).max(100000)
const polygon = z.array(ring).min(1).max(1000)
const geometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: point }).strict(),
  z.object({ type: z.literal('MultiPoint'), coordinates: z.array(point).min(1).max(100000) }).strict(),
  z.object({ type: z.literal('LineString'), coordinates: line }).strict(),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(line).min(1).max(1000) }).strict(),
  z.object({ type: z.literal('Polygon'), coordinates: polygon }).strict(),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(polygon).min(1).max(1000) }).strict(),
])
const quantity = z.object({ value: finite, unit: text, basis: text }).strict()
const money = z.object({ amount: finite, currency: z.string().regex(/^[A-Z]{3}$/u), basis: text }).strict()
const range = z.object({ minimum: finite, maximum: finite, unit: text, basis: text }).strict()
const moneyRange = z.object({ minimum: finite, maximum: finite, currency: z.string().regex(/^[A-Z]{3}$/u), basis: text }).strict()
const valueSchemas = {
  text, id, texts, ids, number: finite, nonnegative: finite.nonnegative(), integer: z.number().int().nonnegative(),
  ratio: finite.min(0).max(1), boolean: z.boolean(), date: day, timestamp: z.iso.datetime({ offset: true }),
  quantity, quantities: z.array(quantity).max(500), money, range, moneyRange,
  numbers: z.array(finite.nonnegative()).max(500), geometry,
  coordinate: z.object({ x: finite, y: finite, crs: text, axisOrder: z.enum(['xy', 'yx']) }).strict(),
  scopeKind: z.enum(['research', 'implementation', 'influence']), axisOrder: z.enum(['xy', 'yx']),
  operatingStatus: z.enum(['operating', 'planned', 'building', 'closed', 'unknown']),
  formationState: z.enum(['existing', 'retained', 'proposed', 'new', 'provisional', 'unknown']),
  relationState: z.enum(['existing', 'potential', 'proposed', 'hypothesized', 'unknown']),
  transportMode: z.enum(['driving', 'walking', 'cycling', 'transit', 'other']),
  peerRelationship: z.enum(['direct', 'substitute', 'complementary', 'potential', 'reference']),
  selection: z.enum(['include', 'exclude', 'defer', 'conditional']),
  audienceRole: z.enum(['core', 'secondary', 'not-served', 'deferred']),
  productRole: z.enum(['core', 'supporting', 'shared', 'optional']),
  decisionStatus: z.enum(['proposed', 'adopted', 'rejected', 'deferred', 'conditional']),
  buildingAction: z.enum(['retain', 'repair', 'renovate', 'demolish', 'new-build', 'undecided']),
  checkStatus: z.enum(['verified', 'conditional', 'pending', 'failed', 'not-applicable']),
  approvalStatus: z.enum(['not-required', 'not-started', 'proposed', 'submitted', 'accepted-for-review', 'approved', 'rejected', 'expired', 'unknown']),
  fundingStatus: z.enum(['proposed', 'eligible', 'applied', 'approved', 'received', 'available', 'rejected', 'unknown']),
  cooperationStatus: z.enum(['proposed', 'uncontacted', 'contacted', 'intent', 'signed', 'operating', 'rejected', 'unknown']),
} satisfies Record<string, z.ZodType>
export type ModuleValueKind = keyof typeof valueSchemas
export interface ModuleFieldContract { readonly name: string; readonly kind: ModuleValueKind; readonly sourceLabel: string }
export interface ModulePortContract { readonly type: string; readonly fields: readonly ModuleFieldContract[] }
export interface ModuleFieldContracts {
  readonly contractVersion: typeof MODULE_CONTRACT_VERSION
  readonly itemId: string
  readonly moduleId: string
  readonly title: string
  readonly approvedFields: string
  readonly auditColumns: readonly string[]
  readonly ports: Readonly<Record<string, ModulePortContract>>
}
export interface ModuleOutputValidation { readonly valid: boolean; readonly errors: readonly string[] }

function decodeFields(definition: string | undefined): ModuleFieldContract[] {
  if (definition?.startsWith('@')) definition = SHARED_FIELDS[definition.slice(1)]
  if (!definition) throw new Error('MODULE_FIELDS_UNIMPLEMENTED')
  const fields = definition.split(';').map(part => {
    const [name, kind, sourceLabel, ...extra] = part.split(':')
    if (extra.length || !/^[a-z][a-zA-Z0-9]+$/u.test(name) || !Object.hasOwn(valueSchemas, kind) || !sourceLabel) {
      throw new Error('MODULE_FIELD_DEFINITION_INVALID')
    }
    return { name, kind: kind as ModuleValueKind, sourceLabel }
  })
  if (new Set(fields.map(f => f.name)).size !== fields.length) throw new Error('MODULE_FIELD_DUPLICATE')
  return fields
}

const contractCache = new Map<string, ModuleFieldContracts>()
/** Professional field names/types plus the complete approved source prose. The
 * return value is guidance for producers, never an executed/approved result. */
export function getModuleFieldContracts(itemId: string): ModuleFieldContracts {
  const cached = contractCache.get(itemId)
  if (cached) return cached
  const spec = getResearchModuleSpec(itemId)
  const ports = Object.fromEntries(spec.outputPorts.map((port, index) => {
    const definition = index === 0 ? PRIMARY_FIELDS[itemId] : SHARED_FIELDS[EXTRA_PORT_FIELDS[port.name]]
    return [port.name, { type: port.type, fields: decodeFields(definition) }]
  }))
  const result: ModuleFieldContracts = freeze({ contractVersion: MODULE_CONTRACT_VERSION, itemId, moduleId: spec.moduleId, title: spec.title,
    approvedFields: spec.fields, auditColumns: spec.table.columns.split('｜'), ports })
  contractCache.set(itemId, result)
  return result
}

function boundField(field: ModuleFieldContract, itemId: string): z.ZodType {
  const measuredArea = itemId === '1.02' && field.name === 'area'
  const provenance = { claimRefs: ids.min(1), claimClass: z.enum(MODULE_CLAIM_CLASSES.filter(c => c !== 'missing')), limitations: texts }
  // Null means missing, not zero, not a successful negative observation. The
  // missing branch cannot manufacture a value or claim it is a source fact.
  return z.union([
    z.object({ value: z.null(), claimRefs: ids.max(0), claimClass: z.literal('missing'), limitations: texts.min(1) }).strict(),
    z.object({ value: z.null(), claimRefs: ids.min(1), claimClass: z.literal('decision'), limitations: texts.min(1), notApplicableReason: text }).strict(),
    z.object({ value: itemId === '1.02' && field.name === 'geometry'
      ? z.discriminatedUnion('type', [z.object({type:z.literal('Polygon'),coordinates:polygon}).strict(),
        z.object({type:z.literal('MultiPolygon'),coordinates:z.array(polygon).min(1).max(1000)}).strict()])
      : valueSchemas[field.kind], ...provenance }).strict(),
  ]).describe(field.sourceLabel + (measuredArea
    ? '。边界面积数值须绑定source或calculation证据，保留投影/图幅/球面等原始口径；有依据的条件计算仍可标assumption并明确basis=scenario，禁止仅用proposal/assumption理由设定测量值。无证据则missing/null，不得仅改标来源性质。'
    : ''))
}
const schemaCache = new Map<string, z.ZodObject>()
export type ModuleOutputFieldSelection = Readonly<Record<string, readonly string[]>>
function outputValidator(itemId: string, selection?: ModuleOutputFieldSelection): z.ZodObject {
  const cached = selection ? undefined : schemaCache.get(itemId)
  if (cached) return cached
  const contract = getModuleFieldContracts(itemId)
  const ports = Object.fromEntries(Object.entries(contract.ports).filter(([name]) => !selection || Object.hasOwn(selection, name)).map(([name, port]) => {
    const row = z.object({ recordId: id, resultClass: z.enum(MODULE_RESULT_CLASSES),
      ...Object.fromEntries(port.fields.filter(field => !selection || selection[name].includes(field.name)).map(field => [field.name, boundField(field, itemId)])) }).strict()
    return [name, z.object({ type: z.literal(port.type), quality: z.enum(['unreviewed', 'accepted', 'limited', 'rejected']),
      records: z.array(row).max(2000), claimRefs: ids, limitations: texts, scope: text, asOf: day }).strict()]
  }))
  const result = z.object(ports).strict()
  if (!selection) schemaCache.set(itemId, result)
  return result
}

/** JSON Schema covers exact per-port field types and evidence envelopes. The
 * semantic checks in validateModuleOutputs are also mandatory before persistence.
 * This API grants no review/publication authority and never fills missing values. */
export function getModuleOutputSchema(itemId: string): Readonly<Record<string, unknown>> {
  const contract = getModuleFieldContracts(itemId)
  return freeze({ ...z.toJSONSchema(outputValidator(itemId), { target: 'draft-7', reused: 'inline' }),
    title: `${itemId} ${contract.title}`, description: `${MODULE_CONTRACT_VERSION}; ${contract.approvedFields}\n审计表：${contract.auditColumns.join('｜')}\n必须另外调用 validateModuleOutputs 执行引用和语义校验；Schema合法不等于完成研究或批准。` })
}

function allUnique(values: readonly string[]): boolean { return new Set(values).size === values.length }
function closedRings(value: Record<string, unknown>): boolean {
  const coords = value.coordinates as number[][][] | number[][][][]
  const rings: number[][][] = value.type === 'Polygon' ? coords as number[][][] : (coords as number[][][][]).flat()
  return rings.every(r => JSON.stringify(r[0]) === JSON.stringify(r.at(-1)))
}

/** Pure structural/within-result semantic validation. Real evidence resolution,
 * independent fact checks, calculation replay and publication remain caller-owned. */
export function validateModuleOutputs(itemId: string, outputs: unknown): ModuleOutputValidation {
  return validateOutputValues(itemId, outputs)
}
/** Exact existing field/envelope semantics for explicitly submitted fields only; never module completeness or approval. */
export function validateModuleOutputFields(itemId: string, outputs: unknown, selection: ModuleOutputFieldSelection): ModuleOutputValidation {
  const contract = getModuleFieldContracts(itemId)
  if (!Object.keys(selection).length || Object.entries(selection).some(([port, fields]) => !contract.ports[port] || !fields.length
    || new Set(fields).size !== fields.length || fields.some(field => !contract.ports[port].fields.some(f => f.name === field)))) return { valid: false, errors: ['MODULE_OUTPUT_FIELD_SELECTION'] }
  return validateOutputValues(itemId, outputs, selection)
}
function validateOutputValues(itemId: string, outputs: unknown, selection?: ModuleOutputFieldSelection): ModuleOutputValidation {
  const errors: string[] = []
  try {
    // Reject accessors/non-JSON before any traversal. Never mutate the submission.
    if (Buffer.byteLength(canonicalizeJson(outputs), 'utf8') > 16 * 1024 * 1024) return { valid: false, errors: ['MODULE_OUTPUT_TOO_LARGE'] }
    const parsed = outputValidator(itemId, selection).safeParse(outputs)
    if (!parsed.success) return { valid: false, errors: parsed.error.issues.slice(0, 100).map(issue => {
      let selected: unknown = outputs
      for (const key of issue.path) selected = selected && typeof selected === 'object' && Object.hasOwn(selected, key)
        ? (selected as Record<PropertyKey, unknown>)[key] : undefined
      const wrapper = selected as { claimClass?: unknown; value?: unknown } | undefined
      if (wrapper && typeof wrapper === 'object' && wrapper.claimClass === 'missing' && wrapper.value !== null) {
        const received = Array.isArray(wrapper.value) ? 'array' : typeof wrapper.value
        return `${issue.path.join('.')}.value: MISSING_REQUIRES_JSON_NULL: claimClass=missing 必须使用 JSON null；当前为 ${received}。不能写成字符串 "null"、0、空数组或占位对象；保留缺失原因，不得改标事实或补造值。`
      }
      return `${issue.path.join('.')}: ${issue.message}`
    }) }
    const contract = getModuleFieldContracts(itemId)
    for (const [name, definition] of Object.entries(contract.ports)) {
      if (selection && !Object.hasOwn(selection, name)) continue
      const port = parsed.data[name] as { quality: string; records: Record<string, any>[]; claimRefs: string[]; limitations: string[] }
      const fail = (path: string, code: string) => { if (errors.length < 100) errors.push(`${name}${path}: ${code}`) }
      if (!allUnique(port.claimRefs)) fail('.claimRefs', 'DUPLICATE_CLAIM_REFERENCE')
      if (!allUnique(port.records.map(r => r.recordId))) fail('.records', 'DUPLICATE_RECORD_ID')
      if (port.quality === 'limited' && !port.limitations.length) fail('.limitations', 'LIMITED_REQUIRES_LIMITATIONS')
      if (!port.records.length && (!port.limitations.length || port.quality === 'accepted')) fail('.records', 'EMPTY_RESULT_NOT_ACCEPTED')
      const declaredClaims = new Set(port.claimRefs)
      for (const [index, row] of port.records.entries()) {
        if (!selection && port.quality === 'accepted' && definition.fields.every(field => row[field.name].value === null)) fail(`.records.${index}`, 'EMPTY_PROFESSIONAL_RESULT_NOT_ACCEPTED')
        for (const field of definition.fields.filter(field => !selection || selection[name].includes(field.name))) {
        const value = row[field.name] as { value: unknown; claimRefs: string[]; claimClass: string; limitations: string[] }
        const path = `.records.${index}.${field.name}`
        if (!allUnique(value.claimRefs)) fail(path, 'DUPLICATE_FIELD_CLAIM')
        if (value.claimRefs.some(ref => !declaredClaims.has(ref))) fail(path, 'FIELD_CLAIM_NOT_IN_PORT')
        if (value.value === null) {
          if (port.quality === 'accepted' && value.claimClass === 'missing') fail(path, 'MISSING_INPUT_CANNOT_BE_ACCEPTED')
          continue
        }
        if (['source_conclusion', 'agent_inference', 'assumption'].includes(value.claimClass) && !value.limitations.length) fail(path, 'CONDITIONAL_FIELD_REQUIRES_LIMITATIONS')
        if (field.kind === 'range' || field.kind === 'moneyRange') {
          const r = value.value as { minimum: number; maximum: number }
          if (r.minimum > r.maximum) fail(path, 'REVERSED_RANGE')
        }
        if (field.kind === 'geometry') {
          const g = value.value as Record<string, unknown>
          if (['Polygon', 'MultiPolygon'].includes(String(g.type)) && !closedRings(g)) fail(path, 'GEOMETRY_RING_NOT_CLOSED')
          // Boundary geometry stores CRS/axis metadata in adjacent fields. Wait
          // for complete group assembly; never guess axes from plausible values.
          if (!selection && itemId === '1.02' && ['WGS84', 'EPSG:4326'].includes(row.crs?.value)) {
            const axis = row.axisOrder?.value
            if (axis !== 'xy' && axis !== 'yx') fail(path, 'GEOMETRY_AXIS_ORDER_REQUIRED')
            else {
              const inRange = (coordinates: unknown): boolean => {
                if (!Array.isArray(coordinates)) return false
                if (typeof coordinates[0] === 'number') {
                  const [longitude, latitude] = axis === 'xy' ? coordinates : [coordinates[1], coordinates[0]]
                  return typeof longitude === 'number' && typeof latitude === 'number' && Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90
                }
                return coordinates.every(inRange)
              }
              if (!inRange(g.coordinates)) fail(path, 'WGS84_GEOMETRY_OUT_OF_RANGE')
            }
          }
        }
        if (field.kind === 'coordinate') {
          const c = value.value as { x: number; y: number; crs: string; axisOrder: string }
          if (['WGS84', 'EPSG:4326'].includes(c.crs)) {
            const [longitude, latitude] = c.axisOrder === 'xy' ? [c.x, c.y] : [c.y, c.x]
            if (Math.abs(longitude) > 180 || Math.abs(latitude) > 90) fail(path, 'WGS84_COORDINATE_OUT_OF_RANGE')
          }
        }
      }
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'MODULE_OUTPUT_INVALID')
  }
  return { valid: errors.length === 0, errors }
}
