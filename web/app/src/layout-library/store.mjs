import {randomUUID} from 'node:crypto'
import {validatePackage,packageDigest,RENDERER,fail,patchSchema,resolvePage,exportReusable} from './contract.mjs'
import {createReferenceReviews,assertReferenceReviewed,isReferenceReviewCurrent} from './reference-review.mjs'
import {rendererForPackage} from './contract.mjs'
import {FIXTURES_VERSION} from './validation.mjs'
const own=(r,a)=>r.owner_id===a.id||a.role==='admin'
const published=(r,v)=>!r.retired&&!r.deleted_id&&v.version===r.published_version
export async function createLayoutLibrary(db){
 await db.query(`CREATE TABLE IF NOT EXISTS layout_library_resources(
 id uuid PRIMARY KEY,owner_id text NOT NULL,visibility text NOT NULL DEFAULT 'private',version integer NOT NULL,
 published_version integer,retired boolean NOT NULL DEFAULT false,share_requested boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS layout_library_versions(resource_id uuid NOT NULL REFERENCES layout_library_resources(id),version integer NOT NULL,document jsonb NOT NULL,hash text NOT NULL,validation jsonb,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(resource_id,version));
 CREATE TABLE IF NOT EXISTS layout_library_sources(resource_id uuid PRIMARY KEY REFERENCES layout_library_resources(id),filename text NOT NULL,sha256 text NOT NULL,body_base64 text NOT NULL);
 CREATE TABLE IF NOT EXISTS layout_library_usage(visual_id uuid NOT NULL,resource_id uuid NOT NULL,resource_version integer NOT NULL,page_id text NOT NULL,project_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(visual_id,resource_id,page_id));
 CREATE TABLE IF NOT EXISTS layout_library_mutations(actor_id text NOT NULL,request_id text NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor_id,request_id));
 CREATE TABLE IF NOT EXISTS layout_project_bindings(project_id uuid PRIMARY KEY,draft_id uuid NOT NULL,revision integer NOT NULL,document jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS layout_binding_versions(project_id uuid NOT NULL,revision integer NOT NULL,draft_id uuid NOT NULL,document jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,revision));
 CREATE TABLE IF NOT EXISTS layout_library_deletions(target_kind text NOT NULL,target_id uuid NOT NULL,delete_token uuid NOT NULL,deleted_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(target_kind,target_id));`)
 const query=async(sql,args=[],c=db)=>(await c.query(sql,args)).rows
 const reviews=await createReferenceReviews(db,get)
 async function isRemoved(kind,id,c=db){const [r]=await query('SELECT delete_token FROM layout_library_deletions WHERE target_kind=$1 AND target_id=$2',[kind,id],c);return r?.delete_token??null}
 async function activeResource(id,c=db){if(await isRemoved('resource',id,c))throw fail('此版式已删除，请先撤销删除。',409)}
 async function resource(id,c=db){const [r]=await query("SELECT r.*,d.target_id AS deleted_id FROM layout_library_resources r LEFT JOIN layout_library_deletions d ON d.target_kind='resource' AND d.target_id=r.id WHERE r.id=$1",[id],c);if(!r)throw fail('版式资源不存在。',404);return r}
 async function get(actor,id,version,c=db){
  const r=await resource(id,c)
  const wanted=version??(own(r,actor)?r.version:r.published_version)
  const [v]=await query('SELECT * FROM layout_library_versions WHERE resource_id=$1 AND version=$2',[id,wanted],c)
  if(!v||!own(r,actor)&&!(r.visibility!=='private'&&published(r,v)))throw fail('版式资源不存在。',404)
  const result={id:r.id,version:v.version,latestVersion:r.version,publishedVersion:r.published_version,ownerId:r.owner_id,visibility:r.visibility,retired:!!r.retired,deleted:!!r.deleted_id,shareRequested:!!r.share_requested,published:published(r,v),package:v.document,hash:v.hash,validation:v.validation,referenceReview:await reviews.get(r.id,v.version,c),createdAt:v.created_at}
  if(result.referenceReview&&!isReferenceReviewCurrent(result))result.referenceReview={...result.referenceReview,status:'stale'}
  return result
 }
 async function list(actor){
  const rows=await query("SELECT * FROM layout_library_resources r WHERE (owner_id=$1 OR $2=true OR (visibility<>'private' AND published_version IS NOT NULL AND retired=false)) AND NOT EXISTS(SELECT 1 FROM layout_library_deletions d WHERE d.target_kind='resource' AND d.target_id=r.id) ORDER BY created_at DESC",[actor.id,actor.role==='admin'])
  const results=[]
  for(const r of rows){const x=await get(actor,r.id);const [usage]=await query('SELECT count(*) AS n FROM layout_library_usage WHERE resource_id=$1',[r.id]);results.push({...x,usageCount:Number(usage.n),editable:own(r,actor)})}
  return results
 }
 async function mutation(actor,requestId,data,fn,connection){
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(requestId??''))throw fail('请求编号不合法。')
  const hash=packageDigest(data),c=connection??await db.connect()
  try{
   if(!connection)await c.query('BEGIN')
   await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",['layout-library:'+actor.id])
   const [prior]=await query('SELECT * FROM layout_library_mutations WHERE actor_id=$1 AND request_id=$2',[actor.id,requestId],c)
   if(prior){if(prior.fingerprint!==hash)throw fail('请求编号已用于不同操作。',409);if(!connection)await c.query('COMMIT');return prior.result}
   const result=await fn(c)
   await c.query('INSERT INTO layout_library_mutations(actor_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4)',[actor.id,requestId,hash,result])
   if(!connection)await c.query('COMMIT')
   return result
  }catch(e){if(!connection)await c.query('ROLLBACK');throw e}finally{if(!connection)c.release()}
 }
 async function create(actor,b,connection){
  const p=validatePackage(b.package)
  return mutation(actor,b.requestId,{op:'create',package:p,sourceHash:b.sourceFile?.sha256??null},async c=>{
   const hash=packageDigest(p)
   const [duplicate]=await query("SELECT r.id,r.version FROM layout_library_resources r JOIN layout_library_versions v ON v.resource_id=r.id AND v.version=r.version WHERE r.owner_id=$1 AND r.retired=false AND v.hash=$2 AND NOT EXISTS(SELECT 1 FROM layout_library_deletions d WHERE d.target_kind='resource' AND d.target_id=r.id)",[actor.id,hash],c)
   if(duplicate)return {id:duplicate.id,version:duplicate.version,hash,reused:true}
   const id=randomUUID()
   await c.query('INSERT INTO layout_library_resources(id,owner_id,version) VALUES($1,$2,1)',[id,actor.id])
   await c.query('INSERT INTO layout_library_versions(resource_id,version,document,hash) VALUES($1,1,$2,$3)',[id,p,hash]);if(b.sourceFile)await c.query('INSERT INTO layout_library_sources(resource_id,filename,sha256,body_base64) VALUES($1,$2,$3,$4)',[id,b.sourceFile.filename,b.sourceFile.sha256,b.sourceFile.content]);return {id,version:1,hash}
  },connection)
 }
 async function sourceFile(actor,id){const x=await get(actor,id);if(x.ownerId!==actor.id&&actor.role!=='admin')throw fail('参考原件不存在。',404);const [source]=await query('SELECT filename,sha256,body_base64 FROM layout_library_sources WHERE resource_id=$1',[id]);if(!source)throw fail('该资源没有保留的外部参考原件。',404);return source}
 async function revise(actor,b,connection){
  const p=validatePackage(b.package)
  return mutation(actor,b.requestId,{...b,package:p,op:'revise'},async c=>{
   const [r]=await query('SELECT * FROM layout_library_resources WHERE id=$1 FOR UPDATE',[b.id],c)
   if(!r||!own(r,actor))throw fail('版式资源不存在。',404)
   await activeResource(b.id,c)
   if(r.version!==b.expectedVersion)throw fail('版式已有新版本，请刷新后编辑。',409)
   const version=r.version+1,hash=packageDigest(p)
   const [old]=await query('SELECT hash FROM layout_library_versions WHERE resource_id=$1 AND version=$2',[r.id,r.version],c)
   if(old.hash===hash)return {id:r.id,version:r.version,hash,unchanged:true}
   await c.query('INSERT INTO layout_library_versions(resource_id,version,document,hash) VALUES($1,$2,$3,$4)',[r.id,version,p,hash])
   await c.query('UPDATE layout_library_resources SET version=$2,share_requested=false WHERE id=$1',[r.id,version]);return {id:r.id,version,hash}
  },connection)
 }
 async function saveValidation(actor,id,version,result){
  const x=await get(actor,id,version)
  if(x.ownerId!==actor.id&&actor.role!=='admin')throw fail('只允许检查自己的候选资源。',403)
  await activeResource(id)
  if(result.packageHash!==x.hash||result.renderer!==rendererForPackage(x.package)||result.fixturesVersion!==FIXTURES_VERSION)throw fail('检查记录与资源或渲染版本不一致。',409)
  await db.query('UPDATE layout_library_versions SET validation=$3 WHERE resource_id=$1 AND version=$2',[id,version,result]);return result
 }
 async function publish(actor,b){
  return mutation(actor,b.requestId,{...b,op:'publish'},async c=>{
   const [r]=await query('SELECT * FROM layout_library_resources WHERE id=$1 FOR UPDATE',[b.id],c)
   if(!r||!own(r,actor))throw fail('版式资源不存在。',404)
   await activeResource(b.id,c)
   if(b.version!==r.version)throw fail('发布时必须审阅当前候选版本。',409)
   const v=await get(actor,b.id,b.version,c),q=v.validation,p=v.package
   if(b.visibility!=='private'&&actor.role!=='admin')throw fail('共享和官方发布需要管理员审查。',403)
   if(!['private','shared','official'].includes(b.visibility)||!b.reviewed)throw fail('请明确确认参考适用性和公开范围。')
   if(b.visibility!=='private'&&r.owner_id!==actor.id&&!r.share_requested)throw fail('资源拥有者尚未提交共享申请，不能公开其私有资源。',403)
   if(b.visibility!=='private'&&(!p.rights.shareAllowed||p.rights.basis==='unknown'))throw fail('共享资源必须有明确的使用授权，不能发布未知来源。',409)
   if(!q||q.status!=='passed'||q.packageHash!==v.hash||q.renderer!==rendererForPackage(p)||q.fixturesVersion!==FIXTURES_VERSION||!q.overflowGuard)throw fail('须先通过当前资源的实际页面检查。',409)
   assertReferenceReviewed(v)
   await c.query('UPDATE layout_library_resources SET published_version=$2,visibility=$3,retired=false,share_requested=false WHERE id=$1',[b.id,b.version,b.visibility])
   return {id:b.id,version:b.version,visibility:b.visibility,published:true}
  })
 }
 async function retire(actor,b){return mutation(actor,b.requestId,{...b,op:'retire'},async c=>{
  const [r]=await query('SELECT * FROM layout_library_resources WHERE id=$1 FOR UPDATE',[b.id],c)
  if(!r||!own(r,actor))throw fail('版式资源不存在。',404)
  if(r.version!==b.expectedVersion)throw fail('资源版本已变化。',409)
  await c.query('UPDATE layout_library_resources SET retired=true WHERE id=$1',[b.id]);return {id:b.id,retired:true}
 })}
 async function requestShare(actor,b){return mutation(actor,b.requestId,{...b,op:'share-request'},async c=>{
  const x=await get(actor,b.id,b.version,c)
  if(x.ownerId!==actor.id||x.latestVersion!==b.version)throw fail('只能申请共享自己的当前版本。',409)
  await activeResource(b.id,c)
  if(!x.package.rights.shareAllowed||x.package.rights.basis==='unknown')throw fail('请先补充共享授权声明。',409)
  await c.query('UPDATE layout_library_resources SET share_requested=true WHERE id=$1',[b.id]);return {id:b.id,status:'pending-admin-review'}
 })}
 async function changeDeletion(actor,b,restore=false){
  return mutation(actor,b.requestId,{...b,op:restore?'restore':'delete'},async c=>{
   if(b.kind==='resource'){
    const [r]=await query('SELECT * FROM layout_library_resources WHERE id=$1 FOR UPDATE',[b.id],c)
    if(!r||!own(r,actor))throw fail('版式资源不存在。',404)
    if(!restore&&r.version!==b.expectedVersion)throw fail('版式已有新版本，请刷新后删除。',409)
   }else{
    const [root]=await query("SELECT id FROM jobs WHERE id=$1 AND owner_id=$2 AND kind='layout-reference' FOR UPDATE",[b.id,actor.id],c)
    if(!root)throw fail('版式草稿不存在。',404)
    if(!restore){
     const linked=await query("SELECT id FROM jobs WHERE owner_id=$1 AND kind='layout-reference' AND (id=$2 OR payload->>'conversationId'=$2::text) AND (result->>'id' IS NOT NULL OR payload->'baseResource'->>'id' IS NOT NULL)",[actor.id,b.id],c)
     if(linked.length)throw fail('版式已经保存，请从对应版式卡片删除。',409)
    }
   }
   const existing=await isRemoved(b.kind,b.id,c)
   if(restore){
    if(existing!==b.deleteToken)throw fail('删除记录已变化，请刷新后重试。',409)
    await c.query('DELETE FROM layout_library_deletions WHERE target_kind=$1 AND target_id=$2',[b.kind,b.id]);return {id:b.id,restored:true}
   }
   const deleteToken=existing??randomUUID()
   if(!existing)await c.query('INSERT INTO layout_library_deletions(target_kind,target_id,delete_token,deleted_by) VALUES($1,$2,$3,$4)',[b.kind,b.id,deleteToken,actor.id])
   return {id:b.id,deleted:true,deleteToken}
  })
 }
 async function bindings(p,c=db){
  const [r]=await query('SELECT * FROM layout_project_bindings WHERE project_id=$1',[p.id],c)
  return r?{revision:r.revision,draftId:r.draft_id,...r.document}:{revision:0,draftId:null,global:null,local:{},manual:{}}
 }
 async function freezeRef(actor,ref,c,{preview=false}={}){
  if(!ref)return null
  const x=await get(actor,ref.resourceId,ref.version,c)
  if(x.deleted||x.retired||!x.published&&x.ownerId!==actor.id)throw fail('请选择未删除的个人版式或已发布的共享版式。',409)
  if(!preview)assertReferenceReviewed(x)
  return {resourceId:x.id,version:x.version,hash:x.hash,package:x.package}
 }
 async function saveBindings(actor,p,b,draft){
  if(!draft||draft.stale||draft.id!==b.draftId)throw fail('稿件已变化，请重新选择当前页。',409)
  const pages=draft.flow.flatMap(ch=>draft.blocks.filter(bl=>bl.chapterId===ch).flatMap(bl=>(bl.items??[]).map(item=>({id:'visual-page-'+item.id,item}))))
  return mutation(actor,b.requestId,{...b,op:'bindings',projectId:p.id},async c=>{
   await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[p.id])
   const previous=await bindings(p,c)
   if(previous.revision!==b.expectedRevision)throw fail('版式配置已更新，请刷新后重试。',409)
   const same=previous.draftId===draft.id
   const doc={global:same?previous.global:null,globalOverrides:same?{...previous.globalOverrides}:{},local:same?structuredClone(previous.local):{},manual:same?structuredClone(previous.manual):{},reviewPageIds:same?[...previous.reviewPageIds??[]]:[]}
   if(b.scope==='global'){doc.global=await freezeRef(actor,b.resource,c);doc.globalOverrides=patchSchema.parse(b.overrides??{})}
   else{
    if(!b.pageIds?.length||b.pageIds.some(id=>!pages.some(p=>p.id===id)))throw fail('选择页面不属于当前稿件。',404)
    for(const id of b.pageIds){
     doc.reviewPageIds=doc.reviewPageIds.filter(pageId=>pageId!==id)
     if(b.scope==='manual'){
      if(b.remove)delete doc.manual[id];else doc.manual[id]={...(doc.manual[id]??{}),...patchSchema.parse(b.overrides??{}),theme:{...doc.manual[id]?.theme,...b.overrides?.theme}}
     }else if(b.scope==='local'){
      if(b.remove)delete doc.local[id];else doc.local[id]={resource:await freezeRef(actor,b.resource,c),overrides:patchSchema.parse(b.overrides??{})}
     }else throw fail('绑定范围不合法。')
    }
   }
   for(const page of pages)resolvePage({page,globalPackage:doc.global?.package,globalOverrides:doc.globalOverrides,local:{package:doc.local[page.id]?.resource?.package,overrides:doc.local[page.id]?.overrides},manual:doc.manual[page.id]})
   const revision=previous.revision+1
   await c.query('INSERT INTO layout_project_bindings(project_id,draft_id,revision,document) VALUES($1,$2,$3,$4) ON CONFLICT(project_id) DO UPDATE SET draft_id=excluded.draft_id,revision=excluded.revision,document=excluded.document,updated_at=now()',[p.id,draft.id,revision,doc])
   await c.query('INSERT INTO layout_binding_versions(project_id,revision,draft_id,document) VALUES($1,$2,$3,$4)',[p.id,revision,draft.id,doc])
   return {revision,draftId:draft.id,status:'saved-pending-apply'}
  })
 }
 function compilePages(pages,config){
  return pages.map(page=>{
   const local=config.local[page.id],refs=[config.global,local?.resource].filter(Boolean).map(r=>({resourceId:r.resourceId,version:r.version,hash:r.hash}))
   const manual={...(page.protectedLayout??{}),...(config.manual[page.id]??{}),theme:{...page.protectedLayout?.theme,...config.manual[page.id]?.theme}}
   const nativeLayout=resolvePage({page,globalPackage:config.global?.package,globalOverrides:config.globalOverrides,local:{package:local?.resource?.package,overrides:local?.overrides},manual,resourceRefs:refs})
   return {...page,nativeLayout}
  })
 }
 // The draft writer owns the project lock and transaction.
 async function carryBindings(p,previous,draft,c){
  const [row]=await query('SELECT * FROM layout_project_bindings WHERE project_id=$1 FOR UPDATE',[p.id],c)
  if(!row||row.draft_id!==previous.id)return
  const ids=new Set(draft.blocks.flatMap(block=>(block.items??[]).map(item=>'visual-page-'+item.id)))
  const oldBlock=previous.document.blocks.find(block=>block.id===draft.changedBlockId),newBlock=draft.blocks.find(block=>block.id===draft.changedBlockId)
  // Whole-section generation assigns item IDs by position. A rewritten multi-page
  // section cannot safely reuse those IDs as evidence of page identity.
  const ambiguous=!draft.changedItemId&&Math.max(oldBlock?.items?.length??0,newBlock?.items?.length??0)>1&&JSON.stringify(oldBlock?.items)!==JSON.stringify(newBlock?.items)
  const resetIds=new Set(ambiguous?[...oldBlock?.items??[],...newBlock?.items??[]].map(item=>'visual-page-'+item.id):[])
  const hadBindings=[...resetIds].some(id=>row.document.local?.[id]||row.document.manual?.[id])
  const reviewPageIds=[...new Set([...(row.document.reviewPageIds??[]),...(hadBindings?[...resetIds]:[])])].filter(id=>ids.has(id))
  const keep=([id])=>ids.has(id)&&!resetIds.has(id)
  const document={...row.document,local:Object.fromEntries(Object.entries(row.document.local??{}).filter(keep)),
   manual:Object.fromEntries(Object.entries(row.document.manual??{}).filter(keep)),reviewPageIds,carriedFromDraftId:previous.id}
  const revision=row.revision+1
  await c.query('UPDATE layout_project_bindings SET draft_id=$2,revision=$3,document=$4,updated_at=now() WHERE project_id=$1',[p.id,draft.id,revision,document])
  await c.query('INSERT INTO layout_binding_versions(project_id,revision,draft_id,document) VALUES($1,$2,$3,$4)',[p.id,revision,draft.id,document])
 }
 async function confirmReferenceReview(actor,body){
  return mutation(actor,body.requestId,{...body,op:'reference-review'},async c=>{
   await c.query('SELECT id FROM layout_library_resources WHERE id=$1 FOR UPDATE',[body.id])
   return reviews.confirm(actor,body,c)
  })
 }
 return {referenceComparison:reviews.comparison,confirmReferenceReview,previewRef:(actor,ref)=>freezeRef(actor,ref,undefined,{preview:true}),sourceFile,list,get,create,revise,saveValidation,publish,retire,requestShare,bindings,saveBindings,carryBindings,compilePages,freezeRef,exportReusable,isRemoved,remove:(actor,b)=>changeDeletion(actor,b),restore:(actor,b)=>changeDeletion(actor,b,true)}
}
