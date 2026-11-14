import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {libraryFixture} from './layout-library/fixture.mjs'
import {createPackage} from '../src/layout-library/contract.mjs'
test('Fastify+持久库+实际Chromium：管理、发布、绑定、生成、覆盖、导出与私有隔离',{timeout:120000},async t=>{
 const f=await libraryFixture();t.after(f.close)
 const post=(path,payload={},actor)=>f.request('POST',path,{requestId:randomUUID(),...payload},actor)
 assert.equal((await f.request('GET','/api/layout-library',undefined,'missing')).statusCode,401)
 const p=createPackage('自定义蓝灰');p.rights.shareAllowed=true
 let r=await post('/api/layout-library',{package:p});assert.equal(r.statusCode,200,r.body);const resource=r.json(),base=`/api/layout-library/${resource.id}/1`
 assert.equal((await f.request('GET',base,undefined,'other')).statusCode,404)
 r=await f.request('POST',base+'/validate',{});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().status,'passed',r.body)
 assert.equal((await post(base+'/publish',{visibility:'official',reviewed:true})).statusCode,403)
 assert.equal((await post(base+'/request-share')).statusCode,200)
 r=await post(base+'/publish',{visibility:'shared',reviewed:true},'admin');assert.equal(r.statusCode,200,r.body)
 assert.equal((await f.request('GET',base,undefined,'other')).statusCode,200)
 const url=`/api/projects/${f.p.id}`,pageId='visual-page-'+f.draft.blocks[0].items[0].id
 r=await post(url+'/layout-bindings',{baseRevision:0,draftId:f.draft.id,expectedRevision:0,scope:'global',resource:{resourceId:resource.id,version:1}});assert.equal(r.statusCode,200,r.body)
 assert.equal((await f.request('GET',url+'/layout-bindings')).json().status,'saved-pending-apply')
 r=await post(url+'/workflow/visuals',{draftId:f.draft.id,applyLibrary:true,expectedBindingRevision:1});assert.equal(r.statusCode,200,r.body)
 let deck=(await f.visuals.current(f.p,f.draft)).current;assert.equal(deck.layoutBindingRevision,1);assert.equal(deck.nativeLayout,undefined);assert.equal(deck.pages[0].nativeLayout.theme.accent,p.theme.accent)
 const originalId=deck.id,originalHtml=(await f.visuals.readArtifact(f.p,`workflow-visual-${deck.id}-html`)).data.toString()
 // Local layout changes cannot accidentally clear a protected per-property manual adjustment.
 r=await post(url+'/layout-bindings',{baseRevision:0,draftId:f.draft.id,expectedRevision:1,scope:'manual',pageIds:[pageId],overrides:{theme:{accent:'#111111'}}});assert.equal(r.statusCode,200,r.body)
 r=await post(url+'/layout-bindings',{baseRevision:0,draftId:f.draft.id,expectedRevision:2,scope:'local',pageIds:[pageId],resource:null,overrides:{layoutId:'columns'}});assert.equal(r.statusCode,200,r.body)
 r=await post(url+'/workflow/visuals',{draftId:f.draft.id,baseVisualId:deck.id,applyLibrary:true,expectedBindingRevision:3});assert.equal(r.statusCode,200,r.body)
 deck=(await f.visuals.current(f.p,f.draft)).current;assert.equal(deck.pages[0].nativeLayout.theme.accent,'#111111');assert.equal(deck.pages[0].nativeLayout.layout.id,'columns')
 assert.equal((await f.visuals.readArtifact(f.p,`workflow-visual-${originalId}-html`)).data.toString(),originalHtml)
 r=await post(url+'/layout-bindings',{baseRevision:0,draftId:f.draft.id,expectedRevision:3,scope:'local',pageIds:[pageId],remove:true});assert.equal(r.statusCode,200,r.body)
 r=await post(url+'/workflow/visuals',{draftId:f.draft.id,baseVisualId:deck.id,applyLibrary:true,expectedBindingRevision:4});assert.equal(r.statusCode,200,r.body)
 deck=(await f.visuals.current(f.p,f.draft)).current;assert.equal(deck.pages[0].nativeLayout.layout.id,'points');assert.equal(deck.pages[0].nativeLayout.theme.accent,'#111111')
 r=await post(url+'/layout-save-page',{visualId:deck.id,pageId,name:'我的复用页'});assert.equal(r.statusCode,200,r.body)
 const exported=(await f.request('GET',`/api/layout-library/${r.json().id}/1/export`)).json();assert(!JSON.stringify(exported).includes('既有城市片区'));assert.equal(exported.rights.shareAllowed,false)
 assert.equal((await f.request('GET',url+'/layout-bindings',undefined,'other')).statusCode,404)
 assert.equal((await post(url+'/layout-bindings',{baseRevision:0,draftId:f.draft.id,expectedRevision:0,scope:'global',resource:null})).statusCode,409)
 const current=await f.visuals.current(f.p,f.draft);assert.equal(current.current.id,deck.id)
})
test('参考原件只归拥有者，导入资源无权伪造发布或验证状态',async t=>{
 const f=await libraryFixture();t.after(f.close);const pkg=createPackage('文件导入');const bytes=Buffer.from(JSON.stringify(pkg)),body={requestId:randomUUID(),filename:'reference.json',content:bytes.toString('base64')}
 const result=await f.request('POST','/api/layout-library/import',body);assert.equal(result.statusCode,200,result.body);const id=result.json().id
 assert.equal((await f.request('GET',`/api/layout-library/${id}/source`)).rawPayload.toString(),bytes.toString())
 assert.equal((await f.request('GET',`/api/layout-library/${id}/source`,undefined,'other')).statusCode,404)
 assert.equal((await f.request('POST','/api/layout-library',{requestId:'forged',package:{...pkg,validation:{status:'passed'}}})).statusCode,400)
})
