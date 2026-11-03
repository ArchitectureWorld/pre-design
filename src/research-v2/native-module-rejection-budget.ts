import {sha256CanonicalJson} from '../presentation/canonical-json.ts'
import {expandModuleReferencePromptView} from './module-reference-context.ts'

type RecordValue = Record<string, unknown>
const object=(value:unknown):value is RecordValue=>!!value&&typeof value==='object'&&!Array.isArray(value)

/** Only rejected author context may be omitted. The complete draft and errors
 * stay in the execution audit. Sources, accepted fields and diagnostic targets
 * remain unchanged; a diagnostic must bind the exact rejected draft hash. */
export function compactNativeModuleRejectionPrompt(prompt: string): string {
 let changed=false
 const lines=prompt.split('\n').map(line=>{
  if(!line.startsWith('{"correctionContext":')&&!line.startsWith('{"previousRejection":'))return line
  let root:RecordValue
  try{const parsed:unknown=JSON.parse(line);if(!object(parsed))return line;root=parsed}catch{return line}
  const key=Object.hasOwn(root,'correctionContext')?'correctionContext':'previousRejection',context=root[key]
  if(!object(context))return line
  const rejected=key==='correctionContext'?context:context.rejectedSubmission,diagnostic=context.diagnosticExcerpt
  if(!object(rejected)||rejected.accepted!==false||rejected.untrusted!==true||!object(diagnostic)
   ||diagnostic.completeSubmission!==false||typeof diagnostic.originalSubmissionHash!=='string')return line
  let raw:unknown
  if(rejected.submissionState==='included'&&object(rejected.structuredOutput))raw=rejected.structuredOutput
  else if(rejected.submissionState==='included-readonly-view'&&object(rejected.structuredOutputView))raw=expandModuleReferencePromptView(rejected.structuredOutputView)
  else return line
  const originalHash=sha256CanonicalJson(raw)
  if(diagnostic.originalSubmissionHash!==originalHash||typeof rejected.originalSubmissionHash==='string'&&rejected.originalSubmissionHash!==originalHash)return line
  const {structuredOutput:omittedRaw,structuredOutputView:omittedView,...metadata}=rejected
  const omitted={...metadata,submissionState:'omitted',originalSubmissionHash:originalHash,serializedChars:JSON.stringify(raw).length,
   omissionReason:'complete rejected draft exceeds actual request capacity; original remains in executionAudit'}
  const compact:RecordValue=key==='correctionContext'?omitted:{...context,rejectedSubmission:omitted}
  const details:RecordValue={}
  const errorView=(value:unknown,path:string):unknown=>{
   if(typeof value!=='string'||value.length<=1024||!value.startsWith('MODULE_'))return value
   const errorCodes=[...new Set(value.match(/MODULE_[A-Z_]+/gu)??[])]
   if(!errorCodes.length)return value
   details[path]={originalHash:sha256CanonicalJson(value),serializedChars:value.length,errorCodes}
   return errorCodes.join('; ')+' (完整报错因请求容量省略；错误位置见同一原稿哈希绑定的diagnosticExcerpt，原报错保留在executionAudit。)'
  }
  for(const field of ['error','moduleError'])if(Object.hasOwn(compact,field))compact[field]=errorView(compact[field],field)
  if(Array.isArray(compact.authorErrors))compact.authorErrors=compact.authorErrors.map((value,index)=>errorView(value,'authorErrors/'+index))
  if(Object.keys(details).length)compact.omittedErrorDetails=details
  const replacement=JSON.stringify({...root,[key]:compact})
  if(Buffer.byteLength(replacement,'utf8')>=Buffer.byteLength(line,'utf8'))return line
  changed=true;return replacement
 })
 return changed?lines.join('\n')+'\n本次请求因容量只省略哈希绑定的完整拒稿正文及声明省略的冗长报错，原件均保留在executionAudit。diagnosticExcerpt的字段、来源及错误位置原样保留，它不是完整候选或来源。必须回查完整冻结资料，由你原生修订并提交完整结果；省略不表示任何旧问题已解决，中央校验和新独审保持。':prompt
}
