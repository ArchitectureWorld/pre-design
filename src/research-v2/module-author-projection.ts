import { createHash } from 'node:crypto'
import { moduleLocalReferenceDiagnostics } from './module-local-reference-diagnostics.ts'
import { assertObjectJsonSchema, validateJsonSchemaValue, type JsonSchemaNode, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { MaterialCorpus } from '../materials/research-evidence.ts'
import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { getModuleFieldContracts, getModuleOutputSchema, MODULE_CLAIM_CLASSES, validateModuleOutputs, validateModuleOutputFields, type ModuleOutputFieldSelection } from './module-contracts.ts'
import { assertMaterialCorpus, assertModuleFieldClaimCoverage, verifyModuleSourceValues, moduleInferenceBasisDiagnostic, moduleClaimUnitConflict, type ModuleClaim, type ModuleSourceValue, type ModuleOperand } from './module-claims.ts'
import { readJsonPointer } from './regional-schema.ts'
import { sourceScalarGuidance } from './source-scalar-guidance.ts'
import {nativeHandoffAddressChoices} from './native-handoff-contract.ts'
import {verifyPhotoCoordinateMapping,assertPhotoCoordinateMappingTarget,type PhotoCoordinateMapping} from './photo-coordinate-mapping.ts'
import {verifyPhotoDateMapping,assertPhotoDateMappingTarget,type PhotoDateMapping} from './photo-date-mapping.ts'
import {verifySourceCalendarDateMapping,assertSourceCalendarDateMappingTarget,type SourceCalendarDateMapping} from './source-calendar-date-mapping.ts'
import {verifyNativeQueryStringMapping,assertNativeQueryStringMappingTarget,type NativeQueryStringMapping} from './native-query-string-mapping.ts'

export const MODULE_AUTHOR_PROJECTION_VERSION = 'module-author-projection.v1' as const
export const MODULE_AUTHOR_PROJECTION_JSON_VERSION = 'module-author-projection-json.v2' as const
// The author transport has no independent fact verification or user-statement evidence kind.
const authorClaimClasses = MODULE_CLAIM_CLASSES.filter(value => value !== 'fact' && value !== 'user_statement')
export interface ProjectionFieldAddress { readonly port: string; readonly recordId: string; readonly field: string; readonly at: string }
interface ProjectionSource { readonly path: string; readonly page?: number; readonly quote: string; readonly valueQuote?: string; readonly coordinateMapping?:PhotoCoordinateMapping;readonly dateMapping?:PhotoDateMapping|SourceCalendarDateMapping;readonly queryMapping?:NativeQueryStringMapping }
type ProjectionReference = { readonly local: ProjectionFieldAddress } | { readonly upstream: { readonly moduleId: string; readonly claimId: string } }
type ProjectionOperand = ProjectionReference | { readonly source: ProjectionSource; readonly value: number } | { readonly sourceId: string }
  | Extract<ModuleOperand,{scenarioAssumption:unknown}>
export interface ProjectionEvidence {
  readonly target: ProjectionFieldAddress; readonly kind: Exclude<ModuleClaim['kind'], 'missing'>
  readonly unit?: string; readonly source?: ProjectionSource; readonly rationale?: string; readonly inputRefs?: readonly ProjectionReference[]
  readonly calculation?: { readonly operation: NonNullable<ModuleClaim['calculation']>['operation']; readonly basis?: 'source' | 'scenario'; readonly operands: readonly ProjectionOperand[]; readonly weights?: readonly ProjectionOperand[] }
}
interface ProjectionStep {
  readonly step: number; readonly status: 'completed' | 'limited'; readonly summary: string
  readonly fieldRefs: readonly ProjectionFieldAddress[]; readonly limitations: readonly string[]
}
export interface ModuleAuthorProjection {
  readonly projectionVersion: typeof MODULE_AUTHOR_PROJECTION_VERSION; readonly outputs: Record<string, unknown>
  readonly evidence: readonly ProjectionEvidence[]; readonly limitations: readonly string[]; readonly steps: readonly ProjectionStep[]
}
export interface ModuleAuthorProjectionJson extends Omit<ModuleAuthorProjection, 'projectionVersion' | 'outputs'> {
  readonly projectionVersion: typeof MODULE_AUTHOR_PROJECTION_JSON_VERSION; readonly outputsJson: string
}
export type ModuleAuthorSubmission = ModuleAuthorProjection | ModuleAuthorProjectionJson
export interface CompiledModuleCandidate {
  readonly outputs: Record<string, unknown>; readonly claims: readonly ModuleClaim[]; readonly sourceValues: readonly ModuleSourceValue[]; readonly limitations: readonly string[]
  readonly steps: readonly { readonly step: number; readonly status: 'completed' | 'limited'; readonly summary: string; readonly claimRefs: readonly string[]; readonly limitations: readonly string[] }[]
}
export interface ModuleAuthorReceipt {
  readonly executionId: string; readonly childId: string; readonly actualModel: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }; readonly stopReason: string
}
interface ProjectionAuditHashes {
  readonly projectionHash: string; readonly compiledCandidateHash: string; readonly receiptBindingHash: string
}
export interface ModuleProjectionV1Audit extends ProjectionAuditHashes {
  readonly version: typeof MODULE_AUTHOR_PROJECTION_VERSION; readonly raw: ModuleAuthorProjection
  readonly outputsJsonHash?: never
}
export interface ModuleProjectionJsonAudit extends ProjectionAuditHashes {
  readonly version: typeof MODULE_AUTHOR_PROJECTION_JSON_VERSION; readonly raw: ModuleAuthorProjectionJson; readonly outputsJsonHash: string
}
export type ModuleProjectionAudit = ModuleProjectionV1Audit | ModuleProjectionJsonAudit
const string: JsonSchemaNode = { type: 'string' }, strings: JsonSchemaNode = { type: 'array', items: string }
const object = (properties: Record<string, JsonSchemaNode>, required = Object.keys(properties)): ObjectJsonSchema => ({ type: 'object', additionalProperties: false, properties, required })
const array = (items: JsonSchemaNode): JsonSchemaNode => ({ type: 'array', items })
const addressSchema = object({ port: string, recordId: string, field: string, at: string })
const sourceSchema = object({ path: string, page: { type: 'integer' }, quote: string, valueQuote: string }, ['path', 'quote'])
const referenceAlternatives = [object({ local: addressSchema }), object({ upstream: object({ moduleId: string, claimId: string }) })]
const operandSchema: JsonSchemaNode = { oneOf: [...referenceAlternatives, object({ source: sourceSchema, value: { type: 'number' } }), object({ sourceId: string }),
 object({scenarioAssumption:object({value:{type:'number'},unit:string,rationale:string})})] }
