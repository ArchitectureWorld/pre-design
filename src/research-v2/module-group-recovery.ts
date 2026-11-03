import type { Agent } from '@deepseek-ai/dsh-agent'
import { matchesModelRoute } from '../agent-classes/model-options.ts'
import type { LlmRoute } from '../agent-classes/types.ts'
import { nativeAvailabilityFailure, type AgentClassService } from '../agent-classes/service.ts'
import { sha256CanonicalJson as hash } from '../presentation/canonical-json.ts'
import type { SessionEventLike } from '../visual/session-image-collector.ts'
import { isCurrentModuleAuthorPrefix, getModuleAuthorExecutionFieldGroups, validateModuleAuthorGroup, type ModuleAuthorGroupSubmission } from './module-author-groups.ts'
import type { ModuleAnalysisContext, ModuleNativeExecutionReceipt } from './module-execution.ts'
import { moduleUpstreamReferenceDiagnostics } from './module-upstream-reference-diagnostics.ts'
import { moduleInferenceBasisDiagnostics } from './module-inference-basis-diagnostics.ts'
import { moduleCalculationResultConflicts, moduleProjectionUnitConflicts, moduleScenarioCalculationRationaleConflicts } from './module-author-projection.ts'
import { moduleClaimCycleConflicts } from './module-claim-cycle-diagnostics.ts'
import {assertProjectTaskFieldBindings,verifyProjectTaskAudit,projectTaskHandoffReplayAllowed} from './project-task-audit.ts'
import {compileModuleAuthorGroups} from './module-author-groups.ts'
import {researchRestrictionCriteria,type ModuleResearchRestrictions} from './module-progress-review.ts'
import {readNativeModuleJsonWireSchema,decodeNativeModuleJsonWire} from './native-submission-wire.ts'
import {expandModuleReferencePromptView} from './module-reference-context.ts'

export type ModuleNativeEventReader = (childId: string) => Promise<readonly SessionEventLike[] | undefined>
type FrozenSourceBudget={readonly maxMaterialChars:number;readonly maxMaterialUtf8Bytes?:number;readonly materialByteEncoding?:'readonly-reference'}
export function moduleAuthorFrozenSourceBudget(recorded:unknown,events:readonly SessionEventLike[]):
  FrozenSourceBudget|undefined {
  if(typeof recorded!=='string'||!/^[a-f0-9]{64}$/u.test(recorded))return
  const budgets=new Map<string,FrozenSourceBudget>()
  function expand(value:any):any{
    if(Array.isArray(value))return value.map(expand)
    if(value&&typeof value==='object'){
      if(['research-reference.v1','research-reference.v2'].includes(value.encoding))return expand(expandModuleReferencePromptView(value))
      return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,expand(child)]))
    }
    return value
  }
  function inspect(value:any):void{
    if(Array.isArray(value)){value.forEach(inspect);return}
    if(!value||typeof value!=='object')return
    const source=value.sources,selection=source?.corpus?.selection
    if(selection?.method==='whole-source-span-v3'&&moduleAuthorSourceFingerprintMatches(recorded,source,events)
      &&Number.isSafeInteger(selection.maxMaterialChars)&&selection.maxMaterialChars>0
      &&(selection.maxMaterialUtf8Bytes===undefined||Number.isSafeInteger(selection.maxMaterialUtf8Bytes)&&selection.maxMaterialUtf8Bytes>0)
      &&(selection.materialByteEncoding===undefined||selection.materialByteEncoding==='readonly-reference')){
      const budget={maxMaterialChars:selection.maxMaterialChars,...(selection.maxMaterialUtf8Bytes===undefined?{}:{maxMaterialUtf8Bytes:selection.maxMaterialUtf8Bytes}),
        ...(selection.materialByteEncoding===undefined?{}:{materialByteEncoding:selection.materialByteEncoding})}
      budgets.set(hash(budget),budget)
    }
    Object.values(value).forEach(inspect)
  }
  for(const event of events.filter(event=>event.type==='user/message')){
    const content=(event.data as {content?:readonly {type:string;text?:string}[]}|undefined)?.content
    for(const block of content??[])if(block.type==='text'&&typeof block.text==='string')for(const line of block.text.split('\n')){
      try{inspect(expand(JSON.parse(line)))}catch{/* Invalid or unrelated text cannot supply a frozen budget. */}
    }
  }
  return budgets.size===1?[...budgets.values()][0]:undefined
}
export function verifyModuleNativeSubmission(events:readonly {readonly seq?:number;readonly type:string;readonly data:unknown}[],route:LlmRoute,raw:unknown):void {
  // The strict verifier rejects absent or invalid native sequence numbers; the adapter does not create them.
  verifySubmission(events as readonly SessionEventLike[],route,raw)
}
const fail = (detail: string): never => { throw new Error(`MODULE_GROUP_RECOVERY_INVALID: ${detail}`) }
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

