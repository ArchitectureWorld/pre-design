import {describe,expect,it} from 'vitest'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {validateModuleProjectionFields} from '../src/research-v2/module-author-projection.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {getModuleAuthorGroupSchema,getModuleAuthorGroupOutputsSchema,getModuleAuthorGroupOutputSchemaPrompt} from '../src/research-v2/module-author-groups.ts'

const groupId='market_context:3.2.2.1',target={port:'market_context',recordId:'synthetic-record',field:'formula',at:''}
const base={documents:[],limitations:['Synthetic protocol test; no real statistics']},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
function draft(at='',includeSource=false){
 return {groupId,outputs:{market_context:{type:getModuleFieldContracts('3.01').ports.market_context.type,quality:'limited',scope:'Synthetic test only',asOf:'2026-10-03',limitations:base.limitations,
  records:[{recordId:target.recordId,resultClass:'observation_summary',formula:{value:'A + B',claimClass:'agent_inference',limitations:base.limitations}}]}},
 evidence:[{target:{...target,at},kind:'calculation',calculation:{operation:'sum',operands:[{sourceId:'absent-a'},{sourceId:'absent-b'}]},
  ...(includeSource?{source:{path:'unavailable-test-source',quote:'Never use this test quote as evidence'}}:{})}]}
}
function feedback(raw:ReturnType<typeof draft>,error:string){
 const audit={reviewReceipts:[],attempts:[{classId:'text',groupId,status:'failed',structuredOutput:raw,error},
  {classId:'text',groupId,status:'failed',error:'MODULE_NATIVE_error',submissionState:'not-submitted'}]},before=hash(audit)
 const text=moduleRecoveryFeedback({resumeExecutionAudit:audit,corpus},groupId)
 expect(hash(audit)).toBe(before)
 return {text,excerpt:JSON.parse(text.split('\n').at(-1)!).previousRejection.diagnosticExcerpt,audit}
}
describe('same-draft protocol diagnostics preserve finite native correction attempts',()=>{
 it('reports pointer and evidence-member conflicts together before either correction is consumed',()=>{
  const raw=draft('/value',true),before=hash(raw),{excerpt}=feedback(raw,'MODULE_GROUP_POINTER: scalar field pointer does not resolve')
  expect(excerpt).toMatchObject({scope:'field-protocol-conflicts-only',completeSubmission:false,originalSubmissionHash:before})
  expect(excerpt.fieldPointerConflicts).toHaveLength(1)
  expect(excerpt.fieldPointerConflicts[0]).toContain('"at":"/value"')
  expect(excerpt.fieldEvidenceKindConflicts).toEqual([expect.objectContaining({evidenceIndex:0,target:{...target,at:'/value'},kind:'calculation'})])
  expect(JSON.stringify(excerpt)).not.toContain('Never use this test quote')
  expect(hash(raw)).toBe(before)
 })
 it('reports calculation-result and member conflicts from the same rejected draft',()=>{
  const raw=draft('',true),{excerpt}=feedback(raw,'MODULE_PROJECTION_EVIDENCE_KIND: source must be absent')
  expect(excerpt).toMatchObject({scope:'field-protocol-conflicts-only',originalSubmissionHash:hash(raw)})
  expect(excerpt.fieldEvidenceKindConflicts).toHaveLength(1)
  expect(excerpt.fieldCalculationConflicts).toEqual([expect.objectContaining({target,valueType:'string',rawValueHash:hash('A + B'),operation:'sum'})])
  expect(()=>validateModuleProjectionFields('3.01',raw as any,{market_context:['formula']},corpus)).toThrow('MODULE_PROJECTION_EVIDENCE_KIND')
 })
 it('keeps a failed local calculation rejection actionable after a later empty native attempt',()=>{
  const raw=draft(),{excerpt,text,audit}=feedback(raw,'MODULE_CALCULATION_REQUIRED: formula text is not a numeric result')
  expect(excerpt).toMatchObject({scope:'calculation-result-types-only',completeSubmission:false,originalSubmissionHash:hash(raw)})
  expect(excerpt.fieldCalculationConflicts).toEqual([expect.objectContaining({evidenceIndex:0,target,valueType:'string',rawValueHash:hash('A + B')})])
  expect(text).toContain('finite numeric result')
  expect(JSON.stringify(excerpt)).not.toContain('A + B')
  expect(()=>validateModuleProjectionFields('3.01',raw as any,{market_context:['formula']},corpus)).toThrow('MODULE_CALCULATION_REQUIRED')
  expect(moduleRecoveryFeedback({resumeExecutionAudit:audit,corpus},'market_context:4.1')).not.toContain('fieldCalculationConflicts')
 })
})
describe('market field prompt budgets retain the actual native contract',()=>{
 const anchors:any[]=[{projectionVersion:'module-author-field-group.v13',groupId:'market_context:1',outputs:{market_context:{type:getModuleFieldContracts('3.01').ports.market_context.type,
  quality:'limited',scope:'Synthetic frozen scope',asOf:'2026-10-03',limitations:base.limitations,records:Array.from({length:10},(_,i)=>({recordId:'r'+i,resultClass:'observation_summary',
   indicatorId:{value:null,claimClass:'missing',limitations:base.limitations},region:{value:null,claimClass:'missing',limitations:base.limitations},
   period:{value:null,claimClass:'missing',limitations:base.limitations},indicator:{value:null,claimClass:'missing',limitations:base.limitations}}))}},evidence:[],limitations:base.limitations}]
 for(const id of ['market_context:2.2','market_context:3.1','market_context:3.2.1','market_context:4.1'])it('omits only redundant prose schema for '+id,()=>{
  const before=hash(anchors),schema=getModuleAuthorGroupSchema('3.01',id,anchors),outputs=getModuleAuthorGroupOutputsSchema('3.01',id,anchors)
  const guidance=getModuleAuthorGroupOutputSchemaPrompt('3.01',id,anchors)
  expect(guidance).toContain('structured_output')
  expect(guidance).not.toContain('"properties"')
  expect(guidance.length).toBeLessThan(JSON.stringify(outputs).length/2)
  expect(schema.properties?.outputs?.additionalProperties).toBe(false)
  expect(schema.properties?.outputs?.properties?.market_context?.properties?.records?.items?.additionalProperties).toBe(false)
  expect(getModuleAuthorGroupSchema('3.01',id,anchors)).toEqual(schema)
  expect(hash(anchors)).toBe(before)
 })
})
