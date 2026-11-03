import {expect,it} from 'vitest'
import {createHash} from 'node:crypto'
import {newResearchProgress,createProgressReviewRequest,acceptProgressReview,verifyProgressReview,type ProgressReviewRequest} from '../src/research-v2/module-progress-review.ts'
import {progressReviewPrompt,progressReviewSchema} from '../src/research-v2/native-progress-review.ts'
import {moduleReferencePromptView,expandModuleReferencePromptView,shareNativeModulePrompt} from '../src/research-v2/module-reference-context.ts'
import {assertNativeModuleContext} from '../src/research-v2/native-module-context-budget.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const detail=Array.from({length:2000},(_,i)=>createHash('sha256').update('private detail '+i).digest('hex')).join('')
function moduleResult(itemId:string,synthesized=true):any {
 const primary='primary-'+itemId,support='support-'+itemId
 const value={itemId,projectId:'p',outputs:{port:{quality:'limited',limitations:['Site permission remains a note'],records:[]}},
  claims:[{claimId:primary,kind:'proposal',value:'Organize a water protection service',rationale:'A proposed service, not an existing operation'},
   {claimId:support,kind:'source',value:detail,rationale:'Previously checked supporting field'}],limitations:['Site permission remains a note'],
  execution:{executionId:'author-'+itemId,childId:'author-child-'+itemId,reviewReceipts:[{executionId:'review-'+itemId,childId:'review-child-'+itemId,
   verdict:'limited',checks:[{criterion:'Verify site permission',status:'limited',rationale:'Implementation permission awaits human confirmation',claimRefs:[primary]}]}]}} as any
 if(synthesized)value.execution.synthesis={judgment:{version:'module-research-synthesis.v3',candidateHash:'candidate',limitationBasisHash:'basis',
  analysis:'The protection service supplies public knowledge',conclusion:'Organize a water protection service',claimRefs:[primary],
  steps:[1,2,3,4].map(step=>({step,status:'limited',summary:'Detailed field verification '+detail,claimRefs:[support],limitations:['Implementation permission awaits confirmation']})),
  handoff:[{moduleId:'5.07',use:'Develop the service activity and route',claimRefs:[primary],conditions:['Confirm access before implementation']}],limitations:['Site permission remains a note']},
  execution:{executionId:'synthesis-'+itemId,childId:'synthesis-child-'+itemId}}
 return value
}
function setup(synthesized=true){
 const prior=moduleResult('5.06',synthesized),ledger=newResearchProgress()
 const identity={projectId:'p',snapshotId:'s',snapshotHash:'snapshot',catalogHash:'catalog',planHash:'plan',taskBrief:'Create the proposed client report',selectedModuleIds:['5.06','5.07']}
 const initial=createProgressReviewRequest({...identity,results:[prior],ledger,reason:'baseline'})
 const decision:any={requestHash:initial.requestHash,verdict:'pause',rationale:'Continue the proposed service; verify its implementation permission',
  conditions:[{itemId:'5.06',criterion:'Verify site permission',permission:'hold',reason:'Permission is not verified',verification:'Review after three substantive modules',
   scope:{kind:'conclusions',allowedUses:['Proposed service and client report'],heldUses:['Approved implementation'],reviewAfterModules:3}}],driftFindings:[]}
 ledger.reviews.push(acceptProgressReview(initial,decision,{executionId:'previous-global',childId:'previous-global-child',actualModel:{provider:'native',model:'reviewer'},stopReason:'completed'}))
 const next=moduleResult('5.07');next.claims[1].value='A newly checked supporting fact';next.execution.synthesis.judgment.steps.forEach((step:any)=>{step.summary='New module step';step.claimRefs=['support-5.07']})
 return {prior,next,ledger,identity,request:createProgressReviewRequest({...identity,results:[prior,next],ledger,reason:'three-modules'})}
}
const payload=(request:ProgressReviewRequest)=>JSON.parse(progressReviewPrompt(request).split('\n').at(-1)!)