const evidenceSchema = object({ target: { ...addressSchema,
  description: '同一{port,recordId,field,at}最多一条evidence；即使kind/source/quote/rationale不同也算重复。字段只有一个claimClass，不能在同一标量混写历史来源与规划假设，再用冲突kind分别绑定。' },
  kind: { type: 'string', enum: ['source', 'calculation', 'assumption', 'proposal', 'inference'] },
  unit: string, source: sourceSchema, rationale: string, inputRefs: array({ oneOf: referenceAlternatives }),
  calculation: object({ operation: { type: 'string', enum: ['sum', 'difference', 'product', 'ratio', 'weighted_mean', 'min', 'max'] }, basis: { type: 'string', enum: ['source', 'scenario'] }, operands: array(operandSchema), weights: array(operandSchema) }, ['operation', 'operands']),
}, ['target', 'kind'])
/** Enforce existing missing/null and evidence member-presence rules at the
 * native tool boundary. This constrains author transport; it never changes an
 * evidence kind or fills a source, value, calculation or rationale. */
export function bindNativeModuleEvidenceSchema(schema:ObjectJsonSchema):ObjectJsonSchema {
  const bound=structuredClone(schema),evidence=bound.properties?.evidence?.items
  if(!evidence?.properties)return bound
  const {source,calculation,...shared}=evidence.properties
  const sourceAddresses=nativeHandoffAddressChoices(schema,true)
  bound.properties!.evidence.items={oneOf:[
    ...(['source','calculation'] as const).map(kind=>object({...shared,...(kind==='source'&&sourceAddresses.length?{
      target:sourceAddresses.length===1?sourceAddresses[0]:{oneOf:sourceAddresses}}:{}),kind:{type:'string',const:kind},
      ...(kind==='source'?{source}:{calculation})},[...evidence.required!,kind])),
    object({...shared,kind:{type:'string',enum:['assumption','proposal']}},[...evidence.required!,'rationale']),
    object({...shared,kind:{type:'string',const:'inference'}},[...evidence.required!,'rationale','inputRefs']),
  ],description:'选择与kind一致的唯一证据分支：source必须包含source且不含calculation；calculation必须包含calculation且不含source；proposal/assumption/inference都不能包含source或calculation。字段的业务分类和依据由作者判断，不得机械删除、重标或改写为过检。'}
  for(const port of Object.values(bound.properties?.outputs?.properties??{})){
    const fields=port.properties?.records?.items?.properties
    for(const [name,envelope] of Object.entries(fields??{})){
      const properties=envelope.properties,claimClass=properties?.claimClass
      if(!properties?.value||!claimClass?.enum?.includes('missing'))continue
      const {description,...field}=envelope
      // Only correlate missing with JSON null. Retain all other original value
      // types, including decision/null with notApplicableReason; their full
      // semantic and evidence requirements remain centrally verified.
      fields![name]={...(description?{description}:{}),oneOf:[
        {...field,properties:{...properties,value:{type:'null'},claimClass:{type:'string',const:'missing'}}},
        {...field,properties:{...properties,claimClass:{...claimClass,enum:claimClass.enum.filter(value=>value!=='missing')}}},
      ]}
    }
  }
  const describeSourcePaths=(node:JsonSchemaNode)=>{
    if(node.properties?.path&&node.properties.quote)node.properties.path.description='核对冻结原文后逐字复制完整path/page和长哈希文件名，不得缩写、漏字或拼造；原件存在不代表支持字段值。'
    Object.values(node.properties??{}).forEach(describeSourcePaths)
    if(node.items)describeSourcePaths(node.items)
    node.oneOf?.forEach(describeSourcePaths)
  }
  describeSourcePaths(bound.properties!.evidence.items!)
  assertObjectJsonSchema(bound)
  return bound
}
interface RawSchema extends Omit<JsonSchemaNode, 'properties' | 'items' | 'oneOf'> { properties?: Record<string, RawSchema>; items?: RawSchema; oneOf?: RawSchema[]; anyOf?: RawSchema[]; pattern?: string }
function nativeValue(raw: RawSchema, describePattern = false): JsonSchemaNode {
  const result: JsonSchemaNode = {}
  for (const key of ['type', 'required', 'additionalProperties', 'enum', 'const', 'description', 'title'] as const) if (raw[key] !== undefined) Object.assign(result, { [key]: raw[key] })
  // DSH's native subset has no pattern keyword. Keep the exact central
  // constraint visible to the author without claiming native enforcement.
  if (describePattern && raw.pattern) result.description = [raw.description, `业务正则 ${raw.pattern}；由中央严格校验，原生类型通过不代表合规。`].filter(Boolean).join('\n')
  if (raw.properties) result.properties = Object.fromEntries(Object.entries(raw.properties).map(([key, value]) => [key, nativeValue(value, describePattern)]))
  if (raw.items) result.items = nativeValue(raw.items, describePattern)
  if (raw.oneOf ?? raw.anyOf) result.oneOf = (raw.oneOf ?? raw.anyOf)!.map(value => nativeValue(value, describePattern))
  return result
}
/** Evidence is declared once globally, not duplicated into every professional field. */
export function getModuleAuthorProjectionSchema(itemId: string): ObjectJsonSchema {
  const full = getModuleOutputSchema(itemId) as RawSchema, contracts = getModuleFieldContracts(itemId)
  const outputs = Object.fromEntries(Object.entries(contracts.ports).map(([name, port]) => {
    const original = full.properties![name], row = original.properties!.records.items!
    const fields = Object.fromEntries(port.fields.map(field => {
      const envelope = row.properties![field.name], populated = (envelope.anyOf ?? envelope.oneOf)!.find(branch => branch.properties?.claimClass.enum)!
      const identifier = field.kind === 'id' || field.kind === 'ids'
        ? itemId === '3.05'
          ? '机器关联标识，不是名称或中文定位；来源/冻结ID逐字沿用。确已作出的临时研究编号选择用decision+proposal及rationale说明对象、规则、范围，保留非官方及未核限制，不能冒充来源编号、营业或审批事实；无依据保持missing/null且不附evidence。'
          : '机器关联标识，不是名称或中文定位；临时研究编号选择用decision+proposal；missing/null。'
        : undefined
      return [field.name, { ...object({ value: { oneOf: [{ type: 'null' }, nativeValue(populated.properties!.value, true)] },
        claimClass: { type: 'string', enum: [...authorClaimClasses] }, limitations: strings, notApplicableReason: string,
      }, ['value', 'claimClass', 'limitations']), ...((envelope.description || identifier) ? { description: [envelope.description, identifier].filter(Boolean).join('\n') } : {}) }]
    }))
    return [name, { ...object({ ...Object.fromEntries(Object.entries(original.properties!).filter(([key]) => !['records', 'claimRefs'].includes(key)).map(([key, value]) => [key, nativeValue(value)])),
      records: array(object({ recordId: nativeValue(row.properties!.recordId), resultClass: nativeValue(row.properties!.resultClass), ...fields })),
    }), description: '作者协议不支持fact/user_statement。来源摘录用source_conclusion+source；来源复算用agent_inference/source_conclusion+calculation；明确条件测算用assumption+calculation及basis=scenario和rationale，继承假设且端口保持limited；有依据推断用agent_inference+inference及inputRefs；实际研究选择用decision+proposal及rationale；实际假设用assumption+assumption及rationale；不支持的输入保留missing/null及原因。不得为过检改标用户陈述、现场事实或业务值；任务选择与假设不等于正式名称、委托或批准。' }]
  }))
  const scopedEvidence = itemId === '1.07' ? { ...evidenceSchema, properties: { ...evidenceSchema.properties, source: { ...sourceSchema,
    properties: { ...sourceSchema.properties, coordinateMapping: object({kind:{type:'string',const:'photo-gps-axis-order.v1'},axisOrder:{type:'string',enum:['xy','yx']},xValueQuote:string,yValueQuote:string}),
      dateMapping:object({kind:{type:'string',const:'photo-exif-calendar-date.v1'},dateTimeOriginalQuote:string}) },
  } } } : itemId==='1.03'?{...evidenceSchema,properties:{...evidenceSchema.properties,source:{...sourceSchema,properties:{...sourceSchema.properties,
    dateMapping:object({kind:{type:'string',const:'source-calendar-date.v1'},calendarDateQuote:string})}}}} : itemId==='3.04'?{...evidenceSchema,properties:{...evidenceSchema.properties,source:{...sourceSchema,properties:{...sourceSchema.properties,
    queryMapping:object({kind:{type:'string',const:'native-search-query-json-string.v1'},callId:{type:'string'},queryIndex:{type:'integer'}})},
    description:'queryMapping仅用于原生搜索日志中discoveryQueries叶的显式JSON字符串表示；完整call原文、valueQuote完整原token及原生声明必须严格对应。'}}}:evidenceSchema
  const result = object({ projectionVersion: { type: 'string', const: MODULE_AUTHOR_PROJECTION_VERSION }, outputs: object(outputs), evidence: array(scopedEvidence),
    limitations: strings, steps: array(object({ step: { type: 'integer', enum: [1, 2, 3, 4] }, status: { type: 'string', enum: ['completed', 'limited'] }, summary: string, fieldRefs: array(addressSchema), limitations: strings })) })
  assertObjectJsonSchema(result)
  return result
}
/** Only the transport changes. The decoded object must still pass the full v1 projection schema. */
export function getModuleAuthorProjectionJsonSchema(itemId: string): ObjectJsonSchema {
  const { outputs: _outputs, ...rest } = getModuleAuthorProjectionSchema(itemId).properties!
  const result = object({ ...rest, projectionVersion: { type: 'string', const: MODULE_AUTHOR_PROJECTION_JSON_VERSION }, outputsJson: string })
  assertObjectJsonSchema(result)
  return result
}
const fail = (code: string, detail = ''): never => { throw new Error(`${code}${detail ? ': ' + detail : ''}`) }
export const hashModuleProjectionJsonText = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** Check lexical keys before the single JSON.parse call, which otherwise silently loses duplicate keys. */
export function parseModuleProjectionOutputsJson(text: string): Record<string, unknown> {
  let offset = 0
  const syntax = (): never => {
    const at = Math.min(offset, text.length), prefix = text.slice(0, at)
    const line = prefix.split('\n').length, column = at - prefix.lastIndexOf('\n')
    return fail('MODULE_PROJECTION_JSON_SYNTAX', `offset ${offset}; line ${line}, column ${column}; context=${JSON.stringify(text.slice(Math.max(0, at - 120), at + 120))}`)
  }
  const whitespace = () => { while (/[\x20\t\r\n]/u.test(text[offset] ?? '\0')) offset++ }
  const stringToken = (): string => {
    if (text[offset++] !== '"') syntax()
    let value = ''
    while (offset < text.length) {
      const char = text[offset++]
      if (char === '"') return value
      if (char.charCodeAt(0) < 0x20) syntax()
      if (char !== '\\') { value += char; continue }
      const escaped = text[offset++]
      if (escaped === 'u') {
        const hex = text.slice(offset, offset + 4)
        if (!/^[0-9a-f]{4}$/iu.test(hex)) syntax()
        value += String.fromCharCode(Number.parseInt(hex, 16)); offset += 4
      } else {
        const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
        if (!Object.hasOwn(escapes, escaped)) syntax()
        value += escapes[escaped]
      }
    }
    return syntax()
  }
  const valueToken = (): void => {
    whitespace()
    const char = text[offset]
    if (char === '"') { stringToken(); return }
    if (char === '{' || char === '[') {
      const isObject = char === '{', end = isObject ? '}' : ']', keys = new Set<string>()
      offset++; whitespace()
      if (text[offset] === end) { offset++; return }
      for (;;) {
        if (isObject) {
          const key = stringToken()
          if (keys.has(key)) fail('MODULE_PROJECTION_JSON_DUPLICATE_KEY', key)
          keys.add(key); whitespace()
          if (text[offset++] !== ':') syntax()
        }
        valueToken(); whitespace()
        if (text[offset] === end) { offset++; return }
        if (text[offset++] !== ',') syntax()
        whitespace()
      }
    }
    const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(text.slice(offset))?.[0]
    if (literal === undefined) return syntax()
    if (!['true', 'false', 'null'].includes(literal) && !Number.isFinite(Number(literal))) fail('MODULE_PROJECTION_JSON_NUMBER', `offset ${offset}`)
    offset += literal.length
  }
  try {
    valueToken(); whitespace()
    if (offset !== text.length) syntax()
    const decoded: unknown = JSON.parse(text)
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) fail('MODULE_PROJECTION_JSON_OBJECT')
    return decoded as Record<string, unknown>
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('MODULE_PROJECTION_JSON_')) throw error
    return syntax()
  }
}
const escape = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1')
const fieldKey = ({ port, recordId, field }: Omit<ProjectionFieldAddress, 'at'>) => JSON.stringify([port, recordId, field])
const addressKey = (address: ProjectionFieldAddress) => JSON.stringify([address.port, address.recordId, address.field, address.at])
interface CanonicalField { value: unknown; claimClass: string; limitations: string[]; notApplicableReason?: string; claimRefs?: string[] }
interface CanonicalPort { records: ({ recordId: string; resultClass: string } & Record<string, unknown>)[]; claimRefs?: string[]; [key: string]: unknown }

