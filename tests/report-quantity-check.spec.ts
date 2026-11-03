import {expect,it} from 'vitest'
import {inspectReportQuantities} from '../src/report/quantity-check.ts'
import type {PlanningManuscriptPage,PlanningManuscriptSource} from '../src/report/manuscript/types.ts'
const source:PlanningManuscriptSource={id:'source:one',objectId:'one',fieldPath:'value',text:'现有研究资料',basis:'研究原文',evidenceIds:[]}
function page(change:Partial<PlanningManuscriptPage>={}):PlanningManuscriptPage{return{id:'cost',kind:'financial',title:'运营安排',claim:'提出预约服务方案',body:[],sourceRefs:[source.id],visual:{kind:'none',subject:'',purpose:'',caption:''},notes:[],...change}}
const quantity=(id:string,value:number)=>({id,label:id,value,unit:'CNY/年',kind:'assumption' as const,sourceRefs:[source.id],rationale:'有边界的年度工作情景'})
it('checks explicitly approximate terrain water percentages against the named cited grid cell',()=>{
 const terrain={...source,id:'terrain:grid:B4',objectId:'terrain',fieldPath:'terrain.cells.B4',text:JSON.stringify({id:'B4',waterFraction:0.17119675456389452})}
 const p=page({sourceRefs:[terrain.id],body:['B4网格水域比例约17.1%。']})
 expect(inspectReportQuantities([p],[terrain])).toEqual([])
 for(const body of ['B4网格水域比例约17.2%。','C4网格水域比例约17.1%。','B4网格水域比例17.1%。','B4投资占比约17.1%。','B4位于研究区。其他地区水域比例约17.1%。'])expect(inspectReportQuantities([{...p,body:[body]}],[terrain]).length).toBeGreaterThan(0)
 expect(inspectReportQuantities([{...p,sourceRefs:[source.id]}],[source,terrain]).length).toBeGreaterThan(0)
})
it('recomputes a scenario rate already declared in the matching aggregate assumption and table',()=>{
 const p=page({table:{columns:['项目','算式','金额'],rows:[['材料与卫生','12×600','7,200']]},quantities:[{...quantity('batches',12),unit:'批/年'},{...quantity('materials',7200),label:'材料与卫生',rationale:'12批×600 CNY/批的预算假设；按实际工作量复核。'}]})
 const before=JSON.stringify(p)
 expect(inspectReportQuantities([p],[source])).toEqual([]);expect(JSON.stringify(p)).toBe(before)
 for(const rows of [[['材料与卫生','12×601','7,200']],[['无关项目','12×600','7,200']],[['材料与卫生','12×600','7,201']]])expect(inspectReportQuantities([{...p,table:{...p.table!,rows}}],[source]).length).toBeGreaterThan(0)
 expect(inspectReportQuantities([{...p,quantities:p.quantities!.map(q=>q.id==='materials'?{...q,rationale:'总额假设，没有单批拆分'}:q)}],[source]).length).toBeGreaterThan(0)
})
it('traces a financial summary through explicit product links to valid peer calculations',()=>{
 const origin=page({id:'origin',productRefs:['public-service'],quantities:[quantity('labor',40),quantity('materials',60),{...quantity('total',100),kind:'calculation',operation:'sum',inputIds:['labor','materials']}]})
 const summary=page({id:'summary',productRefs:['public-service','community-service'],table:{columns:['首年支出'],rows:[['100 CNY/年']]}})
 const before=JSON.stringify([origin,summary])
 expect(inspectReportQuantities([origin,summary],[source])).toEqual([]);expect(JSON.stringify([origin,summary])).toBe(before)
 expect(inspectReportQuantities([origin,{...summary,productRefs:['unrelated','another']}],[source]).some(f=>f.pageId==='summary')).toBe(true)
 const invalid={...origin,quantities:origin.quantities!.map(q=>q.id==='materials'?{...q,value:61}:q)}
 expect(inspectReportQuantities([invalid,summary],[source]).some(f=>f.pageId==='summary')).toBe(true)
 expect(inspectReportQuantities([origin,{...summary,table:{columns:['首年支出'],rows:[['101 CNY/年']]}}],[source]).some(f=>f.pageId==='summary')).toBe(true)
})
it('derives calculation provenance from verified inputs without inventing a separate factual source',()=>{
 const total={...quantity('total',24),kind:'calculation' as const,operation:'product' as const,inputIds:['a','b'],sourceRefs:[]}
 const p=page({quantities:[quantity('a',12),quantity('b',2),total]})
 expect(inspectReportQuantities([p],[source])).toEqual([])
 for(const change of [{value:25},{inputIds:['total','b']},{sourceRefs:['missing']},{inputIds:['unknown','b']}]){
  expect(inspectReportQuantities([page({quantities:[quantity('a',12),quantity('b',2),{...total,...change}]})],[source]).some(f=>f.code==='CALCULATION_INVALID')).toBe(true)
 }
 expect(inspectReportQuantities([page({quantities:[{...quantity('a',12),sourceRefs:[]},quantity('b',2),total]})],[source]).some(f=>f.code==='CALCULATION_INVALID')).toBe(true)
})
it('treats grouped numbers as whole values in text and financial tables',()=>{
 const p=page({body:['年度费用2,000元'],table:{columns:['费用'],rows:[['2,000 CNY/年'],['1，200 CNY/年']]},quantities:[quantity('public',2000),quantity('community',1200)]})
 expect(inspectReportQuantities([p],[source])).toEqual([])
})
it('binds a quoted statistic to the cited source lineage, never an unrelated source',()=>{
 const cited={...source,moduleLineage:{sources:[{source:{quote:'2023年旅游收入22.7亿元'}}]}} as unknown as PlanningManuscriptSource
 const p=page({body:['2023年旅游收入22.7亿元'],quantities:[{...quantity('income',22.7),kind:'source',unit:'亿元'}]})
 expect(inspectReportQuantities([p],[cited])).toEqual([])
 expect(inspectReportQuantities([p],[source,{...cited,id:'unrelated'}]).some(f=>f.code==='CALCULATION_INVALID')).toBe(true)
})
it('reports exact unbound values and table locations, without silently permitting rounding',()=>{
 const p=page({table:{columns:['坡度'],rows:[['5.8°']]}})
 const findings=inspectReportQuantities([p],[{...source,text:'坡度5.76°'}])
 expect(findings).toHaveLength(1);expect(findings[0]!.message).toContain('5.8');expect(findings[0]!.message).toContain('table.rows[0][0]')
})
it('still rejects wrong arithmetic even when formatted prose matches the declared result',()=>{
 const p=page({table:{columns:['费用'],rows:[['2,000元']]},quantities:[quantity('a',40),quantity('b',40),{...quantity('total',2000),kind:'calculation',operation:'product',inputIds:['a','b']}]})
 expect(inspectReportQuantities([p],[source]).some(f=>f.code==='CALCULATION_INVALID')).toBe(true)
})
it('recomputes explicit same-unit table subtotals without requiring duplicate quantity declarations',()=>{
 const p=page({table:{columns:['费用','公式','金额'],rows:[['其他费用','6,000+6,000+4,800+18,000','34,800'],['合计','72,000+34,800','106,800']]},
  quantities:[quantity('materials',6000),quantity('maintenance',6000),quantity('insurance',4800),quantity('coordination',18000),quantity('labor',72000)]})
 const before=JSON.stringify(p)
 expect(inspectReportQuantities([p],[source])).toEqual([])
 expect(JSON.stringify(p)).toBe(before)
})
it.each(['incorrect','unknown','mixed-units','no-formula','code'])('does not infer unsupported table totals: %s',kind=>{
 let table={columns:['公式','金额'],rows:[['10+20','30']]},quantities=[quantity('a',10),quantity('b',20)]
 if(kind==='incorrect'){table.rows[0]=['10+20','31'];quantities.push(quantity('unrelated-amount',31))}
 if(kind==='unknown')quantities=[quantity('a',10)]
 if(kind==='mixed-units')quantities=[quantity('a',10),{...quantity('b',20),unit:'人'}]
 if(kind==='no-formula')table={columns:['金额'],rows:[['30']]}
 if(kind==='code')table.rows[0]=['10+20;process.exit()','30']
 const p=page({table,quantities})
 expect(inspectReportQuantities([p],[source]).length).toBeGreaterThan(0)
})
