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

test('自定义版式显示已绑定模型，保留失败原因、真实路由和进度，用户可按最新策略重试',{skip:!enabled,timeout:60000},async t=>{
 const f=await fixture(t),path='/api/layout-library/reference-jobs'
 const config=await f.req('GET','/api/layout-library/reference-config')
 assert.equal(config.statusCode,200);assert.equal(config.json().configured,true)
 assert.equal(config.json().modelName,'sensenova-6.8-flash-lite')
 const failure={scope:'layout-library',actualRoute:{provider:'SenseNova',model:'sensenova-6.8-flash-lite'},failure:{code:'SERVER',httpStatus:504},parent:{status:'recorded',requests:[{provider:'SenseNova',model:'sensenova-6.8-flash-lite'}]}}
 f.worker.runLayoutReference=async({onEvent})=>{onEvent({stage:'generating'});throw Object.assign(new Error('provider failure'),{execution:failure})}
 const start=await f.req('POST',path,{requestId:'failed-visible',name:'自定义蓝灰',text:'白色背景、蓝灰色标题与深色正文，保留完整的资料引用区。',allowModel:true})
 assert.equal(start.statusCode,200);await f.app.waitForJobs()
 const j=(await f.req('GET',path)).json().find(j=>j.id===start.json().id)
 assert.equal(j.status,'failed');assert.match(j.error,/504/);assert.equal(j.name,'自定义蓝灰');assert.equal(j.progress.stage,'failed')
 assert.deepEqual(j.execution_metadata,failure)
 assert.equal((await f.req('POST',path+'/'+j.id+'/retry',{requestId:'other-retry'},1)).statusCode,404)
 f.worker.runLayoutReference=async({onEvent})=>{onEvent({stage:'generating'});return {response:JSON.stringify(createPackage('候选')),execution:{scope:'layout-library',actualRoute:failure.actualRoute}}}
 const again=await f.req('POST',path+'/'+j.id+'/retry',{requestId:'retry-current'})
 assert.equal(again.statusCode,200);await f.app.waitForJobs()
 const next=(await f.req('GET',path)).json().find(x=>x.id===again.json().id)
 assert.equal(next.status,'completed');assert.equal(next.progress.stage,'completed')
 assert.equal(next.modelName,'sensenova-6.8-flash-lite')
 assert.equal((await f.req('POST',path+'/'+j.id+'/retry',{requestId:'retry-current'})).json().id,next.id)
})

