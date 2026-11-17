import test from 'node:test'
import assert from 'node:assert/strict'
import {buildReferenceBundle} from '../src/layout-library/reference-bundle.mjs'
const sha='a'.repeat(64)
const file=(kind='pptx')=>({id:'source-1',name:'private.pptx',kind,sha256:sha,pageCount:3,readPages:[1],pages:[{page:1,text:'private text'}],structure:{pptMaster:{revision:'r1',masters:[{id:'m1'}],layouts:[{id:'l1',masterId:'m1'}],slides:[{id:'s1',layoutId:'l1'}],nativeStructure:{private:'native text'},inheritance:{s1:['m1','l1']},artifactInventory:{files:[{path:'svg/slide_1.svg',sha256:sha,bytes:42}]},receiptHash:sha}}})
test('private bundle retains native graph and provenance without claiming inventory is available SVG',()=>{
 const input=file(),bundle=buildReferenceBundle({files:[input],sourceRecords:[{id:'source-1',pages:[{pageNumber:1,hasImage:true}]}]})
 assert.equal(bundle.schemaVersion,'pre-design.reference-bundle.v1')
 assert.equal(bundle.sources[0].sourceId,'source-1')
 assert.deepEqual(bundle.sources[0].coverage,{totalPages:3,extractedPages:[1],visualPages:[1],unreadPages:[2,3]})
 assert.deepEqual(bundle.sources[0].native.masterLayoutGraph,{masters:[{id:'m1'}],layouts:[{id:'l1',masterId:'m1'}],slides:[{id:'s1',layoutId:'l1'}],inheritance:{s1:['m1','l1']}})
 assert.equal(bundle.sources[0].native.nativeStructure.private,'native text')
 assert.equal(bundle.sources[0].native.artifacts[0].availability,'inventory-only')
 input.structure.pptMaster.masters[0].id='mutated'
 assert.equal(bundle.sources[0].native.masterLayoutGraph.masters[0].id,'m1')
})
test('mixed formats keep independent source identity and unknown DOCX coverage is not full coverage',()=>{
 const pdf={...file('pdf'),id:'source-2',structure:undefined},docx={id:'doc',name:'x.docx',kind:'docx',sha256:sha,text:'private'}
 const bundle=buildReferenceBundle({files:[file(),pdf,docx]})
 assert.equal(bundle.sources.length,3)
 assert.equal(bundle.sources[2].coverage.totalPages,null)
 assert.equal(bundle.sources[2].coverage.unreadPages,null)
 assert.equal(bundle.sources[1].native,null)
 assert.equal(bundle.visibility,'private')
})
test('bundle rejects duplicate ids, forged hashes, out-of-range and duplicate pages',()=>{
 for(const files of [[file(),file()],[{...file(),sha256:'bad'}],[{...file(),readPages:[4]}],[{...file(),readPages:[1,1]}]])assert.throws(()=>buildReferenceBundle({files}),e=>e.code==='REFERENCE_BUNDLE_INVALID')
})
test('artifact inventory rejects traversal, malformed size/hash, and source mismatch',()=>{
 for(const change of [p=>p.artifactInventory.files[0].path='../secret',p=>p.artifactInventory.files[0].sha256='bad',p=>p.artifactInventory.files[0].bytes=-1,p=>p.source={sha256:'b'.repeat(64)}]){
  const input=file();change(input.structure.pptMaster)
  assert.throws(()=>buildReferenceBundle({files:[input]}),e=>e.code==='REFERENCE_BUNDLE_INVALID')
 }
})
test('declared readPages alone cannot claim visual observation',()=>{
 const input=file();input.hasImages=false
 assert.deepEqual(buildReferenceBundle({files:[input]}).sources[0].coverage.visualPages,[])
})
test('bundle links matching persisted artifacts, not raw bytes or filesystem storage names',()=>{
 const input=file();input.privateArtifacts=[{path:'svg/slide_1.svg',sha256:sha,bytes:42,file:'artifact-1'}]
 const bundle=buildReferenceBundle({files:[input]})
 const a=bundle.sources[0].native.artifacts[0]
 assert.equal(a.availability,'private-upload')
 assert.deepEqual(a.reference,{sourceId:'source-1',path:'svg/slide_1.svg',sha256:sha})
 assert.equal(a.file,undefined)
 input.privateArtifacts[0].sha256='b'.repeat(64)
 assert.throws(()=>buildReferenceBundle({files:[input]}),e=>e.code==='REFERENCE_BUNDLE_INVALID')
})
test('image coverage adopts page count already verified by inventory when upload omits it',()=>{
 const input={id:'image-1',sha256:sha,kind:'image',name:'image.png'}
 const bundle=buildReferenceBundle({files:[input],sourceRecords:[{id:'image-1',sha256:sha,pageCount:1,pages:[{pageNumber:1,hasImage:true}]}]})
 assert.equal(bundle.sources[0].coverage.totalPages,1)
 assert.deepEqual(bundle.sources[0].coverage.unreadPages,[])
})
