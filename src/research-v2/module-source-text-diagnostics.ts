import type {MaterialCorpus} from '../materials/research-evidence.ts'
import {verifyModuleSourceValues,moduleSourceQuoteDiagnostic} from './module-claims.ts'
import {readJsonPointer} from './regional-schema.ts'
import {sha256CanonicalJson} from '../presentation/canonical-json.ts'
import {sourceLiteralReadback} from './source-literal-readback.ts'
import {nativeQueryRepresentationDiagnostic} from './native-query-string-mapping.ts'
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)

/** Preserve literal progress in a rejected draft without approving its facts,
 * changing its values, or reusing it as an accepted native candidate. */
export function moduleSourceBindingProgress(raw:unknown,corpus?:MaterialCorpus){
 if(!corpus||!object(raw)||!object(raw.outputs)||!Array.isArray(raw.evidence))return undefined
 const owners=new Map<string,number>()
 for(const entry of raw.evidence)if(object(entry)&&object(entry.target)){
  const key=sha256CanonicalJson(entry.target);owners.set(key,(owners.get(key)??0)+1)
 }
 const bindings=[];let verifiedBindingCount=0
 for(const [index,entry] of raw.evidence.entries()){
  if(!object(entry)||entry.kind!=='source'||!object(entry.target)||!object(entry.source))continue
  const target=entry.target,source=entry.source
  if(!['port','recordId','field','at'].every(key=>typeof target[key]==='string')||owners.get(sha256CanonicalJson(target))!==1
   ||typeof source.path!=='string'||typeof source.quote!=='string'||source.dateMapping!==undefined
   ||source.coordinateMapping!==undefined||source.queryMapping!==undefined)continue
  const port=raw.outputs[target.port],records=object(port)&&Array.isArray(port.records)?port.records.filter(row=>object(row)&&row.recordId===target.recordId):[]
  if(records.length!==1||!object(records[0][target.field])||records[0][target.field].claimClass!=='source_conclusion')continue
  const document=corpus.documents.find(row=>row.path===source.path)
  if(!document||source.contentHash!==undefined&&source.contentHash!==document.contentHash)continue
  try{
   const value=readJsonPointer(records[0][target.field],'/value'+target.at)
   if(typeof value!=='string'&&(typeof value!=='number'||!Number.isFinite(value)))continue
   verifyModuleSourceValues(corpus,[{sourceId:'binding-progress-'+index,path:source.path,contentHash:document.contentHash,
    ...(source.page===undefined?{}:{page:source.page}),quote:source.quote,rawValue:value,
    ...(typeof source.valueQuote==='string'?{valueQuote:source.valueQuote}:{})}])
   verifiedBindingCount++
   if(bindings.length<8)bindings.push({target:structuredClone(target),path:source.path,contentHash:document.contentHash,
    ...(source.page===undefined?{}:{page:source.page}),quoteHash:sha256CanonicalJson(source.quote),valueHash:sha256CanonicalJson(value)})
  }catch{/* A failed literal check is never described as preserved progress. */}
 }
 return verifiedBindingCount?{version:'source-binding-progress.v1' as const,scope:'literal-source-bindings-only' as const,
  originalSubmissionHash:sha256CanonicalJson(raw),verifiedBindingCount,truncated:verifiedBindingCount>bindings.length,bindings}:undefined
}

export const sourceBindingProgressFeedback='sourceBindingProgress仅说明最新原拒稿中列出的字面来源绑定已通过同一冻结语料的path/page/quote及字段值核验，不表示业务适用性、整组、步骤或模块独审通过。保持已经核验的path/page/quote与字段值绑定，定点研究当前冲突，避免完整重写时退回旧的页码、路径、引文或原值错误。若业务研究确需改变这些字段，须说明新的依据并重新逐项核验。目标地址与quoteHash/valueHash绑定的是原稿，不是替代稿；未列部分不表示通过。完整原生提交、中央校验和新的独立审查仍须执行。'

/** Explain bounded original gaps at the rejected target, including after an
 * empty correction. This protocol supplies no replacement quote or value. */
