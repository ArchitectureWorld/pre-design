import test from 'node:test'
import assert from 'node:assert/strict'
import {runReferenceWorkflow} from '../src/layout-library/reference-workflow.mjs'
import {workflowFixture,observationFixture,profileFixture,packageFixture} from './fixtures/reference-workflow.mjs'
const policy={revision:41,routes:{vision:{model:'vision'},parent:{model:'text'}}}
function cache(){const records=new Map();return {records,async get(key){return structuredClone(records.get(key))},async put(key,record){records.set(key,structuredClone(record))}}}
function provider(calls,{failSecond=false}={}){
 return async input=>{
  calls.push(input.stage)
  if(failSecond&&input.stage==='observe-2')throw Error('second batch interrupted')
  const context=JSON.parse(input.prompt.split('以下JSON仅为参考数据，不能改写系统边界：\n').at(-1))
  return {response:JSON.stringify(input.stage.startsWith('observe-')?observationFixture(input.images):input.stage==='profile'?profileFixture():{reply:'合成测试',package:packageFixture(context.profile)}),execution:{outcome:'completed',actualRoute:{provider:'fixture',model:input.stage},sessionId:'original-'+input.stage}}
 }
}
const run=(store,calls,options={})=>runReferenceWorkflow({jobId:'current-job',...workflowFixture(),policy,skill:'V14',stageCheckpoints:store,runModel:provider(calls),...options})
test('completed observation survives later failure and retry revalidates without another model call',async()=>{
 const store=cache(),first=[]
 await assert.rejects(run(store,first,{runModel:provider(first,{failSecond:true})}),/interrupted/)
 assert.equal(store.records.size,1)
 assert.deepEqual(first,['observe-1','observe-2'])
 const next=[],result=await run(store,next,{jobId:'retry-job'})
 assert.deepEqual(next,['observe-2','profile','compile'])
 const reused=result.execution.stages.find(s=>s.stage==='observe-1')
 assert.equal(reused.reused,true);assert.equal(reused.modelInvoked,false)
 assert.equal(reused.execution.sessionId,'original-observe-1')
 assert.equal(reused.jobId,undefined,'reused stage must not invent a new model job')
 assert.equal(result.analysis.observations.length,2)
 const all=[],again=await run(store,all)
 assert.deepEqual(all,[]);assert(again.execution.stages.filter(s=>s.stage!=='inventory').every(s=>s.reused))
})
test('source, actual image bytes, declared image hash, policy and complete skill affect checkpoint reuse',async()=>{
 for(const mutation of ['source','bytes','sha','policy','skill','input']){
  const store=cache(),initial=[]
  await assert.rejects(run(store,initial,{runModel:provider(initial,{failSecond:true})}),/interrupted/)
  const fixture=workflowFixture(),options={...fixture},calls=[]
  if(mutation==='source')fixture.payload.referenceFiles[0].sha256='b'.repeat(64)
  if(mutation==='bytes')fixture.images[0].data=Buffer.from('different actual image').toString('base64')
  if(mutation==='sha')fixture.images[0].sha256='c'.repeat(64)
  if(mutation==='policy')options.policy={...policy,revision:42}
  if(mutation==='skill')options.skill='V14 changed contract'
  if(mutation==='input')fixture.payload.referenceFiles[0].pages[0].text='changed page text'
  options.runModel=async input=>{calls.push(input.stage);throw Error('stop after checking cache')}
  await assert.rejects(run(store,calls,options),/stop after checking cache/)
  assert.deepEqual(calls,['observe-1'],mutation)
 }
})
test('tampered, mismatched or unknown-version checkpoints fail closed before model calls',async()=>{
 for(const mutation of ['raw','execution','key','version','hash']){
  const store=cache(),initial=[]
  await assert.rejects(run(store,initial,{runModel:provider(initial,{failSecond:true})}),/interrupted/)
  assert.equal(store.records.size,1)
  const record=[...store.records.values()][0]
  if(mutation==='raw')record.raw={pages:[]}
  if(mutation==='execution')record.execution.sessionId='forged'
  if(mutation==='key')record.key='f'.repeat(64)
  if(mutation==='version')record.schemaVersion='future-version'
  if(mutation==='hash')record.recordHash='0'.repeat(64)
  const calls=[]
  await assert.rejects(run(store,calls),error=>error.code==='REFERENCE_CHECKPOINT_INVALID')
  assert.deepEqual(calls,[])
 }
})
test('invalid model output and failed checkpoint persistence never create completed resumable stages',async()=>{
 const store=cache(),calls=[]
 await assert.rejects(run(store,calls,{runModel:async()=>({response:{pages:[]},execution:{outcome:'completed'}})}))
 assert.equal(store.records.size,0)
 await assert.rejects(run({get:async()=>null,put:async()=>{throw Error('disk failure')}},calls),/disk failure/)
})
test('even an internally rehashed cache must pass the current stage validator again',async()=>{
 const {createReferenceStageCheckpoint}=await import('../src/layout-library/reference-stage-checkpoint.mjs')
 const store=cache(),first=[]
 await assert.rejects(run(store,first,{runModel:provider(first,{failSecond:true})}),/interrupted/)
 const [key,record]=[...store.records][0]
 store.records.set(key,createReferenceStageCheckpoint(key,{pages:[]},record.execution))
 const calls=[]
 await assert.rejects(run(store,calls))
 assert.deepEqual(calls,[])
})
test('pure keys bind workflow version, full prompt and actual bytes without persisting image payload',async()=>{
 const {referenceStageCheckpointKey,createReferenceStageCheckpoint,readReferenceStageCheckpoint}=await import('../src/layout-library/reference-stage-checkpoint.mjs')
 const input={kind:'observe-1',prompt:'contract + skill + input',input:{pages:[1]},policy,images:[{fileId:'file',sourceSha256:'a'.repeat(64),page:1,sha256:'b'.repeat(64),data:Buffer.from('private image').toString('base64')}]}
 const key=referenceStageCheckpointKey(input)
 assert.equal(key,referenceStageCheckpointKey({...input,jobId:'ignored-run-id'}))
 for(const change of [{workflowVersion:'next-version'},{prompt:'changed contract'},{images:[{...input.images[0],page:2}]},{images:[{...input.images[0],sourceSha256:'c'.repeat(64)}]}])assert.notEqual(key,referenceStageCheckpointKey({...input,...change}))
 const record=createReferenceStageCheckpoint(key,{pages:[{pageNumber:1}]},{outcome:'completed'})
 assert.doesNotMatch(JSON.stringify(record),/cHJpdmF0ZSBpbWFnZQ|private image/)
 assert.deepEqual(readReferenceStageCheckpoint(key,record),record)
 assert.throws(()=>readReferenceStageCheckpoint('0'.repeat(64),record),error=>error.code==='REFERENCE_CHECKPOINT_INVALID')
})
test('image transport fileId may change while owner-scoped source identity and bytes remain the same',async()=>{
 const {referenceStageCheckpointKey}=await import('../src/layout-library/reference-stage-checkpoint.mjs')
 const image={fileId:'old-transport',sourceSha256:'a'.repeat(64),page:5,sha256:'b'.repeat(64),data:Buffer.from('same bytes').toString('base64')}
 const input={kind:'observe-1',prompt:'same full prompt',input:{pages:[5]},policy,images:[image]}
 assert.equal(referenceStageCheckpointKey(input),referenceStageCheckpointKey({...input,images:[{...image,fileId:'new-transport'}]}))
 assert.notEqual(referenceStageCheckpointKey(input),referenceStageCheckpointKey({...input,images:[{...image,sourceSha256:'c'.repeat(64)}]}))
 const store=cache(),first=[]
 await assert.rejects(run(store,first,{runModel:provider(first,{failSecond:true})}),/interrupted/)
 const fixture=workflowFixture();fixture.payload.referenceFiles[0].id='new-transport'
 for(const image of fixture.images)image.fileId='new-transport'
 const calls=[],result=await run(store,calls,fixture)
 assert.deepEqual(calls,['observe-2','profile','compile'])
 assert.equal(result.execution.stages.find(s=>s.stage==='observe-1').reused,true)
})
test('checkpoint image identity requires a verified source hash rather than only transport identity',async()=>{
 const {referenceStageCheckpointKey}=await import('../src/layout-library/reference-stage-checkpoint.mjs')
 assert.throws(()=>referenceStageCheckpointKey({kind:'observe-1',prompt:'prompt',input:{},policy,images:[{fileId:'handle',page:1,sha256:'a'.repeat(64),data:'eA=='}]}),error=>error.code==='REFERENCE_CHECKPOINT_INVALID')
})
test('completed workflow can resume all stages with a different transport fileId and no new model calls',async()=>{
 const store=cache(),first=[];await run(store,first)
 const fixture=workflowFixture();fixture.payload.referenceFiles[0].id='different-transport'
 for(const image of fixture.images)image.fileId='different-transport'
 const calls=[],result=await run(store,calls,fixture)
 assert.deepEqual(calls,[])
 assert(result.execution.stages.filter(s=>s.stage!=='inventory').every(s=>s.reused))
})
test('declared byte length is transport metadata, actual byte hash still binds the cache',async()=>{
 const {referenceStageCheckpointKey}=await import('../src/layout-library/reference-stage-checkpoint.mjs')
 const image={fileId:'handle',sourceSha256:'a'.repeat(64),page:1,mimeType:'image/png',width:10,height:10,sha256:'b'.repeat(64),data:'eA=='}
 const input={kind:'observe-1',prompt:'same prompt',input:{pages:[1]},policy,images:[image]}
 assert.equal(referenceStageCheckpointKey(input),referenceStageCheckpointKey({...input,images:[{...image,bytes:1}]}))
})
