import {expect,it,vi} from 'vitest'
import * as canonical from '../src/presentation/canonical-json.ts'
import * as gate from '../src/research-v2/module-progress-review.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {progressReviewSchema,progressReviewPrompt} from '../src/research-v2/native-progress-review.ts'
import {assertObjectJsonSchema,validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'

const result=(itemId:string,value='historical evidence')=>({itemId,projectId:'p',snapshotId:'s',snapshotHash:'sh',
  outputs:{port:{records:[{recordId:'r',value}],quality:'limited',limitations:['Unverified present status']}},
  claims:[{claimId:'c-'+itemId,kind:'proposal',value}],sourceValues:[],limitations:['Unverified present status'],
  execution:{executionId:'author-'+itemId,childId:'author-child-'+itemId,reviewReceipts:[{executionId:'review-'+itemId,
    childId:'review-child-'+itemId,verdict:'limited',checks:[{criterion:'Verify present status',status:'limited',rationale:'Historical evidence only'}],limitations:['Historical only']}]} }) as any

it('counts substantive modules, not receipts, repeats or field-group activity, and calls for review at three steps',()=>{
  const ledger=gate.newResearchProgress()
  gate.recordResearchStep(ledger,result('1.01'))
  gate.recordResearchStep(ledger,{...result('1.01'),execution:{...result('1.01').execution,executionId:'new-call'}})
  expect(ledger.steps).toHaveLength(1)
  gate.recordResearchStep(ledger,result('1.02'))
  expect(gate.progressReviewReason(ledger,'1.03')).toBeUndefined()
  gate.recordResearchStep(ledger,result('1.03'))
  expect(gate.progressReviewReason(ledger,'1.04')).toBe('three-modules')
})

it('forces a chapter-boundary review early and a final review even for fewer than three modules',()=>{
  const ledger=gate.newResearchProgress()
  gate.recordResearchStep(ledger,result('1.01'))
  expect(gate.progressReviewReason(ledger,'2.01')).toBe('chapter-boundary')
  expect(gate.progressReviewReason(ledger,undefined,true)).toBe('phase-end')
})

const makeRequest=()=>{
  const ledger=gate.newResearchProgress(),results=[result('1.01'),result('1.02')]
  results.forEach(r=>gate.recordResearchStep(ledger,r))
  return gate.createProgressReviewRequest({projectId:'p',snapshotId:'s',snapshotHash:'sh',catalogHash:'cat',planHash:'plan',
    taskBrief:'Explore with explicit limits; do not invent facts',selectedModuleIds:['1.01','1.02'],results,ledger,reason:'phase-end'})
}
const verdict=(request:ReturnType<typeof makeRequest>)=>({requestHash:request.requestHash,verdict:'continue' as const,
  rationale:'Continue this exploration with historical limits; approval and present use remain unconfirmed.',
  conditions:request.requiredConditions.map(c=>({...c,permission:'proceed' as const,reason:'Use as a bounded research hypothesis',verification:'Review with the next three substantive modules'})),
  driftFindings:[]})
const receipt={executionId:'global-review',childId:'global-review-child',actualModel:{provider:'native',model:'review'},stopReason:'completed'}

it('hashes each unchanged result once within a review-history replay and rechecks mutations on the next replay',()=>{
  const request=makeRequest(),ledger={...gate.newResearchProgress(),steps:structuredClone([...request.steps])}
  for(const [index,reason] of ['baseline','phase-end'].entries()){
    const next=gate.createProgressReviewRequest({...request,ledger,reason:reason as 'baseline'|'phase-end'})
    ledger.reviews.push(gate.acceptProgressReview(next,verdict(next),{...receipt,executionId:'review-'+index,childId:'child-'+index}))
  }
  const spy=vi.spyOn(canonical,'sha256CanonicalJson')
  try{
    gate.verifyResearchProgress(ledger,request.results,request)
    for(const result of request.results)expect(spy.mock.calls.filter(args=>args[0]===result)).toHaveLength(1)
    const changed=structuredClone(request.results);(changed[0]!.outputs.port as {records:{value:string}[]}).records[0]!.value='changed after the first replay'
    expect(()=>gate.verifyResearchProgress(ledger,changed,request)).toThrow('PROGRESS_REVIEW_STEP_CHANGED')
  }finally{spy.mockRestore()}
})

const reuseBaseline=(...args:any[])=>{
 const fn=(gate as any).reuseResearchProgressForBaseline
 expect(typeof fn,'resume keeps verified review history available to a new independent baseline').toBe('function')
 return fn(...args) as boolean
}
it('reuses an unchanged verified review history for a new baseline without importing its failure flag or mutating saved work',()=>{
 const request=makeRequest(),previous={...gate.newResearchProgress(),steps:structuredClone(request.steps),
  reviews:[gate.acceptProgressReview(request,verdict(request),receipt)],failure:'historical failure'}
 const current=gate.newResearchProgress(),before=hash({previous,results:request.results})
 expect(reuseBaseline(current,previous,request.results,request)).toBe(true)
 const fresh=gate.createProgressReviewRequest({...request,ledger:current,reason:'baseline'})
 expect(fresh.previousReview?.hash).toBe(previous.reviews[0].hash)
 expect(fresh.requestHash).not.toBe(previous.reviews[0].binding.requestHash)
 expect(current.failure).toBeUndefined()
 expect(hash({previous,results:request.results})).toBe(before)
})
it('uses only a verified review-history prefix when later results have not yet entered the resumed baseline',()=>{
 const full=makeRequest(),previous=gate.newResearchProgress()
 gate.recordResearchStep(previous,full.results[0])
 const first=gate.createProgressReviewRequest({...full,ledger:previous,results:full.results.slice(0,1),reason:'baseline'})
 previous.reviews.push(gate.acceptProgressReview(first,verdict(first),receipt))
 gate.recordResearchStep(previous,full.results[1])
 const later=gate.createProgressReviewRequest({...full,ledger:previous,reason:'phase-end'})
 previous.reviews.push(gate.acceptProgressReview(later,verdict(later),{...receipt,executionId:'later-review',childId:'later-child'}))
 const current=gate.newResearchProgress()
 expect(reuseBaseline(current,previous,full.results.slice(0,1),full)).toBe(true)
 expect(current.reviews.map(r=>r.hash)).toEqual([previous.reviews[0].hash])
 expect(current.steps).toHaveLength(1)
})
it('refuses changed results, task, snapshot, selection or a damaged review and leaves the fresh ledger unchanged',()=>{
 const request=makeRequest(),previous={...gate.newResearchProgress(),steps:structuredClone(request.steps),reviews:[gate.acceptProgressReview(request,verdict(request),receipt)]}
 const changes=[{...request,taskBrief:'Changed research task'},{...request,snapshotHash:'changed'},
  {...request,selectedModuleIds:['1.01']},{...request,results:[result('1.01','changed'),request.results[1]]}]
 for(const input of changes){const current=gate.newResearchProgress(),before=hash(current)
  expect(reuseBaseline(current,previous,input.results,input)).toBe(false);expect(hash(current)).toBe(before)}
 const damaged={...previous,reviews:previous.reviews.map(r=>({...r,hash:'changed'}))}
 const current=gate.newResearchProgress()
 expect(reuseBaseline(current,damaged,request.results,request)).toBe(false);expect(current.reviews).toHaveLength(0)
})
it('counts only new substantive work after the fresh baseline and keeps the three-module review interval',()=>{
 const request=makeRequest(),previous={...gate.newResearchProgress(),steps:structuredClone(request.steps),reviews:[gate.acceptProgressReview(request,verdict(request),receipt)]}
 const current=gate.newResearchProgress();expect(reuseBaseline(current,previous,request.results,request)).toBe(true)
 const baseline=gate.createProgressReviewRequest({...request,ledger:current,reason:'baseline'})
 current.reviews.push(gate.acceptProgressReview(baseline,verdict(baseline),{...receipt,executionId:'fresh-review',childId:'fresh-child'}))
 gate.recordResearchStep(current,request.results[0]);expect(current.steps).toHaveLength(2)
 for(const id of ['1.03','1.04']){gate.recordResearchStep(current,result(id));expect(gate.progressReviewReason(current,'1.05')).toBeUndefined()}
 gate.recordResearchStep(current,result('1.05'));expect(gate.progressReviewReason(current,'1.06')).toBe('three-modules')
})

it('keeps the original proposed and sourced claim meanings visible beside a synthesized opportunity summary',()=>{
  const prior=makeRequest(),candidate=result('4.02')
  candidate.claims=[{claimId:'candidate-village-experience',kind:'proposal',value:'拟研究周边村文化体验，具体村庄和资源对象待核。',rationale:'候选探索方向，不主张现有资源或授权。'},
    {claimId:'reservoir-protection',kind:'source',value:'水文化保护'}]
  candidate.execution.synthesis={judgment:{analysis:'资源机会包括条件性周边村文化体验。',claimRefs:['reservoir-protection']}}
  const request=gate.createProgressReviewRequest({...prior,results:[candidate],selectedModuleIds:['4.02','4.04'],ledger:gate.newResearchProgress(),reason:'baseline'})
  const before=hash(candidate),prompt=progressReviewPrompt(request),payload=JSON.parse(prompt.split('\n').at(-1)!)
  expect(payload.progressReview.modules[0].claimSemantics).toEqual(candidate.claims)
  expect(hash(candidate)).toBe(before)
})

it('keeps pending research out of major drift while retaining real deviation and full-delivery coverage checks',()=>{
  const prior=makeRequest(),request=gate.createProgressReviewRequest({...prior,selectedModuleIds:['1.01','1.02','1.03'],ledger:gate.newResearchProgress(),reason:'baseline'})
  const valid={...verdict(request),conditions:verdict(request).conditions.map(c=>({...c,scope:{kind:'none',allowedUses:[],heldUses:[],reviewAfterModules:3} as const}))}
  const premature={...valid,verdict:'pause' as const,driftFindings:[{severity:'major' as const,itemIds:['1.03'],finding:'The selected next module has no result yet.',correction:'Complete the next module.'}]}
  expect(validateJsonSchemaValue(progressReviewSchema(request),premature).length).toBeGreaterThan(0)
  expect(()=>gate.acceptProgressReview(request,premature,receipt)).toThrow('PROGRESS_REVIEW_DRIFT')
  expect(progressReviewPrompt(request)).toContain('尚未开始或尚未完成的模块不是已经发生的方向偏移')
  const aligned=gate.acceptProgressReview(request,valid,receipt)
  expect(gate.progressDecisionAllowsResearch(aligned.decision)).toBe(true)
  const actual=gate.acceptProgressReview(request,{...premature,driftFindings:[{...premature.driftFindings[0]!,itemIds:['1.01'],finding:'The produced study identifies a different project object.'}]},receipt)
  expect(gate.progressDecisionAllowsResearch(actual.decision)).toBe(false)
  expect(gate.controlledResearchReady({selectedModuleIds:request.selectedModuleIds,results:request.results,
    moduleRuns:request.results.map(r=>({itemId:r.itemId,status:'limited'})),researchProgress:{...gate.newResearchProgress(),reviews:[aligned]}})).toBe(false)
})

it('replays a historical pending-coverage pause without changing its old verdict',()=>{
  const prior=makeRequest(),request=gate.createProgressReviewRequest({...prior,selectedModuleIds:['1.01','1.02','1.03'],ledger:gate.newResearchProgress(),reason:'baseline'})
  const {driftScope:_policy,requestHash:_hash,taskBrief,results,...core}=request as typeof request & {driftScope?:string}
  const legacy={...core,requestHash:hash(core),taskBrief,results} as typeof request
  const decision={...verdict(legacy),verdict:'pause' as const,driftFindings:[{severity:'major' as const,itemIds:['1.03'],finding:'The selected module has no result yet.',correction:'Complete the remaining study.'}]}
  const old=gate.acceptProgressReview(legacy,decision,receipt),before=hash(old)
  expect(()=>gate.verifyProgressReview(old,results)).not.toThrow()
  expect(hash(old)).toBe(before);expect(gate.progressDecisionAllowsResearch(old.decision)).toBe(false)
})

it('rejects an extra unrelated QA condition at the native submission boundary instead of inviting a central rejection',()=>{
  const request=makeRequest(),valid={...verdict(request),conditions:verdict(request).conditions.map(c=>({...c,
    scope:{kind:'none',allowedUses:[],heldUses:[],reviewAfterModules:3}}))}
  expect(validateJsonSchemaValue(progressReviewSchema(request),valid)).toEqual([])
  const extra={...valid,conditions:[...valid.conditions,{...valid.conditions[0]!,criterion:'A catalog check not required in this review'}]}
  expect(validateJsonSchemaValue(progressReviewSchema(request),extra).length).toBeGreaterThan(0)
  expect(()=>gate.acceptProgressReview(request,extra as any,receipt)).toThrow('PROGRESS_REVIEW_CONDITIONS')
})

it('advertises a supported zero-condition schema and centrally requires [] without a placeholder condition',()=>{
  const prior=makeRequest(),results=prior.results.map(r=>({...r,execution:{...r.execution,
    reviewReceipts:r.execution!.reviewReceipts!.map(review=>({...review,verdict:'pass',checks:review.checks.map(c=>({...c,status:'pass'}))}))}})) as any
  const ledger=gate.newResearchProgress();results.forEach((r:any)=>gate.recordResearchStep(ledger,r))
  const request=gate.createProgressReviewRequest({...prior,results,ledger})
  const valid={...verdict(request),conditions:[]}
  expect(()=>assertObjectJsonSchema(progressReviewSchema(request))).not.toThrow()
  expect(validateJsonSchemaValue(progressReviewSchema(request),valid)).toEqual([])
  const fabricated={...valid,conditions:[{...verdict(prior).conditions[0]!,scope:{kind:'none',allowedUses:[],heldUses:[],reviewAfterModules:3} as const}]}
  expect(()=>gate.acceptProgressReview(request,fabricated,receipt)).toThrow('PROGRESS_REVIEW_CONDITIONS')
  expect(()=>gate.acceptProgressReview(request,valid,receipt)).not.toThrow()
})

it('accepts the real native schema subset when only one module has outstanding conditions',()=>{
  const request=makeRequest(),single={...request,requiredConditions:request.requiredConditions.filter(c=>c.itemId==='1.01')}
  expect(()=>assertObjectJsonSchema(progressReviewSchema(single))).not.toThrow()
  const valid={...verdict(single),conditions:verdict(single).conditions.map(c=>({...c,
    scope:{kind:'none',allowedUses:[],heldUses:[],reviewAfterModules:3}}))}
  expect(validateJsonSchemaValue(progressReviewSchema(single),valid)).toEqual([])
})

const conclusionScope={kind:'conclusions',allowedUses:['Compare background and conditional options'],heldUses:['Exact coordinates, areas and implementation conclusions'],reviewAfterModules:1} as const
it('honors an explicitly scoped major finding without accepting its held conclusion or rewriting historical decisions',()=>{
  const request=makeRequest(),base=verdict(request),finding={severity:'major' as const,itemIds:['1.02'],
    finding:'The summary says the study is complete although costs remain limited.',correction:'Withdraw the completion claim; retain the conditional mechanism.',scope:conclusionScope}
  const raw={...base,verdict:'pause' as const,driftFindings:[finding]},before=hash({raw,results:request.results})
  const audit=gate.acceptProgressReview(request,raw,receipt)
  expect(gate.progressDecisionAllowsResearch(audit.decision)).toBe(true)
  const restrictions=gate.moduleResearchRestrictions(audit)!
  expect(restrictions.conditions).toHaveLength(1)
  expect(restrictions.conditions[0]).toMatchObject({itemId:'1.02',scope:conclusionScope})
  expect(restrictions.conditions[0].criterion).toContain(finding.finding)
  expect(restrictions.conditions[0].criterion).toContain(finding.correction)
  expect(gate.researchRestrictionCriteria(restrictions)).toHaveLength(2)
  expect(()=>gate.verifyProgressReview(audit,request.results)).not.toThrow()
  expect(hash({raw,results:request.results})).toBe(before)
  const native={...raw,conditions:raw.conditions.map(c=>({...c,scope:{kind:'none',allowedUses:[],heldUses:[],reviewAfterModules:3}}))}
  expect(validateJsonSchemaValue(progressReviewSchema(request),native)).toEqual([])
})
it('rejects ambiguous drift scopes and keeps unscoped or module-wide major findings as hard stops',()=>{
  const request=makeRequest(),finding={severity:'major' as const,itemIds:['1.02'],finding:'A calculation is wrong.',correction:'Recalculate before use.'}
  const raw={...verdict(request),verdict:'pause' as const,driftFindings:[finding]}
  const old=gate.acceptProgressReview(request,raw,receipt),before=hash(old)
  expect(gate.progressDecisionAllowsResearch(old.decision)).toBe(false)
  const hard=gate.acceptProgressReview(request,{...raw,driftFindings:[{...finding,scope:{...conclusionScope,kind:'module-and-downstream',allowedUses:[]}}]} as any,receipt)
  expect(gate.progressDecisionAllowsResearch(hard.decision)).toBe(false)
  for(const scope of [{...conclusionScope,allowedUses:[]},{...conclusionScope,heldUses:[]},{...conclusionScope,reviewAfterModules:4},
    {...conclusionScope,kind:'none'},{...conclusionScope,kind:'module-and-downstream'}])
    expect(()=>gate.acceptProgressReview(request,{...raw,driftFindings:[{...finding,scope}]} as any,receipt)).toThrow(/PROGRESS_REVIEW_SCOPE/)
  expect(()=>gate.acceptProgressReview(request,{...raw,verdict:'continue',driftFindings:[{...finding,severity:'notice',scope:conclusionScope}]} as any,receipt)).toThrow(/PROGRESS_REVIEW_SCOPE/)
  expect(hash(old)).toBe(before)
})
it('enforces the step deadline of a scoped drift even when every original condition is proceed',()=>{
  const request=makeRequest(),audit=gate.acceptProgressReview(request,{...verdict(request),verdict:'pause',driftFindings:[{
    severity:'major',itemIds:['1.02'],finding:'Completion wording exceeds the evidence.',correction:'Restrict the summary.',scope:conclusionScope}]} as any,receipt)
  const ledger={...gate.newResearchProgress(),steps:[...request.steps],reviews:[audit]},results=[...request.results,result('1.03'),result('1.04')]
  gate.recordResearchStep(ledger,results[2])
  expect(gate.progressReviewReason(ledger,'1.04')).toBe('conditional-followup')
  gate.recordResearchStep(ledger,results[3])
  const next=gate.createProgressReviewRequest({...request,ledger,results,selectedModuleIds:request.selectedModuleIds,reason:'phase-end'})
  ledger.reviews.push(gate.acceptProgressReview(next,verdict(next),{...receipt,executionId:'late',childId:'late-child'}))
  expect(()=>gate.verifyResearchProgress(ledger,results,request)).toThrow(/PROGRESS_REVIEW_ORDER/)
})
it('preserves a real partial pause while permitting explicitly scoped research and requiring a step-based follow-up',()=>{
  const request=makeRequest(),raw={...verdict(request),verdict:'pause' as const,
    conditions:verdict(request).conditions.map((c,i)=>i===1?{...c,permission:'hold' as const,scope:conclusionScope}:c)}
  const audit=gate.acceptProgressReview(request,raw,receipt)
  const ledger={version:gate.RESEARCH_PROGRESS_VERSION,everyModules:3 as const,steps:[...request.steps],reviews:[audit]}
  const summary={researchProgress:ledger,selectedModuleIds:request.selectedModuleIds,results:request.results,
    moduleRuns:request.results.map(r=>({itemId:r.itemId,status:'limited' as const}))}
  expect(audit.decision.verdict).toBe('pause')
  expect(gate.controlledResearchReady(summary),'only the explicitly allowed bounded research may proceed').toBe(true)
  gate.recordResearchStep(ledger,result('1.03'))
  expect(gate.progressReviewReason(ledger,'1.04')).toBe('conditional-followup')
  const results=[...request.results,result('1.03'),result('1.04')]
  gate.recordResearchStep(ledger,results.at(-1)!)
  const late=gate.createProgressReviewRequest({...request,taskBrief:request.taskBrief,ledger,results,reason:'phase-end'})
  ledger.reviews.push(gate.acceptProgressReview(late,verdict(late),{...receipt,executionId:'late',childId:'late-child'}))
  expect(()=>gate.verifyResearchProgress(ledger,results,{...request,taskBrief:request.taskBrief})).toThrow(/PROGRESS_REVIEW_ORDER/)
})
it('rejects an empty or unbounded conclusion scope and does not turn a hard hold or major drift into permission',()=>{
  const request=makeRequest(),raw={...verdict(request),verdict:'pause' as const,
    conditions:verdict(request).conditions.map((c,i)=>i===1?{...c,permission:'hold' as const,scope:conclusionScope}:c)}
  for(const scope of [{...conclusionScope,heldUses:[]},{...conclusionScope,allowedUses:[]},{...conclusionScope,reviewAfterModules:4}])
    expect(()=>gate.acceptProgressReview(request,{...raw,conditions:raw.conditions.map(c=>c.permission==='hold'?{...c,scope}:c)} as any,receipt)).toThrow(/PROGRESS_REVIEW_SCOPE/)
  const hard=gate.acceptProgressReview(request,{...raw,conditions:raw.conditions.map(c=>c.permission==='hold'?{...c,scope:{...conclusionScope,kind:'module-and-downstream',allowedUses:[]}}:c)} as any,receipt)
  expect(gate.controlledResearchReady({researchProgress:{version:gate.RESEARCH_PROGRESS_VERSION,everyModules:3,steps:[...request.steps],reviews:[hard]},
    selectedModuleIds:request.selectedModuleIds,results:request.results,moduleRuns:request.results.map(r=>({itemId:r.itemId,status:'limited'}))} as any)).toBe(false)
  const major=gate.acceptProgressReview(request,{...raw,driftFindings:[{severity:'major',itemIds:['1.02'],finding:'The project object changed.',correction:'Re-establish the actual object before proceeding.'}]} as any,receipt)
  expect(gate.progressDecisionAllowsResearch(major.decision)).toBe(false)
})

it('requires an explicit independent decision for every limited criterion and does not alter the original verdict',()=>{
  const request=makeRequest(),before=hash(request.results)
  const audit=gate.acceptProgressReview(request,verdict(request),receipt)
  expect(audit.decision.verdict).toBe('continue')
  expect(hash(request.results)).toBe(before)
  expect(request.results.every(r=>r.execution!.reviewReceipts!.at(-1)!.verdict==='limited')).toBe(true)
  expect(()=>gate.acceptProgressReview(request,{...verdict(request),conditions:[]},receipt)).toThrow(/PROGRESS_REVIEW_CONDITIONS/)
  expect(()=>gate.acceptProgressReview(request,verdict(request),{...receipt,childId:'review-child-1.01'})).toThrow(/PROGRESS_REVIEW_NOT_INDEPENDENT/)
})

it('rejects changed bindings, concealed holds and major drift, and strictly replays a genuine pause',()=>{
  const request=makeRequest(),raw=verdict(request)
  expect(()=>gate.acceptProgressReview(request,{...raw,requestHash:'foreign'},receipt)).toThrow(/PROGRESS_REVIEW_BINDING/)
  const held={...raw,conditions:raw.conditions.map((c,i)=>i===0?{...c,permission:'hold' as const}:c)}
  expect(()=>gate.acceptProgressReview(request,held,receipt)).toThrow(/PROGRESS_REVIEW_VERDICT/)
  const audit=gate.acceptProgressReview(request,{...held,verdict:'pause'},receipt)
  expect(()=>gate.verifyProgressReview(audit,request.results)).not.toThrow()
  expect(()=>gate.verifyProgressReview({...audit,decision:{...audit.decision,verdict:'continue'}},request.results)).toThrow()
})

it('does not release partial coverage, a stale final checkpoint or a failed overall review',()=>{
  const request=makeRequest(),audit=gate.acceptProgressReview(request,verdict(request),receipt)
  const ledger={version:gate.RESEARCH_PROGRESS_VERSION,everyModules:3 as const,steps:[...request.steps],reviews:[audit]}
  const summary={researchProgress:ledger,selectedModuleIds:['1.01','1.02'],results:request.results,
    moduleRuns:request.results.map(r=>({itemId:r.itemId,status:'limited' as const}))}
  expect(gate.controlledResearchReady(summary)).toBe(true)
  expect(gate.controlledResearchReady({...summary,selectedModuleIds:['1.01','1.02','1.03']})).toBe(false)
  expect(gate.controlledResearchReady({...summary,researchProgress:{...ledger,failure:'Global review unavailable'}})).toBe(false)
  expect(gate.controlledResearchReady({...summary,researchProgress:{...ledger,steps:[...ledger.steps,{itemId:'1.03',contentHash:'c',resultHash:'r'}]}})).toBe(false)
})

it('rejects replayed reviewer identities, incomplete checkpoint coverage and a changed selection',()=>{
  const request=makeRequest(),first=gate.acceptProgressReview(request,verdict(request),receipt)
  const ledger={version:gate.RESEARCH_PROGRESS_VERSION,everyModules:3 as const,steps:[...request.steps],reviews:[first]}
  const identity={projectId:'p',snapshotId:'s',snapshotHash:'sh',catalogHash:'cat',planHash:'plan',taskBrief:request.taskBrief,selectedModuleIds:request.selectedModuleIds}
  const next=gate.createProgressReviewRequest({...identity,results:request.results,ledger,reason:'phase-end'})
  const repeated=gate.acceptProgressReview(next,verdict(next),receipt)
  expect(()=>gate.verifyResearchProgress({...ledger,reviews:[first,repeated]},request.results,identity)).toThrow(/PROGRESS_REVIEW_NOT_INDEPENDENT/)
  const omitted=gate.createProgressReviewRequest({...identity,results:request.results.slice(0,1),ledger:gate.newResearchProgress(),reason:'phase-end'})
  const incomplete=gate.acceptProgressReview(omitted,verdict(omitted),{...receipt,executionId:'other',childId:'other-child'})
  const summary={researchProgress:{...ledger,reviews:[incomplete]},selectedModuleIds:identity.selectedModuleIds,results:request.results,
    moduleRuns:request.results.map(r=>({itemId:r.itemId,status:'limited' as const}))}
  expect(gate.controlledResearchReady(summary)).toBe(false)
  expect(()=>gate.verifyResearchProgress(ledger,request.results,{...identity,selectedModuleIds:['1.01']})).toThrow(/PROGRESS_REVIEW_SELECTION/)
})
