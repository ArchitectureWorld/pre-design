import test from 'node:test'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import Pptx from 'pptxgenjs'
import {extractPptxReference} from '../src/layout-library/reference-pptx.mjs'
test('successful import retains upstream receipt across preview conversion (controlled office boundary)',async()=>{
 const p=new Pptx();p.addSlide().addText('Synthetic design',{x:1,y:1,w:3,h:1})
 const old=process.env.PRE_LAYOUT_OFFICE_BINARY
 process.env.PRE_LAYOUT_OFFICE_BINARY=fileURLToPath(new URL('./fixtures/office-preview-double.py',import.meta.url))
 try{
  const parsed=await extractPptxReference(await p.write({outputType:'nodebuffer'}))
  assert.equal(parsed.structure.pptMaster.revision,'3af3e8ef774c4d67ee57e1306d9256d08c9ee1bf')
  assert.equal(parsed.structure.pptMaster.slides.length,1)
  assert.equal(parsed.images.length,1)
  assert(parsed.privateArtifacts.some(a=>a.path.startsWith('svg/')&&a.data.length))
  assert(parsed.privateArtifacts.every(a=>!a.path.startsWith('sources/')))
  assert(parsed.structure.pptMaster.artifactInventory.files.some(f=>/^svg\/slide_.*\.svg$/.test(f.path)))
 }finally{if(old===undefined)delete process.env.PRE_LAYOUT_OFFICE_BINARY;else process.env.PRE_LAYOUT_OFFICE_BINARY=old}
})