/** Mechanical bindings are shared by partial checks and final compilation; no professional values are filled in. */
function bindProjectionFields(itemId: string, projection: Pick<ModuleAuthorProjection, 'outputs' | 'evidence'>, selection: ModuleOutputFieldSelection) {
  const outputs = structuredClone(projection.outputs) as Record<string, CanonicalPort>, moduleId = getModuleFieldContracts(itemId).moduleId
  const fields = new Map<string, { value: CanonicalField; selector: string; port: CanonicalPort }>()
  for (const [portName, names] of Object.entries(selection)) {
    const port = outputs[portName]; port.claimRefs = []
    port.records.forEach((record, index) => { for (const name of names) {
      const key = fieldKey({ port: portName, recordId: record.recordId, field: name })
      if (fields.has(key)) fail('MODULE_PROJECTION_RECORD_DUPLICATE', key)
      const value = record[name] as CanonicalField; value.claimRefs = []
      fields.set(key, { value, port, selector: `/outputs/${escape(portName)}/records/${index}/${escape(name)}/value` })
    } })
  }
  const claims = new Map<string, ModuleClaim>(), evidenceByAddress = new Map<string, ProjectionEvidence>()
  for (const evidence of projection.evidence) {
    const address = evidence.target, field = fields.get(fieldKey(address)), key = addressKey(address)
    if (!field) fail('MODULE_PROJECTION_REFERENCE', key)
    if (field!.value.claimClass === 'missing') fail('MODULE_PROJECTION_MISSING_EVIDENCE', key)
    if (evidenceByAddress.has(key)) fail('MODULE_PROJECTION_EVIDENCE_DUPLICATE', `target=${JSON.stringify(address)}`)
    if (address.at !== '' && (!address.at.startsWith('/') || /~(?![01])/u.test(address.at))) fail('MODULE_PROJECTION_POINTER', address.at)
    let value: unknown
    try { value = readJsonPointer({ value: field!.value.value }, `/value${address.at}`) }
    catch { fail('MODULE_PROJECTION_POINTER', key) }
    const inferenceDiagnostic = evidence.kind === 'inference' && !moduleProjectionEvidenceKindDiagnostic(evidence)
      ? moduleInferenceBasisDiagnostic(value, evidence.inputRefs) : undefined
    if (inferenceDiagnostic) fail('MODULE_CLAIM_INFERENCE_BASIS', `target=${JSON.stringify(address)}; ${inferenceDiagnostic}`)
    const claimId = `claim-${sha256CanonicalJson({ moduleId, target: address }).slice(0, 32)}`
    claims.set(key, { claimId, selector: field!.selector + address.at, kind: evidence.kind, value: structuredClone(value),
      ...(evidence.unit === undefined ? {} : { unit: evidence.unit }), ...(evidence.rationale === undefined ? {} : { rationale: evidence.rationale }) })
    evidenceByAddress.set(key, evidence)
    field!.value.claimRefs!.push(claimId); field!.port.claimRefs!.push(claimId)
  }
  return { outputs, fields, claims, evidenceByAddress }
}
function projectionSourceBinder(corpus: MaterialCorpus, outputs:Record<string,CanonicalPort>, itemId:string) {
  const sources = new Map<string, ModuleSourceValue>()
  const sourceId = (description: ProjectionSource, value: unknown, target?: ProjectionFieldAddress): string => {
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) fail('MODULE_PROJECTION_SOURCE_SCALAR',
      `${target ? `target=${JSON.stringify(target)}; ` : ''}valueType=${Array.isArray(value) ? 'array' : typeof value}; source evidence must address a scalar leaf${sourceScalarGuidance(value)}`)
    const document = corpus.documents.find(row => row.path === description.path)
    if (!document) fail('MODULE_PROJECTION_SOURCE_LOCATION', description.path)
    const source = { ...description, contentHash: document!.contentHash, rawValue: value as ModuleSourceValue['rawValue'] }
    if(description.queryMapping){
      if(description.coordinateMapping||description.dateMapping)fail('MODULE_SOURCE_QUERY_MAPPING','Conflicting representation declarations')
      assertNativeQueryStringMappingTarget(itemId,target)
      verifyNativeQueryStringMapping({...source,queryMapping:description.queryMapping},document!)
    }
    if(description.dateMapping){
      if(description.coordinateMapping)fail('MODULE_SOURCE_DATE_MAPPING','Conflicting representation declarations')
      if(description.dateMapping.kind==='source-calendar-date.v1'){
        assertSourceCalendarDateMappingTarget(itemId,target)
        verifySourceCalendarDateMapping({...source,dateMapping:description.dateMapping},document!)
      }else{
        if(itemId!=='1.07')fail('MODULE_SOURCE_DATE_MAPPING','Only explicit original-image photoDate representation is permitted')
        assertPhotoDateMappingTarget(target)
        verifyPhotoDateMapping({...source,dateMapping:description.dateMapping},document!)
      }
    }
    if(description.coordinateMapping){
      if(itemId!=='1.07')fail('MODULE_SOURCE_COORDINATE_MAPPING','only photoLocation in1.07 supports declared original-image GPS axis mapping')
      const expected=verifyPhotoCoordinateMapping({...source,coordinateMapping:description.coordinateMapping},document!)
      const row=target&&outputs[target.port]?.records.find(row=>row.recordId===target.recordId)
      assertPhotoCoordinateMappingTarget(target,(row?.photoLocation as CanonicalField|undefined)?.value,expected)
    }
    const id = `source-${sha256CanonicalJson(source).slice(0, 32)}`
    sources.set(id, { ...source, sourceId: id }); return id
  }
  return { sources, sourceId }
}
/** Describe protocol member presence only, never source prose or business values. */
export function moduleProjectionEvidenceKindDiagnostic(evidence: Pick<ProjectionEvidence, 'kind' | 'source' | 'calculation'>): string | undefined {
  const details: string[] = []
  for (const member of ['source', 'calculation'] as const) {
    const expected = evidence.kind === member, present = evidence[member] !== undefined
    if (expected !== present) details.push(`${member} must be ${expected ? 'present' : 'absent'} for kind=${evidence.kind} (received ${present ? 'present' : 'absent'})`)
  }
  return details.length ? details.join('; ') : undefined
}
function assertProjectionEvidenceKind(key: string, evidence: ProjectionEvidence) {
  const diagnostic = moduleProjectionEvidenceKindDiagnostic(evidence)
  if (diagnostic) fail('MODULE_PROJECTION_EVIDENCE_KIND', `${key}; ${diagnostic}`)
}
/** The same calculation-level requirement as full claim validation; operand
 * explanations are separate authored premises and cannot fill this rationale. */
