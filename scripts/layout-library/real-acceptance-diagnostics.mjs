/** Private test receipts. SDK return != validated design; missing usage stays null. */
function capacityDetails(error){
 const d=error?.details,fields={body:['bodyPoints',30],image:['images',6],table:['tableRows',40],text:['textBlocks',32]}
 if(error?.code!=='REFERENCE_PROFILE_CAPACITY_INVALID'||!d||!/^[a-z][a-z0-9-]{0,47}$/.test(d.archetypeId??'')||!Object.hasOwn(fields,d.role)||d.field!==fields[d.role][0]||!Number.isSafeInteger(d.capacity)||d.capacity<0||d.capacity>fields[d.role][1])return {}
 return {details:{archetypeId:d.archetypeId,role:d.role,field:d.field,capacity:d.capacity}}
}
export function acceptanceErrorRecord(error,signal){
 const underlyingCode=error?.code??error?.name??'Error',cancelled=signal?.aborted===true,timeout=cancelled&&signal.reason?.message==='ACCEPTANCE_TIMEOUT'
 return {...capacityDetails(error),code:timeout?'ACCEPTANCE_TIMEOUT':cancelled?'ACCEPTANCE_CANCELLED':underlyingCode,...(cancelled?{underlyingCode}:{}),...(error?.issues?{issues:error.issues.map(x=>({code:x.code,path:x.path,expected:x.expected}))}:{}),failedStage:error?.execution?.failedStage??null,cancelled,stopReason:timeout?'time-budget':cancelled?'cancelled':'model-or-validation-error'}
}
export async function timedAcceptanceModel(input,run,records,{now=Date.now}={}){
 const start=now(),trace={stage:input.stage,startedAt:new Date(start).toISOString(),status:'running',firstActivityAfterMs:null,actualRequests:0,actualUsage:null};records.push(trace)
 const capture=execution=>{trace.actualRoute=execution?.actualRoute??null;trace.actualRequests=execution?.parent?.requests?.length??0;trace.actualUsage=execution?.actualUsage??null;trace.reportedUsage=execution?.reportedUsage??null}
 try{
  const result=await run({...input,onEvent:event=>{if(trace.firstActivityAfterMs===null)trace.firstActivityAfterMs=Math.max(0,now()-start);input.onEvent?.(event)}})
  capture(result?.execution);trace.status='returned';return result
 }catch(error){capture(error?.execution);trace.status=input.signal?.aborted?'cancelled':'failed';trace.error=acceptanceErrorRecord(error,input.signal);throw error}
 finally{const end=now();trace.finishedAt=new Date(end).toISOString();trace.elapsedMs=Math.max(0,end-start)}
}