/** Old scoped runs mixed review wording into the material fingerprint. Prove
 * their exact frozen source view from the actual native request, without
 * treating the old restriction or fingerprint as current permission. */
export function moduleAuthorSourceFingerprintMatches(recorded:unknown,sources:unknown,events?:readonly SessionEventLike[]):boolean {
  if(recorded===hash(sources))return true
  if(!events)return false
  const strings=(value:unknown):string[]=>typeof value==='string'?[value]:value&&typeof value==='object'?Object.values(value).flatMap(strings):[]
  const originals=new Map<string,ModuleResearchRestrictions>()
  for(const line of events.filter(e=>e.type==='user/message').flatMap(e=>strings(e.data)).flatMap(s=>s.split('\n'))){
    if(!line.startsWith('{"researchRestrictions":'))continue
    try{
      const parsed=JSON.parse(line)
      if(Object.keys(parsed).length!==1)return false
      const audit=parsed.researchRestrictions as ModuleResearchRestrictions
      researchRestrictionCriteria(audit)
      originals.set(hash(audit),audit)
    }catch{return false}
  }
  if(originals.size!==1)return false
  return recorded===hash({sources,restrictions:[...originals.values()][0].conditions})
}

function verifySubmission(events: readonly SessionEventLike[], route: LlmRoute, raw: unknown): void {
  if (events.some((e, i) => !Number.isSafeInteger(e.seq) || i > 0 && e.seq <= events[i - 1].seq)) return fail('native sequence')
  const start = events.findLastIndex(e => e.type === 'turn/start')
  if (start < 0) return fail('native turn missing')
  const current = events.slice(start), turn = object(events[start].data).turn
  if (!Number.isSafeInteger(turn)) return fail('native turn identity')
  const terminal = current.findLast(e => e.type === 'turn/end')
  if (!terminal || object(terminal.data).turn !== turn || object(object(terminal.data).reason).kind !== 'completed') return fail('native terminal')
  const calls = current.filter(e => e.type === 'tool/call' && object(e.data).name === 'structured_output')
  if (!calls.length || new Set(calls.map(e => object(e.data).callId)).size !== calls.length) return fail('native calls')
  const requests = current.filter(e => e.type === 'request/header')
  if (!requests.length || requests.some(e => {
    const actual = object(object(object(e.data).header).config)
    return !matchesModelRoute(actual, route) || e.seq >= terminal.seq
  })) return fail('native route')
  let successes = 0
  for (const [index, call] of calls.entries()) {
    const data = object(call.data)
    if (data.turn !== turn || !data.callId || typeof data.arguments !== 'string' || call.seq >= terminal.seq) return fail('native call identity')
    if (!requests.some(e => e.seq < call.seq)) return fail('native request missing')
    const results = current.filter(e => e.type === 'tool/result').flatMap(e => {
      const result = object(e.data), blocks = object(result.message).content
      return Array.isArray(blocks) ? blocks.filter(b => object(b).type === 'tool-result' && object(b).toolCallId === data.callId)
        .map(b => ({ event: e, result, block: object(b) })) : []
    })
    if (results.length !== 1) return fail('native tool result count')
    const result = results[0]
    if (result.result.turn !== turn || result.result.step !== data.step || result.event.seq <= call.seq
      || result.event.seq >= (calls[index + 1]?.seq ?? terminal.seq)) return fail('native tool result sequence')
    if (result.block.isError === true) continue
    if (result.block.isError !== false || index !== calls.length - 1) return fail('ambiguous native success')
    let submitted: unknown
    try { submitted = JSON.parse(data.arguments) } catch { return fail('native arguments') }
    const wireSchema=readNativeModuleJsonWireSchema(current)
    if(wireSchema)submitted=decodeNativeModuleJsonWire(submitted,wireSchema)
    if (hash(submitted) !== hash(raw)) return fail('native payload mismatch')
    successes++
  }
  if (successes !== 1) return fail('native success missing')
}

