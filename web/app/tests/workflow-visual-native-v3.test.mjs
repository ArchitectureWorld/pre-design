import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createTestDb} from './support/dossier-db.mjs'
import {createLayoutLibrary} from '../src/layout-library/store.mjs'
import {createWorkflowVisualStore} from '../src/workflow-visual-store.mjs'
import {compileNativeDesignPackageV3} from '../src/layout-library/native-design-compiler.mjs'
import {nativeDesignInput} from './fixtures/native-design-v3-fixture.mjs'
import {createPackage,RENDERER,RENDERER_V3,packageDigest} from '../src/layout-library/contract.mjs'
async function fixture(t,{revision=1}={}){
 const env=await createTestDb();t.after(()=>env.close())
 const wrap=c=>({query:async(...args)=>{const r=await c.query(...args);for(const row of r.rows??[])for(const k of ['document'])if(typeof row[k]==='string')row[k]=JSON.parse(row[k]);return r},release:()=>c.release?.()})
 const db={...wrap(env.db),connect:async()=>wrap(await env.db.connect())}
 await db.query('CREATE TABLE projects(id uuid PRIMARY KEY);CREATE TABLE workflow_drafts(id uuid PRIMARY KEY);CREATE TABLE jobs(id uuid PRIMARY KEY,project_id uuid,status text);')
 const p={id:randomUUID()},draft={id:randomUUID(),version:1,projectName:'Synthetic V3 store test',formatVersion:2,approval:{approved:true},flow:['01'],chapters:[{id:'01',title:'Chapter'}],blocks:[{id:'block',chapterId:'01',title:'Section',items:[1,2].map(i=>({id:'item-'+i,title:'Title '+i,paragraphs:['Claim'],points:['Point'],evidenceIndexes:[0]}))}],evidence:[{filename:'fixture.txt',locator:'1'}]}
 await db.query('INSERT INTO projects(id) VALUES($1)',[p.id]);await db.query('INSERT INTO workflow_drafts(id) VALUES($1)',[draft.id])
 const input=nativeDesignInput();input.prototypes[0].slots=input.prototypes[0].slots.filter(s=>s.role!=='image');input.designSpec.profile.archetypes[0].roles=input.designSpec.profile.archetypes[0].roles.filter(r=>r!=='image');input.designSpec.profile.archetypes[0].capacity.images=0;input.prototypes[0].contentFitRules.maxImages=0
 const pkg=compileNativeDesignPackageV3(input),ref={resourceId:randomUUID(),version:3,hash:packageDigest(pkg),package:pkg}
 const config={global:ref,local:{},manual:{},globalOverrides:{}}
 const save=async(rev=revision)=>db.query('INSERT INTO layout_project_bindings(project_id,draft_id,revision,document) VALUES($1,$2,$3,$4) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,document=excluded.document',[p.id,draft.id,rev,config])
 const library=await createLayoutLibrary(db);await save()
 // This test exercises store transactions/rendering and the real compiler, not browser QA.
 const visuals=await createWorkflowVisualStore(db,{layoutLibrary:library,currentDraft:async()=>draft,verifyLayoutPages:async()=>({testOnly:true})})
 const generate=body=>visuals.generate(p,{requestId:randomUUID(),draftId:draft.id,...body})
 const current=async()=>(await visuals.current(p,draft)).current
 return {db,p,draft,pkg,ref,config,save,generate,current,visuals}
}
test('V3 document renderer wins mixed decks; frozen bindings and local/manual overrides survive revisions',async t=>{
 const f=await fixture(t)
 const old=createPackage('Frozen legacy'),localId='visual-page-item-2'
 f.config.local[localId]={resource:{resourceId:randomUUID(),version:1,hash:packageDigest(old),package:old}}
 f.config.manual[localId]={theme:{accent:'#112233'}}
 await f.save()
 await f.generate({applyLibrary:true,expectedBindingRevision:1})
 const first=await f.current()
 assert.equal(first.renderer,RENDERER_V3)
 assert.equal(first.pages[0].nativeLayout.renderer,RENDERER_V3)
 assert.equal(first.pages[1].nativeLayout.renderer,RENDERER)
 assert.equal(first.pages[1].nativeLayout.theme.accent,'#112233')
 const artifact=await f.visuals.readArtifact(f.p,'workflow-visual-'+first.id+'-html')
 assert.match(artifact.data.toString(),/data:image\/svg\+xml/)
 await f.generate({baseVisualId:first.id,pageIds:[first.pages[0].id],layout:f.pkg.layouts[0].id})
 const second=await f.current()
 assert.equal(second.renderer,RENDERER_V3)
 assert.deepEqual(second.pages[1],first.pages[1])
 assert.equal(second.pages[0].nativeLayout.resourceRefs[0].version,3)
 assert.equal(second.pages[1].nativeLayout.resourceRefs[1].version,1)
 assert.equal(second.pages[0].protectedLayout.layoutId,f.pkg.layouts[0].id)
 assert.equal((await f.visuals.readArtifact(f.p,'workflow-visual-'+first.id+'-html')).data.toString(),artifact.data.toString())
})
test('V3 pending binding revision locks local edits before any recompile or new persisted document',async t=>{
 const f=await fixture(t)
 await f.generate({applyLibrary:true,expectedBindingRevision:1})
 const first=await f.current()
 // Seed exact old V3 document marker so this regression is independent of renderer selection.
 await f.db.query('UPDATE workflow_visuals SET document=$2 WHERE id=$1',[first.id,{...first,renderer:RENDERER_V3}])
 await f.save(2)
 assert.equal((await f.current()).layoutPending,true)
 await assert.rejects(f.generate({baseVisualId:first.id,pageIds:[first.pages[0].id],layout:f.pkg.layouts[0].id}),/配置待应用/)
 assert.equal((await f.current()).version,1)
 await assert.rejects(f.generate({baseVisualId:first.id,applyLibrary:true,expectedBindingRevision:1}),/配置已经改变/)
})
test('V3 revision at binding zero still re-renders native pages and retains binding/QA receipts',async t=>{
 const f=await fixture(t,{revision:0})
 await f.generate({applyLibrary:true,expectedBindingRevision:0})
 const first=await f.current()
 await f.db.query('UPDATE workflow_visuals SET document=$2 WHERE id=$1',[first.id,{...first,renderer:RENDERER_V3}])
 await f.generate({baseVisualId:first.id,pageIds:[first.pages[0].id],layout:f.pkg.layouts[0].id})
 const next=await f.current()
 assert.equal(next.renderer,RENDERER_V3)
 assert.equal(next.layoutBindingRevision,0)
 assert.equal(next.layoutQa.testOnly,true)
})
test('mixed V2/V3 decks select V3 while V2 page binding stays on its original version',async t=>{
 const f=await fixture(t),v2={...createPackage('Pinned V2'),schemaVersion:'pre-design.layout-package.v2',canvas:f.pkg.canvas,theme:f.pkg.theme,designProfile:f.pkg.designProfile,layouts:f.pkg.layouts.map(({prototypeSvg,contentFitRules,...layout})=>layout)}
 f.config.local['visual-page-item-2']={resource:{resourceId:randomUUID(),version:2,hash:packageDigest(v2),package:v2}}
 await f.save();await f.generate({applyLibrary:true,expectedBindingRevision:1})
 const doc=await f.current()
 assert.equal(doc.renderer,RENDERER_V3)
 assert.equal(doc.pages[1].nativeLayout.renderer,'pre-design-native-html-v2.0')
 assert.equal(doc.pages[1].nativeLayout.resourceRefs[1].version,2)
})
test('old global bindings are not silently upgraded merely because V3 support exists',async t=>{
 const f=await fixture(t),pkg=createPackage('Pinned V1')
 f.config.global={resourceId:randomUUID(),version:1,hash:packageDigest(pkg),package:pkg}
 await f.save();await f.generate({applyLibrary:true,expectedBindingRevision:1})
 const first=await f.current()
 await f.generate({baseVisualId:first.id,pageIds:[first.pages[0].id],layout:'focus'})
 const next=await f.current()
 assert.equal(next.renderer,RENDERER)
 assert(next.pages.every(p=>p.nativeLayout.renderer===RENDERER))
 assert(next.pages.every(p=>p.nativeLayout.resourceRefs[0].version===1))
 assert.deepEqual(next.pages[1],first.pages[1])
})
