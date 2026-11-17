import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {registerLayoutRoutes} from '../src/layout-library/routes.mjs'
import {createLayoutConversations} from '../src/layout-library/conversations.mjs'
import {workflowFixture} from './fixtures/reference-workflow.mjs'
test('existing V14 conversation API accepts native scope/fidelity without a separate entry',async t=>{
 const app=Fastify(),seen=[];t.after(()=>app.close())
 registerLayoutRoutes({app,library:{},enqueueReference:async(_req,body)=>{seen.push(body);return {status:'queued'}},listConversations:async()=>[],getConversation:async()=>({}),listReferenceJobs:async()=>[],referenceConfiguration:async()=>({}),cancelReference:async()=>({}),retryReference:async()=>({})})
 const response=await app.inject({method:'POST',url:'/api/layout-library/conversations',payload:{requestId:'native-api',text:'参考设计',files:[],referencePipeline:'native-v3',referenceScope:'layout',referenceFidelity:'fidelity',allowModel:true}})
 assert.equal(response.statusCode,200);assert.equal(seen[0].referencePipeline,'native-v3');assert.equal(seen[0].referenceScope,'layout')
 const rejected=await app.inject({method:'POST',url:'/api/layout-library/conversations',payload:{requestId:'invalid',text:'mirror',referencePipeline:'native-v3',referenceFidelity:'mirror',allowModel:true}})
 assert.notEqual(rejected.statusCode,200);assert.equal(seen.length,1)
})
test('prepared native conversation carries native options into original job payload',async()=>{
 const files=workflowFixture().payload.referenceFiles,db={query:async()=>({rows:[]})},uploads={resolveFiles:async()=>files,validateImageBudget:async()=>{}}
 const conversations=createLayoutConversations(db,{},uploads)
 const p=await conversations.prepare({id:'owner'},{text:'设计参考',referencePipeline:'native-v3',referenceScope:'brand',referenceFidelity:'fidelity',files},'new-job',db)
 assert.equal(p.referenceAnalysisRequired,true);assert.equal(p.referencePipeline,'native-v3');assert.equal(p.referenceScope,'brand');assert.equal(p.referenceFidelity,'fidelity')
})