it('reuses verified unchanged directions while leaving new module meanings, current QA and conditions complete',()=>{
 const {prior,next,ledger,request}=setup(),before=hash([prior,next,ledger]),view=payload(request).progressReview
 expect(view.previousReview.hash).toBe(ledger.reviews[0].hash)
 expect(view.previousReview.decision.conditions[0].scope.heldUses).toEqual(['Approved implementation'])
 expect(view.modules[0].reusedReviewHash).toBe(ledger.reviews[0].hash)
 expect(view.modules[0].judgment.conclusion).toBe('Organize a water protection service')
 expect(view.modules[0].judgment.handoff[0].conditions).toEqual(['Confirm access before implementation'])
 expect(view.modules[0].claimSemantics).toEqual([prior.claims[0]])
 expect(view.modules[0].review).toEqual(prior.execution.reviewReceipts[0])
 expect(view.modules[1].claimSemantics).toEqual(next.claims)
 expect(view.binding.requiredConditions).toEqual([{itemId:'5.06',criterion:'Verify site permission'},{itemId:'5.07',criterion:'Verify site permission'}])
 expect(hash([prior,next,ledger])).toBe(before)
})

it('admits the incremental complete decision without rereading unchanged field details in every call',()=>{
 const {request}=setup(),prompt=shareNativeModulePrompt(progressReviewPrompt(request))
 expect(()=>assertNativeModuleContext({contextWindow:90000,outputTokenLimit:12000},prompt,JSON.stringify(progressReviewSchema(request)),[])).not.toThrow()
})

it.each(['result','snapshot','task','receipt'] as const)('does not reuse a prior direction after %s changes',kind=>{
 const {prior,next,ledger,identity}=setup()
 if(kind==='result')prior.claims[0].value='A changed direction'
 if(kind==='snapshot')identity.snapshotHash='different snapshot'
 if(kind==='task')identity.taskBrief='A different client objective'
 if(kind==='receipt')ledger.reviews[0]={...ledger.reviews[0],decision:{...ledger.reviews[0].decision,rationale:'Forged earlier approval'}}
 const request=createProgressReviewRequest({...identity,results:[prior,next],ledger,reason:'three-modules'}),view=payload(request).progressReview
 expect(view.modules[0].reusedReviewHash).toBeUndefined()
 expect(view.modules[0].claimSemantics).toEqual(prior.claims)
 expect(view.modules[0].judgment.steps[0].summary).toBe('Detailed field verification '+detail)
})

it('keeps a historical result without integrated judgment fully visible even when an earlier review exists',()=>{
 const {prior,request}=setup(false),view=payload(request).progressReview
 expect(view.modules[0].claimSemantics).toEqual(prior.claims)
 expect(view.modules[0].judgment.legacyCandidate).toBe(true)
})

it('preserves a replayable new receipt binding and does not inherit the previous hold decision',()=>{
 const {request}=setup(),decision:any={requestHash:request.requestHash,verdict:'continue',rationale:'Proceed with the proposed services; keep permission checks in page notes',
  conditions:request.requiredConditions.map(row=>({...row,permission:'proceed',reason:'Proposed reporting is supported',verification:'Confirm implementation permission before use',
   scope:{kind:'none',allowedUses:[],heldUses:[],reviewAfterModules:3}})),driftFindings:[]}
 const receipt=acceptProgressReview(request,decision,{executionId:'next-global',childId:'next-global-child',actualModel:{provider:'native',model:'reviewer'},stopReason:'completed'})
 expect(()=>verifyProgressReview(receipt,request.results)).not.toThrow()
 expect(receipt.decision.verdict).toBe('continue')
})

it('uses profitable exact request sharing even when the saving is below ten percent, while frozen inputs stay stable',()=>{
 const input={orderedNativeInput:Array.from({length:16},(_,index)=>({json:{kind:'native input',initialPolicy:'The unchanged native source and its original qualification remain bound to the previous receipt. '.repeat(60),value:'Repeated direction premise: original source fields stay bound to the native receipt and remain unchanged during the direction review. '+Array.from({length:300},(_,i)=>createHash('sha256').update(index+' unique '+i).digest('hex')).join('')}}))}
 const view:any=moduleReferencePromptView(input,true)
 expect(view.encoding).toBe('research-reference.v2')
 expect(expandModuleReferencePromptView(view)).toEqual(input)
 expect(expandModuleReferencePromptView(moduleReferencePromptView({sources:input.orderedNativeInput},true))).toEqual({sources:input.orderedNativeInput})
})
