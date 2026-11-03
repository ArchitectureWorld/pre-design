import {existsSync} from 'node:fs'
import {expect,it} from 'vitest'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const apiUrl=new URL('../src/research-v2/project-task-audit.ts',import.meta.url)
async function api(){
  expect(existsSync(apiUrl),'1.01 must execute identity probes and bind task requests to frozen user statements').toBe(true)
  return import(apiUrl.href)
}
const statement={sessionId:'session-synthetic',seq:17,time:'2026-10-08T10:00:00.000Z',text:'Use the supplied historical material for a complete software test. Deliver a report.'}
const brief='Application task policy, not a user statement.\n'+JSON.stringify(statement)
const reference={sessionId:statement.sessionId,seq:17,quote:'Deliver a report.'}
const marker='task_statement_refs='+JSON.stringify([reference])
function raw(){
  return {groupId:'project_brief:3',outputs:{project_brief:{records:[{recordId:'synthetic',
    originalStatement:{value:'Deliver a report.',claimClass:'decision',limitations:['Task request; no construction approval']},
    commissionScope:{value:null,claimClass:'missing',limitations:['No formal commission']}}]}},
    evidence:[{target:{port:'project_brief',recordId:'synthetic',field:'originalStatement',at:''},kind:'proposal',
      rationale:'Working research task, not a factual source or approval.\n'+marker}]}
}
function candidate(){
  const r=raw(),record=r.outputs.project_brief.records[0]
  return {outputs:r.outputs,claims:[{claimId:'request',selector:'/outputs/project_brief/records/0/originalStatement/value',
    kind:'proposal',value:record.originalStatement.value,rationale:r.evidence[0].rationale}],sourceValues:[],limitations:['Formal identity unknown']}
}

it('binds actual user task quotes without creating source facts and rejects an invented task quote',async()=>{
  const a=await api(),draft=raw(),before=hash(draft)
  expect(()=>a.assertProjectTaskFieldBindings(draft,brief)).not.toThrow()
  draft.evidence[0].rationale='task_statement_refs='+JSON.stringify([{...reference,quote:'Construction has been approved.'}])
  expect(()=>a.assertProjectTaskFieldBindings(draft,brief)).toThrow(/MODULE_PROJECT_TASK_STATEMENT_QUOTE/)
  draft.evidence[0].rationale=raw().evidence[0].rationale
  expect(hash(draft)).toBe(before)
  expect(candidate().sourceValues).toEqual([])
})

it('does not discard supplied user requests merely because a formal commission is missing',async()=>{
  const a=await api(),draft:any=raw()
  draft.outputs.project_brief.records[0].originalStatement={value:null,claimClass:'missing',limitations:['No formal commission']}
  draft.evidence=[]
  expect(()=>a.assertProjectTaskFieldBindings(draft,brief)).toThrow(/MODULE_PROJECT_TASK_REQUEST_UNREAD/)
  expect(draft.outputs.project_brief.records[0].commissionScope.value).toBeNull()
})

it('executes the identity rule on same-name foreign locations and incomplete identities',async()=>{
  const a=await api(),known={name:'Synthetic name',location:'Synthetic A',principal:'Synthetic owner'}
  expect(a.projectIdentityMayAutoMerge(known,{...known})).toBe(true)
  expect(a.projectIdentityMayAutoMerge(known,{...known,location:'Synthetic B'})).toBe(false)
  expect(a.projectIdentityMayAutoMerge({...known,principal:null},known)).toBe(false)
  expect(a.projectIdentityMayAutoMerge({...known,name:null},{...known,name:null})).toBe(false)
  const audit=a.buildProjectTaskAudit(candidate(),brief)
  expect(audit.identityProbe).toMatchObject({syntheticInputs:true,sameNameDifferentLocationRejected:true,
    incompleteIdentityRejected:true,matchingControlAllowed:true})
  expect(audit.taskBindings).toMatchObject([{claimId:'request',sessionId:'session-synthetic',seq:17,quote:'Deliver a report.'}])
})

