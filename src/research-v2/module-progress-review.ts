import {sha256CanonicalJson as hash} from '../presentation/canonical-json.ts'
import type {ModuleExecutionResult,ModuleNativeExecutionReceipt,ModuleExecutionSummary} from './module-execution.ts'

export const RESEARCH_PROGRESS_VERSION='research-progress-review.v1' as const
export type ProgressReviewReason='three-modules'|'conditional-followup'|'chapter-boundary'|'premise-change'|'phase-end'|'baseline'
export interface ResearchConditionScope {
  readonly kind:'none'|'conclusions'|'module-and-downstream'
  readonly allowedUses:readonly string[];readonly heldUses:readonly string[];readonly reviewAfterModules:1|2|3
}
export interface ResearchStep {readonly itemId:string;readonly contentHash:string;readonly resultHash:string}
export interface RequiredResearchCondition {readonly itemId:string;readonly criterion:string}
export interface ProgressReviewDecision {
  readonly requestHash:string;readonly verdict:'continue'|'pause';readonly rationale:string
  readonly conditions:readonly (RequiredResearchCondition & {readonly permission:'proceed'|'hold';readonly reason:string;readonly verification:string;readonly scope?:ResearchConditionScope})[]
  readonly driftFindings:readonly {readonly severity:'notice'|'major';readonly itemIds:readonly string[];readonly finding:string;readonly correction:string;
    /** Absent on historical decisions: a legacy major remains a hard stop. */
    readonly scope?:ResearchConditionScope}[]
}
export interface ProgressReviewBinding {
  readonly version:typeof RESEARCH_PROGRESS_VERSION;readonly projectId:string;readonly snapshotId:string;readonly snapshotHash:string
  /** New reviews assess produced work; absent on immutable legacy receipts. */
  readonly driftScope?:'produced-results'
  readonly catalogHash:string;readonly planHash:string;readonly taskBriefHash:string;readonly selectedModuleIds:readonly string[]
  readonly everyModules:3;readonly afterStep:number;readonly reason:ProgressReviewReason;readonly steps:readonly ResearchStep[]
  readonly resultRefs:readonly {readonly itemId:string;readonly resultHash:string}[]
  readonly previousReviewHashes:readonly string[];readonly requiredConditions:readonly RequiredResearchCondition[];readonly requestHash:string
  readonly premiseHash:string
}
export interface ProgressReviewRequest extends ProgressReviewBinding {
  readonly taskBrief:string;readonly results:readonly ModuleExecutionResult[]
  /** Input-only reference. Its hash is already bound by previousReviewHashes. */
  readonly previousReview?:ProgressReviewReceipt
}
export interface ProgressReviewReceipt {readonly binding:ProgressReviewBinding;readonly decision:ProgressReviewDecision;readonly execution:ModuleNativeExecutionReceipt;readonly hash:string;readonly attempts?:readonly unknown[]}
export interface ResearchProgress {readonly version:typeof RESEARCH_PROGRESS_VERSION;readonly everyModules:3;steps:ResearchStep[];reviews:ProgressReviewReceipt[];failure?:string;cancelled?:true}
export interface ModuleResearchRestrictions {
  readonly version:'module-research-restrictions.v1'|'module-research-restrictions.v2';readonly reviewHash:string
  readonly conditions:readonly (RequiredResearchCondition & {readonly scope:ResearchConditionScope})[];readonly hash:string
}
const fail=(code:string):never=>{throw new Error(code)}
const text=(x:unknown):x is string=>typeof x==='string'&&x.trim().length>0
const key=(x:RequiredResearchCondition)=>JSON.stringify([x.itemId,x.criterion])

