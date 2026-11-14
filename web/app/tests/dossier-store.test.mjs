import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTestDb,createBaseTables} from './support/dossier-db.mjs';
import {createDossierStore} from '../src/dossier/store.mjs';
import {validateCandidate} from '../src/dossier/contract.mjs';
test('历史DWG和压缩包留在来源清单，默认整理只选可用输入，显式复核原件不会入队',async t=>{
 const f=await fixture(t);
 const ids={};
 for(const [i,name] of ['原图.DWG','资料.RAR','原图.pdf'].entries()){
  const id=randomUUID();ids[name]='material:'+id;
  await f.db.query('INSERT INTO materials(id,project_id,filename,path,sha256,bytes) VALUES($1,$2,$3,$4,$5,$6)',[id,f.p.id,name,f.p.workspace+'/原始资料/'+id+'/'+name,String(i+1).repeat(64),100]);
 }
 await f.store.addInteraction(f.p,{requestId:randomUUID(),intent:'requirement',text:'使用本轮可读资料'},'tester');
 const current=await f.store.current(f.p);
 assert.match(current.inventory.find(s=>s.sourceId===ids['原图.DWG']).preparation?.message??'',/DWG.*PDF/);
 assert.match(current.inventory.find(s=>s.sourceId===ids['资料.RAR']).preparation?.message??'',/解压/);
 const prepared=await f.store.prepare(f.p,{expectedDossierRevision:0});
 assert.deepEqual(prepared.dossierSourceIds,current.pendingSources.map(s=>s.sourceId));
 assert.equal(prepared.dossierSourceIds.length,3);
 assert.ok(prepared.dossierSourceIds.includes(ids['原图.pdf']));
 for(const name of ['原图.DWG','资料.RAR'])await assert.rejects(f.store.prepare(f.p,{expectedDossierRevision:0,sourceIds:[ids[name]]}),e=>e.statusCode===415);
 const original=await f.store.source(f.p,ids['资料.RAR']);assert.equal(original.name,'资料.RAR');
});