export function moduleScenarioCalculationRationaleConflicts(raw: unknown) {
  try {
    const projection = raw as Partial<ModuleAuthorProjection>
    if (!Array.isArray(projection?.evidence)) return []
    return projection.evidence.flatMap((entry, evidenceIndex) => entry.kind === 'calculation'
      && entry.calculation?.basis === 'scenario' && !entry.rationale
      ? [{ evidenceIndex, target: structuredClone(entry.target) }] : [])
  } catch { return [] }
}
/** Original result addresses and types only; never convert formulas into numbers or change their evidence kind. */
export function moduleCalculationResultConflicts(raw: unknown) {
  try {
    const projection = raw as Partial<ModuleAuthorProjection> & { outputsJson?: string }
    const outputs = projection.outputs ?? (typeof projection.outputsJson === 'string' ? parseModuleProjectionOutputsJson(projection.outputsJson) : undefined)
    if (!outputs || !Array.isArray(projection.evidence)) return []
    return projection.evidence.flatMap((entry, evidenceIndex) => {
      if (entry.kind !== 'calculation') return []
      const records = (outputs[entry.target.port] as CanonicalPort | undefined)?.records
      const record = records?.find(row => row.recordId === entry.target.recordId)
      const field = record?.[entry.target.field] as CanonicalField | undefined
      if (!field) return []
      const value = readJsonPointer({ value: field.value }, `/value${entry.target.at}`)
      if (typeof value === 'number' && Number.isFinite(value)) return []
      return [{ evidenceIndex, target: structuredClone(entry.target),
        valueType: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
        rawValueHash: sha256CanonicalJson(value), operation: entry.calculation?.operation }]
    })
  } catch { return [] }
}
/** Original submitted unit declarations, using the unchanged complete-claim rule. */
export function moduleProjectionUnitConflicts(raw:unknown){
  try{
    const projection=raw as Partial<ModuleAuthorProjection>&{outputsJson?:string}
    const outputs=projection.outputs??(typeof projection.outputsJson==='string'?parseModuleProjectionOutputsJson(projection.outputsJson):undefined)
    if(!outputs||!Array.isArray(projection.evidence))return []
    return projection.evidence.flatMap((entry,evidenceIndex)=>{
      const records=(outputs[entry.target.port] as CanonicalPort|undefined)?.records,index=records?.findIndex(r=>r.recordId===entry.target.recordId)??-1
      if(index<0)return []
      const selector=`/outputs/${escape(entry.target.port)}/records/${index}/${escape(entry.target.field)}/value${entry.target.at}`
      const conflict=moduleClaimUnitConflict(outputs,{selector,unit:entry.unit});if(!conflict)return []
      const value=readJsonPointer({outputs},selector)
      return [{evidenceIndex,target:structuredClone(entry.target),...conflict,valueType:value===null?'null':Array.isArray(value)?'array':typeof value,
        rawValueHash:sha256CanonicalJson(value)}]
    }).slice(0,16)
  }catch{return []}
}
/** Only actual submitted fields are checked. Dependencies, arithmetic and whole-module validity remain deferred. */
export function validateModuleProjectionFields(itemId: string, projection: Pick<ModuleAuthorProjection, 'outputs' | 'evidence'>,
  selection: ModuleOutputFieldSelection, corpus: MaterialCorpus, localReferenceProjection?: Pick<ModuleAuthorProjection,'outputs'|'evidence'>): void {
  sha256CanonicalJson(projection); assertMaterialCorpus(corpus)
  const { outputs, fields, claims, evidenceByAddress } = bindProjectionFields(itemId, projection, selection)
  // Record parts have the complete immutable record universe from the first
  // native author. A nonexistent record cannot become a future dependency.
  if(localReferenceProjection)for(const entry of projection.evidence){
    for(const ref of [...(entry.inputRefs??[]),...(entry.calculation?.operands??[]),...(entry.calculation?.weights??[])]){
      if(!('local' in ref))continue
      const port=localReferenceProjection.outputs[ref.local.port] as CanonicalPort|undefined
      if(!port?.records?.some(record=>record.recordId===ref.local.recordId))fail('MODULE_PROJECTION_REFERENCE',`unknown frozen record in local target=${JSON.stringify(ref.local)}`)
    }
  }
  const localErrors = moduleLocalReferenceDiagnostics([localReferenceProjection??{outputs,evidence:projection.evidence}])
  if (localErrors.length) fail('MODULE_PROJECTION_REFERENCE', localErrors.join('; '))
  const validation = validateModuleOutputFields(itemId, outputs, selection)
  if (!validation.valid) fail('MODULE_PROJECTION_OUTPUT_INVALID', validation.errors.join('; '))
  for (const [key, evidence] of evidenceByAddress) assertProjectionEvidenceKind(key, evidence)
  const scenarioRationaleConflicts = moduleScenarioCalculationRationaleConflicts(projection)
  if (scenarioRationaleConflicts.length) fail('MODULE_CALCULATION_SCENARIO_RATIONALE_REQUIRED',
    `targets=${JSON.stringify(scenarioRationaleConflicts)}; each scenario calculation requires its own evidence.rationale explaining the conditional calculation and intended use. Operand rationales do not replace it. The native author must supply supported reasoning or preserve missing data; no host-filled rationale, invented inputs or reclassification to pass.`)
  const unitConflicts=moduleProjectionUnitConflicts(projection)
  if(unitConflicts.length)fail('MODULE_CLAIM_UNIT_MISMATCH',`unitConflicts=${JSON.stringify(unitConflicts)}; declared units must match the selected value container under the unchanged complete-claim rule. Native author must recheck field meaning and source; no automatic unit deletion, conversion or replacement.`)
  const resultTypeConflicts = moduleCalculationResultConflicts(projection)
  if (resultTypeConflicts.length) fail('MODULE_CALCULATION_REQUIRED', `resultTypeConflicts=${JSON.stringify(resultTypeConflicts)}; calculation evidence requires a finite numeric result at its target. A formula string describes a method, not the numeric result of ratio/sum/etc. Recheck the original field meaning and evidence; submit a supported result or an explicitly justified text-method conclusion, without fabricated operands, automatic conversion or reclassification merely to pass.`)
  const { sources, sourceId } = projectionSourceBinder(corpus,outputs,itemId)
  for (const [key, evidence] of evidenceByAddress) {
    if (evidence.source) sourceId(evidence.source, claims.get(key)!.value, evidence.target)
    for (const operand of [...(evidence.calculation?.operands ?? []), ...(evidence.calculation?.weights ?? [])]) {
      if ('source' in operand) sourceId(operand.source, operand.value, evidence.target)
    }
  }
  verifyModuleSourceValues(corpus, [...sources.values()])
  // Field-group validation checks the author's declared class without resolving
  // cross-group operands. Full compilation and replay still verify every operand.
  const coverageClaims = [...claims.entries()].map(([key, claim]) => {
    const calculation = evidenceByAddress.get(key)!.calculation
    return { ...claim, ...(calculation ? { calculation: { basis: calculation.basis } } : {}) }
  })
  for (const { value, selector, port } of fields.values()) {
    assertModuleFieldClaimCoverage({ ...value, claimRefs: value.claimRefs! }, selector.slice(0, -'/value'.length), coverageClaims, port.claimRefs!)
  }
}