export function newResearchProgress():ResearchProgress{return {version:RESEARCH_PROGRESS_VERSION,everyModules:3,steps:[],reviews:[]}}
export function researchContentHash(result:ModuleExecutionResult):string{
  return hash({itemId:result.itemId,outputs:result.outputs,claims:result.claims,sourceValues:result.sourceValues,limitations:result.limitations})
}
/** A new receipt for the same professional content is not another research step. */
export function recordResearchStep(ledger:ResearchProgress,result:ModuleExecutionResult):boolean{
  const contentHash=researchContentHash(result)
  if(ledger.steps.some(step=>step.itemId===result.itemId&&step.contentHash===contentHash))return false
  ledger.steps.push({itemId:result.itemId,contentHash,resultHash:hash(result)});return true
}
const premiseHash=(results:readonly ModuleExecutionResult[])=>hash(results.filter(r=>['1.01','1.02'].includes(r.itemId)).map(r=>({itemId:r.itemId,contentHash:researchContentHash(r)})))
export function progressReviewReason(ledger:ResearchProgress,nextItemId?:string,finished=false,results?:readonly ModuleExecutionResult[]):ProgressReviewReason|undefined{
  const last=ledger.reviews.at(-1),pending=ledger.steps.length-(last?.binding.afterStep??0)
  if(finished)return 'phase-end'
  if(last&&results&&last.binding.premiseHash!==premiseHash(results))return 'premise-change'
  const due=last?scopedResearchConditions(last.decision).map(c=>c.scope.reviewAfterModules):[]
  if(due.length&&pending>=Math.min(...due))return 'conditional-followup'
  if(pending>=ledger.everyModules)return 'three-modules'
  const prior=ledger.steps.at(-1)?.itemId
  if(pending&&prior&&nextItemId&&prior.split('.')[0]!==nextItemId.split('.')[0])return 'chapter-boundary'
  return undefined
}
function conditions(results:readonly ModuleExecutionResult[]):RequiredResearchCondition[]{
  return results.flatMap(result=>{
    const review=result.execution?.reviewReceipts?.at(-1)
    if(!review||review.checks.some(c=>c.status==='fail'))return fail('PROGRESS_REVIEW_NATIVE_MODULE_REQUIRED')
    return review.checks.filter(c=>c.status==='limited').map(c=>({itemId:result.itemId,criterion:c.criterion}))
  })
}
export function createProgressReviewRequest(input:{projectId:string;snapshotId:string;snapshotHash:string;catalogHash:string;planHash:string;
  taskBrief:string;selectedModuleIds:readonly string[];results:readonly ModuleExecutionResult[];ledger:ResearchProgress;reason:ProgressReviewReason}):ProgressReviewRequest{
  if(!input.results.length||input.results.some(r=>r.projectId!==input.projectId)||new Set(input.results.map(r=>r.itemId)).size!==input.results.length)fail('PROGRESS_REVIEW_INPUTS')
  const requiredConditions=conditions(input.results)
  const core={version:RESEARCH_PROGRESS_VERSION,driftScope:'produced-results' as const,projectId:input.projectId,snapshotId:input.snapshotId,snapshotHash:input.snapshotHash,
    catalogHash:input.catalogHash,planHash:input.planHash,taskBriefHash:hash(input.taskBrief),selectedModuleIds:[...input.selectedModuleIds],
    everyModules:3 as const,afterStep:input.ledger.steps.length,reason:input.reason,steps:structuredClone(input.ledger.steps),
    resultRefs:input.results.map(r=>({itemId:r.itemId,resultHash:hash(r)})),previousReviewHashes:input.ledger.reviews.map(r=>r.hash),requiredConditions,premiseHash:premiseHash(input.results)}
  const previousReview=input.ledger.reviews.at(-1)
  return {...core,requestHash:hash(core),taskBrief:input.taskBrief,results:input.results,
    ...(previousReview?{previousReview:structuredClone(previousReview)}:{})}
}
function validateScope(s:ResearchConditionScope,hold:boolean):void{
  if(!s||!['none','conclusions','module-and-downstream'].includes(s.kind)||![1,2,3].includes(s.reviewAfterModules)
    ||!Array.isArray(s.allowedUses)||!Array.isArray(s.heldUses)||[...s.allowedUses,...s.heldUses].some(v=>!text(v))
    ||!hold&&(s.kind!=='none'||s.allowedUses.length>0||s.heldUses.length>0)
    ||hold&&(s.kind==='none'||!s.heldUses.length||s.kind==='conclusions'&&!s.allowedUses.length
      ||s.kind==='module-and-downstream'&&s.allowedUses.length>0))fail('PROGRESS_REVIEW_SCOPE')
}
function validateDecision(binding:ProgressReviewBinding,decision:ProgressReviewDecision):void{
  if(decision.requestHash!==binding.requestHash)fail('PROGRESS_REVIEW_BINDING')
  if(!text(decision.rationale)||!Array.isArray(decision.conditions)||!Array.isArray(decision.driftFindings))fail('PROGRESS_REVIEW_DECISION')
  const expected=new Set(binding.requiredConditions.map(key)),seen=new Set<string>()
  for(const c of decision.conditions){
    if(!expected.has(key(c))||seen.has(key(c))||!['proceed','hold'].includes(c.permission)||!text(c.reason)||!text(c.verification))fail('PROGRESS_REVIEW_CONDITIONS')
    if(c.scope!==undefined)validateScope(c.scope,c.permission==='hold')
    seen.add(key(c))
  }
  if(seen.size!==expected.size)fail('PROGRESS_REVIEW_CONDITIONS')
  if(binding.driftScope!==undefined&&binding.driftScope!=='produced-results')fail('PROGRESS_REVIEW_BINDING')
  const reviewed=binding.driftScope==='produced-results'?binding.resultRefs.map(ref=>ref.itemId):binding.selectedModuleIds
  for(const f of decision.driftFindings){
    if(!['notice','major'].includes(f.severity)||!f.itemIds.length||f.itemIds.some(id=>!reviewed.includes(id))
      ||!text(f.finding)||!text(f.correction))fail('PROGRESS_REVIEW_DRIFT')
    if(f.scope!==undefined)validateScope(f.scope,f.severity==='major')
  }
  const pause=decision.conditions.some(c=>c.permission==='hold')||decision.driftFindings.some(f=>f.severity==='major')
  if(decision.verdict!==(pause?'pause':'continue'))fail('PROGRESS_REVIEW_VERDICT')
}
/** A held conclusion stays held; only explicitly permitted uses can continue. Legacy holds remain hard stops. */
export function progressDecisionAllowsResearch(decision:ProgressReviewDecision):boolean{
  return progressBlockedModuleIds(decision).length===0
}
/** Severity does not widen a reviewer's explicit scope. Never infer a scope for legacy findings. */
export function progressBlockedModuleIds(decision:ProgressReviewDecision):readonly string[]{
  return [...new Set([
    ...decision.conditions.filter(c=>c.permission==='hold'&&c.scope?.kind!=='conclusions').map(c=>c.itemId),
    ...decision.driftFindings.filter(f=>f.severity==='major'&&f.scope?.kind!=='conclusions').flatMap(f=>f.itemIds),
  ])]
}
function scopedResearchConditions(decision:ProgressReviewDecision):ModuleResearchRestrictions['conditions']{
  return [
    ...decision.conditions.filter(c=>c.permission==='hold'&&c.scope?.kind==='conclusions').map(({itemId,criterion,scope})=>({itemId,criterion,scope:scope!})),
    ...decision.driftFindings.filter(f=>f.severity==='major'&&f.scope?.kind==='conclusions').flatMap(f=>f.itemIds.map(itemId=>({
      itemId,criterion:`纠正整体回看偏移：${f.finding}；修订要求：${f.correction}`,scope:f.scope!,
    }))),
  ]
}
export function moduleResearchRestrictions(receipt:ProgressReviewReceipt|undefined,
 version:ModuleResearchRestrictions['version']='module-research-restrictions.v2'):ModuleResearchRestrictions|undefined{
  const conditions=receipt?scopedResearchConditions(receipt.decision):[]
  if(!conditions.length||!receipt)return undefined
  const core={version,reviewHash:receipt.hash,conditions:structuredClone(conditions)}
  return {...core,hash:hash(core)}
}
export function researchRestrictionCriteria(audit:ModuleResearchRestrictions|undefined):readonly string[]{
  if(!audit)return []
  const {hash:expected,...core}=audit
  if(!['module-research-restrictions.v1','module-research-restrictions.v2'].includes(audit.version)||!text(audit.reviewHash)||!audit.conditions.length||hash(core)!==expected
    ||audit.conditions.some(c=>c.scope.kind!=='conclusions'||![1,2,3].includes(c.scope.reviewAfterModules)
      ||!c.scope.allowedUses.length||!c.scope.heldUses.length||[...c.scope.allowedUses,...c.scope.heldUses].some(v=>!text(v))))fail('MODULE_RESEARCH_RESTRICTIONS_INVALID')
  if(audit.version==='module-research-restrictions.v1')return [`遵守整体回看 ${audit.hash} 的结论和用途限制；不将暂停用途表述为已核事实、获批或可实施结论。`]
  return [
    `遵守整体回看 ${audit.hash} 的允许用途，核验用途内研究依据；不足时保留limited及具体缺口，不宣称研究闭合。`,
    `遵守整体回看 ${audit.hash} 的暂停用途并完整继承限制；不将暂停用途表述为已核事实、获批或可实施结论。`,
  ]
}
/** Evidence-limited draft research may continue; held-use boundaries still need
 * a separate pass. Legacy combined checks retain their original hard gate. */