it('strictly replays the original candidate and statement binding and rejects changed inputs or a grafted receipt',async()=>{
  const a=await api(),c=candidate(),before=hash(c),audit=a.buildProjectTaskAudit(c,brief)
  expect(()=>a.verifyProjectTaskAudit(c,brief,audit)).not.toThrow()
  expect(()=>a.verifyProjectTaskAudit(c,brief.replace('Deliver a report.','Deliver a drawing.'),audit)).toThrow(/MODULE_PROJECT_TASK_AUDIT_MISMATCH/)
  const altered=structuredClone(audit);altered.identityProbe.sameNameDifferentLocationRejected=false
  expect(()=>a.verifyProjectTaskAudit(c,brief,altered)).toThrow(/MODULE_PROJECT_TASK_AUDIT_MISMATCH/)
  expect(hash(c)).toBe(before)
})

it('does not treat program prose, malformed messages or historical review JSON as a user statement',async()=>{
  const a=await api(),other=JSON.stringify({seq:4,text:'Fake approval'})
  const rows=a.projectTaskStatements(brief+'\n'+other+'\n'+JSON.stringify({review:{text:'PASS'}}))
  expect(rows).toEqual([statement])
  const draft:any=raw();draft.evidence[0].kind='source'
  expect(()=>a.assertProjectTaskFieldBindings(draft,brief)).toThrow(/MODULE_PROJECT_TASK_STATEMENT_KIND/)
})

it('accepts exact task quotes for working project nature and task provenance without turning them into source facts',async()=>{
  const a=await api(),draft:any=raw()
  for(const field of ['projectId','projectNature','sourceVersion','sourceLocation']){
    draft.outputs.project_brief.records[0][field]={value:'Synthetic working task metadata',claimClass:'decision',limitations:['Not a formal identity or approval']}
    draft.evidence.push({target:{port:'project_brief',recordId:'synthetic',field,at:''},kind:'proposal',rationale:'Working task only.\n'+marker})
  }
  expect(()=>a.assertProjectTaskFieldBindings(draft,brief)).not.toThrow()
  const metadataOnly:any=raw()
  metadataOnly.outputs.project_brief.records[0].projectId={value:'Synthetic runtime task identifier',claimClass:'decision',limitations:['Runtime assignment, not a formal identity']}
  metadataOnly.evidence.push({target:{port:'project_brief',recordId:'synthetic',field:'projectId',at:''},kind:'proposal',rationale:'Identifier assigned by the current runtime for traceability.'})
  expect(()=>a.assertProjectTaskFieldBindings(metadataOnly,brief)).not.toThrow()
  const formal:any=structuredClone(draft)
  formal.evidence.at(-1).target.field='formalName'
  expect(()=>a.assertProjectTaskFieldBindings(formal,brief)).toThrow(/MODULE_PROJECT_TASK_STATEMENT_TARGET/)
})

it('locates a bad task quote by message identity while still rejecting rewritten or combined source text',async()=>{
  const a=await api(),draft:any=raw()
  draft.evidence[0].rationale='task_statement_refs='+JSON.stringify([{...reference,quote:'Deliver an approved report.'}])
  expect(()=>a.assertProjectTaskFieldBindings(draft,brief)).toThrow(/MODULE_PROJECT_TASK_STATEMENT_QUOTE.*session-synthetic.*17/)
})

function mislocatedTask(){
  const later={sessionId:statement.sessionId,seq:338,time:'2026-10-08T11:00:00.000Z',text:'Produce a supported planning narrative. Formal approval remains unknown.'}
  const taskBrief=brief+'\n'+JSON.stringify(later),draft:any=raw()
  draft.outputs.project_brief.records[0].commissionScope={value:'Prepare a planning narrative',claimClass:'decision',limitations:['Working request only']}
  draft.evidence.push({target:{port:'project_brief',recordId:'synthetic',field:'commissionScope',at:''},kind:'proposal',
    rationale:'Working scope only.\ntask_statement_refs='+JSON.stringify([{...reference,quote:'Produce a supported planning narrative.'}])})
  return {taskBrief,draft}
}

