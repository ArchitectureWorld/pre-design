import test from 'node:test';import assert from 'node:assert/strict'
import {Context} from '../../worker/node_modules/@deepseek-ai/cordis/lib/index.js'
import {apply as wireApply} from '../../worker/layout-wire-budget.mjs'
import {apply as requestApply} from '../../worker/layout-request-budget.mjs'
import {layoutSdkDependencies} from '../../worker/layout-reference-runner.mjs'
test('budget dependencies are mandatory only for explicitly bounded sessions',()=>{assert.deepEqual(layoutSdkDependencies({}),['sdkAppStartup','loader','preLayoutReferenceReady']);assert.ok(layoutSdkDependencies({wireBudget:{},requestBudget:{}}).includes('preLayoutWireBudgetReady'));assert.ok(layoutSdkDependencies({wireBudget:{},requestBudget:{}}).includes('preLayoutRequestBudgetReady'))})
test('actual Cordis cannot start consumer when either budget plugin initialization fails',async()=>{
 for(const apply of [wireApply,requestApply]){const ctx=new Context();let sends=0;ctx.on('internal/error',()=>{});ctx.provide('sdkAppStartup',true);ctx.provide('loader',true);ctx.provide('preLayoutReferenceReady',true);ctx.provide('agents',{});ctx.provide(apply===wireApply?'preLayoutRequestBudgetReady':'preLayoutWireBudgetReady',true);
 const consumer=ctx.plugin({inject:layoutSdkDependencies({wireBudget:{},requestBudget:{}}),apply(){sends++}})
 const previous=globalThis.fetch;let failing;try{failing=ctx.plugin({apply});await new Promise(r=>setTimeout(r,20));assert.equal(sends,0)}finally{globalThis.fetch=previous;await failing?.dispose();await consumer.dispose()}
 }
})
test('actual Cordis starts consumer only after both real guards install successfully',async()=>{
 const ctx=new Context();let starts=0;for(const n of ['sdkAppStartup','loader','preLayoutReferenceReady','agents'])ctx.provide(n,true)
 const consumer=ctx.plugin({inject:layoutSdkDependencies({requestBudget:{},wireBudget:{}}),apply(){starts++}}),priorFetch=globalThis.fetch,priorWire=process.env.PRE_WEB_LAYOUT_WIRE_BUDGET,priorRequest=process.env.PRE_WEB_LAYOUT_REQUEST_BUDGET
 let wire,request
 try{process.env.PRE_WEB_LAYOUT_WIRE_BUDGET=JSON.stringify({url:'https://example.invalid/v1/responses',protocol:'openai-responses',model:'test',imageSha256:'a'.repeat(64),maxBodyBytes:800000,deadlineAt:Date.now()+10000,receiptPath:'/not-used'});process.env.PRE_WEB_LAYOUT_REQUEST_BUDGET=JSON.stringify({maxRequests:1,deadlineAt:Date.now()+10000});wire=ctx.plugin({apply:wireApply});await new Promise(r=>setTimeout(r,10));assert.equal(starts,0);request=ctx.plugin({apply:requestApply});await new Promise(r=>setTimeout(r,10));assert.equal(starts,1);assert.notEqual(globalThis.fetch,priorFetch)}finally{globalThis.fetch=priorFetch;if(priorWire===undefined)delete process.env.PRE_WEB_LAYOUT_WIRE_BUDGET;else process.env.PRE_WEB_LAYOUT_WIRE_BUDGET=priorWire;if(priorRequest===undefined)delete process.env.PRE_WEB_LAYOUT_REQUEST_BUDGET;else process.env.PRE_WEB_LAYOUT_REQUEST_BUDGET=priorRequest;await request?.dispose();await wire?.dispose();await consumer.dispose()}
})