export function unverifiedResearchRestrictionCriteria(audit:ModuleResearchRestrictions|undefined,
 checks:readonly {readonly criterion:string;readonly status:'pass'|'limited'|'fail'}[]):readonly string[]{
  return researchRestrictionCriteria(audit).filter((criterion,index)=>!checks.some(check=>check.criterion===criterion
    &&(check.status==='pass'||audit?.version==='module-research-restrictions.v2'&&index===0&&check.status==='limited')))
}
export function acceptProgressReview(request:ProgressReviewRequest,decision:ProgressReviewDecision,execution:ModuleNativeExecutionReceipt,attempts?:readonly unknown[]):ProgressReviewReceipt{
  const {taskBrief:_task,results,previousReview:_previous,...binding}=request
  validateDecision(binding,decision)
  const used=results.flatMap(r=>{
    const e=r.execution!;return [e,...(e.kind==='author-field-groups-v3'?e.authorGroups.groups.map(g=>g.receipt):[]),...(e.synthesis?[e.synthesis.execution]:[]),...(e.reviewReceipts??[])]
  })
  if(!text(execution.executionId)||!text(execution.childId)||!text(execution.actualModel?.provider)||!text(execution.actualModel?.model)||execution.stopReason!=='completed'
    ||used.some(r=>r.executionId===execution.executionId||r.childId===execution.childId))fail('PROGRESS_REVIEW_NOT_INDEPENDENT')
  if(attempts){
    const matches=attempts.filter((a):a is Record<string,unknown>=>Boolean(a)&&typeof a==='object'&&(a as Record<string,unknown>).executionId===execution.executionId)
    if(matches.length!==1||matches[0].classId!=='review'||matches[0].status!=='completed'||matches[0].childId!==execution.childId
      ||matches[0].structuredHash!==hash(decision)||hash(matches[0].structuredOutput)!==hash(decision))fail('PROGRESS_REVIEW_NATIVE_DECISION')
  }
  const core={binding:structuredClone(binding),decision:structuredClone(decision),execution:structuredClone(execution),...(attempts?{attempts:structuredClone(attempts)}:{})}
  return {...core,hash:hash(core)}
}
function verifyProgressReviewWithResultHash(receipt:ProgressReviewReceipt,results:readonly ModuleExecutionResult[],resultHash:(result:ModuleExecutionResult)=>string):void{
  const {requestHash,...core}=receipt.binding
  if(receipt.binding.version!==RESEARCH_PROGRESS_VERSION||receipt.binding.everyModules!==3||hash(core)!==requestHash)fail('PROGRESS_REVIEW_BINDING')
  const selected=receipt.binding.resultRefs.map(ref=>{
    const r=results.find(x=>x.itemId===ref.itemId)
    if(!r||r.projectId!==receipt.binding.projectId||resultHash(r)!==ref.resultHash)fail('PROGRESS_REVIEW_RESULT_CHANGED')
    return r!
  })
  if(hash(conditions(selected))!==hash(receipt.binding.requiredConditions))fail('PROGRESS_REVIEW_CONDITIONS')
  if(premiseHash(selected)!==receipt.binding.premiseHash)fail('PROGRESS_REVIEW_BINDING')
  const replay=acceptProgressReview({...receipt.binding,taskBrief:'',results:selected},receipt.decision,receipt.execution,receipt.attempts)
  if(hash(replay)!==hash(receipt))fail('PROGRESS_REVIEW_RECEIPT_CHANGED')
}
export function verifyProgressReview(receipt:ProgressReviewReceipt,results:readonly ModuleExecutionResult[]):void{
  verifyProgressReviewWithResultHash(receipt,results,hash)
}
export function verifyResearchProgress(ledger:ResearchProgress,results:readonly ModuleExecutionResult[],identity:{projectId:string;snapshotId:string;snapshotHash:string;catalogHash:string;planHash:string;taskBrief?:string;taskBriefHash?:string;selectedModuleIds?:readonly string[]}):void{
  // All reviews in this synchronous replay refer to the same result objects.
  // Hash each once here, with a fresh cache on every invocation so later edits
  // still invalidate their receipts. Review order, conditions and decisions
  // are independently rechecked exactly as before.
  const hashes=new Map<ModuleExecutionResult,string>()
  const resultHash=(result:ModuleExecutionResult)=>{let digest=hashes.get(result);if(digest===undefined){digest=hash(result);hashes.set(result,digest)}return digest}
  if(ledger.version!==RESEARCH_PROGRESS_VERSION||ledger.everyModules!==3)fail('PROGRESS_REVIEW_POLICY')
  if(new Set(ledger.steps.map(s=>JSON.stringify([s.itemId,s.contentHash]))).size!==ledger.steps.length)fail('PROGRESS_REVIEW_STEP_CHANGED')
  for(const step of ledger.steps){const r=results.find(r=>r.itemId===step.itemId);if(!r||step.resultHash!==resultHash(r)||step.contentHash!==researchContentHash(r))fail('PROGRESS_REVIEW_STEP_CHANGED')}
  let after=0,maxGap=3;const seen:string[]=[],executions=new Set<string>(),children=new Set<string>()
  for(const r of ledger.reviews){
    verifyProgressReviewWithResultHash(r,results,resultHash)
    if(executions.has(r.execution.executionId)||children.has(r.execution.childId))fail('PROGRESS_REVIEW_NOT_INDEPENDENT')
    executions.add(r.execution.executionId);children.add(r.execution.childId)
    if(identity.selectedModuleIds&&hash(r.binding.selectedModuleIds)!==hash(identity.selectedModuleIds))fail('PROGRESS_REVIEW_SELECTION')
    if(new Set(r.binding.resultRefs.map(ref=>ref.itemId)).size!==r.binding.resultRefs.length
      ||r.binding.steps.some(step=>!r.binding.resultRefs.some(ref=>ref.itemId===step.itemId&&ref.resultHash===step.resultHash)))fail('PROGRESS_REVIEW_COVERAGE')
    if(r.binding.afterStep<after||r.binding.afterStep-after>maxGap||r.binding.afterStep>ledger.steps.length||hash(r.binding.steps)!==hash(ledger.steps.slice(0,r.binding.afterStep))
      ||hash(r.binding.previousReviewHashes)!==hash(seen))fail('PROGRESS_REVIEW_ORDER')
    for(const k of ['projectId','snapshotId','snapshotHash','catalogHash','planHash'] as const)if(r.binding[k]!==identity[k])fail('PROGRESS_REVIEW_BINDING')
    if(r.binding.taskBriefHash!==(identity.taskBriefHash??hash(identity.taskBrief??'')))fail('PROGRESS_REVIEW_BINDING')
    const due=scopedResearchConditions(r.decision).map(c=>c.scope.reviewAfterModules)
    maxGap=Math.min(3,...due);after=r.binding.afterStep;seen.push(r.hash)
  }
}

