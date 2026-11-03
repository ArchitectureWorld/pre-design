import {expect,it} from 'vitest'
import {moduleFieldProtocolDiagnostic} from '../src/research-v2/module-field-protocol-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const target={port:'peer_products',recordId:'peer-synthetic',field:'advantagesAndGaps',at:'/0'}
const error='MODULE_CLAIM_VALUE_UNCOVERED: /outputs/peer_products/records/0/advantagesAndGaps/value/1'
const draft=()=>({groupId:'peer_products:5.1.5',outputs:{peer_products:{records:[{recordId:target.recordId,
  advantagesAndGaps:{value:['Synthetic inference A','Synthetic inference B','Synthetic inference C','Synthetic inference D'],
    claimClass:'agent_inference',limitations:['Synthetic fixture only']}}]}},
  evidence:[{target,kind:'inference',rationale:'Synthetic rationale only',inputRefs:[{local:target}]}]})

it('reports the original self-reference alongside every missing leaf before the central cycle check can run',()=>{
  const raw=draft(),before=hash(raw),diagnostic=moduleFieldProtocolDiagnostic(error,raw,[],'3.05')!
  expect(diagnostic).toMatchObject({scope:'field-protocol-conflicts-only',completeSubmission:false,originalSubmissionHash:before,
    fieldEvidenceLeafCoverageGaps:[{target:{...target,at:'/1'}},{target:{...target,at:'/2'}},{target:{...target,at:'/3'}}],
    fieldClaimCycles:[{completeCycle:true,omittedEdges:0,edges:[{groupId:raw.groupId,originalSubmissionHash:before,
      evidenceIndex:0,evidenceHash:hash(raw.evidence[0]),valueHash:hash('Synthetic inference A'),target,
      refPath:'inputRefs/0',referencedTarget:target}]}]})
  expect(JSON.stringify(diagnostic)).not.toContain('Synthetic inference')
  expect(hash(raw)).toBe(before)
})

it('delivers both masked conflicts and their protocols to the latest rejected checkpoint draft',()=>{
  const raw=draft(),audit={reviewReceipts:[],attempts:[{classId:'text',status:'failed',groupId:raw.groupId,
    executionId:'synthetic-author',childId:'synthetic-child',structuredHash:hash(raw),structuredOutput:raw,error}]}
  const before=hash(audit),feedback=moduleRecoveryFeedback({module:{id:'3.05'},resumeExecutionAudit:audit,resumeExecutionError:error} as any,raw.groupId)
  const rejection=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(rejection.moduleError).toBe(error)
  expect(rejection.diagnosticExcerpt.fieldClaimCycles).toHaveLength(1)
  expect(rejection.diagnosticExcerpt.fieldEvidenceLeafCoverageGaps).toHaveLength(3)
  expect(feedback).toContain('module-claim-cycle-readback.v1')
  expect(feedback).toContain('field-evidence-leaf-coverage.v1')
  expect(hash(audit)).toBe(before)
})

it('keeps both original hashes when the masked cycle closes across a prior group and the failed group',()=>{
  const raw=draft(),priorTarget={...target,field:'syntheticPrior',at:''}
  raw.evidence[0].inputRefs[0].local=priorTarget
  const prior={groupId:'peer_products:4',outputs:{peer_products:{records:[{recordId:target.recordId,
    syntheticPrior:{value:'Synthetic prior inference',claimClass:'agent_inference'}}]}},
    evidence:[{target:priorTarget,kind:'inference',inputRefs:[{local:target}]}],limitations:['Synthetic fixture only']}
  const audit={reviewReceipts:[],attempts:[{classId:'text',status:'completed',groupId:prior.groupId,structuredOutput:prior},
    {classId:'text',status:'failed',groupId:raw.groupId,structuredOutput:raw,error}]}
  const before=hash(audit),feedback=moduleRecoveryFeedback({module:{id:'3.05'},resumeExecutionAudit:audit,resumeExecutionError:error} as any,raw.groupId)
  const diagnostic=JSON.parse(feedback.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
  expect(diagnostic.fieldClaimCycles).toHaveLength(1)
  expect(diagnostic.fieldClaimCycles[0].edges.map((edge:any)=>edge.originalSubmissionHash)).toEqual([hash(prior),hash(raw)])
  expect(hash(audit)).toBe(before)
})

it('does not report an unrelated prior cycle when the failed draft has no owning group identity',()=>{
  const prior=draft(),raw=draft() as any;delete raw.groupId;raw.evidence=[]
  const diagnostic=moduleFieldProtocolDiagnostic(error,raw,[prior],'3.05')!
  expect(diagnostic.fieldEvidenceLeafCoverageGaps).toHaveLength(4)
  expect(diagnostic).not.toHaveProperty('fieldClaimCycles')
})

it('does not report a cycle for a genuine independent local basis or a prior-only loop',()=>{
  const raw=draft(),prior=draft();prior.groupId='peer_products:4';prior.evidence[0].target={...target,recordId:'other-peer'}
  prior.evidence[0].inputRefs=[{local:prior.evidence[0].target}]
  raw.evidence[0].inputRefs=[{local:{...target,field:'syntheticIndependent',at:''}}]
  expect(moduleFieldProtocolDiagnostic(error,raw,[prior],'3.05')).not.toHaveProperty('fieldClaimCycles')
})
