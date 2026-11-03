import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { materialCorpusFingerprint } from '../src/materials/research-evidence.ts'
import { moduleRecoveryFeedback } from '../src/research-v2/module-recovery-feedback.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'

function rejectedBoundaryReview(){
  const raw={verdict:'fail',checks:[{criterion:'Merged financial boundary',status:'fail',rationale:'External village payments are costs; the consolidated entity boundary is undefined.',claimRefs:['claim-original']},
    {criterion:'Held rights conclusions',status:'fail',rationale:'Missing evidence cannot prove rights are absent.',claimRefs:['claim-original']}],
    limitations:['Keep the research conditional; do not claim it is closed.'],synthesisHash:'original-synthesis',progressRestrictionsHash:'original-restrictions'}
  const attempt={classId:'review',status:'failed',executionId:'original-review',childId:'original-child',actualModel:{provider:'original-provider',model:'original-model'},
    stopReason:'completed',structuredOutput:raw,structuredHash:sha256CanonicalJson(raw),error:'MODULE_RESTRICTION_REVIEW_UNVERIFIED: held conclusions failed'}
  return {attempts:[attempt],reviewReceipts:[],priorReviewReceipts:[{verdict:'limited',checks:[{criterion:'Older criterion',status:'limited',rationale:'Stale review diagnostic'}],limitations:[]}]}
}

it.each([false,true])('recovers all findings from a hash-bound rejected restriction review instead of an older inherited review (legacy terminal omitted=%s)',omitStopReason=>{
  const audit=rejectedBoundaryReview(),before=structuredClone(audit)
  if(omitStopReason){delete (audit.attempts[0] as any).stopReason;delete (before.attempts[0] as any).stopReason}
  const feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit} as any,'module-synthesis')
  const rejection=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(rejection.reviewIssues).toEqual(['Merged financial boundary: External village payments are costs; the consolidated entity boundary is undefined.',
    'Held rights conclusions: Missing evidence cannot prove rights are absent.'])
  expect(rejection.reviewLimitations).toEqual(['Keep the research conditional; do not claim it is closed.'])
  expect(rejection.reviewFeedbackBinding).toMatchObject({reviewExecutionId:'original-review',reviewChildId:'original-child',
    originalSubmissionHash:audit.attempts[0].structuredHash,accepted:false,diagnosticOnly:true,synthesisHash:'original-synthesis'})
  expect(feedback).not.toContain('Stale review diagnostic')
  expect(audit).toEqual(before)
})

it.each(['hash','identity','role','terminal','verdict','error'] as const)('does not recover an unbound or unrelated rejected review (%s)',kind=>{
  const audit=rejectedBoundaryReview(),attempt=audit.attempts[0]
  if(kind==='hash')attempt.structuredHash='changed'
  if(kind==='identity')attempt.childId=''
  if(kind==='role')attempt.classId='text'
  if(kind==='terminal')attempt.stopReason='aborted'
  if(kind==='verdict'){attempt.structuredOutput.verdict='pass';attempt.structuredHash=sha256CanonicalJson(attempt.structuredOutput)}
  if(kind==='error')attempt.error='MODULE_REVIEW_CRITERIA_INCOMPLETE: invalid review'
  const feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit} as any,'module-synthesis')
  const rejection=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(rejection.reviewIssues).toEqual(['Older criterion: Stale review diagnostic'])
  expect(rejection.reviewFeedbackBinding?.accepted).toBeUndefined()
})

it('delivers exact unavailable upstream addresses after a decoded JSON-wire schema rejection', () => {
  const target = { port: 'master_layout', recordId: 'study-layout', field: 'structure', at: '' }
  const address = { moduleId: 'preplan.research.05.09', claimId: 'unregistered-original-claim' }
  const raw = { groupId: 'master_layout:1', outputs: { master_layout: { records: [{ recordId: target.recordId,
    structure: { value: 'Conditional study layout', claimClass: 'agent_inference', limitations: ['Unverified'] } }] } },
    evidence: [{ target, kind: 'inference', rationale: 'Original author rationale', inputRefs: [{ upstream: address }] }] }
  const error = 'MODULE_NATIVE_JSON_WIRE_INVALID: original field schema rejected submission: value.evidence[0] must match exactly one oneOf branch (matched 0)'
  const audit = { attempts: [{ classId: 'text', status: 'failed', groupId: raw.groupId, structuredOutput: raw,
    structuredHash: sha256CanonicalJson(raw), error }], reviewReceipts: [] }
  const unchanged = structuredClone(audit)
  const feedback = moduleRecoveryFeedback({ resumeExecutionAudit: audit,
    upstream: [{ moduleId: address.moduleId, claims: [] }] } as any, raw.groupId)
  const rejection = JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(rejection.diagnosticExcerpt).toMatchObject({ completeSubmission: false,
    originalSubmissionHash: sha256CanonicalJson(raw), fieldUpstreamReferenceConflicts: [expect.stringContaining('unregistered-original-claim')] })
  expect(rejection.diagnosticExcerpt.fieldUpstreamReferenceConflicts[0]).toContain('/evidence/0/inputRefs/0/upstream')
  expect(rejection.diagnosticExcerpt.fieldUpstreamReferenceConflicts[0]).toContain('claimId is not present')
  expect(feedback).toContain('宿主不改原稿')
  expect(audit).toEqual(unchanged)
})

it('does not diagnose undecoded JSON-wire text as authored fields', () => {
  const raw = { wireVersion: 'native-frozen-submission.v2', submissionJson: '{not complete JSON', records: [] }
  const audit = { attempts: [{ classId: 'text', status: 'failed', groupId: 'master_layout:1', structuredOutput: raw,
    error: 'MODULE_NATIVE_JSON_WIRE_INVALID: submissionJson must be complete JSON' }], reviewReceipts: [] }
  const feedback = moduleRecoveryFeedback({ resumeExecutionAudit: audit, upstream: [] } as any, 'master_layout:1')
  const rejection = JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(rejection.diagnosticExcerpt).toBeUndefined()
})

it('delivers a central all-missing rejection even when no native author or review attempt failed', () => {
  const audit = { attempts: [{ classId: 'text', status: 'completed', groupId: 'regional_od:5' }], reviewReceipts: [] }, before = structuredClone(audit)
  const message = 'MODULE_EMPTY_PROFESSIONAL_CONCLUSION: all professional fields missing'
  const feedback = moduleRecoveryFeedback({ resumeExecutionAudit: audit, resumeExecutionError: message } as any, 'regional_od:5')
  expect(feedback).toContain(message)
  expect(feedback).toContain('不得填占位值')
  expect(feedback).toContain('不是实际执行或已核现场结果')
  const rejection = JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(rejection.moduleError).toBe(message)
  expect(rejection.authorErrors).toEqual([])
  expect(rejection.reviewIssues).toEqual([])
  expect(audit).toEqual(before)
  expect(moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'regional_od:5')).toBe('')
})
import {moduleEvidenceKindConflicts} from '../src/research-v2/module-author-groups.ts'
import {moduleGroupStepEvidenceConflicts} from '../src/research-v2/module-group-step-diagnostics.ts'