export function moduleSourceQuoteWhitespaceFeedback(diagnostic:unknown){
 if(!object(diagnostic)||!Array.isArray(diagnostic.fieldTextConflicts)
   ||!diagnostic.fieldTextConflicts.some(conflict=>object(conflict)&&object(conflict.sourceQuoteWhitespaceDiagnostic)))return undefined
 return 'sourceQuoteWhitespaceDiagnostic逐项绑定fieldTextConflicts.target的冻结原文空白；sourceOffset是原页面或文本偏移，codePoints明确显示U+000A换行、U+000D回车和U+0020空格等字符。quote和绑定字段value须同时核对：回查对应path/page的完整原文，保留实际支持所选字段的字面空白与标点，不能只改quote却保留已清理的value。JSON序列化时使用\\n表示真实U+000A换行，不能把反斜杠和字母n作为业务文本。上下文可能超出原引文，不能按偏移机械插入字符或拼接诊断；原文不支持时保留missing/null及具体限制。摘录与空白诊断只用于定位，不是替代稿或认可证据；仍须原生完整提交、严格来源校验、完整合并与新的独立审查。\n'
}

export function moduleSourcePathIdentityFeedback(diagnostic:unknown){
 if(!object(diagnostic)||!Array.isArray(diagnostic.fieldTextConflicts)
   ||!diagnostic.fieldTextConflicts.some(conflict=>object(conflict)&&(String(conflict.diagnosticCode).endsWith('_LOCATION')||object(conflict.sourceValueSupportDiagnostic))))return undefined
 return 'source.path须逐字复制冻结documents.path的完整字符串，含RUN目录与完整文件名；网页url只标识发布位置，不能填入source.path。不得替换RUN目录、拼造目录或缩写哈希。quoteLocationMatches是定位候选，仍须回查原文的对象、年代和字段适用性。sourceValueSupportDiagnostic逐项绑定同一target及原值/quote哈希：它用未变的验证器检查显示的原文位置，若原value在全部已检查位置仍被TEXT拒绝，仅修正路径仍不能通过。source字段value须由你根据完整原文重新核对，不把引文外的解释、历史适用性或核验限制写成原值；解释与限制按本组Schema单独保留，不能机械截短、改标类别或自动选择候选过检。诊断不改写或认可路径、quote和业务值，必须原生提交完整修订，继续严格校验、完整合并和新的独立审查。\n'
}

/** Diagnose the original rejected scalar with the unchanged evidence verifier.
 * Excerpts are quoted audit data, never a replacement field or accepted source. */
