import test from 'node:test'
import assert from 'node:assert/strict'
import {referencePagesForLayout,assertReferenceReviewed} from '../src/layout-library/reference-review.mjs'
const sha='a'.repeat(64)
const pkg={schemaVersion:'pre-design.layout-package.v2',layouts:[{id:'map',archetypeId:'map'}],designProfile:{designSystem:{evidenceIds:['brand']},archetypes:[{id:'map',evidenceIds:['summary']}],evidence:[{id:'brand',fileSha256:sha,pageNumber:1,provenance:'observed'},{id:'detail',fileSha256:sha,pageNumber:12,provenance:'observed'},{id:'summary',provenance:'inferred',dependsOn:['detail']}]}}
test('对照定位追溯具体页面原型的推断证据，不拿封面代替所有页面',()=>{
 assert.deepEqual(referencePagesForLayout(pkg,'map'),[{fileSha256:sha,pageNumber:12}])
 assert.throws(()=>referencePagesForLayout(pkg,'missing'),/版式/)
})
test('V2没有当前资源哈希的人工对照确认时禁止发布或绑定，V1兼容',()=>{
 assert.doesNotThrow(()=>assertReferenceReviewed({package:{schemaVersion:'pre-design.layout-package.v1'}}))
 assert.throws(()=>assertReferenceReviewed({package:pkg,hash:sha,validation:null}),/对照/)
 assert.throws(()=>assertReferenceReviewed({package:pkg,hash:sha,validation:{status:'passed'},referenceReview:{status:'confirmed',packageHash:'b'.repeat(64)}}),/对照/)
})

import {libraryFixture} from './layout-library/fixture.mjs'
import {compositionPackage} from './fixtures/composition.mjs'
import {FIXTURES_VERSION} from '../src/layout-library/validation.mjs'
import {RENDERER_V2,packageDigest} from '../src/layout-library/contract.mjs'
import {randomUUID} from 'node:crypto'

test('服务端对照收执绑定拥有者、全部页面类型、内容哈希和检查版本，修改后失效',async t=>{
 const f=await libraryFixture();t.after(f.close)
 const p=compositionPackage(),actor={id:'owner',role:'user'},created=await f.library.create(actor,{requestId:randomUUID(),package:p}),path='/api/layout-library/'+created.id+'/1'
 // Synthetic validation receipt only tests the review state machine. Actual
 // geometry is exercised separately by Chromium tests, never claimed here.
 const qa={status:'passed',packageHash:created.hash,renderer:RENDERER_V2,fixturesVersion:FIXTURES_VERSION,overflowGuard:true,testedAt:'fixture-1'}
 await f.library.saveValidation(actor,created.id,1,qa)
 const ref={resourceId:created.id,version:1}
 await assert.rejects(f.library.freezeRef(actor,ref),/对照/)
 assert((await f.library.previewRef(actor,ref)).package,'未确认前仍然允许实际项目预览')
 const comparison=await f.request('POST',path+'/compare',{layoutId:'mixed'})
 assert.equal(comparison.statusCode,200,comparison.body)
 assert.equal(comparison.json().source,null)
 assert.match(comparison.json().html,/合成/)
 assert.equal((await f.request('POST',path+'/compare',{layoutId:'mixed'},'other')).statusCode,404)
 const body={requestId:randomUUID(),packageHash:created.hash,comparisonIds:[comparison.json().receipt.id],reviewed:true}
 assert.equal((await f.request('POST',path+'/reference-review',{...body,comparisonIds:[randomUUID()]})).statusCode,409)
 assert.equal((await f.request('POST',path+'/reference-review',body)).statusCode,200)
 assert.equal((await f.library.freezeRef(actor,ref)).hash,created.hash)
 assert.equal((await f.request('GET',path)).json().referenceReview.status,'confirmed')
 await f.library.saveValidation(actor,created.id,1,{...qa,testedAt:'fixture-2'})
 assert.equal((await f.request('GET',path)).json().referenceReview.status,'stale')
 await assert.rejects(f.library.freezeRef(actor,ref),/对照/)
 assert.equal((await f.request('POST',path+'/reference-review',{...body,requestId:randomUUID()})).statusCode,409)
 const revised=await f.library.revise(actor,{id:created.id,expectedVersion:1,requestId:randomUUID(),package:{...p,description:'修订后的说明'}})
 assert.equal(revised.version,2)
 const newResource=await f.library.get(actor,created.id,2)
 assert.equal(newResource.referenceReview,null)
 await assert.rejects(f.library.freezeRef(actor,{resourceId:created.id,version:2}),/对照/)
})

test('当前检查与确认即使相互匹配，也不能复用旧渲染器或旧检查样例的通过记录',()=>{
 const p=compositionPackage(),hash=packageDigest(p)
 const base={status:'passed',packageHash:hash,renderer:RENDERER_V2,fixturesVersion:FIXTURES_VERSION,overflowGuard:true}
 const resource=validation=>({package:p,hash,validation,referenceReview:{status:'confirmed',packageHash:hash,validationHash:packageDigest(validation),renderer:validation.renderer,layoutIds:['mixed']}})
 assert.doesNotThrow(()=>assertReferenceReviewed(resource(base)))
 assert.throws(()=>assertReferenceReviewed(resource({...base,renderer:'pre-design-native-html-v2.old'})),/对照/)
 assert.throws(()=>assertReferenceReviewed(resource({...base,fixturesVersion:'native-layout-fixtures-old'})),/对照/)
})

test('同一原型同时引用结构页与视觉页时，对照选择真正存在的原页预览',async t=>{
 const requested=[],uploads={async previewBySource(actor,sourceSha256,page){
  requested.push(page)
  if(page===12)throw Object.assign(Error('没有抽样预览'),{statusCode:404})
  return {sourceSha256,page,sha256:'b'.repeat(64),name:'合成参考.pptx',mimeType:'image/png',data:Buffer.from('route-test-preview')}
 }}
 const f=await libraryFixture({uploads});t.after(f.close)
 const p=compositionPackage()
 p.designProfile.evidence=[{id:'evidence-1',provenance:'extracted',fileSha256:sha,pageNumber:12,factId:'frame-12'},{id:'evidence-2',provenance:'observed',fileSha256:sha,pageNumber:7,factId:'observation-7'}]
 p.designProfile.archetypes[0].evidenceIds.push('evidence-2')
 const created=await f.library.create({id:'owner',role:'user'},{requestId:randomUUID(),package:p}),path='/api/layout-library/'+created.id+'/1/compare'
 const response=await f.request('POST',path,{layoutId:'mixed'})
 assert.equal(response.statusCode,200,response.body);assert.equal(response.json().source.page,7);assert.deepEqual(requested,[12,7])
 const explicit=await f.request('POST',path,{layoutId:'mixed',source:{fileSha256:sha,pageNumber:12}})
 assert.equal(explicit.statusCode,404,'明确指定的来源不能被悄悄替换')
})
