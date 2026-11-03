import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import Ajv from 'ajv'
import { loadPlanningCatalog } from '../src/research-v2/catalog.ts'

async function api() {
  expect(existsSync(new URL('../src/research-v2/module-contracts.ts', import.meta.url)), 'professional module output contracts exist').toBe(true)
  return import('../src/research-v2/module-contracts.ts')
}
const missing = () => ({ value: null, claimRefs: [], claimClass: 'missing', limitations: ['原始资料未提供，待补证。'] })
const source = (value: unknown) => ({ value, claimRefs: ['claim-1'], claimClass: 'source_conclusion', limitations: ['仅为原报告记载。'] })

// A fully enumerated 8.03 fixture is independent of the schema builder. Missing
// parameters remain explicit instead of being filled with made-up zero amounts.
function fundingOutput() {
  return { funding: { type: 'planning.funding.v1.2', quality: 'limited', scope: '少潭河原始资料研究', asOf: '2026-09-26',
    claimRefs: ['claim-1'], limitations: ['资金来源尚待核实。'], records: [{ recordId: 'funding-row-1', resultClass: 'observation_summary',
      fundingId: source('F-01'), provider: source('原报告提出的申请主体'), instrument: source('专项资金申请'),
      eligibility: missing(), status: source('applied'), amount: missing(), useRestrictions: missing(),
      availableDate: missing(), term: missing(), financingCost: missing(), packageIds: missing(), alternatives: missing(),
      proofIds: missing(), fundingGap: missing(),
    }] } }
}

