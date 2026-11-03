import {moduleReferencePromptView} from './module-reference-context.ts'
import {sha256CanonicalJson} from '../presentation/canonical-json.ts'

export const sourceDiagnosticViewProtocol='诊断只读对照协议 source-diagnostic-view.v1：fieldTextConflicts保留全部原拒稿字段地址和原值/quote哈希；readOnlyDiagnosticView用sources相同的research-reference.v1只读字典逐字保存完整诊断，按originalDiagnosticHash绑定。回查该视图内同一target的原文位置、原值、引文与限制，不能仅处理第一处错误。字典标记不得作为工具实参，诊断不是来源、替代稿或通过凭据，宿主未修改原稿或认可任何候选绑定。若fullDiagnosticDetailsOmitted=true，仅说明完整详情超过本次传输预算；地址摘要不代表其他错误消失，仍须回查完整原件并原生修订所有相关字段。中央校验和新的独立审查保持。'

export interface DiagnosticViewTransport {
 readonly originalDiagnosticHash?:string
 readonly originalDiagnosticChars?:number
 readonly readOnlyDiagnosticView?:unknown
 readonly fullDiagnosticDetailsOmitted?:boolean
}
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const identityKeys=['evidenceIndex','target','diagnosticCode','path','page','contentHash','rawValueHash','quoteHash',
 'rawValueExcerpt','rawValueExcerptTruncated','quoteExcerptTruncated','boundSourceLocationExists']
function identity(value:unknown){
 if(!object(value))return value
 const result=Object.fromEntries(identityKeys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]))
 // Keep protocol presence and its immutable flags; the exact original contexts
 // remain in the separately hash-bound read-only view, never a replacement.
 for(const key of ['sourceLiteralReadback','sourceQuoteWhitespaceDiagnostic','sourceValueSupportDiagnostic']){
  const detail=value[key]
  if(object(detail))result[key]=Object.fromEntries(Object.entries(detail).filter(([name,row])=>
   ['version','diagnosticOnly','rawValueHash','boundValueFoundInBoundSource','unchangedValueRejectedAtEveryQuotedLocation'].includes(name)
   &&(typeof row==='string'||typeof row==='boolean')))
 }
 return result
}

/** Transport only. Small diagnostics stay exact; large repeated readbacks retain
 * every target and their complete canonical original through the existing codec.
 * Validators never consume these excerpts or grant acceptance from this view. */
export function boundedSourceDiagnostic<T extends object>(diagnostic:T|undefined,budget=24_000):(T&DiagnosticViewTransport)|undefined {
 if(!diagnostic)return undefined
 const serialized=JSON.stringify(diagnostic)
 if(serialized.length<=budget)return diagnostic
 const original=diagnostic as Record<string,unknown>
 if(!Array.isArray(original.fieldTextConflicts)||!original.fieldTextConflicts.length)return undefined
 const compact:Record<string,unknown>={scope:original.scope,completeSubmission:false,originalSubmissionHash:original.originalSubmissionHash,
  originalDiagnosticHash:sha256CanonicalJson(diagnostic),originalDiagnosticChars:serialized.length,
  fieldTextConflicts:original.fieldTextConflicts.map(identity),readOnlyDiagnosticView:moduleReferencePromptView(diagnostic)}
 if(Array.isArray(original.fieldQuoteConflicts))compact.fieldQuoteConflicts=original.fieldQuoteConflicts.map(identity)
 for(const key of ['fieldPointerConflicts','fieldEvidenceKindConflicts','fieldCalculationConflicts','fieldLocalReferenceConflicts','fieldUpstreamReferenceConflicts',
  'fieldEvidenceCoverageGaps','fieldEvidenceConflicts','stepEvidenceConflicts','fieldNumberConflicts','fieldEvidenceLeafCoverageGaps',
  'fieldEvidenceLeafCoverageGapCount','omittedFieldEvidenceLeafCoverageGaps','fieldEnvelopeConflicts','fieldEvidenceDuplicateConflicts',
  'fieldEvidenceOwnerScope','fieldEvidenceOwnerConflicts','fieldClaimCycles']){
  if(Object.hasOwn(original,key))compact[key]=original[key]
 }
 if(original.quoteConflictListBound!==undefined)compact.quoteConflictListBound=original.quoteConflictListBound
 if(JSON.stringify(compact).length>budget){
  delete compact.readOnlyDiagnosticView
  compact.fullDiagnosticDetailsOmitted=true
 }
 return JSON.stringify(compact).length<=budget?compact as T&DiagnosticViewTransport:undefined
}