test('上传参考后连续对话修订同一版式，纯讨论保留版本并可重开历史',{skip:!enabled,timeout:60000},async t=>{
 const f=await fixture(t),path='/api/layout-library/conversations',calls=[]
 const pkg=createPackage('参考版式');pkg.theme.accent='#235740'
 f.worker.runLayoutReference=async input=>{calls.push(input);return {response:JSON.stringify({reply:'已生成墨绿版式。',package:pkg})}}
 const body={requestId:'chat-first',name:'参考版式',text:'根据上传参考生成版式。',files:[{name:'参考.md',text:'白底、墨绿标题，留白充足。'}],allowModel:true}
 const first=await f.req('POST',path,body);assert.equal(first.statusCode,200,first.body);await f.app.waitForJobs()
 const conversationId=first.json().conversationId;assert(conversationId)
 let conversation=(await f.req('GET',path+'/'+conversationId)).json()
 assert.equal(conversation.turns.length,1);assert.equal(conversation.resource.version,1)
 assert.equal(conversation.resource.package.theme.accent,'#235740')
 const resourceId=conversation.resource.id
 assert.match(calls[0].prompt,/留白充足/)
 f.worker.runLayoutReference=async input=>{calls.push(input);return {response:JSON.stringify({reply:'标题已改为黑色。',package:{...pkg,theme:{...pkg.theme,accent:'#111111'}}})}}
 const second=await f.req('POST',path,{requestId:'chat-second',conversationId,resourceId,resourceVersion:1,text:'标题改成黑色。',allowModel:true})
 assert.equal(second.statusCode,200,second.body);await f.app.waitForJobs()
 conversation=(await f.req('GET',path+'/'+conversationId)).json()
 assert.equal(conversation.resource.id,resourceId);assert.equal(conversation.resource.version,2)
 assert.equal(conversation.resource.package.theme.accent,'#111111')
 assert.match(calls[1].prompt,/#235740/);assert.match(calls[1].prompt,/参考.md/)
 f.worker.runLayoutReference=async()=>({response:JSON.stringify({reply:'标题为黑色，正文为深灰色。'})})
 const discussion=await f.req('POST',path,{requestId:'chat-discuss',conversationId,text:'现在用了哪些颜色？',allowModel:true})
 assert.equal(discussion.statusCode,200,discussion.body);await f.app.waitForJobs()
 await f.restart();conversation=(await f.req('GET',path+'/'+conversationId)).json()
 assert.equal(conversation.turns.length,3);assert.equal(conversation.turns[2].result.reply,'标题为黑色，正文为深灰色。')
 assert.equal(conversation.resource.version,2)
 assert.equal((await f.req('GET',path)).json().conversations.length,1)
 assert.equal((await f.req('GET',path+'/'+conversationId,undefined,1)).statusCode,404)
 assert.equal((await f.req('POST',path,{requestId:'cross',conversationId,text:'修改',allowModel:true},1)).statusCode,404)
 assert.equal((await f.req('POST',path,body)).json().id,first.json().id)
 assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM projects')).rows[0].n),0)
})

test('对话生成期间手动保存新版本时，旧回答不能覆盖新样式',{skip:!enabled,timeout:60000},async t=>{
 const f=await fixture(t),pkg=createPackage('并发版式')
 const resource=(await f.req('POST','/api/layout-library',{requestId:'resource',package:pkg})).json()
 const ready=Promise.withResolvers(),release=Promise.withResolvers()
 f.worker.runLayoutReference=async()=>{ready.resolve();await release.promise;return {response:JSON.stringify({reply:'改为绿色。',package:{...pkg,theme:{...pkg.theme,accent:'#235740'}}})}}
 const started=await f.req('POST','/api/layout-library/conversations',{requestId:'edit',resourceId:resource.id,resourceVersion:1,text:'改绿色',allowModel:true})
 assert.equal(started.statusCode,200,started.body);await ready.promise
 const manual=await f.req('POST','/api/layout-library/'+resource.id+'/revisions',{requestId:'manual',expectedVersion:1,package:{...pkg,theme:{...pkg.theme,accent:'#111111'}}})
 assert.equal(manual.statusCode,200)
 release.resolve();await f.app.waitForJobs()
 const current=(await f.req('GET','/api/layout-library/'+resource.id+'/2')).json()
 assert.equal(current.package.theme.accent,'#111111')
 const conversation=(await f.req('GET','/api/layout-library/conversations/'+started.json().conversationId)).json()
 assert.equal(conversation.turns[0].status,'failed')
 assert.equal(conversation.resource.version,2)
 assert.equal((await f.db.query('SELECT count(*)::int AS n FROM layout_library_versions WHERE resource_id=$1',[resource.id])).rows[0].n,2)
})

test('页脚本局部修订后保留同页版式配置及历史版本',{skip:!enabled,timeout:60000},async t=>{
 const f=await fixture(t),p=await f.req('POST','/api/projects',{requestId:'carry-project',name:'绑定继承'})
 const id=p.json().id,base='/api/projects/'+id,post=(path,b)=>f.req('POST',base+path,{requestId:randomUUID(),baseRevision:0,...b})
 const uploaded=await post('/materials',{filename:'任务书.txt',content:Buffer.from('任务书提供项目所在地。').toString('base64')})
 await confirmedOutlineFixture(f.db,id);const outline=draft(uploaded.json().id);outline.questions=[]
 await f.db.query('UPDATE outline_versions SET draft=$2,flow=$3 WHERE project_id=$1',[id,outline,JSON.stringify(['01'])])
 await post('/workflow/draft',{outlineVersion:1});await f.app.waitForJobs()
 const old=(await f.req('GET',base+'/state')).json().workflow.current
 const bound=await post('/layout-bindings',{draftId:old.id,expectedRevision:0,scope:'global',resource:null,overrides:{theme:{accent:'#235740'}}})
 assert.equal(bound.statusCode,200,bound.body)
 const block=old.blocks[0]
 f.worker.run=async()=>({response:JSON.stringify({blocks:[{id:block.id,heading:block.title,sectionText:'项目区位以本轮任务书记载为依据。',sectionEvidenceIndexes:[0],items:block.items,internalNotes:[]}]})})
 const revised=await post('/workflow/draft',{outlineVersion:1,baseDraftId:old.id,blockId:block.id,text:'调整这一节表达。'});assert.equal(revised.statusCode,200)
 await f.app.waitForJobs()
 const now=(await f.req('GET',base+'/state')).json(),config=(await f.req('GET',base+'/layout-bindings')).json()
 assert.equal(now.workflow.current.version,2);assert.equal(config.draftId,now.workflow.current.id)
 assert.equal(config.globalOverrides.theme.accent,'#235740');assert.equal(config.revision,2)
 assert.equal((await f.db.query('SELECT count(*)::int AS n FROM layout_binding_versions WHERE project_id=$1',[id])).rows[0].n,2)
 assert.equal(now.workflow.visuals.current,null)
})
