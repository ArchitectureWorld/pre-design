import {createHash} from 'node:crypto'
import {describe,it,expect} from 'vitest'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {moduleSourceQuoteDiagnostic,verifyModuleSourceValues} from '../src/research-v2/module-claims.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'
const quote='努力建成可容纳50万人规模、港产城深度融合的临港新城。'
const document=(path:string,text:string)=>({path,text,contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text)})
function fixture(){const wrong=document('wrong.json','政府门户导航\n通知公告\n与该句无关的政策正文'),right=document('original-plan.json','历史规划原文\n'+quote+'\n本段为规划目标，不能证明当前已建人口')
 const base={documents:[wrong,right],limitations:[]};return {wrong,right,corpus:{...base,fingerprint:materialCorpusFingerprint(base)},source:{sourceId:'s',path:wrong.path,contentHash:wrong.contentHash,quote,valueQuote:'50',rawValue:50}}}
describe('wrong-document quote recovery keeps source acceptance strict',()=>{
 it('locates a frozen original quote when the submitted path was invented from its content hash, retaining strict rejection',()=>{
  const f=fixture(),source={...f.source,path:'research/runs/RUN-'+f.right.contentHash+'.json'},before=structuredClone(f)
  const diagnostic=moduleSourceQuoteDiagnostic(f.corpus,source)
  expect(diagnostic).toMatchObject({path:source.path,boundSourceLocationExists:false,
   quoteLocationMatches:[{path:f.right.path,contentHash:f.right.contentHash,literalExactMatch:true}]})
  expect(diagnostic).not.toHaveProperty('sourceExcerpt')
  expect(()=>verifyModuleSourceValues(f.corpus,[source])).toThrow('MODULE_SOURCE_VALUE_LOCATION')
  expect(f).toEqual(before)
 })
 it('sends every missing-path target and original submission hash to a cold native correction without altering the failed draft',()=>{
  const f=fixture(),targets=[{port:'peer_supply',recordId:'peer-1',field:'aliases',at:'/0'},
   {port:'peer_supply',recordId:'peer-1',field:'aliases',at:'/1'}],path='research/runs/RUN-'+f.right.contentHash+'.json'
  const raw={groupId:'peer_supply:1',outputs:{peer_supply:{records:[{recordId:'peer-1',aliases:{value:[quote,quote]}}]}},
   evidence:targets.map(target=>({kind:'source',target,source:{path,quote}}))}
  const audit={reviewReceipts:[],attempts:[{classId:'text',groupId:raw.groupId,status:'failed',
   error:'MODULE_PROJECTION_SOURCE_LOCATION: '+path,structuredOutput:raw}]},before=structuredClone(audit)
  const feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit,corpus:f.corpus},raw.groupId)
  const excerpt=JSON.parse(feedback.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
  expect(excerpt).toMatchObject({completeSubmission:false,originalSubmissionHash:sha256CanonicalJson(raw)})
  expect(excerpt.fieldTextConflicts).toHaveLength(2)
  expect(excerpt.fieldTextConflicts.map((c:any)=>c.target)).toEqual(targets)
  expect(excerpt.fieldTextConflicts[0]).toMatchObject({path,diagnosticCode:'MODULE_PROJECTION_SOURCE_LOCATION',
   quoteHash:sha256CanonicalJson(quote),quoteLocationMatches:[{path:f.right.path,contentHash:f.right.contentHash,literalExactMatch:true}]})
  expect(feedback).toContain('不得');expect(audit).toEqual(before)
  expect(()=>verifyModuleSourceValues(f.corpus,[{...f.source,path}])).toThrow('MODULE_SOURCE_VALUE_LOCATION')
 })
 it('diagnoses a missing physical page and leaves nonexistent quotes without suggested accepted locations',()=>{
  const f=fixture(),pdf={path:'plan.pdf',contentHash:'b'.repeat(64),byteLength:100,pages:[{page:2,text:quote}]}
  const base={documents:[pdf],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
  expect(moduleSourceQuoteDiagnostic(corpus,{path:pdf.path,page:1,quote})).toMatchObject({boundSourceLocationExists:false,
   quoteLocationMatches:[{path:pdf.path,contentHash:pdf.contentHash,page:2,literalExactMatch:true}]})
  expect(moduleSourceQuoteDiagnostic(f.corpus,{path:'absent.json',quote:'完全无相关原文的虚构说法'})).not.toHaveProperty('quoteLocationMatches')
 })
 it('locates the same submitted quote in frozen sources without rebinding or accepting the wrong document',()=>{
  const f=fixture(),before=structuredClone(f),diagnostic:any=moduleSourceQuoteDiagnostic(f.corpus,f.source)
  expect(diagnostic.quoteLocationMatches).toEqual([{path:f.right.path,contentHash:f.right.contentHash,literalExactMatch:true}])
  expect(diagnostic.quoteLocationRule).toContain('Native author')
  expect(()=>verifyModuleSourceValues(f.corpus,[f.source])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
  expect(f).toEqual(before)
 })
 it('places hash-bound location diagnostics before a historical irrelevant header excerpt, leaving the rejected native draft untouched',()=>{
  const f=fixture(),target={port:'regional_nodes',recordId:'r5',field:'scale',at:'/value'},raw={groupId:'regional_nodes:3',evidence:[{kind:'source',target,source:{path:f.wrong.path,quote,valueQuote:'50'}}]}
  const audit={reviewReceipts:[],attempts:[{classId:'text',groupId:raw.groupId,status:'failed',error:'MODULE_SOURCE_VALUE_QUOTE: s; quoteDiagnostic={"sourceExcerpt":"old irrelevant header"}',structuredOutput:raw}]},before=structuredClone(audit)
  const feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit,corpus:f.corpus},raw.groupId),error=JSON.parse(feedback.split('\n').at(-1)!).previousRejection.authorErrors[0]
  expect(error).toContain('quoteLocationDiagnostic=');expect(error.indexOf('original-plan.json')).toBeLessThan(error.indexOf('old irrelevant header'))
  expect(error).toContain(sha256CanonicalJson(raw));expect(error).toContain(f.right.contentHash);expect(error).toContain('Native author')
  expect(audit).toEqual(before);expect(()=>verifyModuleSourceValues(f.corpus,[f.source])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
 })
 it('bounds ambiguous matches and retains physical PDF pages rather than declaring a unique or approved source',()=>{
  const f=fixture(),pdf={path:'multi.pdf',contentHash:'a'.repeat(64),byteLength:100,pages:[1,2,3,4].map(page=>({page,text:quote}))},base={documents:[f.wrong,pdf],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
  const diagnostic:any=moduleSourceQuoteDiagnostic(corpus,f.source)
  expect(diagnostic.quoteLocationMatches).toHaveLength(3);expect(diagnostic.quoteLocationMatches.map((m:any)=>m.page)).toEqual([1,2,3])
  expect(diagnostic.quoteLocationMatchesTruncated).toBe(true);expect(()=>verifyModuleSourceValues(corpus,[f.source])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
 })
})
