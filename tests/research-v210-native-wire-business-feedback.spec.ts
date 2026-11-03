import {describe,it,expect} from 'vitest'
import type {ObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {decodeNativeModuleJsonWire} from '../src/research-v2/native-submission-wire.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const groupId='service_notice_cost:3',fingerprint='same-frozen-sources'
const target={port:'service_notice_cost',recordId:'notice-study',field:'conditions',at:''}
function businessDraft(text='synthetic condition'){
 return {projectionVersion:'module-author-field-group.v8',groupId,outputs:{service_notice_cost:{quality:'limited',records:[{
  recordId:target.recordId,resultClass:'proposal',conditions:{value:[text],claimClass:'decision',limitations:[]},
  calculationBasis:{value:null,claimClass:'missing',limitations:['Synthetic missing cost.']}}]}},evidence:[],limitations:[],stepResults:{}}
}
function attempt(raw:unknown,error:string,extra:Record<string,unknown>={}){
 return {classId:'text',status:'failed',groupId,executionId:'execution-'+hash(raw).slice(0,8),childId:'child-'+hash(raw).slice(0,8),
  sourceContextFingerprint:fingerprint,structuredOutput:raw,structuredHash:hash(raw),error,...extra}
}
const wire=(version:string)=>version==='native-json-submission.v1'
 ?{wireVersion:version,submissionJson:'{"broken":'}
 :{wireVersion:version,fullNativeSchemaHash:'f'.repeat(64),submissionJson:'{}',records:[{port:'service_notice_cost',recordId:'notice-study',recordJson:'{"broken":'}]}
function feedback(attempts:unknown[]){return moduleRecoveryFeedback({module:{id:'7.02'},resumeExecutionAudit:{attempts,reviewReceipts:[]}} as any,groupId)}
function payload(text:string){return JSON.parse(text.split('\n').findLast(line=>line.startsWith('{"previousRejection":'))!).previousRejection}

describe('business rejection survives undecoded native JSON transport',()=>{
 it.each(['native-json-submission.v1','native-frozen-submission.v2'])('keeps the same hash-bound business gaps after a rejected %s envelope',version=>{
  const raw=businessDraft(),first=attempt(raw,'MODULE_PROJECTION_OUTPUT_INVALID: service_notice_cost.records.0.conditions.claimRefs: Too small: expected array to have >=1 items')
  const latest=attempt(wire(version),'MODULE_NATIVE_JSON_WIRE_INVALID: recordJson must be complete JSON'),before=hash([first,latest])
  const result=payload(feedback([first,latest]))
  expect(result.rejectedSubmission?.originalSubmissionHash).toBe(hash(raw))
  expect(result.diagnosticExcerpt?.originalSubmissionHash).toBe(hash(raw))
  expect(result.diagnosticExcerpt?.fieldEvidenceCoverageGaps).toContainEqual(expect.objectContaining({target}))
  expect(result.authorErrors.join('\n')).toContain('MODULE_NATIVE_JSON_WIRE_INVALID')
  expect(hash([first,latest])).toBe(before)
 })
 it('does not carry a business draft across changed sources or a tampered draft hash',()=>{
  const first=attempt(businessDraft(),'MODULE_PROJECTION_OUTPUT_INVALID: conditions.claimRefs: Too small:')
  for(const changed of [{...first,sourceContextFingerprint:'older-sources'},{...first,structuredHash:'0'.repeat(64)}]){
   const result=feedback([changed,attempt(wire('native-frozen-submission.v2'),'MODULE_NATIVE_JSON_WIRE_INVALID: recordJson must be complete JSON')])
   expect(result).not.toContain(hash(first.structuredOutput))
  }
 })
 it('replaces an older business rejection when a newer business draft has actually decoded',()=>{
  const old=businessDraft('old choice'),current=businessDraft('new choice')
  const result=feedback([attempt(old,'MODULE_PROJECTION_OUTPUT_INVALID: conditions.claimRefs: Too small:'),
   attempt(current,'MODULE_PROJECTION_OUTPUT_INVALID: conditions.claimRefs: Too small:')])
  expect(result).not.toContain(hash(old));expect(payload(result).rejectedSubmission.originalSubmissionHash).toBe(hash(current))
 })
 it('drops earlier rejected context after the same group completes',()=>{
  const old=businessDraft(),result=feedback([attempt(old,'MODULE_PROJECTION_OUTPUT_INVALID: conditions.claimRefs: Too small:'),
   attempt(wire('native-frozen-submission.v2'),'MODULE_NATIVE_JSON_WIRE_INVALID: recordJson must be complete JSON'),
   attempt(businessDraft('accepted later choice'),'',{status:'completed'})])
  expect(result).not.toContain(hash(old))
 })
})

function frozenFixture(){
 const record={type:'object' as const,required:['recordId','resultClass'],properties:{recordId:{type:'string' as const,enum:['notice-study']},resultClass:{type:'string' as const}}}
 const port={type:'object' as const,additionalProperties:false,required:['type','scope','asOf','quality','limitations','records'],
  properties:{type:{type:'string' as const,const:'service_notice_cost'},scope:{type:'string' as const,const:'synthetic'},asOf:{type:'string' as const,const:'2026-10-11'},
   quality:{type:'string' as const},limitations:{type:'array' as const,items:{type:'string' as const}},records:{type:'array' as const,items:record}}}
 const schema:ObjectJsonSchema={type:'object',required:['groupId','outputs'],additionalProperties:false,
  properties:{groupId:{type:'string',const:groupId},outputs:{type:'object',required:['service_notice_cost'],properties:{service_notice_cost:port}}}}
 const body={groupId,outputs:{service_notice_cost:{quality:'limited',limitations:[]}}}
 const native={wireVersion:'native-frozen-submission.v2',fullNativeSchemaHash:hash(schema),submissionJson:JSON.stringify(body),
  records:[{port:'service_notice_cost',recordId:'notice-study',recordJson:'{"resultClass":"proposal"}'}]}
 return {schema,body,native}
}
describe('native wire errors locate a format problem without repairing it',()=>{
 it('reports the JSON parser position and selected record while keeping the malformed draft rejected',()=>{
  const {schema,native}=frozenFixture();native.records[0].recordJson='{"resultClass":"bad "quote""}'
  const before=hash(native)
  expect(()=>decodeNativeModuleJsonWire(native,schema)).toThrow(/recordJson.*notice-study.*position \d+/)
  expect(hash(native)).toBe(before)
 })
 it('locates forbidden inner records without removing even an empty duplicate array',()=>{
  const {schema,native,body}=frozenFixture();native.submissionJson=JSON.stringify({...body,outputs:{service_notice_cost:{...body.outputs.service_notice_cost,records:[]}}})
  const before=hash(native)
  expect(()=>decodeNativeModuleJsonWire(native,schema)).toThrow(/records must be explicitly selected.*submissionJson\.outputs\.service_notice_cost\.records/)
  expect(hash(native)).toBe(before)
 })
 it('retains successful original v2 decoding',()=>{
  const {schema,native}=frozenFixture()
  expect((decodeNativeModuleJsonWire(native,schema) as any).outputs.service_notice_cost.records).toEqual([{recordId:'notice-study',resultClass:'proposal'}])
 })
})
