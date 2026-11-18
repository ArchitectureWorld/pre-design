import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {packageDigest,fail} from './contract.mjs'
const id=z.string().uuid(),version=z.number().int().positive(),hash=z.string().regex(/^[a-f0-9]{64}$/),requestId=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)
export const layoutNoteAnchorSchema=z.object({resourceId:id,version,packageHash:hash,layoutId:z.string().min(1).max(48),slotId:z.string().min(1).max(48).optional()}).strict()
export const layoutNoteCreateSchema=z.object({requestId,anchor:layoutNoteAnchorSchema,text:z.string().trim().min(1).max(5000)}).strict()
export function assertLayoutNoteAnchor(resource,anchor){
 if(resource.deleted||resource.retired||resource.id!==anchor.resourceId||resource.version!==anchor.version||resource.latestVersion!==anchor.version||resource.hash!==anchor.packageHash)throw fail('版式版本已变化，请保留草稿并重新选择目标。',409)
 const layout=resource.package.layouts.find(l=>l.id===anchor.layoutId)
 if(!layout||anchor.slotId&&!layout.slots.some(s=>s.id===anchor.slotId))throw fail('批注引用的版式或组件不存在，请重新选择。',409)
}
const json=v=>typeof v==='string'?JSON.parse(v):v
const editable=new Set(['pending','failed','interrupted','cancelled','discussed'])
function publicNote(row){
 const result=json(row.result),status=row.deleted?'deleted':!row.job_id?'pending':['queued','running','cancelling'].includes(row.job_status)?'submitted':row.job_status==='completed'?(result?.id?'candidate':'discussed'):row.job_status??'interrupted'
 return{id:row.id,text:row.text,revision:row.revision,anchor:json(row.anchor),status,jobId:row.job_id??null,result:result?.id?{id:result.id,version:result.version}:null,createdAt:row.created_at}
}
export async function createLayoutAnnotations(db,library){
 await db.query(`CREATE TABLE IF NOT EXISTS layout_annotations(id uuid PRIMARY KEY,owner_id text NOT NULL,resource_id uuid NOT NULL,resource_version integer NOT NULL,anchor jsonb NOT NULL,text text NOT NULL,revision integer NOT NULL DEFAULT 0,deleted boolean NOT NULL DEFAULT false,job_id uuid,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS layout_annotation_mutations(owner_id text NOT NULL,request_id text NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(owner_id,request_id));
 CREATE TABLE IF NOT EXISTS layout_annotation_batches(job_id uuid NOT NULL,note_id uuid NOT NULL,anchor jsonb NOT NULL,text text NOT NULL,PRIMARY KEY(job_id,note_id));`)
 const query=async(sql,args=[],c=db)=>(await c.query(sql,args)).rows
 async function owned(actor,resourceId,version,c=db){const r=await library.get(actor,resourceId,version,c);if(r.ownerId!==actor.id&&actor.role!=='admin')throw fail('只允许批注自己的版式候选。',403);return r}
 async function notes(actor,resourceId,version,c=db){return(await query('SELECT n.*,j.status AS job_status,j.result FROM layout_annotations n LEFT JOIN jobs j ON j.id=n.job_id WHERE n.owner_id=$1 AND n.resource_id=$2 AND n.resource_version=$3 ORDER BY n.created_at,n.id',[actor.id,resourceId,version],c)).map(publicNote)}
 async function list(actor,resourceId,version){await owned(actor,resourceId,version);return notes(actor,resourceId,version)}
 async function mutation(actor,b,op,fn){const fingerprint=packageDigest({op,...b}),c=await db.connect();try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",['layout-notes:'+actor.id]);const [old]=await query('SELECT * FROM layout_annotation_mutations WHERE owner_id=$1 AND request_id=$2',[actor.id,b.requestId],c);if(old){if(old.fingerprint!==fingerprint)throw fail('请求编号已用于不同批注。',409);await c.query('COMMIT');return json(old.result)}const result=await fn(c);await c.query('INSERT INTO layout_annotation_mutations(owner_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4)',[actor.id,b.requestId,fingerprint,result]);await c.query('COMMIT');return result}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
 async function create(actor,input){const b=layoutNoteCreateSchema.parse(input);return mutation(actor,b,'create',async c=>{await c.query('SELECT id FROM layout_library_resources WHERE id=$1 FOR UPDATE',[b.anchor.resourceId]);const r=await owned(actor,b.anchor.resourceId,b.anchor.version,c);assertLayoutNoteAnchor(r,b.anchor);const noteId=randomUUID();await c.query('INSERT INTO layout_annotations(id,owner_id,resource_id,resource_version,anchor,text) VALUES($1,$2,$3,$4,$5,$6)',[noteId,actor.id,r.id,r.version,b.anchor,b.text]);return{id:noteId,status:'pending',revision:0}})}
 async function change(actor,input,operation){const b=z.object({requestId,resourceId:id,noteId:id,expectedRevision:z.number().int().nonnegative(),...(operation==='edit'?{text:z.string().trim().min(1).max(5000)}:{})}).strict().parse(input);if(!['edit','delete'].includes(operation))throw fail('未知批注操作。');return mutation(actor,b,operation,async c=>{const [row]=await query('SELECT * FROM layout_annotations WHERE id=$1 AND owner_id=$2 AND resource_id=$3 FOR UPDATE',[b.noteId,actor.id,b.resourceId],c);if(!row)throw fail('批注不存在。',404);if(row.revision!==b.expectedRevision)throw fail('批注已变化，请保留输入并刷新核对。',409);await owned(actor,row.resource_id,row.resource_version,c);const n=(await notes(actor,row.resource_id,row.resource_version,c)).find(n=>n.id===b.noteId);if(!editable.has(n.status))throw fail('只能编辑或删除未完成的批注。',409);await c.query('UPDATE layout_annotations SET text=$2,deleted=$3,job_id=NULL,revision=revision+1 WHERE id=$1',[b.noteId,operation==='edit'?b.text:row.text,operation==='delete']);return{id:b.noteId,status:operation==='delete'?'deleted':'pending',revision:row.revision+1}})}
 async function prepareBatch(actor,b,c){
  if(!Array.isArray(b.annotationIds)||!b.annotationIds.length||b.annotationIds.length>50||new Set(b.annotationIds).size!==b.annotationIds.length)throw fail('请选择不重复的批注。')
  if(!b.annotationRevisions||Object.keys(b.annotationRevisions).length!==b.annotationIds.length||b.annotationIds.some(id=>!Number.isInteger(b.annotationRevisions[id])||b.annotationRevisions[id]<0))throw fail('批注版本选择不完整。',409)
  // Lock the resource before checking version, matching the revision writer's row lock.
  await c.query('SELECT id FROM layout_library_resources WHERE id=$1 FOR UPDATE',[b.resourceId])
  const r=await owned(actor,b.resourceId,b.resourceVersion,c),selected=[]
  for(const noteId of [...b.annotationIds].sort())await c.query('SELECT id FROM layout_annotations WHERE id=$1 AND owner_id=$2 FOR UPDATE',[noteId,actor.id])
  const all=await notes(actor,b.resourceId,b.resourceVersion,c)
  for(const noteId of [...b.annotationIds].sort()){const n=all.find(n=>n.id===noteId);if(!n||!editable.has(n.status))throw fail('批注已提交或不属于当前版式。',409);if(n.revision!==b.annotationRevisions[n.id])throw fail('批注已变化，请保留草稿并刷新核对。',409);assertLayoutNoteAnchor(r,n.anchor);if(n.anchor.packageHash!==b.packageHash)throw fail('批注版本不一致，请保留并重新核对。',409);selected.push(n)}
  const text='请按下列已提交批注调整当前版式，保留未提及的结构、来源事实与业务内容；生成新候选，不自动发布。批注数据：\n'+JSON.stringify(selected.map(n=>({id:n.id,layoutId:n.anchor.layoutId,slotId:n.anchor.slotId,text:n.text})))
  if(text.length>16000)throw fail('本批批注超过单轮容量，请减少选择；草稿已保留。',413)
  return{text,annotationBatch:selected.map(n=>({id:n.id,anchor:n.anchor,text:n.text}))}
 }
 async function submit(actor,noteIds,jobId,c){for(const noteId of noteIds){const [n]=await query('SELECT * FROM layout_annotations WHERE id=$1 AND owner_id=$2',[noteId,actor.id],c);if(!n)throw fail('批注不存在。',404);await c.query('INSERT INTO layout_annotation_batches(job_id,note_id,anchor,text) VALUES($1,$2,$3,$4)',[jobId,noteId,json(n.anchor),n.text]);await c.query('UPDATE layout_annotations SET job_id=$2 WHERE id=$1',[noteId,jobId])}}
 return{list,create,change,prepareBatch,submit}
}
