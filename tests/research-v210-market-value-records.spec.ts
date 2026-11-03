import {expect,it} from 'vitest'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {createHash} from 'node:crypto'
const api=groups as any,base={documents:[],limitations:[]},corpus={...base,fingerprint:createHash('sha256').update(JSON.stringify(base)).digest('hex')}
function submission(group:any,prior:any[],version='module-author-field-group.v13'):any {
  const records=prior[0]?.outputs.market_context.records??Array.from({length:10},(_,i)=>({recordId:'r'+i,resultClass:'observation_summary'}))
  return {projectionVersion:version,groupId:group.groupId,outputs:{market_context:{type:getModuleFieldContracts('3.01').ports.market_context.type,quality:'limited',scope:'Synthetic original scope',asOf:'2026-10-03',limitations:['Synthetic only'],
    records:records.filter((r:any)=>!group.recordIds||group.recordIds.includes(r.recordId)).map((r:any)=>({recordId:r.recordId,resultClass:r.resultClass,...Object.fromEntries(group.fields.map((field:string)=>[field,{value:null,claimClass:'missing',limitations:['Synthetic unavailable']}]))}))}},
    evidence:[],limitations:['Synthetic only'],stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Synthetic scope check',fieldRefs:[],limitations:['No real source']}]))}
}
function anchor(){return [submission(groups.getModuleAuthorFieldGroups('3.01',groups.MARKET_POLICY_RECORD_GROUP_VERSION)[0],[],groups.MARKET_POLICY_RECORD_GROUP_VERSION)]}
it('bounds each stalled value task to two frozen records without replacing the original identity receipt',()=>{
  const prior=anchor(),before=hash(prior),plan=groups.getModuleAuthorExecutionFieldGroups('3.01',prior)
  const values=plan.filter(group=>group.fields.includes('originalValue'))
  expect(values.map(group=>group.groupId)).toEqual(['market_context:2.1.1','market_context:2.1.2','market_context:2.1.3','market_context:2.1.4','market_context:2.1.5'])
  expect(values.map(group=>group.recordIds)).toEqual([['r0','r1'],['r2','r3'],['r4','r5'],['r6','r7'],['r8','r9']])
  expect(plan).toHaveLength(20);expect(hash(prior)).toBe(before)
  expect(api.getModuleAuthorExecutionGroupVersion('3.01',prior)).toBe('module-author-field-group.v13')
})
it('requires exactly the assigned numeric records and preserves untouched identity metadata',()=>{
  const prior=anchor(),group=groups.getModuleAuthorExecutionFieldGroups('3.01',prior)[1]
  const schema:any=groups.getModuleAuthorGroupSchema('3.01',group.groupId,prior,api.getModuleAuthorExecutionGroupVersion('3.01',prior))
  expect(schema.properties.outputs.properties.market_context.properties.records.items.properties.recordId.enum).toEqual(['r0','r1'])
  const prompt:any=expandModuleReferencePromptView(groups.getModuleAuthorFormulaGroupPromptView('3.01',group.groupId,prior))
  expect(prompt.outputs.market_context.records.map((record:any)=>record.recordId)).toEqual(['r0','r1'])
  expect(prompt.groupReceipts[0].projectionHash).toBe(hash(prior[0]))
  expect(groups.getModuleAuthorGroupOutputSchemaPrompt('3.01',group.groupId,prior)).toContain('换行')
  const raw=submission(group,prior),before=hash(prior)
  expect(groups.validateModuleAuthorGroup('3.01',raw,prior,corpus)).toEqual(raw)
  const wrong=structuredClone(raw);wrong.outputs.market_context.records[0].recordId='r8'
  expect(()=>groups.validateModuleAuthorGroup('3.01',wrong,prior,corpus)).toThrow(/MODULE_GROUP_/)
  expect(hash(prior)).toBe(before)
})
it('strictly compiles and replays all value parts while rejecting a missing part and unchanged-source fabrication',()=>{
  const prior=anchor(),before=hash(prior),raws=[...prior],plan=groups.getModuleAuthorExecutionFieldGroups('3.01',prior)
  for(const group of plan.slice(1)){const raw=submission(group,prior);expect(groups.validateModuleAuthorGroup('3.01',raw,raws,corpus)).toEqual(raw);raws.push(raw)}
  const candidate=groups.compileModuleAuthorGroups('3.01',raws,corpus)
  const audit=groups.createModuleAuthorGroupsAudit('3.01',raws.map((raw,i)=>({raw,receipt:{executionId:'synthetic-e'+i,childId:'synthetic-c'+i,actualModel:{provider:'test',model:'test'},stopReason:'completed' as const}})),candidate)
  expect(audit.version).toBe('module-author-field-group.v13');expect(groups.replayModuleAuthorGroups('3.01',corpus,audit)).toEqual(candidate)
  expect((candidate.outputs.market_context as any).records).toHaveLength(10)
  expect(()=>groups.compileModuleAuthorGroups('3.01',raws.filter(raw=>raw.groupId!=='market_context:2.1.3'),corpus)).toThrow(/MODULE_GROUP_/)
  const invented=submission(plan[1],prior);invented.outputs.market_context.records[0].originalValue={value:{value:1234,unit:'元',basis:'Synthetic statistic'},claimClass:'source_conclusion',limitations:['Synthetic only']}
  invented.evidence=[{target:{port:'market_context',recordId:'r0',field:'originalValue',at:'/value'},kind:'source',source:{path:'missing.txt',quote:'1234',valueQuote:'1234'}}]
  expect(()=>groups.validateModuleAuthorGroup('3.01',invented,prior,corpus)).toThrow('MODULE_PROJECTION_SOURCE_LOCATION: missing.txt')
  expect(hash(prior)).toBe(before)
})
