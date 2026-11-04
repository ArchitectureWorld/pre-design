import {mkdir,open,realpath,rm,rmdir} from 'node:fs/promises'
import {constants} from 'node:fs'
import {join,extname} from 'node:path'
import {createHash} from 'node:crypto'
export const MAX_UPLOAD_BYTES=512*1024*1024
const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode})
export function validateMaterialPath(filename,relativePath=filename){
 const parts=relativePath.split('/')
 if(!filename||Buffer.byteLength(relativePath)>2048||parts.length>32||/^[a-z]:/i.test(relativePath)||/[\\\x00-\x1f\x7f]/u.test(relativePath)||parts.some(p=>!p||p==='.'||p==='..'||Buffer.byteLength(p)>255)||parts.at(-1)!==filename||filename.includes('/'))throw fail(400,'文件路径不合法，请使用文件夹内的相对路径')
 return relativePath
}
export async function writeMaterialStream(workspace,id,relativePath,source,maxBytes=MAX_UPLOAD_BYTES){
 if(!/^[a-zA-Z0-9_-]+$/.test(id))throw fail(400,'资料编号不合法')
 const parts=relativePath.split('/');validateMaterialPath(parts.at(-1),relativePath)
 let directory=join(workspace,'原始资料')
 if(await realpath(directory)!==directory)throw fail(409,'资料目录不是安全目录')
 // Check every component before traversing further. The UUID leaf preserves full filenames.
 for(const segment of [...parts.slice(0,-1),id]){
  directory=join(directory,segment);try{await mkdir(directory,{mode:0o700})}catch(e){if(e.code!=='EEXIST')throw e}
  if(await realpath(directory)!==directory)throw fail(409,'资料目录不是安全目录')
 }
 const path=join(directory,parts.at(-1)),digest=createHash('sha256');let handle,bytes=0
 try{
  handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600)
  for await(const chunk of source.iterator?source.iterator({destroyOnReturn:false}):source){
   bytes+=chunk.length;if(bytes>maxBytes)throw fail(413,'单个文件超过512 MB，请拆分后上传')
   digest.update(chunk);await handle.writeFile(chunk)
  }
  await handle.sync();await handle.close();handle=null
  return {path,bytes,sha256:digest.digest('hex')}
 }catch(error){if(handle){await handle.close().catch(()=>{});await rm(path,{force:true});await rmdir(directory).catch(()=>{})}source.resume?.();throw error}
}
export function materialProcessing(filename,bytes,image){
 const ext=extname(filename).toLowerCase(),raster=['.png','.jpg','.jpeg','.webp'].includes(ext)
 const readable=['.pdf','.txt','.md','.csv','.json','.geojson','.yaml','.yml','.xml'].includes(ext)
 if(bytes===0)return {status:'empty',label:'空文件已保存'}
 if(!readable&&!raster)return {status:'conversion_required',label:'已保存，待转换或专用解析'}
 if(bytes>64*1024*1024)return {status:'conversion_required',label:'已保存，解析前需拆分'}
 if(raster)return {status:image?'readable':'metadata_pending',label:'已保存，可尝试读取影像元数据'}
 return {status:'readable',label:'已保存，可尝试解析'}
}
export async function openVerifiedMaterial(workspace,file){
 if(await realpath(file.path)!==file.path||!file.path.startsWith(`${workspace}/原始资料/`))throw fail(409,'资料路径已变化')
 const handle=await open(file.path,constants.O_RDONLY|constants.O_NOFOLLOW)
 try{
  const digest=createHash('sha256')
  for await(const chunk of handle.createReadStream({autoClose:false}))digest.update(chunk)
  if(digest.digest('hex')!==file.sha256)throw fail(409,'原件校验失败')
  return handle
 }catch(error){await handle.close();throw error}
}
