import { describe, expect, it } from 'vitest'
import { validateModuleClaims } from '../src/research-v2/module-claims.ts'

function standaloneScenario(){
 const claim:any={claimId:'cost',selector:'/outputs/costs/records/0/cost/value',kind:'calculation',value:2000,unit:'元',
  rationale:'测试用工作量乘单价情景，非已核工程造价。',calculation:{basis:'scenario',operation:'product',operands:[
   {scenarioAssumption:{value:100,unit:'平方米',rationale:'测试拟议面积；不是现场实测。'}},
   {scenarioAssumption:{value:20,unit:'元/平方米',rationale:'测试单价情景；不是报价。'}},
  ]}}
 return {moduleId:'test-finance',upstream:[],sourceValues:[],claims:[claim],outputs:{costs:{quality:'limited',claimRefs:['cost'],records:[{
  cost:{value:2000,currency:'元',claimClass:'assumption',claimRefs:['cost'],limitations:['仅条件成本测算。']}}]}}}
}

it('recomputes native standalone workload and price assumptions and retains their exact authored values',()=>{
 const input=standaloneScenario(),before=JSON.stringify(input),result=validateModuleClaims(input)
 expect(result.claims[0]!.value).toBe(2000)
 expect(result.claims[0]!.calculation!.operands[1]).toEqual({scenarioAssumption:{value:20,unit:'元/平方米',rationale:'测试单价情景；不是报价。'}})
 expect(result.limitations.some(l=>l.includes('20')&&l.includes('元/平方米'))).toBe(true)
 expect(JSON.stringify(input)).toBe(before)
})
it('rejects wrong arithmetic using standalone scenario operands',()=>{
 const input=standaloneScenario();input.claims[0].value=input.outputs.costs.records[0]!.cost.value=2001
 expect(()=>validateModuleClaims(input)).toThrow('MODULE_CALCULATION_MISMATCH')
})
it.each([undefined,'source'])('does not allow standalone assumptions in %s factual calculations',basis=>{
 const input=standaloneScenario();if(basis===undefined)delete input.claims[0].calculation.basis;else input.claims[0].calculation.basis=basis
 expect(()=>validateModuleClaims(input)).toThrow('MODULE_CALCULATION_UNVERIFIED_OPERAND')
})
it.each(['unit','rationale'])('requires the author to supply standalone %s',field=>{
 const input=standaloneScenario();delete input.claims[0].calculation.operands[0].scenarioAssumption[field]
 expect(()=>validateModuleClaims(input)).toThrow()
})
it('still rejects presenting a standalone scenario result as an accepted factual port',()=>{
 const input=standaloneScenario();input.outputs.costs.quality='accepted'
 expect(()=>validateModuleClaims(input)).toThrow('MODULE_CLAIM_UNCERTAIN_ACCEPTED')
})

function scenario() {
  const prefix = '/outputs/scenario/records/0/'
  const claims: any[] = [
    { claimId: 'rooms', selector: prefix + 'rooms/value', kind: 'source', value: 20, sourceId: 'original-rooms' },
    { claimId: 'occupancy', selector: prefix + 'occupancy/value', kind: 'assumption', value: 0.5,
      rationale: '以50%入住率检验设计运营情景，另比较30%和70%；不作为历史或预测的已核事实。' },
    { claimId: 'occupied', selector: prefix + 'occupied/value', kind: 'calculation', value: 10,
      rationale: '情景日使用客房数 = 来源房间数 × 假设入住率。',
      calculation: { basis: 'scenario', operation: 'product', operands: [{ claimId: 'rooms' }, { claimId: 'occupancy' }] } },
  ]
  const records = [Object.fromEntries(claims.map(c => [c.claimId, { value: c.value, claimClass: c.kind === 'source' ? 'source_conclusion' : 'assumption',
    claimRefs: [c.claimId], limitations: ['条件测算，非当前经营实绩。'] }]))]
  return { moduleId: 'finance', upstream: [] as any[], claims,
    sourceValues: [{ sourceId: 'original-rooms', rawValue: 20 }] as any[],
    outputs: { scenario: { quality: 'limited', records, claimRefs: claims.map(c => c.claimId) } } }
}

