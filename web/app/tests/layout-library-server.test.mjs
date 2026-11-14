/** Real PostgreSQL + existing Fastify/scheduler. The DSH response is controlled;
 * this proves integration and isolation, not remote model quality or production deployment. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createTestDb} from './support/dossier-db.mjs'
import {createApp} from '../src/server.mjs'
import {createPackage} from '../src/layout-library/contract.mjs'
import {draft,confirmedOutlineFixture} from './fixtures/outline.mjs'
const enabled=!!process.env.PRE_DOSSIER_TEST_DATABASE
async function fixture(t){
 const env=await createTestDb(),db=env.db,root=await mkdtemp(join(tmpdir(),'layout-server-')),contexts=new Map(),calls=[]
 const worker={async call(p,b){if(b.operation==='create')contexts.set(p.id,{project:{projectId:p.id,currentRevision:0},proposals:[],stateObjects:[]});return structuredClone(contexts.get(p.id))},
 async run(){return {response:JSON.stringify({reportTitle:'项目基本情况',blocks:[['outline-01-1','项目区位','任务书载有项目所在地。'],['outline-01-2','资源构成','沿河片区包含公共绿地。']].map(([id,heading,sectionText])=>({id,heading,sectionText,sectionEvidenceIndexes:[0],items:[{title:heading+'判断',paragraphs:[heading+'是本轮研究的基础。'],points:['依据任务书整理明确的项目属性。'],presentation:{layout:'focus',note:'文字卡及来源。'},evidenceIndexes:[0]}],internalNotes:[]}))}),eventCount:1}},
 async runLayoutReference(b){calls.push(b);return {response:JSON.stringify(createPackage('模型候选')),execution:{controlled:true,scope:'layout-library'}}},
 async listArtifacts(){return []},async close(){},async closeAll(){} }
 const users=[{id:'admin',role:'admin',token:'a'.repeat(40)},{id:'other',token:'b'.repeat(40)}]
 let app=await createApp({db,workers:worker,projectsRoot:root,users})
 t.after(async()=>{await app.close();await env.close();await rm(root,{recursive:true,force:true})})
 const req=(method,url,payload,user=0)=>app.inject({method,url,headers:{authorization:'Bearer '+users[user].token},...(payload===undefined?{}:{payload})})
 const policy=(await req('GET','/api/admin/models')).json();const model=policy.models.find(x=>x.provider==='SenseNova'&&x.model==='sensenova-6.8-flash-lite');model.status='verified';model.capabilities.tools=true
 assert.equal((await req('PUT','/api/admin/models',{expectedRevision:policy.revision,policy})).statusCode,200)
 return {db,req,worker,calls,get app(){return app},async restart(){await app.close();app=await createApp({db,workers:worker,projectsRoot:root,users})}}
}

test('真实PG/完整服务器：任务外预置、发布、整稿应用、来源版本固化与重启回读',{skip:!enabled,timeout:120000},async t=>{
 const f=await fixture(t)
 const seeds=await f.req('POST','/api/layout-library/seed',{requestId:'seeds'});assert.equal(seeds.statusCode,200,seeds.body);assert.equal(seeds.json().created.length,3)
 assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM projects')).rows[0].n),0,'管理库不创建假项目')
 const resource=seeds.json().created[0],url=`/api/layout-library/${resource.id}/${resource.version}`
 const qa=await f.req('POST',url+'/validate',{});assert.equal(qa.statusCode,200,qa.body);assert.equal(qa.json().status,'passed')
 const published=await f.req('POST',url+'/publish',{requestId:'publish',visibility:'official',reviewed:true});assert.equal(published.statusCode,200,published.body)
 assert((await f.req('GET','/api/layout-library',undefined,1)).json().resources.some(r=>r.id===resource.id))
 const created=await f.req('POST','/api/projects',{requestId:'project',name:'版式集成测试'});assert.equal(created.statusCode,200,created.body)
 const pid=created.json().id,base='/api/projects/'+pid,post=(path,b)=>f.req('POST',base+path,{requestId:randomUUID(),baseRevision:0,...b})
 const uploaded=await post('/materials',{filename:'任务书.txt',content:Buffer.from('任务书载有项目所在地。沿河片区包含公共绿地。').toString('base64')});assert.equal(uploaded.statusCode,200,uploaded.body)
 await confirmedOutlineFixture(f.db,pid);const outline=draft(uploaded.json().id);outline.questions=[]
 await f.db.query('UPDATE outline_versions SET draft=$2,flow=$3 WHERE project_id=$1',[pid,outline,JSON.stringify(['01'])])
 const started=await post('/workflow/draft',{outlineVersion:1});assert.equal(started.statusCode,200,started.body);await f.app.waitForJobs()
 let state=(await f.req('GET',base+'/state')).json();const doc=state.workflow.current;assert(doc,JSON.stringify(state.jobs));assert.equal(doc.blocks.length,2)
 assert.equal((await post('/workflow/approve',{draftId:doc.id})).statusCode,200)
 const binding=await post('/layout-bindings',{draftId:doc.id,expectedRevision:0,scope:'global',resource:{resourceId:resource.id,version:1}});assert.equal(binding.statusCode,200,binding.body)
 const result=await post('/workflow/visuals',{draftId:doc.id,applyLibrary:true,expectedBindingRevision:1});assert.equal(result.statusCode,200,result.body)
 state=(await f.req('GET',base+'/state')).json();const deck=state.workflow.visuals.current;assert.equal(deck.pages.length,2);assert.equal(deck.layoutBindingRevision,1);assert.equal(deck.layoutQa.pageCount,2)
 assert.equal(deck.pages[0].nativeLayout.resourceRefs[0].resourceId,resource.id)
 const fileId=`workflow-visual-${deck.id}-html`,html=await f.req('GET',base+'/artifacts/'+fileId);assert.equal(html.statusCode,200,html.body);assert.match(html.body,/layout-native-page/)
 assert.equal((await f.req('GET',base+'/layout-bindings',undefined,1)).statusCode,404)
 await f.restart();assert.equal((await f.req('GET',base+'/artifacts/'+fileId)).body,html.body)
 assert.equal((await f.req('GET',base+'/layout-bindings')).json().status,'applied')
})

test('真实PG/共享调度器：任务外DSH提炼、候选隔离、幂等、权限、取消和坏响应不入库',{skip:!enabled,timeout:60000},async t=>{
 const f=await fixture(t),path='/api/layout-library/reference-jobs'
 const body={requestId:'reference-one',name:'文字要求提炼',text:'请使用白色背景、深色正文，主色蓝灰，标题清晰，正文保留足够留白。',allowModel:true}
 assert.equal((await f.req('POST',path,{...body,allowModel:false})).statusCode,400)
 const start=await f.req('POST',path,body);assert.equal(start.statusCode,200,start.body);await f.app.waitForJobs()
 const list=(await f.req('GET',path)).json();const j=list.find(x=>x.id===start.json().id);assert.equal(j.status,'completed',JSON.stringify(j));assert.equal(j.result.status,'candidate-not-published')
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].policy.routes.parent.primary.provider,'SenseNova');assert.match(f.calls[0].prompt,/V14/)
 const saved=(await f.req('GET',`/api/layout-library/${j.result.id}/1`)).json();assert.equal(saved.visibility,'private');assert.equal(saved.published,false);assert.equal(saved.package.source.kind,'reference-text')
 assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM projects')).rows[0].n),0)
 assert.equal((await f.req('GET',path,undefined,1)).json().length,0)
 assert.equal((await f.req('POST',path,body)).json().id,j.id);await f.app.waitForJobs();assert.equal(f.calls.length,1)
 assert.equal((await f.req('POST',path,{...body,name:'changed'})).statusCode,409)
 f.worker.runLayoutReference=async()=>({response:'not-json'})
 const bad=await f.req('POST',path,{...body,requestId:'bad'});await f.app.waitForJobs();assert.equal((await f.req('GET',path)).json().find(x=>x.id===bad.json().id).status,'failed')
 assert.equal((await f.req('GET','/api/layout-library')).json().resources.length,1)
 const ready=Promise.withResolvers();f.worker.runLayoutReference=async({signal})=>{ready.resolve();await new Promise((resolve,reject)=>{if(signal.aborted)return reject(signal.reason);signal.addEventListener('abort',()=>reject(signal.reason),{once:true})})}
 const waiting=await f.req('POST',path,{...body,requestId:'cancel'});await ready.promise
 assert.equal((await f.req('POST',path+'/'+waiting.json().id+'/cancel',{},1)).statusCode,404)
 assert.equal((await f.req('POST',path+'/'+waiting.json().id+'/cancel',{})).statusCode,200);await f.app.waitForJobs()
 assert.equal((await f.req('GET',path)).json().find(x=>x.id===waiting.json().id).status,'cancelled')
})
