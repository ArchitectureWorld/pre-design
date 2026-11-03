import {expect,it} from 'vitest'
import {moduleAuthorGroupSourceContext} from '../src/research-v2/module-group-source-context.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'
import {moduleReferencePromptView,expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {getModuleAuthorExecutionGroupVersion,getModuleAuthorGroupSchema} from '../src/research-v2/module-author-groups.ts'

function fixture(){
  return {
    corpus:{documents:[{path:'统计来源.txt',contentHash:'original-statistic-hash',text:'截至2023年底，连片种植面积达到6000余亩。'}]},
    sourceValues:[{sourceId:'original-statistic',path:'统计来源.txt',quote:'截至2023年底，连片种植面积达到6000余亩。',rawValue:'6000余亩'}],
    inputRefs:[{moduleId:'preplan.research.02.01',resultHash:'frozen-regional-result'}],
    upstream:[{itemId:'2.01',moduleId:'preplan.research.02.01',outputs:{regional:{type:'regional',scope:'冻结区域范围',asOf:'2026-09-28',quality:'limited',limitations:['未有可核项目入口坐标，不代表当前需求。'],records:[{recordId:'regional-1',resultClass:'inference',geometry:{value:null,claimClass:'missing'},regionalRole:{value:'条件角色',claimClass:'inference'}}]}},
      claims:[{claimId:'regional-role',value:'依赖场地空间的区域角色判断，不能用于统计原文抽取。'.repeat(1400),limitations:['不能证明当前客户或消费。']}],limitations:['缺场地原始坐标的限制。'.repeat(700)]}]
  }
}

it.each([
  ['indicatorId','region','period','indicator'],
  ['originalValue','normalizedValue'],
  ['priceBasis','revisionStatus'],
])('bounds the original-statistic %j author to exact originals and published restrictions without carrying unrelated regional claim drafts',(...fields)=>{
  const sources=fixture(),before=structuredClone(sources),identity=sha256CanonicalJson(sources)
  const scoped:any=moduleAuthorGroupSourceContext('3.01',fields,sources)
  expect(scoped.groupSourceScope).toMatchObject({fullSourceContextHash:identity,upstreamClaimsAvailable:false,upstreamOutputsInventoryOnly:true,marketOriginalFieldOnly:true,omitted:['upstream.outputs','upstream.claims','upstream.limitations']})
  for(const key of ['corpus','sourceValues','inputRefs'])expect(scoped[key]).toEqual(before[key as keyof typeof before])
  expect(scoped.sourceValues[0].rawValue).toBe('6000余亩')
  expect(scoped.upstream[0].outputInventory.regional).toMatchObject({quality:'limited',scope:'冻结区域范围',limitations:['未有可核项目入口坐标，不代表当前需求。'],records:[{recordId:'regional-1',resultClass:'inference',fieldClasses:{geometry:'missing',regionalRole:'inference'}}]})
  for(const key of ['outputs','claims','limitations'])expect(Object.hasOwn(scoped.upstream[0],key)).toBe(false)
  expect(scoped.groupSourceScope.reason).toContain('不得引用未提供的上游claim')
  expect(JSON.stringify(scoped).length).toBeLessThan(JSON.stringify(sources).length/5)
  expect(expandModuleReferencePromptView(moduleReferencePromptView(scoped))).toEqual(scoped)
  expect(sources).toEqual(before);expect(sha256CanonicalJson(sources)).toBe(identity)
  expect(getModuleAuthorExecutionGroupVersion('3.01')).toBe('module-author-field-group.v13')
  const schema:any=getModuleAuthorGroupSchema('3.01','market_context:1')
  expect(schema.properties.outputs.properties.market_context.properties.records.items.required).toEqual(['recordId','resultClass','indicatorId','region','period','indicator'])
})

it('keeps claims available for fields that need cross-module interpretation or values and does not broaden the new scope',()=>{
  const sources=fixture()
  for(const fields of [['projectImpactHypothesis'],['policyVision'],['originalValue'],['priceBasis'],['priceBasis','revisionStatus','projectImpactHypothesis'],['originalValue','normalizedValue','projectImpactHypothesis'],['indicatorId','region','period','indicator','projectImpactHypothesis'],['indicatorId','region','period','period']]){
    const scoped:any=moduleAuthorGroupSourceContext('3.01',fields,sources)
    expect(scoped.groupSourceScope.upstreamClaimsAvailable).toBe(true)
    expect(scoped.upstream[0].claims).toEqual(sources.upstream[0].claims)
    expect(scoped.upstream[0].limitations).toEqual(sources.upstream[0].limitations)
  }
  expect(moduleAuthorGroupSourceContext('3.04',['indicatorId','region','period','indicator'],sources)).toBe(sources)
})
