import {createHash} from 'node:crypto'
import {relative} from 'node:path'
import {assertOutlineExecutable,OUTLINE_CHAPTERS,outlineInputHash,assertOutlineConfirmable,parseOutline} from './outline-contract.mjs'
const questionKey=q=>JSON.stringify([q.id,q.prompt,q.reason,q.blocking,[...q.chapterIds].sort()])
const fail=message=>Object.assign(new Error(message),{statusCode:409,code:'OUTLINE_REQUIRED'})
export async function createOutlineStore(db){
 const query=async(sql,params=[])=>(await db.query(sql,params)).rows
 await query(`CREATE TABLE IF NOT EXISTS outline_versions(project_id uuid REFERENCES projects(id),version integer NOT NULL,input_hash text NOT NULL,job_id uuid UNIQUE REFERENCES jobs(id),draft jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),confirmed_at timestamptz,confirmed_by text,PRIMARY KEY(project_id,version));
 CREATE TABLE IF NOT EXISTS outline_confirmations(project_id uuid REFERENCES projects(id),request_id text NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(project_id,request_id));
 ALTER TABLE outline_versions ADD COLUMN IF NOT EXISTS read_receipts jsonb NOT NULL DEFAULT '[]';
 ALTER TABLE outline_versions ADD COLUMN IF NOT EXISTS flow jsonb;
 ALTER TABLE outline_versions ADD COLUMN IF NOT EXISTS retained_waivers jsonb NOT NULL DEFAULT '[]';
 ALTER TABLE outline_versions ADD COLUMN IF NOT EXISTS flow_reviewed boolean NOT NULL DEFAULT false;
 CREATE TABLE IF NOT EXISTS outline_question_decisions(project_id uuid REFERENCES projects(id),version integer NOT NULL,question_id text NOT NULL,request_id text NOT NULL,fingerprint text NOT NULL,action text NOT NULL,reason text NOT NULL,prompt text NOT NULL,chapter_ids jsonb NOT NULL,user_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,request_id));`)
 const materials=id=>query('SELECT id,filename,relative_path,sha256,bytes,image FROM materials WHERE project_id=$1 ORDER BY id',[id])
 async function current(p){
  const [fresh]=await query('SELECT name,metadata FROM projects WHERE id=$1',[p.id])
  const files=await materials(p.id),hash=outlineInputHash(fresh,files)
  const [row]=await query('SELECT * FROM outline_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[p.id])
  const [lastJob]=await query("SELECT id,status FROM jobs WHERE project_id=$1 AND kind='outline' ORDER BY created_at DESC,id DESC LIMIT 1",[p.id])
  const busy=!!(await query("SELECT id FROM jobs WHERE project_id=$1 AND status IN ('queued','running','cancelling') LIMIT 1",[p.id])).length
  const stale=row&&(row.input_hash!==hash||(lastJob&&lastJob.id!==row.job_id))
  const decisions=row?await query('SELECT DISTINCT ON(question_id) * FROM outline_question_decisions WHERE project_id=$1 AND version=$2 ORDER BY question_id,created_at DESC,request_id DESC',[p.id,row.version]):[]
  const waivers=decisions.filter(r=>r.action==='skip').map(r=>({questionId:r.question_id,prompt:r.prompt,reason:r.reason,chapterIds:r.chapter_ids,userId:r.user_id,createdAt:r.created_at,version:r.version}))
  const retainedWaivers=(row?.retained_waivers??[]).filter(w=>!decisions.some(d=>d.action==='reopen'&&d.question_id===w.questionId&&d.prompt===w.prompt)).filter(w=>!waivers.some(x=>x.questionId===w.questionId&&x.prompt===w.prompt&&x.reason===w.reason))
  return {retainedWaivers,flow:row?.flow??row?.draft.chapters.filter(c=>c.disposition==='include').map(c=>c.id)??[],flowReviewed:row?.flow_reviewed??false,waivers,version:row?.version??0,inputHash:row?.input_hash??hash,currentInputHash:hash,status:!row?'empty':stale?'stale':row.confirmed_at?'confirmed':'draft',draft:row?.draft??null,confirmedAt:row?.confirmed_at??null,confirmedBy:row?.confirmed_by??null,busy,catalog:OUTLINE_CHAPTERS,lastJob:lastJob??null}
 }
 async function requireConfirmed(p,kind,selection){const state=await current(p);if(state.status!=='confirmed')throw fail('请先完成资料梳理并确认最新章节流程，再开展后续研究。');if(kind)assertOutlineExecutable(state,kind,selection);return state}
 async function prepare(p,body){
  const state=await current(p)
  if(state.busy)throw fail('项目仍有任务处理中，请完成后再更新章节草案。')
  if(state.version!==body.outlineVersion)throw fail('章节版本已变化，请刷新后补充。')
  if(!(await materials(p.id)).length)throw fail('请先上传项目资料，再梳理章节。')
  return state
 }
 async function save(p,job,response,newReads=[]){
  const state=await current(p)
  if(state.version!==job.payload.outlineVersion||state.currentInputHash!==job.payload.outlineInputHash)throw fail('资料或章节版本已变化，请重新梳理。')
  const [previous]=await query('SELECT read_receipts FROM outline_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[p.id])
  const reads=[...new Map([...(previous?.read_receipts??[]),...newReads].map(row=>[JSON.stringify(row),row])).values()]
  const files=(await query('SELECT * FROM materials WHERE project_id=$1',[p.id])).map(f=>({...f,sourceRelativePath:relative(p.workspace,f.path)}))
  const draft=parseOutline(response,files,reads),version=state.version+1,flow=job.payload.flow??(state.flowReviewed?state.flow:draft.chapters.filter(c=>c.disposition==='include').map(c=>c.id)),reviewed=!!job.payload.flow||state.flowReviewed
  const retained=state.inputHash===state.currentInputHash?[...new Map([...state.waivers,...state.retainedWaivers].filter(w=>w.chapterIds.some(id=>flow.includes(id))).map(w=>[JSON.stringify([w.questionId,w.prompt,w.reason,w.chapterIds]),w])).values()]:[]
  if(reviewed)draft.questions=draft.questions.filter(q=>q.chapterIds.some(id=>flow.includes(id)))
  await query('INSERT INTO outline_versions(project_id,version,input_hash,job_id,draft,read_receipts,flow,flow_reviewed,retained_waivers) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[p.id,version,state.currentInputHash,job.id,draft,JSON.stringify(reads),JSON.stringify(flow),reviewed,JSON.stringify(retained)])
  if(state.inputHash===state.currentInputHash&&JSON.stringify(flow)===JSON.stringify(state.flow))for(const w of state.waivers){
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
 return {current,prepare,save,confirm,requireConfirmed,history,decide}
}
