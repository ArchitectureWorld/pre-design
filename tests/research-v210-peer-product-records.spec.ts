import {describe,it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {moduleAuthorGroupSourceContext} from '../src/research-v2/module-group-source-context.ts'
import {moduleGroupWorkPlan} from '../src/research-v2/module-group-work-plan.ts'
import {expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
const base={documents:[],limitations:[]},corpus={...base,fingerprint:createHash('sha256').update(JSON.stringify(base)).digest('hex')},api=groups as any
function raw(group:any,prior:any[]=[],version='module-author-field-group.v16'):any {
 const records=prior[0]?.outputs.peer_products.records??Array.from({length:8},(_,i)=>({recordId:'product-'+i,resultClass:'observation_summary'}))
 return {projectionVersion:version,groupId:group.groupId,outputs:{peer_products:{type:'planning.peer_products.v1.2',quality:'limited',scope:'Synthetic product study',asOf:'2026-10-04',limitations:['Synthetic only; no product prices or operations verified'],records:records.filter((r:any)=>!group.recordIds||group.recordIds.includes(r.recordId)).map((r:any)=>({recordId:r.recordId,resultClass:r.resultClass,...Object.fromEntries(group.fields.map((f:string)=>[f,{value:null,claimClass:'missing',limitations:['No available evidence']}]))}))}},evidence:[],limitations:['Synthetic only'],stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Synthetic current-field check',fieldRefs:[],limitations:['Unverified product fields remain missing']}]))}
}
const receipts=(raws:any[])=>raws.map((draft,i)=>({raw:draft,receipt:{executionId:'synthetic-e-'+i,childId:'synthetic-c-'+i,actualModel:{provider:'test',model:'test'},stopReason:'completed' as const}}))
describe('bounded product authors retain peer identity, complete prices and historical receipts',()=>{
 it('freezes peer/product identity first, then limits tasks to two fields and two original records',()=>{
  const initial=groups.getModuleAuthorExecutionFieldGroups('3.05');expect(initial[0].groupId).toBe('peer_products:1.1');expect(initial[0].fields).toEqual(['peerId','productId'])
  const anchor=raw(initial[0]),before=hash(anchor),plan=groups.getModuleAuthorExecutionFieldGroups('3.05',[anchor]);expect(plan).toHaveLength(33)
  for(const group of plan.slice(1)){expect(group.fields.length).toBeLessThanOrEqual(2);expect(group.recordIds?.length).toBeLessThanOrEqual(2)}
  const draft=raw(plan[1],[anchor]);expect(groups.validateModuleAuthorGroup('3.05',draft,[anchor],corpus)).toEqual(draft)
  draft.outputs.peer_products.records[0].recordId='product-7';expect(()=>groups.validateModuleAuthorGroup('3.05',draft,[anchor],corpus)).toThrow(/MODULE_GROUP_/);expect(hash(anchor)).toBe(before)
 })
 it('merges every field and replays the immutable original audit without inventing price, scale or operating status',()=>{
  const raws=[raw(groups.getModuleAuthorExecutionFieldGroups('3.05')[0])],plan=groups.getModuleAuthorExecutionFieldGroups('3.05',raws)
  for(const group of plan.slice(1)){const draft=raw(group,raws);groups.validateModuleAuthorGroup('3.05',draft,raws,corpus);raws.push(draft)}
  const candidate=groups.compileModuleAuthorGroups('3.05',raws,corpus),audit=groups.createModuleAuthorGroupsAudit('3.05',receipts(raws),candidate);expect(groups.replayModuleAuthorGroups('3.05',corpus,audit)).toEqual(candidate)
  const records=(candidate.outputs.peer_products as any).records;expect(records).toHaveLength(8)
  for(const record of records){expect(Object.keys(record).sort()).toEqual(['recordId','resultClass',...getModuleFieldContracts('3.05').ports.peer_products.fields.map(f=>f.name)].sort());for(const field of ['price','scale','status'])expect(record[field]).toMatchObject({value:null,claimClass:'missing'})}
  expect(()=>groups.compileModuleAuthorGroups('3.05',raws.slice(0,-1),corpus)).toThrow(/MODULE_GROUP_/)
  const changed:any=structuredClone(audit);changed.groups[1].raw.outputs.peer_products.records[0].recordId='product-6';expect(()=>groups.replayModuleAuthorGroups('3.05',corpus,changed)).toThrow(/MODULE_GROUP_/)
 // This validates 33 complete groups and repeats immutable replay, not a
 // five-second performance contract. Leave headroom for shared Windows hosts.
 },15_000)
 it('preserves an already accepted v8 anchor while splitting its remaining fields, and keeps complete or longer v8 histories exact',()=>{
  const old=groups.getModuleAuthorFieldGroups('3.05',groups.MODULE_AUTHOR_GROUP_VERSION),anchor=raw(old[0],[],groups.MODULE_AUTHOR_GROUP_VERSION),before=hash(anchor)
  expect(old).toHaveLength(5);const migrated=groups.getModuleAuthorExecutionFieldGroups('3.05',[anchor]);expect(migrated[0]).toEqual(old[0]);expect(migrated).toHaveLength(29)
  const mixed=[anchor];for(const group of migrated.slice(1)){const draft=raw(group,mixed);groups.validateModuleAuthorGroup('3.05',draft,mixed,corpus);mixed.push(draft)}
  expect(groups.isCurrentModuleAuthorPrefix('3.05',mixed)).toBe(true);const compiled=groups.compileModuleAuthorGroups('3.05',mixed,corpus),audit=groups.createModuleAuthorGroupsAudit('3.05',receipts(mixed),compiled);expect(groups.replayModuleAuthorGroups('3.05',corpus,audit)).toEqual(compiled);expect(hash(anchor)).toBe(before)
  const history:any[]=[];for(const group of old)history.push(raw(group,history,groups.MODULE_AUTHOR_GROUP_VERSION));expect(groups.getModuleAuthorExecutionFieldGroups('3.05',history.slice(0,2))).toEqual(old);expect(groups.getModuleAuthorExecutionFieldGroups('3.05',history)).toEqual(old)
  const oldCandidate=groups.compileModuleAuthorGroups('3.05',history,corpus);expect(groups.replayModuleAuthorGroups('3.05',corpus,groups.createModuleAuthorGroupsAudit('3.05',receipts(history),oldCandidate))).toEqual(oldCandidate)
 })
 it('removes duplicated upstream drafts while retaining every original claim, limitation and source binding',()=>{
  const source={corpus:{documents:[{path:'original.txt',text:'Frozen product source'}]},sourceValues:[{sourceId:'original',rawValue:'Frozen product source'}],inputRefs:[{moduleId:'peer-study',resultHash:'peer-result'}],upstream:[{itemId:'3.04',moduleId:'module-3.04',claims:[{claimId:'peer',value:'Original peer observation'}],limitations:['Original operational status remains unverified'],outputs:{published:{type:'synthetic',quality:'limited',scope:'Frozen scope',asOf:'2026-01-01',limitations:['Original port restriction'],records:[{recordId:'source-peer',resultClass:'observation_summary',status:{value:null,claimClass:'missing',limitations:['No operating evidence. '.repeat(2000)]}}]}}}]},before=structuredClone(source),identity=hash(source),scoped:any=moduleAuthorGroupSourceContext('3.05',['peerId','productId'],source)
  expect(scoped.upstream[0]).not.toHaveProperty('outputs');expect(scoped.upstream[0].claims).toEqual(before.upstream[0].claims);expect(scoped.upstream[0].limitations).toEqual(before.upstream[0].limitations);expect(scoped.upstream[0].outputInventory.published.records[0].fieldClasses.status).toBe('missing')
  for(const key of ['corpus','sourceValues','inputRefs'])expect(scoped[key]).toEqual(before[key as keyof typeof before]);expect(scoped.groupSourceScope.fullSourceContextHash).toBe(identity);expect(JSON.stringify(scoped).length).toBeLessThan(JSON.stringify(source).length/2);expect(source).toEqual(before)
  const malformed:any=structuredClone(source);malformed.upstream[0].outputs={unavailable:true};expect(moduleAuthorGroupSourceContext('3.05',['peerId'],malformed)).toBe(malformed)
 })
 it('sends only the assigned prior records and assigns source, classification, comparison and handoff responsibilities explicitly',()=>{
  const anchor=raw(groups.getModuleAuthorExecutionFieldGroups('3.05')[0]),before=hash(anchor),plan=groups.getModuleAuthorExecutionFieldGroups('3.05',[anchor]),group=plan[1],view:any=expandModuleReferencePromptView(groups.getModuleAuthorFormulaGroupPromptView('3.05',group.groupId,[anchor]))
  expect(view.outputs.peer_products.records.map((r:any)=>r.recordId)).toEqual(['product-0','product-1']);expect(hash(anchor)).toBe(before)
  const work=moduleGroupWorkPlan('3.05',plan[0],plan);expect(work.stepCoverage.map(r=>r.assignedFields)).toEqual([['peerId','productId'],['productId'],[],['peerId','productId']]);expect(work.completionAuthority).toBe('merged-candidate-and-independent-review')
  expect(()=>api.getModuleAuthorFieldGroups('3.04','module-author-field-group.v16')).toThrow(/MODULE_GROUP_VERSION/)
 })
})
