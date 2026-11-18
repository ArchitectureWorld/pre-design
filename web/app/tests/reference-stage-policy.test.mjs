import test from 'node:test'
import assert from 'node:assert/strict'
import {stagePolicyWithOutputLimit,validateStageOutputLimits} from '../src/layout-library/reference-stage-policy.mjs'
const policy={revision:21,routes:{parent:{primary:{provider:'p',model:'a'},fallbacks:[{provider:'p',model:'b'}]}},models:[{provider:'p',model:'a',maxOutputTokens:4096},{provider:'p',model:'b',maxOutputTokens:65536}]}
test('only selected stage caps every fallback without mutating stored policy',()=>{
 const limits={'prototype-3':8192},before=JSON.stringify(policy)
 assert.equal(stagePolicyWithOutputLimit(policy,'profile',limits),policy)
 const limited=stagePolicyWithOutputLimit(policy,'prototype-3',limits)
 assert.deepEqual(limited.models.map(x=>x.maxOutputTokens),[4096,8192]);assert.equal(JSON.stringify(policy),before)
 assert.deepEqual(limited.routes,policy.routes)
})
test('invalid caps and unexpected stage names fail closed',()=>{
 for(const limits of [[],null,{'prototype-3':0},{'prototype-3':8192.1},{'prototype-3':65536},{oops:8192},{'prototype-0':8192}])assert.throws(()=>validateStageOutputLimits(limits),/REFERENCE_STAGE_LIMIT_INVALID/)
 assert.doesNotThrow(()=>validateStageOutputLimits(undefined))
 assert.throws(()=>stagePolicyWithOutputLimit({models:[{}]},'prototype-3',{'prototype-3':8192}),/REFERENCE_STAGE_LIMIT_INVALID/)
})
test('mixed real catalog caps selected vision chain only, including optional unknown limits',()=>{
 const source={revision:21,routes:{vision:{primary:{provider:'p',model:'vision'},fallbacks:[{provider:'q',model:'backup'}]},parent:{primary:{provider:'p',model:'text'},fallbacks:[]}},models:[{provider:'p',model:'vision',maxOutputTokens:8192},{provider:'q',model:'backup'},{provider:'p',model:'text',maxOutputTokens:16000},{provider:'p',model:'image',capabilities:{image:true}}]}
 const before=JSON.stringify(source)
 const result=stagePolicyWithOutputLimit(source,'prototype-3',{'prototype-3':4096},'vision')
 assert.deepEqual(result.models.map(m=>m.maxOutputTokens),[4096,4096,16000,undefined]);assert.equal(JSON.stringify(source),before)
})
test('selected chain rejects missing, duplicate or invalid models and never changes unrelated entries',()=>{
 const caps={'prototype-1':2048},valid={routes:{parent:{primary:{provider:'p',model:'a'},fallbacks:[]}},models:[{provider:'p',model:'a',maxOutputTokens:1000},{provider:'unused',model:'bad',maxOutputTokens:0}]}
 assert.equal(stagePolicyWithOutputLimit(valid,'prototype-1',caps).models[0].maxOutputTokens,1000)
 for(const mutate of [p=>p.models.shift(),p=>p.models.push({...p.models[0]}),p=>p.models[0].maxOutputTokens=0,p=>p.routes.parent.fallbacks.push({...p.routes.parent.primary}),p=>p.routes.parent.primary=null]){const p=structuredClone(valid);mutate(p);assert.throws(()=>stagePolicyWithOutputLimit(p,'prototype-1',caps),/REFERENCE_STAGE_LIMIT_INVALID/)}
 assert.throws(()=>stagePolicyWithOutputLimit(valid,'prototype-1',caps,'image'),/REFERENCE_STAGE_LIMIT_INVALID/)
})
