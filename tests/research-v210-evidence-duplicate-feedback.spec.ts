import {it,expect} from 'vitest'
import {moduleFieldProtocolDiagnostic} from '../src/research-v2/module-field-protocol-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const target={port:'planning_conditions',recordId:'PC-01',field:'projectImpact',at:''}
const evidence=(at='',quote='Synthetic source excerpt')=>({target:{...target,at},kind:'source',source:{path:'fixture.pdf',page:1,quote}})
const draft=()=>({projectionVersion:'module-author-field-group.v18',groupId:'planning_conditions:5.1',outputs:{},evidence:[evidence(),evidence('','Second source excerpt')],limitations:['Synthetic rejected draft only']})
const error='MODULE_GROUP_EVIDENCE_DUPLICATE: target='+JSON.stringify(target)

it('identifies every repeated exact leaf and binds all original evidence entries without deleting them',()=>{
 const raw=draft(),before=structuredClone(raw),diagnostic=moduleFieldProtocolDiagnostic(error,raw,[],'1.03')
 expect(diagnostic).toMatchObject({scope:'field-evidence-target-duplicates-only',completeSubmission:false,originalSubmissionHash:hash(raw),
  fieldEvidenceDuplicateConflicts:[{target,repeatCount:2,evidenceIndexes:[0,1],kinds:['source','source'],entryHashes:raw.evidence.map(hash)}]})
 expect(raw).toEqual(before)
})

it('keeps the repeated-target diagnosis and uniqueness instructions across empty transport responses',()=>{
 const raw=draft(),audit={attempts:[{classId:'text',status:'failed',groupId:raw.groupId,error,structuredOutput:raw},
  {classId:'text',status:'failed',groupId:raw.groupId,error:'MODULE_NATIVE_error'},
  {classId:'text',status:'failed',groupId:raw.groupId,error:'Module model call timed out'}],reviewReceipts:[]},before=structuredClone(audit)
 const feedback=moduleRecoveryFeedback({module:{id:'1.03'},resumeExecutionAudit:audit,resumeExecutionError:'Module model call timed out'} as any,raw.groupId)
 const previous=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
 expect(previous.authorErrors.some((row:string)=>row.includes(error))).toBe(true)
 expect(previous.diagnosticExcerpt.fieldEvidenceDuplicateConflicts).toHaveLength(1)
 expect(feedback).toContain('同一个精确target只能有一条evidence')
 expect(feedback).toContain('不能由宿主代删、合并或选择证据')
 expect(audit).toEqual(before)
})

it('bounds the diagnosis while preserving every original repeated entry',()=>{
 const raw=draft();raw.evidence=Array.from({length:10},(_,index)=>[evidence('/'+index),evidence('/'+index,'Other excerpt')]).flat()
 const before=structuredClone(raw),diagnostic=moduleFieldProtocolDiagnostic(error,raw,[],'1.03')
 expect(diagnostic?.fieldEvidenceDuplicateConflicts).toHaveLength(8)
 expect(raw).toEqual(before)
})

it('distinguishes different scalar leaves at the same field address',()=>{
 const raw=draft();raw.evidence=[evidence('/0'),evidence('/1')]
 expect(moduleFieldProtocolDiagnostic(error,raw,[],'1.03')).toBeUndefined()
})
