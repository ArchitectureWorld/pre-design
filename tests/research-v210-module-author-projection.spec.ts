import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { assertObjectJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { getModuleFieldContracts, validateModuleOutputs } from '../src/research-v2/module-contracts.ts'
import { getResearchModuleSpec } from '../src/research-v2/specification.ts'
import { loadPlanningCatalog } from '../src/research-v2/catalog.ts'
import { assertModuleFieldClaimCoverage, validateModuleClaims } from '../src/research-v2/module-claims.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'

const url = new URL('../src/research-v2/module-author-projection.ts', import.meta.url)
async function api() { expect(existsSync(url), 'explicit author projection is implemented').toBe(true); return import(url.href) }
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const original = '正式名称：甲水库。别名：甲湖、甲库。组织：水务局。承担：勘测院。面积 12.5 平方米，新增 2.5 平方米。'
const document = { path: '原始资料/report.pdf', contentHash: hash(original), byteLength: 321, pages: [{ page: 1, text: original }] }
const baseCorpus = { documents: [document], limitations: ['历史来源'] }
const corpus = { ...baseCorpus, fingerprint: hash(JSON.stringify(baseCorpus)) }
const source = (valueQuote?: string) => ({ path: document.path, page: 1, quote: original, ...(valueQuote ? { valueQuote } : {}) })
const target = (field: string, at = '', port = 'project_brief') => ({ port, recordId: 'row-1', field, at })
function projection(itemId = '1.01'): any {
  const outputs = Object.fromEntries(Object.entries(getModuleFieldContracts(itemId).ports).map(([name, port]) => [name, {
    type: port.type, quality: 'limited', records: [{ recordId: 'row-1', resultClass: 'observation_summary',
      ...Object.fromEntries(port.fields.map(field => [field.name, { value: null, claimClass: 'missing', limitations: ['原件未提供'] }])) }],
    limitations: ['历史资料'], scope: '原件核对', asOf: '2026-09-27',
  }]))
  return { projectionVersion: 'module-author-projection.v1', outputs, evidence: [], limitations: ['历史资料'],
    steps: [1, 2, 3, 4].map(step => ({ step, status: 'limited', summary: '依据本次原文核对，未核实当前状态。', fieldRefs: [], limitations: ['资料有限'] })) }
}
function namedProjection() {
  const value = projection(), row = value.outputs.project_brief.records[0]
  row.formalName = { value: '甲水库', claimClass: 'source_conclusion', limitations: ['历史名称'] }
  row.aliases = { value: ['甲湖', '甲库'], claimClass: 'source_conclusion', limitations: ['仅原件异名'] }
  value.evidence = [
    { target: target('formalName'), kind: 'source', source: source() },
    { target: target('aliases', '/0'), kind: 'source', source: source() },
    { target: target('aliases', '/1'), kind: 'source', source: source() },
  ]
  value.steps.forEach((s: any) => { s.fieldRefs = [target('formalName')] })
  return value
}
function verify(itemId: string, candidate: any, upstream: any[] = []) {
  return validateModuleClaims({ ...candidate, moduleId: getResearchModuleSpec(itemId).moduleId, upstream })
}
const jsonVersion = 'module-author-projection-json.v2'
function jsonProjection(raw = namedProjection()) {
  const { outputs, projectionVersion: _version, ...rest } = raw
  return { projectionVersion: jsonVersion, outputsJson: JSON.stringify(outputs), ...rest }
}

describe('native member contracts', () => {
  it.each([
    { field: 'businessRights', value: 'null' },
    { field: 'operatingPeriod', value: 'null' },
    { field: 'subsidyCertainty', value: 'null' },
    { field: 'sustainabilityConditions', value: [] },
  ])('rejects missing $field with a non-null value at the native tool boundary', async ({ field, value }) => {
    const { getModuleAuthorProjectionSchema, bindNativeModuleEvidenceSchema, compileModuleAuthorProjection } = await api()
    const raw = projection('7.02')
    raw.outputs.business_model.records[0][field].value = value
    const before = structuredClone(raw)
    expect(() => compileModuleAuthorProjection('7.02', raw, corpus)).toThrow('MISSING_REQUIRES_JSON_NULL')
    const schema = bindNativeModuleEvidenceSchema(getModuleAuthorProjectionSchema('7.02'))
    expect(validateJsonSchemaValue(schema, raw).length).toBeGreaterThan(0)
    expect(raw).toEqual(before)
  })

  it.each([
    { kind: 'proposal', omitted: 'rationale' },
    { kind: 'assumption', omitted: 'rationale' },
    { kind: 'inference', omitted: 'rationale' },
    { kind: 'inference', omitted: 'inputRefs' },
  ])('requires $omitted for $kind before the native tool records success', async ({ kind, omitted }) => {
    const { getModuleAuthorProjectionSchema, bindNativeModuleEvidenceSchema } = await api()
    const schema = bindNativeModuleEvidenceSchema(getModuleAuthorProjectionSchema('1.01')), raw = namedProjection()
    const evidence: any = { target: target('formalName'), kind, rationale: '本次研究选择或有依据的推断。', inputRefs: [{ local: target('aliases', '/0') }] }
    raw.evidence[0] = evidence
    expect(validateJsonSchemaValue(schema, raw)).toEqual([])
    delete evidence[omitted]
    const before = structuredClone(raw)
    expect(validateJsonSchemaValue(schema, raw).length).toBeGreaterThan(0)
    expect(raw).toEqual(before)
  })

  it('preserves missing/null, decision/null with a reason, original value types and the unbound schema', async () => {
    const { getModuleAuthorProjectionSchema, bindNativeModuleEvidenceSchema } = await api()
    for (const mod of loadPlanningCatalog().modules) {
      const original = getModuleAuthorProjectionSchema(mod.id), before = structuredClone(original)
      const schema = bindNativeModuleEvidenceSchema(original)
      assertObjectJsonSchema(schema)
      expect(validateJsonSchemaValue(schema, projection(mod.id)), mod.id).toEqual([])
      expect(original).toEqual(before)
    }
    const schema = bindNativeModuleEvidenceSchema(getModuleAuthorProjectionSchema('1.01')), raw = namedProjection()
    raw.outputs.project_brief.records[0].formalName = { value: null, claimClass: 'decision', limitations: ['本次选择不另定名称'], notApplicableReason: '沿用已有名称，独立命名不适用。' }
    raw.evidence[0] = { target: target('formalName'), kind: 'proposal', rationale: '本次选择沿用已有名称，未作正式命名。' }
    expect(validateJsonSchemaValue(schema, raw)).toEqual([])
    raw.outputs.project_brief.records[0].formalName.value = { invented: true }
    expect(validateJsonSchemaValue(schema, raw).length).toBeGreaterThan(0)
    expect(validateJsonSchemaValue(schema, namedProjection())).toEqual([])
  })
})

it('explains working identifier selection across the catalog and still rejects a source name used as a facility ID', async () => {
  const { getModuleAuthorProjectionSchema, compileModuleAuthorProjection } = await api()
  for (const mod of loadPlanningCatalog().modules) {
    const contracts = getModuleFieldContracts(mod.id), schema = getModuleAuthorProjectionSchema(mod.id)
    for (const [portName, port] of Object.entries(contracts.ports)) {
      for (const field of port.fields.filter(field => field.kind === 'id' || field.kind === 'ids')) {
        const envelope = schema.properties!.outputs.properties![portName].properties!.records.items!.properties![field.name]
        expect(envelope.description, `${mod.id}/${portName}/${field.name}`).toContain('机器关联标识，不是名称或中文定位')
        expect(envelope.description).toContain('临时研究编号选择用decision+proposal')
      }
    }
  }
  const raw = projection('1.08'), row = raw.outputs.technical_baseline.records[0]
  row.facilityId = { value: '少潭河水库', claimClass: 'source_conclusion', limitations: ['历史方案的编制对象名称。'] }
  raw.evidence = [{ target: target('facilityId', '', 'technical_baseline'), kind: 'source', source: source() }]
  const before = structuredClone(raw)
  expect(() => compileModuleAuthorProjection('1.08', raw, corpus)).toThrow('MODULE_PROJECTION_OUTPUT_INVALID')
  expect(raw).toEqual(before)
})

describe('explicit v2 JSON text transport', () => {
  it.each([
    { kind: 'proposal', source: source(), expected: 'source must be absent for kind=proposal (received present)' },
    { kind: 'inference', calculation: { operation: 'sum', operands: [] }, expected: 'calculation must be absent for kind=inference (received present)' },
    { kind: 'source', expected: 'source must be present for kind=source (received absent)' },
    { kind: 'calculation', expected: 'calculation must be present for kind=calculation (received absent)' },
  ])('locates an evidence-member mismatch for $kind without repairing the native submission', async ({ expected, ...evidence }) => {
    const { compileModuleAuthorProjection, validateModuleProjectionFields } = await api(), raw = namedProjection()
    raw.evidence = [{ target: target('formalName'), ...evidence }, ...raw.evidence.slice(1)]
    const before = structuredClone(raw)
    for (const verify of [
      () => compileModuleAuthorProjection('1.01', raw, corpus),
      () => validateModuleProjectionFields('1.01', raw, { project_brief: getModuleFieldContracts('1.01').ports.project_brief.fields.map(field => field.name) }, corpus),
    ]) {
      expect(verify).toThrow('MODULE_PROJECTION_EVIDENCE_KIND')
      expect(verify).toThrow('["project_brief","row-1","formalName",""]')
      expect(verify).toThrow(expected)
    }
    expect(raw).toEqual(before)
  })
  it('gives coordinate leaf addresses from the rejected geometry without calling them verified facts', async () => {
    const { compileModuleAuthorProjection } = await api(), raw = projection('1.07')
    raw.outputs.site_use.records[0].geometry = { value: { type: 'Point', coordinates: [12.5, 2.5] }, claimClass: 'source_conclusion', limitations: ['测试坐标'] }
    raw.evidence = [{ target: target('geometry', '', 'site_use'), kind: 'source', source: source() }]
    const before = structuredClone(raw)
    let message = ''
    try { compileModuleAuthorProjection('1.07', raw, corpus) } catch (error) { message = (error as Error).message }
    expect(message).toContain('MODULE_PROJECTION_SOURCE_SCALAR')
    expect(message).toContain('"at":"/coordinates/0"')
    expect(message).toContain('"at":"/coordinates/1"')
    expect(message).toContain('unverified rejected value')
    expect(message).not.toContain('12.5'); expect(message).not.toContain('2.5')
    expect(raw).toEqual(before)
  })
  it('identifies the exact non-scalar source target without repairing its value or evidence', async () => {
    const { compileModuleAuthorProjection, validateModuleProjectionFields } = await api(), raw = namedProjection()
    raw.evidence = [raw.evidence[0], { target: target('aliases'), kind: 'source', source: source() }]
    const before = structuredClone(raw)
    const detail = `MODULE_PROJECTION_SOURCE_SCALAR: target=${JSON.stringify(target('aliases'))}; valueType=array; source evidence must address a scalar leaf`
    expect(() => compileModuleAuthorProjection('1.01', raw, corpus)).toThrow(detail)
    expect(() => compileModuleAuthorProjection('1.01', raw, corpus)).toThrow('sourceLeafPaths')
    const fields = getModuleFieldContracts('1.01').ports.project_brief.fields.map(field => field.name)
    expect(() => validateModuleProjectionFields('1.01', raw, { project_brief: fields }, corpus)).toThrow(detail)
    expect(raw).toEqual(before)
  })
  it('locates malformed author JSON with bounded exact context without repairing the submission', async () => {
    const { parseModuleProjectionOutputsJson } = await api()
    const text = '{\n"prefix":' + JSON.stringify('x'.repeat(1500)) + ',\n"marker": true "next": 2\n}'
    let error = ''
    try { parseModuleProjectionOutputsJson(text) } catch (value) { error = String(value) }
    expect(error).toContain('MODULE_PROJECTION_JSON_SYNTAX')
    expect(error).toContain('line 3')
    expect(error).toContain('column')
    expect(error).toContain('marker')
    expect(error).toContain('context=')
    expect(error.length).toBeLessThan(1000)
    expect(() => parseModuleProjectionOutputsJson(text)).toThrow('MODULE_PROJECTION_JSON_SYNTAX')
  })
  it('reports rejected source values with locations and all bounded errors instead of opaque generated IDs alone', async () => {
    const { verifyModuleSourceValues } = await import('../src/research-v2/module-claims.ts')
    const candidates = ['不存在的日期原文', '不存在的发布单位'].map((rawValue, index) => ({ sourceId: `opaque-${index}`,
      path: document.path, contentHash: document.contentHash, page: 1, quote: rawValue, rawValue }))
    let failure = ''
    try { verifyModuleSourceValues(corpus, candidates) } catch (error) { failure = String(error) }
    expect(failure).toContain('MODULE_SOURCE_VALUE_QUOTE')
    expect(failure).toContain('opaque-0'); expect(failure).toContain('opaque-1')
    expect(failure).toContain(document.path)
    expect(failure).toContain('不存在的日期原文'); expect(failure).toContain('不存在的发布单位')
    expect(failure).toContain('"page":1')
    const many = Array.from({ length: 20 }, (_, index) => ({ ...candidates[0], sourceId: `bounded-${index}` }))
    expect(() => verifyModuleSourceValues(corpus, many)).toThrow('另有来源尚未核验')
  })
  it('compiles the same professional values, evidence and steps as v1 without altering the native submission', async () => {
    const { compileModuleAuthorProjection, getModuleAuthorProjectionJsonSchema } = await api()
    const v1 = namedProjection(), v2 = jsonProjection(v1), before = JSON.stringify(v2)
    expect(compileModuleAuthorProjection('1.01', v2, corpus)).toEqual(compileModuleAuthorProjection('1.01', v1, corpus))
    expect(JSON.stringify(v2)).toBe(before)
    for (const mod of loadPlanningCatalog().modules) {
      const schema = getModuleAuthorProjectionJsonSchema(mod.id)
      expect(() => assertObjectJsonSchema(schema)).not.toThrow()
      expect(schema.additionalProperties).toBe(false)
      expect(schema.properties.outputsJson).toEqual({ type: 'string' })
      expect(schema.properties.outputs).toBeUndefined()
      expect(schema.properties.projectionVersion.const).toBe(jsonVersion)
    }
  })
  it.each([
    ['duplicate keys', '{"x":1,"x":2}'],
    ['escaped duplicate keys', '{"x":{"a":1,"\\u0061":2}}'],
    ['array nested duplicate keys', '{"x":[{"a":1,"a":2}]}'],
    ['array root', '[]'], ['null root', 'null'], ['scalar root', '42'],
    ['double encoding', '"{\\"x\\":1}"'], ['code fence', '```json\n{}\n```'],
    ['non-finite number', '{"x":1e999}'], ['negative infinity', '{"x":-1e999}'],
    ['trailing text', '{} trailing'], ['trailing comma', '{"x":1,}'], ['comment', '{/*x*/}'],
  ])('rejects %s before semantic compilation without repairing text', async (_name, outputsJson) => {
    const { compileModuleAuthorProjection } = await api()
    expect(() => compileModuleAuthorProjection('1.01', { ...jsonProjection(), outputsJson }, corpus)).toThrow(/MODULE_PROJECTION_JSON_/)
  })
  it('keeps explicit missing fields, source validation, local references and central arithmetic checks mandatory after decoding', async () => {
    const { compileModuleAuthorProjection } = await api()
    const missing = namedProjection(); delete missing.outputs.project_brief.records[0].principal
    expect(() => compileModuleAuthorProjection('1.01', jsonProjection(missing), corpus)).toThrow(/MODULE_PROJECTION_SCHEMA/)
    const unsupported = namedProjection(); unsupported.outputs.project_brief.records[0].formalName.value = '旅游局'
    expect(() => compileModuleAuthorProjection('1.01', jsonProjection(unsupported), corpus)).toThrow(/MODULE_SOURCE_VALUE_TEXT/)
    const wrong = projection('1.02')
    wrong.outputs.boundaries.records[0].area = { value: { value: 16, unit: '平方米', basis: '原文复算' }, claimClass: 'agent_inference', limitations: ['未实测'] }
    wrong.evidence = [{ target: target('area', '/value', 'boundaries'), kind: 'calculation', unit: '平方米',
      calculation: { operation: 'sum', operands: [{ source: source('12.5'), value: 12.5 }, { source: source('2.5'), value: 2.5 }] } }]
    const compiled = compileModuleAuthorProjection('1.02', jsonProjection(wrong), corpus)
    expect(compiled.claims[0].value).toBe(16)
    expect(() => verify('1.02', compiled)).toThrow(/MODULE_CALCULATION_MISMATCH/)
    const reference = namedProjection(); reference.steps[0].fieldRefs = [target('principal')]
    expect(() => compileModuleAuthorProjection('1.01', jsonProjection(reference), corpus)).toThrow(/MODULE_PROJECTION_REFERENCE/)
  })
  it('rejects old stringified v1 payloads, wrapper shapes and mixed versions without migration', async () => {
    const { compileModuleAuthorProjection } = await api(), v1 = namedProjection(), v2 = jsonProjection(v1)
    for (const raw of [
      { ...v1, outputs: v2.outputsJson }, { ...v2, projectionVersion: v1.projectionVersion },
      { ...v1, projectionVersion: jsonVersion }, { ...v2, outputs: v1.outputs },
      { value: JSON.stringify(v2) }, { ...v2, projectionVersion: 'unknown' },
    ]) expect(() => compileModuleAuthorProjection('1.01', raw, corpus)).toThrow(/MODULE_PROJECTION_(SCHEMA|VERSION)/)
  })
  it('hashes exact UTF-8 text, binds it to the receipt and preserves v1 replay', async () => {
    const { compileModuleAuthorProjection, createModuleProjectionAudit, replayModuleAuthorProjection } = await api()
    const v1 = namedProjection(); v1.outputs.project_brief.scope = 'cafe\u0301'
    const raw = jsonProjection(v1), candidate = compileModuleAuthorProjection('1.01', raw, corpus)
    const receipt = { executionId: 'execution-2', childId: 'child-2', actualModel: { provider: 'test', model: 'author' }, stopReason: 'completed' }
    const audit = createModuleProjectionAudit(raw, candidate, receipt)
    expect(audit.version).toBe(jsonVersion)
    expect(audit.raw).toEqual(raw)
    expect(audit.outputsJsonHash).toBe(hash(raw.outputsJson))
    expect(audit.projectionHash).toBe(sha256CanonicalJson(raw))
    expect(replayModuleAuthorProjection('1.01', corpus, audit, receipt)).toEqual(candidate)
    const changed = structuredClone(audit); changed.raw.outputsJson = raw.outputsJson.normalize('NFC')
    expect(sha256CanonicalJson(changed.raw)).toBe(audit.projectionHash)
    expect(() => replayModuleAuthorProjection('1.01', corpus, changed, receipt)).toThrow(/MODULE_PROJECTION_TEXT_HASH/)
    changed.outputsJsonHash = hash(changed.raw.outputsJson)
    expect(() => replayModuleAuthorProjection('1.01', corpus, changed, receipt)).toThrow(/MODULE_PROJECTION_RECEIPT/)
    for (const mutate of [
      (a: any) => { a.version = 'module-author-projection.v1' },
      (a: any) => { a.raw.projectionVersion = 'module-author-projection.v1' },
      (a: any) => { delete a.outputsJsonHash },
    ]) { const bad = structuredClone(audit); mutate(bad); expect(() => replayModuleAuthorProjection('1.01', corpus, bad, receipt)).toThrow(/MODULE_PROJECTION/) }
    const legacy = createModuleProjectionAudit(v1, candidate, receipt)
    expect(legacy).not.toHaveProperty('outputsJsonHash')
    expect(replayModuleAuthorProjection('1.01', corpus, legacy, receipt)).toEqual(candidate)
  })
})

describe('single-call author projection and deterministic canonical compilation', () => {
  it.each(['source', 'proposal'] as const)('reports the conflicting exact target for a second %s evidence without dropping or merging it', async kind => {
    const { compileModuleAuthorProjection } = await api(), raw = namedProjection(), address = target('formalName')
    raw.evidence.push({ target: address, kind, ...(kind === 'source' ? { source: { ...source(), quote: '甲水库' } }
      : { rationale: '本轮选择采用该名称作为研究对象。' }) })
    const before = JSON.stringify(raw)
    expect(() => compileModuleAuthorProjection('1.01', raw, corpus)).toThrow(`MODULE_PROJECTION_EVIDENCE_DUPLICATE: target=${JSON.stringify(address)}`)
    expect(JSON.stringify(raw)).toBe(before)
  })
  it.each(['fact', 'user_statement'])('does not advertise author class %s when no executable evidence kind supports it', async claimClass => {
    const { compileModuleAuthorProjection, getModuleAuthorProjectionSchema } = await api(), raw = namedProjection()
    const prefix = '/outputs/project_brief/records/0/formalName'
    for (const kind of ['source', 'calculation', 'assumption', 'proposal', 'inference', 'missing'] as const) {
      expect(() => assertModuleFieldClaimCoverage({ value: '甲水库', claimClass, claimRefs: ['claim'] }, prefix,
        [{ claimId: 'claim', selector: `${prefix}/value`, kind, value: '甲水库' }], ['claim'])).toThrow(/MODULE_CLAIM_(FACT_REQUIRES_INDEPENDENT_VERIFICATION|CLASS_MISMATCH)/)
    }
    // General contracts retain these classes for other paths; only the author wire is narrowed.
    const central = compileModuleAuthorProjection('1.01', raw, corpus)
    central.outputs.project_brief.records[0].formalName.claimClass = claimClass
    expect(validateModuleOutputs('1.01', central.outputs).valid).toBe(true)
    raw.outputs.project_brief.records[0].formalName.claimClass = claimClass
    const before = JSON.stringify(raw)
    expect(validateJsonSchemaValue(getModuleAuthorProjectionSchema('1.01'), raw).length).toBeGreaterThan(0)
    expect(() => compileModuleAuthorProjection('1.01', raw, corpus)).toThrow('MODULE_PROJECTION_SCHEMA')
    expect(JSON.stringify(raw)).toBe(before)
  })
  it('compiles explicit scalar and array leaf bindings without repeating values, IDs or canonical selectors in the author output', async () => {
    const { compileModuleAuthorProjection } = await api(), raw = namedProjection(), before = JSON.stringify(raw)
    const value = compileModuleAuthorProjection('1.01', raw, corpus)
    expect(value.outputs.project_brief.records[0].projectId).toEqual({ value: null, claimClass: 'missing', limitations: ['原件未提供'], claimRefs: [] })
    expect(value.claims.map((c: any) => [c.selector, c.value]).sort()).toEqual([
      ['/outputs/project_brief/records/0/aliases/value/0', '甲湖'], ['/outputs/project_brief/records/0/aliases/value/1', '甲库'],
      ['/outputs/project_brief/records/0/formalName/value', '甲水库'],
    ])
    expect(value.sourceValues.map((s: any) => s.rawValue).sort()).toEqual(['甲库', '甲水库', '甲湖'].sort())
    expect(value.sourceValues.every((s: any) => s.contentHash === document.contentHash)).toBe(true)
    expect(new Set(value.claims.map((c: any) => c.claimId)).size).toBe(3)
    expect(verify('1.01', value).claims).toHaveLength(3)
    expect(JSON.stringify(raw)).toBe(before)
    expect(compileModuleAuthorProjection('1.01', structuredClone(raw), corpus)).toEqual(value)
  })
  it('rejects missing-field bindings, whole-array source binding, and a source quote that does not support the explicit field value', async () => {
    const { compileModuleAuthorProjection } = await api()
    const missing = namedProjection(); missing.evidence.push({ target: target('projectId'), kind: 'source', source: source() })
    expect(() => compileModuleAuthorProjection('1.01', missing, corpus)).toThrow(/PROJECTION_MISSING_EVIDENCE/)
    const array = namedProjection(); array.evidence = [array.evidence[0], { target: target('aliases'), kind: 'source', source: source() }]
    expect(() => compileModuleAuthorProjection('1.01', array, corpus)).toThrow(/PROJECTION_SOURCE_SCALAR/)
    const unsupported = namedProjection(); unsupported.outputs.project_brief.records[0].formalName.value = '甲水库、旅游局'
    expect(() => compileModuleAuthorProjection('1.01', unsupported, corpus)).toThrow(/MODULE_SOURCE_VALUE_TEXT/)
  })
  it('rejects author-supplied duplicate claim values, forged addresses, absent fields and legacy failed shapes instead of repairing them', async () => {
    const { compileModuleAuthorProjection } = await api()
    for (const mutate of [
      (p: any) => { p.evidence[0].value = '作者另写的矛盾值' },
      (p: any) => { p.evidence[0].target.at = '/unknown' },
      (p: any) => { p.evidence[0].target.recordId = 'other-row' },
      (p: any) => { delete p.outputs.project_brief.records[0].principal },
      (p: any) => { p.outputs.claims = [] },
      (p: any) => { p.steps[0].fieldRefs = [target('unknown')] },
    ]) { const value = namedProjection(); mutate(value); expect(() => compileModuleAuthorProjection('1.01', value, corpus)).toThrow() }
    expect(() => compileModuleAuthorProjection('1.01', { outputs: namedProjection().outputs, steps: [] }, corpus)).toThrow(/PROJECTION_SCHEMA/)
  })
  it('supports source-only numeric operands without inventing extra output fields and leaves wrong arithmetic for central rejection', async () => {
    const { compileModuleAuthorProjection } = await api(), raw = projection('1.02')
    raw.outputs.boundaries.records[0].area = { value: { value: 15, unit: '平方米', basis: '原始值相加' }, claimClass: 'agent_inference', limitations: ['仅原文复算'] }
    raw.evidence = [{ target: target('area', '/value', 'boundaries'), kind: 'calculation', unit: '平方米',
      calculation: { operation: 'sum', operands: [{ source: source('12.5'), value: 12.5 }, { source: source('2.5'), value: 2.5 }] } }]
    const value = compileModuleAuthorProjection('1.02', raw, corpus)
    expect(value.sourceValues.map((s: any) => s.rawValue).sort((a: number, b: number) => a - b)).toEqual([2.5, 12.5])
    expect(verify('1.02', value).claims[0].value).toBe(15)
    raw.outputs.boundaries.records[0].area.value.value = 16
    const wrong = compileModuleAuthorProjection('1.02', raw, corpus)
    expect(wrong.claims[0].value).toBe(16)
    expect(() => verify('1.02', wrong)).toThrow(/MODULE_CALCULATION_MISMATCH/)
    raw.evidence[0].calculation.operands[0].value = 99
    expect(() => compileModuleAuthorProjection('1.02', raw, corpus)).toThrow(/MODULE_SOURCE_VALUE_NUMBER/)
  })
  it('resolves local references exactly and preserves explicit upstream references for central verification', async () => {
    const { compileModuleAuthorProjection } = await api(), raw = namedProjection()
    raw.outputs.project_brief.records[0].commissionScope = { value: '仅开展名称核验研究。', claimClass: 'agent_inference', limitations: ['不作为批准'] }
    raw.evidence.push({ target: target('commissionScope'), kind: 'inference', rationale: '根据已提供名称限定研究。',
      inputRefs: [{ local: target('formalName') }, { upstream: { moduleId: 'other-module', claimId: 'known-claim' } }] })
    const candidate = compileModuleAuthorProjection('1.01', raw, corpus), local = candidate.claims.find((c: any) => c.value === '甲水库')
    const claim = candidate.claims.find((c: any) => c.kind === 'inference')
    expect(claim.inputRefs).toEqual([{ moduleId: getResearchModuleSpec('1.01').moduleId, claimId: local.claimId }, { moduleId: 'other-module', claimId: 'known-claim' }])
    expect(() => verify('1.01', candidate)).toThrow(/MODULE_CLAIM_UPSTREAM_MISSING/)
    raw.evidence[3].inputRefs = [{ local: target('principal') }]
    expect(() => compileModuleAuthorProjection('1.01', raw, corpus)).toThrow(/PROJECTION_REFERENCE/)
  })
  it('retains local calculation dependency semantics and refuses circular or missing operands', async () => {
    const { compileModuleAuthorProjection } = await api(), raw = projection('1.04')
    const row = raw.outputs.asset_rights.records[0]
    row.registeredArea = { value: { value: 12.5, unit: '平方米', basis: '原文' }, claimClass: 'source_conclusion', limitations: ['历史值'] }
    row.measuredArea = { value: { value: 15, unit: '平方米', basis: '演示原文值复算，非现场测量' }, claimClass: 'agent_inference', limitations: ['未实测'] }
    const registered = target('registeredArea', '/value', 'asset_rights'), measured = target('measuredArea', '/value', 'asset_rights')
    raw.evidence = [
      { target: measured, kind: 'calculation', calculation: { operation: 'sum', operands: [{ local: registered }, { source: source('2.5'), value: 2.5 }] } },
      { target: registered, kind: 'source', source: source('12.5') },
    ]
    expect(verify('1.04', compileModuleAuthorProjection('1.04', raw, corpus)).claims.find((c: any) => c.kind === 'calculation')!.value).toBe(15)
    raw.evidence[0].calculation.operands[0] = { local: measured }
    expect(() => verify('1.04', compileModuleAuthorProjection('1.04', raw, corpus))).toThrow(/MODULE_CLAIM_CYCLE/)
    raw.evidence[0].calculation.operands[0] = { sourceId: 'unprovided-source' }
    expect(() => verify('1.04', compileModuleAuthorProjection('1.04', raw, corpus))).toThrow(/MODULE_CALCULATION_SOURCE_MISSING/)
  })
  it('preserves explicit scenario arithmetic through field validation, author transport and central replay', async () => {
    const { compileModuleAuthorProjection, validateModuleProjectionFields } = await api(), raw = projection('1.04')
    const row = raw.outputs.asset_rights.records[0]
    row.registeredArea = { value: { value: 12.5, unit: '平方米', basis: '边界方案测试假设，非登记实测值' }, claimClass: 'assumption', limitations: ['仅为假设'] }
    row.measuredArea = { value: { value: 15, unit: '平方米', basis: '条件方案面积之和，非测量值' }, claimClass: 'assumption', limitations: ['仅为条件计算'] }
    const registered = target('registeredArea', '/value', 'asset_rights'), measured = target('measuredArea', '/value', 'asset_rights')
    raw.evidence = [
      { target: registered, kind: 'assumption', rationale: '仅检验12.5平方米设计边界的面积情景，不作为已登记的事实。' },
      { target: measured, kind: 'calculation', rationale: '面积情景加上原文新增面积，继承假设的适用限制。',
        calculation: { basis: 'scenario', operation: 'sum', operands: [{ local: registered }, { source: source('2.5'), value: 2.5 }] } },
    ]
    const selection = Object.fromEntries(Object.entries(getModuleFieldContracts('1.04').ports).map(([name, port]) => [name, port.fields.map(f => f.name)]))
    expect(() => validateModuleProjectionFields('1.04', raw, selection, corpus)).not.toThrow()
    const before = JSON.stringify(raw), candidate = compileModuleAuthorProjection('1.04', raw, corpus)
    expect(verify('1.04', candidate).claims.find((c: any) => c.kind === 'calculation')!.calculation!.basis).toBe('scenario')
    expect(JSON.stringify(raw)).toBe(before)
    row.measuredArea.claimClass = 'source_conclusion'
    expect(() => validateModuleProjectionFields('1.04', raw, selection, corpus)).toThrow('MODULE_CLAIM_CLASS_MISMATCH')
  })
  it('keeps all 62 wire schemas typed and closed without embedding the evidence union in each field', async () => {
    const { getModuleAuthorProjectionSchema } = await api()
    for (const mod of loadPlanningCatalog().modules) {
      const schema = getModuleAuthorProjectionSchema(mod.id); expect(() => assertObjectJsonSchema(schema)).not.toThrow()
      for (const [name, port] of Object.entries(getModuleFieldContracts(mod.id).ports)) for (const field of port.fields) {
        const envelope = schema.properties.outputs.properties[name].properties.records.items.properties[field.name]
        expect(envelope.properties.evidence).toBeUndefined()
        expect(envelope.properties.claimRefs).toBeUndefined()
        expect(validateJsonSchemaValue(envelope.properties.value, { unexpected: 42 }).length).toBeGreaterThan(0)
      }
    }
    // Two operand/weight declarations carry the approved standalone shape;
    // actual model request windows and output reserves stay unchanged.
    expect(JSON.stringify(getModuleAuthorProjectionSchema('1.01')).length).toBeLessThan(13_000)
  })
  it('binds archived projection, compiled candidate and actual author receipt and detects independent tampering', async () => {
    const { compileModuleAuthorProjection, createModuleProjectionAudit, replayModuleAuthorProjection } = await api()
    const raw = namedProjection(), candidate = compileModuleAuthorProjection('1.01', raw, corpus)
    const receipt = { executionId: 'execution-1', childId: 'child-1', actualModel: { provider: 'test', model: 'author' }, stopReason: 'completed' }
    const audit = createModuleProjectionAudit(raw, candidate, receipt)
    expect(replayModuleAuthorProjection('1.01', corpus, audit, receipt)).toEqual(candidate)
    expect(audit.projectionHash).toBe(sha256CanonicalJson(raw))
    for (const mutate of [
      (a: any) => { a.raw.outputs.project_brief.records[0].formalName.value = '篡改' },
      (a: any) => { a.compiledCandidateHash = '0'.repeat(64) },
      (a: any) => { a.receiptBindingHash = '0'.repeat(64) },
    ]) { const changed = structuredClone(audit); mutate(changed); expect(() => replayModuleAuthorProjection('1.01', corpus, changed, receipt)).toThrow(/MODULE_PROJECTION/)}
    expect(() => replayModuleAuthorProjection('1.01', corpus, audit, { ...receipt, childId: 'fake-child' })).toThrow(/MODULE_PROJECTION_RECEIPT/)
  })
})
