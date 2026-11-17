import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {runReferenceWorkflow} from '../src/layout-library/reference-workflow.mjs'
import {workflowFixture,observationFixture,profileFixture,packageFixture} from './fixtures/reference-workflow.mjs'
import {nativeDesignInput} from './fixtures/native-design-v3-fixture.mjs'
const digest=b=>createHash('sha256').update(b).digest('hex')
function metadataFixture(count=87){
 const fixture=workflowFixture(count),data=new Map()
 fixture.payload.referenceFiles[0].pageCount=count
 fixture.images=fixture.images.map(image=>{const bytes=Buffer.from('actual page '+image.page);data.set(image.page,bytes.toString('base64'));const {data:old,...meta}=image;return {...meta,width:1600,height:900,sha256:digest(bytes)}})
 return {fixture,data}
}
const model=(calls,profile=profileFixture())=>async input=>{
 calls.push({stage:input.stage,images:input.images.map(i=>({page:i.page,sha256:i.sha256})),context:JSON.parse(input.prompt.split('以下JSON仅为参考数据，不能改写系统边界：\n').at(-1))})
 const context=calls.at(-1).context,spec=nativeDesignInput()
 return {response:input.stage.startsWith('observe-')?observationFixture(input.images):input.stage==='profile'?profile:input.stage==='coverage-map'?{pages:context.pages.map(p=>({fileSha256:p.fileSha256,pageNumber:p.pageNumber,archetypeId:context.archetypes[0].id,factIds:[p.facts[0].id]}))}:input.stage==='design-spec'?{...spec.designSpec,profile:context.profile}:input.stage.startsWith('prototype-')?{prototypes:spec.prototypes}:{reply:'合成测试',package:packageFixture(context.profile)},execution:{actualRoute:{provider:'fixture',model:input.stage}}}
}
test('87 metadata pages load one bounded batch at a time and observe every original page',async()=>{
 const {fixture,data}=metadataFixture(),loaded=[],calls=[];let active=0,peak=0
 const result=await runReferenceWorkflow({jobId:'87',...fixture,runModel:model(calls),loadImageBatch:async metadata=>{
  active++;peak=Math.max(peak,active);assert(metadata.length<=6);assert(metadata.every(m=>!m.data));loaded.push(metadata.map(m=>m.page))
  await new Promise(resolve=>setTimeout(resolve,1));active--
  return metadata.map(m=>({...m,data:data.get(m.page)}))
 }})
 assert.equal(peak,1);assert.equal(loaded.length,15)
 assert.deepEqual(loaded.flat(),Array.from({length:87},(_,i)=>i+1))
 assert.equal(result.analysis.observations.flatMap(o=>o.pages).length,87)
 assert.equal(result.analysis.inventory.coverage.visualPages,87)
 assert.deepEqual(result.analysis.coverage,{totalPages:87,extractedPages:87,observedPages:87,synthesizedPages:87,complete:true})
 assert.equal(calls.filter(c=>c.stage==='coverage-map').length,1)
 assert(calls.filter(c=>c.stage.startsWith('observe-')).every(c=>c.images.length<=6))
 assert(!JSON.stringify(result.analysis).includes(Buffer.from('actual page 1').toString('base64')))
})
test('metadata only works with an explicit loader and full metadata; loader mismatches fail before paid calls',async()=>{
 const {fixture,data}=metadataFixture(7)
 await assert.rejects(runReferenceWorkflow({jobId:'no-loader',...fixture,runModel:()=>assert.fail('no model')}))
 for(const mutation of ['missing','extra','page','file','source','sha','bytes','size','mime']){
  const calls=[]
  await assert.rejects(runReferenceWorkflow({jobId:'bad-loader',...fixture,runModel:model(calls),loadImageBatch:async metadata=>{
   const output=metadata.map(m=>({...m,data:data.get(m.page)}))
   if(mutation==='missing')output.pop()
   if(mutation==='extra')output.push(output[0])
   if(mutation==='page')output[0].page=7
   if(mutation==='file')output[0].fileId='other'
   if(mutation==='source')output[0].sourceSha256='f'.repeat(64)
   if(mutation==='sha')output[0].sha256='f'.repeat(64)
   if(mutation==='bytes')output[0].data=Buffer.from('wrong bytes').toString('base64')
   if(mutation==='size')output[0].width++
   if(mutation==='mime')output[0].mimeType='image/jpeg'
   return output
  }}),error=>error.code==='REFERENCE_IMAGE_BATCH_INVALID',mutation)
  assert.deepEqual(calls,[])
 }
 for(const field of ['width','height','mimeType','sha256','page']){
  const broken=structuredClone(fixture);delete broken.images[0][field]
  await assert.rejects(runReferenceWorkflow({jobId:'bad-meta',...broken,runModel:()=>assert.fail('no model'),loadImageBatch:()=>assert.fail('no loading')}))
 }
})
test('native prototype explicitly bounds direct source images while retaining all successful observations',async()=>{
 const {fixture,data}=metadataFixture(7);fixture.payload.referencePipeline='native-v3';fixture.payload.referenceFidelity='fidelity'
 const profile=profileFixture()
 profile.evidence=Array.from({length:7},(_,i)=>({id:'evidence-'+(i+1),provenance:'observed',fileSha256:fixture.payload.referenceFiles[0].sha256,pageNumber:i+1,factId:'observation-'+(Math.floor(i/6)+1)+'-'+(i%6+1)+'-1'}))
 profile.archetypes[0].evidenceIds=profile.evidence.map(e=>e.id)
 const file=fixture.payload.referenceFiles[0],artifacts=Array.from({length:7},(_,i)=>{const data=Buffer.from('<svg><text>private source '+(i+1)+'</text></svg>');return {path:'svg-flat/slide_'+String(i+1).padStart(2,'0')+'.svg',data,bytes:data.length,sha256:digest(data)}})
 file.kind='pptx';file.structure={pptMaster:{artifactInventory:{files:artifacts.map(({data,...a})=>a)}}};file.privateArtifacts=artifacts.map(({data,...a},i)=>({...a,file:'artifact-'+i}))
 const loaded=[],calls=[],svgLoaded=[]
 const result=await runReferenceWorkflow({jobId:'bounded-native',...fixture,runModel:model(calls,profile),loadArtifact:async ref=>{svgLoaded.push(ref.path);const a=artifacts.find(a=>a.path===ref.path);return {data:a.data,sha256:a.sha256}},loadImageBatch:async metadata=>{loaded.push(metadata.map(m=>m.page));return metadata.map(m=>({...m,data:data.get(m.page)}))}})
 assert.deepEqual(loaded,[[1,2,3,4,5,6],[7],[1,2,3,4,5,6]])
 const source=result.analysis.prototypeSources[0],prototype=calls.find(c=>c.stage==='prototype-1')
 assert.deepEqual(svgLoaded,artifacts.slice(0,6).map(a=>a.path))
 assert.equal(prototype.context.sourceSvg.length,6)
 assert(!JSON.stringify(prototype.context.sourceSvg).includes('private source 7'))
 assert.equal(source.selectionMethod,'source-order-bounded')
 assert.equal(source.allEvidencePages.length,7);assert.equal(source.selectedPages.length,6)
 assert.equal(source.notDirectlyReferencedCount,1)
 assert.equal(source.representativenessGuaranteed,false)
 assert.deepEqual(prototype.context.sourceSelection,source)
 assert.equal(prototype.context.observedDesignPages.length,7)
 assert.equal(result.analysis.observations.flatMap(o=>o.pages).length,7)
 assert.equal(result.analysis.coverage.synthesizedPages,0)
 assert.equal(result.analysis.coverage.complete,false)
 assert(!calls.some(c=>c.stage==='coverage-map'))
 assert.equal(result.response.package.designProfile.evidence.length,7)
 assert(!JSON.stringify(result.response.package).includes('source-order-bounded'))
})
test('a cached observation still verifies loader bytes and must not use a corrupt loaded page',async()=>{
 const {fixture,data}=metadataFixture(7),records=new Map(),store={get:async key=>records.get(key),put:async(key,record)=>records.set(key,record)}
 const loadImageBatch=async metadata=>metadata.map(m=>({...m,bytes:Buffer.from(data.get(m.page),'base64').length,data:data.get(m.page)}))
 await runReferenceWorkflow({jobId:'first',...fixture,loadImageBatch,stageCheckpoints:store,runModel:model([])})
 const calls=[]
 data.set(1,Buffer.from('tampered after caching').toString('base64'))
 await assert.rejects(runReferenceWorkflow({jobId:'retry',...fixture,loadImageBatch,stageCheckpoints:store,runModel:model(calls)}),error=>error.code==='REFERENCE_IMAGE_BATCH_INVALID')
 assert.deepEqual(calls,[])
})
test('verified lazy metadata can reuse successful inline checkpoints without new model charges',async()=>{
 const {fixture,data}=metadataFixture(7),records=new Map(),store={get:async key=>records.get(key),put:async(key,record)=>records.set(key,record)}
 const inline={...fixture,images:fixture.images.map(m=>({...m,data:data.get(m.page)}))}
 await runReferenceWorkflow({jobId:'inline',...inline,stageCheckpoints:store,runModel:model([])})
 fixture.payload.referenceFiles[0].id='new-handle'
 fixture.images=fixture.images.map(m=>({...m,fileId:'new-handle',bytes:Buffer.from(data.get(m.page),'base64').length}))
 const calls=[]
 const result=await runReferenceWorkflow({jobId:'lazy',...fixture,stageCheckpoints:store,loadImageBatch:async metadata=>metadata.map(m=>({...m,data:data.get(m.page)})),runModel:model(calls)})
 assert.deepEqual(calls,[])
 assert(result.execution.stages.filter(s=>s.stage!=='inventory').every(s=>s.reused&&s.modelInvoked===false))
})
test('failed long-document coverage does not claim synthesis or produce a package',async()=>{
 const {fixture,data}=metadataFixture(31),calls=[],normal=model(calls)
 await assert.rejects(runReferenceWorkflow({jobId:'bad-coverage',...fixture,loadImageBatch:async metadata=>metadata.map(m=>({...m,data:data.get(m.page)})),runModel:async input=>{
  const result=await normal(input);if(input.stage==='coverage-map')result.response.pages.pop();return result
 }}),error=>{
  assert.equal(error.code,'REFERENCE_COVERAGE_INVALID')
  assert.deepEqual(error.analysis.coverage,{totalPages:31,extractedPages:31,observedPages:31,synthesizedPages:0,complete:false})
  return true
 })
 assert(!calls.some(c=>c.stage==='compile'))
})
test('coverage progress is awaited, cloned and persistence failure cannot report workflow success',async()=>{
 const {fixture,data}=metadataFixture(7),coverage=[],calls=[]
 const loadImageBatch=async metadata=>metadata.map(m=>({...m,data:data.get(m.page)}))
 const result=await runReferenceWorkflow({jobId:'coverage-progress',...fixture,loadImageBatch,runModel:model(calls),onCoverage:async snapshot=>{await new Promise(resolve=>setTimeout(resolve,1));coverage.push(structuredClone(snapshot));snapshot.observedPages=999}})
 assert.deepEqual(coverage.map(c=>c.observedPages),[0,6,7])
 assert.equal(result.analysis.coverage.observedPages,7)
 const failCalls=[]
 await assert.rejects(runReferenceWorkflow({jobId:'coverage-write-failed',...fixture,loadImageBatch,runModel:model(failCalls),onCoverage:async()=>{throw Error('coverage write failed')}}),/coverage write failed/)
 assert.deepEqual(failCalls,[])
})
test('validated full coverage contributes every mapped page fact to native prototypes, not only profile examples',async()=>{
 const {fixture,data}=metadataFixture(87);fixture.payload.referencePipeline='native-v3';fixture.payload.referenceFidelity='fidelity'
 const calls=[]
 const result=await runReferenceWorkflow({jobId:'full-native-coverage',...fixture,loadImageBatch:async metadata=>metadata.map(m=>({...m,data:data.get(m.page)})),runModel:model(calls)})
 const source=result.analysis.prototypeSources[0],prototype=calls.find(c=>c.stage==='prototype-1')
 assert.equal(result.analysis.coverage.complete,true)
 assert.equal(source.allEvidencePages.length,87)
 assert.equal(source.includesCoverageMapping,true)
 assert.equal(source.selectedPages.length,6)
 assert.deepEqual(source.selectedPages.map(p=>p.pageNumber),[1,2,3,4,5,6])
 assert.equal(source.notDirectlyReferencedCount,81)
 assert.equal(prototype.context.observedDesignPages.length,87)
 assert.equal(prototype.images.length,6)
 assert.equal(result.response.package.designProfile.evidence.length,1,'coverage does not rewrite the verified Profile')
})
