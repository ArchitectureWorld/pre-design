import type { AgentClassService } from '../agent-classes/service.ts'
import type { SessionEventLike } from '../visual/session-image-collector.ts'

/** A host restart is not evidence that a native child stopped. Recover only a recorded terminal. */
export async function settleInterruptedReportReview(classes:Pick<AgentClassService,'execution'|'finish'>,
  readEvents:(childId:string)=>Promise<readonly SessionEventLike[]>,projectId:string,
  active:{executionId:string;childId?:string},code:string){
  let execution=classes.execution(active.executionId)
  if(!execution||execution.projectId!==projectId||execution.classId!=='review'
    ||active.childId&&execution.childId!==active.childId)throw new Error(code)
  if(execution.status==='recovery_required'){
    if(!execution.childId)throw new Error(code)
    const events=await readEvents(execution.childId)
    const start=events.findLastIndex(e=>e.type==='turn/start'),current=events.slice(start)
    const terminal=current.findLast(e=>e.type==='turn/end')
    const data=terminal?.data as {turn?:number;reason?:{kind?:string}}|undefined
    if(start<0||!terminal||data?.turn!==(events[start]!.data as {turn?:number}).turn||!data?.reason?.kind)throw new Error(code)
    // Old uncommitted output is never promoted; preserve the receipt and run a fresh review.
    await classes.finish(execution.id,'failed','REPORT_REVIEW_INTERRUPTED')
    execution=classes.execution(execution.id)
  }
  if(!execution||!['failed','cancelled','completed'].includes(execution.status))throw new Error(code)
  return execution
}
