import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AgentClassService } from '../agent-classes/service.ts'
import { matchesModelRoute } from '../agent-classes/model-options.ts'
import { verifyOwnedModelCallDeadline, type OwnedModelCallDeadline } from '../agent-classes/model-call-deadline.ts'
import type { ModuleAnalysisContext } from './module-execution.ts'
import type { ModuleNativeEventReader } from './module-group-recovery.ts'

const noBackupError='MODULE_MODEL_CALL_TIMEOUT_NO_BACKUP: verified original deadline has no unused authorized backup'
/** A timed-out checkpoint first uses its original unused backup. An exhausted
 * chain permits one audited same-route continuation, never a fresh primary
 * cycle, a reusable draft, an extended deadline or acceptance. */
export async function recoverModuleDeadline(context: ModuleAnalysisContext, parent: Agent, classes: AgentClassService,
  readEvents: ModuleNativeEventReader | undefined, groupId: string | undefined, fingerprint: string | undefined, timeoutMs: number) {
  const attempt = context.resumeExecutionAudit?.attempts.findLast((value: any) => value?.classId === 'text' && value.groupId === groupId) as Record<string, any> | undefined
  if(groupId&&attempt?.status==='failed'&&attempt.error?.startsWith('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED:')){
    const execution=classes.execution(attempt.executionId)
    if(!execution?.fallbackFromExecutionId)return undefined
    const fail=():never=>{throw new Error('MODULE_DEADLINE_RECOVERY_INVALID: unsent backup capacity audit, original owner deadline and route must be verified')}
    context.signal.throwIfAborted()
    if(context.resumeExecutionError!==attempt.error||!fingerprint||attempt.sourceContextFingerprint!==fingerprint
      ||attempt.submissionState!=='not-submitted'||attempt.childId||attempt.actualModel||attempt.structuredOutput!==undefined||attempt.structuredHash!==undefined||!readEvents
      ||execution.projectId!==context.projectId||execution.parentId!==String(parent.id)||execution.classId!=='text'||execution.status!=='failed'
      ||execution.childId||execution.actual||execution.childStopReason||!execution.task.startsWith(context.module.id+' ')||!execution.routeChain||!execution.chainId)return fail()
    const original=classes.execution(execution.fallbackFromExecutionId)
    const prior=context.resumeExecutionAudit!.attempts.find((row:any)=>row.executionId===execution.fallbackFromExecutionId) as Record<string,any>|undefined
    if(!original||!prior||prior.error!=='Module model call timed out'||prior.groupId!==groupId||prior.sourceContextFingerprint!==fingerprint
      ||prior.submissionState!=='not-submitted'||prior.structuredOutput!==undefined||prior.structuredHash!==undefined
      ||original.projectId!==context.projectId||original.parentId!==String(parent.id)||original.status!=='failed'||original.classId!=='text'
      ||!original.childId||original.childId!==prior.childId||original.childStopReason!=='aborted'||!original.actual||!matchesModelRoute(original.actual,prior.actualModel)
      ||original.chainId!==execution.chainId||JSON.stringify(original.routeChain)!==JSON.stringify(execution.routeChain)
      ||execution.routeIndex!==(original.routeIndex??0)+1||!matchesModelRoute(execution.selected,execution.routeChain[execution.routeIndex]!)
      ||execution.configurationRevision!==original.configurationRevision)return fail()
    const proof=original.modelCallDeadline??prior.modelCallDeadline
    const events=await readEvents(original.childId);context.signal.throwIfAborted()
    if(!events||!proof||proof.timeoutMs!==timeoutMs||!verifyOwnedModelCallDeadline(events,original.selected,proof))return fail()
    const next=await classes.retryUnsentModuleCapacity(execution.id,parent,context.signal)
    return next??fail()
  }
  if (!groupId || !attempt || attempt.status !== 'failed' || attempt.error !== 'Module model call timed out') return undefined
  const fail = (): never => { throw new Error('MODULE_DEADLINE_RECOVERY_INVALID: original owner deadline, inputs, native route and terminal must be verified before dispatch') }
  context.signal.throwIfAborted()
  if (context.resumeExecutionError !== attempt.error && context.resumeExecutionError !== noBackupError
    || !fingerprint || attempt.sourceContextFingerprint !== fingerprint
    || attempt.submissionState !== 'not-submitted' || attempt.structuredOutput !== undefined || attempt.structuredHash !== undefined || !readEvents) return fail()
  const execution = classes.execution(attempt.executionId)
  if (!execution || execution.projectId !== context.projectId || execution.parentId !== String(parent.id) || execution.classId !== 'text'
    || execution.childId !== attempt.childId || execution.status !== 'failed' || execution.childStopReason !== 'aborted'
    || !execution.actual || !matchesModelRoute(execution.actual, attempt.actualModel) || !execution.task.startsWith(context.module.id + ' ')) return fail()
  const events = await readEvents(attempt.childId)
  context.signal.throwIfAborted()
  const startedAt = Date.parse(execution.startedAt)
  const proof: OwnedModelCallDeadline = execution.modelCallDeadline ?? attempt.modelCallDeadline
    ?? { kind: 'owned-model-call-deadline.v1', startedAt, timeoutMs, expiredAt: startedAt + timeoutMs }
  if (!events || proof.timeoutMs !== timeoutMs || !verifyOwnedModelCallDeadline(events, execution.selected, proof)) return fail()
  const next = await classes.fallbackTimedOut?.(execution.id, parent, context.signal, proof)
    ?? await classes.retryTimedOutModule?.(execution.id,parent,context.signal,proof)
  if (!next) throw new Error(noBackupError)
  return next
}
