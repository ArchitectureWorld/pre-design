import {expect,it} from 'vitest'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {createHash} from 'node:crypto'

const api=groups as any
const corpusBase={documents:[],limitations:[]},corpus={...corpusBase,fingerprint:createHash('sha256').update(JSON.stringify(corpusBase)).digest('hex')}
function prefix(count=10):any[]{
  return groups.getModuleAuthorFieldGroups('3.01').slice(0,5).map(group=>({projectionVersion:groups.getModuleAuthorGroupVersion('3.01'),groupId:group.groupId,
    outputs:{market_context:{type:getModuleFieldContracts('3.01').ports.market_context.type,quality:'limited',scope:'Synthetic only',asOf:'2026-10-03',limitations:['No real source'],
      records:Array.from({length:count},(_,index)=>({recordId:'r'+index,resultClass:'observation_summary',...Object.fromEntries(group.fields.map(field=>[field,{value:null,claimClass:'missing',limitations:['No real source']}]))}))}},
    evidence:[],limitations:['No real source'],stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Synthetic field check',fieldRefs:[],limitations:['No real source']}]))}))
}
function part(group:any, prior:any[]):any {
  const frozen=prior[0].outputs.market_context
  return {projectionVersion:groups.getModuleAuthorExecutionGroupVersion('3.01',prior),groupId:group.groupId,
    outputs:{market_context:{...frozen,records:frozen.records.filter((r:any)=>group.recordIds?.includes(r.recordId)??true).map((r:any)=>({recordId:r.recordId,resultClass:r.resultClass,...Object.fromEntries(group.fields.map((f:string)=>[f,{value:null,claimClass:'missing',limitations:['Synthetic unavailable']}]))}))}},
    evidence:[],limitations:['Synthetic unavailable'],stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Synthetic field check',fieldRefs:[],limitations:['No real source']}]))}
}
it('bounds formula native tasks to two original records and preserves the five immutable predecessor groups',()=>{
  const prior=prefix(),before=hash(prior),plan=api.getModuleAuthorExecutionFieldGroups('3.01',prior)
  expect(plan.slice(0,5).map((g:any)=>g.groupId)).toEqual(prior.map(g=>g.groupId))
  const formulas=plan.filter((g:any)=>g.fields.includes('formula'))
  expect(formulas).toHaveLength(5)
  expect(formulas.flatMap((g:any)=>g.recordIds)).toEqual(prior[0].outputs.market_context.records.map((r:any)=>r.recordId))
  expect(formulas.every((g:any)=>g.recordIds.length<=2)).toBe(true)
  expect(hash(prior)).toBe(before)
})
it('freezes only the exact record subset in each closed native schema and keeps historical v10 plans unchanged',()=>{
  const prior=prefix(5),plan=api.getModuleAuthorExecutionFieldGroups('3.01',prior),first=plan[5]
  const schema=groups.getModuleAuthorGroupSchema('3.01',first.groupId,prior,api.MARKET_FORMULA_RECORD_GROUP_VERSION)
  const records:any=schema.properties?.outputs?.properties?.market_context?.properties?.records
  expect(records.items.properties.recordId.enum).toEqual(['r0','r1'])
  expect(records.description).toContain('2条')
  expect(schema.properties?.outputs?.additionalProperties).toBe(false)
  expect(groups.getModuleAuthorFieldGroups('3.01',groups.MARKET_FORMULA_GROUP_VERSION)).toHaveLength(8)
  expect(plan.filter((g:any)=>g.fields.includes('formula')).map((g:any)=>g.recordIds.length)).toEqual([2,2,1])
})
it('merges every authored formula record exactly once and rejects missing, extra or reclassified subset records',()=>{
  const prior=prefix(),plan=api.getModuleAuthorExecutionFieldGroups('3.01',prior),raw=part(plan[5],prior),before=hash(prior)
  const merged=groups.getModuleAuthorGroupPromptContext('3.01',[...prior,raw]).outputs.market_context.records
  expect(merged.filter(r=>Object.hasOwn(r,'formula')).map(r=>r.recordId)).toEqual(['r0','r1'])
  expect(groups.isCurrentModuleAuthorPrefix('3.01',[...prior,raw])).toBe(true)
  const missing=structuredClone(raw);missing.outputs.market_context.records.pop()
  expect(()=>groups.getModuleAuthorGroupPromptContext('3.01',[...prior,missing])).toThrow(/MODULE_GROUP_ANCHOR/)
  const extra=structuredClone(raw);extra.outputs.market_context.records.push({...raw.outputs.market_context.records[0],recordId:'r2'})
  expect(()=>groups.getModuleAuthorGroupPromptContext('3.01',[...prior,extra])).toThrow(/MODULE_GROUP_(ANCHOR|SCHEMA|OUTPUT_SCHEMA)/)
  const altered=structuredClone(raw);altered.outputs.market_context.records[0].resultClass='proposal'
  expect(()=>groups.getModuleAuthorGroupPromptContext('3.01',[...prior,altered])).toThrow(/MODULE_GROUP_(ANCHOR|SCHEMA|OUTPUT_SCHEMA)/)
  expect(hash(prior)).toBe(before)
})
it('preserves all ten final identities while sequentially copying only native fields across five formula parts',()=>{
  const prior=prefix(),before=hash(prior),raws=[...prior],plan=api.getModuleAuthorExecutionFieldGroups('3.01',prior)
  for(const group of plan.slice(5))raws.push(part(group,prior))
  const merged=groups.getModuleAuthorGroupPromptContext('3.01',raws).outputs.market_context.records
  expect(merged.map(r=>r.recordId)).toEqual(prior[0].outputs.market_context.records.map((r:any)=>r.recordId))
  expect(merged.every(r=>Object.hasOwn(r,'formula')&&Object.hasOwn(r,'policyVision')&&Object.hasOwn(r,'projectImpactHypothesis'))).toBe(true)
  expect(hash(prior)).toBe(before)
})
it('validates partial record fields without filling the other eight and keeps the final complete audit strict',()=>{
  const prior=prefix(),before=hash(prior),raws=[...prior],plan=api.getModuleAuthorExecutionFieldGroups('3.01',prior)
  for(const group of plan.slice(5)){
    const raw=part(group,prior)
    expect(groups.validateModuleAuthorGroup('3.01',raw,raws,corpus)).toEqual(raw)
    raws.push(raw)
  }
  const candidate=groups.compileModuleAuthorGroups('3.01',raws,corpus)
  const audit=groups.createModuleAuthorGroupsAudit('3.01',raws.map((raw,index)=>({raw,receipt:{executionId:'fixture-e'+index,childId:'fixture-c'+index,actualModel:{provider:'test',model:'test'},stopReason:'completed' as const}})),candidate)
  expect(audit.version).toBe(groups.getModuleAuthorExecutionGroupVersion('3.01',prior))
  expect(audit.groups).toHaveLength(16)
  expect(groups.replayModuleAuthorGroups('3.01',corpus,audit)).toEqual(candidate)
  const missing=raws.filter(raw=>raw.groupId!=='market_context:3.2.2.5')
  expect(()=>groups.compileModuleAuthorGroups('3.01',missing,corpus)).toThrow()
  const tampered=structuredClone(audit);tampered.groups[5].raw.outputs!.market_context.records[0].formula={value:null,claimClass:'missing',limitations:['changed']}
  expect(()=>groups.replayModuleAuthorGroups('3.01',corpus,tampered)).toThrow()
  expect(hash(prior)).toBe(before)
})
it('rejects an unsupported source formula in a record part under the unchanged original source gate',()=>{
  const prior=prefix(),raw=part(api.getModuleAuthorExecutionFieldGroups('3.01',prior)[5],prior),text='fixture source'
  const sourceBase={documents:[{path:'source.txt',text,byteLength:Buffer.byteLength(text),contentHash:createHash('sha256').update(text).digest('hex')}],limitations:[]}
  const sourceCorpus={...sourceBase,fingerprint:createHash('sha256').update(JSON.stringify(sourceBase)).digest('hex')}
  raw.outputs.market_context.records[0].formula={value:'invented method',claimClass:'source_conclusion',limitations:['Synthetic source boundary']}
  const target={port:'market_context',recordId:'r0',field:'formula',at:''}
  raw.evidence=[{target,kind:'source',source:{path:'source.txt',quote:text}}]
  raw.stepResults.step1.fieldRefs=[target]
  expect(()=>groups.validateModuleAuthorGroup('3.01',raw,prior,sourceCorpus)).toThrow(/MODULE_SOURCE_VALUE_(TEXT|QUOTE)/)
})
it('scopes the prompt to its exact two original records without changing receipts, values or restrictions',()=>{
  const prior=prefix(),before=hash(prior),plan=api.getModuleAuthorExecutionFieldGroups('3.01',prior)
  const value:any=expandModuleReferencePromptView(groups.getModuleAuthorFormulaGroupPromptView('3.01',plan[5].groupId,prior))
  expect(value.outputs.market_context.records).toEqual(groups.getModuleAuthorGroupPromptContext('3.01',prior).outputs.market_context.records.slice(0,2))
  expect(value.groupReceipts).toEqual(groups.getModuleAuthorGroupPromptContext('3.01',prior).groupReceipts)
  expect(value.previousGroupScope.assignedRecordIds).toEqual(['r0','r1'])
  expect(value.limitations).toEqual(groups.getModuleAuthorGroupPromptContext('3.01',prior).limitations)
  expect(hash(prior)).toBe(before)
})
it('checks cross-record references against immutable merged fields without accepting nonexistent operands',()=>{
  const prior=prefix(),text='统计期2025',sourceBase={documents:[{path:'period.txt',text,byteLength:Buffer.byteLength(text),contentHash:createHash('sha256').update(text).digest('hex')}],limitations:[]}
  const sourceCorpus={...sourceBase,fingerprint:createHash('sha256').update(JSON.stringify(sourceBase)).digest('hex')}
  const periodTarget={port:'market_context',recordId:'r8',field:'period',at:''}
  prior[0].outputs.market_context.records[8].period={value:'2025',claimClass:'source_conclusion',limitations:['Synthetic fixture only']}
  prior[0].evidence=[{target:periodTarget,kind:'source',source:{path:'period.txt',quote:'2025'}}]
  prior[0].stepResults.step1.fieldRefs=[periodTarget]
  const raw=part(api.getModuleAuthorExecutionFieldGroups('3.01',prior)[5],prior),target={port:'market_context',recordId:'r0',field:'formula',at:''}
  raw.outputs.market_context.records[0].formula={value:'以同一期资料核对研究方法，尚未完成数值复算',claimClass:'agent_inference',limitations:['Synthetic method only']}
  raw.evidence=[{target,kind:'inference',inputRefs:[{local:periodTarget}],rationale:'Synthetic method dependency only'}]
  raw.stepResults.step1.fieldRefs=[target]
  expect(groups.validateModuleAuthorGroup('3.01',raw,prior,sourceCorpus)).toEqual(raw)
  const invalid=structuredClone(raw);invalid.evidence[0].inputRefs[0].local.recordId='nonexistent'
  expect(()=>groups.validateModuleAuthorGroup('3.01',invalid,prior,sourceCorpus)).toThrow(/MODULE_PROJECTION_REFERENCE/)
})
