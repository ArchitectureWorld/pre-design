import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
import Ajv from 'ajv'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { renderPlanningDiagram } from '../src/presentation/manuscript-diagrams.ts'
import { validatePlanningDiagram } from '../src/report/manuscript/validation.ts'
import { PLANNING_CHAPTER_OUTPUT_SCHEMA } from '../src/report/manuscript/prompts.ts'
import { CHAPTER_QUALITY_POLICY, validateVisualReview } from '../src/report/chapter-quality-policy.ts'

const { JSDOM } = createRequire(import.meta.url)('jsdom')
const graph = (): any => ({
  nodes: [{id:'a',label:'起点',column:0,row:0,tone:'accent'}, {id:'b',label:'体验一',column:1,row:0},
    {id:'c',label:'体验二',column:2,row:0}, {id:'d',label:'终点',column:3,row:0}, {id:'s',label:'服务',column:1,row:1,tone:'muted'}],
  edges: [{from:'a',to:'b'}, {from:'b',to:'c'}, {from:'c',to:'d'}, {from:'a',to:'s',label:'接入'}, {from:'s',to:'c',label:'补给'}],
  presentation: {kind:'primary-secondary',primaryNodeIds:['a','b','c','d'],secondaryNodeIds:['a','s','c'],primaryLabel:'体验主线',secondaryLabel:'服务辅线'},
})
it('preserves authored lane intent through validation and the DSH structured-output schema', () => {
  expect(validatePlanningDiagram(graph())).toEqual(graph())
  const schema:any=PLANNING_CHAPTER_OUTPUT_SCHEMA.properties!.pages!.items!.properties!.visual!.properties!.diagram
  assertObjectJsonSchema(schema)
  const valid=new Ajv({strict:false}).compile(schema)
  expect(valid(graph()),JSON.stringify(valid.errors)).toBe(true)
})
it.each([
  ['missing relation',(g:any)=>g.edges.pop()],
  ['extra relation',(g:any)=>g.edges.push({from:'d',to:'a'})],
  ['repeated primary node',(g:any)=>g.presentation.primaryNodeIds[1]='a'],
  ['unowned node',(g:any)=>g.nodes.push({id:'x',label:'额外对象',column:3,row:1})],
  ['invalid secondary endpoint',(g:any)=>g.presentation.secondaryNodeIds[2]='s'],
])('rejects %s instead of silently changing the authored topology',(_name,change)=>{
  const value=graph();change(value)
  expect(()=>validatePlanningDiagram(value)).toThrow(/MANUSCRIPT_DIAGRAM/)
})
it('keeps the main path straight, the auxiliary path distinct and every authored label visible without big boxes',()=>{
  const rendered=renderPlanningDiagram(graph(),'generic-journey','组织示意')
  const doc=new JSDOM(rendered.svg,{contentType:'image/svg+xml'}).window.document
  const main=[...doc.querySelectorAll('[data-edge-role="primary"]')] as Element[]
  expect(main).toHaveLength(3)
  for(const edge of main){
    const n=edge.getAttribute('d')!.match(/[\d.]+/g)!.map(Number)
    expect(n).toHaveLength(4);expect(n[1]).toBe(n[3])
  }
  const secondary=[...doc.querySelectorAll('[data-edge-role="secondary"]')] as Element[]
  expect(secondary).toHaveLength(2)
  expect(secondary.every(p=>p.hasAttribute('stroke-dasharray'))).toBe(true)
  expect(doc.querySelectorAll('[data-node-id] rect')).toHaveLength(0)
  expect(doc.querySelectorAll('[data-node-id]')).toHaveLength(5)
  const labels=[...doc.querySelectorAll('text')].map((e:any)=>e.textContent)
  expect(labels.sort()).toEqual([...graph().nodes.map((n:any)=>n.label),'体验主线','服务辅线','接入','补给'].sort())
})
it('requires an explicit aesthetics observation in addition to readability checks',()=>{
  expect(CHAPTER_QUALITY_POLICY.rules.some(r=>r.id as string==='diagram-aesthetics')).toBe(true)
  const identity={pageId:'p',screenshotSha256:'x'}
  const review:any={pages:[{...identity,imageReadable:true,checks:CHAPTER_QUALITY_POLICY.rules.filter(r=>r.id as string!=='diagram-aesthetics').map(r=>({ruleId:r.id,observation:'已看图'})),findings:[]}],chapterObservation:'章节检查'}
  expect(()=>validateVisualReview(review,[identity])).toThrow('CHAPTER_QUALITY_REVIEW_COVERAGE')
})
it.each(['flow','branch','convergence','cycle','matrix'])('renders native %s groups without legacy cards and preserves every relation',topology=>{
  const g:any={nodes:[{id:'a',label:'对象一',column:0,row:0},{id:'b',label:'对象二',column:1,row:0},{id:'c',label:'对象三',column:1,row:1}],edges:[{from:'a',to:'b'},{from:'a',to:'c',label:'支撑'}],presentation:{kind:'editorial',topology,primaryNodeIds:['a','b'],groups:[{label:'起点',nodeIds:['a']},{label:'去向',nodeIds:['b','c']}]}}
  const valid=validatePlanningDiagram(g);expect(valid).toEqual(g)
  const doc=new JSDOM(renderPlanningDiagram(valid,'sample-'+topology,'关系').svg,{contentType:'image/svg+xml'}).window.document
  expect(doc.querySelectorAll('[data-node-id] rect')).toHaveLength(0)
  expect(doc.querySelectorAll('[data-node-id]')).toHaveLength(3)
  expect(doc.querySelectorAll('[data-edge-index]')).toHaveLength(2)
  expect([...doc.querySelectorAll('text')].map((e:any)=>e.textContent)).toEqual(expect.arrayContaining(['对象一','对象二','对象三','起点','去向','支撑']))
  g.presentation.groups[1].nodeIds.push('a')
  expect(()=>validatePlanningDiagram(g)).toThrow('MANUSCRIPT_DIAGRAM')
})
