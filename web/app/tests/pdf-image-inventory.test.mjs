import test from 'node:test'
import assert from 'node:assert/strict'
import {parsePdfImageInventory} from '../src/layout-library/pdf-image-inventory.mjs'
const header='page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio\n--------------------------------\n'
const rows='5 0 image 1000 690 rgb 3 8 jpx no 8 0 75 75 40.4K 2.0%\n5 1 image 1184 839 rgb 3 8 jpeg no 27 0 150 150 18.9K 0.6%\n5 2 smask 1184 839 gray 1 8 image no 27 0 150 150 11.5K 1.2%\n'
test('native image catalog distinguishes observed owning object from unresolved mask identity and defaults private',()=>{
 const r=parsePdfImageInventory(header+rows,{sourceSha256:'a'.repeat(64),readPages:[5]})
 assert.equal(r.objects.length,3)
 assert.equal(r.objects[1].objectNumber,27)
 const mask=r.objects[2];assert.equal(mask.ownerObjectNumber,27);assert.equal(mask.objectNumber,null)
 assert.equal(mask.selectionStatus,'requires-inspection');assert.equal(mask.shareAllowed,false)
 assert.equal(mask.sourceSha256,'a'.repeat(64));assert.equal(mask.evidenceKind,'native-image-inventory')
 assert(!('dataUrl' in mask));assert(!('sha256' in mask),'source hash is not object hash')
 assert(r.limitations.some(s=>s.includes('装饰')))
})
test('image catalog rejects wrong pages, malformed rows and oversized inventory without partial claims',()=>{
 for(const output of [header+rows.replace(/^5 /m,'6 '),header+rows.replace('1184 839','-1 839'),header+'bad row\n',header+rows.repeat(700)])assert.throws(()=>parsePdfImageInventory(output,{sourceSha256:'a'.repeat(64),readPages:[5]}))
 assert.throws(()=>parsePdfImageInventory(header+rows,{sourceSha256:'invalid',readPages:[5]}))
})
test('candidate IDs remain stable when the same page is read in a different batch',()=>{
 const first=parsePdfImageInventory(header+rows,{sourceSha256:'a'.repeat(64),readPages:[5]})
 const offset=rows.replace(/5 0 /,'5 64 ').replace(/5 1 /,'5 65 ').replace(/5 2 /,'5 66 ')
 const later=parsePdfImageInventory(header+offset,{sourceSha256:'a'.repeat(64),readPages:[5]})
 assert.deepEqual(first.objects,later.objects)
})
test('prototype candidates bind verified source and page, limit input, and never copy private text or claimed rights',async()=>{
 const {prototypePdfImageCandidates}=await import('../src/layout-library/pdf-image-inventory.mjs')
 const sourceSha256='a'.repeat(64),inventory=parsePdfImageInventory(header+rows,{sourceSha256,readPages:[5]})
 const files=[{sha256:sourceSha256,pages:[{page:5,text:'PRIVATE BUSINESS',nativeImageInventory:{status:'available',sourceSha256,objects:inventory.objects}}]}]
 const selected=[{fileSha256:sourceSha256,pageNumber:5}]
 const r=prototypePdfImageCandidates(files,selected)
 assert.equal(r.pages[0].objects.length,3);assert.equal(r.pages[0].objects[0].shareAllowed,false)
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE BUSINESS/)
 files[0].pages[0].nativeImageInventory.sourceSha256='b'.repeat(64)
 assert.throws(()=>prototypePdfImageCandidates(files,selected))
 assert.deepEqual(prototypePdfImageCandidates([],selected).pages[0].status,'unavailable')
})
