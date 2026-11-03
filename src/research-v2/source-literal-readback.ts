import type {MaterialCorpus,MaterialCorpusDocument} from '../materials/research-evidence.ts'
import {sha256CanonicalJson} from '../presentation/canonical-json.ts'

export const sourceLiteralReadbackProtocol='原文位置对照协议 source-literal-readback.v1：sourceLiteralReadback逐项绑定fieldTextConflicts.target与原值哈希，只展示冻结原文的独立连续片段、精确path/page/contentHash和偏移。quoteLocationContexts是原拒稿quote已定位的原件对照，boundValueContexts只说明原value在其所绑定文件中的字面出现；它们不认可当前字段、分类或整句quote，也不选择替代绑定。每条记录、每个字段分别回查对应原文的对象、年代、行政尺度、统计口径与修订状态，不能沿用另一条记录或前组的path；path逐字复制完整冻结身份，不重构RUN目录或文件名。仅提交真正支持本字段的最短完整连续原文，不能把相邻片段拼成新quote、补连接词或从并列省略名称补成完整名称。类型字段不能用对象名称代替；原文并列名称不能当作每个完整名称逐字出现，归纳分类仍须真实inference、已有证据的精确local/upstream与rationale，不能机械改标。无真实依据保持missing/null及具体限制。宿主不选择原件、不填业务值或修稿，原生完整修订、中央严格校验、完整汇合及新独审继续执行。'

/** Original text for diagnosis only. This is never used by an evidence verifier. */
export function sourceLiteralReadback(corpus:MaterialCorpus,source:{path:string;quote:string;page?:number},rawValue:unknown,
 matches:readonly {path:string;page?:number}[]=[]){
 if(typeof rawValue!=='string')return undefined
 const locations=(doc:MaterialCorpusDocument,page?:number)=>doc.pages?doc.pages.filter(row=>row.page===page)
  :page===undefined&&typeof doc.text==='string'?[{page:undefined,text:doc.text}]:[]
 const excerpt=(doc:MaterialCorpusDocument,location:{page?:number;text:string},offset:number,searchBasis:string)=>{
  const sourceExcerptStart=Math.max(0,offset-80)
  return {path:doc.path,contentHash:doc.contentHash,...(location.page===undefined?{}:{page:location.page}),
   sourceExcerptStart,sourceExcerpt:location.text.slice(sourceExcerptStart,sourceExcerptStart+640),
   excerptTruncated:sourceExcerptStart>0||location.text.length>sourceExcerptStart+640,
   searchBasis,wholeQuoteAcceptedForTarget:false as const}
 }
 const bound=corpus.documents.find(doc=>doc.path===source.path),boundLocations=bound?locations(bound,source.page):[]
 const boundValueContexts=[]
 if(bound&&rawValue.length>=4)for(const location of boundLocations){
  let from=0
  while(boundValueContexts.length<2){const offset=location.text.indexOf(rawValue,from);if(offset<0)break
   boundValueContexts.push(excerpt(bound,location,offset,'exact-rejected-value'));from=offset+rawValue.length}
 }
 const quoteLocationContexts=matches.slice(0,2).flatMap(match=>{
  const doc=corpus.documents.find(row=>row.path===match.path);if(!doc)return []
  return locations(doc,match.page).flatMap(location=>{
   const offset=location.text.indexOf(source.quote)
   if(offset>=0)return [excerpt(doc,location,offset,'exact-rejected-quote')]
   const valueOffset=rawValue.length>=4?location.text.indexOf(rawValue):-1
   return valueOffset>=0?[excerpt(doc,location,valueOffset,'exact-rejected-value-at-diagnostic-location')]:[]
  })
 })
 return {version:'source-literal-readback.v1',diagnosticOnly:true as const,rawValueHash:sha256CanonicalJson(rawValue),
  boundSourceLocationExists:boundLocations.length>0,boundValueFoundInBoundSource:boundLocations.some(location=>rawValue.length>0&&location.text.includes(rawValue)),
  boundValueContexts,quoteLocationContexts,
  boundary:'Separate continuous original excerpts and literal occurrence diagnostics only. Neither whole quote, field meaning, applicability nor binding is accepted or rewritten. Missing or omitted contexts are not evidence of absence. Native author must verify full originals and author its own complete revision.'}
}
