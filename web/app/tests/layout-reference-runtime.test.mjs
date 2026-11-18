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
 const workers={config:{privateRoot:root},configuration:async()=>({model:{parent:{provider:row.runtimeProvider,model:row.model},providers:{[row.runtimeProvider]:{api:'openai-responses',baseURL:'http://127.0.0.1:'+server.address().port+'/v1',apiKeyEnv:'LOCAL_TEST_KEY',models:[{id:row.model,maxTokens:8192,input:['text','image']}]}},env:{LOCAL_TEST_KEY:'local-fixture'}}})}
 const result=await reference.runLayoutReference(workers,{jobId:randomUUID(),prompt:'仅回复JSON。',policy,signal:AbortSignal.timeout(40000)})
 assert.equal(result.execution.outcome,'completed');assert.equal(result.response,'{"reply":"连接验证"}')
 assert.equal(requests.length,1);assert.equal(requests[0].model,row.model);assert.equal(requests[0].max_output_tokens,8192)
 assert.equal(requests[0].tools?.length??0,0,'版式参考会话不能携带项目或系统工具')
 assert.match(JSON.stringify(requests[0].input),/当前是版式库的只读参考提炼/)
 assert.match(JSON.stringify(requests[0].input),/专用的版式提炼器/)
 assert(!/coding assistant|software engineer|\bbash\b/i.test(JSON.stringify(requests[0].input)),'独立提炼不应继承通用编程系统提示或shell环境')
 const sharp=(await import('sharp')).default,bytes=await sharp({create:{width:32,height:24,channels:3,background:'#235740'}}).png().toBuffer()
 const fileId=randomUUID(),images=Array.from({length:30},(_,index)=>({fileId,name:'30页参考.pdf',page:index+1,mimeType:'image/png',data:bytes.toString('base64'),sha256:'a'.repeat(64)}))
 const visual=await reference.runLayoutReference(workers,{jobId:randomUUID(),prompt:'读取这张参考图。',images,modelRole:'vision',policy,signal:AbortSignal.timeout(40000)})
 const imageBlocks=requests[1].input.flatMap(message=>message.content??[]).filter(block=>block.type==='input_image');assert.equal(imageBlocks.length,30)
 const image=imageBlocks.at(-1)
 assert(image?.image_url?.startsWith('data:image/png;base64,'),'真正的图片字节应进入模型请求')
 assert.deepEqual(Buffer.from(image.image_url.split(',')[1],'base64'),bytes)
 assert.equal(visual.execution.referenceImages.length,30);assert.equal(visual.execution.referenceImages.at(-1).page,30)
 assert.equal(visual.execution.requestedRole,'vision');assert.equal(visual.execution.referenceImages[0].fileId,images[0].fileId)
 assert(!JSON.stringify(visual.execution).includes(images[0].data),'公开收执不包含图片正文')
 await assert.rejects(reference.runLayoutReference(workers,{jobId:randomUUID(),prompt:'图片',images,modelRole:'parent',policy}),/LAYOUT_VISION_ROLE_REQUIRED/)
 broken=true
 await assert.rejects(reference.runLayoutReference(workers,{jobId:randomUUID(),prompt:'仅回复JSON。',policy,signal:AbortSignal.timeout(40000)}),error=>{
  assert.equal(error.execution.outcome,'error');assert.equal(error.execution.failure.category,'provider_stream_invalid');assert.equal(error.execution.toolPolicy,'none');return true
 })
})