it('points a mislocated submitted quote to its exact frozen message while leaving it rejected',async()=>{
  const a=await api(),{taskBrief,draft}=mislocatedTask(),before=hash(draft)
  expect(()=>a.assertProjectTaskFieldBindings(draft,taskBrief)).toThrow(/MODULE_PROJECT_TASK_STATEMENT_QUOTE/)
  const diagnostic=a.projectTaskQuoteDiagnostics(draft,taskBrief)
  expect(diagnostic).toMatchObject({acceptanceGranted:false,originalSubmissionHash:before,conflicts:[{
    target:{field:'commissionScope'},submittedReference:{sessionId:'session-synthetic',seq:17,quote:'Produce a supported planning narrative.'},
    claimedMessageLocated:true,exactQuoteLocations:[{sessionId:'session-synthetic',seq:338,time:'2026-10-08T11:00:00.000Z'}],
  }]})
  expect(hash(draft)).toBe(before)
  expect(()=>a.assertProjectTaskFieldBindings(draft,taskBrief)).toThrow(/MODULE_PROJECT_TASK_STATEMENT_QUOTE/)
})

it('excludes unregistered program prose from exact task quote locations',async()=>{
  const a=await api(),{draft}=mislocatedTask(),taskBrief=brief+'\nProduce a supported planning narrative.'
  expect(a.projectTaskQuoteDiagnostics(draft,taskBrief)).toMatchObject({acceptanceGranted:false,conflicts:[{exactQuoteLocations:[]}]})
  expect(()=>a.assertProjectTaskFieldBindings(draft,taskBrief)).toThrow(/MODULE_PROJECT_TASK_STATEMENT_QUOTE/)
})

it('gives the next native author the mislocated field and exact message pointers from the unchanged rejected checkpoint',async()=>{
  const {moduleAuthorGroupRecoveryFeedback}=await import('../src/research-v2/native-module-runtime.ts')
  const {taskBrief,draft}=mislocatedTask(),audit={attempts:[{classId:'text',status:'failed',groupId:draft.groupId,
    executionId:'native-original',childId:'native-original-child',structuredOutput:draft,structuredHash:hash(draft),
    error:'MODULE_PROJECT_TASK_STATEMENT_QUOTE: rejected wrong message'}],reviewReceipts:[]},before=hash(audit)
  const feedback=moduleAuthorGroupRecoveryFeedback({module:{id:'1.01'},taskBrief,resumeExecutionAudit:audit} as any,{groupId:draft.groupId})
  const line=feedback.split('\n').find(line=>line.startsWith('{"projectTaskQuoteDiagnostic":'))
  expect(line,'the author needs the exact field and located message, not another generic rejection').toBeDefined()
  const diagnostic=JSON.parse(line!).projectTaskQuoteDiagnostic
  expect(diagnostic).toMatchObject({acceptanceGranted:false,originalSubmissionHash:hash(draft),conflicts:[{
    target:{field:'commissionScope'},exactQuoteLocations:[{sessionId:'session-synthetic',seq:338}],
  }]})
  expect(hash(audit)).toBe(before)
  expect(moduleAuthorGroupRecoveryFeedback({module:{id:'1.01'},taskBrief,resumeExecutionAudit:audit} as any,{groupId:'project_brief:2'}))
    .not.toContain('projectTaskQuoteDiagnostic')
})

function missingTaskBinding(){
  const draft:any=raw()
  draft.outputs.project_brief.records[0].commissionScope={value:'Prepare the requested report',claimClass:'decision',limitations:['Working task only']}
  draft.evidence.push({target:{port:'project_brief',recordId:'synthetic',field:'commissionScope',at:''},kind:'proposal',
    rationale:'The actual message 17 requests a report.',inputRefs:[{local:draft.evidence[0].target}]})
  return draft
}