test('含受限原件的旧空结果批次把原话列回待复核，一次独立复核后即退出',async t=>{
 const f=await fixture(t),state=await publishUser(f);
 const materialId=randomUUID(),materialSource='material:'+materialId;
 await f.db.query('INSERT INTO materials(id,project_id,filename,path,sha256,bytes) VALUES($1,$2,$3,$4,$5,$6)',[materialId,f.p.id,'测绘.rar',f.p.workspace+'/原始资料/测绘.rar','a'.repeat(64),12]);
 const note=await f.store.addInteraction(f.p,{requestId:randomUUID(),text:'待核对的项目要求',intent:'requirement'},'tester');
 // Reproduce an older version that captured the text but published zero records
 // after a batch containing the now-excluded archive.
 const oldJob={id:randomUUID(),payload:{...(await f.store.prepare(f.p,{expectedDossierRevision:state.snapshot.revision})),dossierSourceIds:[materialSource,note.sourceId]}};
 await f.db.query('INSERT INTO jobs(id,project_id,kind,payload,status) VALUES($1,$2,$3,$4,$5)',[oldJob.id,f.p.id,'dossier',oldJob.payload,'running']);
 const sourceList=[await f.store.source(f.p,materialSource),await f.store.source(f.p,note.sourceId)];
 const prior=await f.store.publish(f.p,oldJob,{records:[],limitations:['旧批次未处理原话']},sourceList,[]);
 let current=await f.store.current(f.p);
 assert.deepEqual(current.pendingSources.map(s=>s.sourceId),[note.sourceId]);
 assert.equal(current.inventory.find(s=>s.sourceId===note.sourceId).reviewPreviousBatch,true);
 const next={id:randomUUID(),payload:await f.store.prepare(f.p,{expectedDossierRevision:prior.revision})};
 assert.deepEqual(next.payload.dossierSourceIds,[note.sourceId]);
 await f.db.query('INSERT INTO jobs(id,project_id,kind,payload,status) VALUES($1,$2,$3,$4,$5)',[next.id,f.p.id,'dossier',next.payload,'running']);
 const context=await f.store.inputsForJob(f.p,next);
 // A clean text-only review can legitimately decide there is no new fact.
 const saved=await f.store.publish(f.p,next,{records:[],limitations:[]},context.sources,[]);
 current=await f.store.current(f.p);
 assert.equal(current.pendingSources.length,0);
 assert.deepEqual((await f.store.version(f.p,prior.revision)).snapshotHash,prior.snapshotHash);
 assert.equal(saved.previousHash,prior.snapshotHash);
});
async function fixture(t){const env=await createTestDb();t.after(env.close);await createBaseTables(env.db);const p={id:randomUUID(),name:'隔离总档测试项目',workspace:'/isolated/project'},other={id:randomUUID(),workspace:'/isolated/other'};await env.db.query('INSERT INTO projects(id,name,metadata) VALUES($1,$2,$3)',[p.id,p.name,{}]);await env.db.query('INSERT INTO projects(id,name,metadata) VALUES($1,$2,$3)',[other.id,'另一个项目',{}]);const store=await createDossierStore(env.db);return {...env,p,other,store};}
async function publishUser(f,text='服务对象为周边居民。',field='audience'){
 await f.store.addInteraction(f.p,{requestId:randomUUID(),text,intent:'requirement'},'tester');const before=await f.store.current(f.p);
 const prepared=await f.store.prepare(f.p,{expectedDossierRevision:before.revision,inputHash:before.inputHash});const job={id:randomUUID(),payload:prepared};
 await f.db.query('INSERT INTO jobs(id,project_id,kind,payload,status) VALUES($1,$2,$3,$4,$5)',[job.id,f.p.id,'dossier',job.payload,'running']);
 const context=await f.store.inputsForJob(f.p,job),src=context.sources.find(s=>s.text===text);
 const raw={entityKey:'project',entityLabel:'本项目',field,label:field,scope:'project',valueText:text,informationClass:'user_requirement',chapters:['04'],evidence:{sourceId:src.sourceId,quote:text,startLine:1,endLine:1}};
 const candidate=validateCandidate(JSON.stringify({records:[raw]}),{projectId:f.p.id,sources:context.sources,reads:[]});
 return {snapshot:await f.store.publish(f.p,job,candidate,context.sources,[]),job};
}
test('R5真实持久化适配：保存后重新加载同一版本',async t=>{const f=await fixture(t);const {snapshot}=await publishUser(f);if(f.reopen)f.reopen();const reopened=await createDossierStore(f.db),current=await reopened.current(f.p);assert.equal(current.revision,1);assert.equal(current.snapshot.snapshotHash,snapshot.snapshotHash);assert.equal(current.jobs[0].status,'completed');assert.equal(current.hasUnmergedInputs,false);});
test('更正幂等，旧版本可回读且旧任务失效',async t=>{const f=await fixture(t),{snapshot}=await publishUser(f);const task=await f.store.captureTask(f.p,{requestId:randomUUID(),expectedDossierRevision:1,query:{fields:['audience']}});const b={requestId:randomUUID(),expectedDossierRevision:1,recordId:snapshot.records[0].recordId,valueText:'服务对象为老人。',reason:'明确更正'};const a=await f.store.correct(f.p,b,'tester');assert.deepEqual(await f.store.correct(f.p,b,'tester'),a);assert.equal((await f.store.version(f.p,1)).records[0].status,'active');assert.equal((await f.store.current(f.p)).snapshot.records[0].status,'superseded');assert.equal((await f.store.task(f.p,task.taskId)).status,'stale');await assert.rejects(f.store.assertTaskCurrent(f.p,task.taskId),{code:'DOSSIER_TASK_STALE'});});
test('跨项目取版本、任务和来源都被拒绝',async t=>{const f=await fixture(t),{snapshot}=await publishUser(f);const task=await f.store.captureTask(f.p,{requestId:randomUUID(),expectedDossierRevision:1,query:{all:true}});await assert.rejects(f.store.version(f.other,1),{code:'DOSSIER_NOT_FOUND'});await assert.rejects(f.store.task(f.other,task.taskId),{code:'DOSSIER_TASK'});await assert.rejects(f.store.source(f.other,snapshot.records[0].evidence.sourceId),{code:'DOSSIER_SOURCE'});});
test('请求ID重用不同内容拒绝',async t=>{const f=await fixture(t),b={requestId:randomUUID(),text:'原要求',intent:'requirement'};await f.store.addInteraction(f.p,b,'tester');await assert.rejects(f.store.addInteraction(f.p,{...b,text:'不同要求'},'tester'),{code:'DOSSIER_REQUEST_CONFLICT'});});
test('更正期间另有新输入时不得声称全部已归并',async t=>{const f=await fixture(t),{snapshot}=await publishUser(f);await f.store.addInteraction(f.p,{requestId:randomUUID(),text:'还有一条未归并要求',intent:'requirement'},'tester');await f.store.correct(f.p,{requestId:randomUUID(),expectedDossierRevision:1,recordId:snapshot.records[0].recordId,valueText:'修改服务人群',reason:'更正'},'tester');assert.equal((await f.store.current(f.p)).hasUnmergedInputs,true);});
test('过期修订拒绝且不产生新版本',async t=>{const f=await fixture(t),{snapshot}=await publishUser(f);await assert.rejects(f.store.correct(f.p,{requestId:randomUUID(),expectedDossierRevision:0,recordId:snapshot.records[0].recordId,valueText:'changed',reason:'更正'},'tester'),{code:'DOSSIER_STALE'});assert.equal((await f.store.current(f.p)).revision,1);});
test('发布时输入改变，候选不能覆盖',async t=>{const f=await fixture(t);await f.store.addInteraction(f.p,{requestId:randomUUID(),text:'原要求',intent:'requirement'},'tester');const prepared=await f.store.prepare(f.p,{expectedDossierRevision:0});const job={id:randomUUID(),payload:prepared};await f.db.query('INSERT INTO jobs(id,project_id,kind,payload,status) VALUES($1,$2,$3,$4,$5)',[job.id,f.p.id,'dossier',job.payload,'running']);const context=await f.store.inputsForJob(f.p,job);await f.store.addInteraction(f.p,{requestId:randomUUID(),text:'新增要求',intent:'requirement'},'tester');await assert.rejects(f.store.publish(f.p,job,{records:[],limitations:[]},context.sources,[]),{code:'DOSSIER_STALE'});assert.equal((await f.store.current(f.p)).revision,0);});
test('取消后不能发布或抬高任务为完成',async t=>{const f=await fixture(t),prepared=await f.store.prepare(f.p,{expectedDossierRevision:0}),job={id:randomUUID(),payload:prepared};await f.db.query('INSERT INTO jobs(id,project_id,kind,payload,status) VALUES($1,$2,$3,$4,$5)',[job.id,f.p.id,'dossier',job.payload,'cancelling']);const context=await f.store.inputsForJob(f.p,job);await assert.rejects(f.store.publish(f.p,job,{records:[],limitations:[]},context.sources,[]),{code:'DOSSIER_CANCELLED'});assert.equal((await f.store.current(f.p)).revision,0);});
test('普通聊天、章节问答、修订要求和批注都进入输入集合',async t=>{const f=await fixture(t);for(const kind of ['chat','outline','workflow'])await f.db.query('INSERT INTO jobs(id,project_id,kind,payload,status) VALUES($1,$2,$3,$4,$5)',[randomUUID(),f.p.id,kind,{text:kind+'原话'},'completed']);await f.db.query('INSERT INTO annotations(id,project_id,text,anchor,status,reference) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),f.p.id,'批注原话','PS01','pending',{}]);const current=await f.store.current(f.p);assert.equal(current.inventory.filter(s=>s.kind==='conversation').length,3);assert.equal(current.inventory.filter(s=>s.kind==='annotation').length,1);});
test('空查询成员新增后任务失效，无关字段任务保持可复用',async t=>{const f=await fixture(t);await publishUser(f);const empty=await f.store.captureTask(f.p,{requestId:randomUUID(),expectedDossierRevision:1,query:{fields:['public_service']}}),old=await f.store.captureTask(f.p,{requestId:randomUUID(),expectedDossierRevision:1,query:{fields:['audience']}});await publishUser(f,'需要补充养老服务。','public_service');assert.equal((await f.store.task(f.p,empty.taskId)).status,'stale');assert.equal((await f.store.task(f.p,old.taskId)).status,'current');});
test('未知图片不会通过资料归档而变为现场结论',async t=>{const f=await fixture(t);await f.db.query('INSERT INTO materials(id,project_id,filename,path,sha256,bytes) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),f.p.id,'a.png','/isolated/project/原始资料/1/a.png','1'.repeat(64),30]);const current=await f.store.current(f.p);assert.equal(current.inventory.find(s=>s.kind==='material').kind,'material');assert.equal(current.snapshot,null);});
test('没有总档时兼容已有任务；有新输入时正式阶段稿须由协调器阻断',async t=>{const f=await fixture(t);assert.equal(await f.store.freezeForJob(f.p,{id:randomUUID(),kind:'workflow',payload:{}}),null);await publishUser(f);await f.store.addInteraction(f.p,{requestId:randomUUID(),text:'新要求',intent:'requirement'},'tester');const context=await f.store.freezeForJob(f.p,{id:randomUUID(),kind:'workflow',payload:{}});assert.equal(context.available,false);assert.equal(context.state,'pending_inputs');});
test('用户原话改版后仍能按来源哈希回查当时完整原话',async t=>{const f=await fixture(t),{snapshot}=await publishUser(f);const r=snapshot.records[0];await f.db.query('UPDATE pd_dossier_interactions SET text=$1 WHERE project_id=$2',['新原话，仅用于测试历史定位',f.p.id]);const src=await f.store.source(f.p,r.evidence.sourceId,r.evidence.sourceHash);assert.equal(src.text,'服务对象为周边居民。');assert.equal(src.sha256,r.evidence.sourceHash);});
