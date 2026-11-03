import {describe,expect,it} from 'vitest'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {moduleFieldProtocolDiagnostic} from '../src/research-v2/module-field-protocol-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'

const groupId='market_context:3.2.2.3'
const target={port:'market_context',recordId:'synthetic-income',field:'formula',at:''}
const dependency={...target,field:'denominator'}
const prior={groupId:'market_context:3.2.1',outputs:{market_context:{records:[{recordId:target.recordId,
 denominator:{value:null,claimClass:'missing',limitations:['Synthetic missing denominator; no actual statistics']}}]}},evidence:[]}
const rejected=(includeSource=true)=>({groupId,outputs:{market_context:{records:[{recordId:target.recordId,
 formula:{value:'Synthetic method requiring an unavailable dependency',claimClass:'agent_inference',limitations:['Not an executed calculation']}}]}},
 evidence:[{target,kind:'inference',rationale:'Synthetic protocol fixture only',inputRefs:[{local:dependency}],
 ...(includeSource?{source:{path:'absent-test-source',quote:'Never copy this test quote into diagnostic guidance'}}:{})}]})
const error='MODULE_PROJECTION_REFERENCE: referenced field is missing and has no claim'

describe('prior native fields remain visible to rejected-reference diagnostics',()=>{
 it.each([error,'MODULE_PROJECTION_EVIDENCE_KIND: source must be absent'])('reports the same draft member and prior-field conflicts for %s',message=>{
  const raw=rejected(),before=hash([prior,raw])
  const diagnostic=moduleFieldProtocolDiagnostic(message,raw,[prior])
  expect(diagnostic).toMatchObject({scope:'field-protocol-conflicts-only',completeSubmission:false,originalSubmissionHash:hash(raw)})
  expect(diagnostic?.fieldLocalReferenceConflicts).toMatchObject([{evidenceIndex:0,target,refPath:'inputRefs/0',referencedTarget:dependency,
   referencedFieldClaimClass:'missing',reason:'field-missing',registeredEvidenceTargets:[]}])
  expect(diagnostic?.fieldEvidenceKindConflicts).toHaveLength(1)
  expect(JSON.stringify(diagnostic)).not.toContain('Never copy this test quote')
  expect(JSON.stringify(diagnostic)).not.toContain(raw.outputs.market_context.records[0].formula.value)
  expect(hash([prior,raw])).toBe(before)
 })
 it('does not treat an unknown future field as missing or manufacture available addresses',()=>{
  const raw=rejected(),before=hash(raw),diagnostic=moduleFieldProtocolDiagnostic('MODULE_PROJECTION_EVIDENCE_KIND: source must be absent',raw)
  expect(diagnostic).toMatchObject({scope:'evidence-kind-member-conflicts-only',originalSubmissionHash:before})
  expect(diagnostic).not.toHaveProperty('fieldLocalReferenceConflicts')
  expect(hash(raw)).toBe(before)
 })
 it.each([true,false])('cold recovery diagnoses only the latest structured rejection after an empty attempt, source=%s',includeSource=>{
  const old=rejected(),raw=rejected(includeSource),audit={reviewReceipts:[],attempts:[
   {classId:'text',groupId:prior.groupId,status:'completed',structuredOutput:prior},
   {classId:'text',groupId,status:'failed',structuredOutput:old,error},
   {classId:'text',groupId,status:'failed',structuredOutput:raw,error},
   {classId:'text',groupId,status:'failed',error:'MODULE_NATIVE_error',submissionState:'not-submitted'}]}
  const before=hash(audit),text=moduleRecoveryFeedback({resumeExecutionAudit:audit},groupId)
  const diagnostic=JSON.parse(text.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
  expect(diagnostic).toMatchObject({scope:includeSource?'field-protocol-conflicts-only':'local-reference-address-conflicts-only',
   completeSubmission:false,originalSubmissionHash:hash(raw),fieldLocalReferenceConflicts:[{target,referencedTarget:dependency,reason:'field-missing'}]})
  if(includeSource)expect(diagnostic.fieldEvidenceKindConflicts).toHaveLength(1)
  else expect(diagnostic).not.toHaveProperty('fieldEvidenceKindConflicts')
  expect(text).toContain('field-missing表示依赖缺失')
  expect(hash(audit)).toBe(before)
 })
})
