import {describe,expect,it} from 'vitest'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {moduleFieldProtocolDiagnostic} from '../src/research-v2/module-field-protocol-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'

const error='MODULE_PROJECTION_OUTPUT_INVALID: peer_supply.records.0.relationship.claimRefs: Too small: expected array to have >=1 items'
const groupId='peer_supply:2.2.2'
const rejected=()=>({groupId,outputs:{peer_supply:{records:['synthetic-03','synthetic-04'].map(recordId=>({recordId,
 relationship:{value:'direct',claimClass:'agent_inference',limitations:['Synthetic classification, not a source quotation']},
 servedNeeds:{value:['Synthetic supplied need'],claimClass:'source_conclusion',limitations:[]}}))}},
 evidence:['synthetic-03','synthetic-04'].map(recordId=>({target:{port:'peer_supply',recordId,field:'servedNeeds',at:'/0'},kind:'source',
 source:{path:'synthetic-source',quote:'Synthetic supplied need'}}))})

describe('non-null field evidence feedback preserves the rejected native draft',()=>{
 it('locates every uncovered non-null field without exposing or adding business values',()=>{
  const raw=rejected(),before=hash(raw),diagnostic=moduleFieldProtocolDiagnostic(error,raw)
  expect(diagnostic).toMatchObject({scope:'non-null-field-evidence-coverage-only',originalSubmissionHash:before,completeSubmission:false,
   fieldEvidenceCoverageGaps:['synthetic-03','synthetic-04'].map(recordId=>({target:{port:'peer_supply',recordId,field:'relationship',at:''},
    valueType:'string',claimClass:'agent_inference',valueHash:hash('direct'),evidenceCount:0}))})
  expect(JSON.stringify(diagnostic)).not.toContain('Synthetic supplied need')
  expect(hash(raw)).toBe(before)
 })
 it('does not use another record or field evidence to cover the rejected field',()=>{
  const raw=rejected();raw.evidence.push({target:{port:'peer_supply',recordId:'unrelated',field:'relationship',at:''},kind:'source',source:{path:'synthetic-source',quote:'unrelated'}})
  expect(moduleFieldProtocolDiagnostic(error,raw)).toMatchObject({fieldEvidenceCoverageGaps:[{target:{recordId:'synthetic-03'}},{target:{recordId:'synthetic-04'}}]})
 })
 it('does not report valid missing/null fields as needing manufactured evidence',()=>{
  const raw=rejected();for(const row of raw.outputs.peer_supply.records) Object.assign(row.relationship,{value:null,claimClass:'missing'})
  expect(moduleFieldProtocolDiagnostic(error,raw)).toBeUndefined()
 })
 it('keeps unsupported null with a non-missing class out of this narrow diagnostic',()=>{
  const raw=rejected();for(const row of raw.outputs.peer_supply.records) Object.assign(row.relationship,{value:null})
  expect(moduleFieldProtocolDiagnostic(error,raw)).toBeUndefined()
 })
 it('does not reinterpret unrelated output errors as evidence coverage errors',()=>{
  expect(moduleFieldProtocolDiagnostic('MODULE_PROJECTION_OUTPUT_INVALID: peer_supply.scope: Required',rejected())).toBeUndefined()
 })
 it('is bounded when many uncovered records exceed the diagnostic transport budget',()=>{
  const raw=rejected();raw.outputs.peer_supply.records=Array.from({length:500},(_,index)=>({...raw.outputs.peer_supply.records[0],recordId:'synthetic-record-'+index}))
  expect(moduleFieldProtocolDiagnostic(error,raw)).toBeUndefined()
 })
 it('delivers hash-bound coverage feedback through the existing checkpoint recovery entry',()=>{
  const raw=rejected(),audit={reviewReceipts:[],attempts:[{classId:'text',groupId,status:'failed',structuredOutput:raw,error}]}
  const before=hash(audit),feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit},groupId)
  const diagnostic=JSON.parse(feedback.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
  expect(diagnostic).toMatchObject({originalSubmissionHash:hash(raw),fieldEvidenceCoverageGaps:[{target:{recordId:'synthetic-03'}},{target:{recordId:'synthetic-04'}}]})
  expect(feedback).toContain('claimRefs由编译器')
  expect(feedback).toContain('inference')
  expect(hash(audit)).toBe(before)
 })
 it('restores decision evidence responsibility after an empty output-limit failure without rewriting the rejected working metadata',()=>{
  const currentGroup='boundaries:1',port='boundaries'
  const raw={outputs:{[port]:{records:['synthetic-r','synthetic-i','synthetic-f'].map(recordId=>({recordId,
   boundaryId:{value:recordId,claimClass:'decision',limitations:['Synthetic working identifier only']},
   scopeKind:{value:'synthetic-scope',claimClass:'decision',limitations:['Synthetic choice, no statutory geometry']},
   geometry:{value:null,claimClass:'missing',limitations:['No measured geometry']}}))}},evidence:[]}
  const rejectedError='MODULE_PROJECTION_OUTPUT_INVALID: boundaries.records.0.boundaryId.claimRefs: Too small: expected array to have >=1 items'
  const audit={reviewReceipts:[],attempts:[
   {classId:'text',groupId:currentGroup,status:'failed',error:rejectedError,structuredOutput:raw},
   {classId:'text',groupId:currentGroup,status:'failed',error:'MODULE_NATIVE_max-tokens'}]}
  const before=hash(audit),feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit},currentGroup)
  const previous=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(previous.diagnosticExcerpt).toMatchObject({scope:'non-null-field-evidence-coverage-only',originalSubmissionHash:hash(raw)})
  expect(previous.diagnosticExcerpt.fieldEvidenceCoverageGaps).toHaveLength(6)
  expect(previous.authorErrors).toContain('MODULE_NATIVE_max-tokens')
  expect(feedback).toContain('非空decision字段')
  expect(feedback).toContain('decision+proposal')
  expect(feedback).toContain('不能把未核事实改标')
  expect(feedback).not.toContain('Synthetic working identifier only')
  expect(hash(audit)).toBe(before)
 })
})
