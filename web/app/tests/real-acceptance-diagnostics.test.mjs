import test from 'node:test'
import assert from 'node:assert/strict'
import {acceptanceErrorRecord,timedAcceptanceModel} from '../../../scripts/layout-library/real-acceptance-diagnostics.mjs'
test('time-budget cancellation remains distinguishable from a transport failure',()=>{
 const error=Object.assign(Error('closed'),{name:'TransportClosedError',execution:{failedStage:'prototype-2'}}),controller=new AbortController()
 assert.equal(acceptanceErrorRecord(error,controller.signal).code,'TransportClosedError')
 controller.abort(Error('ACCEPTANCE_TIMEOUT'))
 assert.deepEqual(acceptanceErrorRecord(error,controller.signal),{code:'ACCEPTANCE_TIMEOUT',underlyingCode:'TransportClosedError',failedStage:'prototype-2',cancelled:true,stopReason:'time-budget'})
})
test('model diagnostics measure return latency and activity without claiming validation or known cost',async()=>{
 const records=[],times=[1000,1250,1800];let forwarded=0
 const result=await timedAcceptanceModel({stage:'profile',onEvent:()=>forwarded++},async input=>{input.onEvent({stage:'generating'});return{response:'not necessarily valid JSON',execution:{actualRoute:{provider:'configured',model:'model'},actualUsage:null,parent:{requests:[{},{}]}}}},records,{now:()=>times.shift()})
 assert.equal(result.response,'not necessarily valid JSON');assert.equal(forwarded,1)
 assert.equal(records[0].status,'returned');assert.equal(records[0].elapsedMs,800);assert.equal(records[0].firstActivityAfterMs,250);assert.equal(records[0].actualRequests,2);assert.equal(records[0].actualUsage,null)
})
test('cancelled model traces retain partial request evidence and do not retry',async()=>{
 const records=[],controller=new AbortController();let calls=0
 await assert.rejects(timedAcceptanceModel({stage:'prototype-2',signal:controller.signal},async()=>{calls++;controller.abort(Error('ACCEPTANCE_TIMEOUT'));throw Object.assign(Error('closed'),{name:'TransportClosedError',execution:{parent:{requests:[{}]}}})},records))
 assert.equal(calls,1);assert.equal(records[0].status,'cancelled');assert.equal(records[0].actualRequests,1);assert.equal(records[0].error.code,'ACCEPTANCE_TIMEOUT');assert.equal(records[0].firstActivityAfterMs,null)
})
test('capacity diagnostics retain only bounded structural fields, never arbitrary model text',()=>{
 const error=Object.assign(Error('PRIVATE BUSINESS'),{code:'REFERENCE_PROFILE_CAPACITY_INVALID',details:{archetypeId:'archetype-1',role:'body',field:'bodyPoints',capacity:2,privateText:'PRIVATE BUSINESS'}})
 const r=acceptanceErrorRecord(error)
 assert.deepEqual(r.details,{archetypeId:'archetype-1',role:'body',field:'bodyPoints',capacity:2})
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE BUSINESS|privateText/)
 error.details.archetypeId='private title with spaces';assert.equal(acceptanceErrorRecord(error).details,undefined)
})
