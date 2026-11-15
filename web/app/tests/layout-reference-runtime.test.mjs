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