/** A resume may use only the immutable, already verified review-history prefix
 * whose exact results are present now. This supplies context to a NEW native
 * review; it never imports an old failure flag or grants old permissions. */
export function reuseResearchProgressForBaseline(current:ResearchProgress,previous:ResearchProgress|undefined,
 results:readonly ModuleExecutionResult[],identity:Parameters<typeof verifyResearchProgress>[2]):boolean{
 if(current.reviews.length||!previous?.reviews.length)return false
 if(identity.taskBrief!==undefined&&identity.taskBriefHash!==undefined&&identity.taskBriefHash!==hash(identity.taskBrief))return false
 for(let count=previous.reviews.length;count>0;count--){
  const last=previous.reviews[count-1]
  const replay:ResearchProgress={version:previous.version,everyModules:previous.everyModules,
   steps:structuredClone(previous.steps.slice(0,last.binding.afterStep)),reviews:structuredClone(previous.reviews.slice(0,count))}
  for(const step of current.steps)if(!replay.steps.some(saved=>saved.itemId===step.itemId&&saved.contentHash===step.contentHash))replay.steps.push(structuredClone(step))
  try{verifyResearchProgress(replay,results,identity)}catch{continue}
  current.steps=replay.steps;current.reviews=replay.reviews
  return true
 }
 return false
}
/** This permits a reviewed conditional draft. Individual limited statuses stay limited. */
export function controlledResearchReady(summary:Pick<ModuleExecutionSummary,'selectedModuleIds'|'moduleRuns'|'results'> & {readonly researchProgress?:ResearchProgress}):boolean{
  const final=summary.researchProgress?.reviews.at(-1)
  try{if(!final||!summary.researchProgress)return false;verifyResearchProgress(summary.researchProgress,summary.results,
    {...final.binding,selectedModuleIds:summary.selectedModuleIds})}catch{return false}
  return Boolean(!summary.researchProgress?.failure&&!summary.researchProgress?.cancelled&&final&&final.binding.reason==='phase-end'&&progressDecisionAllowsResearch(final.decision)
    &&final.binding.afterStep===summary.researchProgress!.steps.length
    &&summary.moduleRuns.length===summary.selectedModuleIds.length&&summary.results.length===summary.selectedModuleIds.length
    &&summary.moduleRuns.every(r=>['completed','limited'].includes(r.status))
    &&new Set(summary.results.map(r=>r.itemId)).size===summary.results.length&&new Set(summary.moduleRuns.map(r=>r.itemId)).size===summary.moduleRuns.length
    &&hash(summary.moduleRuns.map(r=>r.itemId).sort())===hash([...summary.selectedModuleIds].sort())
    &&hash(final.binding.resultRefs.map(r=>r.itemId).sort())===hash([...summary.selectedModuleIds].sort()))
}
