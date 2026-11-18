import test from 'node:test';import assert from 'node:assert/strict'
import {prepareComponentSelection,selectComponentReferences} from '../src/layout-library/component-reference-selection.mjs'
import {workflowFixture} from './fixtures/reference-workflow.mjs'
test('explicit selected pages retain real indices and discard unselected text/native structure',()=>{
 const f=workflowFixture(10),file=f.payload.referenceFiles[0];file.structure={slides:[{page:1,text:'PRIVATE UNSELECTED'}]}
 const selection=prepareComponentSelection([file],[5,2]),before=JSON.stringify(file),r=selectComponentReferences([file],f.images,selection)
 assert.deepEqual(r.images.map(x=>x.page),[2,5]);assert.deepEqual(r.files[0].readPages,[2,5]);assert.equal(r.files[0].text,'');assert.equal(r.files[0].structure,undefined)
 assert.deepEqual(r.files[0].pages.map(p=>p.page),[2,5]);assert.equal(JSON.stringify(file),before)
})
test('excess/unknown/duplicate/out-of-range selections and cross-file images fail closed',()=>{
 const f=workflowFixture(10),files=f.payload.referenceFiles
 for(const pages of [undefined,[0],[12],[1,1],[1,2,3,4,5,6,7]])assert.throws(()=>prepareComponentSelection(files,pages))
 const s=prepareComponentSelection(files,[2]);assert.throws(()=>selectComponentReferences(files,f.images,{...s,fileId:'other'}))
 assert.throws(()=>selectComponentReferences(files,f.images.filter(x=>x.page!==2),s))
})
