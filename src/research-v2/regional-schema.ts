import { z } from 'zod'
import { canonicalizeJson } from '../presentation/canonical-json.ts'
import { toWgs84 } from '../report/cartography/geometry.ts'
import { freeze } from './graph.ts'

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u)
const text = (max: number) => z.string().trim().min(1).max(max)
const timestamp = z.string().datetime({ offset: true })
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value =>
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value)
const coordinate = z.object({
  longitude: z.number().finite(), latitude: z.number().finite(),
  crs: z.enum(['EPSG:4326','WGS84','EPSG:3857']),
}).strict()
export const evidenceClasses = ['fact','source_conclusion','user_statement','agent_inference','assumption','decision','missing'] as const
const capture = z.object({
  sourceId: identifier, label: text(160), locator: text(1000), observedAt: timestamp,
  claimClass: z.enum(evidenceClasses), mediaType: z.literal('application/json'), content: z.string().min(1).max(256 * 1024),
}).strict()
const node = z.object({
  id: identifier, regionId: identifier, label: text(80),
  kind: z.enum(['project-entry','transport','residential','employment','industry','commercial','scenic','public-service','other']),
  selectionReason: text(600), relation: z.enum(['existing','potential']),
  entranceStatus: z.enum(['source-recorded','provisional']), coordinate,
  evidenceIds: z.array(identifier).min(1).max(16),
  coordinateBinding: z.object({ sourceId: identifier, selector: text(300).refine(v => v.startsWith('/')) }).strict(),
}).strict()
export const regionalOdRequestSchema = z.object({
  schemaVersion: z.literal('regional-od-request.v1'), projectId: identifier, snapshotId: identifier,
  scope: text(500), asOf: date, nodes: z.array(node).min(2).max(16),
  queries: z.array(z.object({ id: identifier, fromId: identifier, toId: identifier,
    mode: z.enum(['driving','walking','cycling','transit']),
  }).strict()).min(1).max(6),
  captures: z.array(capture).min(1).max(16),
  policy: z.object({
    maxRequests: z.number().int().min(0).max(20), timeoutMs: z.number().int().min(100).max(120000),
    snapTolerance: z.object({ meters: z.number().positive().max(10000), reviewedBy: text(120), reviewedAt: timestamp,
      rationale: text(600),
    }).strict().optional(),
  }).strict(),
}).strict()
export type RegionalOdRequest = z.infer<typeof regionalOdRequestSchema>
export type RegionalNode = RegionalOdRequest['nodes'][number]
export type EvidenceClass = typeof evidenceClasses[number]

function unique(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) throw new Error('DUPLICATE_ID')
}
export function readJsonPointer(document: unknown, pointer: string): unknown {
  if (!pointer.startsWith('/')) throw new Error('SOURCE_SELECTOR_INVALID')
  let value = document
  for (const part of pointer.slice(1).split('/')) {
    if (/~(?![01])/u.test(part)) throw new Error('SOURCE_SELECTOR_INVALID')
    const key = part.replaceAll('~1','/').replaceAll('~0','~')
    if (['__proto__','constructor','prototype'].includes(key) || value === null || typeof value !== 'object'
      || !Object.hasOwn(value,key)) throw new Error('SOURCE_SELECTOR_MISSING')
    value = (value as Record<string,unknown>)[key]
  }
  return value
}

/** Structural/source-selector validation is deliberately not labelled a fact check. */
export function parseRegionalOdRequest(input: unknown): RegionalOdRequest {
  if (Buffer.byteLength(canonicalizeJson(input),'utf8') > 2 * 1024 * 1024) throw new Error('RESEARCH_INPUT_TOO_LARGE')
  const parsed = regionalOdRequestSchema.safeParse(input)
  if (!parsed.success) throw new Error(`REGIONAL_INPUT_INVALID: ${parsed.error.issues.map(i=>i.path.join('.')+': '+i.message).join('; ')}`)
  const request = parsed.data
  unique(request.nodes.map(n=>n.id)); unique(request.queries.map(q=>q.id)); unique(request.captures.map(s=>s.sourceId))
  const captures = new Map(request.captures.map(s=>[s.sourceId,s]))
  const decoded = new Map<string,unknown>()
  for (const source of request.captures) {
    if (!/^(?:https:\/\/|workspace:)/u.test(source.locator)
      || /[?&](?:key|token|secret|authorization|access_token)=/iu.test(source.locator)) throw new Error('SOURCE_LOCATOR_INVALID')
    if (source.locator.startsWith('https:') && (new URL(source.locator).username || new URL(source.locator).password)) throw new Error('SOURCE_LOCATOR_INVALID')
    try { decoded.set(source.sourceId,JSON.parse(source.content)) } catch { throw new Error('CAPTURE_JSON_INVALID') }
  }
  for (const node of request.nodes) {
    toWgs84(node.coordinate)
    unique(node.evidenceIds)
    if (node.evidenceIds.some(id=>!captures.has(id)) || !node.evidenceIds.includes(node.coordinateBinding.sourceId)) {
      throw new Error('EVIDENCE_REFERENCE_MISSING')
    }
    if (captures.get(node.coordinateBinding.sourceId)!.claimClass === 'missing') throw new Error('COORDINATE_EVIDENCE_MISSING')
    const selected = readJsonPointer(decoded.get(node.coordinateBinding.sourceId), node.coordinateBinding.selector)
    if (canonicalizeJson(selected) !== canonicalizeJson(node.coordinate)) throw new Error('COORDINATE_SOURCE_MISMATCH')
  }
  const ids = new Set(request.nodes.map(n=>n.id))
  for (const query of request.queries) {
    if (!ids.has(query.fromId) || !ids.has(query.toId) || query.fromId===query.toId) throw new Error('OD_ENDPOINT_INVALID')
  }
  return freeze(request)
}
