import {expect,it} from 'vitest'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'
import {moduleGroupStepDiagnostics,moduleGroupStepEvidenceConflicts} from '../src/research-v2/module-group-step-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'

function rejectedGroup(missing=false){
 const target={port:'peer_products',recordId:'peer-06',field:'coreProduct',at:''}
 const arrayTarget={...target,field:'supportingFormats',at:'/0'}
 const raw={projectionVersion:'module-author-field-group.v16',groupId:'peer_products:2.1.3',
  outputs:{peer_products:{records:[{recordId:'peer-06',
   coreProduct:{value:missing?null:'Original unbound core product',claimClass:missing?'missing':'source_conclusion',limitations:['Original source period is unverified']},
   supportingFormats:{value:missing?null:['Original unbound format'],claimClass:missing?'missing':'source_conclusion',limitations:['No current operation evidence']}}]}},
  evidence:[],limitations:['Original unresolved scope'],stepResults:{
   step1:{summary:'Original unsupported judgment',status:'limited',fieldRefs:[target,arrayTarget],limitations:['Scope unverified']},
   step2:{summary:'Original dependency check',status:'limited',fieldRefs:[arrayTarget],limitations:['No registered evidence']}}}
 return {raw,target,arrayTarget}
}

it('identifies valued fields left without evidence and every stale step path without rewriting the rejected author',()=>{
 const {raw,target,arrayTarget}=rejectedGroup(),before=structuredClone(raw)
 const conflicts=moduleGroupStepEvidenceConflicts(raw)
 expect(conflicts).toMatchObject([
  {target,fieldRefPaths:['/stepResults/step1/fieldRefs/0'],fieldState:{claimClass:'source_conclusion',valueType:'string',valueHash:sha256CanonicalJson('Original unbound core product'),referencedValueExists:true,registeredFieldEvidenceCount:0}},
  {target:arrayTarget,fieldRefPaths:['/stepResults/step1/fieldRefs/1','/stepResults/step2/fieldRefs/0'],fieldState:{claimClass:'source_conclusion',valueType:'array',referencedValueExists:true,registeredFieldEvidenceCount:0}},
 ])
 expect(JSON.stringify(conflicts)).not.toContain('Original unbound')
 expect(moduleGroupStepDiagnostics(raw)).toHaveLength(3)
 expect(raw).toEqual(before)
})

it('distinguishes missing scalar and nonexistent array leaf while keeping missing/null and the rejection intact',()=>{
 const {raw}=rejectedGroup(true),before=structuredClone(raw),conflicts=moduleGroupStepEvidenceConflicts(raw)
 expect(conflicts).toMatchObject([
  {fieldState:{claimClass:'missing',valueType:'null',valueHash:sha256CanonicalJson(null),referencedValueExists:true,registeredFieldEvidenceCount:0}},
  {fieldState:{claimClass:'missing',valueType:'null',referencedValueExists:false,registeredFieldEvidenceCount:0}},
 ])
 expect(moduleGroupStepDiagnostics(raw)).toHaveLength(3)
 expect(raw).toEqual(before)
})

it('resumes with the original rejected hash and field state, requiring a native evidence or missing revision',()=>{
 const {raw}=rejectedGroup(),audit={attempts:[{classId:'text',groupId:raw.groupId,status:'failed',error:'MODULE_GROUP_STEPS: stale unsupported references',structuredOutput:raw}],reviewReceipts:[]}
 const before=structuredClone(audit),feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit},raw.groupId)
 const excerpt=JSON.parse(feedback.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
 expect(excerpt).toMatchObject({scope:'field-protocol-conflicts-only',completeSubmission:false,originalSubmissionHash:sha256CanonicalJson(raw),stepEvidenceConflicts:[{fieldState:{claimClass:'source_conclusion',registeredFieldEvidenceCount:0}},{fieldState:{claimClass:'source_conclusion',registeredFieldEvidenceCount:0}}]})
 expect(excerpt.fieldEvidenceCoverageGaps).toHaveLength(2)
 expect(feedback).toContain('有值字段')
 expect(feedback).toContain('missing/null字段')
 expect(feedback).toContain('不得只删evidence或fieldRefs')
 expect(audit).toEqual(before)
})

function rejectedWholeModule(){
 const target={port:'master_layout',recordId:'shaotanhe-master-layout-study',field:'productIds',at:''}
 const raw={projectionVersion:'module-author-projection-json.v2',outputsJson:JSON.stringify({master_layout:{records:[{
  recordId:target.recordId,productIds:{value:null,claimClass:'missing',limitations:['Product linkage has not been verified']},
 }]}}),evidence:[],steps:[{summary:'Original limited linkage study',status:'limited',fieldRefs:[target],limitations:['Product linkage has not been verified']}]}
 return {raw,target}
}

it('reads a whole-module JSON field state for the original unsupported step address without changing the draft',()=>{
 const {raw,target}=rejectedWholeModule(),before=structuredClone(raw)
 expect(moduleGroupStepEvidenceConflicts(raw)).toMatchObject([{target,fieldRefPaths:['/steps/0/fieldRefs/0'],fieldState:{
  claimClass:'missing',valueType:'null',valueHash:sha256CanonicalJson(null),referencedValueExists:true,registeredFieldEvidenceCount:0,
 }}])
 expect(raw).toEqual(before)
})

it('gives a resumed whole-module author the missing-field step rule for a projection reference rejection',()=>{
 const {raw,target}=rejectedWholeModule(),audit={attempts:[{classId:'text',status:'failed',
  error:'MODULE_PROJECTION_REFERENCE: ["master_layout","shaotanhe-master-layout-study","productIds",""]',structuredOutput:raw}],reviewReceipts:[]}
 const before=structuredClone(audit),feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit})
 const excerpt=JSON.parse(feedback.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
 expect(excerpt).toMatchObject({originalSubmissionHash:sha256CanonicalJson(raw),stepEvidenceConflicts:[{
  target,fieldRefPaths:['/steps/0/fieldRefs/0'],fieldState:{claimClass:'missing',valueType:'null',registeredFieldEvidenceCount:0},
 }]})
 expect(feedback).toContain('missing/null字段不得添加evidence或放入fieldRefs')
 expect(feedback).toContain('不得只删evidence或fieldRefs却保留无依据肯定字段及步骤摘要')
 expect(audit).toEqual(before)
})

it('leaves malformed and duplicate-key whole-module JSON rejected without inventing a field state',()=>{
 for(const outputsJson of ['{"master_layout":', '{"master_layout":{},"master_layout":{}}']){
  const {raw,target}=rejectedWholeModule(),rejected={...raw,outputsJson},before=structuredClone(rejected)
  const conflicts=moduleGroupStepEvidenceConflicts(rejected)
  expect(conflicts).toEqual([{target,fieldRefPaths:['/steps/0/fieldRefs/0']}])
  expect(moduleGroupStepDiagnostics(rejected)).toHaveLength(1)
  expect(rejected).toEqual(before)
 }
})
