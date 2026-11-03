import {expect,it} from 'vitest'
import {moduleFieldProtocolDiagnostic} from '../src/research-v2/module-field-protocol-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {assertModuleFieldClaimCoverage} from '../src/research-v2/module-claims.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const prefix='/outputs/regional_context/records/0/followupTasks'
const error='MODULE_CLAIM_VALUE_UNCOVERED: '+prefix+'/value/1'
const target={port:'regional_context',recordId:'regional-context',field:'followupTasks'}
const draft=()=>({groupId:'regional_context:4',outputs:{regional_context:{records:[{recordId:target.recordId,
  followupTasks:{value:['Synthetic choice A','Synthetic choice B','Synthetic choice C'],claimClass:'decision',limitations:['Unexecuted research choices']}}]}},
  evidence:[{target:{...target,at:'/0'},kind:'proposal',rationale:'Synthetic author choice, not a verified site fact'}]})

it('reports every uncovered task leaf from the rejected native array rather than treating one evidence entry as full coverage',()=>{
  const raw=draft(),before=hash(raw),diagnostic=moduleFieldProtocolDiagnostic(error,raw,[],'2.01')
  expect(diagnostic).toMatchObject({completeSubmission:false,originalSubmissionHash:before,fieldEvidenceLeafCoverageGaps:[
    {target:{...target,at:'/1'},valueHash:hash('Synthetic choice B')},
    {target:{...target,at:'/2'},valueHash:hash('Synthetic choice C')}]})
  expect(JSON.stringify(diagnostic)).not.toContain('Synthetic choice')
  expect(hash(raw)).toBe(before)
})

it('delivers the latest rejected draft hash and all missing leaf addresses to checkpoint recovery without changing either draft',()=>{
  const previous=draft(),latest=draft();latest.outputs.regional_context.records[0].followupTasks.value[2]='Synthetic revised choice C'
  const audit={reviewReceipts:[],attempts:[previous,latest].map(structuredOutput=>({classId:'text',groupId:latest.groupId,status:'failed',error,structuredOutput}))}
  const before=hash(audit),feedback=moduleRecoveryFeedback({module:{id:'2.01'},resumeExecutionAudit:audit,resumeExecutionError:error} as any,latest.groupId)
  const rejection=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(rejection.moduleError).toBe(error)
  expect(rejection.diagnosticExcerpt).toMatchObject({originalSubmissionHash:hash(latest),fieldEvidenceLeafCoverageGaps:[
    {target:{...target,at:'/1'},valueHash:hash('Synthetic choice B')},
    {target:{...target,at:'/2'},valueHash:hash('Synthetic revised choice C')}]})
  expect(moduleRecoveryFeedback({module:{id:'2.01'},resumeExecutionAudit:audit} as any,'regional_context:3')).toBe('')
  expect(hash(audit)).toBe(before)
})

it('preserves the central rejection for an incompletely evidenced decision list and accepts the genuinely complete coverage',()=>{
  const field=draft().outputs.regional_context.records[0].followupTasks
  const claims=field.value.map((value,index)=>({claimId:'synthetic-'+index,selector:prefix+'/value/'+index,kind:'proposal' as const,value}))
  expect(()=>assertModuleFieldClaimCoverage({...field,claimRefs:['synthetic-0']},prefix,claims,['synthetic-0'])).toThrow(error)
  const ids=['synthetic-0','synthetic-1','synthetic-2']
  expect(assertModuleFieldClaimCoverage({...field,claimRefs:ids},prefix,claims,ids)).toEqual(ids)
})

it('does not invent a leaf gap when the original decision evidence actually covers the entire container',()=>{
  const raw=draft();raw.evidence[0].target.at=''
  const field=raw.outputs.regional_context.records[0].followupTasks
  expect(assertModuleFieldClaimCoverage({...field,claimRefs:['whole-choice']},prefix,[{
    claimId:'whole-choice',selector:prefix+'/value',kind:'proposal',value:field.value}],['whole-choice'])).toEqual(['whole-choice'])
  expect(moduleFieldProtocolDiagnostic(error,raw,[],'2.01')).toBeUndefined()
})

it('reports both records of the rejected field with exact original leaf identities and leaves the submission unchanged',()=>{
  const raw=draft(),second=structuredClone(raw.outputs.regional_context.records[0])
  second.recordId='second-context';second.followupTasks.value=['Second choice A','Second choice B','Second choice C']
  raw.outputs.regional_context.records.push(second)
  raw.evidence.push({...structuredClone(raw.evidence[0]),target:{...target,recordId:second.recordId,at:'/0'}})
  const before=hash(raw),diagnostic=moduleFieldProtocolDiagnostic(error,raw,[],'2.01')
  expect(diagnostic).toMatchObject({originalSubmissionHash:before,fieldEvidenceLeafCoverageGapCount:4,fieldEvidenceLeafCoverageGaps:[
    {target:{...target,at:'/1'},valueHash:hash('Synthetic choice B')},
    {target:{...target,at:'/2'},valueHash:hash('Synthetic choice C')},
    {target:{...target,recordId:second.recordId,at:'/1'},valueHash:hash('Second choice B')},
    {target:{...target,recordId:second.recordId,at:'/2'},valueHash:hash('Second choice C')}]})
  expect(hash(raw)).toBe(before)
})

it('does not infer acceptance or revive a covered rejection from a different record gap',()=>{
  const raw=draft(),second=structuredClone(raw.outputs.regional_context.records[0])
  second.recordId='second-context';raw.outputs.regional_context.records.push(second);raw.evidence[0].target.at=''
  expect(moduleFieldProtocolDiagnostic(error,raw,[],'2.01')).toBeUndefined()
})

it('bounds the cross-record diagnostic while counting every uncovered leaf of the named field',()=>{
  const raw=draft()
  for(let i=1;i<=8;i++){const record=structuredClone(raw.outputs.regional_context.records[0]);record.recordId='context-'+i;raw.outputs.regional_context.records.push(record)}
  const before=hash(raw),diagnostic=moduleFieldProtocolDiagnostic(error,raw,[],'2.01')!
  expect(diagnostic).toMatchObject({originalSubmissionHash:before,fieldEvidenceLeafCoverageGapCount:26,omittedFieldEvidenceLeafCoverageGaps:10})
  expect(diagnostic.fieldEvidenceLeafCoverageGaps).toHaveLength(16)
  expect(hash(raw)).toBe(before)
})

it('uses escaped nested JSON pointers and the same quantity metadata exclusions as the central coverage gate',()=>{
  const raw={outputs:{regional_context:{records:[{recordId:target.recordId,followupTasks:{
    value:{'a/b':{'~key':7,unit:'m'}},claimClass:'decision',limitations:[]}}]}},evidence:[]}
  const nestedError='MODULE_CLAIM_VALUE_UNCOVERED: '+prefix+'/value/a~1b/~0key'
  expect(()=>assertModuleFieldClaimCoverage({value:raw.outputs.regional_context.records[0].followupTasks.value,claimClass:'decision',claimRefs:['other']},
    prefix,[{claimId:'other',selector:prefix+'/value/other',kind:'proposal',value:'irrelevant'}],['other'])).toThrow(nestedError)
  expect(moduleFieldProtocolDiagnostic(nestedError,raw,[],'2.01')).toMatchObject({fieldEvidenceLeafCoverageGaps:[
    {target:{...target,at:'/a~1b/~0key'},valueHash:hash(7)}]})
})
