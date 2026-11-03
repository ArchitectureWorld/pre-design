import type {MaterialCorpusDocument} from '../materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../presentation/canonical-json.ts'

export interface NativeQueryStringMapping {
 readonly kind:'native-search-query-json-string.v1'
 readonly callId:string
 readonly queryIndex:number
}
interface NativeSearchCall {tool:string;callId:string;request:{queries?:unknown};status:string}
const fail=():never=>{throw new Error('MODULE_SOURCE_QUERY_MAPPING: exact declared native search call, JSON string literal, query index and discoveryQueries leaf required; no generic JSON decoding or text normalization')}
function originalNativeSearchLog(document:MaterialCorpusDocument){
 if(document.pages||typeof document.text!=='string')return
 try{
  const log=JSON.parse(document.text)
  // Native acquisition freezes canonical JSON.stringify output. Requiring the
  // original wire excludes duplicate keys and alternate synthetic text views.
  if(log?.version!=='native-web-search-log.v1'||!/^3\.04:\d+$/u.test(log.queryKey)
   ||typeof log.executionId!=='string'||!log.executionId||typeof log.childId!=='string'||!log.childId
   ||!Array.isArray(log.calls)||JSON.stringify(log)!==document.text)return
  const provenance=document.provenance
  if(!provenance||provenance.sourceUri!=='workspace:native-web-query/'+log.executionId
   ||provenance.rawHash!==document.contentHash||provenance.claimClass!=='source_conclusion'
   ||provenance.retrievedAt!==log.retrievedAt||!provenance.queryKeys.includes(log.queryKey))return
  const calls=log.calls as NativeSearchCall[]
  if(calls.some(call=>!call||typeof call.callId!=='string'||!call.callId)
   ||new Set(calls.map(call=>call.callId)).size!==calls.length)return
  return {...log,calls}
 }catch{return}
}

/** Exact frozen source alternatives for a new author's explicit declaration.
 * The author still selects a source and submits the actual professional value;
 * these choices neither fill that value nor accept its business meaning. */
export function nativeQuerySourceChoices(documents:readonly MaterialCorpusDocument[]){
 return documents.flatMap(document=>{
  const log=originalNativeSearchLog(document)
  if(!log)return []
  return log.calls.flatMap((call:NativeSearchCall)=>{
   if(call.tool!=='web_search'||!['succeeded','failed'].includes(call.status)||!Array.isArray(call.request?.queries))return []
   const quote=JSON.stringify(call)
   if(!document.text!.includes(quote))return []
   return call.request.queries.flatMap((query:unknown,queryIndex:number)=>typeof query==='string'&&query?[{
    path:document.path,quote,valueQuote:JSON.stringify(query),
    queryMapping:{kind:'native-search-query-json-string.v1' as const,callId:call.callId,queryIndex},
   }]:[])
  })
 })
}

/** Only a native author's explicit declaration can connect a complete JSON
 * string token to its recorded query. No value or receipt is filled or edited. */
export function verifyNativeQueryStringMapping(source:{rawValue:unknown;quote:string;page?:number;valueQuote?:string;queryMapping:NativeQueryStringMapping},document:MaterialCorpusDocument){
 const log=originalNativeSearchLog(document),mapping=source.queryMapping
 if(!log||source.page!==undefined||mapping.kind!=='native-search-query-json-string.v1'
  ||!Number.isSafeInteger(mapping.queryIndex)||mapping.queryIndex<0)return fail()
 const call=log.calls.find((call:NativeSearchCall)=>call.callId===mapping.callId)
 if(!call||call.tool!=='web_search'||!['succeeded','failed'].includes(call.status)||!Array.isArray(call.request?.queries))return fail()
 const query=call.request.queries[mapping.queryIndex]
 if(typeof query!=='string'||!query||source.rawValue!==query||source.valueQuote!==JSON.stringify(query)
  ||!document.text!.includes(source.quote)||!source.quote.includes(JSON.stringify(call)))return fail()
 return query
}
export function assertNativeQueryStringMappingTarget(itemId:string,target:{port?:unknown;field?:unknown;at?:unknown}|undefined){
 if(itemId!=='3.04'||target?.port!=='peer_supply'||target.field!=='discoveryQueries'||typeof target.at!=='string'||!/^\/(?:0|[1-9]\d*)$/u.test(target.at))return fail()
}

export const nativeQueryStringMappingProtocol='搜索词JSON表示协议 native-search-query-json-string.v1：仅3.04的peer_supply.discoveryQueries数组叶可由你在source中显式声明queryMapping={kind:"native-search-query-json-string.v1",callId:原始web_search调用ID,queryIndex:该调用request.queries中的从0起算索引}。value保留实际记录的查询词，不添加或删除字面反斜杠；valueQuote逐字提交对应完整JSON字符串字面值，含外层双引号及原始转义。quote逐字引用同一冻结native-web-search-log.v1中所选call的完整连续JSON对象，含tool/callId/request/status，不拼接摘录。中央核对原始日志哈希、唯一callId、索引、完整原token和实际query逐字符相等；没有声明仍按原逐字规则拒绝。这仅证明原生检索行为，不能证明候选业务事实、经营、全量覆盖或停止充分性。不得为过检改标、代填查询或对普通JSON/其他字段使用通用解码。'

/** Original call excerpts and exact equal-query locations are diagnostic data,
 * not a replacement field, an authored declaration or accepted evidence. */
export function nativeQueryRepresentationDiagnostic(document:MaterialCorpusDocument,value:unknown){
 if(typeof value!=='string')return
 const log=originalNativeSearchLog(document)
 if(!log)return
 const matches=log.calls.flatMap((call:NativeSearchCall)=>{
  if(call.tool!=='web_search'||!['succeeded','failed'].includes(call.status)||!Array.isArray(call.request?.queries))return []
  return call.request.queries.flatMap((query:unknown,queryIndex:number)=>{
   if(query!==value)return []
   const originalCallExcerpt=JSON.stringify(call)
   return [{callId:call.callId,queryIndex,originalCallHash:hash(call),originalCallExcerpt,
    sourceOffset:document.text!.indexOf(originalCallExcerpt),valueQuoteHash:hash(JSON.stringify(query))}]
  })
 })
 return matches.length?{diagnosticOnly:true,sourceTextHash:hash(document.text),executionId:log.executionId,childId:log.childId,
  matches:matches.slice(0,4),matchesTruncated:matches.length>4,explicitAuthorDeclarationRequired:true,rule:nativeQueryStringMappingProtocol}:undefined
}
