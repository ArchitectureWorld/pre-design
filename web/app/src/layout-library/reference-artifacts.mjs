import {open,realpath} from 'node:fs/promises'
import {constants} from 'node:fs'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
export const MAX_PRIVATE_ARTIFACT_BYTES=64*1024*1024
export const MAX_PRIVATE_ARTIFACT_FILES=12000
export const artifactPathValid=p=>typeof p==='string'&&p.length>0&&p.length<512&&!p.startsWith('/')&&!/[\\:\x00-\x1f]/.test(p)&&p.split('/').every(s=>s&&s!=='.'&&s!=='..')
const invalid=()=>Object.assign(Error('参考设计产物已变化、越界或超过私有存储上限。'),{code:'REFERENCE_ARTIFACT_INVALID',statusCode:409})
export function validatePrivateArtifacts(artifacts){
 if(!Array.isArray(artifacts)||artifacts.length>MAX_PRIVATE_ARTIFACT_FILES)throw invalid()
 const seen=new Set();let total=0
 for(const a of artifacts){
  if(!artifactPathValid(a.path)||a.path.startsWith('sources/')||seen.has(a.path)||!Buffer.isBuffer(a.data)||a.bytes!==a.data.length||createHash('sha256').update(a.data).digest('hex')!==a.sha256)throw invalid()
  total+=a.bytes;if(total>MAX_PRIVATE_ARTIFACT_BYTES)throw invalid();seen.add(a.path)
 }
 return artifacts
}
/** Capture private, inert bytes before importer temp cleanup. No SVG rendering,
 * public URL, package embedding or original source copies are permitted here. */
export async function captureReferenceArtifacts({workspace,inventory,signal}){
 signal?.throwIfAborted()
 const root=resolve(workspace);if(await realpath(root)!==root)throw invalid()
 if(!Array.isArray(inventory?.files)||inventory.files.length>MAX_PRIVATE_ARTIFACT_FILES)throw invalid()
 const result=[];let total=0
 for(const item of inventory.files){
  signal?.throwIfAborted()
  if(!artifactPathValid(item.path)||!Number.isSafeInteger(item.bytes)||item.bytes<0||!(/^[a-f0-9]{64}$/).test(item.sha256??''))throw invalid()
  if(item.path.startsWith('sources/'))continue
  total+=item.bytes;if(total>MAX_PRIVATE_ARTIFACT_BYTES)throw invalid()
  const path=join(root,item.path);if(await realpath(path)!==path)throw invalid()
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW)
  try{
   const stat=await handle.stat();if(!stat.isFile()||stat.size!==item.bytes)throw invalid()
   const data=await handle.readFile({signal});result.push({...item,data})
  }finally{await handle.close()}
 }
 return validatePrivateArtifacts(result)
}