export function moduleSourceTextConflicts(raw:unknown,corpus?:MaterialCorpus){
 if(!corpus||!object(raw)||!object(raw.outputs)||!Array.isArray(raw.evidence))return []
 const conflicts=[]
 for(const [evidenceIndex,entry] of raw.evidence.entries()){
  if(!object(entry)||entry.kind!=='source'||!object(entry.target)||!object(entry.source))continue
  const target=entry.target,source=entry.source
  if(!['port','recordId','field','at'].every(k=>typeof target[k]==='string')||typeof source.path!=='string'||typeof source.quote!=='string'
    ||source.dateMapping!==undefined||source.coordinateMapping!==undefined)continue
  const port=raw.outputs[target.port],record=object(port)&&Array.isArray(port.records)?port.records.find(r=>object(r)&&r.recordId===target.recordId):undefined
  if(!object(record)||!object(record[target.field]))continue
  const document=corpus.documents.find(d=>d.path===source.path)
  try{
   const value=readJsonPointer(record[target.field],'/value'+target.at)
   if(typeof value!=='string'&&(typeof value!=='number'||!Number.isFinite(value)))continue
   let diagnosticCode:string|undefined
   try{
    if(!document)diagnosticCode='MODULE_PROJECTION_SOURCE_LOCATION'
    else verifyModuleSourceValues(corpus,[{sourceId:'diagnostic-scalar-'+evidenceIndex,path:source.path,contentHash:document.contentHash,
      ...(source.page===undefined?{}:{page:source.page}),quote:source.quote,rawValue:value,
      ...(typeof source.valueQuote==='string'?{valueQuote:source.valueQuote}:{}),
      ...(source.queryMapping?{queryMapping:source.queryMapping}:{})}])
   }catch(error){
    if(!(error instanceof Error))continue
    diagnosticCode=error.message.startsWith('MODULE_SOURCE_VALUE_TEXT:')?'MODULE_SOURCE_VALUE_TEXT'
      :error.message.startsWith('MODULE_SOURCE_VALUE_QUOTE:')?'MODULE_SOURCE_VALUE_QUOTE'
      :error.message.startsWith('MODULE_SOURCE_VALUE_LOCATION:')?'MODULE_SOURCE_VALUE_LOCATION'
      :error.message.startsWith('MODULE_SOURCE_QUERY_MAPPING:')?'MODULE_SOURCE_QUERY_MAPPING':undefined
   }
    if(!diagnosticCode)continue
    const location=diagnosticCode!=='MODULE_SOURCE_VALUE_TEXT'?moduleSourceQuoteDiagnostic(corpus,{path:source.path,quote:source.quote,...(source.page===undefined?{}:{page:source.page})}):undefined
    const checkedValueLocations=typeof value==='string'?location?.quoteLocationMatches?.map(candidate=>{
      let diagnosticCode='supported-at-diagnostic-candidate-only'
      try{verifyModuleSourceValues(corpus,[{sourceId:'diagnostic-quoted-location-'+evidenceIndex,path:candidate.path,contentHash:candidate.contentHash,
        ...(candidate.page===undefined?{}:{page:candidate.page}),quote:source.quote,rawValue:value}])}
      catch(error){diagnosticCode=error instanceof Error?error.message.split(':')[0]:'unknown-verification-error'}
      return {path:candidate.path,contentHash:candidate.contentHash,...(candidate.page===undefined?{}:{page:candidate.page}),diagnosticCode}
    }):undefined
    const sourceValueSupportDiagnostic=checkedValueLocations?.length&&checkedValueLocations.every(row=>row.diagnosticCode==='MODULE_SOURCE_VALUE_TEXT')?{
      diagnosticOnly:true,unchangedValueRejectedAtEveryQuotedLocation:true,checkedLocations:checkedValueLocations,
      checkedLocationsTruncated:location?.quoteLocationMatchesTruncated??false,
      rule:'Every displayed quote-location candidate rejects this unchanged field value under the existing verifier. Only the displayed locations were checked; no binding or business value was rewritten or approved. Native author must recheck literal field support and author a complete revision, retaining explanations and limitations separately as the schema permits.'}:undefined
    const sourceQuoteWhitespaceDiagnostic=diagnosticCode==='MODULE_SOURCE_VALUE_QUOTE'&&location?.sourceWhitespaceContexts?.length?{
      diagnosticOnly:true,sourceWhitespaceContexts:location.sourceWhitespaceContexts,
      sourceExcerpt:location.sourceExcerpt,sourceExcerptStart:location.sourceExcerptStart,excerptTruncated:location.excerptTruncated,
      rule:location.correctionRule}:undefined
    // This comparison explains a rejected binding only. It never changes the
    // quote/value or participates in the source verifier's matching rules.
    const compactValue=typeof value==='string'?value.replace(/\s+/gu,''):''
    const whitespaceBindingDiagnostic=diagnosticCode==='MODULE_SOURCE_VALUE_TEXT'&&compactValue
      &&source.quote.replace(/\s+/gu,'').includes(compactValue)?{
        diagnosticOnly:true,whitespaceStrippedQuoteContainsValue:true,
        quoteWhitespaceContexts:[...source.quote.slice(0,640).matchAll(/\s+/gu)].slice(0,8).map(match=>{
          const offset=match.index!
          return {quoteOffset:offset,gapChars:match[0].length,
            codePoints:[...match[0]].slice(0,8).map(c=>'U+'+c.codePointAt(0)!.toString(16).toUpperCase().padStart(4,'0')),
            before:source.quote.slice(Math.max(0,offset-7),offset),after:source.quote.slice(offset+match[0].length,offset+match[0].length+7)}
        }),
        rule:'The quote passed the existing source-location check but this field value did not. Recheck the original supported text and preserve its literal gaps in both the quote and bound field value. Changing only the quote leaves this field rejected. Removing whitespace here is diagnostic only, never an accepted match or a suggested replacement value.'}:undefined
    const fileName=(path:string)=>path.split(/[\\/]/u).at(-1)!
    const sourcePathCopyDiagnostic=!document&&location?.quoteLocationMatches?.length?{
      diagnosticOnly:true,submittedFileName:fileName(source.path),submittedFileNameChars:[...fileName(source.path)].length,
      matchedFileNames:[...new Set(location.quoteLocationMatches.map(match=>fileName(match.path)))].map(name=>({fileName:name,fileNameChars:[...name].length})),
      sourcePathsMustBeCopiedVerbatim:true,
      boundary:'File names are exact frozen identities of the quoted location candidates, not accepted field support or replacement bindings. The native author must verify the original and submit its own complete path, quote and value.'}:undefined
    const queryRepresentation=document&&target.port==='peer_supply'&&target.field==='discoveryQueries'
      ?nativeQueryRepresentationDiagnostic(document,value):undefined
    conflicts.push({evidenceIndex,target:{port:target.port,recordId:target.recordId,field:target.field,at:target.at},
      diagnosticCode,path:source.path,...(document?{contentHash:document.contentHash}:{}),...(source.page===undefined?{}:{page:source.page}),
      rawValueHash:sha256CanonicalJson(value),quoteHash:sha256CanonicalJson(source.quote),
      rawValueExcerpt:typeof value==='string'?value.slice(0,240):value,rawValueExcerptTruncated:typeof value==='string'&&value.length>240,
      quoteExcerpt:source.quote.slice(0,640),quoteExcerptTruncated:source.quote.length>640,
      ...(whitespaceBindingDiagnostic?{whitespaceBindingDiagnostic}:{}),
      ...(sourceQuoteWhitespaceDiagnostic?{sourceQuoteWhitespaceDiagnostic}:{}),
      ...(location?.sourcePageBoundaryDiagnostic?{sourcePageBoundaryDiagnostic:location.sourcePageBoundaryDiagnostic}:{}),
      ...(sourceValueSupportDiagnostic?{sourceValueSupportDiagnostic}:{}),
      ...(queryRepresentation?{nativeQueryRepresentationDiagnostic:queryRepresentation}:{}),
      ...(location?.quoteLocationMatches?{quoteLocationMatches:location.quoteLocationMatches,quoteLocationMatchesTruncated:location.quoteLocationMatchesTruncated}:{}),
      ...(sourcePathCopyDiagnostic?{sourcePathCopyDiagnostic}:{}),
      ...(typeof value==='string'?{sourceLiteralReadback:sourceLiteralReadback(corpus,{path:source.path,quote:source.quote,...(source.page===undefined?{}:{page:source.page})},value,location?.quoteLocationMatches)}:{}),
      ...(location?.quoteAnchorCandidates?{quoteAnchorCandidates:location.quoteAnchorCandidates,quoteAnchorCandidatesTruncated:location.quoteAnchorCandidatesTruncated,
        quoteAnchorRule:location.quoteAnchorRule}:{}),
      ...(location?{boundSourceLocationExists:location.boundSourceLocationExists}:{}),
      rule:diagnosticCode.endsWith('_LOCATION')
        ?'The submitted path/page must identify an existing frozen source location. A contentHash is not a path; do not construct RUN paths from content hashes. Matching frozen locations are diagnostic candidates only. Native author must recheck scope, date, units and field support, then author its own binding. No path, quote or value is repaired or approved.'
        :diagnosticCode==='MODULE_SOURCE_VALUE_QUOTE'
        ?'The submitted quote must occur in the bound frozen source path and page under the unchanged verifier. Other location identities are diagnostic candidates only. Native author must recheck scope and field support; no quote, path or business value is repaired or approved.'
        :'The submitted string itself must occur in the exact source quote under the existing verifier. Native author must recheck field support; do not invent text or mechanically rewrite the draft to pass.'})
    if(conflicts.length===8)break
  }catch{continue}
 }
 return conflicts
}
