import {describe,it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {moduleAuthorGroupSourceContext} from '../src/research-v2/module-group-source-context.ts'
import {moduleGroupWorkPlan} from '../src/research-v2/module-group-work-plan.ts'
import {expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
const base={documents:[],limitations:[]},corpus={...base,fingerprint:createHash('sha256').update(JSON.stringify(base)).digest('hex')},api=groups as any
function raw(group:any,prior:any[]=[],version='module-author-field-group.v15'):any {
 const records=prior[0]?.outputs.peer_locations.records??Array.from({length:8},(_,i)=>({recordId:'location-'+i,resultClass:'observation_summary'}))
 return {projectionVersion:version,groupId:group.groupId,outputs:{peer_locations:{type:'planning.peer_locations.v1.2',quality:'limited',scope:'Synthetic spatial study',asOf:'2026-10-03',limitations:['Synthetic only; no coordinates or distances'],records:records.filter((r:any)=>!group.recordIds||group.recordIds.includes(r.recordId)).map((r:any)=>({recordId:r.recordId,resultClass:r.resultClass,...Object.fromEntries(group.fields.map((f:string)=>[f,{value:null,claimClass:'missing',limitations:['No available evidence']}]))}))}},evidence:[],limitations:['Synthetic only'],stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Synthetic current-field check',fieldRefs:[],limitations:['Missing measurements remain missing']}]))}
}
const sources=()=>({corpus:{documents:[{path:'original.txt',text:'Frozen peer source'}]},sourceValues:[{sourceId:'original',rawValue:'Frozen peer source'}],inputRefs:[{moduleId:'peer-study',resultHash:'peer-result'}],upstream:['3.04','1.02'].map(itemId=>({itemId,moduleId:'module-'+itemId,claims:[{claimId:'claim-'+itemId,value:'Original conditional peer or boundary evidence'}],limitations:['Original missing-coordinate restriction'],outputs:{published:{type:'synthetic',quality:'limited',scope:'Frozen scope',asOf:'2026-01-01',limitations:['Original port restriction'],records:[{recordId:'source-'+itemId,resultClass:'observation_summary',geometry:{value:null,claimClass:'missing',limitations:['No measured geometry. '.repeat(2000)]}}]}}}))})
describe('bounded peer location authors preserve missing measurements and original receipts',()=>{
 it('starts with shared identity only and binds later two-field tasks to at most two exact original records',()=>{
  const initial=groups.getModuleAuthorExecutionFieldGroups('2.04')
  expect(initial[0].groupId).toBe('peer_locations:1.1');expect(initial[0].fields).toEqual(['peerId','sampleVersion'])
  const anchor=raw(initial[0]),before=hash(anchor),plan=groups.getModuleAuthorExecutionFieldGroups('2.04',[anchor])
  expect(plan).toHaveLength(29)
  for(const group of plan.slice(1)){expect(group.fields.length).toBeLessThanOrEqual(2);expect(group.recordIds?.length).toBeLessThanOrEqual(2)}
  const draft=raw(plan[1],[anchor]);expect(groups.validateModuleAuthorGroup('2.04',draft,[anchor],corpus)).toEqual(draft)
  draft.outputs.peer_locations.records[0].recordId='location-7';expect(()=>groups.validateModuleAuthorGroup('2.04',draft,[anchor],corpus)).toThrow(/MODULE_GROUP_/)
  expect(hash(anchor)).toBe(before)
 })
 it('merges every field of eight original records and replays the native audit without inventing coordinates or distances',()=>{
  const initial=groups.getModuleAuthorExecutionFieldGroups('2.04'),raws=[raw(initial[0])],plan=groups.getModuleAuthorExecutionFieldGroups('2.04',raws)
  for(const group of plan.slice(1)){const draft=raw(group,raws);groups.validateModuleAuthorGroup('2.04',draft,raws,corpus);raws.push(draft)}
  const candidate=groups.compileModuleAuthorGroups('2.04',raws,corpus),audit=groups.createModuleAuthorGroupsAudit('2.04',raws.map((draft,i)=>({raw:draft,receipt:{executionId:'synthetic-e-'+i,childId:'synthetic-c-'+i,actualModel:{provider:'test',model:'test'},stopReason:'completed' as const}})),candidate)
  expect(groups.replayModuleAuthorGroups('2.04',corpus,audit)).toEqual(candidate)
  const records=(candidate.outputs.peer_locations as any).records;expect(records).toHaveLength(8)
  for(const record of records){expect(Object.keys(record).sort()).toEqual(['recordId','resultClass',...getModuleFieldContracts('2.04').ports.peer_locations.fields.map(f=>f.name)].sort());for(const field of ['straightMeters','roadMeters','durationSeconds'])expect(record[field]).toMatchObject({value:null,claimClass:'missing'})}
  expect(()=>groups.compileModuleAuthorGroups('2.04',raws.slice(0,-1),corpus)).toThrow(/MODULE_GROUP_/)
  const changed:any=structuredClone(audit);changed.groups[0].raw.outputs.peer_locations.records[0].peerId.value='rewritten-identity';expect(()=>groups.replayModuleAuthorGroups('2.04',corpus,changed)).toThrow(/MODULE_GROUP_/)
 // Compiles all eight records and replays the full immutable audit; isolated runs exceed five seconds.
 },15_000)
 it('keeps historical four-group v8 receipts replayable and resumes their original plan',()=>{
  const plan=groups.getModuleAuthorFieldGroups('2.04',groups.MODULE_AUTHOR_GROUP_VERSION),raws:any[]=[]
  expect(plan).toHaveLength(4)
  for(const group of plan)raws.push(raw(group,raws,groups.MODULE_AUTHOR_GROUP_VERSION))
  expect(groups.getModuleAuthorExecutionFieldGroups('2.04',raws.slice(0,1))).toEqual(plan);expect(groups.isCurrentModuleAuthorPrefix('2.04',raws.slice(0,1))).toBe(true)
  const candidate=groups.compileModuleAuthorGroups('2.04',raws,corpus),audit=groups.createModuleAuthorGroupsAudit('2.04',raws.map((draft,i)=>({raw:draft,receipt:{executionId:'old-e-'+i,childId:'old-c-'+i,actualModel:{provider:'test',model:'test'},stopReason:'completed' as const}})),candidate)
  expect(groups.replayModuleAuthorGroups('2.04',corpus,audit)).toEqual(candidate)
 })
 it('removes duplicate upstream drafts while preserving exact peer and boundary claims, restrictions and source identities',()=>{
  const full=sources(),before=structuredClone(full),identity=hash(full),scoped:any=moduleAuthorGroupSourceContext('2.04',['peerId','sampleVersion'],full)
  for(let i=0;i<2;i++){expect(scoped.upstream[i]).not.toHaveProperty('outputs');expect(scoped.upstream[i].claims).toEqual(before.upstream[i].claims);expect(scoped.upstream[i].limitations).toEqual(before.upstream[i].limitations);expect(scoped.upstream[i].outputInventory.published.records[0].fieldClasses.geometry).toBe('missing')}
  for(const key of ['corpus','sourceValues','inputRefs'])expect(scoped[key]).toEqual(before[key as keyof typeof before])
  expect(scoped.groupSourceScope.fullSourceContextHash).toBe(identity);expect(JSON.stringify(scoped).length).toBeLessThan(JSON.stringify(full).length/2);expect(full).toEqual(before)
  const malformed:any=sources();malformed.upstream[1].outputs={unavailable:true};expect(moduleAuthorGroupSourceContext('2.04',['peerId'],malformed)).toBe(malformed)
 })
 it('limits prior author context to assigned records without changing full validation inputs or field responsibilities',()=>{
  const anchor=raw(groups.getModuleAuthorExecutionFieldGroups('2.04')[0]),before=hash(anchor),plan=groups.getModuleAuthorExecutionFieldGroups('2.04',[anchor]),group=plan[1],view:any=expandModuleReferencePromptView(groups.getModuleAuthorFormulaGroupPromptView('2.04',group.groupId,[anchor]))
  expect(view.outputs.peer_locations.records.map((r:any)=>r.recordId)).toEqual(['location-0','location-1']);expect(hash(anchor)).toBe(before)
  const work=moduleGroupWorkPlan('2.04',plan[0],plan)
  expect(work.stepCoverage.map(r=>r.assignedFields)).toEqual([['peerId','sampleVersion'],[],[],['peerId','sampleVersion']]);expect(work.completionAuthority).toBe('merged-candidate-and-independent-review')
  expect(()=>api.getModuleAuthorFieldGroups('3.04','module-author-field-group.v15')).toThrow(/MODULE_GROUP_VERSION/)
 })
})
