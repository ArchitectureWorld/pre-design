import {requestBudgetGuard} from './layout-request-budget.mjs'
import {DeepSeekHarness} from '@deepseek-ai/dsh-sdk-client'
import {mkdir,writeFile,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {isolatedEnvironment} from './model-runtime.mjs'
import {modelRequestReceipts} from './execution-trace.mjs'
import {agentActivity} from '../app/src/task-progress.mjs'
import {MAX_REFERENCE_IMAGES,MAX_REFERENCE_IMAGE_BYTES} from '../app/src/layout-library/reference-limits.mjs'

export function layoutReferenceExecution(events,{sessionId,policy,modelRole='parent'}){
 const requests=modelRequestReceipts(events,sessionId)
 const last=requests.at(-1)
 const outcome=events.findLast(e=>e.type==='turn/end')?.data?.reason
 const safeFailure=failure=>{
  if(!failure)return null
  const code=['AUTH','MISSING_CREDENTIAL','INVALID_CREDENTIAL','NO_ADAPTER','MODEL_NOT_FOUND','PROVIDER_NOT_FOUND','QUOTA','TRANSPORT','NETWORK','CONNECTION','RATE_LIMIT','SERVER','PI_AI_ERROR','CONTEXT_WINDOW_EXCEEDED'].includes(failure.code)?failure.code:'LAYOUT_MODEL_ERROR'
  const httpStatus=Number(/\bAPI error \(([45]\d\d)\):/.exec(failure.message??'')?.[1])||null
  return {code,httpStatus,...(/Provider stream interrupted or invalid|Invalid provider response/i.test(failure.message??'')?{category:'provider_stream_invalid'}:{})}
 }
 const eventFailure=e=>safeFailure(e.type==='llm/retry'?e.data?.failure:e.type==='turn/end'?e.data?.reason?.error:e.type==='assistant/attempt'?(e.data?.stream??[]).findLast(x=>x.chunk?.type==='finish')?.chunk?.reason?.failure:null)
 const failures=events.map(eventFailure).filter(Boolean)
 const attempts=requests.map((request,index)=>{
  const start=events.findIndex(e=>e.type==='request/header'&&e.seq===request.seq),next=requests[index+1]
  const following=events.slice(start+1),boundary=following.findIndex(e=>e.type==='request/header'&&e.seq===next?.seq)
  const window=boundary<0?following:following.slice(0,boundary),end=window.find(e=>e.type==='assistant/attempt'||e.type==='turn/end'||e.type==='llm/retry')
  return {provider:request.provider,model:request.model,startedAt:request.time,nextRequestAfterMs:Number.isFinite(next?.time)&&next.time>=request.time?next.time-request.time:null,elapsedMs:Number.isFinite(end?.time)&&end.time>=request.time?end.time-request.time:null,endedBy:end?.type??null,failure:end?eventFailure(end):null}
 })
 const seenUsage=new Set(),usage={inputTokens:0,outputTokens:0,totalTokens:0,coverage:'reported-assistant-messages-only',reportedMessages:0,currencyCost:null}
 for(const event of events){
  if(event.type!=='assistant/message'||!Number.isSafeInteger(event.seq)||seenUsage.has(event.seq))continue
  const u=event.data?.usage
  if(!u||!['inputTokens','outputTokens','totalTokens'].every(k=>Number.isSafeInteger(u[k])&&u[k]>=0)||u.inputTokens+u.outputTokens!==u.totalTokens)continue
  seenUsage.add(event.seq);usage.reportedMessages++
  for(const k of ['inputTokens','outputTokens','totalTokens'])usage[k]+=u[k]
 }
 const reportedMessages=[],reportedSequences=new Set()
 for(const event of events){
  if(event.type!=='assistant/message'||!Number.isSafeInteger(event.seq)||reportedSequences.has(event.seq)||reportedMessages.length>=100)continue
  const raw=event.data?.usage;if(!raw||typeof raw!=='object')continue
  const values=Object.fromEntries(['inputTokens','outputTokens','totalTokens','cacheReadTokens','cacheWriteTokens'].filter(k=>Number.isSafeInteger(raw[k])&&raw[k]>=0).map(k=>[k,raw[k]]))
  if(!Object.keys(values).length)continue
  reportedSequences.add(event.seq);reportedMessages.push({seq:event.seq,...values})
 }
 const reportedUsage=reportedMessages.length?{coverage:'reported-assistant-messages-only',arithmetic:'provider-defined-not-recomputed',messages:reportedMessages,currencyCost:null}:null
 const actualUsage=usage.reportedMessages&&['inputTokens','outputTokens','totalTokens'].every(k=>Number.isSafeInteger(usage[k]))?usage:null
 return {scope:'layout-library',sessionId,requestedRole:modelRole,requestedPolicyRevision:policy.revision,requestedRoute:policy.routes[modelRole].primary,
  actualRoute:last?{provider:last.provider,model:last.model}:null,parent:{status:last?'recorded':'not_recorded',requests},
  attempts,actualUsage,reportedUsage,eventCount:events.length,toolPolicy:events.some(e=>e.type==='request/header'&&e.data?.header?.tools?.length)?'present':'none',outcome:outcome?.kind??'incomplete',failure:failures.at(-1)??null}
}

export function layoutSdkDependencies({requestBudget,wireBudget}={}){return ['sdkAppStartup','loader','preLayoutReferenceReady',...(requestBudget?['preLayoutRequestBudgetReady']:[]),...(wireBudget?['preLayoutWireBudgetReady']:[])]}

/** Reuses platform model materialization and routing in a project-free session. */
export async function runLayoutReference(workers,{jobId,prompt,policy,images=[],modelRole=images.length?'vision':'parent',signal,onEvent=()=>{},requestBudget,wireBudget}){
 if(requestBudget!==undefined)requestBudgetGuard(requestBudget)
 if(!/^[a-f0-9-]{36}$/.test(jobId))throw new Error('LAYOUT_JOB_ID')
 if(!['parent','vision'].includes(modelRole)||images.length&&modelRole!=='vision')throw new Error('LAYOUT_VISION_ROLE_REQUIRED')
 if(images.length>MAX_REFERENCE_IMAGES)throw new Error('LAYOUT_REFERENCE_IMAGE_LIMIT')
 if(images.reduce((n,image)=>n+Buffer.byteLength(image.data,'base64'),0)>MAX_REFERENCE_IMAGE_BYTES)throw new Error('LAYOUT_REFERENCE_IMAGE_BYTES_LIMIT')
 signal?.throwIfAborted()
 const {model}=await workers.configuration(policy,[modelRole],{parentRole:modelRole})
 const privateRoot=workers.config.privateRoot
 if(!privateRoot)throw new Error('LAYOUT_PRIVATE_ROOT_REQUIRED')
 const folder=resolve(privateRoot,'layout-library',jobId)
 await mkdir(folder,{recursive:true,mode:0o700})
 if(await realpath(folder)!==folder)throw new Error('LAYOUT_WORKSPACE_INVALID')
 const sessionId='layout-'+jobId,policyFile=join(folder,'model-policy.json'),patch=join(folder,'reference.cordis.yml')
 await writeFile(policyFile,JSON.stringify(policy),{mode:0o600})
 await writeFile(patch,JSON.stringify([
  {id:'llm-pi-ai',config:{providers:model.providers}},
  {id:'attachment-local',config:{maxImagesPerMessage:MAX_REFERENCE_IMAGES,maxMessageImageBytes:MAX_REFERENCE_IMAGE_BYTES}},
  {insert:[{id:'layout-reference-guard',name:new URL('./layout-reference-guard.mjs',import.meta.url).pathname}]},
  ...(wireBudget?[{insert:[{id:'layout-wire-budget',name:new URL('./layout-wire-budget.mjs',import.meta.url).pathname}]}]:[]),
  ...(requestBudget?[{insert:[{id:'layout-request-budget',name:new URL('./layout-request-budget.mjs',import.meta.url).pathname}]}]:[]),
  {id:'sdk-jsonrpc-server',inject:layoutSdkDependencies({requestBudget,wireBudget})},
 ]),{mode:0o600})
 const selected=policy.models.find(m=>m.provider===policy.routes[modelRole].primary.provider&&m.model===policy.routes[modelRole].primary.model)
 const harness=new DeepSeekHarness({profile:'sdk',patches:[patch],dshHome:join(folder,'dsh'),cwd:folder,processCwd:folder,
  ...model.parent,...(selected?.maxOutputTokens?{maxTokens:selected.maxOutputTokens}:{}),initializeTimeoutMs:60000,
  env:{...isolatedEnvironment(),...model.env,...(wireBudget?{PRE_WEB_LAYOUT_WIRE_BUDGET:JSON.stringify(wireBudget)}:{}),...(requestBudget?{PRE_WEB_LAYOUT_REQUEST_BUDGET:JSON.stringify(requestBudget)}:{}),PRE_WEB_LAYOUT_POLICY_FILE:policyFile,PRE_WEB_LAYOUT_SESSION_ID:sessionId,PRE_WEB_LAYOUT_MODEL_ROLE:modelRole,DSH_MAX_TOKENS_AS_SUCCESS:'false'}})
 workers.layoutRuns??=new Map()
 workers.layoutRuns.set(jobId,harness)
 let events=[]
 const abort=()=>{void harness.close()}
 signal?.addEventListener('abort',abort,{once:true})
 try{
  await harness.start()
  signal?.throwIfAborted()
  const session=harness.session(sessionId)
  await session.setWorkingDirectory(folder)
  const input=images.length?[{type:'text',text:prompt},...images.flatMap(image=>[{type:'text',text:'参考文件：'+image.name+(image.page?'，第'+image.page+'页':'')+'。以下为实际读取的页面图像。'},{type:'image',data:image.data,mimeType:image.mimeType}])]:prompt
  const result=await session.run(input,{onNotification:notification=>{
   const event=notification.method==='session.event'?notification.params?.event:undefined
   if(event)events.push(event)
   const activity=agentActivity(notification)
   if(activity)onEvent(activity)
   if(event?.type==='llm/retry-started')onEvent({stage:'model_retry'})
  }})
  events=result.events
  signal?.throwIfAborted()
  const execution={...layoutReferenceExecution(events,{sessionId,policy,modelRole}),referenceImages:images.map(({fileId,name,page,sha256})=>({fileId,name,page,sha256}))}
  if(execution.outcome!=='completed'||!result.finalResponse?.trim())throw new Error('LAYOUT_MODEL_NO_VALID_RESULT')
  return {response:result.finalResponse,execution}
 }catch(error){
  error.execution={...layoutReferenceExecution(events,{sessionId,policy,modelRole}),referenceImages:images.map(({fileId,name,page,sha256})=>({fileId,name,page,sha256}))}
  throw error
 }finally{
  signal?.removeEventListener('abort',abort)
  await harness.close()
  workers.layoutRuns.delete(jobId)
 }
}
