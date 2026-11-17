import{createHash,randomUUID}from'node:crypto'
import{mkdir,realpath,writeFile,open,rm}from'node:fs/promises'
import{constants}from'node:fs'
import{join,resolve}from'node:path'
import{fail}from'./contract.mjs'
import{validatePrivateArtifacts,MAX_PRIVATE_ARTIFACT_BYTES}from'./reference-artifacts.mjs'
import{MAX_REFERENCE_BYTES,MAX_REFERENCE_PDF_PAGES,MAX_REFERENCE_IMAGES,MAX_REFERENCE_IMAGE_BYTES,referenceByteLimit,referenceLimitLabel}from'./reference-limits.mjs'

export const MAX_REFERENCE_UPLOAD_BYTES=MAX_REFERENCE_BYTES
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i
export function referenceFileSummary(file){
 return Object.fromEntries(['id','name','sha256','bytes','kind','mimeType','hasImages','imageCount','pageCount','readPages','summary','limitations'].filter(key=>file[key]!==undefined).map(key=>[key,file[key]]))
}
export async function createReferenceUploads(db,{root:storageRoot,extractor}={}){
 await mkdir(storageRoot,{recursive:true,mode:0o700});const root=await realpath(storageRoot)
 if(root!==resolve(storageRoot))throw Error('LAYOUT_REFERENCE_STORAGE_INVALID')
 await db.query(`CREATE TABLE IF NOT EXISTS layout_reference_uploads(
 id uuid PRIMARY KEY,owner_id text NOT NULL,request_id text NOT NULL,fingerprint text NOT NULL,
 filename text NOT NULL,sha256 text NOT NULL,bytes integer NOT NULL,mime_type text NOT NULL,
 document jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_id,request_id));`)
 const query=async(sql,params=[],c=db)=>(await c.query(sql,params)).rows
 function describe(row){const d=typeof row.document==='string'?JSON.parse(row.document):row.document;return {id:row.id,name:row.filename,sha256:row.sha256,bytes:row.bytes,mimeType:row.mime_type,kind:d.kind,text:d.text,hasImages:d.images.length>0,imageCount:d.images.length,pageCount:d.pageCount,readPages:d.readPages,limitations:d.limitations,summary:d.summary,...(d.structure?{structure:d.structure}:{}),...(d.pages?{pages:d.pages}:{}),...(d.privateArtifacts?{privateArtifacts:d.privateArtifacts}:{})}}
 async function record(actor,id,c=db){
  if(!uuid.test(id??''))throw fail('参考文件不存在。',404)
  const [row]=await query('SELECT * FROM layout_reference_uploads WHERE id=$1 AND owner_id=$2',[id,actor.id],c)
  if(!row)throw fail('参考文件不存在。',404)
  return row
 }
 function validateInput(input){
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(input.requestId??''))throw fail('请求编号不合法。')
  if(typeof input.filename!=='string'||!input.filename.trim()||input.filename.length>180||/[\x00-\x1f\x7f/\\]/u.test(input.filename))throw fail('参考文件名不合法。')
  return referenceByteLimit(input.filename)
 }
 async function create(actor,input,{signal}={}){
  signal?.throwIfAborted()
  const limit=validateInput(input)
  let bytes=input.bytes
  if(!Buffer.isBuffer(bytes)){
   if(typeof input.content!=='string'||input.content.length>Math.ceil(limit/3)*4)throw fail('参考文件上限'+referenceLimitLabel(input.filename)+'。',413)
   if(!input.content.length||input.content.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.content))throw fail('文件上传内容不完整，请重新上传。')
   bytes=Buffer.from(input.content,'base64')
  }
  if(!bytes.length)throw fail('参考文件为空。')
  if(bytes.length>limit)throw fail('参考文件上限'+referenceLimitLabel(input.filename)+'。',413)
  const sha256=hash(bytes),fingerprint=hash(JSON.stringify({filename:input.filename,sha256}))
  const [previous]=await query('SELECT * FROM layout_reference_uploads WHERE owner_id=$1 AND request_id=$2',[actor.id,input.requestId])
  signal?.throwIfAborted()
  if(previous){if(previous.fingerprint!==fingerprint)throw fail('上传编号已用于不同文件。',409);return {...referenceFileSummary(describe(previous)),status:'ready'}}
  const extract=extractor??(await import('./reference-document.mjs')).extractReferenceDocument
  const parsed=await extract({bytes,filename:input.filename,signal}),id=randomUUID(),folder=join(root,id),images=[]
  signal?.throwIfAborted()
  if((parsed.images??[]).length>MAX_REFERENCE_PDF_PAGES)throw fail('参考文件解析结果超过页数上限。',413)
  await mkdir(folder,{mode:0o700})
  try{
   await writeFile(join(folder,'source'),bytes,{mode:0o600,flag:'wx',signal})
   for(const [index,image]of(parsed.images??[]).entries()){
    signal?.throwIfAborted()
    if(!Buffer.isBuffer(image.data)||image.data.length>8*1024*1024||!['image/png','image/jpeg'].includes(image.mimeType))throw fail('参考图片解析未完成。')
    const file='page-'+(index+1)+(image.mimeType==='image/png'?'.png':'.jpg')
    await writeFile(join(folder,file),image.data,{mode:0o600,flag:'wx',signal})
    images.push({file,mimeType:image.mimeType,width:image.width,height:image.height,page:image.page,bytes:image.data.length,sha256:hash(image.data)})
   }
   const privateArtifacts=[]
   for(const [index,artifact] of validatePrivateArtifacts(parsed.privateArtifacts??[]).entries()){
    signal?.throwIfAborted()
    const file='artifact-'+(index+1)
    await writeFile(join(folder,file),artifact.data,{mode:0o600,flag:'wx',signal})
    privateArtifacts.push({path:artifact.path,file,sha256:artifact.sha256,bytes:artifact.bytes})
   }
   const document={privateArtifacts,kind:parsed.kind,text:parsed.text??'',images,pageCount:parsed.pageCount,readPages:parsed.readPages,limitations:parsed.limitations??[],summary:parsed.summary,...(parsed.structure?{structure:parsed.structure}:{}),...(parsed.pages?{pages:parsed.pages}:{})}
   signal?.throwIfAborted()
   const [saved]=await query('INSERT INTO layout_reference_uploads(id,owner_id,request_id,fingerprint,filename,sha256,bytes,mime_type,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(owner_id,request_id) DO NOTHING RETURNING *',[id,actor.id,input.requestId,fingerprint,input.filename,sha256,bytes.length,parsed.mimeType,document])
   if(saved)return {...referenceFileSummary(describe(saved)),status:'ready'}
   await rm(folder,{recursive:true,force:true})
   const [winner]=await query('SELECT * FROM layout_reference_uploads WHERE owner_id=$1 AND request_id=$2',[actor.id,input.requestId])
   if(winner?.fingerprint!==fingerprint)throw fail('上传编号已用于不同文件。',409)
   return {...referenceFileSummary(describe(winner)),status:'ready'}
  }catch(error){await rm(folder,{recursive:true,force:true});throw error}
 }
 async function createFromStream(actor,input,stream,declaredLength,{signal}={}){
  signal?.throwIfAborted()
  const limit=validateInput(input)
  if(declaredLength!==undefined&&(!Number.isSafeInteger(declaredLength)||declaredLength<0))throw fail('上传长度不合法。')
  if(declaredLength>limit)throw fail('参考文件上限'+referenceLimitLabel(input.filename)+'。',413)
  const chunks=[];let count=0
  const abort=()=>stream.destroy?.(signal.reason)
  signal?.addEventListener('abort',abort,{once:true})
  try{
   signal?.throwIfAborted()
   for await(const value of stream){
    signal?.throwIfAborted()
    const chunk=Buffer.isBuffer(value)?value:Buffer.from(value)
    count+=chunk.length
    if(count>limit)throw fail('参考文件上限'+referenceLimitLabel(input.filename)+'。',413)
    chunks.push(chunk)
   }
   if(declaredLength!==undefined&&count!==declaredLength)throw fail('文件未完整上传，请重试。')
   const bytes=Buffer.concat(chunks,count);chunks.length=0
   signal?.removeEventListener('abort',abort)
   return await create(actor,{...input,bytes},{signal})
  }catch(error){chunks.length=0;if(signal?.aborted)throw signal.reason;if(error.statusCode)throw error;throw fail('文件上传中断，请重试。',400)}
  finally{signal?.removeEventListener('abort',abort)}
 }
 async function get(actor,id,c=db){return describe(await record(actor,id,c))}
 async function verifiedBytes(id,file,sha256,maxBytes){
  let handle
  try{
   if(!uuid.test(id)||!/^(?:source|page-\d+\.(?:jpg|png)|artifact-\d+)$/.test(file))throw Error('INVALID_FILE')
   const folder=join(root,id);if(await realpath(folder)!==folder)throw Error('INVALID_PATH')
   handle=await open(join(folder,file),constants.O_RDONLY|constants.O_NOFOLLOW)
   const info=await handle.stat();if(!info.isFile()||info.size>maxBytes)throw Error('INVALID_SIZE')
   const bytes=await handle.readFile();if(bytes.length>maxBytes||hash(bytes)!==sha256)throw Error('INVALID_HASH')
   return bytes
  }catch{throw fail('参考文件已变化或不可读，请重新上传。',409)}finally{await handle?.close()}
 }
 async function artifact(actor,id,path){
  const row=await record(actor,id),document=typeof row.document==='string'?JSON.parse(row.document):row.document
  const a=document.privateArtifacts?.find(a=>a.path===path)
  if(!a)throw fail('参考设计产物不存在。',404)
  return {path:a.path,sha256:a.sha256,bytes:a.bytes,data:await verifiedBytes(id,a.file,a.sha256,MAX_PRIVATE_ARTIFACT_BYTES)}
 }
 async function download(actor,id){const row=await record(actor,id);return {name:row.filename,mimeType:row.mime_type,data:await verifiedBytes(id,'source',row.sha256,MAX_REFERENCE_UPLOAD_BYTES)}}
 async function preview(actor,id,page){
  const row=await record(actor,id),document=typeof row.document==='string'?JSON.parse(row.document):row.document
  if(!Number.isSafeInteger(page)||page<1)throw fail('参考页码不合法。')
  const image=document.images.find(image=>(image.page??1)===page)
  if(!image)throw fail('此页没有已读取的参考图像。',404)
  const data=await verifiedBytes(id,image.file,image.sha256,8*1024*1024)
  return {fileId:id,name:row.filename,sourceSha256:row.sha256,page,mimeType:image.mimeType,width:image.width,height:image.height,sha256:image.sha256,data}
 }
 async function previewBySource(actor,sha256,page){
  if(!/^[a-f0-9]{64}$/.test(sha256??''))throw fail('参考来源指纹不合法。')
  const [row]=await query('SELECT id FROM layout_reference_uploads WHERE owner_id=$1 AND sha256=$2 ORDER BY created_at DESC LIMIT 1',[actor.id,sha256])
  if(!row)throw fail('当前账号没有该参考原页。请上传对应原件后对照。',404)
  return preview(actor,row.id,page)
 }
 async function resolveFiles(actor,files,c=db){
  const resolved=[]
  for(const file of files){
   if(file.id)resolved.push(await get(actor,file.id,c))
   else resolved.push({...file,sha256:hash(file.text),kind:'text',hasImages:false,imageCount:0})
  }
  return resolved
 }
 async function imageManifest(actor,files){
  const output=[]
  for(const file of files.filter(f=>f.id)){
   const row=await record(actor,file.id),document=typeof row.document==='string'?JSON.parse(row.document):row.document
   if(row.sha256!==file.sha256)throw fail('参考原件已变化。',409)
   await verifiedBytes(row.id,'source',row.sha256,MAX_REFERENCE_UPLOAD_BYTES)
   for(const image of document.images)output.push({fileId:row.id,name:row.filename,sourceSha256:row.sha256,page:image.page,mimeType:image.mimeType,width:image.width,height:image.height,sha256:image.sha256,bytes:image.bytes})
  }
  return output
 }
 async function loadImageBatch(actor,manifest){
  if(!Array.isArray(manifest)||manifest.length>6)throw fail('每个视觉批次最多6张图像。',413)
  const output=[];let total=0
  for(const entry of manifest){
   const image=await preview(actor,entry.fileId,entry.page)
   if(image.sourceSha256!==entry.sourceSha256||image.sha256!==entry.sha256)throw fail('参考页面版本已变化。',409)
   total+=image.data.length;if(total>48*1024*1024)throw fail('视觉批次超过48 MiB。',413)
   output.push({...image,data:image.data.toString('base64')})
  }
  return output
 }
 async function ensureDocumentPages(actor,id,pdfStartPage,{signal}={}){
  if(!Number.isSafeInteger(pdfStartPage)||pdfStartPage<1)throw fail('PDF续读页码不合法。')
  const c=await db.connect(),created=[];let commitAttempted=false
  try{
   await c.query('BEGIN')
   // Lock this upload only. Other users and other references remain independent.
   await c.query('SELECT id FROM layout_reference_uploads WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,actor.id])
   const row=await record(actor,id,c),document=typeof row.document==='string'?JSON.parse(row.document):row.document
   if(!['pdf','pptx'].includes(document.kind)||pdfStartPage>document.pageCount)throw fail('PDF续读范围不合法。')
   const wanted=Array.from({length:Math.min(MAX_REFERENCE_PDF_PAGES,document.pageCount-pdfStartPage+1)},(_,i)=>pdfStartPage+i)
   if(wanted.every(page=>document.readPages.includes(page))){await c.query('COMMIT');return referenceFileSummary(describe(row))}
   const bytes=await verifiedBytes(id,'source',row.sha256,MAX_REFERENCE_UPLOAD_BYTES)
   const extract=extractor??(await import('./reference-document.mjs')).extractReferenceDocument
   const parsed=await extract({bytes,filename:row.filename,signal,...(document.kind==='pdf'?{pdfStartPage}:{pptxStartPage:pdfStartPage})})
   if(parsed.kind!==document.kind||(document.kind==='pptx'&&(!parsed.previewOnly||parsed.sourceSha256!==row.sha256))||parsed.pageCount!==document.pageCount||JSON.stringify(parsed.readPages)!==JSON.stringify(wanted)||parsed.images.length!==wanted.length)throw fail('PDF续读结果范围不一致。',409)
   const seen=new Set(),images=[...document.images],pages=[...(document.pages??[])]
   for(const image of parsed.images){
    signal?.throwIfAborted()
    if(!wanted.includes(image.page)||seen.has(image.page)||!Buffer.isBuffer(image.data)||image.data.length>8*1024*1024||!['image/png','image/jpeg'].includes(image.mimeType))throw fail('PDF续读图像不完整。',409)
    seen.add(image.page)
    if(images.some(old=>old.page===image.page))continue
    const file='page-'+String(image.page).padStart(6,'0')+(image.mimeType==='image/png'?'.png':'.jpg'),path=join(root,id,file)
    let handle
    try{handle=await open(path,'wx',0o600);created.push(path)}catch(error){
     if(error.code!=='EEXIST')throw error
     // A previous COMMIT acknowledgement may have been lost. Adopt only the
     // exact regenerated page bytes under the same verified original, never overwrite.
     await verifiedBytes(id,file,hash(image.data),8*1024*1024)
    }
    if(handle)try{await handle.writeFile(image.data,{signal})}finally{await handle.close()}
    images.push({file,page:image.page,mimeType:image.mimeType,width:image.width,height:image.height,bytes:image.data.length,sha256:hash(image.data)})
    const page=parsed.pages?.find(p=>(p.page??p.pageNumber)===image.page);if(!page)throw fail('续读缺少分页记录。',409)
    const priorIndex=pages.findIndex(p=>(p.page??p.pageNumber)===image.page)
    if(priorIndex>=0){const prior=pages[priorIndex];if(['masterId','layoutId'].some(key=>prior[key]!==undefined&&prior[key]!==page[key]))throw fail('续读改变了原生页面继承身份。',409);pages[priorIndex]={...prior,...page,preview:true}}else pages.push(page)
   }
   const readPages=images.map(image=>image.page).sort((a,b)=>a-b)
   const updated={...document,text:'',images:images.sort((a,b)=>a.page-b.page),pages:pages.sort((a,b)=>(a.page??a.pageNumber)-(b.page??b.pageNumber)),readPages,limitations:[...new Set([...(document.limitations??[]),...(parsed.limitations??[]),'分页提取历史说明按各批次记录；当前总提取范围以readPages为准，提取不等于模型观察或设计综合。'])],summary:`${document.kind.toUpperCase()} 共 ${document.pageCount} 页，已生成 ${readPages.length} 页预览；模型观察与设计综合另行计数。`}
   signal?.throwIfAborted()
   await c.query('UPDATE layout_reference_uploads SET document=$2 WHERE id=$1',[id,updated]);commitAttempted=true;await c.query('COMMIT')
   return referenceFileSummary(describe({...row,document:updated}))
  }catch(error){await c.query('ROLLBACK').catch(()=>{});if(!commitAttempted)for(const path of created)await rm(path,{force:true});throw error}finally{c.release()}
 }
 async function ensurePdfPages(actor,id,start,options){if((await get(actor,id)).kind!=='pdf')throw fail('分页续读仅支持PDF。');return ensureDocumentPages(actor,id,start,options)}
 async function validateImageBudget(actor,files,c=db){
  let count=0,total=0
  for(const file of files.filter(f=>f.id)){
   const row=await record(actor,file.id,c),document=typeof row.document==='string'?JSON.parse(row.document):row.document
   if(row.sha256!==file.sha256)throw fail('参考文件版本已变化，请重新上传。',409)
   for(const image of document.images){
    count++;total+=image.bytes
    if(!Number.isSafeInteger(image.bytes)||image.bytes<0)throw fail('参考图像记录不完整，请重新上传。',409)
   }
  }
  if(count>MAX_REFERENCE_IMAGES)throw fail('本轮参考超过'+MAX_REFERENCE_IMAGES+'张页面图像，请分批分析。',413)
  if(total>MAX_REFERENCE_IMAGE_BYTES)throw fail('本轮参考图像总量超过200 MiB，请减少参考文件后重试。',413)
 }
 async function modelImages(actor,files){
  await validateImageBudget(actor,files)
  const output=[];let total=0
  for(const file of files.filter(f=>f.id)){
   const row=await record(actor,file.id),document=typeof row.document==='string'?JSON.parse(row.document):row.document
   if(row.sha256!==file.sha256)throw fail('参考文件版本已变化，请重新上传。',409)
   await verifiedBytes(row.id,'source',row.sha256,MAX_REFERENCE_UPLOAD_BYTES)
   for(const image of document.images){
    if(output.length>=MAX_REFERENCE_IMAGES)throw fail('本轮参考超过'+MAX_REFERENCE_IMAGES+'张页面图像，请分批分析。',413)
    const bytes=await verifiedBytes(row.id,image.file,image.sha256,8*1024*1024)
    total+=bytes.length
    if(total>MAX_REFERENCE_IMAGE_BYTES)throw fail('本轮参考图像总量超过200 MiB，请减少参考文件后重试。',413)
    output.push({fileId:row.id,name:row.filename,page:image.page,mimeType:image.mimeType,width:image.width,height:image.height,data:bytes.toString('base64'),sha256:image.sha256})
   }
  }
  return output
 }
 return {create,createFromStream,get,download,artifact,preview,previewBySource,resolveFiles,validateImageBudget,modelImages,ensurePdfPages,ensureDocumentPages,imageManifest,loadImageBatch}
}
