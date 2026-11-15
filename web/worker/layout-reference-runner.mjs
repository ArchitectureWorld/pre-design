import {DeepSeekHarness} from '@deepseek-ai/dsh-sdk-client'
import {mkdir,writeFile,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {isolatedEnvironment} from './model-runtime.mjs'
import {modelRequestReceipts} from './execution-trace.mjs'
import {agentActivity} from '../app/src/task-progress.mjs'

export function layoutReferenceExecution(events,{sessionId,policy,modelRole='parent'}){
 const requests=modelRequestReceipts(events,sessionId)
 const last=requests.at(-1)
 const outcome=events.findLast(e=>e.type==='turn/end')?.data?.reason
 const failures=events.flatMap(e=>{
  const failure=e.type==='llm/retry'?e.data?.failure:e.type==='turn/end'?e.data?.reason?.error:null
  if(!failure)return []
  const httpStatus=Number(/\b(4\d\d|5\d\d)\b/.exec(failure.message??'')?.[1])||null
  return [{code:failure.code??'LAYOUT_MODEL_ERROR',httpStatus,
   ...(/Provider stream interrupted or invalid|Invalid provider response/i.test(failure.message??'')?{category:'provider_stream_invalid'}:{})}]
 })
 return {scope:'layout-library',sessionId,requestedRole:modelRole,requestedPolicyRevision:policy.revision,requestedRoute:policy.routes[modelRole].primary,
  actualRoute:last?{provider:last.provider,model:last.model}:null,parent:{status:last?'recorded':'not_recorded',requests},
  actualUsage:null,eventCount:events.length,toolPolicy:events.some(e=>e.type==='request/header'&&e.data?.header?.tools?.length)?'present':'none',outcome:outcome?.kind??'incomplete',failure:failures.at(-1)??null}
}

/** Reuses platform model materialization and routing in a project-free session. */
export async function runLayoutReference(workers,{jobId,prompt,policy,images=[],modelRole=images.length?'vision':'parent',signal,onEvent=()=>{}}){
 if(!/^[a-f0-9-]{36}$/.test(jobId))throw new Error('LAYOUT_JOB_ID')
 if(!['parent','vision'].includes(modelRole)||images.length&&modelRole!=='vision')throw new Error('LAYOUT_VISION_ROLE_REQUIRED')
 if(images.length>16)throw new Error('LAYOUT_REFERENCE_IMAGE_LIMIT')
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
  {insert:[{id:'layout-reference-guard',name:new URL('./layout-reference-guard.mjs',import.meta.url).pathname}]},
  {id:'sdk-jsonrpc-server',inject:['sdkAppStartup','loader','preLayoutReferenceReady']},
 ]),{mode:0o600})
 const selected=policy.models.find(m=>m.provider===policy.routes[modelRole].primary.provider&&m.model===policy.routes[modelRole].primary.model)
 const harness=new DeepSeekHarness({profile:'sdk',patches:[patch],dshHome:join(folder,'dsh'),cwd:folder,processCwd:folder,
  ...model.parent,...(selected?.maxOutputTokens?{maxTokens:selected.maxOutputTokens}:{}),initializeTimeoutMs:60000,
  env:{...isolatedEnvironment(),...model.env,PRE_WEB_LAYOUT_POLICY_FILE:policyFile,PRE_WEB_LAYOUT_SESSION_ID:sessionId,PRE_WEB_LAYOUT_MODEL_ROLE:modelRole,DSH_MAX_TOKENS_AS_SUCCESS:'false'}})
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
