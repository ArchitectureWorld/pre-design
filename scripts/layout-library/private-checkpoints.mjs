import {mkdir,realpath,open,writeFile,link,rm} from 'node:fs/promises'
import {constants} from 'node:fs'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
const invalid=()=>Object.assign(Error('PRIVATE_CHECKPOINT_INVALID'),{code:'PRIVATE_CHECKPOINT_INVALID'})
export async function privateCheckpointStore(directory){
 if(typeof directory!=='string'||!directory.startsWith('/'))throw invalid()
 await mkdir(directory,{recursive:true,mode:0o700});if(await realpath(directory)!==resolve(directory))throw invalid()
 const path=key=>{if(!/^[a-f0-9]{64}$/.test(key??''))throw invalid();return join(directory,key+'.json')}
 const get=async key=>{
  let handle
  try{handle=await open(path(key),constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await handle.stat();if(!stat.isFile()||stat.size>16*1024*1024)throw invalid();return JSON.parse(await handle.readFile('utf8'))}
  catch(error){if(error.code==='ENOENT')return undefined;throw error}finally{await handle?.close()}
 }
 return {get,put:async(key,record)=>{
  const target=path(key),temp=join(directory,'.pending-'+randomUUID()),text=JSON.stringify(record)
  if(record?.key!==key||Buffer.byteLength(text)>16*1024*1024)throw invalid()
  try{await writeFile(temp,text,{mode:0o600,flag:'wx'});try{await link(temp,target)}catch(error){if(error.code!=='EEXIST')throw error;if((await get(key))?.recordHash!==record.recordHash)throw invalid()}}
  finally{await rm(temp,{force:true})}
 }}
}
