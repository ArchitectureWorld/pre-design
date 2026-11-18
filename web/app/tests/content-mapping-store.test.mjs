import test from 'node:test'
import assert from 'node:assert/strict'
import {createTestDb} from './support/dossier-db.mjs'
import {createLayoutLibrary} from '../src/layout-library/store.mjs'
import {compositionPackage} from './fixtures/composition.mjs'
import {contentSourceOptions} from '../src/layout-library/content-mapping.mjs'
import {createPackage,exportReusable} from '../src/layout-library/contract.mjs'
const actor={id:'owner',role:'user'},project={id:'00000000-0000-4000-8000-000000000001'},draftId='00000000-0000-4000-8000-000000000002'
const source=()=>({id:'i',title:'标题',paragraphs:['局部标题','保留段落'],points:[],evidenceIndexes:[]})
function packageWithText(){const p=compositionPackage(),a=p.designProfile.archetypes[0];a.roles=['title','claim','text'];a.capacity={images:0,bodyPoints:0,tableRows:0,textBlocks:1};p.layouts[0].slots=[{id:'title',role:'title',rect:{x:.04,y:.04,w:.92,h:.15}},{id:'claim',role:'claim',rect:{x:.04,y:.3,w:.4,h:.4}},{id:'local',role:'text',binding:'local',rect:{x:.55,y:.3,w:.4,h:.4}}];return p}
async function fixture(t){const env=await createTestDb();t.after(env.close);const wrap=c=>({query:async(...args)=>{const r=await c.query(...args);for(const row of r.rows??[])if(typeof row.document==='string')row.document=JSON.parse(row.document);return r},release:()=>c.release?.()});const db={...wrap(env.db),connect:async()=>wrap(await env.db.connect())},store=await createLayoutLibrary(db);await db.query('CREATE TABLE projects(id uuid PRIMARY KEY)');await db.query('INSERT INTO projects(id) VALUES($1)',[project.id]);const config={global:{resourceId:project.id,version:1,hash:'a'.repeat(64),package:packageWithText()},globalOverrides:{},local:{},manual:{},reviewPageIds:[]};await db.query('INSERT INTO layout_project_bindings(project_id,draft_id,revision,document) VALUES($1,$2,0,$3)',[project.id,draftId,config]);const draft={id:draftId,flow:['c'],blocks:[{id:'b',chapterId:'c',items:[source()]}]},mapping={sourceFingerprint:contentSourceOptions(source()).sourceFingerprint,entries:[{source:{field:'paragraphs',index:0},quote:'局部标题',targetKey:'local'}]},body={requestId:'map',draftId,expectedRevision:0,scope:'content',pageIds:['visual-page-i'],contentMapping:mapping};return{db,store,draft,body}}
test('mapping is atomically saved and projected without changing draft; repeat old-page layout is idempotent',async t=>{
 const {store,draft,body}=await fixture(t),before=structuredClone(draft)
 const saved=await store.saveBindings(actor,project,body,draft);assert.equal(saved.revision,1)
 assert.deepEqual(await store.saveBindings(actor,project,body,draft),saved)
 const config=await store.bindings(project),pages=[{id:'visual-page-i',item:source()}],rendered=store.compilePages(pages,config)
 assert.deepEqual(rendered[0].item.paragraphs,['保留段落']);assert.equal(rendered[0].item.textBlocks[0].text,'局部标题');assert.deepEqual(draft,before)
 assert.deepEqual(store.compilePages(rendered,config),rendered)
 const changed=structuredClone(rendered);changed[0].item.paragraphs[0]='旁路改动';assert.throws(()=>store.compilePages(changed,config))
 const noClaim=structuredClone(config);noClaim.global.package.layouts[0].slots=noClaim.global.package.layouts[0].slots.filter(s=>s.role!=='claim');assert.throws(()=>store.compilePages(pages,noClaim),/覆盖|布局|版式/)
 const restored=store.compilePages(rendered,{...config,contentMappings:{},global:{...config.global,package:createPackage()}})
 assert.deepEqual(restored[0].item,source());assert.equal(restored[0].contentMappingSource,undefined)
 assert.ok(!JSON.stringify(exportReusable(rendered[0],'资源')).includes('局部标题'))
})
test('two saves with the same expected revision have exactly one winner',async t=>{
 const {store,draft,body}=await fixture(t)
 const results=await Promise.allSettled([store.saveBindings(actor,project,body,draft),store.saveBindings(actor,project,{...body,requestId:'other-save'},draft)])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal((await store.bindings(project)).revision,1)
})
test('stale fingerprint or lost unmapped content rolls back; competing revisions cannot overwrite',async t=>{
 const {store,draft,body}=await fixture(t)
 await assert.rejects(()=>store.saveBindings(actor,project,{...body,contentMapping:{...body.contentMapping,sourceFingerprint:'f'.repeat(64)}},draft));assert.equal((await store.bindings(project)).revision,0)
 await assert.rejects(()=>store.saveBindings(actor,project,{...body,contentMapping:{...body.contentMapping,entries:[{...body.contentMapping.entries[0],source:{field:'paragraphs',index:1},quote:'保留段落',targetKey:'wrong'}]}},draft));assert.equal((await store.bindings(project)).revision,0)
 await store.saveBindings(actor,project,body,draft);await assert.rejects(()=>store.saveBindings(actor,project,{...body,requestId:'second'},draft),/版本|配置/)
 const config=await store.bindings(project);assert.throws(()=>store.compilePages([{id:'visual-page-i',item:{...source(),paragraphs:['改稿','保留段落']}}],config))
})
test('new draft carry clears source mappings and marks their pages for review',async t=>{
 const {store,db,draft,body}=await fixture(t);await store.saveBindings(actor,project,body,draft)
 const c=await db.connect();try{await c.query('BEGIN');await store.carryBindings(project,{id:draftId,document:draft},{...draft,id:'00000000-0000-4000-8000-000000000003',changedBlockId:'b',changedItemId:'i'},c);await c.query('COMMIT')}finally{c.release()}
 const config=await store.bindings(project);assert.deepEqual(config.contentMappings,{});assert.ok(config.reviewPageIds.includes('visual-page-i'))
})
test('HTTP source options and preview use the same exact mapping as saved bindings',async t=>{
 const {store,draft,body}=await fixture(t),{default:Fastify}=await import('fastify'),{registerLayoutRoutes}=await import('../src/layout-library/routes.mjs')
 draft.chapters=[{id:'c',title:'章节'}];const app=Fastify();t.after(()=>app.close());app.addHook('preHandler',async req=>{req.user=actor});app.setErrorHandler((e,_req,r)=>r.code(e.name==='ZodError'?400:e.statusCode??500).send({error:e.message}))
 registerLayoutRoutes({app,library:store,project:async()=>project,workflows:{current:async()=>({current:draft})},serial:async(_key,fn)=>fn(),event:async()=>{},mappingMeasure:async()=>({pages:1,issues:[]})})
 const url='/api/projects/'+project.id,post=(path,payload)=>app.inject({method:'POST',url:url+path,payload})
 const listing=await app.inject({url:url+'/layout-bindings'});assert.deepEqual(listing.json().contentSources?.['visual-page-i']?.sources[0],{source:{field:'paragraphs',index:0},quote:'局部标题'})
 const preview=await post('/layout-preview',{draftId,pageId:'visual-page-i',scope:'content',contentMapping:body.contentMapping});assert.equal(preview.statusCode,200,preview.body);assert.match(preview.json().html,/data-text-block="local"/);assert.match(preview.json().html,/保留段落/)
 assert.equal((await store.bindings(project)).revision,0)
 const result=await post('/layout-bindings',{...body,baseRevision:0});assert.equal(result.statusCode,200,result.body)
 const forged=await post('/layout-bindings',{...body,requestId:'forged',expectedRevision:1,baseRevision:0,contentMapping:{...body.contentMapping,entries:[{...body.contentMapping.entries[0],quote:'伪造'}]}});assert.equal(forged.statusCode,409,forged.body)
})
test('explicit emphasis is exact in project projection, rejects forged spans, and never exports project text',async t=>{
 const {store,draft,body}=await fixture(t),before=structuredClone(draft);body.contentMapping.entries[0].spans=[{start:0,end:2,quote:'局部',style:'accent-strong'}]
 await store.saveBindings(actor,project,body,draft);const config=await store.bindings(project),rendered=store.compilePages([{id:'visual-page-i',item:source()}],config);assert.deepEqual(rendered[0].item.textBlocks[0].spans,body.contentMapping.entries[0].spans);assert.deepEqual(draft,before)
 const exported=JSON.stringify(exportReusable(rendered[0],'复用版式'));assert(!exported.includes('局部标题'));assert(!exported.includes('"spans"'))
 const forged=structuredClone(body);forged.requestId='wrong-span';forged.expectedRevision=1;forged.contentMapping.entries[0].spans[0].quote='猜词';await assert.rejects(store.saveBindings(actor,project,forged,draft));assert.equal((await store.bindings(project)).revision,1)
})
test('matching saved request replays without preflight; fingerprint mismatch rejects',async t=>{const {store,draft,body}=await fixture(t);assert.equal(typeof store.bindingMutationResult,'function');assert.equal(await store.bindingMutationResult(actor,project,body),null);const saved=await store.saveBindings(actor,project,body,draft);assert.deepEqual(await store.bindingMutationResult(actor,project,body),saved);await assert.rejects(store.bindingMutationResult(actor,project,{...body,expectedRevision:1}))})
test('preflight hook runs under save transaction and failure rolls back before mutation',async t=>{const {store,draft,body}=await fixture(t);let called=0;await assert.rejects(store.saveBindings(actor,project,body,draft,{assertPreflight:async()=>{called++;throw Error('snapshot changed')}}),/snapshot changed/);assert.equal(called,1);assert.equal((await store.bindings(project)).revision,0);assert.equal(await store.bindingMutationResult(actor,project,body),null);const receipt={id:'proof',status:'passed'};const saved=await store.saveBindings(actor,project,body,draft,{assertPreflight:async()=>{},preflight:receipt});assert.deepEqual(saved.preflight,receipt);assert.deepEqual(await store.saveBindings(actor,project,body,draft,{assertPreflight:async()=>{throw Error('must replay')}}),saved)})
test('HTTP content mapping preflight rejects overflow without mutation and retries saved requests without measuring again',async t=>{const {store,draft,body}=await fixture(t),{default:Fastify}=await import('fastify'),{registerLayoutRoutes}=await import('../src/layout-library/routes.mjs');draft.chapters=[{id:'c',title:'章节'}];const app=Fastify();t.after(()=>app.close());app.addHook('preHandler',async req=>{req.user=actor});app.setErrorHandler((e,_req,r)=>r.code(e.statusCode??500).send({error:e.message}));let overflow=true,measures=0;registerLayoutRoutes({app,library:store,project:async()=>project,workflows:{current:async()=>({current:draft})},serial:async(_k,fn)=>fn(),event:async()=>{},mappingMeasure:async()=>{measures++;return{pages:1,issues:overflow?[{code:'overflow',slotId:'local'}]:[]}}});const payload={...body,baseRevision:0},send=()=>app.inject({method:'POST',url:'/api/projects/'+project.id+'/layout-bindings',payload});let r=await send();assert.equal(r.statusCode,409);assert.equal((await store.bindings(project)).revision,0);overflow=false;r=await send();assert.equal(r.statusCode,200,r.body);assert.equal(r.json().preflight.status,'passed');assert.equal(measures,2);assert.deepEqual((await send()).json(),r.json());assert.equal(measures,2)})
test('cancellation during each write rolls back bindings, history and receipt before COMMIT',async t=>{
 const {db,store,draft,body}=await fixture(t),connect=db.connect.bind(db)
 for(const table of ['layout_project_bindings','layout_binding_versions','layout_library_mutations']){
  const controller=new AbortController(),reason=Error('cancel during '+table)
  db.connect=async()=>{const c=await connect();return{release:()=>c.release(),query:async(sql,args)=>{const result=await c.query(sql,args);if(sql.startsWith('INSERT INTO '+table+'('))controller.abort(reason);return result}}}
  await assert.rejects(store.saveBindings(actor,project,body,draft,{assertPreflight:async()=>{},signal:controller.signal}),e=>e===reason)
  db.connect=connect
  assert.equal((await store.bindings(project)).revision,0);assert.equal(await store.bindingMutationResult(actor,project,body),null);assert.equal(Number((await db.query('SELECT count(*) AS n FROM layout_binding_versions WHERE project_id=$1',[project.id])).rows[0].n),0)
 }
 await store.saveBindings(actor,project,body,draft);assert.equal((await store.bindings(project)).revision,1)
})