it('exposes duplicate conflict evidence hidden behind a rejected task reference target without repairing it',()=>{
  const target={port:'project_brief',recordId:'synthetic',field:'conflicts',at:'/1'},basis={...target,at:'/0'}
  const raw={groupId:'project_brief:4',outputs:{project_brief:{records:[{recordId:'synthetic',
    conflicts:{value:['Synthetic source name','Unverified task relation'],claimClass:'agent_inference'}}]}},
    evidence:[{target:basis,kind:'source',source:{path:'synthetic.txt',quote:'Synthetic source name'}},
      {target,kind:'inference',rationale:'Unverified relation',inputRefs:[{local:basis}]},
      {target,kind:'inference',rationale:'task_statement_refs=[{"sessionId":"session-synthetic","seq":338,"quote":"Task only"}]',inputRefs:[{local:basis}]}]}
  const audit={attempts:[{classId:'text',status:'failed',groupId:raw.groupId,structuredOutput:raw,
    error:'MODULE_PROJECT_TASK_STATEMENT_TARGET: conflicts'}],reviewReceipts:[]},before=sha256CanonicalJson(audit)
  const feedback=moduleRecoveryFeedback({module:{id:'1.01'},resumeExecutionAudit:audit} as any,raw.groupId)
  const rejection=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(rejection.diagnosticExcerpt?.fieldEvidenceDuplicateConflicts).toMatchObject([{target,repeatCount:2,evidenceIndexes:[1,2]}])
  expect(sha256CanonicalJson(audit)).toBe(before)
})

it.each([false,true])('binds rejected local references to their owning field and exact available addresses (priorGroup=%s)',priorGroup=>{
  const target={port:'regional_nodes',recordId:'node',field:'status',at:''},scale={...target,field:'scale'},missing={...target,field:'absentScale'}
  const declarations={scale:{value:{value:12,unit:'test'},claimClass:'source_conclusion'},absentScale:{value:null,claimClass:'missing'}}
  const basis={groupId:'regional_nodes:2',outputs:{regional_nodes:{records:[{recordId:'node',...declarations}]}},evidence:[{target:{...scale,at:'/value'},kind:'source',source:{path:'synthetic-test-source',quote:'12',valueQuote:'12'}},{target:{...scale,at:'/unit'},kind:'proposal'}]}
  const raw={groupId:'regional_nodes:3',outputs:{regional_nodes:{records:[{recordId:'node',status:{value:'unknown',claimClass:'agent_inference'},...(priorGroup?{}:declarations)}]}},
    evidence:[{target,kind:'inference',inputRefs:[{local:scale},{local:missing}]},...(priorGroup?[]:basis.evidence)]}
  const audit={attempts:[...(priorGroup?[{classId:'text',groupId:basis.groupId,status:'completed',structuredOutput:basis}]:[]),{classId:'text',groupId:raw.groupId,status:'failed',error:'MODULE_PROJECTION_REFERENCE: rejected original local addresses',structuredOutput:raw}],reviewReceipts:[]}
  const unchanged=structuredClone(audit),feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit},raw.groupId),rejection=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(rejection.diagnosticExcerpt).toMatchObject({scope:priorGroup?'local-reference-address-conflicts-only':'field-protocol-conflicts-only',completeSubmission:false,originalSubmissionHash:sha256CanonicalJson(raw),fieldLocalReferenceConflicts:[
    {evidenceIndex:0,target,refPath:'inputRefs/0',referencedTarget:scale,referencedFieldClaimClass:'source_conclusion',reason:'exact-address-unavailable',registeredEvidenceTargets:basis.evidence.map(e=>e.target)},
    {evidenceIndex:0,target,refPath:'inputRefs/1',referencedTarget:missing,referencedFieldClaimClass:'missing',reason:'field-missing',registeredEvidenceTargets:[]},
  ]})
  if(!priorGroup)expect(rejection.diagnosticExcerpt.fieldClaimClassConflicts).toMatchObject([{target:{...scale,at:'/unit'},fieldClaimClass:'source_conclusion',evidenceKind:'proposal'}])
  expect(feedback).toContain('规模不能证明营业状态');expect(feedback).toContain('missing');expect(audit).toEqual(unchanged)
})

it.each([false,true])('does not replay a superseded same-group inference failure once the latest rejected draft has dependencies (emptyTerminal=%s)',emptyTerminal=>{
  const target={port:'regional_nodes',recordId:'node',field:'relationshipHypothesis',at:''},outputs={regional_nodes:{records:[{recordId:'node',relationshipHypothesis:{value:'Conditional relation',claimClass:'agent_inference',limitations:['Unverified']}}]}}
  const prior={groupId:'regional_nodes:2',outputs,evidence:[{kind:'inference',target,inputRefs:[],rationale:'Original rationale'}]}
  const latest={groupId:'regional_nodes:2',outputs,evidence:[{kind:'inference',target,inputRefs:[{upstream:{moduleId:'upstream',claimId:'original'}}],source:{path:'original.txt',quote:'Original quote'},rationale:'Original rationale'}]}
  const audit={reviewReceipts:[],attempts:[{classId:'text',groupId:'regional_nodes:2',status:'failed',structuredOutput:prior,error:'MODULE_CLAIM_INFERENCE_BASIS: superseded missing dependency'},
    {classId:'text',groupId:'regional_nodes:2',status:'failed',structuredOutput:latest,error:'MODULE_PROJECTION_EVIDENCE_KIND: source must be absent'},
    ...(emptyTerminal?[{classId:'text',groupId:'regional_nodes:2',status:'failed',submissionState:'not-submitted',error:'MODULE_NATIVE_error'}]:[])]},before=structuredClone(audit)
  const feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit},'regional_nodes:2'),rejection=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(rejection.authorErrors).toEqual(emptyTerminal?['MODULE_NATIVE_error','MODULE_PROJECTION_EVIDENCE_KIND: source must be absent']:['MODULE_PROJECTION_EVIDENCE_KIND: source must be absent'])
  expect(feedback).not.toContain('superseded missing dependency')
  expect(rejection.diagnosticExcerpt).toMatchObject({scope:'evidence-kind-member-conflicts-only',originalSubmissionHash:sha256CanonicalJson(latest)})
  expect(rejection.diagnosticExcerpt.fieldEvidenceKindConflicts).toHaveLength(1)
  expect(audit).toEqual(before);expect(audit.attempts).toHaveLength(emptyTerminal?3:2)
})