/** No submitted review can be discarded as a transport interruption. */
function verifyUnsubmittedReviewFailure(events: readonly SessionEventLike[], route: LlmRoute): boolean {
  if (events.some((e, i) => !Number.isSafeInteger(e.seq) || i > 0 && e.seq <= events[i - 1].seq)) return fail('review native sequence')
  const start = events.findLastIndex(e => e.type === 'turn/start')
  if (start < 0) return fail('review native turn missing')
  const current = events.slice(start), turn = object(events[start].data).turn
  const terminal = current.findLast(e => e.type === 'turn/end')
  if (!Number.isSafeInteger(turn) || !terminal || object(terminal.data).turn !== turn) return fail('review native terminal')
  const requests = current.filter(e => e.type === 'request/header')
  if (!requests.length || requests.some(e => !matchesModelRoute(object(object(object(e.data).header).config), route) || e.seq >= terminal.seq)) return fail('review native route')
  if (current.some(e => e.type === 'tool/call' && object(e.data).name === 'structured_output')) return fail('review native submission exists')
  return nativeAvailabilityFailure(object(object(terminal.data).reason)) !== undefined
}

/** A selected-route budget check happens before spawn. Its exact diagnostic
 * must agree with the immutable module failure; a missing child alone proves
 * neither a preflight failure nor permission to discard a native review. */
function isReviewBudgetPreflightFailure(error: unknown, moduleError: string | undefined): boolean {
  if (typeof error !== 'string' || error !== moduleError) return false
  const match = /^MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED: estimated input (\d+) tokens plus reserved output (\d+) exceed route context (\d+); split the task or supply a narrower complete source context$/.exec(error)
  if (!match) return false
  const [input, reserved, capacity] = match.slice(1).map(Number)
  return [input, reserved, capacity, input + reserved].every(value => Number.isSafeInteger(value) && value > 0)
    && input + reserved > capacity
}

/** Recovery is not acceptance: only a contiguous native-verified prefix may be
 * reused, and the complete candidate still requires a new independent review. */
