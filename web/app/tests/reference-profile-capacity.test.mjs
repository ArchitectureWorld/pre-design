import test from 'node:test'
import assert from 'node:assert/strict'
import {profileFixture,workflowFixture,observationFixture} from './fixtures/reference-workflow.mjs'
import {validateProfileCapacityRoles} from '../src/layout-library/reference-profile.mjs'
import {runReferenceWorkflow} from '../src/layout-library/reference-workflow.mjs'
test('positive declared capacities require the corresponding real content role',()=>{
 for(const [role,field,value]of [['body','bodyPoints',2],['image','images',1],['table','tableRows',17],['text','textBlocks',3]]){
  const p=profileFixture(),a=p.archetypes[0];a.roles=a.roles.filter(r=>r!==role);a.capacity[field]=value
  assert.throws(()=>validateProfileCapacityRoles(p),e=>e.code==='REFERENCE_PROFILE_CAPACITY_INVALID'&&e.details.field===field)
 }
 assert.doesNotThrow(()=>validateProfileCapacityRoles(profileFixture()))
})
test('text role cannot leave independent text capacity unspecified',()=>{
 const p=profileFixture();p.archetypes[0].roles.push('text');assert.throws(()=>validateProfileCapacityRoles(p))
 p.archetypes[0].capacity.textBlocks=2;assert.doesNotThrow(()=>validateProfileCapacityRoles(p))
})
test('component v2 rejects the actual chapter contradiction before any coverage/spec/prototype call; v1 stays compatible',async()=>{
 for(const version of [1,2]){
  const f=workflowFixture(),calls=[],p=profileFixture();p.archetypes[0].roles=p.archetypes[0].roles.filter(r=>r!=='body');p.archetypes[0].capacity.bodyPoints=2
  Object.assign(f.payload,{referencePipeline:'native-v3',referenceComponentVersion:version})
  await assert.rejects(runReferenceWorkflow({jobId:'capacity-gate',...f,runModel:async input=>{
   calls.push(input.stage)
   if(input.stage.startsWith('observe-'))return{response:observationFixture(input.images)}
   if(input.stage==='profile')return{response:p}
   throw Object.assign(Error('stop test after accepted profile'),{code:'TEST_PROFILE_ACCEPTED'})
  }}),e=>e.code===(version===2?'REFERENCE_PROFILE_CAPACITY_INVALID':'TEST_PROFILE_ACCEPTED'))
  assert.deepEqual(calls,version===2?['observe-1','observe-2','profile']:['observe-1','observe-2','profile','design-spec'])
 }
})
test('profile-only exits immediately after validation without any downstream checkpoint lookup',async()=>{
 const f=workflowFixture(),calls=[],keys=[]
 Object.assign(f.payload,{referencePipeline:'native-v3',referenceComponentVersion:2})
 const result=await runReferenceWorkflow({jobId:'profile-only',...f,stopAfterProfile:true,stageCheckpoints:{get:async key=>{keys.push(key)},put:async()=>{}},runModel:async input=>{
  calls.push(input.stage)
  if(input.stage.startsWith('observe-'))return{response:observationFixture(input.images)}
  if(input.stage==='profile')return{response:profileFixture()}
  throw Error('DOWNSTREAM_NOT_ALLOWED')
 }})
 assert.deepEqual(calls,['observe-1','observe-2','profile']);assert.equal(keys.length,3)
 assert.equal(result.execution.outcome,'profile-only');assert.equal(result.response,null);assert(result.analysis.profile)
})
test('profile-only cached replay stops before downstream get even when checkpoint store could provide more',async()=>{
 const f=workflowFixture(),saved=new Map(),gets=[];Object.assign(f.payload,{referencePipeline:'native-v3',referenceComponentVersion:2})
 const args={jobId:'profile-cache',...f,stopAfterProfile:true,stageCheckpoints:{get:async key=>{gets.push(key);return saved.get(key)},put:async(key,value)=>saved.set(key,value)}}
 await runReferenceWorkflow({...args,runModel:async input=>({response:input.stage==='profile'?profileFixture():observationFixture(input.images)})})
 const expected=[...gets];gets.length=0
 const replay=await runReferenceWorkflow({...args,runModel:async()=>{throw Error('NO_MODEL_ALLOWED')}})
 assert.deepEqual(gets,expected);assert.equal(gets.length,3);assert.equal(replay.execution.outcome,'profile-only');assert.equal(replay.response,null)
 assert(replay.execution.stages.filter(s=>s.stage!=='inventory').every(s=>s.reused))
})