it('keeps prior independently bound review issues after an author-only failure without treating them as a new review', () => {
  const review = { verdict: 'limited', childId: 'original-review', executionId: 'original-review-execution', candidateHash: 'c'.repeat(64), authorGroupsHash: 'a'.repeat(64),
    checks: [{ criterion: 'Spatial inputs', status: 'limited', rationale: 'Entrances and ranges remain unverified' }], limitations: ['Retain approximate scale and disclose conflicting area scopes'] }
  const audit = { attempts: [], reviewReceipts: [], priorReviewReceipts: [review] }, before = structuredClone(audit)
  const feedback = JSON.parse(moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'regional_nodes:1').split('\n').at(-1)!).previousRejection
  expect(feedback.reviewIssues).toEqual(['Spatial inputs: Entrances and ranges remain unverified'])
  expect(feedback.reviewLimitations).toEqual(review.limitations)
  expect(feedback.reviewFeedbackBinding).toMatchObject({ reviewChildId: review.childId, reviewExecutionId: review.executionId, candidateHash: review.candidateHash, authorGroupsHash: review.authorGroupsHash })
  expect(audit).toEqual(before); expect(audit.reviewReceipts).toEqual([])
})

it('uses a new actual review instead of prior diagnostic review receipts', () => {
  const audit = { attempts: [], priorReviewReceipts: [{ verdict: 'limited', checks: [{ criterion: 'Old', status: 'limited', rationale: 'Superseded' }], limitations: ['Old review issue'] }],
    reviewReceipts: [{ verdict: 'limited', checks: [{ criterion: 'Current', status: 'limited', rationale: 'Actual new review' }], limitations: ['Current review issue'] }] }
  const feedback = moduleRecoveryFeedback({ resumeExecutionAudit: audit })
  expect(feedback).toContain('Current: Actual new review'); expect(feedback).not.toContain('Superseded'); expect(feedback).not.toContain('Old review issue')
})

it('includes a masked numeric source mismatch when a rejected step reference fails first, without repairing the draft',()=>{
  const target={port:'regional_nodes',recordId:'r5',field:'scale',at:'/value'}
  const missing={port:'regional_nodes',recordId:'r2',field:'scale',at:'/value'}
  const raw={groupId:'regional_nodes:3',outputs:{regional_nodes:{records:[{recordId:'r5',scale:{value:{value:500000,unit:'person'},claimClass:'source_fact',limitations:[]}}]}},
    evidence:[{kind:'source',target,source:{path:'original.pdf',page:1,quote:'private source population 50万',valueQuote:'50'}}],
    stepResults:{step2:{status:'limited',summary:'Private native summary',limitations:['No source for r2'],fieldRefs:[missing,target]}}}
  const audit={reviewReceipts:[],attempts:[{classId:'text',groupId:raw.groupId,status:'failed',error:'MODULE_GROUP_STEPS: first unmatched field reference',structuredOutput:raw}]},before=structuredClone(audit)
  const text=moduleRecoveryFeedback({resumeExecutionAudit:audit},raw.groupId),excerpt=JSON.parse(text.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
  expect(excerpt).toMatchObject({scope:'field-protocol-conflicts-only',completeSubmission:false,originalSubmissionHash:sha256CanonicalJson(raw)})
  expect(excerpt.fieldClaimClassConflicts).toMatchObject([{target,fieldClaimClass:'source_fact',evidenceKind:'source'}])
  expect(excerpt.stepEvidenceConflicts).toEqual([{target:missing,fieldRefPaths:['/stepResults/step2/fieldRefs/0']}])
  expect(excerpt.fieldNumberConflicts).toHaveLength(1)
  expect(excerpt.fieldNumberConflicts[0]).toMatchObject({evidenceIndex:0,target,rawValue:500000,valueQuoteParsesToRawValue:false,valueQuoteIsWholeNumericToken:true})
  expect(text).toContain('数字字段请核对');expect(text).not.toContain('private source');expect(text).not.toContain('Private native summary');expect(audit).toEqual(before)
  expect(moduleRecoveryFeedback({resumeExecutionAudit:audit},'regional_nodes:2')).toBe('')
})

it('recovers all96 unsupported step references as24 exact addresses without adding evidence or changing steps',()=>{
  const targets=Array.from({length:24},(_,i)=>({port:'site_use',recordId:'r'+Math.floor(i/2),field:'conflicts',at:'/'+(i%2)}))
  const raw={groupId:'site_use:4.3',evidence:[],stepResults:Object.fromEntries([1,2,3,4].map(n=>['step'+n,{status:'limited',summary:'Private original native step '+n,limitations:['Not accepted'],fieldRefs:structuredClone(targets)}]))}
  const audit={reviewReceipts:[],attempts:[{classId:'text',groupId:'site_use:4.3',status:'failed',error:'MODULE_GROUP_STEPS: first12 references do not match; additional references unaccepted',structuredOutput:raw}]}
  const before=structuredClone(audit),conflicts=moduleGroupStepEvidenceConflicts(raw),rejection=JSON.parse(moduleRecoveryFeedback({resumeExecutionAudit:audit},'site_use:4.3').split('\n').at(-1)!).previousRejection
  expect(conflicts).toHaveLength(24)
  expect(conflicts.map(c=>c.target)).toEqual(targets)
  expect(conflicts.flatMap(c=>c.fieldRefPaths)).toHaveLength(96)
  expect(rejection.diagnosticExcerpt).toMatchObject({scope:'step-evidence-address-conflicts-only',completeSubmission:false,originalSubmissionHash:sha256CanonicalJson(raw),stepEvidenceConflicts:conflicts})
  expect(JSON.stringify(rejection.diagnosticExcerpt)).not.toContain('Private original native step')
  expect(audit).toEqual(before)
})

it('keeps every kind/member conflict address for recovery after an empty native correction, without source prose or rewriting the draft',()=>{
  const raw={groupId:'site_use:4.3',evidence:Array.from({length:24},(_,index)=>({target:{port:'site_use',recordId:'r'+Math.floor(index/2),field:'conflicts',at:'/'+(index%2)},kind:'proposal',
    source:{path:'photos/A.JPG',quote:'private-native-snapshot-source'},rationale:'Conditional synthetic scenario only'}))}
  const audit={reviewReceipts:[],attempts:[{classId:'text',groupId:'site_use:4.3',status:'failed',structuredOutput:raw,error:'MODULE_PROJECTION_EVIDENCE_KIND: source must be absent for kind=proposal'},
    {classId:'text',groupId:'site_use:4.3',status:'failed',submissionState:'not-submitted',error:'MODULE_NATIVE_error'}]}
  const before=structuredClone(audit),conflicts=moduleEvidenceKindConflicts(raw),feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit},'site_use:4.3')
  const rejection=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(conflicts).toHaveLength(24)
  expect(rejection.diagnosticExcerpt).toMatchObject({scope:'evidence-kind-member-conflicts-only',completeSubmission:false,originalSubmissionHash:sha256CanonicalJson(raw),fieldEvidenceKindConflicts:conflicts})
  expect(conflicts.map(c=>c.target)).toEqual(raw.evidence.map(e=>e.target))
  expect(JSON.stringify(rejection.diagnosticExcerpt)).not.toContain('private-native-snapshot-source')
  expect(JSON.stringify(rejection.diagnosticExcerpt).length).toBeLessThanOrEqual(24000)
  expect(audit).toEqual(before)
})

