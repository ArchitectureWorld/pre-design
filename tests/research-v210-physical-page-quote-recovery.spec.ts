import {describe,it,expect} from 'vitest'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {moduleSourceQuoteDiagnostic,verifyModuleSourceValues} from '../src/research-v2/module-claims.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {moduleSourceTextConflicts} from '../src/research-v2/module-source-text-diagnostics.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

function fixture(){
 const ending='本方案的编制对象为测试水库，明确了管理保护目标，提出行动计划，是为《水库“一'
 const beginning='库一策”方案（2021-2025年）》提供依据。'
 const page='前言与来源范围。'.repeat(70)+'\n'+ending.replace('管理保护目标','管理\n保护目标')
 const document={path:'original.pdf',contentHash:'a'.repeat(64),byteLength:1000,pages:[{page:2,text:page},{page:3,text:beginning+'\n独立页面。'}]}
 const core={documents:[document],limitations:[]},corpus={...core,fingerprint:materialCorpusFingerprint(core)},quote=ending+beginning
 const target={port:'project_brief',recordId:'r',field:'conflicts',at:'/0'}
 const source={path:document.path,page:2,quote},value={sourceId:'s',contentHash:document.contentHash,...source,rawValue:quote}
 const raw={groupId:'project_brief:4',outputs:{project_brief:{records:[{recordId:'r',conflicts:{value:[quote]}}]}},evidence:[{kind:'source',target,source}]}
 return {corpus,document,page,ending,beginning,quote,target,source,value,raw}
}
describe('physical PDF page boundary diagnostics keep source acceptance strict',()=>{
 it('distinguishes an omitted prefix from the actual page end for a rejected cross-page quote',()=>{
  const f=fixture(),before=structuredClone(f),d=moduleSourceQuoteDiagnostic(f.corpus,f.source)
  expect(()=>verifyModuleSourceValues(f.corpus,[f.value])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
  expect(d?.sourcePageBoundaryDiagnostic).toMatchObject({diagnosticOnly:true,physicalPage:2,sourceChars:f.page.length,
   excerptPrefixOmitted:true,excerptSuffixOmitted:false,sourceExcerptReachesPageEnd:true,submittedQuoteRunsPastPageEnd:true,
   wholeQuoteVerified:false,nextPhysicalPage:{page:3,beginningExcerpt:f.document.pages[1].text}})
  expect(d?.sourcePageBoundaryDiagnostic?.pageEndingExcerpt).toBe(f.page.slice(-160))
  expect(f).toEqual(before)
 })
 it('carries the exact field address and page boundary into cold native correction instead of reusing a truncated historical error',()=>{
  const f=fixture(),audit={attempts:[{classId:'text',groupId:f.raw.groupId,status:'failed',structuredOutput:f.raw,
   error:'MODULE_SOURCE_VALUE_QUOTE: s; quoteDiagnostic={"excerptTruncated":true}'}],reviewReceipts:[]},before=structuredClone(audit)
  const feedback=moduleRecoveryFeedback({corpus:f.corpus,resumeExecutionAudit:audit},f.raw.groupId)
  const rejection=JSON.parse(feedback.split('\n').at(-1)!).previousRejection
  expect(rejection.diagnosticExcerpt.fieldTextConflicts[0]).toMatchObject({target:f.target,
   sourcePageBoundaryDiagnostic:{physicalPage:2,submittedQuoteRunsPastPageEnd:true,wholeQuoteVerified:false}})
  expect(feedback).toContain('quotePageBoundaryDiagnostic=')
  expect(feedback).toContain(hash(f.raw));expect(feedback).toContain('physical page')
  expect(audit).toEqual(before);expect(()=>verifyModuleSourceValues(f.corpus,[f.value])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
 })
 it('passes boundary metadata through field diagnostics without changing the rejected field or quote',()=>{
  const f=fixture(),before=structuredClone(f.raw),conflicts=moduleSourceTextConflicts(f.raw,f.corpus)
  expect(conflicts[0]).toMatchObject({target:f.target,diagnosticCode:'MODULE_SOURCE_VALUE_QUOTE',quoteHash:hash(f.quote),
   sourcePageBoundaryDiagnostic:{nextPhysicalPage:{page:3},submittedQuoteRunsPastPageEnd:true}})
  expect(f.raw).toEqual(before)
 })
 it('keeps a supported quote confined to its physical page accepted without boundary correction metadata',()=>{
  const f=fixture(),quote='本方案的编制对象为测试水库'
  expect(moduleSourceQuoteDiagnostic(f.corpus,{...f.source,quote})).toBeUndefined()
  expect(verifyModuleSourceValues(f.corpus,[{...f.value,quote,rawValue:quote}])).toHaveLength(1)
 })
 it('does not label an unrelated invented quote as a cross-page continuation',()=>{
  const f=fixture(),d=moduleSourceQuoteDiagnostic(f.corpus,{...f.source,quote:'不存在的经营和价格事实'})
  expect(d?.sourcePageBoundaryDiagnostic?.submittedQuoteRunsPastPageEnd).toBe(false)
  expect(()=>verifyModuleSourceValues(f.corpus,[{...f.value,quote:'不存在的经营和价格事实'}])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
 })
})
