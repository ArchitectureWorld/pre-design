import {expect,it} from 'vitest'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {createHash} from 'node:crypto'

const api=groups as any
const corpusBase={documents:[],limitations:[]},corpus={...corpusBase,fingerprint:createHash('sha256').update(JSON.stringify(corpusBase)).digest('hex')}
function submission(group:any,prior:any[],version=groups.MARKET_FORMULA_RECORD_GROUP_VERSION):any {
  const records=prior[0]?.outputs.market_context.records??Array.from({length:10},(_,index)=>({recordId:'r'+index,resultClass:'observation_summary'}))
  return {projectionVersion:version,groupId:group.groupId,outputs:{market_context:{type:getModuleFieldContracts('3.01').ports.market_context.type,quality:'limited',scope:'Synthetic original scope',asOf:'2026-10-03',limitations:['Synthetic only'],
    records:records.filter((r:any)=>!group.recordIds||group.recordIds.includes(r.recordId)).map((r:any)=>({recordId:r.recordId,resultClass:r.resultClass,...Object.fromEntries(group.fields.map((f:string)=>[f,{value:null,claimClass:'missing',limitations:['Synthetic unavailable']}]))}))}},
    evidence:[],limitations:['Synthetic unavailable'],stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Synthetic boundary check',fieldRefs:[],limitations:['No real source']}]))}
}
function prefix(){
  const prior:any[]=[]
  prior.push(submission(groups.getModuleAuthorFieldGroups('3.01',groups.MARKET_FORMULA_RECORD_GROUP_VERSION)[0],prior))
  const historical=groups.getModuleAuthorFieldGroups('3.01',groups.MARKET_FORMULA_RECORD_GROUP_VERSION,prior)
  for(const group of historical.slice(1,-1))prior.push(submission(group,prior))
  return prior
}
it('splits the stalled ten-record policy field into five closed two-record tasks while reusing eleven original v11 hashes',()=>{
  const prior=prefix(),before=hash(prior),plan=groups.getModuleAuthorExecutionFieldGroups('3.01',prior)
  expect(prior).toHaveLength(11)
  expect(plan.slice(0,11).map(g=>g.groupId)).toEqual(prior.map(r=>r.groupId))
  const policy=plan.filter(g=>g.fields.includes('policyVision'))
  expect(policy).toHaveLength(5)
  expect(policy.map(g=>g.groupId)).toEqual([1,2,3,4,5].map(n=>'market_context:4.2.'+n))
  expect(policy.flatMap(g=>g.recordIds!)).toEqual(prior[0].outputs.market_context.records.map((r:any)=>r.recordId))
  expect(groups.getModuleAuthorExecutionGroupVersion('3.01',prior)).toBe('module-author-field-group.v12')
  expect(groups.isCurrentModuleAuthorPrefix('3.01',prior)).toBe(true)
  expect(hash(prior)).toBe(before)
})
it('restricts policy schema and prior prompt fields to the exact original records while retaining all receipt hashes and limits',()=>{
  const prior=prefix(),before=hash(prior),group=groups.getModuleAuthorExecutionFieldGroups('3.01',prior)[11]
  const schema:any=groups.getModuleAuthorGroupSchema('3.01',group.groupId,prior,groups.getModuleAuthorExecutionGroupVersion('3.01',prior))
  expect(schema.properties.outputs.properties.market_context.properties.records.items.properties.recordId.enum).toEqual(['r0','r1'])
  expect(schema.properties.outputs.additionalProperties).toBe(false)
  const view:any=expandModuleReferencePromptView(groups.getModuleAuthorFormulaGroupPromptView('3.01',group.groupId,prior))
  const original=groups.getModuleAuthorGroupPromptContext('3.01',prior)
  expect(view.outputs.market_context.records).toEqual(original.outputs.market_context.records.slice(0,2))
  expect(view.groupReceipts).toEqual(original.groupReceipts)
  expect(view.limitations).toEqual(original.limitations)
  expect(view.previousGroupScope.assignedRecordIds).toEqual(['r0','r1'])
  expect(view.previousGroupScope.boundary).toContain('独审')
  expect(hash(prior)).toBe(before)
})
it('merges and replays all native policy parts strictly without changing the old prefix or filling missing records',()=>{
  const prior=prefix(),before=hash(prior),raws=[...prior],plan=groups.getModuleAuthorExecutionFieldGroups('3.01',prior)
  for(const group of plan.slice(11)){
    const raw=submission(group,prior,groups.getModuleAuthorExecutionGroupVersion('3.01',prior) as any)
    expect(groups.validateModuleAuthorGroup('3.01',raw,raws,corpus)).toEqual(raw)
    raws.push(raw)
  }
  expect(raws).toHaveLength(16)
  const candidate=groups.compileModuleAuthorGroups('3.01',raws,corpus)
  const audit=groups.createModuleAuthorGroupsAudit('3.01',raws.map((raw,index)=>({raw,receipt:{executionId:'synthetic-e'+index,childId:'synthetic-c'+index,actualModel:{provider:'test',model:'test'},stopReason:'completed' as const}})),candidate)
  expect(audit.version).toBe('module-author-field-group.v12')
  expect(groups.replayModuleAuthorGroups('3.01',corpus,audit)).toEqual(candidate)
  expect((candidate.outputs.market_context as any).records.every((r:any)=>r.policyVision.value===null)).toBe(true)
  expect(()=>groups.compileModuleAuthorGroups('3.01',raws.slice(0,-1),corpus)).toThrow(/MODULE_GROUP_SET/)
  const tampered:any=structuredClone(audit);tampered.groups[11].raw.outputs.market_context.records[0].policyVision.limitations=['changed']
  expect(()=>groups.replayModuleAuthorGroups('3.01',corpus,tampered)).toThrow()
  const missing=structuredClone(raws[11]);missing.outputs.market_context.records.pop()
  expect(()=>groups.validateModuleAuthorGroup('3.01',missing,prior,corpus)).toThrow(/MODULE_GROUP_/)
  const altered=structuredClone(raws[11]);altered.outputs.market_context.records[0].resultClass='proposal'
  expect(()=>groups.validateModuleAuthorGroup('3.01',altered,prior,corpus)).toThrow(/MODULE_GROUP_/)
  expect(hash(prior)).toBe(before)
})
it('keeps complete historical v11 submissions available for review without relabelling or redispatching their policy records',()=>{
  const prior=prefix(),plan=groups.getModuleAuthorFieldGroups('3.01',groups.MARKET_FORMULA_RECORD_GROUP_VERSION,prior)
  const all=[...prior,submission(plan.at(-1),prior)],before=hash(all)
  expect(groups.getModuleAuthorExecutionFieldGroups('3.01',all)).toEqual(plan)
  expect(groups.isCurrentModuleAuthorPrefix('3.01',all)).toBe(true)
  expect((groups.compileModuleAuthorGroups('3.01',all,corpus).outputs.market_context as any).records).toHaveLength(10)
  expect(hash(all)).toBe(before)
})
it('rejects a policy source conclusion that the original text does not support under the unchanged source gate',()=>{
  const prior=prefix(),group=groups.getModuleAuthorExecutionFieldGroups('3.01',prior)[11]
  const raw=submission(group,prior,groups.getModuleAuthorExecutionGroupVersion('3.01',prior) as any),text='规划愿景尚未获批。'
  const sourceBase={documents:[{path:'source.txt',text,byteLength:Buffer.byteLength(text),contentHash:createHash('sha256').update(text).digest('hex')}],limitations:[]}
  const sourceCorpus={...sourceBase,fingerprint:createHash('sha256').update(JSON.stringify(sourceBase)).digest('hex')}
  raw.outputs.market_context.records[0].policyVision={value:'当前已批准',claimClass:'source_conclusion',limitations:['Synthetic only']}
  const target={port:'market_context',recordId:'r0',field:'policyVision',at:''}
  raw.evidence=[{target,kind:'source',source:{path:'source.txt',quote:text}}]
  raw.stepResults.step1.fieldRefs=[target]
  expect(()=>groups.validateModuleAuthorGroup('3.01',raw,prior,sourceCorpus)).toThrow(/MODULE_SOURCE_VALUE_(TEXT|QUOTE)/)
})