it('returns the latest rejected review narrative without expanding its repeated missing-field inventory',()=>{
  const fieldLimitations=Array.from({length:160},(_,n)=>`/outputs/site_use/records/${n}/area: original missing measurement ${n}`)
  const narratives=['rec-spc-03、04、05、09的图像与对象标签仍待复勘，不能确认对象级现状。','具体点位的水源保护区范围、许可和法规适用性未核，不得宣称违法或应清退。']
  const latest={verdict:'limited',childId:'latest-r',executionId:'latest-re',candidateHash:'c'.repeat(64),authorGroupsHash:'g'.repeat(64),
    checks:[{criterion:'Area traceability',status:'limited',rationale:'No measured area or geometry version'},{criterion:'Photo dates',status:'pass',rationale:'Distinct original camera times preserved'}],limitations:[...fieldLimitations,...narratives]}
  const audit={attempts:[],reviewReceipts:[{verdict:'limited',checks:[],limitations:['Superseded old narrative']},latest]},before=structuredClone(audit)
  const text=moduleRecoveryFeedback({resumeExecutionAudit:audit},'site_use:4.3')
  const rejection=JSON.parse(text.split('\n').at(-1)!).previousRejection
  expect(rejection.reviewLimitations).toEqual(narratives)
  expect(rejection.omittedReviewFieldLimitations).toBe(160)
  expect(rejection.reviewFeedbackBinding).toEqual({reviewChildId:'latest-r',reviewExecutionId:'latest-re',candidateHash:latest.candidateHash,authorGroupsHash:latest.authorGroupsHash,reviewLimitationsHash:sha256CanonicalJson(latest.limitations)})
  expect(text).not.toContain('original missing measurement');expect(text).not.toContain('Superseded old narrative')
  expect(text).not.toContain('Distinct original camera times preserved');expect(audit).toEqual(before)
})

it('returns actionable narrative from a limited review even when its individual criteria pass',()=>{
  const narrative='Source-to-object association is unresolved; legal applicability requires verification.'
  const audit={attempts:[],reviewReceipts:[{verdict:'limited',childId:'r',executionId:'re',checks:[{criterion:'No invented measurement',status:'pass',rationale:'Missing preserved'}],limitations:[narrative]}]}
  const text=moduleRecoveryFeedback({resumeExecutionAudit:audit},'site_use:3')
  expect(text).toContain(narrative)
  expect(JSON.parse(text.split('\n').at(-1)!).previousRejection.reviewLimitations).toEqual([narrative])
})

it('does not turn limitations of a passed review into a rejected-review recovery task',()=>{
  const audit={attempts:[],reviewReceipts:[{verdict:'pass',checks:[],limitations:['Informational context only']}]}
  expect(moduleRecoveryFeedback({resumeExecutionAudit:audit},'site_use:4.3')).toBe('')
})

it('gives an aborted native schema loop explicit object types on checkpoint recovery without changing its receipt',()=>{
  const audit={reviewReceipts:[],attempts:[{classId:'text',groupId:'regional_context:3',status:'failed',submissionState:'not-submitted',
    error:'MODULE_NATIVE_TOOL_STALLED: '+JSON.stringify({version:'native-schema-stall.v1',repeatedCalls:3,argumentHash:'a'.repeat(64),validationErrors:['"value.outputs" must be an object'],callIds:['a','b','c']})}]}
  const before=structuredClone(audit),feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit},'regional_context:3')
  expect(feedback).toContain('outputs必须是原生对象')
  expect(feedback).toContain('不得对内部对象或数组使用JSON.stringify')
  expect(feedback).toContain('宿主未接纳、转换或修补先前实参')
  expect(moduleRecoveryFeedback({resumeExecutionAudit:audit},'regional_context:2')).toBe('')
  expect(audit).toEqual(before)
})

it('explains frozen scope const recovery as an exact anchor constraint without rewriting the prior receipt',()=>{
  const error='MODULE_NATIVE_TOOL_STALLED: '+JSON.stringify({version:'native-schema-stall.v1',repeatedCalls:3,argumentHash:'c'.repeat(64),validationErrors:['"value.outputs.regional_od.scope" must be "Frozen conditional research scope"'],callIds:['a','b','c']})
  const audit={reviewReceipts:[],attempts:[{classId:'text',groupId:'regional_od:4',status:'failed',submissionState:'not-submitted',error}]}
  const before=structuredClone(audit),feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit},'regional_od:4')
  expect(feedback).toContain('frozenGroupAnchors')
  expect(feedback).toContain('本组字段范围变化不能改写端口scope')
  expect(feedback).toContain('不是事实来源或已批准范围')
  expect(JSON.parse(feedback.split('\n').at(-1)!).previousRejection.authorErrors[0]).toContain(error)
  expect(audit).toEqual(before)
})

it('keeps native schema recovery diagnostics beside the prior exact source rejection rather than losing either problem',()=>{
  const audit={reviewReceipts:[],attempts:[
    {classId:'text',groupId:'regional_context:3',status:'failed',error:'MODULE_SOURCE_VALUE_TEXT: original source conflict'},
    {classId:'text',groupId:'regional_context:3',status:'failed',submissionState:'not-submitted',error:'MODULE_NATIVE_TOOL_STALLED: original schema audit'},
  ]}
  const previous=JSON.parse(moduleRecoveryFeedback({resumeExecutionAudit:audit},'regional_context:3').split('\n').at(-1)!).previousRejection
  expect(previous.authorErrors).toHaveLength(2)
  expect(previous.authorErrors[0]).toContain('outputs必须是原生对象')
  expect(previous.authorErrors[1]).toContain('MODULE_SOURCE_VALUE_TEXT: original source conflict')
  expect(previous.authorErrors.join('\n')).not.toContain('accepted":true')
})