test('图片参考固定使用图片理解主备链，不能回退到文字模型',async()=>{
 const {materializeModelRuntime}=await import('../../worker/model-runtime.mjs')
 const policy=defaultPolicy(),vision=policy.models.find(m=>m.provider==='SenseNova'&&m.model==='sensenova-6.8-flash-lite'),text=policy.models.find(m=>m.provider==='SenseNova'&&m.model==='glm-5.3'),primary=policy.models.find(m=>m.provider==='yaoguang-codex')
 for(const row of [vision,text,primary]){row.status='verified';row.capabilities.tools=true}
 primary.capabilities.vision=true
 policy.routes.parent={primary:{provider:text.provider,model:text.model},fallbacks:[]}
 policy.routes.vision={primary:{provider:primary.provider,model:primary.model},fallbacks:[{provider:vision.provider,model:vision.model}]}
 const settings={'llm-pi-ai':{providers:{SenseNova:{api:'openai-completions',baseURL:'https://fixture.invalid/v1',apiKeyEnv:'KEY'},'yaoguang-codex':{api:'openai-responses',baseURL:'https://fixture.invalid/v1',apiKeyEnv:'KEY2'}}}},credentials={refs:{KEY:'fixture',KEY2:'fixture'}}
 const runtime=materializeModelRuntime(policy,settings,credentials,['vision'],{parentRole:'vision'})
 assert.deepEqual(runtime.parent,{provider:primary.runtimeProvider,model:primary.model});assert(!runtime.providers.SenseNova.models.some(m=>m.id===text.model))
 const hooks=new Map();await installModelBoundary({on:(n,fn)=>hooks.set(n,fn)},{sessionId:'layout-test',snapshot:policy,classRoutes:{},parentRole:'vision'})
 const fail=hooks.get('agent/request-error'),request=hooks.get('agent/request')
 assert.equal(await fail({agent:{id:'layout-test'},provider:primary.runtimeProvider,failure:{code:'PI_AI_ERROR',message:'unrelated response error'}},()=>null),null)
 assert.deepEqual(await fail({agent:{id:'layout-test'},provider:primary.runtimeProvider,failure:{code:'PI_AI_ERROR',message:'Provider stream interrupted or invalid'}},()=>null),{kind:'retry'})
 const next=await request({agent:{id:'layout-test'}},()=>({}));assert.equal(next.model,vision.model)
 assert.equal(await fail({agent:{id:'layout-test'},provider:vision.runtimeProvider,failure:{code:'SERVER'}},()=>null),null)
})

test('版式网关拒绝大请求可沿已配视觉备用链继续，真实上下文超限不擅自重试',async()=>{
 const policy=defaultPolicy(),primary=policy.models.find(m=>m.provider==='yaoguang-codex'),visual=policy.models.find(m=>m.provider==='SenseNova'&&m.model==='sensenova-6.8-flash-lite')
 for(const row of [primary,visual]){row.status='verified';row.capabilities.tools=true;row.capabilities.vision=true}
 policy.routes.vision={primary:{provider:primary.provider,model:primary.model},fallbacks:[{provider:visual.provider,model:visual.model}]}
 const bodyLimit={code:'CONTEXT_WINDOW_EXCEEDED',message:primary.runtimeProvider+' API error (413): {"message":"Request body exceeds the gateway limit","type":"invalid_request_error"}'}
 for(const enabled of [false,true]){
  const hooks=new Map();await installModelBoundary({on:(n,fn)=>hooks.set(n,fn)},{sessionId:'layout-size',snapshot:policy,classRoutes:{},parentRole:'vision',allowRequestSizeFallback:enabled})
  const fail=hooks.get('agent/request-error'),request=hooks.get('agent/request'),base={agent:{id:'layout-size'},provider:primary.runtimeProvider}
  assert.equal(await fail({...base,failure:{code:'CONTEXT_WINDOW_EXCEEDED',message:'maximum context length exceeded'}},()=>null),null)
  const result=await fail({...base,failure:bodyLimit},()=>null);assert.deepEqual(result,enabled?{kind:'retry'}:null)
  assert.equal((await request({agent:{id:'layout-size'}},()=>({}))).model,enabled?visual.model:primary.model)
  assert.equal(await fail({...base,provider:visual.runtimeProvider,failure:bodyLimit},()=>null),null)
 }
})

