export const name='pre-layout-request-budget'
export const inject=['agents']
export function requestBudgetGuard({maxRequests,deadlineAt},now=Date.now){
 if(!Number.isSafeInteger(maxRequests)||maxRequests<1||maxRequests>2||!Number.isSafeInteger(deadlineAt)||deadlineAt<=now()||deadlineAt-now()>180000)throw Error('LAYOUT_REQUEST_BUDGET_INVALID')
 let used=0
 return ()=>{if(now()>=deadlineAt)throw Error('LAYOUT_REQUEST_DEADLINE');if(used>=maxRequests)throw Error('LAYOUT_REQUEST_BUDGET');used++}
}
export function apply(ctx){
 const guard=requestBudgetGuard(JSON.parse(process.env.PRE_WEB_LAYOUT_REQUEST_BUDGET))
 ctx.on('agent/request',async(_request,next)=>{guard();return next()},{prepend:true})
 ctx.provide('preLayoutRequestBudgetReady',true)
}
