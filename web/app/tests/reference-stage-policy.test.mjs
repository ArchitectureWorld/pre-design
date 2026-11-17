import test from 'node:test'
import assert from 'node:assert/strict'
import {stagePolicyWithOutputLimit,validateStageOutputLimits} from '../src/layout-library/reference-stage-policy.mjs'
const policy={revision:21,routes:{parent:{model:'a'}},models:[{id:'a',maxOutputTokens:4096},{id:'b',maxOutputTokens:65536}]}
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
