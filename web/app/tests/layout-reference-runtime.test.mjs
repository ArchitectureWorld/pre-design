import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultPolicy} from '../src/model-policy.mjs'
import {installModelBoundary} from '../../worker/model-runtime.mjs'
import * as reference from '../../worker/layout-reference-runner.mjs'

test('无项目的版式会话沿用平台主备路由和输出预算',async()=>{
 const snapshot=defaultPolicy(),primary=snapshot.models[0],fallback=snapshot.models[1]
 for(const m of [primary,fallback]){m.status='verified';m.capabilities.text=true;m.capabilities.tools=true;m.maxOutputTokens=12000}
 snapshot.routes.parent={primary:{provider:primary.provider,model:primary.model},fallbacks:[{provider:fallback.provider,model:fallback.model}]}
 const hooks=new Map(),ctx={on:(name,fn)=>hooks.set(name,fn)}
 await installModelBoundary(ctx,{sessionId:'layout-job',snapshot,classRoutes:{},classFallbacks:{}})
 const next=async()=>({provider:'unconfigured',model:'wrong',maxTokens:99999,thinking:'high'})
 const requested=await hooks.get('agent/request')({agent:{id:'layout-job'}},next)
 assert.deepEqual(requested,{provider:primary.runtimeProvider,model:primary.model,maxTokens:12000})
 assert.deepEqual(await hooks.get('agent/request-error')({agent:{id:'layout-job'},provider:primary.runtimeProvider,failure:{code:'SERVER'}},()=>null),{kind:'retry'})
 const retried=await hooks.get('agent/request')({agent:{id:'layout-job'}},next)
 assert.equal(retried.model,fallback.model);assert.equal(retried.provider,fallback.runtimeProvider)
})

test('版式调用记录实际模型及网关失败，已配置状态与运行结果分别保留',()=>{
 assert.equal(typeof reference.layoutReferenceExecution,'function')
 const policy=defaultPolicy(),sessionId='layout-job',events=[
  {type:'request/header',seq:2,time:1,data:{header:{config:{provider:'actual-provider',model:'actual-model'}}}},
  {type:'llm/retry',seq:3,data:{failure:{code:'SERVER',message:'API error (504): Provider unavailable'},retry:1}},
  {type:'turn/end',seq:4,data:{reason:{kind:'aborted'}}},
 ]
 const trace=reference.layoutReferenceExecution(events,{sessionId,policy})
 assert.equal(trace.parent.requests[0].model,'actual-model')
 assert.equal(trace.actualRoute.provider,'actual-provider')
 assert.equal(trace.failure.httpStatus,504)
 assert.equal(trace.failure.code,'SERVER')
 assert.equal(trace.outcome,'aborted')
 assert.equal(trace.requestedPolicyRevision,policy.revision)
 assert.equal(reference.layoutReferenceExecution([],{sessionId,policy}).actualRoute,null)
})

test('真实DSH启动后版式约束已就绪，发往Responses接口的请求没有工具且包含版式边界',{timeout:60000},async t=>{
 const {createServer}=await import('node:http'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{randomUUID}=await import('node:crypto')
 const root=await mkdtemp(join(tmpdir(),'layout-runtime-test-')),requests=[],policy=defaultPolicy(),row=policy.models[0];let broken=false
 row.status='verified';row.capabilities.tools=true;row.maxOutputTokens=8192;policy.routes.parent={primary:{provider:row.provider,model:row.model},fallbacks:[]}
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));res.writeHead(200,{'content-type':'text/event-stream'})
  const text='{"reply":"连接验证"}',part={type:'output_text',text,annotations:[]},item={type:'message',id:'msg_fixture',role:'assistant',status:'completed',content:[part]},response={id:'resp_fixture',model:row.model,status:'in_progress',output:[]}
  const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n')
  send('response.created',{response});send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}})
  send('response.content_part.added',{output_index:0,content_index:0,item_id:item.id,part:{...part,text:''}})
  send('response.output_text.delta',{output_index:0,content_index:0,item_id:item.id,delta:text})
  send('response.output_text.done',{output_index:0,content_index:0,item_id:item.id,text})
  send('response.output_item.done',{output_index:0,item})
  if(broken){send('error',{error:{type:'provider_error',message:'Provider stream interrupted or invalid'}});res.end();return}
  send('response.completed',{response:{...response,status:'completed',output:[item],usage:{input_tokens:10,output_tokens:8,total_tokens:18}}});res.end()
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})})
 const workers={config:{privateRoot:root},configuration:async()=>({model:{parent:{provider:row.runtimeProvider,model:row.model},providers:{[row.runtimeProvider]:{api:'openai-responses',baseURL:'http://127.0.0.1:'+server.address().port+'/v1',apiKeyEnv:'LOCAL_TEST_KEY',models:[{id:row.model,maxTokens:8192,input:['text']}]}},env:{LOCAL_TEST_KEY:'local-fixture'}}})}
 const result=await reference.runLayoutReference(workers,{jobId:randomUUID(),prompt:'仅回复JSON。',policy,signal:AbortSignal.timeout(40000)})
 assert.equal(result.execution.outcome,'completed');assert.equal(result.response,'{"reply":"连接验证"}')
 assert.equal(requests.length,1);assert.equal(requests[0].model,row.model);assert.equal(requests[0].max_output_tokens,8192)
 assert.equal(requests[0].tools?.length??0,0,'版式参考会话不能携带项目或系统工具')
 assert.match(JSON.stringify(requests[0].input),/当前是版式库的只读参考提炼/)
 broken=true
 await assert.rejects(reference.runLayoutReference(workers,{jobId:randomUUID(),prompt:'仅回复JSON。',policy,signal:AbortSignal.timeout(40000)}),error=>{
  assert.equal(error.execution.outcome,'error');assert.equal(error.execution.failure.category,'provider_stream_invalid');assert.equal(error.execution.toolPolicy,'none');return true
 })
})