describe('research conditional calculations without upgrading assumptions', () => {
  it('recomputes an explicitly conditional calculation and preserves both its inputs and uncertainty', () => {
    const input = scenario(), before = JSON.stringify(input)
    const result = validateModuleClaims(input)
    expect(result.claims.find(c => c.claimId === 'occupied')?.value).toBe(10)
    expect(result.limitations.some(l => l.includes('occupied') && l.includes('情景'))).toBe(true)
    expect(JSON.stringify(input)).toBe(before)
  })
  it('still rejects wrong arithmetic under a scenario label', () => {
    const input = scenario()
    input.claims[2].value = input.outputs.scenario.records[0].occupied.value = 11
    expect(() => validateModuleClaims(input)).toThrow('MODULE_CALCULATION_MISMATCH')
  })
  it('rejects an unmarked calculation consuming an assumption', () => {
    const input = scenario(); delete input.claims[2].calculation.basis
    expect(() => validateModuleClaims(input)).toThrow('MODULE_CALCULATION_UNVERIFIED_OPERAND')
  })
  it('requires the author to explain the conditional calculation', () => {
    const input = scenario(); delete input.claims[2].rationale
    expect(() => validateModuleClaims(input)).toThrow('MODULE_CALCULATION_SCENARIO_RATIONALE_REQUIRED')
  })
  it('does not allow a conditional result to be classified as a source conclusion', () => {
    const input = scenario(); input.outputs.scenario.records[0].occupied.claimClass = 'source_conclusion'
    expect(() => validateModuleClaims(input)).toThrow('MODULE_CLAIM_CLASS_MISMATCH')
  })
  it('keeps uncertainty through local chained calculations', () => {
    const input = scenario()
    input.claims.push({ claimId: 'doubled', selector: '/outputs/scenario/records/0/doubled/value', kind: 'calculation', value: 20,
      calculation: { operation: 'sum', operands: [{ claimId: 'occupied' }, { claimId: 'occupied' }] } })
    input.outputs.scenario.records[0].doubled = { value: 20, claimClass: 'agent_inference', claimRefs: ['doubled'], limitations: [] }
    input.outputs.scenario.claimRefs.push('doubled')
    expect(() => validateModuleClaims(input)).toThrow('MODULE_CALCULATION_UNVERIFIED_OPERAND')
    input.claims[3].calculation.basis = 'scenario'; input.claims[3].rationale = '两个相同经营情景时段之和。'
    input.outputs.scenario.records[0].doubled.claimClass = 'assumption'
    expect(validateModuleClaims(input).claims.at(-1)?.value).toBe(20)
  })
  it('keeps uncertainty across module boundaries and rejects accepted source-only quality', () => {
    const upstream = validateModuleClaims(scenario())
    const input = scenario()
    input.upstream = [{ moduleId: 'upstream', claims: upstream.claims }]
    input.claims = [{ ...input.claims[2], calculation: { basis: 'scenario', operation: 'sum', operands: [{ moduleId: 'upstream', claimId: 'occupied' }] } }]
    input.outputs.scenario.records = [{ occupied: input.outputs.scenario.records[0].occupied }]
    input.outputs.scenario.claimRefs = ['occupied']
    expect(validateModuleClaims(input).claims[0].value).toBe(10)
    input.claims[0].calculation.basis = 'source'
    expect(() => validateModuleClaims(input)).toThrow('MODULE_CALCULATION_UNVERIFIED_OPERAND')
    input.claims[0].calculation.basis = 'scenario'; input.outputs.scenario.quality = 'accepted'
    expect(() => validateModuleClaims(input)).toThrow('MODULE_CLAIM_UNCERTAIN_ACCEPTED')
  })
  it('does not treat a proposal or free constant as a numeric scenario premise', () => {
    const input = scenario(); input.claims[1].kind = 'proposal'
    expect(() => validateModuleClaims(input)).toThrow('MODULE_CALCULATION_UNVERIFIED_OPERAND')
  })
  it('also checks the provenance of scenario weights', () => {
    const input = scenario()
    input.claims[2].calculation = { operation: 'weighted_mean', operands: [{ claimId: 'rooms' }], weights: [{ claimId: 'occupancy' }] }
    input.claims[2].value = input.outputs.scenario.records[0].occupied.value = 20
    expect(() => validateModuleClaims(input)).toThrow('MODULE_CALCULATION_UNVERIFIED_OPERAND')
    input.claims[2].calculation.basis = 'scenario'
    expect(validateModuleClaims(input).claims[2].value).toBe(20)
  })
})
