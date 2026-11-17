// Pure private checkpoint serialization/integrity. Ownership and durable storage belong to the caller.
import {createHash} from 'node:crypto'
export const REFERENCE_CHECKPOINT_VERSION='pre-design.reference-stage-checkpoint.v1'
export const REFERENCE_WORKFLOW_CHECKPOINT_VERSION='pre-design.reference-workflow-checkpoint.v1'
const invalid=()=>Object.assign(new Error('参考阶段检查点损坏或不匹配，未复用也未重新调用模型。'),{code:'REFERENCE_CHECKPOINT_INVALID',statusCode:409})
const canonical=value=>{
 const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v
 try{return JSON.stringify(sort(JSON.parse(JSON.stringify(value))))}catch{throw invalid()}
}
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex')
const clone=value=>JSON.parse(canonical(value))
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
export function referenceStageCheckpointKey({workflowVersion=REFERENCE_WORKFLOW_CHECKPOINT_VERSION,kind,prompt,policy,input,images=[]}){
 const imageFacts=images.map(image=>{
  if(!validHash(image.sourceSha256))throw invalid()
  if(typeof image.data!=='string'||!image.data.length||!(/^[A-Za-z0-9+/]*={0,2}$/).test(image.data))throw invalid()
  const bytes=Buffer.from(image.data,'base64')
  if(!bytes.length)throw invalid()
  // fileId is only a transport handle; the caller resolves it to the source hash.
  const {data,fileId,bytes:declaredBytes,...metadata}=image
  return {...metadata,dataSha256:createHash('sha256').update(bytes).digest('hex')}
 })
 return digest({workflowVersion,kind,prompt,policy:policy??null,input,images:imageFacts})
}
export function createReferenceStageCheckpoint(key,raw,execution){
 if(!validHash(key))throw invalid()
 const record={schemaVersion:REFERENCE_CHECKPOINT_VERSION,key,status:'completed',raw:clone(raw),execution:clone(execution),rawHash:digest(raw),executionHash:digest(execution)}
 return {...record,recordHash:digest(record)}
}
export function readReferenceStageCheckpoint(key,record){
 if(!record||typeof record!=='object'||Array.isArray(record))throw invalid()
 const expected=['schemaVersion','key','status','raw','execution','rawHash','executionHash','recordHash'].sort()
 if(Object.keys(record).sort().join('|')!==expected.join('|')||record.schemaVersion!==REFERENCE_CHECKPOINT_VERSION||record.key!==key||!validHash(key)||record.status!=='completed')throw invalid()
 const {recordHash,...body}=record
 if(!validHash(recordHash)||recordHash!==digest(body)||record.rawHash!==digest(record.raw)||record.executionHash!==digest(record.execution))throw invalid()
 return clone(record)
}
