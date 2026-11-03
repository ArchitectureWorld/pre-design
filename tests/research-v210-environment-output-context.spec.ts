import {it,expect} from 'vitest'
import {moduleAuthorGroupSourceContext} from '../src/research-v2/module-group-source-context.ts'
import {getModuleAuthorGroupSchema,getModuleAuthorGroupOutputSchemaPrompt,getModuleAuthorExecutionFieldGroups} from '../src/research-v2/module-author-groups.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'
import {moduleReferencePromptView,expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'

const plans=[
  {groupId:'environment:1',port:'environment',fields:['objectId','indicator','layerType','resolution']},
  {groupId:'environment:2',port:'environment',fields:['elevation','slope','collectedDate','stationPosition']},
  {groupId:'environment:3',port:'environment',fields:['observationPeriod','measuredValue','protectionStatus','protectionSource']},
  {groupId:'environment:4',port:'environment',fields:['sensitiveObjects','precision','activityImpact','verificationTasks']},
]
function input(){
  const restriction='Study boundary is provisional; it is not a survey, ownership or environmental measurement.'
  return {corpus:{documents:[{path:'original.txt',text:'Exact environmental source.'}]},sourceValues:[{sourceId:'source-1'}],
    inputRefs:[{moduleId:'preplan.research.01.02',resultHash:'original-hash'}],images:{sources:[{path:'original.jpg',contentHash:'image-hash'}]},
    upstream:[{itemId:'1.02',moduleId:'preplan.research.01.02',outputs:{boundaries:{type:'boundary',quality:'limited',scope:'Provisional',asOf:'2026-09-26',limitations:[restriction],
      records:[{recordId:'boundary',resultClass:'inference',boundaryId:{value:'study-id',claimClass:'decision',claimRefs:['id'],limitations:[restriction.repeat(1000)]},
        area:{value:null,claimClass:'missing',claimRefs:[],limitations:['Not surveyed.']}}]}},
      claims:[{claimId:'id',selector:'/outputs/boundaries/records/0/boundaryId/value',kind:'proposal',value:'study-id',rationale:'Study metadata only.',limitations:[restriction]}],limitations:[restriction,'/outputs/boundaries/records/0/area: Not surveyed.']}],
  }
}
it('bounds duplicated upstream context for all environmental groups while retaining exact source data and restrictions',()=>{
  const sources=input(),before=structuredClone(sources),identity=sha256CanonicalJson(sources)
  for(const group of plans){
    const scoped:any=moduleAuthorGroupSourceContext('1.05',group.fields,sources)
    expect(scoped.upstream[0]).not.toHaveProperty('outputs')
    expect(scoped.upstream[0].claims).toEqual(before.upstream[0].claims)
    expect(scoped.upstream[0].limitations).toEqual(before.upstream[0].limitations)
    expect(scoped.upstream[0].outputInventory.boundaries.records).toEqual([{recordId:'boundary',resultClass:'inference',fieldClasses:{boundaryId:'decision',area:'missing'}}])
    for(const key of ['corpus','sourceValues','inputRefs','images'] as const)expect(scoped[key]).toEqual(before[key])
    expect(scoped.groupSourceScope).toMatchObject({fullSourceContextHash:identity,upstreamClaimsAvailable:true,omitted:['upstream.outputs']})
    expect(expandModuleReferencePromptView(moduleReferencePromptView(scoped))).toEqual(scoped)
    expect(JSON.stringify(scoped).length).toBeLessThan(JSON.stringify(sources).length/2)
  }
  expect(sources).toEqual(before)
})
it('retains the complete input when an environmental upstream claim registry or business inventory is unavailable',()=>{
  for(const key of ['claims','limitations','outputs'] as const){
    const sources:any=input();delete sources.upstream[0][key]
    expect(moduleAuthorGroupSourceContext('1.05',['objectId'],sources)).toBe(sources)
  }
})
it('omits only the repeated environmental schema text while retaining every professional field in the native tool',()=>{
  const currentPlans=[...plans.slice(0,3),
    {groupId:'environment:4.1',port:'environment',fields:['sensitiveObjects','precision','activityImpact']},
    {groupId:'environment:4.2',port:'environment',fields:['verificationTasks']},
  ]
  expect(getModuleAuthorExecutionFieldGroups('1.05')).toEqual(currentPlans)
  for(const group of currentPlans){
    const schema:any=getModuleAuthorGroupSchema('1.05',group.groupId,[])
    expect(schema.properties.outputs.required).toEqual(['environment'])
    expect(schema.properties.outputs.properties.environment.properties.records.items.required).toEqual(['recordId','resultClass',...group.fields])
    const prompt=getModuleAuthorGroupOutputSchemaPrompt('1.05',group.groupId,[])
    expect(prompt.length).toBeLessThan(1000)
    expect(prompt).not.toContain(JSON.stringify(schema.properties.outputs))
  }
})
