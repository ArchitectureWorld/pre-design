import {createHash} from 'node:crypto'
import {describe,it,expect} from 'vitest'
import {materialCorpusFingerprint,type MaterialCorpus} from '../src/materials/research-evidence.ts'
import {moduleSourceQuoteDiagnostic,verifyModuleSourceValues} from '../src/research-v2/module-claims.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'

const sentence='十年间，新洲全区GDP增长2.39倍，2022年达到1062亿元。城、乡居民人均可支配收入分别是十年前的2.41、2.46倍，实现了从武汉的远城区到大武汉新城区的华丽蜕变，奏响了强县工程的奋进曲。'
const submitted='"'+sentence+'"'
const makeCorpus=(texts:{path:string;text?:string;pages?:{page:number;text:string}[]}[]):MaterialCorpus=>{
 const documents=texts.map(d=>({...d,contentHash:createHash('sha256').update(JSON.stringify(d)).digest('hex'),byteLength:Buffer.byteLength(JSON.stringify(d))}))
 const base={documents,limitations:[]};return {...base,fingerprint:materialCorpusFingerprint(base)}
}
const wrong='wrong-government.json',right='historical-news.json'
const corpus=makeCorpus([{path:wrong,text:'网站导航\n\n政府信息公开\n\n另一篇规划全文，缺少这条历史报道。'},
 {path:right,text:'导航'.repeat(900)+'\n\n“'+sentence+'”舒基元说。\n\n仅用于历史背景。'}])
const source={sourceId:'rejected',path:wrong,contentHash:corpus.documents[0].contentHash,quote:submitted,rawValue:sentence}

describe('bounded original quote anchors for native correction',()=>{
 it('locates interior exact segments when wrong file and changed outer quotes defeat whole-quote search, without approving either binding',()=>{
  const before=sha256CanonicalJson(corpus),diagnostic=moduleSourceQuoteDiagnostic(corpus,source) as any
  expect(diagnostic.quoteLocationMatches).toBeUndefined()
  expect(diagnostic.quoteAnchorCandidates).toHaveLength(1)
  const candidate=diagnostic.quoteAnchorCandidates[0]
  expect(candidate).toMatchObject({path:right,contentHash:corpus.documents[1].contentHash,diagnosticOnly:true,wholeQuoteVerified:false})
  expect(candidate.sourceExcerpt).toContain('“'+sentence+'”')
  expect(candidate.sourceExcerpt.length).toBeLessThanOrEqual(640)
  expect(candidate.matchedSegments.length).toBeGreaterThanOrEqual(2)
  expect(corpus.documents[1].text!.slice(candidate.sourceExcerptStart,candidate.sourceExcerptStart+candidate.sourceExcerpt.length)).toBe(candidate.sourceExcerpt)
  for(const segment of candidate.matchedSegments){
   expect(submitted.slice(segment.submittedOffset,segment.submittedOffset+segment.text.length)).toBe(segment.text)
   expect(corpus.documents[1].text!.slice(segment.sourceOffset,segment.sourceOffset+segment.text.length)).toBe(segment.text)
  }
  expect(()=>verifyModuleSourceValues(corpus,[source])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
  expect(()=>verifyModuleSourceValues(corpus,[{...source,path:right,contentHash:corpus.documents[1].contentHash}])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
  expect(sha256CanonicalJson(corpus)).toBe(before)
 })
 it('sends source identities and continuous original spans with both exact rejected targets after two empty output-capped attempts',()=>{
  const targets=['mc-05','mc-06'].map(recordId=>({port:'market_context',recordId,field:'policyVision',at:''}))
  const raw={groupId:'market_context:4.2.3',outputs:{market_context:{records:targets.map(t=>({recordId:t.recordId,policyVision:{value:sentence}}))}},
   evidence:targets.map(target=>({target,kind:'source',source:{path:wrong,quote:submitted}}))}
  const audit={reviewReceipts:[],attempts:[{classId:'text',groupId:raw.groupId,status:'failed',error:'MODULE_SOURCE_VALUE_QUOTE: rejected',structuredOutput:raw},
   ...[1,2].map(()=>({classId:'text',groupId:raw.groupId,status:'failed',error:'MODULE_NATIVE_max-tokens',submissionState:'not-submitted'}))]},before=sha256CanonicalJson(audit)
  const feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit,corpus},raw.groupId)
  const excerpt=JSON.parse(feedback.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
  expect(excerpt.originalSubmissionHash).toBe(sha256CanonicalJson(raw))
  expect(excerpt.fieldTextConflicts.map((c:any)=>c.target)).toEqual(targets)
  for(const conflict of excerpt.fieldTextConflicts)expect(conflict.quoteAnchorCandidates[0]).toMatchObject({path:right,wholeQuoteVerified:false})
  expect(feedback).toContain('quoteAnchorCandidates')
  expect(feedback).toContain('完整quote尚未通过')
  expect(feedback.length).toBeLessThan(20000)
  expect(sha256CanonicalJson(audit)).toBe(before)
 })
 it('bounds candidate count and keeps page identities and literal offsets',()=>{
  const pdfCorpus=makeCorpus([{path:wrong,text:'无对应引用'},...Array.from({length:6},(_,i)=>({path:'report-'+i+'.pdf',pages:[{page:7,text:'“'+sentence+'”'}]}))])
  const diagnostic=moduleSourceQuoteDiagnostic(pdfCorpus,{path:wrong,quote:submitted}) as any
  expect(diagnostic.quoteAnchorCandidates).toHaveLength(3)
  expect(diagnostic.quoteAnchorCandidatesTruncated).toBe(true)
  for(const candidate of diagnostic.quoteAnchorCandidates)expect(candidate).toMatchObject({page:7,diagnosticOnly:true,wholeQuoteVerified:false})
 })
 it('does not infer a location from a short generic phrase or separated fragments',()=>{
  expect((moduleSourceQuoteDiagnostic(corpus,{path:wrong,quote:'"新洲"'}) as any).quoteAnchorCandidates).toBeUndefined()
  const split=sentence.slice(0,30)+'\n'+'无关原文'.repeat(1000)+'\n'+sentence.slice(30)
  const fragmented=makeCorpus([{path:wrong,text:'无'}, {path:right,text:split}])
  const diagnostic=moduleSourceQuoteDiagnostic(fragmented,{path:wrong,quote:submitted}) as any
  // A single short retained prefix cannot locate the submitted continuous quote.
  expect(diagnostic.quoteAnchorCandidates).toBeUndefined()
 })
 it('keeps exact accepted quote and PDF layout gates unchanged',()=>{
  expect(moduleSourceQuoteDiagnostic(corpus,{path:right,quote:'“'+sentence+'”'})).toBeUndefined()
  expect(verifyModuleSourceValues(corpus,[{...source,path:right,contentHash:corpus.documents[1].contentHash,quote:'“'+sentence+'”'}])).toHaveLength(1)
 })
})
