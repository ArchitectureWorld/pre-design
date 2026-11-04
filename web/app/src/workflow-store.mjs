import {randomUUID,createHash} from 'node:crypto'
import {outlineInputHash} from './outline-contract.mjs'
import {workflowError,workflowFingerprint,workflowTargets,workflowLimitations,workflowPrompt,parseWorkflowResponse,renderWorkflowArtifact} from './workflow-contract.mjs'
import {workflowBlockItems,workflowBodyMarkdown} from './workflow-content.mjs'
import {createWorkflowVisualStore} from './workflow-visual-store.mjs'

export async function createWorkflowStore(db){
 const query=async(sql,args=[])=> (await db.query(sql,args)).rows
 await query(`CREATE TABLE IF NOT EXISTS workflow_drafts(
  id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),job_id uuid NOT NULL UNIQUE REFERENCES jobs(id),
  version integer NOT NULL,outline_version integer NOT NULL,input_hash text NOT NULL,document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,version));
 CREATE TABLE IF NOT EXISTS workflow_reviews(
  project_id uuid NOT NULL REFERENCES projects(id),draft_id uuid NOT NULL REFERENCES workflow_drafts(id),block_id text NOT NULL,
  request_id text NOT NULL,fingerprint text NOT NULL,user_id text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,request_id));
 ALTER TABLE workflow_reviews ADD COLUMN IF NOT EXISTS item_id text;
 CREATE TABLE IF NOT EXISTS workflow_approvals(project_id uuid NOT NULL REFERENCES projects(id),draft_id uuid NOT NULL REFERENCES workflow_drafts(id),request_id text NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,request_id));`)
 const visuals=await createWorkflowVisualStore(db,{currentDraft:async p=>(await current(p,false)).current})
 const latest=p=>query('SELECT * FROM workflow_drafts WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[p.id]).then(rows=>rows[0])
 async function hydrate(row){
  if(!row)return null
  const reviews=await query('SELECT DISTINCT block_id,item_id FROM workflow_reviews WHERE project_id=$1 AND draft_id=$2 ORDER BY block_id,item_id',[row.project_id,row.id])
  const approval=(await query('SELECT result FROM workflow_approvals WHERE project_id=$1 AND draft_id=$2 ORDER BY created_at DESC LIMIT 1',[row.project_id,row.id]))[0]?.result??null
  const wholeBlockReviews=reviews.filter(r=>!r.item_id).map(r=>r.block_id)
  const reviewedItemIds=[...new Set([...reviews.flatMap(r=>r.item_id?[r.item_id]:[]),...row.document.blocks.filter(b=>wholeBlockReviews.includes(b.id)).flatMap(b=>workflowBlockItems(b).map(item=>item.id))])].sort()
  const reviewedBlockIds=row.document.blocks.filter(block=>wholeBlockReviews.includes(block.id)||workflowBlockItems(block).length&&workflowBlockItems(block).every(item=>reviewedItemIds.includes(item.id))).map(block=>block.id)
  return {...row.document,formatVersion:row.document.formatVersion??1,id:row.id,version:row.version,outlineVersion:row.outline_version,inputHash:row.input_hash,jobId:row.job_id,createdAt:new Date(row.created_at).toISOString(),reviewedBlockIds,reviewedItemIds,approval}
 }
 async function current(p,includeVisuals=true){
  const [rows,outlineRows,projectRows,files,lastJobs]=await Promise.all([
   query('SELECT id,version,outline_version,input_hash,created_at,job_id FROM workflow_drafts WHERE project_id=$1 ORDER BY version DESC',[p.id]),
   query('SELECT version,input_hash,confirmed_at,job_id FROM outline_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[p.id]),
   query('SELECT name,metadata FROM projects WHERE id=$1',[p.id]),
   query('SELECT id,filename,relative_path,sha256 FROM materials WHERE project_id=$1 ORDER BY id',[p.id]),
   query("SELECT id FROM jobs WHERE project_id=$1 AND kind='outline' ORDER BY created_at DESC,id DESC LIMIT 1",[p.id]),
  ])
  const doc=rows.length?await hydrate(await latest(p)):null,outline=outlineRows[0],hash=outlineInputHash(projectRows[0]??p,files)
  if(doc)doc.stale=!outline?.confirmed_at||doc.outlineVersion!==outline.version||doc.inputHash!==hash||outline.input_hash!==hash||!!lastJobs[0]&&lastJobs[0].id!==outline.job_id
  return {current:doc,history:rows.map(r=>({id:r.id,version:r.version,outlineVersion:r.outline_version,createdAt:new Date(r.created_at).toISOString(),jobId:r.job_id})),...(includeVisuals?{visuals:await visuals.current(p,doc)}:{})}
 }
 function requireOutline(outline){if(outline.status!=='confirmed'||!outline.flow?.length||outline.inputHash!==outline.currentInputHash)throw workflowError('请先确认当前章节流程，再生成本轮初稿。')}
 async function prepare(p,outline,body){
  requireOutline(outline)
  if(outline.busy)throw workflowError('项目任务仍在执行，请结束后再生成初稿。')
  if(body.outlineVersion!==outline.version)throw workflowError('章节流程已更新，请刷新后生成初稿。')
  const previous=await latest(p)
  if(body.baseDraftId&&previous?.id!==body.baseDraftId)throw workflowError('初稿版本已变化，请打开最新稿再修改。')
  if(body.blockId){
   if(!body.baseDraftId||!body.text?.trim())throw workflowError('请指定当前初稿和修改意见。',400)
   if(!previous||previous.outline_version!==outline.version||previous.input_hash!==outline.currentInputHash||!previous.document.blocks.some(b=>b.id===body.blockId))throw workflowError('该节不属于当前初稿，请先生成当前流程的初稿。')
   if(body.itemId&&!workflowBlockItems(previous.document.blocks.find(b=>b.id===body.blockId)).some(item=>item.id===body.itemId))throw workflowError('该条不属于选定章节，请重新引用当前内容。')
  }
  workflowTargets(outline)
  return {formatVersion:2,outlineInputHash:outline.currentInputHash,inputFingerprint:workflowFingerprint(outline),baseDraftId:previous?.id??null}
 }
 function checkSnapshot(outline,job){
  requireOutline(outline)
  if(outline.version!==job.payload.outlineVersion||outline.currentInputHash!==job.payload.outlineInputHash||workflowFingerprint(outline)!==job.payload.inputFingerprint)throw workflowError('资料或章节确认版本已变化，本次初稿未保存；请按新流程重试。')
 }
 async function prompt(p,outline,job){
  checkSnapshot(outline,job)
  const previous=job.payload.baseDraftId?(await query('SELECT document FROM workflow_drafts WHERE project_id=$1 AND id=$2',[p.id,job.payload.baseDraftId]))[0]?.document:undefined
  if(job.payload.blockId&&!previous)throw workflowError('待修改的初稿不存在。',404)
  return workflowPrompt(p,outline,job,previous)
 }
 async function save(p,outline,job,response){
  checkSnapshot(outline,job)
  const generated=parseWorkflowResponse(response,outline,job.payload.blockId,{requireStructured:true,itemId:job.payload.itemId}),conn=await db.connect()
  let row
  try{
   await conn.query('BEGIN')
   const task=(await conn.query('SELECT status FROM jobs WHERE project_id=$1 AND id=$2 FOR UPDATE',[p.id,job.id])).rows[0]
   const existing=(await conn.query('SELECT * FROM workflow_drafts WHERE project_id=$1 AND job_id=$2',[p.id,job.id])).rows[0]
   if(existing){await conn.query('COMMIT');return {...await hydrate(existing),stale:false}}
   if(task?.status!=='running')throw workflowError('任务已中止或结束，本次内容未保存。')
   const project=(await conn.query('SELECT name,metadata FROM projects WHERE id=$1 FOR UPDATE',[p.id])).rows[0]
   const files=(await conn.query('SELECT id,filename,relative_path,sha256 FROM materials WHERE project_id=$1 ORDER BY id',[p.id])).rows
   const currentOutline=(await conn.query('SELECT version,input_hash,confirmed_at FROM outline_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[p.id])).rows[0]
   if(!currentOutline?.confirmed_at||currentOutline.version!==job.payload.outlineVersion||outlineInputHash(project,files)!==job.payload.outlineInputHash)throw workflowError('资料或章节版本已改变，本次初稿未保存。')
   const previous=(await conn.query('SELECT * FROM workflow_drafts WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[p.id])).rows[0]
   if((previous?.id??null)!==(job.payload.baseDraftId??null))throw workflowError('已有更新的初稿，本次结果未覆盖新版本。')
   const blocks=job.payload.blockId?previous.document.blocks.map(b=>{
    if(b.id!==job.payload.blockId)return b
    if(!job.payload.itemId)return generated[0]
    const items=workflowBlockItems(b).map(item=>item.id===job.payload.itemId?generated[0].items[0]:item)
    return {...b,items,body:workflowBodyMarkdown(items),evidenceIndexes:[...new Set(items.flatMap(item=>item.evidenceIndexes))],internalNotes:[...new Set([...(b.internalNotes??[]),...generated[0].internalNotes])]}
   }):generated
   const id=randomUUID(),version=(previous?.version??0)+1,createdAt=new Date().toISOString(),byId=new Map(files.map(f=>[f.id,f]))
   const document={id,formatVersion:blocks.every(block=>Array.isArray(block.items))?2:1,projectName:project.name,version,outlineVersion:outline.version,inputHash:outline.currentInputHash,jobId:job.id,createdAt,flow:[...outline.flow],
    chapters:outline.flow.map(chapterId=>{const chapter=outline.draft.chapters.find(c=>c.id===chapterId);return {id:chapter.id,title:chapter.title}}),blocks,
    evidence:outline.draft.evidence.map(e=>({...e,filename:byId.get(e.materialId)?.relative_path??byId.get(e.materialId)?.filename??'资料'})),
    limitations:workflowLimitations(outline),sourceDraftId:previous?.id??null,changedBlockId:job.payload.blockId??null,changedItemId:job.payload.itemId??null}
   row=(await conn.query('INSERT INTO workflow_drafts(id,project_id,job_id,version,outline_version,input_hash,document,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[id,p.id,job.id,version,outline.version,outline.currentInputHash,document,createdAt])).rows[0]
   await conn.query('COMMIT')
  }catch(error){await conn.query('ROLLBACK');throw error}finally{conn.release()}
  return {...await hydrate(row),stale:false}
 }
 async function review(p,outline,body,userId){
  const fingerprint=createHash('sha256').update(JSON.stringify(body)).digest('hex')
  const prior=(await query('SELECT fingerprint,result FROM workflow_reviews WHERE project_id=$1 AND request_id=$2',[p.id,body.requestId]))[0]
  if(prior){if(prior.fingerprint!==fingerprint)throw workflowError('请求编号已用于其他初稿审阅。');return prior.result}
  requireOutline(outline)
  if(outline.busy)throw workflowError('任务正在执行，请结束后审阅最新稿。')
  const row=await latest(p)
  if(!row||row.id!==body.draftId||row.outline_version!==outline.version||row.input_hash!==outline.currentInputHash)throw workflowError('初稿或资料版本已变化，请审阅最新稿。')
  if(!row.document.blocks.some(b=>b.id===body.blockId))throw workflowError('当前初稿不存在这节内容。',404)
  if(body.itemId&&!workflowBlockItems(row.document.blocks.find(b=>b.id===body.blockId)).some(item=>item.id===body.itemId))throw workflowError('当前初稿不存在这条内容。',404)
  const result={draftId:row.id,blockId:body.blockId,...(body.itemId?{itemId:body.itemId}:{}),status:'reviewed',reviewedAt:new Date().toISOString(),reviewedBy:userId}
  await query('INSERT INTO workflow_reviews(project_id,draft_id,block_id,item_id,request_id,fingerprint,user_id,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.id,row.id,body.blockId,body.itemId??null,body.requestId,fingerprint,userId,result])
  return result
 }
 async function approve(p,outline,body,userId){
  const fingerprint=createHash('sha256').update(JSON.stringify(body)).digest('hex'),conn=await db.connect()
  try{
   await conn.query('BEGIN');await conn.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[p.id])
   const prior=(await conn.query('SELECT fingerprint,result FROM workflow_approvals WHERE project_id=$1 AND request_id=$2',[p.id,body.requestId])).rows[0]
   if(prior){if(prior.fingerprint!==fingerprint)throw workflowError('请求编号已用于其他整稿确认。');await conn.query('COMMIT');return prior.result}
   requireOutline(outline)
   const doc=(await current(p,false)).current
   if(outline.busy||!doc||doc.id!==body.draftId||doc.stale||doc.formatVersion!==2)throw workflowError('请先生成并审阅当前完整条目脚本。')
   const result={draftId:doc.id,approvedAt:new Date().toISOString(),approvedBy:userId}
   await conn.query('INSERT INTO workflow_approvals(project_id,draft_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4,$5)',[p.id,doc.id,body.requestId,fingerprint,result]);await conn.query('COMMIT');return result
  }catch(error){await conn.query('ROLLBACK');throw error}finally{conn.release()}
 }
 const filename=(doc,format)=>`${doc.projectName.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,90)}_阶段初稿_V${doc.version}.${format}`
 async function listArtifacts(p){
  const rows=await query('SELECT * FROM workflow_drafts WHERE project_id=$1 ORDER BY version DESC',[p.id]),artifacts=[]
  for(const row of rows){const doc=await hydrate(row);for(const format of ['html','md'])artifacts.push({id:`workflow-${row.id}-${format}`,filename:filename(doc,format),bytes:Buffer.byteLength(renderWorkflowArtifact(doc,format)),kind:'workflow-draft',status:doc.approval?.draftId===doc.id||doc.reviewedBlockIds.length===doc.blocks.length?'reviewed':'draft',createdAt:doc.createdAt,version:doc.version,outlineVersion:doc.outlineVersion})}
  return [...artifacts,...await visuals.listArtifacts(p)]
 }
 async function readArtifact(p,id){
  if(id.startsWith('workflow-visual-'))return visuals.readArtifact(p,id)
  const match=/^workflow-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-(html|md)$/.exec(id)
  if(!match)throw workflowError('阶段稿文件不存在。',404)
  const row=(await query('SELECT * FROM workflow_drafts WHERE project_id=$1 AND id=$2',[p.id,match[1]]))[0]
  if(!row)throw workflowError('阶段稿文件不存在。',404)
  const doc=await hydrate(row),format=match[2]
  return {data:Buffer.from(renderWorkflowArtifact(doc,format)),filename:filename(doc,format),contentType:format==='html'?'text/html; charset=utf-8':'text/markdown; charset=utf-8'}
 }
 return {current,prepare,prompt,save,review,approve,generateVisuals:visuals.generate,listArtifacts,readArtifact}
}
