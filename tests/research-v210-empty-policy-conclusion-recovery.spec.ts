import {expect,it} from 'vitest'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const error='MODULE_EMPTY_PROFESSIONAL_CONCLUSION: apply the module fallback with a concrete limited conclusion, never an all-null form'
function attempt(groupId:string,fields:Record<string,unknown>,recordId='unconfirmed-project'){
 const record={recordId,resultClass:'analysis_judgment',...Object.fromEntries(Object.entries(fields).map(([field,value])=>[field,{value,claimClass:value===null?'missing':'source',limitations:[]}]))}
 const structuredOutput={groupId,outputs:{planning_conditions:{records:[record]}},evidence:[]}
 return {classId:'text',status:'completed',groupId,executionId:groupId+'-execution',childId:groupId+'-child',structuredOutput,structuredHash:hash(structuredOutput)}
}
function context(attempts:any[],moduleError=error){return {module:{id:'1.03'},resumeExecutionError:moduleError,resumeExecutionAudit:{attempts,reviewReceipts:[]}} as any}
function diagnostic(c:any,groupId='planning_conditions:1'){
 const text=moduleRecoveryFeedback(c,groupId)
 return JSON.parse(text.split('\n').at(-1)!).previousRejection.emptyConclusionDiagnostic
}

it('returns the original empty record selection and group owners to fresh authors without supplying values',()=>{
 const a=attempt('planning_conditions:1',{documentId:null,documentNumber:null,issuer:null,publishedDate:null})
 const b=attempt('planning_conditions:5.1',{projectImpact:null,response:null})
 const c=context([a,b]),before=hash(c),d=diagnostic(c)
 expect(d).toMatchObject({itemId:'1.03',diagnosticOnly:true,completeSubmission:false,allObservedProfessionalValuesNull:true,
  originalAuditHash:hash(c.resumeExecutionAudit),firstRecordSelection:{groupId:a.groupId,executionId:a.executionId,childId:a.childId,originalSubmissionHash:a.structuredHash,recordIds:['unconfirmed-project']}})
 expect(d.missingFields.map((f:any)=>f.field)).toEqual(['documentNumber','issuer','publishedDate','projectImpact','response'])
 expect(d.missingFields.every((f:any)=>f.originalSubmissionHash===(f.groupId===a.groupId?a.structuredHash:b.structuredHash))).toBe(true)
 expect(d.missingFields.some((f:any)=>'value' in f||'suggestedValue' in f)).toBe(false)
 expect(hash(c)).toBe(before)
})

it('binds the same full empty candidate to the assigned later group',()=>{
 const c=context([attempt('planning_conditions:1',{issuer:null}),attempt('planning_conditions:5.1',{response:null})])
 expect(diagnostic(c,'planning_conditions:5.1')).toEqual(diagnostic(c))
 const changed=structuredClone(c);changed.resumeExecutionAudit.attempts[0].structuredHash='incorrect'
 expect(diagnostic(changed)).toBeUndefined()
})

it('does not diagnose a source-supported document issuer as an all-empty candidate',()=>{
 const c=context([attempt('planning_conditions:1',{documentId:'working-document',issuer:'Example original issuer'})])
 expect(diagnostic(c)).toBeUndefined()
 expect(diagnostic(context(c.resumeExecutionAudit.attempts,'MODULE_SOURCE_VALUE_QUOTE: unrelated rejection'))).toBeUndefined()
})

it('excludes failed superseded submissions from the empty completed-group readback',()=>{
 const rejected={...attempt('planning_conditions:1',{issuer:'Rejected issuer'}),status:'failed'}
 const accepted=attempt('planning_conditions:1',{issuer:null})
 const d=diagnostic(context([rejected,accepted]))
 expect(d).toBeDefined();expect(d.groupCount).toBe(1)
 expect(d.firstRecordSelection.originalSubmissionHash).toBe(accepted.structuredHash)
 expect(d.missingFields).toHaveLength(1)
})

it('bounds address output while binding the complete original audit and explicit omissions',()=>{
 const a=attempt('planning_conditions:1',{issuer:null})
 a.structuredOutput.outputs.planning_conditions.records=Array.from({length:60},(_,i)=>({...a.structuredOutput.outputs.planning_conditions.records[0],recordId:'record-'+i}))
 a.structuredHash=hash(a.structuredOutput)
 const c=context([a]),d=diagnostic(c)
 expect(d).toBeDefined();expect(d.missingFieldCount).toBe(60)
 expect(d.missingFields.length).toBeLessThan(60);expect(d.omittedMissingFields).toBe(60-d.missingFields.length)
 expect(d.originalAuditHash).toBe(hash(c.resumeExecutionAudit))
})
