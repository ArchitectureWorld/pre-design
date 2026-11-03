import {createHash} from 'node:crypto'
import {describe,it,expect} from 'vitest'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {verifyModuleSourceValues} from '../src/research-v2/module-claims.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'

function fixture(){
 const text='初步核算，2020年增加值。其\n中，第一产业、第三产业分别为80.19亿元、451.00 \n亿元。'
 const document={path:'original.pdf',contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text),pages:[{page:14,text}]}
 const base={documents:[document],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
 const quote='初步核算，2020年增加值。其中，第一产业、第三产业分别为80.19亿元、451.00 \\n亿元。'
 const raw={groupId:'market_context:2.2',projectionVersion:'module-author-field-group.v9',evidence:['classification','statisticalBasis','classification'].map((field,index)=>({kind:'source',target:{port:'market_context',recordId:'r'+index,field,at:''},source:{path:document.path,page:14,quote}}))}
 const error=Array.from({length:3},()=> 'MODULE_SOURCE_VALUE_QUOTE: rejected; quoteDiagnostic='+JSON.stringify({sourceExcerpt:text,submittedQuote:quote})).join('\n')
 const audit={attempts:[{classId:'text',groupId:raw.groupId,status:'failed',error,structuredOutput:raw}],reviewReceipts:[]}
 return {document,corpus,raw,error,audit,quote}
}
const rejection=(feedback:string)=>JSON.parse(feedback.split('\n').at(-1)!).previousRejection
describe('native quote escape diagnostics preserve the strict source gate',()=>{
 it('binds every failing field and literal escape offset to the latest raw hash, without repairing its quote',()=>{
  const f=fixture(),before=structuredClone(f),feedback=moduleRecoveryFeedback({resumeExecutionAudit:f.audit,corpus:f.corpus,resumeExecutionError:f.error},f.raw.groupId),r=rejection(feedback)
  expect(r.diagnosticExcerpt.scope).toBe('source-quote-bindings-only')
  expect(r.diagnosticExcerpt.originalSubmissionHash).toBe(sha256CanonicalJson(f.raw))
  expect(r.diagnosticExcerpt.fieldQuoteConflicts).toHaveLength(3)
  expect(r.diagnosticExcerpt.fieldQuoteConflicts.map((d:any)=>d.target)).toEqual(f.raw.evidence.map(e=>e.target))
  expect(r.diagnosticExcerpt.fieldQuoteConflicts[0].literalEscapeSpans[0].codePoints).toEqual(['U+005C','U+006E'])
  expect(r.diagnosticExcerpt.fieldQuoteConflicts[0].originalGapContexts[0].codePoints[0]).toBe('U+000A')
  expect(feedback).toContain('U+000A');expect(feedback).toContain('JSON.stringify')
  expect(f).toEqual(before)
  expect(()=>verifyModuleSourceValues(f.corpus,[{sourceId:'s',contentHash:f.document.contentHash,...f.raw.evidence[0].source,rawValue:'第一产业'}])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
 })
 it('organizes repeated quote errors as hash-bound summaries while preserving unrelated diagnostics and full audit',()=>{
  const f=fixture(),before=structuredClone(f.audit)
  f.audit.attempts.unshift({classId:'text',groupId:'market_context:4.1',status:'failed',error:'OTHER_GROUP_SENTINEL',structuredOutput:f.raw})
  const r=rejection(moduleRecoveryFeedback({resumeExecutionAudit:f.audit,corpus:f.corpus,resumeExecutionError:f.error},f.raw.groupId))
  expect(r.authorErrors[0]).toContain('originalErrorHash='+sha256CanonicalJson(f.error))
  expect(r.moduleError).toContain('originalErrorHash='+sha256CanonicalJson(f.error))
  expect(r.moduleError.length).toBeLessThan(f.error.length)
  expect(r.authorErrors.join('')).not.toContain('submittedQuote')
  expect(r.authorErrors.join('')).not.toContain('OTHER_GROUP_SENTINEL')
  expect(f.audit.attempts.at(-1)).toEqual(before.attempts[0])
 })
 it('does not diagnose a literal backslash-n that is actually present in the source',()=>{
  const f=fixture(),text='原文中的代码符号\\n本身并非换行',document={...f.document,pages:[{page:14,text}],contentHash:createHash('sha256').update(text).digest('hex')},base={documents:[document],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
  f.raw.evidence.forEach(e=>{e.source.quote=text})
  const r=rejection(moduleRecoveryFeedback({resumeExecutionAudit:f.audit,corpus},f.raw.groupId))
  expect(r.diagnosticExcerpt?.fieldQuoteConflicts).toBeUndefined()
  expect(()=>verifyModuleSourceValues(corpus,[{sourceId:'s',contentHash:document.contentHash,...f.raw.evidence[0].source,rawValue:'代码符号'}])).not.toThrow()
 })
})