export async function recoverModuleAuthorGroups(context: ModuleAnalysisContext, parent: Agent, classes: AgentClassService, readEvents?: ModuleNativeEventReader, sourceContextFingerprint?: string,sourceContext?:unknown):Promise<{
  submissions:{raw:ModuleAuthorGroupSubmission;receipt:ModuleNativeExecutionReceipt}[];attempts:unknown[];deferredAttempts?:Record<string,any>[]
}> {
  const submissions: { raw: ModuleAuthorGroupSubmission; receipt: ModuleNativeExecutionReceipt }[] = []
  const audit = context.resumeExecutionAudit
  if (!audit) return { submissions, attempts: [] as unknown[] }
  if (!Array.isArray(audit.attempts) || !Array.isArray(audit.reviewReceipts)) return fail('audit shape')
  const attempts = audit.attempts as Record<string, any>[]
  // An actual review or submitted review candidate needs author revision. Only
  // an independently verified, unsubmitted native availability failure or an
  // owned pre-spawn budget rejection can reuse complete authors. Neither is a
  // review receipt, and both still require a fresh independent review.
  const originalReviews=attempts.filter(a=>a?.classId==='review')
  const handoffReplay=context.module.id==='1.01'&&!!context.taskConfiguration&&!!context.projectTaskHandoffReplay
    &&projectTaskHandoffReplayAllowed(context.projectTaskHandoffReplay,audit.reviewReceipts)
  if(handoffReplay){
    if(!readEvents||!context.priorModuleReview||hash(context.priorModuleReview.reviewReceipts)!==hash(audit.reviewReceipts)
      ||originalReviews.length!==audit.reviewReceipts.length)return fail('handoff prior review binding')
    for(const attempt of originalReviews){
      const receipt=audit.reviewReceipts.find((r:any)=>r.executionId===attempt.executionId&&r.childId===attempt.childId) as Record<string,any>|undefined
      const execution=classes.execution(attempt.executionId),raw=attempt.structuredOutput
      if(!receipt||attempt.status!=='completed'||attempt.structuredHash!==hash(raw)||raw?.verdict!==receipt.verdict
        ||hash(raw?.checks)!==hash(receipt.checks)||hash(raw?.limitations)!==hash(receipt.limitations)
        ||raw?.projectTaskAuditHash!==hash(context.projectTaskHandoffReplay)||!execution
        ||execution.projectId!==context.projectId||execution.parentId!==String(parent.id)||execution.classId!=='review'
        ||execution.childId!==attempt.childId||execution.status!=='completed'||!execution.actual||!matchesModelRoute(execution.actual,attempt.actualModel))return fail('handoff native review ownership')
      const events=await readEvents(attempt.childId);if(!events)return fail('handoff native review missing')
      verifySubmission(events,attempt.actualModel,raw)
    }
  }
  const reviewAttempts = handoffReplay?[]:originalReviews
  if (!handoffReplay&&audit.reviewReceipts.length || reviewAttempts.some(a => a.status !== 'failed' || a.submissionState !== 'not-submitted'
    || a.structuredOutput !== undefined || a.structuredHash !== undefined)) return { submissions, attempts: [] as unknown[] }
  let completed = attempts.filter(a => a?.classId === 'text' && a?.status === 'completed'&&a.groupId!=='module-synthesis')
  if (!completed.length) return { submissions, attempts: [] as unknown[] }
  const originalCompleted=completed
  const unreadTaskIndex=context.module.id==='1.01'?completed.findIndex(a=>{
    try{assertProjectTaskFieldBindings(a.structuredOutput,context.taskBrief);return false}catch{return true}
  }):-1
  if(unreadTaskIndex>=0)completed=completed.slice(0,unreadTaskIndex)
  const invalidUnitIndex=!reviewAttempts.length&&context.resumeExecutionError?.startsWith('MODULE_CLAIM_UNIT_MISMATCH:')
    ?completed.findIndex(a=>moduleProjectionUnitConflicts(a.structuredOutput).length):-1
  const projections = completed.map(a => a.structuredOutput)
  // Use the complete graph to identify the earliest original cycle owner,
  // including cross-group cycles. The readback filters before bounding edges.
  const invalidCycleIndex = !reviewAttempts.length && context.resumeExecutionError?.startsWith('MODULE_CLAIM_CYCLE:')
    ? completed.findIndex(a => moduleClaimCycleConflicts(projections, a.groupId).length) : -1
  const invalidMergeIndex = invalidUnitIndex >= 0 ? invalidUnitIndex : invalidCycleIndex
  // Later original groups remain deferred, not accepted or rewritten. Each is
  // native-verified and strictly revalidated against the new prefix only after
  // its invalid owner has authored a replacement. A fresh review is mandatory.
  const deferredAttempts=invalidMergeIndex>=0?completed.slice(invalidMergeIndex+1).filter(a=>!moduleProjectionUnitConflicts(a.structuredOutput).length
    && !moduleClaimCycleConflicts([a.structuredOutput]).length):[]
  if(invalidMergeIndex>=0)completed=completed.slice(0,invalidMergeIndex)
  // An old partial validator could accept invalid calculation text or omit the
  // scenario rationale, then fail at merge. Retain the original native prefix;
  // the invalid group and later groups need new authors, never rewritten receipts.
  const invalidCalculationIndex = !reviewAttempts.length
    && /^(?:MODULE_CALCULATION_REQUIRED|MODULE_CALCULATION_SCENARIO_RATIONALE_REQUIRED):/u.test(context.resumeExecutionError ?? '')
    ? completed.findIndex(a => context.resumeExecutionError!.startsWith('MODULE_CALCULATION_SCENARIO_RATIONALE_REQUIRED:')
      ? moduleScenarioCalculationRationaleConflicts(a.structuredOutput).length : moduleCalculationResultConflicts(a.structuredOutput).length) : -1
  if (invalidCalculationIndex >= 0) completed = completed.slice(0, invalidCalculationIndex)
  // Changed plans require fresh authors; never relabel historical raw receipts.
  if (!isCurrentModuleAuthorPrefix(context.module?.id, (invalidMergeIndex>=0?originalCompleted:completed).map(a => a.structuredOutput))) return { submissions, attempts: [] as unknown[] }
  // Old validators checked upstream claims only after all groups had completed.
  // Invalid prefixes must be authored again, with group-scoped rejection feedback.
  if (moduleUpstreamReferenceDiagnostics(completed.map(a => a.structuredOutput), context.upstream).length) return { submissions, attempts: [] as unknown[] }
  if (moduleInferenceBasisDiagnostics(completed.map(a => a.structuredOutput)).length) return { submissions, attempts: [] as unknown[] }
  // A new source slice can change the author's record set, even if the complete
  // frozen corpus is unchanged. Old/unbound prefixes must be authored again;
  // their historical receipts remain in the immutable prior run.
  const sourceEvents=new Map<string,readonly SessionEventLike[]>()
  if(sourceContextFingerprint)for(const attempt of invalidMergeIndex>=0?originalCompleted:completed){
    if(attempt.sourceContextFingerprint===sourceContextFingerprint)continue
    if(sourceContext===undefined||hash(sourceContext)!==sourceContextFingerprint||!readEvents||!attempt.childId)return {submissions,attempts:[]}
    const events=await readEvents(attempt.childId);context.signal.throwIfAborted()
    if(!events||!moduleAuthorSourceFingerprintMatches(attempt.sourceContextFingerprint,sourceContext,events))return {submissions,attempts:[]}
    sourceEvents.set(attempt.childId,events)
  }
  const plan = getModuleAuthorExecutionFieldGroups(context.module.id,completed.map(a=>a.structuredOutput))
  const synthesisAttempt=attempts.findLast(a=>a?.classId==='text'&&a.groupId==='module-synthesis')
  let synthesisContinuation=false
  if(synthesisAttempt&&completed.length===plan.length){
    try{synthesisContinuation=synthesisAttempt.sourceContextFingerprint===hash(compileModuleAuthorGroups(context.module.id,completed.map(a=>a.structuredOutput),context.corpus))}catch{}
  }
  if (!completed.length&&invalidMergeIndex<0 || completed.length > plan.length || completed.length === plan.length && !reviewAttempts.length&&!handoffReplay&&!synthesisContinuation) return { submissions, attempts: [] as unknown[] }
  if(handoffReplay&&completed.length!==plan.length)return fail('handoff incomplete authors')
  if (!readEvents) return fail('native event reader unavailable')
  for (const attempt of reviewAttempts) {
    context.signal.throwIfAborted()
    const execution = classes.execution(attempt.executionId)
    if (!execution || execution.projectId !== context.projectId || execution.parentId !== String(parent.id)
      || execution.classId !== 'review' || execution.childId !== attempt.childId || execution.status !== 'failed'
      || !execution.task.startsWith(`${context.module.id} `)
      || execution.activity === 'running') return fail('review execution ownership or state')
    if (execution.childId === undefined && attempt.childId === undefined) {
      if (execution.actual !== undefined || execution.childStopReason !== undefined || execution.availabilityFailure !== undefined
        || execution.modelCallDeadline !== undefined || attempt.actualModel !== undefined || attempt.stopReason !== undefined
        || attempt.outputsJsonHash !== undefined || attempt.nativeToolStall !== undefined || attempt.modelCallDeadline !== undefined
        || !isReviewBudgetPreflightFailure(attempt.error, context.resumeExecutionError)) return fail('review preflight proof')
      continue
    }
    if (!['error', 'max-tokens'].includes(execution.childStopReason ?? '') || !execution.actual
      || !matchesModelRoute(execution.actual, attempt.actualModel)) return fail('review execution ownership or state')
    const events = sourceEvents.get(attempt.childId)??await readEvents(attempt.childId)
    context.signal.throwIfAborted()
    if (!events) return fail('review native events unavailable')
    if (!verifyUnsubmittedReviewFailure(events, attempt.actualModel)) return { submissions, attempts: [] as unknown[] }
  }
  if (reviewAttempts.length && completed.length !== plan.length) return fail('review without complete authors')
  for (const [index, attempt] of completed.entries()) {
    context.signal.throwIfAborted()
    const raw = attempt.structuredOutput as ModuleAuthorGroupSubmission
    if (attempt.classId !== 'text' || attempt.groupId !== plan[index].groupId || raw?.groupId !== attempt.groupId
      || attempt.stopReason !== 'completed'
      || attempt.structuredHash !== hash(raw) || attempt.outputsJsonHash !== hash(raw.outputs)) return fail('group identity or payload hash')
    const execution = classes.execution(attempt.executionId)
    if (!execution || execution.projectId !== context.projectId || execution.parentId !== String(parent.id)
      || execution.classId !== 'text' || execution.childId !== attempt.childId || execution.status !== 'completed'
      || execution.childStopReason !== 'completed' || !execution.actual || !matchesModelRoute(execution.actual, attempt.actualModel)
      || !execution.task.startsWith(`${context.module.id} `) || execution.activity === 'running') return fail('execution ownership or state')
    const events = await readEvents(attempt.childId)
    context.signal.throwIfAborted()
    if (!events) return fail('native events unavailable')
    // Native schema correction can reject an earlier call in this same child.
    // Only the unique final successful submission can match the saved group.
    verifySubmission(events, attempt.actualModel, raw)
    const checked = validateModuleAuthorGroup(context.module.id, raw, submissions.map(s => s.raw), context.corpus, context.upstream)
    submissions.push({ raw: checked, receipt: { executionId: attempt.executionId, childId: attempt.childId,
      actualModel: structuredClone(attempt.actualModel), stopReason: 'completed' } })
  }
  const reused = new Set(completed.map(a => a.executionId))
  if(handoffReplay)verifyProjectTaskAudit(compileModuleAuthorGroups(context.module.id,submissions.map(s=>s.raw),context.corpus),
    context.taskBrief,context.projectTaskHandoffReplay!)
  return { submissions, attempts: structuredClone(attempts.filter(a => (!handoffReplay||a.classId!=='review')&&(a.status !== 'completed' || reused.has(a.executionId)))) as unknown[],
    ...(invalidMergeIndex>=0?{deferredAttempts:structuredClone(deferredAttempts)}:{}) }
}