test('真实DSH携图时仅沿视觉备用链切换协议，保留图片且不接受失败流的正文',{timeout:60000},async t=>{
 const {createServer}=await import('node:http'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{randomUUID}=await import('node:crypto'),{materializeModelRuntime}=await import('../../worker/model-runtime.mjs'),sharp=(await import('sharp')).default
 const policy=defaultPolicy(),visual=policy.models.find(m=>m.provider==='SenseNova'&&m.model==='sensenova-6.8-flash-lite'),text=policy.models.find(m=>m.provider==='SenseNova'&&m.model==='glm-5.3'),primary=policy.models.find(m=>m.provider==='yaoguang-codex')
 for(const row of [visual,text,primary]){row.status='verified';row.capabilities.tools=true;row.maxOutputTokens=8192};primary.capabilities.vision=true
 policy.routes.parent={primary:{provider:text.provider,model:text.model},fallbacks:[]};policy.routes.vision={primary:{provider:primary.provider,model:primary.model},fallbacks:[{provider:visual.provider,model:visual.model}]}
 const root=await mkdtemp(join(tmpdir(),'layout-vision-fallback-')),requests=[],image=await sharp({create:{width:32,height:24,channels:3,background:'#3454a0'}}).png().toBuffer();let gatewayBodyLimit=false
 const server=createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests.push({body,authorization:req.headers.authorization,path:req.url})
  if(body.model===primary.model&&gatewayBodyLimit){res.writeHead(413,{'content-type':'application/json'});res.end(JSON.stringify({message:'Request body exceeds the gateway limit',type:'invalid_request_error'}));return}
  res.writeHead(200,{'content-type':'text/event-stream'})
  if(body.model===primary.model){res.end('event: error\ndata: '+JSON.stringify({type:'error',error:{type:'provider_error',message:'Provider stream interrupted or invalid'}})+'\n\n');return}
  const base={id:'vision-fixture',object:'chat.completion.chunk',created:1,model:body.model}
  res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:'{"reply":"视觉备用模型已读取"}'},finish_reason:null}]})+'\n\n')
  res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:8,total_tokens:18}})+'\n\ndata: [DONE]\n\n')
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})})
 const baseURL='http://127.0.0.1:'+server.address().port+'/v1',settings={'llm-pi-ai':{providers:{SenseNova:{api:'openai-completions',baseURL,apiKeyEnv:'SENSE'},'yaoguang-codex':{api:'openai-responses',baseURL,apiKeyEnv:'YAO'}}}},credentials={refs:{SENSE:'sense-fixture',YAO:'yao-fixture'}}
 const workers={config:{privateRoot:root},configuration:async(snapshot,roles,options)=>{assert.deepEqual(roles,['vision']);assert.equal(options.parentRole,'vision');return {model:materializeModelRuntime(snapshot,settings,credentials,roles,options)}}}
 const result=await reference.runLayoutReference(workers,{jobId:randomUUID(),prompt:'根据图片生成版式。',images:[{fileId:randomUUID(),name:'参考.png',data:image.toString('base64'),mimeType:'image/png',sha256:'b'.repeat(64)}],policy,signal:AbortSignal.timeout(40000)})
 assert.equal(result.response,'{"reply":"视觉备用模型已读取"}');assert.equal(result.execution.requestedRole,'vision');assert.equal(result.execution.actualRoute.model,visual.model)
 assert.deepEqual(requests.map(r=>r.body.model),[primary.model,visual.model]);assert.deepEqual(requests.map(r=>r.path),['/v1/responses','/v1/chat/completions'])
 assert.deepEqual(requests.map(r=>r.authorization),['Bearer yao-fixture','Bearer sense-fixture'])
 const first=requests[0].body.input.flatMap(m=>m.content??[]).find(c=>c.type==='input_image')?.image_url,second=requests[1].body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).find(c=>c.type==='image_url')?.image_url?.url
 assert(first&&second);assert.deepEqual(Buffer.from(first.split(',')[1],'base64'),image);assert.deepEqual(Buffer.from(second.split(',')[1],'base64'),image)
 gatewayBodyLimit=true
 const large=await reference.runLayoutReference(workers,{jobId:randomUUID(),prompt:'分析前30页。',images:Array.from({length:30},(_,i)=>({fileId:randomUUID(),name:'参考.pdf',page:i+1,data:image.toString('base64'),mimeType:'image/png',sha256:'b'.repeat(64)})),policy,signal:AbortSignal.timeout(40000)})
 assert.equal(large.execution.actualRoute.model,visual.model);assert.equal(large.execution.referenceImages.length,30)
 const fallbackImages=requests.at(-1).body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(c=>c.type==='image_url');assert.equal(fallbackImages.length,30);assert.deepEqual(Buffer.from(fallbackImages.at(-1).image_url.url.split(',')[1],'base64'),image)
})

