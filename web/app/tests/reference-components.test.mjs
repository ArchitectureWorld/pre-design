import test from 'node:test'
import assert from 'node:assert/strict'
import {validateComponentObservation,auditComponentMapping} from '../src/layout-library/reference-components.mjs'
const sha='a'.repeat(64),source={fileSha256:sha,pageNumber:15},rect={x:0,y:0,w:0.2,h:0.2}
const fixture=()=>({source:{...source},components:[{id:'card-a',kind:'group',rect},{id:'heading-a',kind:'text',purpose:'heading',parentId:'card-a',rect},{id:'photo-a',kind:'image',parentId:'card-a',rect},{id:'photo-b',kind:'image',parentId:'card-a',rect}]})
test('observed groups retain each photo independently and never grant native editability or sharing',()=>{
 const value=validateComponentObservation(fixture(),[source]);assert.equal(value.components.filter(x=>x.kind==='image').length,2)
 assert.equal(value.evidenceKind,'image');assert.equal(value.editability,'unknown');assert.equal(value.shareAllowed,false)
})
test('rejects invented pages, component identities, cyclic groups and out-of-bounds geometry',()=>{
 for(const change of [x=>x.source.pageNumber=14,x=>x.components[2].id='photo-b',x=>x.components[0].parentId='card-a',x=>x.components[2].rect={x:0.9,y:0,w:0.2,h:0.2},x=>x.components[1].text='private source copy']){
  const x=fixture();change(x);assert.throws(()=>validateComponentObservation(x,[source]),e=>e.code==='REFERENCE_COMPONENT_INVALID')
 }
})
test('mapping audits missing source components instead of silently merging two photos into one slot',()=>{
 const observation=validateComponentObservation(fixture(),[source]),slots=[{id:'heading',role:'text'},{id:'image',role:'image'}]
 const mapping=[{componentId:'heading-a',slotIds:['heading']},{componentId:'photo-a',slotIds:['image']}]
 const audit=auditComponentMapping(observation,slots,mapping)
 assert.deepEqual(audit.unmapped,['photo-b']);assert.equal(audit.complete,false);assert.equal(audit.visualAcceptance,'pending')
 assert.throws(()=>auditComponentMapping(observation,slots,[...mapping,{componentId:'photo-b',slotIds:['image']}]),e=>e.code==='REFERENCE_COMPONENT_MAPPING_INVALID')
 assert.throws(()=>auditComponentMapping(observation,slots,[{componentId:'heading-a',slotIds:['image']}]))
})
test('independent card headings cannot borrow the page title or source slots',()=>{
 const observation=validateComponentObservation(fixture(),[source])
 for(const role of ['title','source','body'])assert.throws(()=>auditComponentMapping(observation,[{id:'borrowed',role}],[{componentId:'heading-a',slotIds:['borrowed']}]),e=>e.code==='REFERENCE_COMPONENT_MAPPING_INVALID')
})
test('single-page observation trial invokes only one bounded vision stage and produces no package',async()=>{
 const {runComponentObservationTrial}=await import('../../../scripts/layout-library/component-observation-trial.mjs')
 const image={fileId:'f',page:15,data:'aW1hZ2U=',mimeType:'image/png'},file={id:'f',sha256:sha,readPages:[15]},policy={routes:{vision:{primary:{provider:'p',model:'m'},fallbacks:[]}},models:[{provider:'p',model:'m',maxOutputTokens:16000}]},calls=[]
 const result=await runComponentObservationTrial({source:{file,images:[image]},policy,runModel:async x=>{calls.push(x);return {response:fixture(),execution:{actualRoute:{provider:'p',model:'m'}}}}})
 assert.equal(calls.length,1);assert.equal(calls[0].stage,'observe-components');assert.equal(calls[0].policy.models[0].maxOutputTokens,8192);assert.equal(calls[0].modelRole,'vision')
 assert.equal(result.response,null);assert.equal(result.analysis.componentObservation.components.length,4)
 await assert.rejects(runComponentObservationTrial({source:{file,images:[image,image]},policy,runModel:async()=>{throw Error('must not call')}}),/COMPONENT_TRIAL_SCOPE_INVALID/)
})
test('component observation rejects invalid source and excessive fallback before invoking models',async()=>{
 const {runComponentObservationTrial}=await import('../../../scripts/layout-library/component-observation-trial.mjs')
 let calls=0;const runModel=async()=>{calls++;return {response:{}}},source={file:{id:'f',sha256:'private text',readPages:[15]},images:[{fileId:'f',page:15}]},policy={routes:{vision:{primary:{provider:'p',model:'m'},fallbacks:[]}},models:[{provider:'p',model:'m'}]}
 await assert.rejects(runComponentObservationTrial({source,policy,runModel}),/COMPONENT_TRIAL_SCOPE_INVALID/);assert.equal(calls,0)
 source.file.sha256=sha;policy.routes.vision.fallbacks=[{},{}]
 await assert.rejects(runComponentObservationTrial({source,policy,runModel}),/COMPONENT_TRIAL_SCOPE_INVALID/);assert.equal(calls,0)
})
test('slot proposal keeps observed geometry and independent bindings without inventing style or asset rights',async()=>{
 const {proposeComponentSlots}=await import('../src/layout-library/reference-components.mjs')
 const proposal=proposeComponentSlots(fixture(),[source],{width:1600,height:900})
 assert.equal(proposal.slots.length,3);assert.equal(proposal.slots[0].role,'text');assert.equal(proposal.slots[0].binding,'heading-a');assert.deepEqual(proposal.slots[0].observedRect,rect)
 assert.deepEqual(proposal.slots[0].proposedRect,{x:0,y:0,w:320,h:180});assert.equal(proposal.slots[0].styleStatus,'unknown')
 assert.deepEqual(proposal.slots.filter(s=>s.role==='image').map(s=>s.index),[0,1]);assert.equal(proposal.groups.length,1);assert.equal(proposal.visualAcceptance,'pending');assert.equal(proposal.shareAllowed,false)
 assert(!JSON.stringify(proposal).includes('fontFamily'));assert(!JSON.stringify(proposal).includes('dataUrl'))
})
