import{createHash,randomUUID}from'node:crypto'
import{mkdir,realpath,writeFile,open,rm}from'node:fs/promises'
import{constants}from'node:fs'
import{join,resolve}from'node:path'
import{fail}from'./contract.mjs'

export const MAX_REFERENCE_UPLOAD_BYTES=24*1024*1024
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
 function describe(row){const d=typeof row.document==='string'?JSON.parse(row.document):row.document;return {id:row.id,name:row.filename,sha256:row.sha256,bytes:row.bytes,mimeType:row.mime_type,kind:d.kind,text:d.text,hasImages:d.images.length>0,imageCount:d.images.length,pageCount:d.pageCount,readPages:d.readPages,limitations:d.limitations,summary:d.summary}}
 async function record(actor,id,c=db){
  if(!uuid.test(id??''))throw fail('参考文件不存在。',404)
  const [row]=await query('SELECT * FROM layout_reference_uploads WHERE id=$1 AND owner_id=$2',[id,actor.id],c)
  if(!row)throw fail('参考文件不存在。',404)
  return row
 }
 async function create(actor,input){
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(input.requestId??''))throw fail('请求编号不合法。')
  if(typeof input.filename!=='string'||!input.filename.trim()||input.filename.length>180||/[\x00-\x1f\x7f/\\]/u.test(input.filename))throw fail('参考文件名不合法。')
  if(typeof input.content!=='string'||input.content.length>Math.ceil(MAX_REFERENCE_UPLOAD_BYTES/3)*4)throw fail('参考文件上限24 MiB。',413)
  if(!input.content.length||input.content.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.content))throw fail('文件上传内容不完整，请重新上传。')
  const bytes=Buffer.from(input.content,'base64');if(!bytes.length||bytes.length>MAX_REFERENCE_UPLOAD_BYTES)throw fail('参考文件为空或超过24 MiB。',413)
  const sha256=hash(bytes),fingerprint=hash(JSON.stringify({filename:input.filename,sha256}))
  const [previous]=await query('SELECT * FROM layout_reference_uploads WHERE owner_id=$1 AND request_id=$2',[actor.id,input.requestId])
  if(previous){if(previous.fingerprint!==fingerprint)throw fail('上传编号已用于不同文件。',409);return {...referenceFileSummary(describe(previous)),status:'ready'}}
  const extract=extractor??(await import('./reference-document.mjs')).extractReferenceDocument
  const parsed=await extract({bytes,filename:input.filename}),id=randomUUID(),folder=join(root,id),images=[]
  if((parsed.images??[]).length>4)throw fail('参考文件解析结果超过页数上限。',413)
  await mkdir(folder,{mode:0o700})
  try{
   await writeFile(join(folder,'source'),bytes,{mode:0o600,flag:'wx'})
   for(const [index,image]of(parsed.images??[]).entries()){
    if(!Buffer.isBuffer(image.data)||image.data.length>8*1024*1024||!['image/png','image/jpeg'].includes(image.mimeType))throw fail('参考图片解析未完成。')
    const file='page-'+(index+1)+(image.mimeType==='image/png'?'.png':'.jpg')
    await writeFile(join(folder,file),image.data,{mode:0o600,flag:'wx'})
    images.push({file,mimeType:image.mimeType,width:image.width,height:image.height,page:image.page,bytes:image.data.length,sha256:hash(image.data)})
   }
   const document={kind:parsed.kind,text:parsed.text??'',images,pageCount:parsed.pageCount,readPages:parsed.readPages,limitations:parsed.limitations??[],summary:parsed.summary}
   const [saved]=await query('INSERT INTO layout_reference_uploads(id,owner_id,request_id,fingerprint,filename,sha256,bytes,mime_type,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(owner_id,request_id) DO NOTHING RETURNING *',[id,actor.id,input.requestId,fingerprint,input.filename,sha256,bytes.length,parsed.mimeType,document])
   if(saved)return {...referenceFileSummary(describe(saved)),status:'ready'}
   await rm(folder,{recursive:true,force:true})
   const [winner]=await query('SELECT * FROM layout_reference_uploads WHERE owner_id=$1 AND request_id=$2',[actor.id,input.requestId])
   if(winner?.fingerprint!==fingerprint)throw fail('上传编号已用于不同文件。',409)
   return {...referenceFileSummary(describe(winner)),status:'ready'}
  }catch(error){await rm(folder,{recursive:true,force:true});throw error}
 }
 async function get(actor,id,c=db){return describe(await record(actor,id,c))}
 async function verifiedBytes(id,file,sha256,maxBytes){
  let handle
  try{
   if(!uuid.test(id)||!/^source$|^page-\d+\.(?:jpg|png)$/.test(file))throw Error('INVALID_FILE')
   const folder=join(root,id);if(await realpath(folder)!==folder)throw Error('INVALID_PATH')
   handle=await open(join(folder,file),constants.O_RDONLY|constants.O_NOFOLLOW)
   const info=await handle.stat();if(!info.isFile()||info.size>maxBytes)throw Error('INVALID_SIZE')
   const bytes=await handle.readFile();if(bytes.length>maxBytes||hash(bytes)!==sha256)throw Error('INVALID_HASH')
   return bytes
  }catch{throw fail('参考文件已变化或不可读，请重新上传。',409)}finally{await handle?.close()}
 }
 async function download(actor,id){const row=await record(actor,id);return {name:row.filename,mimeType:row.mime_type,data:await verifiedBytes(id,'source',row.sha256,MAX_REFERENCE_UPLOAD_BYTES)}}
 async function resolveFiles(actor,files,c=db){
  const resolved=[]
  for(const file of files){
   if(file.id)resolved.push(await get(actor,file.id,c))
   else resolved.push({...file,sha256:hash(file.text),kind:'text',hasImages:false,imageCount:0})
  }
  return resolved
 }
 async function modelImages(actor,files){
  const output=[]
  for(const file of files.filter(f=>f.id)){
   const row=await record(actor,file.id),document=typeof row.document==='string'?JSON.parse(row.document):row.document
   if(row.sha256!==file.sha256)throw fail('参考文件版本已变化，请重新上传。',409)
   await verifiedBytes(row.id,'source',row.sha256,MAX_REFERENCE_UPLOAD_BYTES)
   for(const image of document.images){
    if(output.length>=16)throw fail('本轮参考超过16张页面图像，请分批分析。',413)
    const bytes=await verifiedBytes(row.id,image.file,image.sha256,8*1024*1024)
    output.push({fileId:row.id,name:row.filename,page:image.page,mimeType:image.mimeType,data:bytes.toString('base64'),sha256:image.sha256})
   }
  }
  return output
 }
 return {create,get,download,resolveFiles,modelImages}
}