test('持久化attempt失败保留安全原因及请求耗时，不将成功fallback误报无失败',()=>{
 const policy=defaultPolicy(),sessionId='layout-job',header=(seq,time,model)=>({type:'request/header',seq,time,data:{header:{config:{provider:'provider',model}}}})
 const events=[header(1,1000,'primary'),{type:'assistant/attempt',seq:2,time:48577,data:{stream:[{type:'chunk',chunk:{type:'finish',reason:{kind:'error',failure:{code:'SERVER',message:'API error (504): private business body secret request_id'}}}}]}},header(3,48579,'fallback'),{type:'turn/end',seq:4,time:547370,data:{reason:{kind:'completed'}}}]
 const trace=reference.layoutReferenceExecution(events,{sessionId,policy})
 assert.equal(trace.failure?.code,'SERVER');assert.equal(trace.failure.httpStatus,504)
 assert.deepEqual(trace.attempts.map(x=>[x.model,x.elapsedMs,x.failure?.code??null]),[['primary',47577,'SERVER'],['fallback',498791,null]])
 assert.equal(trace.attempts[0].endedBy,'assistant/attempt');assert.equal(trace.attempts[1].endedBy,'turn/end')
 assert(!JSON.stringify(trace).includes('private business'));assert(!JSON.stringify(trace).includes('request_id'))
 assert.equal(trace.actualRoute.model,'fallback');assert.equal(trace.outcome,'completed')
})

test('缺失结束事件不捏造耗时，未知错误码不泄漏正文',()=>{
 const policy=defaultPolicy(),sessionId='layout-job',header={type:'request/header',seq:1,time:1000,data:{header:{config:{provider:'p',model:'m'}}}}
 const trace=reference.layoutReferenceExecution([header],{sessionId,policy})
 assert.equal(trace.attempts[0].elapsedMs,null);assert.equal(trace.attempts[0].endedBy,null)
 const failed=reference.layoutReferenceExecution([header,{type:'assistant/attempt',seq:2,time:1200,data:{stream:[{chunk:{type:'finish',reason:{failure:{code:'private customer note',message:'private body'}}}}]}}],{sessionId,policy})
 assert.equal(failed.failure.code,'LAYOUT_MODEL_ERROR');assert(!JSON.stringify(failed).includes('private'))
})

test('retry失败归属当前请求，下一请求仅是上界且诊断采用固定白名单',()=>{
 const policy=defaultPolicy(),sessionId='layout-job',h=(seq,time)=>({type:'request/header',seq,time,data:{header:{config:{provider:'p',model:'m'+seq}}}})
 let events=[h(1,100),{type:'llm/retry',seq:2,time:200,data:{failure:{code:'SERVER',message:'API error (504): unavailable'}}},h(3,300)]
 let trace=reference.layoutReferenceExecution(events,{sessionId,policy})
 assert.equal(trace.attempts[0].elapsedMs,100);assert.equal(trace.attempts[0].failure.code,'SERVER')
 trace=reference.layoutReferenceExecution([h(1,100),h(3,300)],{sessionId,policy})
 assert.equal(trace.attempts[0].elapsedMs,null);assert.equal(trace.attempts[0].nextRequestAfterMs,200)
 events[1].data.failure={code:'PRIVATE_CUSTOMER_TOKEN_ABC123',message:'private account 401 pending'}
 trace=reference.layoutReferenceExecution(events,{sessionId,policy})
 assert.equal(trace.failure.code,'LAYOUT_MODEL_ERROR');assert.equal(trace.failure.httpStatus,null);assert(!JSON.stringify(trace).includes('PRIVATE_CUSTOMER'))
})
test('只记录已报告的数值token用量，不伪造费用或重复计算事件',()=>{
 const event={type:'assistant/message',seq:1,data:{usage:{inputTokens:10,outputTokens:4,totalTokens:14,secret:'private'},message:{content:'private'}}}
 const trace=reference.layoutReferenceExecution([event,event],{sessionId:'layout-job',policy:defaultPolicy()})
 assert.deepEqual(trace.actualUsage,{inputTokens:10,outputTokens:4,totalTokens:14,coverage:'reported-assistant-messages-only',reportedMessages:1,currencyCost:null})
 assert(!JSON.stringify(trace).includes('private'))
 for(const usage of [undefined,{inputTokens:-1,outputTokens:4,totalTokens:3},{inputTokens:10,outputTokens:4,totalTokens:99}]){
  assert.equal(reference.layoutReferenceExecution([{...event,data:{usage}}],{sessionId:'layout-job',policy:defaultPolicy()}).actualUsage,null)
 }
})
