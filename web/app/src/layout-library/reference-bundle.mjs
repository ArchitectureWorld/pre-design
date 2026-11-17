import {artifactPathValid} from './reference-artifacts.mjs'
const digest=/^[a-f0-9]{64}$/
const invalid=message=>Object.assign(new Error(message),{code:'REFERENCE_BUNDLE_INVALID',statusCode:409})
function pages(values,total,label){
 if(!Array.isArray(values)||values.some(n=>!Number.isSafeInteger(n)||n<1||(total!==null&&n>total))||new Set(values).size!==values.length)throw invalid(label+'页码缺失、重复或越界。')
 return [...values].sort((a,b)=>a-b)
}
function nativeOf(file){
 const p=file.structure?.pptMaster
 if(!p)return null
 if(p.source?.sha256&&p.source.sha256!==file.sha256)throw invalid('原生解析收执与原件指纹不一致。')
 const list=p.artifactInventory?.files??[],seen=new Set()
 const artifacts=list.map(a=>{
  if(!artifactPathValid(a.path)||seen.has(a.path)||!digest.test(a.sha256??'')||!Number.isSafeInteger(a.bytes)||a.bytes<0)throw invalid('原生解析产物清单不合法。')
  seen.add(a.path)
  // Only owner-authorized persisted upload metadata can establish availability.
  const saved=file.privateArtifacts?.find(item=>item.path===a.path)
  if(saved&&(saved.sha256!==a.sha256||saved.bytes!==a.bytes||!file.id))throw invalid('保存的设计产物与导入收执不一致。')
  return {path:a.path,sha256:a.sha256,bytes:a.bytes,availability:saved?'private-upload':'inventory-only',...(saved?{reference:{sourceId:file.id,path:a.path,sha256:a.sha256}}:{})}
 })
 return structuredClone({revision:p.revision??null,receiptHash:p.receiptHash??null,masterLayoutGraph:{masters:p.masters??[],layouts:p.layouts??[],slides:p.slides??[],inheritance:p.inheritance??{}},nativeStructure:p.nativeStructure??null,authoringSummary:p.authoringSummary??null,conversionReport:p.conversionReport??null,artifacts})
}
/** Private job-owned evidence, never a reusable design package or browser SVG.
 * Input comes from owner-authorized upload records, not model responses. */
export function buildReferenceBundle({files=[],sourceRecords=[]}={}){
 if(!Array.isArray(files)||!files.length)throw invalid('缺少参考来源。')
 const ids=new Set()
 const sources=files.map((file,index)=>{
  const sourceId=file.id??'inline-'+(index+1)
  if(ids.has(sourceId)||!digest.test(file.sha256??''))throw invalid('参考来源标识重复或缺少指纹。')
  ids.add(sourceId)
  const record=sourceRecords.find(r=>r.id? r.id===file.id : r.sha256===file.sha256)
  const total=file.pageCount??record?.pageCount??null
  if(total!==null&&(!Number.isSafeInteger(total)||total<1||total>100000))throw invalid('参考总页数不合法。')
  const extracted=pages([...new Set([...(file.pages??[]).map(p=>p.page??p.pageNumber),...(file.structure?.slides??[]).map(p=>p.page??p.pageNumber)])],total,'提取')
  pages(file.readPages??[],total,'读取')
  const visual=pages((record?.pages??[]).filter(p=>p.hasImage).map(p=>p.pageNumber),total,'视觉')
  const read=new Set([...extracted,...visual])
  return {sourceId,sha256:file.sha256,name:file.name??null,kind:file.kind??'text',bytes:file.bytes??null,
   coverage:{totalPages:total,extractedPages:extracted,visualPages:visual,unreadPages:total===null?null:Array.from({length:total},(_,i)=>i+1).filter(n=>!read.has(n))},
   native:nativeOf(file),limitations:structuredClone(file.limitations??[])}
 })
 return {schemaVersion:'pre-design.reference-bundle.v1',visibility:'private',sources}
}
