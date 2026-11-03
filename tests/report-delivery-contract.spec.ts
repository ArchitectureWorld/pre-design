import { describe, expect, it } from 'vitest'
import { DEFAULT_REPORT_DELIVERY_CONTRACT, reportDeliveryContract, assertReportDeliveryContract, deliveryContractPrompt, inspectReportCoverage } from '../src/report/delivery-contract.ts'
import { buildPlanningChapterPrompt, planningChapterTitle } from '../src/report/manuscript/prompts.ts'
import { manuscriptSourceFingerprint } from '../src/report/manuscript/source.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'
import { completeReportFixture } from './support/complete-report.ts'
import { assertReportResearchReady } from '../src/report/module-source.ts'

const input = (): FrozenProjectInput => ({ projectId:'p',projectName:'项目',revision:1,generatedAt:'2026-09-27T00:00:00Z', recommendation:'',decisionItems:[],stateObjects:[],gates:[],visualAssets:[] })
describe('complete planning HTML delivery contract', () => {
  it('defaults to HTML and includes independent industry planning without naming a provider or project', () => {
    expect(reportDeliveryContract()).toEqual(DEFAULT_REPORT_DELIVERY_CONTRACT)
    expect(reportDeliveryContract().formats).toEqual(['html'])
    expect(reportDeliveryContract().requirements.map(x=>x.id)).toEqual(['opportunity','choice','industry','products','spatial','launch','operations'])
    expect(deliveryContractPrompt()).toContain('不能用通用建议或补资料待办代替')
    expect(deliveryContractPrompt()).not.toMatch(/少潭河|Gemini|Qwen|gpt-/i)
  })
  it('requires industry selection and value-chain projects in the manuscript and invalidates the previous delivery contract', () => {
    expect(planningChapterTitle('products')).toContain('产业规划')
    const prompt = buildPlanningChapterPrompt(input(), 'products', [])
    for (const term of ['产业链', '主导产业', '项目组合', '运营主体', '分期']) expect(prompt).toContain(term)
    expect(() => assertReportDeliveryContract({ ...reportDeliveryContract(), version: 'complete-planning-html.v1' })).toThrow('REPORT_DELIVERY_CONTRACT_CHANGED')
  })
  it('binds the delivery policy into source fingerprints, while legacy missing policy normalizes to default', () => {
    const base=input()
    expect(manuscriptSourceFingerprint(base)).toBe(manuscriptSourceFingerprint({...base,deliveryContract:reportDeliveryContract()}))
    expect(manuscriptSourceFingerprint({...base,deliveryContract:{...reportDeliveryContract(),version:'future'}})).not.toBe(manuscriptSourceFingerprint(base))
  })
  it('does not accept a report without selected and completed research', () => {
    expect(()=>assertReportResearchReady({status:'not_requested'})).toThrow('REPORT_MODULES_REQUIRED')
    expect(inspectReportCoverage(input()).map(x=>x.code)).toContain('RESEARCH_REQUIRED')
    expect(inspectReportCoverage({...input(),moduleResearch:{expectedModuleIds:['1.01'],moduleRuns:[{itemId:'1.01',status:'failed'}],results:[]} as never}).map(x=>x.code)).toContain('RESEARCH_INCOMPLETE')
  })
  it('does not count chapter titles or an attached terrain image as substantive delivery', () => {
    const issues=inspectReportCoverage({...input(),manuscript:{chapters:[{id:'spatial',pages:[{id:'spatial-map',kind:'spatial',title:'地形',claim:'后续应完善方案',body:['建议核实资料'],sourceRefs:[],visual:{kind:'source'}}]}]} as never})
    expect(issues.map(x=>x.code)).toContain('GENERIC_PROPOSAL')
    expect(issues.some(x=>x.requirementId==='products')).toBe(true)
  })
  it('identifies products detached from spatial, phase and operating arrangements', () => {
    const issues = inspectReportCoverage(completeReportFixture())
    expect(issues.some(i => i.code === 'PRODUCT_UNBOUND' && i.pageId === 'products-plan')).toBe(true)
    expect(issues.some(i => i.code === 'SPATIAL_EVIDENCE_REQUIRED' && i.pageId === 'spatial-plan')).toBe(true)
  })
  it('treats product cards in implementation and operations as arrangements, not additional core products', () => {
    const value = completeReportFixture(true), chapters = value.manuscript!.chapters as any[]
    const product = chapters.find(chapter => chapter.id === 'products').pages[0]
    chapters.find(chapter => chapter.id === 'operation').pages.push({ ...structuredClone(product), id: 'operation-product-card', productRefs: [product.id] })
    expect(inspectReportCoverage(value).filter(issue => issue.code === 'PRODUCT_UNBOUND')).toEqual([])
    chapters.find(chapter => chapter.id === 'spatial').pages[0].productRefs = []
    expect(inspectReportCoverage(value).filter(issue => issue.code === 'PRODUCT_UNBOUND')).toEqual([
      expect.objectContaining({ pageId: product.id, requirementId: 'spatial' }),
    ])
  })
  it('does not force every background research item into the body while keeping page sources mandatory', () => {
    const value = completeReportFixture(true)
    for (const chapter of value.manuscript!.chapters) for (const page of chapter.pages) Object.assign(page, { sourceRefs: [] })
    const issues = inspectReportCoverage(value)
    expect(issues.some(issue => issue.code === 'RESEARCH_NOT_USED')).toBe(false)
    expect(issues.some(issue => issue.code === 'SOURCE_UNBOUND')).toBe(true)
  })
  it('allows a route diagram to explain the same products as the grounded spatial plan without duplicating that plan', () => {
    const value = completeReportFixture(true), chapter = value.manuscript!.chapters.find(c => c.id === 'spatial')!
    const plan = chapter.pages[0]!, route = { ...structuredClone(plan), id: 'spatial-route', spatialEvidence: undefined,
      visual: { kind: 'diagram', subject: '预约到达与课程游线', purpose: '组织同一组产品的到访顺序', caption: '游线组织',
        diagram: { nodes: [{ id: 'arrival', label: '入口', column: 0, row: 0 }, { id: 'class', label: '课堂', column: 1, row: 0 }], edges: [{ from: 'arrival', to: 'class' }] } } }
    ;(chapter.pages as any[]).push(route)
    expect(inspectReportCoverage(value).filter(i => i.pageId === 'spatial-route')).toEqual([])
    route.productRefs = []
    expect(inspectReportCoverage(value).some(i => i.pageId === 'spatial-route' && i.code === 'SPATIAL_EVIDENCE_REQUIRED')).toBe(true)
    route.productRefs = ['products-plan']
    Object.assign(plan, { spatialEvidence: undefined })
    expect(inspectReportCoverage(value).some(i => i.pageId === 'spatial-route' && i.code === 'SPATIAL_EVIDENCE_REQUIRED')).toBe(true)
  })
  it('never shares an invalid terrain plan or hides a route page own invalid geometry', () => {
    const value = completeReportFixture(true), chapter = value.manuscript!.chapters.find(c => c.id === 'spatial')!, plan = chapter.pages[0]!
    Object.assign(value, { terrain: { id: 'terrain-test', method: '网格地形', files: [], cells: [{ id: 'A1', waterFraction: 0, validFraction: 1, slopeDegrees: 2, anchor: [0,0,10] }] } })
    const terrainPlan:any = { sourceId: 'terrain-test', zones: [{ name: '课堂区', cellIds: ['A1'], productRefs: ['products-plan'] }],
      nodes: ['arrival','product','service','logistics'].map(role => ({ id: role, name: role, role, cellId: 'A1', productRefs: ['products-plan'] })),
      routes: [{ name: '游线', kind: 'visitor', nodeIds: ['arrival','product'] }, { name: '后勤', kind: 'logistics', nodeIds: ['logistics','service'] }] }
    Object.assign(plan, { terrainPlan })
    const route:any = { ...structuredClone(plan), id: 'spatial-route', terrainPlan: undefined, spatialEvidence: undefined,
      visual: { kind: 'diagram', subject: '游线', purpose: '组织课程到访', caption: '游线', diagram: {
        nodes: [{ id: 'arrival', label: '入口', column: 0, row: 0 }, { id: 'class', label: '课堂', column: 1, row: 0 }], edges: [{ from: 'arrival', to: 'class' }] } } }
    ;(chapter.pages as any[]).push(route)
    expect(inspectReportCoverage(value).filter(i => i.pageId === 'spatial-route')).toEqual([])
    terrainPlan.nodes[1].cellId = 'invented'
    expect(inspectReportCoverage(value).filter(i => i.code === 'TERRAIN_PLAN_REQUIRED').map(i => i.pageId)).toEqual(['spatial-plan','spatial-route'])
    terrainPlan.nodes[1].cellId = 'A1'
    route.terrainPlan = { ...terrainPlan, sourceId: 'unrelated-terrain' }
    expect(inspectReportCoverage(value).some(i => i.pageId === 'spatial-route' && i.code === 'TERRAIN_PLAN_REQUIRED')).toBe(true)
  })
  it('rejects fabricated amounts and non-reproducible calculations while admitting explicit grounded scenarios', () => {
    const input = completeReportFixture(), pages = input.manuscript!.chapters.at(-1)!.pages as any[]
    pages[0].body = ['情景收入为 90 万元']
    expect(inspectReportCoverage(input).some(i => i.code === 'NUMBER_UNBOUND')).toBe(true)
    pages[0].quantities = [
      { id: 'price', kind: 'assumption', label: '单价', value: 30, unit: '万元', sourceRefs: pages[0].sourceRefs, rationale: '敏感性分析的设计假设，非现状营业收入；以可预约课程为对象。' },
      { id: 'count', kind: 'assumption', label: '场次', value: 3, unit: '场', sourceRefs: pages[0].sourceRefs, rationale: '以资源约束确定的试运行情景，需用实际预约验证。' },
      { id: 'income', kind: 'calculation', label: '收入', value: 90, unit: '万元', sourceRefs: pages[0].sourceRefs, rationale: '单价乘场次', operation: 'product', inputIds: ['price', 'count'] },
    ]
    expect(inspectReportCoverage(input).some(i => ['NUMBER_UNBOUND', 'CALCULATION_INVALID'].includes(i.code))).toBe(false)
    pages[0].quantities[2].value = 99
    expect(inspectReportCoverage(input).some(i => i.code === 'CALCULATION_INVALID')).toBe(true)
  })
})
