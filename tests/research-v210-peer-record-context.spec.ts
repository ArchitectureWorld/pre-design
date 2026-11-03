import {expect,it} from 'vitest'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {moduleAuthorGroupSourceContext} from '../src/research-v2/module-group-source-context.ts'
import {moduleGroupWorkPlan} from '../src/research-v2/module-group-work-plan.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {createHash} from 'node:crypto'
const api=groups as any,base={documents:[],limitations:[]},corpus={...base,fingerprint:createHash('sha256').update(JSON.stringify(base)).digest('hex')}
const oldVersion=groups.MODULE_AUTHOR_GROUP_VERSION
function submission(group:any,prior:any[],version='module-author-field-group.v14'):any {
  const records=prior[0]?.outputs.peer_supply.records??Array.from({length:8},(_,i)=>({recordId:'peer-'+i,resultClass:'observation_summary'}))
  return {projectionVersion:version,groupId:group.groupId,outputs:{peer_supply:{type:getModuleFieldContracts('3.04').ports.peer_supply.type,quality:'limited',scope:'Synthetic original scope',asOf:'2026-10-03',limitations:['Synthetic only'],
    records:records.filter((r:any)=>!group.recordIds||group.recordIds.includes(r.recordId)).map((r:any)=>({recordId:r.recordId,resultClass:r.resultClass,...Object.fromEntries(group.fields.map((field:string)=>[field,{value:null,claimClass:'missing',limitations:['Synthetic unavailable']}]))}))}},
    evidence:[],limitations:['Synthetic only'],stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Synthetic scope check',fieldRefs:[],limitations:['No real source']}]))}
}
function anchor(){return [submission(groups.getModuleAuthorFieldGroups('3.04',oldVersion)[0],[],oldVersion)]}
function sources(){return {corpus:{documents:[{path:'frozen.txt',text:'Exact original source',contentHash:'frozen-source'}]},sourceValues:[{sourceId:'original',path:'frozen.txt',quote:'Exact original source'}],inputRefs:[{moduleId:'preplan.research.03.01',resultHash:'original-market'}],
  upstream:[{itemId:'3.01',moduleId:'preplan.research.03.01',outputs:{market_context:{type:'market-context',scope:'Frozen historical scope',asOf:'2020-01-01',quality:'limited',limitations:['Historical statistics do not prove current peer demand.'],
    records:[{recordId:'stat-1',resultClass:'observation_summary',indicator:{value:'GDP',claimClass:'source_conclusion',limitations:['Repeated draft only. '.repeat(4000)]},demand:{value:null,claimClass:'missing',limitations:['No current survey.']}}]}},
    claims:[{claimId:'stat',selector:'/outputs/market_context/records/0/indicator/value',value:'GDP',claimClass:'source_conclusion',provenance:{quote:'Exact original source'},limitations:['Historical statistic.']}],limitations:['No current peer demand evidence.']} ]}}
it('resumes the accepted v8 identity group without changing its hash and bounds every later peer task to two fields and two records',()=>{
  const prior=anchor(),before=hash(prior),plan=groups.getModuleAuthorExecutionFieldGroups('3.04',prior)
  expect(api.getModuleAuthorExecutionGroupVersion('3.04',prior)).toBe('module-author-field-group.v14')
  expect(groups.isCurrentModuleAuthorPrefix('3.04',prior)).toBe(true)
  expect(plan).toHaveLength(29);expect(plan[1]).toEqual({groupId:'peer_supply:2.1.1',port:'peer_supply',fields:['address','projectType'],recordIds:['peer-0','peer-1']})
  expect(plan.slice(1).every(group=>group.fields.length<=2&&group.recordIds?.length===2)).toBe(true)
  expect(hash(prior)).toBe(before)
  expect(()=>groups.getModuleAuthorFieldGroups('3.05',api.PEER_RECORD_GROUP_VERSION)).toThrow('MODULE_GROUP_VERSION')
})
it('requires only assigned peer records and shows their exact previous values with the unchanged native receipt hash',()=>{
  const prior=anchor(),group=groups.getModuleAuthorExecutionFieldGroups('3.04',prior)[1]
  const schema:any=groups.getModuleAuthorGroupSchema('3.04',group.groupId,prior,api.getModuleAuthorExecutionGroupVersion('3.04',prior))
  expect(schema.properties.outputs.properties.peer_supply.properties.records.items.properties.recordId.enum).toEqual(['peer-0','peer-1'])
  expect(()=>groups.getModuleAuthorGroupOutputSchemaPrompt('3.04',group.groupId,prior)).not.toThrow()
  expect(groups.getModuleAuthorGroupOutputSchemaPrompt('3.04',group.groupId,prior)).toContain('peer-1')
  const prompt:any=expandModuleReferencePromptView(groups.getModuleAuthorFormulaGroupPromptView('3.04',group.groupId,prior))
  expect(prompt.outputs.peer_supply.records.map((r:any)=>r.recordId)).toEqual(['peer-0','peer-1'])
  expect(prompt.groupReceipts[0].projectionHash).toBe(hash(prior[0]))
  expect(prompt.previousGroupScope.assignedRecordIds).toEqual(['peer-0','peer-1'])
  expect(groups.validateModuleAuthorGroup('3.04',submission(group,prior),prior,corpus)).toEqual(submission(group,prior))
  const foreign=submission(group,prior);foreign.outputs.peer_supply.records[0].recordId='peer-7'
  expect(()=>groups.validateModuleAuthorGroup('3.04',foreign,prior,corpus)).toThrow(/MODULE_GROUP_/)
})
it('compiles and replays every original peer field and rejects omitted parts, changed receipts and fabricated sources',()=>{
  const prior=anchor(),before=hash(prior),raws=[...prior],plan=groups.getModuleAuthorExecutionFieldGroups('3.04',prior)
  for(const group of plan.slice(1)){const raw=submission(group,prior);expect(groups.validateModuleAuthorGroup('3.04',raw,raws,corpus)).toEqual(raw);raws.push(raw)}
  const candidate=groups.compileModuleAuthorGroups('3.04',raws,corpus),audit=groups.createModuleAuthorGroupsAudit('3.04',raws.map((raw,i)=>({raw,receipt:{executionId:'synthetic-e'+i,childId:'synthetic-c'+i,actualModel:{provider:'test',model:'test'},stopReason:'completed' as const}})),candidate)
  expect(audit.version).toBe('module-author-field-group.v14');expect(groups.replayModuleAuthorGroups('3.04',corpus,audit)).toEqual(candidate)
  expect((candidate.outputs.peer_supply as any).records).toHaveLength(8)
  expect(()=>groups.compileModuleAuthorGroups('3.04',raws.filter(raw=>raw.groupId!=='peer_supply:2.1.3'),corpus)).toThrow(/MODULE_GROUP_/)
  const changed:any=structuredClone(audit);changed.groups[0].raw.outputs.peer_supply.records[0].formalName.value='Changed historical author'
  expect(()=>groups.replayModuleAuthorGroups('3.04',corpus,changed)).toThrow(/MODULE_GROUP_/)
  const invented=submission(plan[1],prior);invented.outputs.peer_supply.records[0].address={value:'Invented address',claimClass:'source_conclusion',limitations:['Synthetic only']}
  invented.evidence=[{target:{port:'peer_supply',recordId:'peer-0',field:'address',at:''},kind:'source',source:{path:'missing.txt',quote:'Invented address'}}]
  expect(()=>groups.validateModuleAuthorGroup('3.04',invented,prior,corpus)).toThrow('MODULE_PROJECTION_SOURCE_LOCATION')
  expect(hash(prior)).toBe(before)
}, 15_000) // Full eight-peer field compilation and tamper replay take 6-7s on Linux.
it('replays existing v8 peer plans and preserves an already accepted unsplit second group',()=>{
  const oldPlan=groups.getModuleAuthorFieldGroups('3.04',oldVersion),raws:any[]=[]
  for(const group of oldPlan)raws.push(submission(group,raws,oldVersion))
  expect(groups.getModuleAuthorExecutionFieldGroups('3.04',raws)).toEqual(oldPlan)
  expect(groups.getModuleAuthorExecutionFieldGroups('3.04',raws.slice(0,2))).toEqual(oldPlan)
  expect(groups.isCurrentModuleAuthorPrefix('3.04',raws.slice(0,2))).toBe(true)
  const candidate=groups.compileModuleAuthorGroups('3.04',raws,corpus),audit=groups.createModuleAuthorGroupsAudit('3.04',raws.map((raw,i)=>({raw,receipt:{executionId:'old-e'+i,childId:'old-c'+i,actualModel:{provider:'test',model:'test'},stopReason:'completed' as const}})),candidate)
  expect(groups.replayModuleAuthorGroups('3.04',corpus,audit)).toEqual(candidate)
})
it('scopes direct peer facts to frozen original sources and forbids unprovided upstream claims without mutating full validation inputs',()=>{
  const full=sources(),before=structuredClone(full),identity=hash(full)
  for(const fields of [['address','projectType'],['status','statusDate'],['scale','scaleBasis']]){
    const scoped:any=moduleAuthorGroupSourceContext('3.04',fields,full)
    expect(scoped.upstream[0]).not.toHaveProperty('claims');expect(scoped.upstream[0]).not.toHaveProperty('outputs')
    expect(scoped.upstream[0].outputInventory.market_context.records[0].fieldClasses.demand).toBe('missing')
    expect(scoped.groupSourceScope).toMatchObject({fullSourceContextHash:identity,upstreamClaimsAvailable:false,peerOriginalFieldOnly:true})
    expect(scoped.groupSourceScope.reason).toContain('不得引用未提供的上游claim')
    for(const key of ['corpus','sourceValues','inputRefs'])expect(scoped[key]).toEqual(before[key as keyof typeof before])
  }
  expect(full).toEqual(before);expect(hash(full)).toBe(identity)
})
it('retains complete upstream claims and restrictions for peer demand and coverage while removing only duplicated outputs',()=>{
  const full=sources(),before=structuredClone(full)
  for(const fields of [['servedNeeds','relationship'],['discoveryQueries','coverage']]){
    const scoped:any=moduleAuthorGroupSourceContext('3.04',fields,full)
    expect(scoped.upstream[0]).not.toHaveProperty('outputs')
    expect(scoped.upstream[0].claims).toEqual(before.upstream[0].claims);expect(scoped.upstream[0].limitations).toEqual(before.upstream[0].limitations)
    expect(scoped.groupSourceScope.upstreamClaimsAvailable).toBe(true)
    expect(JSON.stringify(scoped).length).toBeLessThan(JSON.stringify(full).length/4)
  }
  expect(full).toEqual(before)
  const incomplete={upstream:[{itemId:'3.01',moduleId:'preplan.research.03.01',outputs:{unavailable:true},limitations:['Unverified']}]}
  expect(moduleAuthorGroupSourceContext('3.04',['servedNeeds','relationship'],incomplete)).toBe(incomplete)
})
it('gives each peer step only its actual responsibility and preserves the full group for final verification',()=>{
  const plan=groups.getModuleAuthorExecutionFieldGroups('3.04',anchor()),basic=moduleGroupWorkPlan('3.04',plan[1],plan)
  expect(basic.stepCoverage.map(step=>step.assignedFields)).toEqual([['projectType'],['address','projectType'],['address'],['address','projectType']])
  const related=moduleGroupWorkPlan('3.04',plan.find(group=>group.fields.includes('relationship'))!,plan)
  expect(related.stepCoverage.map(step=>step.assignedFields)).toEqual([['servedNeeds','relationship'],['servedNeeds'],['relationship'],['servedNeeds','relationship']])
  expect(basic.completionAuthority).toBe('merged-candidate-and-independent-review');expect(basic).not.toHaveProperty('outputs')
})