/** No values, missing markers, rationale, quotes, computations or professional fields are filled in here. */
export function compileModuleAuthorProjection(itemId: string, raw: unknown, corpus: MaterialCorpus): CompiledModuleCandidate {
  sha256CanonicalJson(raw); assertMaterialCorpus(corpus)
  let semantic = raw
  const version = raw && typeof raw === 'object' ? (raw as { projectionVersion?: unknown }).projectionVersion : undefined
  if (version === MODULE_AUTHOR_PROJECTION_JSON_VERSION) {
    const errors = validateJsonSchemaValue(getModuleAuthorProjectionJsonSchema(itemId), raw)
    if (errors.length) fail('MODULE_PROJECTION_SCHEMA', errors.join('; '))
    const { outputsJson, projectionVersion: _version, ...rest } = raw as ModuleAuthorProjectionJson
    semantic = { ...rest, projectionVersion: MODULE_AUTHOR_PROJECTION_VERSION, outputs: parseModuleProjectionOutputsJson(outputsJson) }
  }
  const errors = validateJsonSchemaValue(getModuleAuthorProjectionSchema(itemId), semantic)
  if (errors.length) fail('MODULE_PROJECTION_SCHEMA', errors.join('; '))
  const projection = semantic as ModuleAuthorProjection, contract = getModuleFieldContracts(itemId), moduleId = contract.moduleId
  const selection = Object.fromEntries(Object.entries(contract.ports).map(([name, port]) => [name, port.fields.map(field => field.name)]))
  const { outputs, claims, evidenceByAddress } = bindProjectionFields(itemId, projection, selection)
  const { sources, sourceId } = projectionSourceBinder(corpus,outputs,itemId)
  const local = (address: ProjectionFieldAddress) => {
    const claim = claims.get(addressKey(address)); if (!claim) fail('MODULE_PROJECTION_REFERENCE', addressKey(address))
    return claim!
  }
  const reference = (ref: ProjectionReference) => {
    if ('local' in ref) return { moduleId, claimId: local(ref.local).claimId }
    if (ref.upstream.moduleId === moduleId) fail('MODULE_PROJECTION_REFERENCE', 'current module requires an explicit local address')
    return structuredClone(ref.upstream)
  }
  const operand = (ref: ProjectionOperand): NonNullable<ModuleClaim['calculation']>['operands'][number] => {
    if('scenarioAssumption' in ref)return structuredClone(ref)
    if ('source' in ref) return { sourceId: sourceId(ref.source, ref.value) }
    if ('sourceId' in ref) return { sourceId: ref.sourceId }
    return reference(ref)
  }
  for (const [key, evidence] of evidenceByAddress) {
    const claim = claims.get(key)!
    assertProjectionEvidenceKind(key, evidence)
    if (evidence.source) claim.sourceId = sourceId(evidence.source, claim.value, evidence.target)
    if (evidence.inputRefs) claim.inputRefs = evidence.inputRefs.map(reference)
    if (evidence.calculation) claim.calculation = { operation: evidence.calculation.operation, operands: evidence.calculation.operands.map(operand),
      ...(evidence.calculation.basis === undefined ? {} : { basis: evidence.calculation.basis }),
      ...(evidence.calculation.weights === undefined ? {} : { weights: evidence.calculation.weights.map(operand) }) }
  }
  const validation = validateModuleOutputs(itemId, outputs)
  if (!validation.valid) fail('MODULE_PROJECTION_OUTPUT_INVALID', validation.errors.join('; '))
  const sourceValues = verifyModuleSourceValues(corpus, [...sources.values()])
  const steps = projection.steps.map(({ fieldRefs, ...step }) => ({ ...structuredClone(step), claimRefs: fieldRefs.map(address => local(address).claimId) }))
  return { outputs, claims: [...claims.values()], sourceValues, limitations: [...projection.limitations], steps }
}

