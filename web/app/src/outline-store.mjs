import {createHash} from 'node:crypto'
import {relative} from 'node:path'
import {assertOutlineExecutable,OUTLINE_CHAPTERS,outlineInputHash,assertOutlineConfirmable,parseOutline} from './outline-contract.mjs'
import {adjustChapters,bindSubmittedTasks,chooseTask,handoffPrompt,planningError,proposedPlan,validatePlanSubmission} from './outline-planning.mjs'
const questionKey=q=>JSON.stringify([q.id,q.prompt,q.reason,q.blocking,[...q.chapterIds].sort()])
const fail=message=>Object.assign(new Error(message),{statusCode:409,code:'OUTLINE_REQUIRED'})
const submittedFlow=state=>!!(state.flowReviewed||state.confirmedAt||state.planning?.submittedFlow)
export function nextOutlineFlow(state,draft,payload){
 if(payload.flow)return payload.flow
 if(state.flow.length&&(submittedFlow(state)||!['recommend','fromDiscussion'].includes(payload.planningMode)))return state.flow
 return draft.chapters.filter(c=>c.disposition==='include').map(c=>c.id)
}
export async function createOutlineStore(db){
 const query=async(sql,params=[])=>(await db.query(sql,params)).rows
 await query(`CREATE TABLE IF NOT EXISTS outline_versions(project_id uuid REFERENCES projects(id),version integer NOT NULL,input_hash text NOT NULL,job_id uuid UNIQUE REFERENCES jobs(id),draft jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),confirmed_at timestamptz,confirmed_by text,PRIMARY KEY(project_id,version));
 CREATE TABLE IF NOT EXISTS outline_confirmations(project_id uuid REFERENCES projects(id),request_id text NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(project_id,request_id));
 ALTER TABLE outline_versions ADD COLUMN IF NOT EXISTS read_receipts jsonb NOT NULL DEFAULT '[]';
 ALTER TABLE outline_versions ADD COLUMN IF NOT EXISTS flow jsonb;
 ALTER TABLE outline_versions ADD COLUMN IF NOT EXISTS retained_waivers jsonb NOT NULL DEFAULT '[]';
 ALTER TABLE outline_versions ADD COLUMN IF NOT EXISTS flow_reviewed boolean NOT NULL DEFAULT false;
 ALTER TABLE outline_versions ADD COLUMN IF NOT EXISTS planning jsonb;
 CREATE TABLE IF NOT EXISTS outline_task_choices(project_id uuid REFERENCES projects(id),request_id text NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,user_id text NOT NULL,created_at timestamptz DEFAULT now(),PRIMARY KEY(project_id,request_id));
 CREATE TABLE IF NOT EXISTS outline_question_decisions(project_id uuid REFERENCES projects(id),version integer NOT NULL,question_id text NOT NULL,request_id text NOT NULL,fingerprint text NOT NULL,action text NOT NULL,reason text NOT NULL,prompt text NOT NULL,chapter_ids jsonb NOT NULL,user_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,request_id));`)
 const materials=(id,read=query)=>read('SELECT id,filename,relative_path,sha256,bytes,image FROM materials WHERE project_id=$1 ORDER BY id',[id])
 async function current(p,read=query){
  const [fresh]=await read('SELECT name,metadata FROM projects WHERE id=$1',[p.id])
  const files=await materials(p.id,read),hash=outlineInputHash(fresh,files)
  const [row]=await read('SELECT * FROM outline_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[p.id])
  const [lastJob]=await read("SELECT id,status FROM jobs WHERE project_id=$1 AND kind='outline' ORDER BY created_at DESC,id DESC LIMIT 1",[p.id])
  const busy=!!(await read("SELECT id FROM jobs WHERE project_id=$1 AND status IN ('queued','running','cancelling') LIMIT 1",[p.id])).length
  const dossier=row?.planning?await dossierHead(p.id,read):null
  const sourceChanged=row?.planning&&(dossier?.hash??null)!==(row.planning.dossier?.hash??null)
  const stale=row&&(row.input_hash!==hash||sourceChanged||(lastJob&&lastJob.id!==row.job_id))
  const decisions=row?await read('SELECT DISTINCT ON(question_id) * FROM outline_question_decisions WHERE project_id=$1 AND version=$2 ORDER BY question_id,created_at DESC,request_id DESC',[p.id,row.version]):[]
  const waivers=decisions.filter(r=>r.action==='skip').map(r=>({questionId:r.question_id,prompt:r.prompt,reason:r.reason,chapterIds:r.chapter_ids,userId:r.user_id,createdAt:r.created_at,version:r.version}))
  const retainedWaivers=(row?.retained_waivers??[]).filter(w=>!decisions.some(d=>d.action==='reopen'&&d.question_id===w.questionId&&d.prompt===w.prompt)).filter(w=>!waivers.some(x=>x.questionId===w.questionId&&x.prompt===w.prompt&&x.reason===w.reason))
  return {retainedWaivers,flow:row?.flow??row?.draft.chapters.filter(c=>c.disposition==='include').map(c=>c.id)??[],flowReviewed:row?.flow_reviewed??false,waivers,version:row?.version??0,inputHash:row?.input_hash??hash,currentInputHash:hash,status:!row?'empty':stale?'stale':row.confirmed_at?'confirmed':'draft',draft:row?.draft??null,planning:row?.planning??null,planningInputsChanged:!!(row&&(sourceChanged||row.input_hash!==hash)),confirmedAt:row?.confirmed_at??null,confirmedBy:row?.confirmed_by??null,busy,catalog:OUTLINE_CHAPTERS,lastJob:lastJob??null}
 }
 async function requireConfirmed(p,kind,selection){const state=await current(p);if(state.status!=='confirmed')throw fail('请先完成资料梳理并确认最新章节流程，再开展后续研究。');if(kind)assertOutlineExecutable(state,kind,selection);return state}
 async function prepare(p,body){
  const state=await current(p)
  if(state.busy)throw fail('项目仍有任务处理中，请完成后再更新章节草案。')
  if(state.version!==body.outlineVersion)throw fail('章节版本已变化，请刷新后补充。')
  if(!(await materials(p.id)).length)throw fail('请先上传项目资料，再梳理章节。')
  return state
 }
 async function sourceReply(projectId,sourceJobId) {
  const [source]=await query(`SELECT j.id,j.finished_at,j.result->>'response' AS response,
    t.payload->>'dossierRevision' AS dossier_revision,t.payload->>'snapshotHash' AS dossier_hash,t.payload->'records' AS records
   FROM jobs j LEFT JOIN pd_dossier_tasks t ON t.project_id=j.project_id AND t.job_id=j.id
   WHERE j.project_id=$1 AND j.id=$2 AND j.kind='chat' AND j.status='completed'`,[projectId,sourceJobId])
  if(!source?.response?.trim())throw planningError('当前项目中没有可用的这条会话回复。',404)
  if(source.response.length>60000)throw planningError('这条会话超过可编排长度，请在项目讨论中先形成简要研判。',400)
  return source
 }
 async function dossierHead(projectId,read=query) {
  return (await read('SELECT revision,snapshot_hash AS hash FROM pd_dossier_versions WHERE project_id=$1 ORDER BY revision DESC LIMIT 1',[projectId]))[0]??null
 }
 async function preparePlanning(p,body,state) {
  const mode=body.planningMode
  if(!mode&&!state.planning)return {}
  if(mode==='recommend')return {planningDossier:await dossierHead(p.id)}
  if(mode==='fromDiscussion'){
   const row=await sourceReply(p.id,body.sourceJobId)
   const source={jobId:row.id,responseHash:createHash('sha256').update(row.response).digest('hex'),dossierRevision:Number(row.dossier_revision)||null,dossierHash:row.dossier_hash??null}
   const existing=await query("SELECT version FROM outline_versions WHERE project_id=$1 AND input_hash=$2 AND planning->'source'->>'jobId'=$3 ORDER BY version DESC LIMIT 1",[p.id,state.currentInputHash,row.id])
   if(existing.length&&state.planning?.source?.jobId===row.id&&state.status!=='stale'&&state.status!=='confirmed')throw planningError('该研判已有章节草案，请打开现有章节建议。')
   return {planningSource:source,planningDossier:await dossierHead(p.id)}
  }
  if(!state.planning||body.planningRevision!==state.planning.revision)throw planningError('章节建议已更新，请刷新再操作。')
  if(state.planningInputsChanged)throw planningError('资料已变化，请先根据当前资料更新章节建议。')
  if(state.confirmedAt&&mode==='adjust')throw planningError('请先开始新一轮编排，再调整已确认的建议。')
  if(!mode&&!body.flow)throw planningError('请选择章节或提交流程后再核对。')
  if(mode==='check'||(!mode&&body.flow))validatePlanSubmission(state.planning,body.flow)
  return {planningDossier:await dossierHead(p.id),...(state.planning.source?{planningSource:state.planning.source}:{})}
 }
 async function discussionContext(p,source) {
  const row=await sourceReply(p.id,source.jobId)
  if(createHash('sha256').update(row.response).digest('hex')!==source.responseHash)throw planningError('来源会话已变化，请重新选择。')
  return handoffPrompt(source,row.response,row.records?.slice(0,80).map(r=>({label:r.label,valueText:r.valueText,sourceId:r.evidence?.sourceId,pages:r.evidence?.pages})))
 }
 async function changeTask(p,body,userId) {
  const fingerprint=createHash('sha256').update(JSON.stringify(body)).digest('hex'),conn=await db.connect()
  try{
   await conn.query('BEGIN')
   await conn.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[p.id])
   const prior=(await conn.query('SELECT fingerprint,result FROM outline_task_choices WHERE project_id=$1 AND request_id=$2',[p.id,body.requestId])).rows[0]
   if(prior){
    if(prior.fingerprint!==fingerprint)throw planningError('请求编号已用于另一项编辑。')
    await conn.query('COMMIT');return prior.result
   }
   const row=(await conn.query('SELECT version,planning,confirmed_at FROM outline_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE',[p.id])).rows[0]
   const state=await current(p,async(sql,params)=>(await conn.query(sql,params)).rows)
   if(!row?.planning||row.confirmed_at||state.busy||state.planningInputsChanged||row.version!==body.version||row.planning.revision!==body.planningRevision)throw planningError('章节建议正在更新或已过期，请刷新再编辑。')
   const plan=chooseTask(row.planning,body)
   await conn.query('UPDATE outline_versions SET planning=$3,flow_reviewed=false WHERE project_id=$1 AND version=$2',[p.id,row.version,plan])
   const result={version:row.version,planningRevision:plan.revision,chapterId:body.chapterId,index:body.index,action:body.action}
   await conn.query('INSERT INTO outline_task_choices(project_id,request_id,fingerprint,result,user_id) VALUES($1,$2,$3,$4,$5)',[p.id,body.requestId,fingerprint,result,userId])
   await conn.query('COMMIT');return result
  }catch(e){await conn.query('ROLLBACK');throw e}finally{conn.release()}
 }
 async function save(p,job,response,newReads=[]){
  const state=await current(p)
  if(state.version!==job.payload.outlineVersion||state.currentInputHash!==job.payload.outlineInputHash)throw fail('资料或章节版本已变化，请重新梳理。')
  const [previous]=await query('SELECT read_receipts FROM outline_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[p.id])
  const reads=[...new Map([...(previous?.read_receipts??[]),...newReads].map(row=>[JSON.stringify(row),row])).values()]
  const files=(await query('SELECT * FROM materials WHERE project_id=$1',[p.id])).map(f=>({...f,sourceRelativePath:relative(p.workspace,f.path)}))
  const mode=job.payload.planningMode,version=state.version+1
  let plan=state.planning?structuredClone(state.planning):null,draft
  if(mode||plan){
   const head=await dossierHead(p.id)
   if((head?.hash??null)!==(job.payload.planningDossier?.hash??null))throw planningError('整理期间总档已变化，请重新编排。')
  }
  if(plan&&!['fromDiscussion','recommend'].includes(mode)&&plan.revision!==job.payload.planningRevision)throw planningError('整理期间章节建议已更新。')
  if(mode==='adjust'){
   const change=adjustChapters(state.draft,plan,response,job.payload.targetChapterId)
   draft=change.draft;plan=change.plan
   plan.previousVersion=state.version
   draft.questions=draft.questions.filter(q=>!q.chapterIds.some(id=>plan.changed.includes(id)))
  }else{
   draft=parseOutline(response,files,reads,{requireAssessment:!!job.payload.assessmentSkillHash})
   if(mode==='fromDiscussion'||mode==='recommend')plan=proposedPlan(draft,{source:job.payload.planningSource??null,dossier:job.payload.planningDossier},state)
  }
  const planningPass=['fromDiscussion','recommend','adjust'].includes(mode)
  // Older planning records did not distinguish an untouched recommendation from a user-submitted order.
  if(state.planning&&state.planning.submittedFlow==null&&!state.flowReviewed){
   const [match]=await query("SELECT 1 FROM outline_versions WHERE project_id=$1 AND flow=$2::jsonb AND flow_reviewed LIMIT 1",[p.id,JSON.stringify(state.flow)])
   state.planning.submittedFlow=!!match
  }
  const flow=nextOutlineFlow(state,draft,job.payload)
  const reviewed=!planningPass&&(!!job.payload.flow||state.flowReviewed)
  if(plan)plan.submittedFlow=reviewed||submittedFlow(state)
  if(plan&&reviewed){
   bindSubmittedTasks(draft,plan,flow)
   plan.changed=[]
   plan.revision=0
   plan.questions=Object.fromEntries(draft.chapters.map(c=>[c.id,draft.questions.filter(q=>q.chapterIds.includes(c.id)).map(q=>q.prompt)]))
  }
  const priorLimits=(state.inputHash===state.currentInputHash||plan)?[...state.waivers,...state.retainedWaivers]:[]
  const retained=[...new Map(priorLimits.filter(w=>w.chapterIds.some(id=>flow.includes(id))).map(w=>[JSON.stringify([w.questionId,w.prompt,w.reason,w.chapterIds]),w])).values()]
  if(reviewed)draft.questions=draft.questions.filter(q=>q.chapterIds.some(id=>flow.includes(id)))
  await query('INSERT INTO outline_versions(project_id,version,input_hash,job_id,draft,read_receipts,flow,flow_reviewed,retained_waivers,planning) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[p.id,version,state.currentInputHash,job.id,draft,JSON.stringify(reads),JSON.stringify(flow),reviewed,JSON.stringify(retained),plan])
  if(!planningPass&&state.inputHash===state.currentInputHash&&JSON.stringify(flow)===JSON.stringify(state.flow))for(const w of state.waivers){
   const old=state.draft.questions.find(q=>q.id===w.questionId),next=draft.questions.find(q=>q.id===w.questionId)
   if(old&&next&&questionKey(old)===questionKey(next))await query('INSERT INTO outline_question_decisions(project_id,version,question_id,request_id,fingerprint,action,reason,prompt,chapter_ids,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[p.id,version,w.questionId,`carry:${version}:${w.questionId}`,createHash('sha256').update(JSON.stringify(next)).digest('hex'),'skip',w.reason,w.prompt,JSON.stringify(w.chapterIds),w.userId])
  }
  return {version,draft}
 }
 async function confirm(p,body,userId){
  const fingerprint=createHash('sha256').update(JSON.stringify(body)).digest('hex')
  const [previous]=await query('SELECT * FROM outline_confirmations WHERE project_id=$1 AND request_id=$2',[p.id,body.requestId])
  if(previous){if(previous.fingerprint!==fingerprint)throw fail('请求编号已用于不同章节确认');return previous.result}
  const state=await current(p);assertOutlineConfirmable(state,body)
  const result={version:state.version,status:'confirmed',confirmedBy:userId,confirmedAt:new Date().toISOString()},conn=await db.connect()
  try{await conn.query('BEGIN');await conn.query('UPDATE outline_versions SET confirmed_at=$3,confirmed_by=$4 WHERE project_id=$1 AND version=$2',[p.id,state.version,result.confirmedAt,userId]);await conn.query('INSERT INTO outline_confirmations(project_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4)',[p.id,body.requestId,fingerprint,result]);await conn.query('COMMIT')}catch(e){await conn.query('ROLLBACK');throw e}finally{conn.release()}
  return result
 }
 async function decide(p,body,userId){
  const fingerprint=createHash('sha256').update(JSON.stringify(body)).digest('hex')
  const [prior]=await query('SELECT * FROM outline_question_decisions WHERE project_id=$1 AND request_id=$2',[p.id,body.requestId])
  if(prior){if(prior.fingerprint!==fingerprint)throw fail('请求编号已用于其他资料决定');return {version:prior.version,questionId:prior.question_id,action:prior.action}}
  const state=await current(p)
  if(state.busy||state.status!=='draft'||!state.flowReviewed||state.version!==body.version||state.inputHash!==body.inputHash)throw fail('流程版本已变化或尚未核对，请刷新后再处理资料疑点。')
  const question=state.draft.questions.find(q=>q.id===body.questionId)
  if(!question)throw fail('当前流程不存在这个疑点')
  await query('INSERT INTO outline_question_decisions(project_id,version,question_id,request_id,fingerprint,action,reason,prompt,chapter_ids,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[p.id,state.version,question.id,body.requestId,fingerprint,body.action,body.reason,question.prompt,JSON.stringify(question.chapterIds),userId])
  return {version:state.version,questionId:question.id,action:body.action}
 }
 const history=id=>query("SELECT payload->>'text' AS text FROM jobs WHERE project_id=$1 AND kind='outline' ORDER BY created_at,id",[id])
 return {current,prepare,preparePlanning,discussionContext,changeTask,save,confirm,requireConfirmed,history,decide}
}
