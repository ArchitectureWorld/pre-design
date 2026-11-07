/** PostgreSQL adapter. All new tables are additive. Sources remain in existing materials/jobs. */
import {randomUUID} from 'node:crypto';
import {relative,isAbsolute} from 'node:path';
import {DOSSIER_VERSION,clone,digest,requireThat,problem,inputFingerprint,nextSnapshot,selectRecords,assessTask,validateCandidate,sourceCoverage,validateQuery,markdown} from './contract.mjs';
const rows=async(c,sql,args=[])=>(await c.query(sql,args)).rows;
export const MIGRATION=`
CREATE TABLE IF NOT EXISTS pd_dossier_sources(
 project_id uuid NOT NULL REFERENCES projects(id),source_id text NOT NULL,source_hash text NOT NULL,
 payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,source_id,source_hash));
CREATE TABLE IF NOT EXISTS pd_dossier_interactions(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),request_id text NOT NULL,
 fingerprint text NOT NULL,text text NOT NULL,intent text NOT NULL,actor_id text NOT NULL,
 target_record_id text,reason text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,request_id));
CREATE TABLE IF NOT EXISTS pd_dossier_versions(
 project_id uuid NOT NULL REFERENCES projects(id),revision integer NOT NULL,job_id uuid,
 input_hash text NOT NULL,snapshot_hash text NOT NULL,payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,revision),UNIQUE(project_id,job_id));
CREATE TABLE IF NOT EXISTS pd_dossier_requests(
 project_id uuid NOT NULL REFERENCES projects(id),request_id text NOT NULL,fingerprint text NOT NULL,
 response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,request_id));
CREATE TABLE IF NOT EXISTS pd_dossier_tasks(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),request_id text NOT NULL,
 fingerprint text NOT NULL,job_id uuid,query jsonb NOT NULL,payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,request_id),UNIQUE(project_id,job_id));
CREATE TABLE IF NOT EXISTS pd_dossier_audits(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),job_id uuid,
 kind text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS pd_dossier_version_latest ON pd_dossier_versions(project_id,revision DESC);
CREATE INDEX IF NOT EXISTS pd_dossier_task_project ON pd_dossier_tasks(project_id,created_at DESC);
`;
const utc=v=>v instanceof Date?v.toISOString():String(v);
function source(sourceId,kind,name,text,extra={}){return {sourceId,kind,name,text,sha256:digest(text),...extra};}
export async function readInputs(c,p){
 const [project]=await rows(c,'SELECT name,metadata FROM projects WHERE id=$1',[p.id]);
 requireThat(project,'PROJECT','项目不存在',404);
 const materials=await rows(c,'SELECT id,filename,path,sha256,bytes,image,relative_path FROM materials WHERE project_id=$1 ORDER BY id',[p.id]);
 const interactions=await rows(c,'SELECT * FROM pd_dossier_interactions WHERE project_id=$1 ORDER BY created_at,id',[p.id]);
 const history=await rows(c,"SELECT id,kind,payload,created_at FROM jobs WHERE project_id=$1 AND kind IN ('chat','outline','workflow') ORDER BY created_at,id",[p.id]);
 const notes=await rows(c,"SELECT id,text,anchor,status,created_at,reference FROM annotations WHERE project_id=$1 AND status <> 'deleted' ORDER BY created_at,id",[p.id]);
 const metadataText=JSON.stringify({name:project.name,...project.metadata},null,2);
 const sources=[source(`metadata:${p.id}`,'metadata','创建项目时的用户填写',metadataText,{intent:'statement'})];
 for(const m of materials){
  const path=relative(p.workspace,m.path).replaceAll('\\','/');
  requireThat(path&&!isAbsolute(path)&&!path.startsWith('../')&&path.startsWith('原始资料/'),'PATH','材料路径不在当前项目内');
  sources.push({sourceId:`material:${m.id}`,kind:'material',name:m.relative_path??m.filename,path,materialId:m.id,sha256:m.sha256,bytes:m.bytes,image:m.image??null});
 }
 for(const x of interactions)sources.push(source(`interaction:${x.id}`,'interaction','用户补充信息',x.text,{intent:x.intent,actorId:x.actor_id,createdAt:utc(x.created_at),...(x.target_record_id?{correctionTarget:x.target_record_id}:{})}));
 for(const x of history)if(typeof x.payload?.text==='string'&&x.payload.text.trim())sources.push(source(`job:${x.id}`,'conversation',x.kind==='workflow'?'稿件修改要求':x.kind==='outline'?'章节问答':'项目对话',x.payload.text,{intent:x.kind==='workflow'?'requirement':'statement',jobId:x.id,createdAt:utc(x.created_at)}));
 for(const x of notes)sources.push(source(`annotation:${x.id}`,'annotation','用户批注',x.text,{intent:'requirement',anchor:x.anchor,createdAt:utc(x.created_at)}));
 requireThat(sources.length<=5000,'SOURCE_LIMIT','来源超过单项目本批上限5000条，请先分拆项目');
 const inputs={projectId:p.id,metadata:project.metadata??{},sources};inputs.inputHash=inputFingerprint(inputs);return inputs;
}
function taskInputHash(inputs,snapshot,jobId){
 if(!jobId||inputs.inputHash===snapshot?.inputHash)return inputs.inputHash;
 const withoutOwn={...inputs,sources:inputs.sources.filter(s=>s.sourceId!==`job:${jobId}`)};
 const previousHash=inputFingerprint(withoutOwn);
 return previousHash===snapshot?.inputHash?previousHash:inputs.inputHash;
}
async function head(c,pid){const [row]=await rows(c,'SELECT payload FROM pd_dossier_versions WHERE project_id=$1 ORDER BY revision DESC LIMIT 1',[pid]);return row?.payload??null;}
async function archiveSources(c,pid,sources){for(const s of sources)await c.query('INSERT INTO pd_dossier_sources(project_id,source_id,source_hash,payload) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,source_id,source_hash) DO NOTHING',[pid,s.sourceId,s.sha256,s]);}
async function saveVersion(c,s){await c.query('INSERT INTO pd_dossier_versions(project_id,revision,job_id,input_hash,snapshot_hash,payload) VALUES($1,$2,$3,$4,$5,$6)',[s.projectId,s.revision,s.jobId,s.inputHash,s.snapshotHash,s]);}
export async function lockDossier(c,pid){await c.query("SELECT pg_advisory_xact_lock(hashtext(current_database() || ':' || current_schema() || ':dossier:' || $1))",[pid]);}
function pending(inputs,snapshot){const done=new Map((snapshot?.coverage??[]).map(c=>[c.sourceId,c]));return inputs.sources.filter(s=>{const v=done.get(s.sourceId);return !v||v.sourceHash!==s.sha256||v.state==='not_read';});}
export async function createDossierStore(db){
 await db.query(MIGRATION);
 async function transaction(p,fn){const c=await db.connect();try{await c.query('BEGIN');await lockDossier(c,p.id);const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async function request(p,requestId,body,fn){return transaction(p,async c=>{
  const fingerprint=digest(body),[old]=await rows(c,'SELECT * FROM pd_dossier_requests WHERE project_id=$1 AND request_id=$2',[p.id,requestId]);
  if(old){requireThat(old.fingerprint===fingerprint,'REQUEST_CONFLICT','请求编号已用于不同内容');return old.response;}
  const response=await fn(c);await c.query('INSERT INTO pd_dossier_requests(project_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4)',[p.id,requestId,fingerprint,response]);return response;
 });}
 const store={
  transaction,lock:lockDossier,
  async current(p){
   return transaction(p,async c=>{
    const snapshot=await head(c,p.id),inputs=await readInputs(c,p);
    const versions=await rows(c,'SELECT revision,job_id,snapshot_hash,created_at FROM pd_dossier_versions WHERE project_id=$1 ORDER BY revision DESC LIMIT 100',[p.id]);
    const tasks=await rows(c,'SELECT * FROM pd_dossier_tasks WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100',[p.id]);
    const jobs=await rows(c,"SELECT id,status,result,error,progress,created_at,started_at,finished_at FROM jobs WHERE project_id=$1 AND kind='dossier' ORDER BY created_at DESC LIMIT 20",[p.id]);
    return {schemaVersion:DOSSIER_VERSION,snapshot,revision:snapshot?.revision??0,inputHash:inputs.inputHash,hasUnmergedInputs:inputs.inputHash!==(snapshot?.inputHash??null),pendingSources:pending(inputs,snapshot).map(({text,...s})=>s),inventory:inputs.sources.map(({text,...s})=>s),versions,jobs,tasks:tasks.map(t=>({id:t.id,jobId:t.job_id,createdAt:t.created_at,query:t.query,dossierRevision:t.payload.dossierRevision,...assessTask(t,snapshot,taskInputHash(inputs,snapshot,t.job_id))})),limits:{maxBatchSources:12,maxCandidateRecords:160},deployment:{kind:'web-dsh-dossier-r5',modelAdapter:'existing ProjectWorkers.run',allSkillsImplemented:false}};
   });
  },
  async version(p,revision){const [v]=await rows(db,'SELECT payload FROM pd_dossier_versions WHERE project_id=$1 AND revision=$2',[p.id,revision]);requireThat(v,'NOT_FOUND','总档版本不存在',404);return v.payload;},
  async recovered(p,jobId){const [v]=await rows(db,'SELECT payload FROM pd_dossier_versions WHERE project_id=$1 AND job_id=$2',[p.id,jobId]);return v?.payload??null;},
  async addInteraction(p,body,actor){return request(p,body.requestId,body,async c=>{
   const interactionId=randomUUID();
   await c.query('INSERT INTO pd_dossier_interactions(id,project_id,request_id,fingerprint,text,intent,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[interactionId,p.id,body.requestId,digest(body),body.text,body.intent,actor]);
   return {interactionId,sourceId:`interaction:${interactionId}`,state:'recorded_pending_extraction'};
  });},
  async prepare(p,body){return transaction(p,async c=>{
   const previous=await head(c,p.id),inputs=await readInputs(c,p);
   requireThat(body.expectedDossierRevision===(previous?.revision??0),'STALE','总档已更新，请刷新再整理');
   if(body.inputHash)requireThat(body.inputHash===inputs.inputHash,'INPUT_CHANGED','资料或对话已有变化，请刷新再整理');
   const requested=body.sourceIds?.length?inputs.sources.filter(s=>body.sourceIds.includes(s.sourceId)):pending(inputs,previous);
   if(body.sourceIds?.length)requireThat(requested.length===body.sourceIds.length,'SOURCE','所选来源不属于当前项目');
   requireThat(requested.length,'NO_PENDING','没有待整理输入；复核某份原件时请指定来源');
   const selected=[];let textBytes=0;
   for(const s of requested){if(selected.length>=12)break;const n=Buffer.byteLength(s.text??'');if(textBytes+n>64000&&selected.length)break;requireThat(n<=64000,'INPUT_SIZE','单条交互太长，请拆分');selected.push(s);textBytes+=n;}
   return {dossierBaseRevision:previous?.revision??0,dossierInputHash:inputs.inputHash,dossierSourceIds:selected.map(s=>s.sourceId),skillVersion:'dossier-intake-r5.1',remainingSources:requested.length-selected.length};
  });},
  async inputsForJob(p,job){return transaction(p,async c=>{
   const previous=await head(c,p.id),inputs=await readInputs(c,p);
   requireThat(inputs.inputHash===job.payload.dossierInputHash&&(previous?.revision??0)===job.payload.dossierBaseRevision,'STALE','排队后资料或总档已改变，未调用模型，请刷新重试');
   const sources=inputs.sources.filter(s=>job.payload.dossierSourceIds.includes(s.sourceId));
   requireThat(sources.length===job.payload.dossierSourceIds.length,'SOURCE','冻结来源集合已改变');return {previous,inputs,sources};
  });},
  async publish(p,job,candidate,selectedSources,reads){return transaction(p,async c=>{
   const [jobState]=await rows(c,'SELECT status FROM jobs WHERE id=$1 AND project_id=$2 FOR UPDATE',[job.id,p.id]);
   requireThat(jobState?.status==='running','CANCELLED','任务已取消或不在运行，不能发布总档');
   const [prior]=await rows(c,'SELECT payload FROM pd_dossier_versions WHERE project_id=$1 AND job_id=$2',[p.id,job.id]);if(prior)return prior.payload;
   const previous=await head(c,p.id),inputs=await readInputs(c,p);
   requireThat(inputs.inputHash===job.payload.dossierInputHash&&(previous?.revision??0)===job.payload.dossierBaseRevision,'STALE','整理期间输入已改变，候选未覆盖当前总档');
   const coverage=sourceCoverage(selectedSources,reads,candidate.records);
   const snapshot=nextSnapshot(previous,{projectId:p.id,inputHash:inputs.inputHash,sources:inputs.sources,records:candidate.records,coverage,limitations:candidate.limitations,jobId:job.id,authoritativeSources:true});
   await archiveSources(c,p.id,inputs.sources);await saveVersion(c,snapshot);
   await c.query('INSERT INTO pd_dossier_audits(id,project_id,job_id,kind,payload) VALUES($1,$2,$3,$4,$5)',[randomUUID(),p.id,job.id,'candidate_published',{skillVersion:job.payload.skillVersion,sourceIds:selectedSources.map(s=>s.sourceId),readReceipts:reads,candidateRecordCount:candidate.records.length,snapshotHash:snapshot.snapshotHash}]);
   // Publication and job acceptance share the same transaction. A cancellation cannot slip between them.
   const limited=candidate.records.length===0||coverage.some(x=>['not_read','needs_ocr','metadata_only'].includes(x.state))||pending(inputs,snapshot).length>0;
   const result={response:`项目总档 V${snapshot.revision} 已保存；新增${snapshot.delta.length}条变化，${snapshot.conflicts.length}组待核差异。`,dossierRevision:snapshot.revision,snapshotHash:snapshot.snapshotHash,unreadSources:pending(inputs,snapshot).length,status:limited?'partial':'completed',professionalApproval:false};
   await c.query("UPDATE jobs SET status=$3,result=$4,finished_at=now(),progress=$5 WHERE id=$1 AND project_id=$2",[job.id,p.id,result.status,result,{stage:result.status,label:limited?'总档已更新，仍有读取限制':'总档已更新',updatedAt:new Date().toISOString()}]);
   return snapshot;
  });},
  async reject(p,job,error){await db.query('INSERT INTO pd_dossier_audits(id,project_id,job_id,kind,payload) VALUES($1,$2,$3,$4,$5)',[randomUUID(),p.id,job.id,'candidate_rejected',{code:error.code??'DOSSIER_ERROR',message:error.code?.startsWith('DOSSIER_')?error.message:'模型或工具执行失败',currentUnchanged:true}]);},
  async correct(p,body,actor){return request(p,body.requestId,body,async c=>{
   const previous=await head(c,p.id);requireThat(previous&&previous.revision===body.expectedDossierRevision,'STALE','总档已改变，请基于当前版本更正');
   const old=previous.records.find(r=>r.recordId===body.recordId&&r.status==='active');requireThat(old,'RECORD','目标记录不存在或已被替代');requireThat(old.valueText!==body.valueText,'NO_CHANGE','更正值与当前值相同');
   const interactionId=randomUUID();await c.query('INSERT INTO pd_dossier_interactions(id,project_id,request_id,fingerprint,text,intent,actor_id,target_record_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[interactionId,p.id,body.requestId,digest(body),body.valueText,'correction',actor,old.recordId,body.reason]);
   const inputs=await readInputs(c,p),src=inputs.sources.find(s=>s.sourceId===`interaction:${interactionId}`);
   const raw={entityKey:old.entityKey,entityLabel:old.entityLabel,field:old.field,label:old.label,scope:old.scope,valueText:body.valueText,informationClass:old.informationClass==='document_statement'?'user_statement':old.informationClass==='user_decision'?'user_statement':old.informationClass,chapters:old.chapters,evidence:{sourceId:src.sourceId,quote:body.valueText,startLine:1,endLine:body.valueText.replace(/\r\n/g,'\n').split('\n').length}};
   const candidate=validateCandidate(JSON.stringify({records:[raw]}),{projectId:p.id,sources:[src]});
   const snapshot=nextSnapshot(previous,{projectId:p.id,inputHash:previous.inputHash,sources:inputs.sources,records:candidate.records,coverage:sourceCoverage([src],[],candidate.records),correction:{oldId:old.recordId,newId:candidate.records[0].recordId,reason:body.reason},limitations:['用户更正作为用户陈述保留，不代表官方材料已被修改。'],authoritativeSources:true});
   // Only this explicit correction is merged. Other pending uploads/conversations must stay pending.
   const beforeInputs={...inputs,sources:inputs.sources.filter(s=>s.sourceId!==src.sourceId)};
   if(inputFingerprint(beforeInputs)===previous.inputHash){snapshot.inputHash=inputs.inputHash;delete snapshot.snapshotHash;snapshot.snapshotHash=digest(snapshot);}
   await archiveSources(c,p.id,inputs.sources);await saveVersion(c,snapshot);return {revision:snapshot.revision,snapshotHash:snapshot.snapshotHash,oldId:old.recordId,newId:candidate.records[0].recordId};
  });},
  async captureTask(p,body,jobId=null){return request(p,body.requestId,body,async c=>{
   const snapshot=await head(c,p.id),inputs=await readInputs(c,p);requireThat(snapshot,'NOT_READY','请先整理项目总档');
   requireThat(snapshot.revision===body.expectedDossierRevision,'STALE','总档版本已变化');requireThat(snapshot.inputHash===taskInputHash(inputs,snapshot,jobId),'PENDING_INPUTS','原始资料或对话有未归并变化，请先更新总档');
   const query=validateQuery(body.query),selected=selectRecords(snapshot,query),taskId=randomUUID();
   const payload={schemaVersion:'pre-design.dossier-task.web.v1',taskId,projectId:p.id,dossierRevision:snapshot.revision,snapshotHash:snapshot.snapshotHash,inputHash:snapshot.inputHash,query,...selected,pendingSources:pending(inputs,snapshot).map(({text,...s})=>s),coverage:snapshot.coverage,limitations:snapshot.limitations,taskInstructionSourceId:jobId?`job:${jobId}`:null,createdAt:new Date().toISOString()};
   await c.query('INSERT INTO pd_dossier_tasks(id,project_id,request_id,fingerprint,job_id,query,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[taskId,p.id,body.requestId,digest(body),jobId,query,payload]);return payload;
  });},
  async task(p,taskId){const [task]=await rows(db,'SELECT * FROM pd_dossier_tasks WHERE project_id=$1 AND id=$2',[p.id,taskId]);requireThat(task,'TASK','任务资料包不存在',404);return transaction(p,async c=>{const snapshot=await head(c,p.id),inputs=await readInputs(c,p);return {payload:task.payload,...assessTask(task,snapshot,taskInputHash(inputs,snapshot,task.job_id))};});},
  async assertTaskCurrent(p,taskId){const task=await store.task(p,taskId);requireThat(task.status==='current','TASK_STALE',task.reason);return task;},
  async source(p,sourceId,sourceHash){
   if(sourceHash){const [old]=await rows(db,'SELECT payload FROM pd_dossier_sources WHERE project_id=$1 AND source_id=$2 AND source_hash=$3',[p.id,sourceId,sourceHash]);if(old)return old.payload;}
   const inputs=await readInputs(db,p),src=inputs.sources.find(s=>s.sourceId===sourceId&&(!sourceHash||s.sha256===sourceHash));requireThat(src,'SOURCE','指定版本来源不存在',404);return src;
  },
  async freezeForJob(p,job){
   if(!['chat','outline','workflow'].includes(job.kind))return null;
   const current=await head(db,p.id);if(!current)return null;
   // This job's instruction is task-local, not an adopted fact; other new sources still block stale writes.
   const inputs=await readInputs(db,p);
   if(taskInputHash(inputs,current,job.id)!==current.inputHash)return {available:false,state:'pending_inputs',dossierRevision:current.revision,message:'总档存在未归并的新输入。仅可引用已归档内容的历史版本；本轮对话须先核实，不能宣称总档为最新。'};
   return store.captureTask(p,{requestId:`job-${job.id}`,expectedDossierRevision:current.revision,query:job.kind==='workflow'&&job.payload.blockId?{chapters:[job.payload.blockId.split('-')[1]]}:{all:true}},job.id);
  },
  async assertJobCurrent(p,context){if(context?.taskId)await store.assertTaskCurrent(p,context.taskId);},
  markdown,
 };
 return store;
}
