import {randomUUID} from 'node:crypto'
import {packageDigest,fail,rendererForPackage} from './contract.mjs'
import {FIXTURES_VERSION} from './validation.mjs'

export const requiresReferenceReview=pkg=>pkg.schemaVersion==='pre-design.layout-package.v2'

/** Follow the selected archetype's evidence; a cover is not evidence for every page. */
export function referencePagesForLayout(pkg,layoutId){
 const layout=pkg.layouts.find(layout=>layout.id===layoutId)
 if(!layout)throw fail('版式不存在。',404)
 const profile=pkg.designProfile
 if(!profile)return []
 const archetype=profile.archetypes.find(value=>value.id===layout.archetypeId)
 const evidence=new Map(profile.evidence.map(value=>[value.id,value])),seen=new Set(),pages=new Map()
 function visit(id){
  if(seen.has(id))return
  seen.add(id)
  const item=evidence.get(id)
  if(!item)return
  if(item.fileSha256&&Number.isSafeInteger(item.pageNumber))pages.set(item.fileSha256+':'+item.pageNumber,{fileSha256:item.fileSha256,pageNumber:item.pageNumber})
  for(const parent of item.dependsOn??[])visit(parent)
 }
 for(const id of archetype?.evidenceIds??[])visit(id)
 if(!pages.size)for(const id of profile.designSystem?.evidenceIds??[])visit(id)
 return [...pages.values()]
}

export function isReferenceReviewCurrent(resource){
 const review=resource.referenceReview,validation=resource.validation
 if(!validation||validation.status!=='passed'||validation.packageHash!==resource.hash||validation.renderer!==rendererForPackage(resource.package)||validation.fixturesVersion!==FIXTURES_VERSION||!validation.overflowGuard||!review||review.status!=='confirmed'||review.packageHash!==resource.hash||review.validationHash!==packageDigest(validation)||review.renderer!==validation.renderer)return false
 const covered=new Set(review.layoutIds??[])
 return resource.package.layouts.every(layout=>covered.has(layout.id))
}

export function assertReferenceReviewed(resource){
 if(!requiresReferenceReview(resource.package))return
 if(!isReferenceReviewCurrent(resource)){
  throw fail('请先完成当前版本的参考原页与试排对照审阅。修改版式或重新检查后需要重新确认。',409,'LAYOUT_REFERENCE_REVIEW_REQUIRED')
 }
}

/** Original bytes never enter these receipts. Original access is separately owner-scoped. */
export async function createReferenceReviews(db,getResource){
 await db.query(`CREATE TABLE IF NOT EXISTS layout_reference_comparisons(
 id uuid PRIMARY KEY,resource_id uuid NOT NULL,version integer NOT NULL,owner_id text NOT NULL,
 package_hash text NOT NULL,validation_hash text,layout_id text NOT NULL,document jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS layout_reference_reviews(
 resource_id uuid NOT NULL,version integer NOT NULL,document jsonb NOT NULL,PRIMARY KEY(resource_id,version));`)
 const query=async(sql,args=[],c=db)=>(await c.query(sql,args)).rows
 const json=value=>typeof value==='string'?JSON.parse(value):value
 async function get(id,version,c=db){
  const [row]=await query('SELECT document FROM layout_reference_reviews WHERE resource_id=$1 AND version=$2',[id,version],c)
  return row?json(row.document):null
 }
 async function current(actor,id,version,c=db){
  const resource=await getResource(actor,id,version,c)
  if(resource.ownerId!==actor.id)throw fail('请由资源拥有者对照自己的参考原页。',403)
  if(resource.latestVersion!==version||resource.deleted||resource.retired)throw fail('请审阅未删除、未归档的当前版本。',409)
  if(!requiresReferenceReview(resource.package))throw fail('旧版资源沿用原有检查流程。',409)
  return resource
 }
 async function comparison(actor,{id,version,layoutId,source,html}){
  const resource=await current(actor,id,version),references=referencePagesForLayout(resource.package,layoutId)
  if(references.length&&!references.some(p=>p.fileSha256===source?.sourceSha256&&p.pageNumber===source?.page))throw fail('对照原页与本版式的证据不一致。',409)
  if(!references.length&&source)throw fail('此版式没有对应的图像来源证据。',409)
  const receipt={id:randomUUID(),packageHash:resource.hash,validationHash:resource.validation?packageDigest(resource.validation):null,layoutId,
   prototypeHash:packageDigest(html),fixture:true,source:source?{sha256:source.sourceSha256,page:source.page,imageHash:source.sha256}:null,
   createdAt:new Date().toISOString()}
  await db.query('INSERT INTO layout_reference_comparisons(id,resource_id,version,owner_id,package_hash,validation_hash,layout_id,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [receipt.id,id,version,actor.id,resource.hash,receipt.validationHash,layoutId,receipt])
  return receipt
 }
 async function confirm(actor,body,c=db){
  const resource=await current(actor,body.id,body.version,c),validation=resource.validation
  if(!body.reviewed||body.packageHash!==resource.hash)throw fail('审阅内容已变化，请刷新后重新对照。',409)
  if(!validation||validation.status!=='passed'||validation.packageHash!==resource.hash||validation.renderer!==rendererForPackage(resource.package)||validation.fixturesVersion!==FIXTURES_VERSION||!validation.overflowGuard)throw fail('请先通过当前版本的实际页面检查。',409)
  const validationHash=packageDigest(validation),layoutIds=new Set(),comparisons=[]
  for(const id of new Set(body.comparisonIds)){
   const [row]=await query('SELECT * FROM layout_reference_comparisons WHERE id=$1 AND owner_id=$2 AND resource_id=$3 AND version=$4',[id,actor.id,body.id,body.version],c)
   if(!row||row.package_hash!==resource.hash||row.validation_hash!==validationHash)throw fail('对照记录不属于当前用户、版式版本或页面检查。请重新打开对照。',409)
   layoutIds.add(row.layout_id);comparisons.push(id)
  }
  if(resource.package.layouts.some(layout=>!layoutIds.has(layout.id)))throw fail('请逐一查看所有页面类型与参考原页，再确认风格迁移。',409)
  const review={status:'confirmed',packageHash:resource.hash,validationHash,renderer:validation.renderer,layoutIds:[...layoutIds],comparisonIds:comparisons,
   reviewedBy:actor.id,reviewedAt:new Date().toISOString(),scope:'human-reference-comparison; synthetic-prototypes; project-content-fit-checked-on-apply'}
  await c.query('INSERT INTO layout_reference_reviews(resource_id,version,document) VALUES($1,$2,$3) ON CONFLICT(resource_id,version) DO UPDATE SET document=excluded.document',[body.id,body.version,review])
  return review
 }
 return {get,comparison,confirm}
}
