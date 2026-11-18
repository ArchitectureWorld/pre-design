import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
const bytes=Buffer.from('%PDF-test'),sha=createHash('sha256').update(bytes).digest('hex')
const payload=()=>({referencePipeline:'native-v3',referenceComponentVersion:3,referenceImagePlacementVersion:1,referenceComponentSelection:{fileId:'owned',pages:[5,15]},referenceFiles:[{id:'owned',kind:'pdf',sha256:sha,pageCount:87,readPages:[5,15],pages:[{page:5},{page:15}]}]})
async function run(args){const m=await import('../src/layout-library/pdf-placement-enrichment.mjs');return m.enrichPdfPlacementEvidence(args)}
test('placement enrichment is absent for old tasks, version rejected before owner IO',async()=>{
 let calls=0;const uploads={download:async()=>{calls++}}
 const p=payload();delete p.referenceImagePlacementVersion
 assert.equal(await run({payload:p,actor:{id:'owner'},uploads}),p)
 for(const version of [0,2])await assert.rejects(run({payload:{...p,referenceImagePlacementVersion:version},actor:{id:'owner'},uploads}),e=>e.code==='REFERENCE_IMAGE_PLACEMENT_VERSION_INVALID')
 assert.equal(calls,0)
})
test('only verified selected source is parsed, private evidence remains outside model files',async()=>{
 const p=payload(),before=JSON.stringify(p);let args
 const result=await run({payload:p,actor:{id:'owner'},uploads:{download:async(actor,id)=>{assert.equal(actor.id,'owner');assert.equal(id,'owned');return {data:bytes}}},extract:async input=>{args=input;return {schemaVersion:'test',sourceSha256:sha,pages:[{page:5},{page:15}],shareAllowed:false}}})
 assert.deepEqual(args.selectedPages,[5,15]);assert.equal(args.sourceSha256,sha);assert.equal(JSON.stringify(p),before)
 assert.deepEqual(result.referenceFiles,p.referenceFiles);assert.equal(result.referenceImagePlacementEvidence.status,'available');assert.equal(result.referenceImagePlacementEvidence.shareAllowed,false)
})
test('source tampering and ownership errors fail closed, parser failure explicitly unavailable',async()=>{
 let parsed=0;const extract=async()=>{parsed++;throw Object.assign(Error('private source contents'),{code:'SENSITIVE_ARBITRARY'})}
 await assert.rejects(run({payload:payload(),actor:{id:'x'},uploads:{download:async()=>{throw Object.assign(Error('not owner'),{statusCode:404})}},extract}),e=>e.statusCode===404)
 await assert.rejects(run({payload:payload(),actor:{id:'x'},uploads:{download:async()=>({data:Buffer.from('wrong')})},extract}),e=>e.code==='REFERENCE_IMAGE_PLACEMENT_SOURCE_INVALID')
 assert.equal(parsed,0)
 const result=await run({payload:payload(),actor:{id:'x'},uploads:{download:async()=>({data:bytes})},extract})
 assert.equal(result.referenceImagePlacementEvidence.status,'unavailable');assert(!JSON.stringify(result).includes('SENSITIVE_ARBITRARY'));assert(!JSON.stringify(result).includes('private source contents'))
})
test('cancel propagates and selected pages cannot exceed the authorized selected file pages',async()=>{
 const controller=new AbortController();controller.abort();let calls=0
 await assert.rejects(run({payload:payload(),actor:{id:'x'},signal:controller.signal,uploads:{download:async()=>{calls++}}}),e=>e.name==='AbortError');assert.equal(calls,0)
 const p=payload();p.referenceComponentSelection.pages=[5,13,15]
 await assert.rejects(run({payload:p,actor:{id:'x'},uploads:{download:async()=>{calls++}}}),e=>e.code==='REFERENCE_IMAGE_PLACEMENT_SOURCE_INVALID');assert.equal(calls,0)
})
test('image input without PDF page metadata remains supported without raw download',async()=>{
 const p=payload();p.referenceFiles[0]={id:'owned',kind:'image',sha256:sha,imageCount:1};p.referenceComponentSelection.pages=[1]
 const result=await run({payload:p,actor:{id:'x'},uploads:{download:async()=>{throw Error('must not download')}}})
 assert.equal(result.referenceImagePlacementEvidence.reason,'not-pdf')
})
test('busy enrichment never queues raw downloads, releases after parser failure',async()=>{
 let unblock,downloads=0;const pending=new Promise(resolve=>{unblock=resolve}),uploads={download:async()=>{downloads++;return {data:bytes}}}
 const first=run({payload:payload(),actor:{id:'a'},uploads,extract:async()=>{await pending;throw Error('failed')}})
 await new Promise(r=>setTimeout(r,20));const busy=await run({payload:payload(),actor:{id:'b'},uploads})
 assert.equal(busy.referenceImagePlacementEvidence.reason,'busy');assert.equal(downloads,1)
 unblock();await first
 const next=await run({payload:payload(),actor:{id:'b'},uploads,extract:async()=>{throw Error('failed')}})
 assert.equal(next.referenceImagePlacementEvidence.reason,'unsupported-or-unreadable');assert.equal(downloads,2)
})
test('copy denial remains unavailable with a bounded reason and no native evidence',async()=>{
 const result=await run({payload:payload(),actor:{id:'x'},uploads:{download:async()=>({data:bytes})},extract:async()=>{throw Object.assign(Error('blocked'),{code:'PDF_PLACEMENTS_COPY_RESTRICTED'})}})
 assert.equal(result.referenceImagePlacementEvidence.status,'unavailable');assert.equal(result.referenceImagePlacementEvidence.reason,'copy-restricted');assert.equal(result.referenceImagePlacementEvidence.evidence,undefined)
})
