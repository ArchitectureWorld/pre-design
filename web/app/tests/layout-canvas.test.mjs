import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {libraryFixture} from './layout-library/fixture.mjs'
import {createPackage,resolvePage} from '../src/layout-library/contract.mjs'

test('文字脚本阶段可以绑定个人版式草稿并预览真实页内容，正式成果仍按整稿确认生成',async t=>{
 const f=await libraryFixture();t.after(()=>f.close());f.draft.approval=null
 const packageValue=createPackage('个人草稿')
 const resource=(await f.request('POST','/api/layout-library',{requestId:randomUUID(),package:packageValue})).json()
 const base='/api/projects/'+f.p.id,pageId='visual-page-'+f.draft.blocks[0].items[0].id
 const saved=await f.request('POST',base+'/layout-bindings',{requestId:randomUUID(),baseRevision:0,draftId:f.draft.id,expectedRevision:0,scope:'global',resource:{resourceId:resource.id,version:1},overrides:{layoutId:'columns',theme:{accent:'#235740'}}})
 assert.equal(saved.statusCode,200,saved.body)
 const config=(await f.request('GET',base+'/layout-bindings')).json()
 assert.equal(config.globalOverrides.layoutId,'columns')
 assert.equal((await f.visuals.current(f.p,f.draft)).current,null)
 const preview=await f.request('POST',base+'/layout-preview',{draftId:f.draft.id,pageId})
 assert.equal(preview.statusCode,200,preview.body)
 assert(preview.json().html.includes(f.draft.blocks[0].items[0].paragraphs[0]))
 assert(preview.json().html.includes('data-layout="columns"'))
 assert(preview.json().html.includes('#235740'))
 const early=await f.request('POST',base+'/workflow/visuals',{requestId:randomUUID(),draftId:f.draft.id,applyLibrary:true,expectedBindingRevision:1})
 assert.equal(early.statusCode,409)
 assert.equal((await f.visuals.current(f.p,f.draft)).current,null)
 assert.equal((await f.request('POST',base+'/layout-preview',{draftId:randomUUID(),pageId})).statusCode,409)
 assert.equal((await f.request('POST',base+'/layout-preview',{draftId:f.draft.id,pageId},'other')).statusCode,404)
})

test('全局版式属性、局部属性与已保存的人工修改依次覆盖',()=>{
 const page={item:{title:'区位',paragraphs:['明确位置。'],points:['行政区位'],evidenceIndexes:[]}}
 const result=resolvePage({page,globalPackage:createPackage(),globalOverrides:{layoutId:'columns',theme:{accent:'#235740',bodySize:28}},local:{overrides:{theme:{bodySize:32}}},manual:{theme:{accent:'#111111'}}})
 assert.equal(result.layout.id,'columns')
 assert.equal(result.theme.bodySize,32)
 assert.equal(result.theme.accent,'#111111')
})

test('整节多页重写不按位置串用旧版式，单页修订仍继承原设置',async t=>{
 const f=await libraryFixture();t.after(()=>f.close())
 const block=f.draft.blocks[0],first=block.items[0],second={...first,id:first.id+'-2',title:'自然条件'}
 block.items.push(second)
 const other={...structuredClone(block),id:'outline-01-2',items:[{...first,id:'outline-01-2-item-1'}]}
 f.draft.blocks.push(other)
 const firstId='visual-page-'+first.id,secondId='visual-page-'+second.id,otherId='visual-page-'+other.items[0].id
 const base='/api/projects/'+f.p.id,save=async (scope,pageIds,overrides,expectedRevision)=>f.request('POST',base+'/layout-bindings',{requestId:randomUUID(),baseRevision:0,draftId:f.draft.id,expectedRevision,scope,pageIds,resource:null,overrides})
 assert.equal((await save('global',undefined,{theme:{accent:'#235740'}},0)).statusCode,200)
 assert.equal((await save('local',[firstId,otherId],{layoutId:'columns'},1)).statusCode,200)
 assert.equal((await save('manual',[secondId],{layoutId:'focus'},2)).statusCode,200)
 const previous={id:f.draft.id,document:structuredClone(f.draft)},single=structuredClone(f.draft)
 single.id=randomUUID();single.changedBlockId=block.id;single.changedItemId=first.id;single.blocks[0].items[0].paragraphs=['修订后的区位内容。']
 await f.library.carryBindings(f.p,previous,single,f.db)
 let config=await f.library.bindings(f.p);assert.equal(config.local[firstId].overrides.layoutId,'columns');assert.equal(config.manual[secondId].layoutId,'focus')
 const next=structuredClone(single);next.id=randomUUID();next.changedItemId=null
 next.blocks[0].items=[{...second,id:first.id},{...first,id:second.id}]
 await f.library.carryBindings(f.p,{id:single.id,document:single},next,f.db)
 config=await f.library.bindings(f.p)
 assert.equal(config.local[firstId],undefined);assert.equal(config.manual[secondId],undefined)
 assert.equal(config.local[otherId].overrides.layoutId,'columns');assert.equal(config.globalOverrides.theme.accent,'#235740')
 assert.deepEqual(config.reviewPageIds.sort(),[firstId,secondId].sort())
 Object.assign(f.draft,next)
 const confirmed=await save('local',[firstId],{layoutId:'focus'},config.revision);assert.equal(confirmed.statusCode,200,confirmed.body)
 assert.deepEqual((await f.library.bindings(f.p)).reviewPageIds,[secondId])
 const old=(await f.db.query('SELECT document FROM layout_binding_versions WHERE project_id=$1 AND revision=$2',[f.p.id,3])).rows[0]
 assert.equal(old.document.manual[secondId].layoutId,'focus')
})

test('真实页预览与最终成果共同保留既有手动版式覆盖',async t=>{
 const f=await libraryFixture();t.after(()=>f.close())
 const base='/api/projects/'+f.p.id,pageId='visual-page-'+f.draft.blocks[0].items[0].id
 let generated=await f.request('POST',base+'/workflow/visuals',{requestId:randomUUID(),draftId:f.draft.id,applyLibrary:true,expectedBindingRevision:0});assert.equal(generated.statusCode,200,generated.body)
 generated=await f.request('POST',base+'/workflow/visuals',{requestId:randomUUID(),draftId:f.draft.id,baseVisualId:generated.json().id,pageIds:[pageId],layout:'focus'});assert.equal(generated.statusCode,200,generated.body)
 const saved=await f.request('POST',base+'/layout-bindings',{requestId:randomUUID(),baseRevision:0,draftId:f.draft.id,expectedRevision:0,scope:'local',pageIds:[pageId],resource:null,overrides:{layoutId:'columns'}});assert.equal(saved.statusCode,200,saved.body)
 const preview=await f.request('POST',base+'/layout-preview',{draftId:f.draft.id,pageId});assert.equal(preview.statusCode,200,preview.body)
 assert.match(preview.json().html,/data-layout="focus"/)
 const applied=await f.request('POST',base+'/workflow/visuals',{requestId:randomUUID(),draftId:f.draft.id,baseVisualId:generated.json().id,applyLibrary:true,expectedBindingRevision:1});assert.equal(applied.statusCode,200,applied.body)
 assert.equal((await f.visuals.current(f.p,f.draft)).current.pages[0].nativeLayout.layout.id,'focus')
})