it('recovers the exact changed scope from an old generic anchor error without replacing either native receipt', () => {
  const port = { type: 'environment', scope: 'Frozen original scope', asOf: '2026-09-28', records: [] }
  const audit = { reviewReceipts: [], attempts: [
    { classId: 'text', groupId: 'environment:1', status: 'completed', structuredOutput: { outputs: { environment: port } } },
    { classId: 'text', groupId: 'environment:3', status: 'failed', error: 'MODULE_GROUP_ANCHOR: environment:3', structuredOutput: { outputs: { environment: { ...port, scope: 'Reworded scope' } } } },
  ] }
  const before = structuredClone(audit)
  const feedback = moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'environment:3')
  expect(feedback).toContain('/outputs/environment/scope')
  expect(feedback).toContain('Frozen original scope')
  expect(moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'environment:2')).toBe('')
  expect(audit).toEqual(before)
})

describe('research resume correction context', () => {
  it('gives both new spatial groups the exact rejected historical steps without relabelling the old submission', () => {
    const raw={projectionVersion:'module-author-field-group.v7',groupId:'site_use:1',outputs:{},evidence:[],stepResults:Object.fromEntries([1,2,3,4].map(n=>['step'+n,{status:'limited',summary:'Historical unsplit step '+n,fieldRefs:[],limitations:['Not a new field submission']}]))}
    const author={classId:'text',status:'completed',groupId:raw.groupId,childId:'a',executionId:'ae',structuredHash:sha256CanonicalJson(raw),structuredOutput:raw}
    const audit={attempts:[author,{classId:'review',status:'completed',childId:'r',executionId:'re'}],reviewReceipts:[{childId:'r',executionId:'re',verdict:'limited',checks:[{criterion:'Actual spatial evidence',status:'limited',rationale:'Missing actual map'}]}]}
    const before=structuredClone(audit)
    for(const groupId of ['site_use:1.1','site_use:1.2']){
      const rejection=JSON.parse(moduleRecoveryFeedback({resumeExecutionAudit:audit},groupId).split('\n').at(-1)!).previousRejection
      expect(rejection.reviewStepExcerpt).toMatchObject({groupId:'site_use:1',requestedGroupId:groupId,completeSubmission:false,originalSubmissionHash:author.structuredHash,authorChildId:'a',reviewChildId:'r',reviewExecutionId:'re',stepResults:raw.stepResults})
      expect(rejection.reviewIssues[0]).toContain('Missing actual map')
    }
    expect(audit).toEqual(before)
    author.structuredHash='0'.repeat(64)
    expect(JSON.parse(moduleRecoveryFeedback({resumeExecutionAudit:audit},'site_use:1.1').split('\n').at(-1)!).previousRejection.reviewStepExcerpt).toBeUndefined()
  })
  const reviewedGroup = () => {
    const target = { port: 'regional_context', recordId: 'area', field: 'regionalRole', at: '' }
    const raw = { groupId: 'regional_context:2', outputs: {}, evidence: [{ source: { quote: 'private-source-quote' } }],
      stepResults: Object.fromEntries([1, 2, 3, 4].map(step => [`step${step}`, {
        status: 'limited', summary: step === 4 ? 'Unsupported ecological barrier and project dependence.' : 'Original group step ' + step,
        fieldRefs: [target], limitations: ['Spatial overlay not verified.'],
      }])) }
    const author = { executionId: 'author-e', childId: 'author-c', classId: 'text', groupId: raw.groupId, status: 'completed',
      structuredOutput: raw, structuredHash: sha256CanonicalJson(raw) }
    return { raw, author, audit: { reviewReceipts: [{ executionId: 'review-e', childId: 'review-c', verdict: 'fail',
      checks: [{ status: 'fail', criterion: 'Role evidence', rationale: 'The step summary adds unsupported spatial dependence.' }] }], attempts: [
      author,
      { executionId: 'review-e', childId: 'review-c', classId: 'review', status: 'completed' },
    ] } }
  }
  it('returns the reviewed native group steps for author correction, bound to the original receipt and excluding source drafts', () => {
    const { raw, author, audit } = reviewedGroup(), before = structuredClone(audit)
    const text = moduleRecoveryFeedback({ resumeExecutionAudit: audit }, raw.groupId)
    const excerpt = JSON.parse(text.split('\n').at(-1)!).previousRejection.reviewStepExcerpt
    expect(excerpt).toMatchObject({ scope: 'review-rejected-group-steps-only', completeSubmission: false,
      groupId: raw.groupId, originalSubmissionHash: author.structuredHash,
      authorChildId: 'author-c', reviewChildId: 'review-c', reviewExecutionId: 'review-e' })
    expect(excerpt.stepResults).toEqual(raw.stepResults)
    expect(excerpt).not.toHaveProperty('outputs'); expect(excerpt).not.toHaveProperty('evidence')
    expect(text).not.toContain('private-source-quote'); expect(audit).toEqual(before)
  })
  it('also binds original group steps to an unfinished limited review without promoting it or trusting altered submissions',()=>{
    const {raw,author,audit}=reviewedGroup()
    audit.reviewReceipts[0].verdict='limited';audit.reviewReceipts[0].checks[0].status='limited'
    const before=structuredClone(audit),text=moduleRecoveryFeedback({resumeExecutionAudit:audit},raw.groupId)
    const excerpt=JSON.parse(text.split('\n').at(-1)!).previousRejection.reviewStepExcerpt
    expect(excerpt).toMatchObject({groupId:raw.groupId,originalSubmissionHash:author.structuredHash,
      reviewChildId:'review-c',reviewExecutionId:'review-e',completeSubmission:false})
    expect(excerpt.stepResults).toEqual(raw.stepResults)
    expect(text).not.toContain('private-source-quote');expect(audit).toEqual(before)
    raw.stepResults.step3.summary='Altered unreviewed summary'
    const changed=moduleRecoveryFeedback({resumeExecutionAudit:audit},raw.groupId)
    expect(JSON.parse(changed.split('\n').at(-1)!).previousRejection.reviewStepExcerpt).toBeUndefined()
  })
  it('selects only authors preceding the exact failed review and never sends another group or a later submission', () => {
    const { raw, author, audit } = reviewedGroup()
    const later = { ...raw, stepResults: { ...raw.stepResults, step4: { ...raw.stepResults.step4, summary: 'Later unreviewed step' } } }
    audit.attempts.push({ ...author, childId: 'later-c', structuredOutput: later, structuredHash: sha256CanonicalJson(later) })
    const text = moduleRecoveryFeedback({ resumeExecutionAudit: audit }, raw.groupId)
    expect(JSON.parse(text.split('\n').at(-1)!).previousRejection.reviewStepExcerpt.stepResults).toEqual(raw.stepResults)
    expect(text).not.toContain('Later unreviewed step')
    expect(JSON.parse(moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'regional_context:1').split('\n').at(-1)!).previousRejection.reviewStepExcerpt).toBeUndefined()
  })
  it.each(['passed-review', 'changed-payload', 'unbound-review', 'oversized-steps'])('does not reuse %s as rejected step context', mode => {
    const { raw, author, audit } = reviewedGroup()
    if (mode === 'passed-review') audit.reviewReceipts[0].verdict = 'pass'
    if (mode === 'changed-payload') raw.stepResults.step4.summary += ' changed after hashing'
    if (mode === 'unbound-review') audit.reviewReceipts[0].childId = 'other-review'
    if (mode === 'oversized-steps') {
      raw.stepResults.step4.summary = 'x'.repeat(24_001)
      author.structuredHash = sha256CanonicalJson(raw)
    }
    const feedback = moduleRecoveryFeedback({ resumeExecutionAudit: audit }, raw.groupId)
    expect(JSON.parse(feedback.split('\n').at(-1)!).previousRejection.reviewStepExcerpt).toBeUndefined()
  })
  it('uses the latest real review issues after a later completed group superseded its failed source submission', () => {
    const audit={reviewReceipts:[{checks:[{status:'fail',criterion:'空间包含须有证据。',rationale:'管护条文没有项目空间叠加。'}]}],attempts:[
      {classId:'text',groupId:'regional_context:2',status:'failed',error:'MODULE_SOURCE_VALUE_TEXT: obsolete-source-error',structuredOutput:{outputs:{regional_context:{records:[]}},evidence:[]}},
      {classId:'text',groupId:'regional_context:2',status:'completed',structuredOutput:{outputs:{regional_context:{records:[]}},evidence:[]}},
    ]}
    const before=structuredClone(audit),feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit},'regional_context:2')
    const data=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
    expect(data.authorErrors).toEqual([]);expect(data.diagnosticExcerpt).toBeUndefined()
    expect(data.reviewIssues).toEqual(['空间包含须有证据。: 管护条文没有项目空间叠加。'])
    expect(feedback).not.toContain('obsolete-source-error');expect(audit).toEqual(before)
    const latest={...audit,attempts:[...audit.attempts,{classId:'text',groupId:'regional_context:2',status:'failed',error:'MODULE_SOURCE_VALUE_TEXT: current-source-error'}]}
    const current=JSON.parse(moduleRecoveryFeedback({resumeExecutionAudit:latest},'regional_context:2').split('\n').at(-1)!).previousRejection
    expect(current.authorErrors).toEqual(['MODULE_SOURCE_VALUE_TEXT: current-source-error'])
  })
  it('lists every latest source-number target even when generic numbered diagnostics already exist and older missing evidence was corrected', () => {
    const rows=Array.from({length:8},(_,i)=>({recordId:'r'+i,photoLocation:{value:{x:114.96884911111113},claimClass:'source_conclusion',limitations:[]}}))
    const raw={outputs:{site_use:{records:rows}},evidence:rows.map(r=>({kind:'source',target:{port:'site_use',recordId:r.recordId,field:'photoLocation',at:'/x'},
      source:{path:'original.jpg',quote:'private-note longitude 114.96884911111111',valueQuote:'114.96884911111111'}}))}
    const old={outputs:{site_use:{records:[{recordId:'old',photoDirection:{value:null,claimClass:'missing',limitations:['No metadata']}}]}},
      evidence:[{kind:'source',target:{port:'site_use',recordId:'old',field:'photoDirection',at:''}}]}
    const audit={reviewReceipts:[],attempts:[
      {classId:'text',groupId:'site_use:4.1',status:'failed',error:'MODULE_GROUP_MISSING_EVIDENCE',structuredOutput:old},
      {classId:'text',groupId:'site_use:4.1',status:'failed',error:'MODULE_SOURCE_VALUE_NUMBER: s; numberDiagnostic={}',structuredOutput:raw}]}
    const before=structuredClone(audit),feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit},'site_use:4.1')
    const excerpt=JSON.parse(feedback.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
    expect(excerpt).toMatchObject({scope:'source-number-bindings-only',completeSubmission:false,originalSubmissionHash:sha256CanonicalJson(raw)})
    expect(excerpt.fieldNumberConflicts).toHaveLength(8)
    expect(excerpt.fieldNumberConflicts.at(-1)).toMatchObject({evidenceIndex:7,target:raw.evidence[7].target,rawValue:114.96884911111113,valueQuote:'114.96884911111111'})
    expect(excerpt.fieldEvidenceConflicts).toBeUndefined()
    expect(feedback).not.toMatch(/private-note/)
    expect(JSON.stringify(excerpt).length).toBeLessThanOrEqual(24_000)
    expect(audit).toEqual(before)
  })
  it('restores all missing-field evidence conflicts after both routes hit output limits without exposing rejected quotes or mutating the audit', () => {
    const records = Array.from({ length: 12 }, (_, index) => ({ recordId: `rec-spc-${String(index + 1).padStart(2, '0')}`,
      photoDirection: { value: null, claimClass: 'missing', limitations: ['No true-north camera direction in frozen metadata'] } }))
    const raw = { outputs: { site_use: { records } }, evidence: records.map(record => ({ kind: 'source',
      target: { port: 'site_use', recordId: record.recordId, field: 'photoDirection', at: '' },
      source: { path: 'private-source.jpg', quote: 'private-rejected-quote' } })) }
    const audit = { reviewReceipts: [], attempts: [
      { classId: 'text', groupId: 'site_use:4.1', status: 'failed', error: 'MODULE_GROUP_MISSING_EVIDENCE', structuredOutput: raw },
      { classId: 'text', groupId: 'site_use:4.1', status: 'failed', error: 'MODULE_NATIVE_max-tokens' },
      { classId: 'text', groupId: 'site_use:4.1', status: 'failed', error: 'MODULE_NATIVE_max-tokens' },
    ] }
    const before = structuredClone(audit), feedback = moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'site_use:4.1')
    const rejection = JSON.parse(feedback.split('\n').at(-1)!).previousRejection
    expect(rejection.authorErrors).toContain('MODULE_NATIVE_max-tokens')
    expect(feedback).toContain('fields marked missing/null must not carry evidence')
    expect(rejection.diagnosticExcerpt).toMatchObject({ scope: 'missing-field-evidence-conflicts-only', completeSubmission: false,
      originalSubmissionHash: sha256CanonicalJson(raw) })
    expect(rejection.diagnosticExcerpt.fieldEvidenceConflicts).toHaveLength(12)
    expect(rejection.diagnosticExcerpt.fieldEvidenceConflicts.at(-1)).toEqual({ evidenceIndex: 11,
      target: raw.evidence[11].target, field: records[11].photoDirection })
    expect(JSON.stringify(rejection.diagnosticExcerpt).length).toBeLessThanOrEqual(24_000)
    expect(feedback).not.toMatch(/private-source|private-rejected-quote/)
    expect(moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'site_use:4.2')).toBe('')
    expect(audit).toEqual(before)
  })
  it('recovers the precise kind/member mismatch from a historical rejected receipt without leaking source text or changing the candidate', () => {
    const address = { port: 'environment', recordId: 'r1', field: 'objectId', at: '' }
    const audit = { attempts: [{ classId: 'text', groupId: 'environment:1', status: 'failed',
      error: `MODULE_PROJECTION_EVIDENCE_KIND: ${JSON.stringify(Object.values(address))}`,
      structuredOutput: { evidence: [{ target: address, kind: 'proposal', source: { path: 'private-path', quote: 'private-quote' } }] },
    }], reviewReceipts: [] }
    const before = structuredClone(audit), feedback = moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'environment:1')
    const errors = JSON.parse(feedback.split('\n').at(-1)!).previousRejection.authorErrors.join('\n')
    expect(errors).toContain('target=' + JSON.stringify(address))
    expect(feedback).toContain('source must be absent for kind=proposal (received present)')
    expect(feedback).not.toContain('private-path')
    expect(feedback).not.toContain('private-quote')
    expect(moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'environment:2')).toBe('')
    expect(audit).toEqual(before)
  })
  it('recovers scalar leaf guidance from a historical detailed geometry rejection without copying coordinates or accepting it', () => {
    const address = { port: 'site_use', recordId: 'r', field: 'geometry', at: '' }
    const audit = { attempts: [{ classId: 'text', groupId: 'site_use:1', status: 'failed',
      error: `MODULE_PROJECTION_SOURCE_SCALAR: target=${JSON.stringify(address)}; valueType=object; source evidence must address a scalar leaf`,
      structuredOutput: { outputs: { site_use: { records: [{ recordId: 'r', geometry: { value: { type: 'Point', coordinates: [12.5, 2.5] } } }] } },
        evidence: [{ kind: 'source', target: address }] } }], reviewReceipts: [] }
    const before = structuredClone(audit), feedback = moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'site_use:1')
    expect(feedback).toContain('sourceLeafPaths')
    expect(feedback).toContain('/coordinates/0'); expect(feedback).toContain('/coordinates/1')
    expect(feedback).not.toContain('12.5'); expect(feedback).not.toContain('2.5')
    expect(audit).toEqual(before)
  })
  it.each(['inputRefs', 'operands', 'weights'])('recovers a final-merge upstream rejection from completed group %s without leaking or changing source values', path => {
    const refs = [{ upstream: { moduleId: 'upstream-module', claimId: 'missing-claim' } }]
    const raw = { groupId: 'environment:4', evidence: [{ target: { port: 'environment', recordId: 'r1', field: 'activityImpact', at: '' },
      ...(path === 'inputRefs' ? { inputRefs: refs } : { calculation: { [path]: refs } }) }] }
    const context = { resumeExecutionAudit: { reviewReceipts: [], attempts: [{ classId: 'text', status: 'completed', groupId: raw.groupId, structuredOutput: raw }] },
      upstream: [{ moduleId: 'upstream-module', claims: [{ claimId: 'unrelated', kind: 'source', value: 'private-source-value' }] }] }
    const before = JSON.stringify(context), feedback = moduleRecoveryFeedback(context as any, raw.groupId)
    expect(feedback).toContain('MODULE_CLAIM_UPSTREAM_MISSING')
    expect(feedback).toContain(`/evidence/0/${path === 'inputRefs' ? path : 'calculation/' + path}/0/upstream`)
    expect(feedback).toContain('missing-claim')
    expect(feedback).not.toContain('private-source-value')
    expect(moduleRecoveryFeedback(context as any, 'environment:3')).toBe('')
    expect(JSON.stringify(context)).toBe(before)
  })

  it.each([false, true])('locates an old generic pointer error in its original submission (JSON text=%s)', text => {
    const outputs = { rights_context: { records: [{ recordId: 'r1', assetId: { value: 'private-id', claimClass: 'proposal' } }] } }
    const raw = { ...(text ? { outputsJson: JSON.stringify(outputs) } : { outputs }), evidence: [{ target: { port: 'rights_context', recordId: 'r1', field: 'assetId', at: '/value' } }] }
    const audit = { reviewReceipts: [], attempts: [{ classId: 'text', status: 'failed', groupId: 'rights_context:1', error: 'MODULE_GROUP_POINTER', structuredOutput: raw }] }
    const before = structuredClone(audit)
    const feedback = moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'rights_context:1')
    expect(feedback).toContain('/evidence/0/target/at')
    expect(feedback).toContain('scalar root')
    expect(feedback).not.toContain('private-id')
    expect(moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'rights_context:2')).toBe('')
    expect(audit).toEqual(before)
  })

  it('recovers final-merge missing dependencies from completed group receipts without treating missing data as claims', () => {
    const missing = { port: 'rights_context', recordId: 'r1', field: 'rightType', at: '' }
    const audit = { attempts: [
      { classId: 'text', status: 'completed', groupId: 'rights_context:1', structuredOutput: {
        groupId: 'rights_context:1', outputs: { rights_context: { records: [{ recordId: 'r1', rightType: { value: null, claimClass: 'missing' } }] } }, evidence: [],
      } },
      { classId: 'text', status: 'completed', groupId: 'rights_context:3', structuredOutput: {
        groupId: 'rights_context:3', outputs: { rights_context: { records: [{ recordId: 'r1', status: { value: '待核', claimClass: 'agent_inference' } }] } },
        evidence: [{ target: { ...missing, field: 'status' }, kind: 'inference', inputRefs: [{ local: missing }] }],
      } },
    ], reviewReceipts: [] }
    const before = structuredClone(audit), feedback = moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'rights_context:3')
    expect(feedback).toContain('MODULE_PROJECTION_REFERENCE')
    expect(feedback).toContain('/evidence/0/inputRefs/0/local')
    expect(feedback).toContain('missing')
    expect(feedback).toContain('rightType')
    expect(moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'rights_context:1')).toBe('')
    expect(audit).toEqual(before)
  })
  it('adds a bounded frozen-source excerpt to an old quote failure without changing the rejected quote', () => {
    const original='水库生态基流的操\n作性不强，没有具体的执行方案。',quote='水库生态基流的操作性能不强，没有具体的执行方案。'
    const document={path:'原件.pdf',contentHash:createHash('sha256').update(original).digest('hex'),byteLength:Buffer.byteLength(original),pages:[{page:24,text:original}]}
    const base={documents:[document],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
    const audit={attempts:[{classId:'text',groupId:'asset_rights:3',status:'failed',error:'MODULE_SOURCE_VALUE_QUOTE: old-source',
      structuredOutput:{evidence:[{kind:'source',target:{port:'asset_rights',recordId:'r1',field:'restrictions',at:'/1'},source:{path:document.path,page:24,quote}}]}}],reviewReceipts:[]}
    const before=structuredClone(audit),feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit,corpus},'asset_rights:3')
    const error=JSON.parse(feedback.split('\n').at(-1)!).previousRejection.authorErrors[0]
    expect(error).toContain('quoteDiagnostic=')
    expect(error).toContain(JSON.stringify(original))
    expect(error).toContain(JSON.stringify(quote))
    expect(feedback).toContain('不是事实来源')
    expect(audit).toEqual(before)
  })
  it('locates an old generic step-reference failure without silently trimming its field name', () => {
    const target={port:'environment',recordId:'r1',field:' objectId',at:''}
    const raw={evidence:[{target:{...target,field:'objectId'}}],stepResults:Object.fromEntries([1,2,3,4].map(step=>[`step${step}`,{
      status:'limited',summary:'检查来源',limitations:['资料限制'],fieldRefs:step===1?[target]:[],
    }]))}
    const audit={attempts:[{classId:'text',groupId:'environment:1',status:'failed',error:'MODULE_GROUP_STEPS',structuredOutput:raw}],reviewReceipts:[]}
    const before=structuredClone(audit),feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit},'environment:1')
    const errors=JSON.parse(feedback.split('\n').at(-1)!).previousRejection.authorErrors.join('\n')
    expect(errors).toContain('/stepResults/step1/fieldRefs/0')
    expect(errors).toContain('"field":" objectId"')
    expect(audit).toEqual(before)
  })
  it('locates old generic non-scalar source errors in rejected group payloads without copying their values as evidence', () => {
    const target = { port: 'site_use', recordId: 'r1', field: 'photoLocation', at: '' }
    const audit = { attempts: [{ classId: 'text', groupId: 'site_use:4', status: 'failed', error: 'MODULE_PROJECTION_SOURCE_SCALAR',
      structuredOutput: { outputs: { site_use: { records: [{ recordId: 'r1', photoLocation: { value: ['private-location'], claimClass: 'source_conclusion' } }] } },
        evidence: [{ target, kind: 'source', source: { path: 'original.jpg', quote: 'private-quote' } }] } }], reviewReceipts: [] }
    const before = structuredClone(audit)
    const feedback = moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'site_use:4')
    const diagnostics = JSON.parse(feedback.split('\n').at(-1)!).previousRejection.authorErrors.join('\n')
    expect(diagnostics).toContain(`target=${JSON.stringify(target)}`)
    expect(diagnostics).toContain('scalar leaf')
    expect(feedback).not.toMatch(/private-location|private-quote/)
    expect(moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'site_use:3')).toBe('')
    expect(audit).toEqual(before)
  })
  it('scopes author failures to the retried group and keeps the saved audit unchanged', () => {
    const audit = { attempts: [
      { classId: 'text', groupId: 'a', status: 'failed', error: 'source quote missing' },
      { classId: 'text', groupId: 'b', status: 'failed', error: 'other group error' },
      { classId: 'review', status: 'failed', error: 'review tool syntax error' },
    ], reviewReceipts: [{ checks: [
      { status: 'fail', criterion: 'Cross-field consistency', rationale: 'Planned equipment was described as installed.' },
      { status: 'pass', criterion: 'Identity', rationale: 'verified identity' },
    ] }] }
    const frozen = structuredClone(audit)
    const feedback = moduleRecoveryFeedback({ resumeExecutionAudit: audit }, 'a')
    expect(feedback).toContain('source quote missing')
    expect(feedback).toContain('Planned equipment was described as installed.')
    expect(feedback).not.toMatch(/other group error|review tool syntax error|verified identity/)
    expect(audit).toEqual(frozen)
  })

  it('bounds large prior diagnostics instead of exhausting the next model context', () => {
    const feedback = moduleRecoveryFeedback({ resumeExecutionAudit: { attempts: Array.from({ length: 20 }, (_, i) => (
      { classId: 'text', groupId: 'a', status: 'failed', error: `error${i}:` + 'x'.repeat(20000) })),
    reviewReceipts: [{ checks: Array.from({ length: 20 }, (_, i) => ({ status: 'fail', criterion: `criterion${i}`, rationale: 'y'.repeat(20000) })) }] } }, 'a')
    expect(feedback.length).toBeLessThan(16000)
    expect(feedback).toContain('诊断已截短')
    expect(feedback).toContain('"omittedReviewIssues":16')
    expect(feedback).toContain('不是事实来源')
  })

  it('keeps mixed local and upstream merge diagnostics bounded before adding historical failures', () => {
    const local = { port: 'environment', recordId: 'r1', field: 'missingField', at: '' }
    const context = { upstream: [], resumeExecutionAudit: { reviewReceipts: [], attempts: [
      { classId: 'text', status: 'completed', groupId: 'environment:1', structuredOutput: {
        outputs: { environment: { records: [{ recordId: 'r1', missingField: { value: null, claimClass: 'missing' } }] } },
        evidence: [{ target: { ...local, field: 'activityImpact' }, inputRefs: [{ local }, { upstream: { moduleId: 'absent', claimId: 'absent' } }] }],
      } },
      ...Array.from({ length: 20 }, (_, index) => ({ classId: 'text', status: 'failed', groupId: 'environment:1', error: `${index}:` + 'x'.repeat(3000) })),
    ] } }
    const feedback = moduleRecoveryFeedback(context, 'environment:1')
    expect(JSON.parse(feedback.split('\n').at(-1)!).previousRejection.authorErrors).toHaveLength(2)
    expect(feedback.length).toBeLessThan(16000)
  })

  it('adds no rejection context to a fresh run or a successful audit', () => {
    expect(moduleRecoveryFeedback({})).toBe('')
    expect(moduleRecoveryFeedback({ resumeExecutionAudit: { attempts: [], reviewReceipts: [{ checks: [{ status: 'pass', criterion: 'QA', rationale: 'ok' }] }] } })).toBe('')
  })
})
