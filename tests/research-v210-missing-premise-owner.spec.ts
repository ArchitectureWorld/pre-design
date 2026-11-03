import {describe,expect,it} from 'vitest'
import {moduleLocalReferenceConflicts,moduleLocalReferenceDiagnostics} from '../src/research-v2/module-local-reference-diagnostics.ts'
import {moduleFieldProtocolDiagnostic} from '../src/research-v2/module-field-protocol-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {moduleInferenceBasisDiagnostic} from '../src/research-v2/module-claims.ts'

const owner={port:'peer_supply',recordId:'synthetic-peer',field:'blindSpots',at:'/0'}
const dependency={...owner,field:'status',at:''}
const prior={groupId:'peer_supply:5.1.1',outputs:{peer_supply:{records:[{recordId:owner.recordId,
 status:{value:null,claimClass:'missing',limitations:['Synthetic fixture: unavailable status']}}]}},evidence:[]}
const rejected=()=>({groupId:'peer_supply:5.1.2',outputs:{peer_supply:{records:[{recordId:owner.recordId,
 blindSpots:{value:['Synthetic unsupported diagnostic conclusion'],claimClass:'agent_inference',limitations:[]}}]}},
 evidence:[{target:owner,kind:'inference',rationale:'Synthetic fixture only',inputRefs:[{local:dependency}]}]})
const error='MODULE_PROJECTION_REFERENCE: referenced field is missing and has no claim'

describe('missing local premises require reassessing the owning conclusion',()=>{
 it('binds recovery guidance to the inferred owner rather than supplying replacement evidence',()=>{
  const raw=rejected(),before=structuredClone([prior,raw])
  const diagnostic=moduleFieldProtocolDiagnostic(error,raw,[prior])
  expect(diagnostic?.fieldLocalReferenceConflicts).toMatchObject([{target:owner,referencedTarget:dependency,
   reason:'field-missing',registeredEvidenceTargets:[],missingPremiseRecovery:{diagnosticOnly:true,
    ownerField:{port:'peer_supply',recordId:'synthetic-peer',field:'blindSpots'},ownerClaimClass:'agent_inference',
    missingReferenceIsEvidence:false,emptyInferenceBasisAccepted:false,
    fallbackCondition:'owner-has-no-genuine-supported-basis',fallback:'native-owner-missing-null-and-limitations'}}])
  expect([prior,raw]).toEqual(before)
  expect(moduleLocalReferenceDiagnostics([prior,raw])).toHaveLength(1)
 })

 it('delivers the same owner-bound missing-premise diagnostic during checkpoint recovery',()=>{
  const raw=rejected(),audit={reviewReceipts:[],attempts:[
   {classId:'text',groupId:prior.groupId,status:'completed',structuredOutput:prior},
   {classId:'text',groupId:raw.groupId,status:'failed',structuredOutput:raw,error}]},before=structuredClone(audit)
  const text=moduleRecoveryFeedback({resumeExecutionAudit:audit},raw.groupId)
  const feedback=JSON.parse(text.split('\n').at(-1)!).previousRejection
  expect(feedback.diagnosticExcerpt.fieldLocalReferenceConflicts).toMatchObject([{target:owner,
   missingPremiseRecovery:{ownerField:{port:'peer_supply',recordId:'synthetic-peer',field:'blindSpots'},
    ownerClaimClass:'agent_inference',fallbackCondition:'owner-has-no-genuine-supported-basis'}}])
  expect(audit).toEqual(before)
 })

 it('keeps missing references and empty inference bases rejected while permitting explicit missing output',()=>{
  const raw=rejected()
  expect(moduleLocalReferenceDiagnostics([prior,raw])).toHaveLength(1)
  expect(moduleInferenceBasisDiagnostic(raw.outputs.peer_supply.records[0].blindSpots.value,[])).toBeTypeOf('string')
  const explicitMissing={...raw,outputs:{peer_supply:{records:[{recordId:owner.recordId,
   blindSpots:{value:null,claimClass:'missing',limitations:['Synthetic fixture: no supported conclusion']}}]}},evidence:[]}
  expect(moduleLocalReferenceDiagnostics([prior,explicitMissing])).toEqual([])
  expect(moduleLocalReferenceConflicts(explicitMissing,[prior])).toEqual([])
  expect(raw.outputs.peer_supply.records[0].blindSpots.claimClass).toBe('agent_inference')
 })

 it('does not confuse a wrong array address with a missing premise or diagnose unknown future fields',()=>{
  const raw=rejected(),arrayDependency={...dependency,field:'servedNeeds'},leaf={...arrayDependency,at:'/0'}
  const available={...prior,outputs:{peer_supply:{records:[{recordId:owner.recordId,
   servedNeeds:{value:['Synthetic supported leaf'],claimClass:'source_conclusion',limitations:[]}}]}},evidence:[{target:leaf,kind:'source'}]}
  raw.evidence[0].inputRefs=[{local:arrayDependency}]
  const conflicts=moduleLocalReferenceConflicts(raw,[available])
  expect(conflicts).toHaveLength(1)
  expect(conflicts[0]).toMatchObject({reason:'exact-address-unavailable',registeredEvidenceTargets:[leaf]})
  expect(conflicts[0]).not.toHaveProperty('missingPremiseRecovery')
  raw.evidence[0].inputRefs=[{local:leaf}]
  expect(moduleLocalReferenceConflicts(raw,[available])).toEqual([])
  raw.evidence[0].inputRefs=[{local:dependency}]
  expect(moduleLocalReferenceConflicts(raw,[])).toEqual([])
 })
})
