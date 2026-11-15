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

test('删除版式可撤销，并保留已绑定项目和历史成果；权限及过期操作被拒绝',async t=>{
 const f=await libraryFixture();t.after(f.close)
 const post=(path,body={},actor)=>f.request('POST',path,{requestId:randomUUID(),...body},actor)
 const pkg=createPackage('可撤销删除'),created=(await post('/api/layout-library',{package:pkg})).json(),path='/api/layout-library/'+created.id
 const project='/api/projects/'+f.p.id
 assert.equal((await post(project+'/layout-bindings',{baseRevision:0,draftId:f.draft.id,expectedRevision:0,scope:'global',resource:{resourceId:created.id,version:1}})).statusCode,200)
 const rendered=await post(project+'/workflow/visuals',{draftId:f.draft.id,applyLibrary:true,expectedBindingRevision:1});assert.equal(rendered.statusCode,200,rendered.body)
 const artifact='workflow-visual-'+rendered.json().id+'-html',html=(await f.visuals.readArtifact(f.p,artifact)).data.toString()
 assert.equal((await post(path+'/delete',{expectedVersion:1},'other')).statusCode,404)
 assert.equal((await post(path+'/delete',{expectedVersion:2})).statusCode,409)
 const request={requestId:randomUUID(),expectedVersion:1},removed=await f.request('POST',path+'/delete',request);assert.equal(removed.statusCode,200,removed.body)
 assert.equal((await f.request('POST',path+'/delete',request)).json().deleteToken,removed.json().deleteToken)
 assert.equal((await f.request('GET','/api/layout-library')).json().resources.length,0)
 assert.equal((await f.request('GET',path+'/1')).json().deleted,true)
 assert.equal((await post(path+'/revisions',{expectedVersion:1,package:pkg})).statusCode,409)
 assert.equal((await post(project+'/layout-bindings',{baseRevision:0,draftId:f.draft.id,expectedRevision:1,scope:'global',resource:{resourceId:created.id,version:1}})).statusCode,409)
 assert.equal((await f.visuals.readArtifact(f.p,artifact)).data.toString(),html)
 assert.equal((await f.library.bindings(f.p)).global.resourceId,created.id)
 assert.equal((await post(path+'/restore',{deleteToken:randomUUID()})).statusCode,409)
 assert.equal((await post(path+'/restore',{deleteToken:removed.json().deleteToken},'other')).statusCode,404)
 assert.equal((await post(path+'/restore',{deleteToken:removed.json().deleteToken})).statusCode,200)
 assert.equal((await f.request('GET','/api/layout-library')).json().resources[0].id,created.id)
 assert.equal((await f.request('GET',path+'/1')).json().package.name,pkg.name)
})