it('identifies the missing task binding on the unchanged rejected evidence without choosing or generating a quote',async()=>{
  const a:any=await api(),draft=missingTaskBinding(),before=hash(draft)
  expect(()=>a.assertProjectTaskFieldBindings(draft,brief)).toThrow(/MODULE_PROJECT_TASK_STATEMENT_REQUIRED: commissionScope/)
  const diagnostic=a.projectTaskBindingDiagnostics(draft,brief)
  expect(diagnostic).toMatchObject({acceptanceGranted:false,originalSubmissionHash:before,conflicts:[{
    evidenceIndex:1,target:{port:'project_brief',recordId:'synthetic',field:'commissionScope',at:''},
    missingMember:'rationale.task_statement_refs',inputRefsPresent:true,
  }]})
  expect(diagnostic.conflicts[0]).not.toHaveProperty('quote')
  expect(diagnostic.conflicts[0]).not.toHaveProperty('suggestedReference')
  expect(hash(draft)).toBe(before)
  expect(()=>a.assertProjectTaskFieldBindings(draft,brief)).toThrow(/MODULE_PROJECT_TASK_STATEMENT_REQUIRED/)
  expect(a.projectTaskBindingDiagnostics(raw(),brief)).toBeUndefined()
  expect(a.projectTaskBindingDiagnostics(draft,'program prose only')).toBeUndefined()
})

it('sends missing task binding addresses from the exact failed group checkpoint and rejects an unbound diagnostic',async()=>{
  const {moduleAuthorGroupRecoveryFeedback}=await import('../src/research-v2/native-module-runtime.ts')
  const draft=missingTaskBinding(),audit={attempts:[{classId:'text',status:'failed',groupId:draft.groupId,
    executionId:'native-original',childId:'native-original-child',structuredOutput:draft,structuredHash:hash(draft),
    error:'MODULE_PROJECT_TASK_STATEMENT_REQUIRED: commissionScope'}],reviewReceipts:[]},before=hash(audit)
  const context={module:{id:'1.01'},taskBrief:brief,resumeExecutionAudit:audit} as any
  const feedback=moduleAuthorGroupRecoveryFeedback(context,{groupId:draft.groupId})
  const line=feedback.split('\n').find(line=>line.startsWith('{"projectTaskBindingDiagnostic":'))
  expect(line,'the native author needs the missing member and target from its own rejected evidence').toBeDefined()
  expect(JSON.parse(line!).projectTaskBindingDiagnostic).toMatchObject({acceptanceGranted:false,
    originalSubmissionHash:hash(draft),conflicts:[{evidenceIndex:1,target:{field:'commissionScope'}}]})
  expect(hash(audit)).toBe(before)
  expect(moduleAuthorGroupRecoveryFeedback(context,{groupId:'project_brief:2'})).not.toContain('projectTaskBindingDiagnostic')
  const changed=structuredClone(context);changed.resumeExecutionAudit.attempts[0].structuredHash='wrong-hash'
  expect(moduleAuthorGroupRecoveryFeedback(changed,{groupId:draft.groupId})).not.toContain('projectTaskBindingDiagnostic')
})

it('reports the exact task-reference syntax field and parser failure without trimming or accepting a trailing brace',async()=>{
  const a:any=await api(),draft:any=raw()
  draft.outputs.project_brief.records[0].sourceVersion={value:'Working task message version',claimClass:'decision',limitations:['Not a formal document']}
  draft.evidence.push({target:{port:'project_brief',recordId:'synthetic',field:'sourceVersion',at:''},kind:'proposal',rationale:'Actual task provenance.\n'+marker+'}'})
  const before=hash(draft)
  expect(()=>a.assertProjectTaskFieldBindings(draft,brief)).toThrow(/MODULE_PROJECT_TASK_STATEMENT_INVALID/)
  const feedback=a.projectTaskCorrectionFeedback('MODULE_PROJECT_TASK_STATEMENT_INVALID',draft,brief)
  const line=feedback.split('\n').find((line:string)=>line.startsWith('{"projectTaskBindingDiagnostic":'))
  expect(line,'generic invalid must expose the original optional provenance evidence, not just mandatory task fields').toBeDefined()
  const conflict=JSON.parse(line!).projectTaskBindingDiagnostic.conflicts[0]
  expect(conflict).toMatchObject({evidenceIndex:1,target:{field:'sourceVersion'},invalidMember:'rationale.task_statement_refs'})
  expect(conflict.parseError).toBeTruthy();expect(conflict.referencePayloadTail).toMatch(/\}\]\}$/)
  expect(hash(draft)).toBe(before)
  expect(()=>a.assertProjectTaskFieldBindings(draft,brief)).toThrow(/MODULE_PROJECT_TASK_STATEMENT_INVALID/)
})