describe('professional contracts for all 62 research modules', () => {
  it('rejects missing implementations before exercising the contract API', async () => { await api() })
  it.each(loadPlanningCatalog().modules)('provides closed, typed records for $id including alternative ports', async item => {
    const a = await api(), ajv = new Ajv({ strict: false, validateFormats: false })
      const schema = a.getModuleOutputSchema(item.id) as any
      expect(Object.keys(schema.properties).sort()).toEqual(item.ports.map(p => p.name).sort())
      expect(schema.additionalProperties).toBe(false)
      for (const port of item.ports) {
        const row = schema.properties[port.name].properties.records.items
        expect(row.additionalProperties).toBe(false)
        expect(row.required.length).toBeGreaterThan(5)
        expect(row.properties.summary).toBeUndefined()
        expect(row.properties.recordId).toBeDefined()
        expect(row.properties.resultClass).toBeDefined()
        expect(ajv.compile(schema)({ [port.name]: { records: [{ summary: '已经完成' }] } })).toBe(false)
      }
  })
  it('accepts disclosed missing financing inputs without manufacturing amounts or approval', async () => {
    const a = await api(), output = fundingOutput(), original = JSON.stringify(output)
    expect(a.validateModuleOutputs('8.03', output)).toEqual({ valid: true, errors: [] })
    expect(JSON.stringify(output)).toBe(original)
    expect((output.funding.records[0].amount).value).toBeNull()
    expect(output.funding.quality).toBe('limited')
  })
  it.each([
    ['wrong money type', (q: any) => { q.funding.records[0].amount = source('100万元') }],
    ['untyped field', (q: any) => { q.funding.records[0].invented = source('已落实') }],
    ['missing field evidence', (q: any) => { q.funding.records[0].provider.claimRefs = [] }],
    ['unresolved port claim', (q: any) => { q.funding.claimRefs = [] }],
    ['missing disguised as fact', (q: any) => { q.funding.records[0].amount.claimClass = 'fact' }],
    ['missing without explanation', (q: any) => { q.funding.records[0].amount.limitations = [] }],
    ['empty accepted result', (q: any) => { q.funding.quality = 'accepted'; q.funding.records = [] }],
    ['missing accepted result', (q: any) => { q.funding.quality = 'accepted' }],
    ['invalid day', (q: any) => { q.funding.asOf = '2026-02-30' }],
    ['wrong selected port type', (q: any) => { q.funding.type = 'planning.cashflow.v1.2' }],
    ['duplicate record', (q: any) => { q.funding.records.push(structuredClone(q.funding.records[0])) }],
  ])('rejects %s', async (_name, change) => {
    const a = await api(), q = fundingOutput(); change(q)
    const result = a.validateModuleOutputs('8.03', q)
    expect(result.valid).toBe(false); expect(result.errors.length).toBeGreaterThan(0)
  })
  it('rejects an invalid financial status instead of normalizing it into an approval', async () => {
    const a = await api(), q = fundingOutput(); q.funding.records[0].status = source('maybe-paid')
    expect(a.validateModuleOutputs('8.03', q).valid).toBe(false)
  })
  it.each(['null', 0, [], {}])('explains a malformed missing value without changing it: %j', async value => {
    const a = await api(), q = fundingOutput() as any
    q.funding.records[0].amount.value = value
    const original = structuredClone(q)
    expect(a.validateModuleOutputs('8.03', q)).toMatchObject({ valid: false,
      errors: [expect.stringContaining('funding.records.0.amount.value: MISSING_REQUIRES_JSON_NULL')] })
    const { recordId, resultClass, amount } = q.funding.records[0]
    expect(a.validateModuleOutputFields('8.03', { funding: { ...q.funding, records: [{ recordId, resultClass, amount }] } }, { funding: ['amount'] }).errors)
      .toEqual([expect.stringContaining('claimClass=missing 必须使用 JSON null')])
    expect(q).toEqual(original)
  })
  it('uses identical record contracts for same-typed conditional alternatives', async () => {
    const a = await api(), pairs = [['5.01','service_system','5.03','content_system'], ['5.05','business_candidates','5.06','service_candidates'],
      ['1.08','new_building_context','6.04','building_context'], ['1.04','rights_context','6.04','rights_context'],
      ['7.01','service_notice','7.05','audience_notice'], ['7.02','service_notice_cost','7.05','communication_cost'],
      ['7.01','self_supply_readiness','7.04','supply_readiness']]
    for (const [left, lp, right, rp] of pairs) {
      const l = a.getModuleOutputSchema(left) as any, r = a.getModuleOutputSchema(right) as any
      expect(l.properties[lp].properties.records).toEqual(r.properties[rp].properties.records)
    }
  })
  it('rejects non-JSON and unknown module inputs without executing accessors', async () => {
    const a = await api(); let called = false
    const malicious = { get funding() { called = true; return {} } }
    expect(a.validateModuleOutputs('8.03', malicious).valid).toBe(false)
    expect(called).toBe(false)
    expect(a.validateModuleOutputs('9.99', {}).valid).toBe(false)
  })
  it('distinguishes justified field inapplicability from missing evidence', async () => {
    const a = await api(), q = fundingOutput() as any
    q.funding.records[0].financingCost = { value: null, claimRefs: ['decision-1'], claimClass: 'decision',
      limitations: ['仅适用于该无偿资金方案。'], notApplicableReason: '本轮选择的是无偿拨款方案，不含借款融资。' }
    q.funding.claimRefs.push('decision-1')
    expect(a.validateModuleOutputs('8.03', q)).toEqual({ valid: true, errors: [] })
    q.funding.records[0].financingCost.claimClass = 'fact'
    expect(a.validateModuleOutputs('8.03', q).valid).toBe(false)
    q.funding.records[0].financingCost.claimClass = 'decision'
    q.funding.records[0].financingCost.claimRefs = []
    expect(a.validateModuleOutputs('8.03', q).valid).toBe(false)
  })
  it('does not accept an all-inapplicable row as an executed professional result', async () => {
    const a = await api(), q = fundingOutput() as any
    for (const field of a.getModuleFieldContracts('8.03').ports.funding.fields) q.funding.records[0][field.name] = {
      value: null, claimRefs: ['decision-1'], claimClass: 'decision', limitations: ['整项适用性须由运行计划处理。'], notApplicableReason: '无法确认' }
    q.funding.claimRefs = ['decision-1']; q.funding.quality = 'accepted'
    expect(a.validateModuleOutputs('8.03', q).valid).toBe(false)
  })
  it.each([
    ['3.03', 'demand', 'participationRate', 1.01],
    ['3.03', 'demand', 'captureShare', -0.1],
    ['3.06', 'peer_operations', 'sampleSize', 1.5],
    ['6.03', 'capacity_check', 'netToGrossRatio', 1.5],
    ['2.03', 'regional_od', 'roadMeters', -1],
    ['2.03', 'regional_od', 'durationSeconds', '120秒'],
    ['1.02', 'boundaries', 'geometry', { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1]]] }],
    ['2.02', 'regional_nodes', 'geometry', { type: 'Polygon', coordinates: [] }],
    ['2.01', 'regional_context', 'projectPosition', { x: 114, y: 300, crs: 'WGS84', axisOrder: 'xy' }],
    ['3.07', 'market_gaps', 'demand', { minimum: 30, maximum: 20, unit: '人次/年', basis: '条件情景' }],
    ['8.02', 'cost_estimate', 'amount', { minimum: 20, maximum: 10, currency: 'CNY', basis: '条件估算' }],
  ])('rejects invalid professional values for %s %s.%s', async (itemId, portName, field, value) => {
    const a = await api(), contracts = a.getModuleFieldContracts(itemId), q: Record<string, any> = {}
    // Null setup is not the expected result; the independent adversarial value
    // above must be rejected regardless of other missing project parameters.
    for (const [port, definition] of Object.entries(contracts.ports)) q[port] = {
      type: definition.type, quality: 'limited', scope: '合成边界测试', asOf: '2026-09-26', claimRefs: ['claim-1'], limitations: ['其余输入未提供。'],
      records: [{ recordId: 'row-1', resultClass: 'calculation', ...Object.fromEntries(definition.fields.map(f => [f.name, missing()])) }],
    }
    q[portName].records[0][field] = source(value)
    expect(a.validateModuleOutputs(itemId, q).valid).toBe(false)
  })

  it('requires evidence for boundary area instead of accepting a chosen measurement', async () => {
    const a = await api(), definition = a.getModuleFieldContracts('1.02').ports.boundaries
    const { validateModuleClaims } = await import('../src/research-v2/module-claims.ts')
    const row: any = { recordId: 'boundary-1', resultClass: 'calculation',
      ...Object.fromEntries(definition.fields.map(f => [f.name, missing()])),
      area: source({ value: 35.62, unit: 'km²', basis: 'geodesic' }),
    }
    const port = { type: definition.type, quality: 'limited', scope: '研究范围面积证据测试', asOf: '2026-09-28',
      records: [row], claimRefs: ['claim-1'], limitations: ['原有面积与程序球面积分须分别保留口径。'] }
    expect(a.validateModuleOutputs('1.02', { boundaries: port }).valid).toBe(true)
    for (const claimClass of ['decision', 'assumption']) {
      row.area.claimClass = claimClass
      expect(() => validateModuleClaims({ outputs: { boundaries: port }, moduleId: definition.type, upstream: [], sourceValues: [],
        claims: [{ claimId: 'claim-1', selector: '/outputs/boundaries/records/0/area/value/value',
          kind: claimClass === 'decision' ? 'proposal' : 'assumption', value: 35.62, rationale: 'Choose this as the measured area' }] }))
        .toThrow('MODULE_BOUNDARY_AREA_EVIDENCE_REQUIRED')
    }
    // A disclosed conditional calculation remains valid; the formula, rather
    // than the word "assumption", decides whether the measurement is supported.
    row.area = { ...source({ value: 5.44 * 6.55, unit: 'km²', basis: '条件图幅矩形粗估，非测地面积' }), claimClass: 'assumption' }
    expect(a.validateModuleOutputs('1.02', { boundaries: port }).valid).toBe(true)
    const conditional: any = { outputs: { boundaries: port }, moduleId: definition.type, upstream: [],
      sourceValues: [{ sourceId: 'width', rawValue: 5.44 }, { sourceId: 'height', rawValue: 6.55 }],
      claims: [{ claimId: 'claim-1', selector: '/outputs/boundaries/records/0/area/value/value', kind: 'calculation', value: 5.44 * 6.55,
        rationale: '条件选择资料图幅作为研究范围，按原件宽高粗估，非球面或法定面积。',
        calculation: { operation: 'product', basis: 'scenario', operands: [{ sourceId: 'width' }, { sourceId: 'height' }] } }] }
    expect(() => validateModuleClaims(conditional)).not.toThrow()
    conditional.claims[0].value = row.area.value.value = 35.62
    expect(() => validateModuleClaims(conditional)).toThrow('MODULE_CALCULATION_MISMATCH')
    row.area = missing()
    expect(a.validateModuleOutputs('1.02', { boundaries: port }).valid).toBe(true)
    row.area = source({ value: 35617631.74, unit: 'm²', basis: '原件投影图幅面积，非球面或法定用地面积' })
    expect(a.validateModuleOutputs('1.02', { boundaries: port }).valid).toBe(true)
  })

  it('rejects exchanged WGS84 geometry axes using the declared boundary axis order', async () => {
    const a = await api(), definition = a.getModuleFieldContracts('1.02').ports.boundaries
    const q = { boundaries: { type: definition.type, quality: 'limited', scope: '研究范围校验', asOf: '2026-09-26',
      claimRefs: ['claim-1'], limitations: ['概念研究边界，不是法定红线。'], records: [{ recordId: 'boundary-1', resultClass: 'calculation',
        ...Object.fromEntries(definition.fields.map(f => [f.name, missing()])), crs: source('EPSG:4326'), axisOrder: source('xy'),
        geometry: source({ type: 'Polygon', coordinates: [[[114,30],[115,30],[115,31],[114,30]]] }),
      }] } }
    expect(a.validateModuleOutputs('1.02', q).valid).toBe(true)
    const point = structuredClone(q) as any
    point.boundaries.records[0].geometry = source({type:'Point',coordinates:[114,30]})
    expect(a.validateModuleOutputFields('1.02', {boundaries:{...point.boundaries,records:[{recordId:'boundary-1',resultClass:'calculation',geometry:point.boundaries.records[0].geometry}]}}, {boundaries:['geometry']}).valid).toBe(false)
    expect(a.validateModuleOutputs('1.02',point).valid).toBe(false)
    expect(new Ajv({strict:false}).compile(a.getModuleOutputSchema('1.02'))(point)).toBe(false)
    const row = q.boundaries.records[0] as any
    row.geometry.value.coordinates = row.geometry.value.coordinates.map((ring: number[][]) => ring.map(([x,y]) => [y,x]))
    const swapped = structuredClone(q)
    expect(a.validateModuleOutputs('1.02', q)).toMatchObject({ valid: false, errors: [expect.stringContaining('WGS84_GEOMETRY_OUT_OF_RANGE')] })
    expect(q).toEqual(swapped)
    row.axisOrder = source('yx')
    expect(a.validateModuleOutputs('1.02', q).valid).toBe(true)
  })
})