function receiptBinding(receipt: ModuleAuthorReceipt, projectionHash: string, compiledCandidateHash: string, outputsJsonHash?: string): string {
  if (!receipt.executionId?.trim() || !receipt.childId?.trim() || !receipt.actualModel?.provider?.trim() || !receipt.actualModel?.model?.trim() || receipt.stopReason !== 'completed') fail('MODULE_PROJECTION_RECEIPT')
  return sha256CanonicalJson({ executionId: receipt.executionId, childId: receipt.childId, actualModel: receipt.actualModel, stopReason: receipt.stopReason, projectionHash, compiledCandidateHash,
    ...(outputsJsonHash === undefined ? {} : { outputsJsonHash }) })
}
export function createModuleProjectionAudit(raw: ModuleAuthorProjectionJson, candidate: CompiledModuleCandidate, receipt: ModuleAuthorReceipt): ModuleProjectionJsonAudit
export function createModuleProjectionAudit(raw: ModuleAuthorProjection, candidate: CompiledModuleCandidate, receipt: ModuleAuthorReceipt): ModuleProjectionV1Audit
export function createModuleProjectionAudit(raw: ModuleAuthorSubmission, candidate: CompiledModuleCandidate, receipt: ModuleAuthorReceipt): ModuleProjectionAudit {
  const projectionHash = sha256CanonicalJson(raw), compiledCandidateHash = sha256CanonicalJson(candidate)
  if (raw.projectionVersion === MODULE_AUTHOR_PROJECTION_JSON_VERSION) {
    const outputsJsonHash = hashModuleProjectionJsonText(raw.outputsJson)
    return { version: MODULE_AUTHOR_PROJECTION_JSON_VERSION, raw: structuredClone(raw), projectionHash, compiledCandidateHash, outputsJsonHash,
      receiptBindingHash: receiptBinding(receipt, projectionHash, compiledCandidateHash, outputsJsonHash) }
  }
  if (raw.projectionVersion !== MODULE_AUTHOR_PROJECTION_VERSION) fail('MODULE_PROJECTION_VERSION')
  return { version: MODULE_AUTHOR_PROJECTION_VERSION, raw: structuredClone(raw), projectionHash, compiledCandidateHash,
    receiptBindingHash: receiptBinding(receipt, projectionHash, compiledCandidateHash) }
}
export function replayModuleAuthorProjection(itemId: string, corpus: MaterialCorpus, audit: ModuleProjectionAudit, receipt: ModuleAuthorReceipt): CompiledModuleCandidate {
  if (!audit || ![MODULE_AUTHOR_PROJECTION_VERSION, MODULE_AUTHOR_PROJECTION_JSON_VERSION].includes(audit.version)
    || audit.version !== audit.raw?.projectionVersion || audit.projectionHash !== sha256CanonicalJson(audit.raw)) fail('MODULE_PROJECTION_HASH')
  if (audit.version === MODULE_AUTHOR_PROJECTION_JSON_VERSION) {
    if (typeof audit.raw.outputsJson !== 'string' || audit.outputsJsonHash !== hashModuleProjectionJsonText(audit.raw.outputsJson)) fail('MODULE_PROJECTION_TEXT_HASH')
  } else if (audit.outputsJsonHash !== undefined) fail('MODULE_PROJECTION_VERSION')
  if (audit.receiptBindingHash !== receiptBinding(receipt, audit.projectionHash, audit.compiledCandidateHash, audit.outputsJsonHash)) fail('MODULE_PROJECTION_RECEIPT')
  const compiled = compileModuleAuthorProjection(itemId, audit.raw, corpus)
  if (sha256CanonicalJson(compiled) !== audit.compiledCandidateHash) fail('MODULE_PROJECTION_COMPILED_HASH')
  return compiled
}
