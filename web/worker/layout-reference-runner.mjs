import {DeepSeekHarness} from '@deepseek-ai/dsh-sdk-client'
import {mkdir,writeFile,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {isolatedEnvironment} from './model-runtime.mjs'
/** Reuses platform model materialization; no project row, Core context, general tools or alternate provider. */
export async function runLayoutReference(workers,{jobId,prompt,policy,signal,onEvent=()=>{}}){
 if(!/^[a-f0-9-]{36}$/.test(jobId))throw new Error('LAYOUT_JOB_ID')
 signal?.throwIfAborted()
 const {model}=await workers.configuration(policy,['parent'])
 const privateRoot=workers.config.privateRoot
 if(!privateRoot)throw new Error('LAYOUT_PRIVATE_ROOT_REQUIRED')
 const folder=resolve(privateRoot,'layout-library',jobId);await mkdir(folder,{recursive:true,mode:0o700})
 if(await realpath(folder)!==folder)throw new Error('LAYOUT_WORKSPACE_INVALID')
 const patch=join(folder,'reference.cordis.yml')
 await writeFile(patch,JSON.stringify([{id:'llm-pi-ai',config:{providers:model.providers}},{insert:[{id:'layout-reference-guard',name:new URL('./layout-reference-guard.mjs',import.meta.url).pathname}]},{id:'sdk-jsonrpc-server',inject:['sdkAppStartup','loader']}]),{mode:0o600})
 const selected=policy.models.find(m=>m.provider===policy.routes.parent.primary.provider&&m.model===policy.routes.parent.primary.model)
 const harness=new DeepSeekHarness({profile:'sdk',patches:[patch],dshHome:join(folder,'dsh'),cwd:folder,processCwd:folder,
  ...model.parent,maxTokens:Math.min(selected?.maxOutputTokens??8192,8192),initializeTimeoutMs:60000,
  env:{...isolatedEnvironment(),...model.env,DSH_MAX_TOKENS_AS_SUCCESS:'false'}})
 workers.layoutRuns??=new Map();workers.layoutRuns.set(jobId,harness)
 const abort=()=>{void harness.close()};signal?.addEventListener('abort',abort,{once:true})
 try{
  await harness.start();signal?.throwIfAborted()
  const session=harness.session('layout-'+jobId);await session.setWorkingDirectory(folder)
  const result=await session.run(prompt,{onNotification:()=>onEvent({stage:'generating'})})
  signal?.throwIfAborted()
  const ended=result.events.findLast(e=>e.type==='turn/end')
  if(ended?.data?.reason?.kind==='error'||!result.finalResponse?.trim())throw new Error('LAYOUT_MODEL_NO_VALID_RESULT')
  return {response:result.finalResponse,execution:{scope:'layout-library',sessionId:result.sessionId,requestedPolicyRevision:policy.revision,requestedRoute:policy.routes.parent.primary,actualUsage:null,eventCount:result.events.length,toolPolicy:'none'}}
 }finally{signal?.removeEventListener('abort',abort);await harness.close();workers.layoutRuns.delete(jobId)}
}