/** Deferred originals gain no authority until their unique native receipt and
 * complete actual field prefix have both been rechecked. Any mismatch stops. */
export async function recoverDeferredModuleAuthorGroup(context:ModuleAnalysisContext,parent:Agent,classes:AgentClassService,readEvents:ModuleNativeEventReader|undefined,
  attempt:Record<string,any>,prior:readonly ModuleAuthorGroupSubmission[],sourceContextFingerprint:string,sourceContext?:unknown){
  context.signal.throwIfAborted()
  const raw=attempt.structuredOutput as ModuleAuthorGroupSubmission,group=getModuleAuthorExecutionFieldGroups(context.module.id,prior)[prior.length]
  if(!group||attempt.classId!=='text'||attempt.status!=='completed'||attempt.groupId!==group.groupId||raw?.groupId!==group.groupId
    ||attempt.stopReason!=='completed'||attempt.structuredHash!==hash(raw)||attempt.outputsJsonHash!==hash(raw.outputs))return fail('deferred group identity or payload hash')
  const execution=classes.execution(attempt.executionId)
  if(!execution||execution.projectId!==context.projectId||execution.parentId!==String(parent.id)||execution.classId!=='text'
    ||execution.childId!==attempt.childId||execution.status!=='completed'||execution.childStopReason!=='completed'||!execution.actual
    ||!matchesModelRoute(execution.actual,attempt.actualModel)||!execution.task.startsWith(`${context.module.id} `)||execution.activity==='running')return fail('deferred execution ownership or state')
  if(!readEvents)return fail('deferred native event reader unavailable')
  const events=await readEvents(attempt.childId);context.signal.throwIfAborted();if(!events)return fail('deferred native events unavailable')
  if(attempt.sourceContextFingerprint!==sourceContextFingerprint&&(sourceContext===undefined||hash(sourceContext)!==sourceContextFingerprint
    ||!moduleAuthorSourceFingerprintMatches(attempt.sourceContextFingerprint,sourceContext,events)))return fail('deferred source context changed')
  verifySubmission(events,attempt.actualModel,raw)
  const checked=validateModuleAuthorGroup(context.module.id,raw,prior,context.corpus,context.upstream)
  return {raw:checked,receipt:{executionId:attempt.executionId,childId:attempt.childId,actualModel:structuredClone(attempt.actualModel),stopReason:'completed' as const}}
}
