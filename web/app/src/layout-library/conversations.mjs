import {createHash} from 'node:crypto'
import {createPackage,validatePackage,fail} from './contract.mjs'
import {referenceFileSummary} from './reference-uploads.mjs'

const active=status=>['queued','running','cancelling'].includes(status)
const referenceOf=row=>row.result?.id?{id:row.result.id,version:row.result.version}:row.payload?.baseResource??null
const fileKey=file=>file.id?'upload:'+file.id:'text:'+file.name
const publicTurn=row=>({id:row.id,text:row.payload.text,files:(row.payload.files??[]).map(referenceFileSummary),status:row.status,result:row.result,error:row.error,
 progress:row.progress,execution_metadata:row.execution_metadata,createdAt:row.created_at,startedAt:row.started_at,modelName:row.policy_snapshot?.routes?.[row.payload.modelRole??'parent']?.primary?.model})

export function createLayoutConversations(db,library,uploads){
 const query=async(sql,args=[],c=db)=>(await c.query(sql,args)).rows
 async function rows(actor,conversationId,c=db){
  const [root]=await query("SELECT id FROM jobs WHERE id=$1 AND owner_id=$2 AND kind='layout-reference'",[conversationId,actor.id],c)
  if(!root)throw fail('会话不存在。',404)
  return query("SELECT * FROM jobs WHERE owner_id=$1 AND kind='layout-reference' AND (id=$2 OR payload->>'conversationId'=$2::text) ORDER BY created_at,id",[actor.id,conversationId],c)
 }
 async function prepare(actor,input,jobId,c){
  if(input.conversationId&&await library.isRemoved('conversation',input.conversationId,c))throw fail('此版式草稿已删除，请先撤销删除。',409)
  const history=input.conversationId?await rows(actor,input.conversationId,c):[]
  if(history.some(row=>active(row.status)))throw fail('当前回复正在生成，请完成或停止后再发送。',409)
  const previous=history.findLast(row=>referenceOf(row))
  const ref=input.resourceId?{id:input.resourceId,version:input.resourceVersion}:previous?referenceOf(previous):null
  const resource=ref?await library.get(actor,ref.id,ref.version,c):null
  if(resource?.deleted)throw fail('此版式已删除，请先撤销删除。',409)
  if(resource?.ownerId===actor.id&&resource.version!==resource.latestVersion)throw fail('版式已有新版本，请刷新后继续会话。',409)
  const files=uploads?await uploads.resolveFiles(actor,input.files??[],c):input.files??[]
  const name=(input.name??input.package?.name??resource?.package.name??files[0]?.name.replace(/\.[^.]+$/u,'').slice(0,100)??'我的版式').trim()||'我的版式'
  const basePackage=validatePackage({...input.package??resource?.package??history.at(-1)?.payload.basePackage??createPackage(name),name})
  if(input.selection&&!basePackage.layouts.some(l=>l.id===input.selection.layoutId&&l.slots.some(s=>s.role===input.selection.slot)))throw fail('引用的版式位置已变化，请重新选择。',409)
  const references=new Map((history.at(-1)?.payload.referenceFiles??[]).map(f=>[fileKey(f),f]))
  if(history.length&&!history[0].payload.mode)references.set('text:先前文字参考',{name:'先前文字参考',text:history[0].payload.text})
  for(const file of files)references.set(fileKey(file),{...file,sha256:file.id?file.sha256:createHash('sha256').update(file.text).digest('hex')})
  const referenceFiles=[...references.values()]
  if(referenceFiles.reduce((n,f)=>n+(f.imageCount??0),0)>16)throw fail('本轮参考超过16张页面图像，请分批分析。',413)
  if(referenceFiles.reduce((n,f)=>n+(f.text?.length??0),0)>96000)throw fail('本轮参考文字过多，请分批分析。',413)
  return {mode:'conversation',conversationId:input.conversationId??jobId,name,text:input.text||'请根据上传参考生成版式。',files,
   referenceFiles,modelRole:referenceFiles.some(f=>f.hasImages)?'vision':'parent',basePackage,providedPackage:!!input.package||history.at(-1)?.payload.providedPackage===true,
   baseResource:resource?{id:resource.id,version:resource.version,hash:resource.hash,ownerId:resource.ownerId}:null,
   selection:input.selection??null,
   conversationHistory:history.slice(-6).map(row=>({user:row.payload.text,reply:row.result?.reply??(row.result?.id?'已生成版式 V'+row.result.version+'。':null),status:row.status})),
  }
 }
 async function list(actor){
  const records=await query(`SELECT DISTINCT ON (COALESCE(payload->>'conversationId',id::text))
   id,COALESCE(payload->>'conversationId',id::text) AS conversation_id,payload->>'name' AS name,payload->>'mode' AS mode,status,created_at,
   COALESCE(result->>'id',payload->'baseResource'->>'id') AS resource_id
   FROM jobs WHERE owner_id=$1 AND kind='layout-reference'
   ORDER BY COALESCE(payload->>'conversationId',id::text),created_at DESC,id DESC`,[actor.id])
  const deleted=await query('SELECT target_kind,target_id FROM layout_library_deletions'),hidden=new Set(deleted.map(r=>r.target_kind+':'+r.target_id))
  return records.filter(r=>!hidden.has('conversation:'+r.conversation_id)&&!hidden.has('resource:'+r.resource_id)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(row=>({id:row.conversation_id,name:row.name,status:row.status,resourceId:row.resource_id,updatedAt:row.created_at,legacy:row.mode!=='conversation'}))
 }
 async function get(actor,conversationId){
  const history=await rows(actor,conversationId)
  const previous=history.findLast(row=>referenceOf(row)),ref=previous?referenceOf(previous):null
  const resource=ref?await library.get(actor,ref.id):null
  return {id:conversationId,name:resource?.package.name??history.at(-1)?.payload.name,resource,
   ...(!resource&&history.at(-1)?.payload.providedPackage?{draftPackage:history.at(-1).payload.basePackage}:{}),
   referenceFiles:(history.at(-1)?.payload.referenceFiles??[]).map(referenceFileSummary),turns:history.map(publicTurn)}
 }
 return {prepare,list,get}
}
