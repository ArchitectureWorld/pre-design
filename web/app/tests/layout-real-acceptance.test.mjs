import test from 'node:test'
import assert from 'node:assert/strict'
import {acceptanceSummary,referenceInput} from '../../../scripts/layout-library/real-acceptance.mjs'
test('acceptance counts failures and never turns a small perfect sample into 95% reliability',()=>{
 const a=acceptanceSummary([{passed:true},{passed:true}]);assert.equal(a.successRate,1);assert.equal(a.attempts,2);assert(a.wilson95.lower<.5);assert.equal(a.populationReliabilityEstablished,false)
 const b=acceptanceSummary([{passed:true},{passed:false}]);assert.equal(b.successRate,.5);assert.equal(acceptanceSummary([]).successRate,null)
})
test('reference preparation preserves actual bytes and makes only private artifact handles',()=>{
 const bytes=Buffer.from('reference'),image=Buffer.from('image'),artifact=Buffer.from('svg'),sha='a'.repeat(64)
 const parsed={kind:'pptx',images:[{page:1,data:image,mimeType:'image/png'}],privateArtifacts:[{path:'svg-flat/slide_01.svg',sha256:sha,bytes:3,data:artifact}]}
 const x=referenceInput({filename:'sample.pptx',bytes,parsed});assert.equal(x.images[0].fileId,x.file.id);assert.equal(x.images[0].data,image.toString('base64'));assert.equal(x.file.privateArtifacts[0].data,undefined);assert.deepEqual(x.artifacts.get('svg-flat/slide_01.svg').data,artifact);assert.equal(parsed.images[0].data,image)
})
