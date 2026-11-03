import {createHash} from 'node:crypto'
import {describe,it,expect} from 'vitest'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {verifyModuleSourceValues} from '../src/research-v2/module-claims.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'

const quote='关于印发武汉市新洲区国土空间总体规划（2021—2035年）的通知'
const path='sources/notification.json',contentHash=createHash('sha256').update(quote).digest('hex')
const base={documents:[{path,contentHash,byteLength:Buffer.byteLength(quote),text:quote}],limitations:[]}
const corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const target={port:'regional_context',recordId:'district',field:'planningStatus',at:''}
const value='《武汉市新洲区国土空间总体规划（2021-2035年）》印发通知'
const raw={outputs:{regional_context:{records:[{recordId:'district',planningStatus:{value,claimClass:'source_conclusion',limitations:[]}}]}},
 evidence:[{kind:'source',target,source:{path,quote}}]}
const audit={reviewReceipts:[],attempts:[{classId:'text',groupId:'regional_context:2',status:'failed',error:'MODULE_SOURCE_VALUE_TEXT: old-source',structuredOutput:raw}]}
const rejection=(feedback:string)=>JSON.parse(feedback.split('\n').at(-1)!).previousRejection

describe('original string source failures require native author correction',()=>{
 it.each([false,true])('distinguishes a valid quoted value from an unsupported narrative despite a wrong web URL binding (unsupported: %s)',unsupported=>{
  const text='农历二月十五花朝节，正值春耕备耕之际',document={path:'research/runs/RUN-frozen/sources/original.json',text,
   contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text)}
  const base={documents:[document],limitations:[]},webCorpus={...base,fingerprint:materialCorpusFingerprint(base)}
  const target={port:'local_resources',recordId:'festival',field:'seasonality',at:''},value=unsupported?'网页历史叙述记载：'+text+'。当期举办仍待核验。':text
  const rejected={outputs:{local_resources:{records:[{recordId:'festival',seasonality:{value}}]}},
   evidence:[{target,kind:'source',source:{path:'https://example.test/festival',quote:text}}]}
  const failed={reviewReceipts:[],attempts:[{classId:'text',groupId:'local_resources:4.1',status:'failed',error:'MODULE_PROJECTION_SOURCE_LOCATION: web-url',structuredOutput:rejected}]}
  const before=structuredClone({failed,webCorpus}),feedback=moduleRecoveryFeedback({resumeExecutionAudit:failed,corpus:webCorpus},'local_resources:4.1')
  const conflict=rejection(feedback).diagnosticExcerpt.fieldTextConflicts[0]
  expect(conflict).toMatchObject({target,diagnosticCode:'MODULE_PROJECTION_SOURCE_LOCATION',rawValueHash:sha256CanonicalJson(value),quoteHash:sha256CanonicalJson(text)})
  if(unsupported)expect(conflict.sourceValueSupportDiagnostic).toMatchObject({diagnosticOnly:true,unchangedValueRejectedAtEveryQuotedLocation:true,
   checkedLocations:[{path:document.path,diagnosticCode:'MODULE_SOURCE_VALUE_TEXT'}]})
  else expect(conflict.sourceValueSupportDiagnostic).toBeUndefined()
  expect(feedback).toContain('source.path须逐字复制冻结documents.path')
  expect(feedback).toContain('含RUN目录与完整文件名')
  expect({failed,webCorpus}).toEqual(before)
  if(unsupported)expect(()=>verifyModuleSourceValues(webCorpus,[{sourceId:'unchanged',path:document.path,contentHash:document.contentHash,quote:text,rawValue:value}])).toThrow('MODULE_SOURCE_VALUE_TEXT')
  else expect(()=>verifyModuleSourceValues(webCorpus,[{sourceId:'unchanged',path:document.path,contentHash:document.contentHash,quote:text,rawValue:value}])).not.toThrow()
 })
 it.each([false,true])('binds original PDF newline diagnostics to a rejected quote and field during recovery (empty correction: %s)',emptyCorrection=>{
  const text='把具有流域特色的水文化因素融入水工程设计，\n体现当地民俗和水文化结合的特色。',cleaned=text.replace('\n','')
  const document={path:'original.pdf',contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text),pages:[{page:46,text}]}
  const base={documents:[document],limitations:[]},pdfCorpus={...base,fingerprint:materialCorpusFingerprint(base)}
  const target={port:'local_resources',recordId:'water-culture',field:'experienceContent',at:'/0'}
  const rejected={outputs:{local_resources:{records:[{recordId:target.recordId,experienceContent:{value:[cleaned]}}]}},
   evidence:[{target,kind:'source',source:{path:document.path,page:46,quote:cleaned}}]}
  const failed={reviewReceipts:[],attempts:[{classId:'text',groupId:'local_resources:3.1',status:'failed',error:'MODULE_SOURCE_VALUE_QUOTE: rejected-field',structuredOutput:rejected},
   ...(emptyCorrection?[{classId:'text',groupId:'local_resources:3.1',status:'failed',submissionState:'not-submitted',error:'MODULE_NATIVE_error'}]:[])]}
  const before=structuredClone({failed,pdfCorpus}),feedback=moduleRecoveryFeedback({resumeExecutionAudit:failed,corpus:pdfCorpus},'local_resources:3.1')
  const excerpt=rejection(feedback).diagnosticExcerpt
  expect(excerpt).toMatchObject({originalSubmissionHash:sha256CanonicalJson(rejected),completeSubmission:false})
  expect(excerpt.fieldTextConflicts[0]).toMatchObject({target,diagnosticCode:'MODULE_SOURCE_VALUE_QUOTE',rawValueExcerpt:cleaned,quoteExcerpt:cleaned,
   sourceQuoteWhitespaceDiagnostic:{diagnosticOnly:true,sourceExcerpt:text,sourceExcerptStart:0,sourceWhitespaceContexts:[{sourceOffset:21,codePoints:['U+000A']}]}})
  expect(feedback).toContain('quote和绑定字段value须同时核对')
  expect({failed,pdfCorpus}).toEqual(before)
  expect(()=>verifyModuleSourceValues(pdfCorpus,[{sourceId:'still-rejected',path:document.path,contentHash:document.contentHash,page:46,quote:cleaned,rawValue:cleaned}])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
  expect(()=>verifyModuleSourceValues(pdfCorpus,[{sourceId:'preserved-original',path:document.path,contentHash:document.contentHash,page:46,quote:text,rawValue:text}])).not.toThrow()
 })
 it('identifies literal quote gaps when the native author corrected the quote but retained a cleaned field value',()=>{
  const text='管理保护等   8   个方面，明确了管理保护目标',cleaned='管理保护等8个方面，明确了管理保护目标'
  const document={path:'original.pdf',contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text),pages:[{page:2,text}]}
  const base={documents:[document],limitations:[]},pdfCorpus={...base,fingerprint:materialCorpusFingerprint(base)}
  const target={port:'project_brief',recordId:'PB-01',field:'conflicts',at:'/0'}
  const rejected={outputs:{project_brief:{records:[{recordId:'PB-01',conflicts:{value:[cleaned]}}]}},
   evidence:[{target,kind:'source',source:{path:document.path,page:2,quote:text}}]}
  const failed={reviewReceipts:[],attempts:[{classId:'text',groupId:'project_brief:4',status:'failed',error:'MODULE_SOURCE_VALUE_TEXT: rejected-field',structuredOutput:rejected}]},before=structuredClone(failed)
  const conflict=rejection(moduleRecoveryFeedback({resumeExecutionAudit:failed,corpus:pdfCorpus},'project_brief:4')).diagnosticExcerpt.fieldTextConflicts[0]
  expect(conflict).toMatchObject({target,diagnosticCode:'MODULE_SOURCE_VALUE_TEXT',rawValueExcerpt:cleaned,quoteExcerpt:text,
   whitespaceBindingDiagnostic:{diagnosticOnly:true,whitespaceStrippedQuoteContainsValue:true,quoteWhitespaceContexts:[
    {quoteOffset:5,codePoints:['U+0020','U+0020','U+0020']},
    {quoteOffset:9,codePoints:['U+0020','U+0020','U+0020']}]}})
  expect(failed).toEqual(before)
  expect(()=>verifyModuleSourceValues(pdfCorpus,[{sourceId:'still-rejected',path:document.path,contentHash:document.contentHash,page:2,quote:text,rawValue:cleaned}])).toThrow('MODULE_SOURCE_VALUE_TEXT')
 })
 it('does not describe changed source text as a whitespace-only binding conflict',()=>{
  const text='管理保护等   8   个方面',value='管理保护等9个方面'
  const document={path:'original.pdf',contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text),pages:[{page:2,text}]}
  const base={documents:[document],limitations:[]},pdfCorpus={...base,fingerprint:materialCorpusFingerprint(base)}
  const rejected={outputs:{regional_context:{records:[{recordId:'district',planningStatus:{value}}]}},evidence:[{kind:'source',target,source:{path:document.path,page:2,quote:text}}]}
  const failed={reviewReceipts:[],attempts:[{...audit.attempts[0],structuredOutput:rejected}]}
  const conflict=rejection(moduleRecoveryFeedback({resumeExecutionAudit:failed,corpus:pdfCorpus},'regional_context:2')).diagnosticExcerpt.fieldTextConflicts[0]
  expect(conflict.diagnosticCode).toBe('MODULE_SOURCE_VALUE_TEXT')
  expect(conflict.whitespaceBindingDiagnostic).toBeUndefined()
  expect(()=>verifyModuleSourceValues(pdfCorpus,[{sourceId:'still-rejected',path:document.path,contentHash:document.contentHash,page:2,quote:text,rawValue:value}])).toThrow('MODULE_SOURCE_VALUE_TEXT')
 })
 it('delivers numeric quote location failures at their exact field targets after an empty native correction without changing rejected values',()=>{
  const numericQuote='2022年地区生产总值达到1062亿元。',wrongPath='wrong-statistic.json',rightPath='original-statistic.json'
  const documents=[{path:wrongPath,text:'历史统计：2020年GDP为888.57亿元。'},
   {path:rightPath,text:'历史报道\n'+numericQuote+'\n仅用于历史背景，不证明当期市场需求。'}].map(d=>({...d,byteLength:Buffer.byteLength(d.text),contentHash:createHash('sha256').update(d.text).digest('hex')}))
  const base={documents,limitations:[]},numericCorpus={...base,fingerprint:materialCorpusFingerprint(base)}
  const targets=['originalValue','normalizedValue'].map(field=>({port:'market_context',recordId:'mc-6',field,at:'/value'}))
  const rejected={groupId:'market_context:2.1.3',outputs:{market_context:{records:[{recordId:'mc-6',
   ...Object.fromEntries(targets.map(t=>[t.field,{value:{value:1062,unit:'亿元',basis:'历史统计'},claimClass:'source_conclusion',limitations:[]}]))}]}},
   evidence:targets.map(target=>({target,kind:'source',source:{path:wrongPath,quote:numericQuote,valueQuote:'1062'}}))}
  const failed={reviewReceipts:[],attempts:[{classId:'text',groupId:rejected.groupId,status:'failed',error:'MODULE_SOURCE_VALUE_QUOTE: wrong-bound-statistic',structuredOutput:rejected},
   {classId:'text',groupId:rejected.groupId,status:'failed',submissionState:'not-submitted',error:'MODULE_NATIVE_error'}]},before=structuredClone(failed)
  const excerpt=rejection(moduleRecoveryFeedback({resumeExecutionAudit:failed,corpus:numericCorpus},rejected.groupId)).diagnosticExcerpt
  expect(excerpt).toMatchObject({scope:'source-text-bindings-only',completeSubmission:false,originalSubmissionHash:sha256CanonicalJson(rejected)})
  expect(excerpt.fieldTextConflicts.map((c:any)=>c.target)).toEqual(targets)
  for(const conflict of excerpt.fieldTextConflicts)expect(conflict).toMatchObject({diagnosticCode:'MODULE_SOURCE_VALUE_QUOTE',path:wrongPath,
   rawValueHash:sha256CanonicalJson(1062),quoteHash:sha256CanonicalJson(numericQuote),rawValueExcerpt:1062,
   quoteLocationMatches:[{path:rightPath,contentHash:documents[1].contentHash,literalExactMatch:true}]})
  expect(failed).toEqual(before)
  expect(()=>verifyModuleSourceValues(numericCorpus,[{sourceId:'still-invalid',path:wrongPath,contentHash:documents[0].contentHash,quote:numericQuote,valueQuote:'1062',rawValue:1062}])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
 })
 it('keeps supported numeric bindings and number mismatches outside quote-location diagnostics',()=>{
  const text='历史GDP为1062亿元。',document={path:'statistic.txt',text,contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text)}
  const base={documents:[document],limitations:[]},numericCorpus={...base,fingerprint:materialCorpusFingerprint(base)}
  for(const value of [1062,1063]){
   const rejected={outputs:{market_context:{records:[{recordId:'mc-6',originalValue:{value:{value,unit:'亿元',basis:'历史统计'}}}]}},
    evidence:[{target:{port:'market_context',recordId:'mc-6',field:'originalValue',at:'/value'},kind:'source',source:{path:document.path,quote:text,valueQuote:'1062'}}]}
   const failed={reviewReceipts:[],attempts:[{classId:'text',groupId:'market_context:2.1.3',status:'failed',error:'MODULE_SOURCE_VALUE_QUOTE: prior error',structuredOutput:rejected}]}
   expect(rejection(moduleRecoveryFeedback({resumeExecutionAudit:failed,corpus:numericCorpus},'market_context:2.1.3')).diagnosticExcerpt).toBeUndefined()
  }
 })
 it('binds an invalid quote to its exact field during quote-only cold recovery without repairing the source',()=>{
  const wrongQuote='另一份未绑定材料的规划通知',rejected={...raw,evidence:[{...raw.evidence[0],source:{path,quote:wrongQuote}}]}
  const failed={reviewReceipts:[],attempts:[{...audit.attempts[0],error:'MODULE_SOURCE_VALUE_QUOTE: wrong original binding',structuredOutput:rejected},
   {classId:'text',groupId:'regional_context:2',status:'failed',submissionState:'not-submitted',error:'MODULE_NATIVE_error'}]},before=structuredClone(failed)
  const excerpt=rejection(moduleRecoveryFeedback({resumeExecutionAudit:failed,corpus},'regional_context:2')).diagnosticExcerpt
  expect(excerpt).toMatchObject({scope:'source-text-bindings-only',completeSubmission:false,originalSubmissionHash:sha256CanonicalJson(rejected)})
  expect(excerpt.fieldTextConflicts).toHaveLength(1)
  expect(excerpt.fieldTextConflicts[0]).toMatchObject({target,path,contentHash,diagnosticCode:'MODULE_SOURCE_VALUE_QUOTE',rawValueHash:sha256CanonicalJson(value),quoteHash:sha256CanonicalJson(wrongQuote)})
  expect(failed).toEqual(before)
  expect(()=>verifyModuleSourceValues(corpus,[{sourceId:'still-rejected',path,contentHash,quote:wrongQuote,rawValue:value}])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
 })
 it('returns the exact rejected address and quoted text boundary without accepting or rewriting the paraphrased title',()=>{
  const before=structuredClone(audit)
  const feedback=moduleRecoveryFeedback({resumeExecutionAudit:audit,corpus},'regional_context:2')
  const excerpt=rejection(feedback).diagnosticExcerpt
  expect(excerpt).toMatchObject({scope:'source-text-bindings-only',completeSubmission:false,originalSubmissionHash:sha256CanonicalJson(raw)})
  expect(excerpt.fieldTextConflicts).toHaveLength(1)
  expect(excerpt.fieldTextConflicts[0]).toMatchObject({evidenceIndex:0,target,rawValueExcerpt:value,quoteExcerpt:quote,
    rawValueHash:sha256CanonicalJson(value),quoteHash:sha256CanonicalJson(quote),rawValueExcerptTruncated:false,quoteExcerptTruncated:false})
  expect(feedback).toContain('字段value自身')
  expect(feedback).toContain('不得机械替换')
  expect(audit).toEqual(before)
  expect(()=>verifyModuleSourceValues(corpus,[{sourceId:'old-source',path,contentHash,quote,rawValue:value}])).toThrow('MODULE_SOURCE_VALUE_TEXT')
  expect(moduleRecoveryFeedback({resumeExecutionAudit:audit,corpus},'regional_context:3')).toBe('')
 })
 it('only reports strings rejected by the unchanged verifier, preserving PDF layout normalization and other error categories',()=>{
  const pdfText='总体规\n划已经印发',pdfPath='original.pdf',pdfHash=createHash('sha256').update(pdfText).digest('hex')
  const pdfBase={documents:[{path:pdfPath,contentHash:pdfHash,byteLength:Buffer.byteLength(pdfText),pages:[{page:1,text:pdfText}]}],limitations:[]}
  const pdfCorpus={...pdfBase,fingerprint:materialCorpusFingerprint(pdfBase)}
  const supported={outputs:{regional_context:{records:[{recordId:'district',planningStatus:{value:'总体规划已经印发'}}]}},
   evidence:[{kind:'source',target,source:{path:pdfPath,page:1,quote:pdfText}}]}
  const unchanged={reviewReceipts:[],attempts:[{...audit.attempts[0],structuredOutput:supported}]}
  expect(rejection(moduleRecoveryFeedback({resumeExecutionAudit:unchanged,corpus:pdfCorpus},'regional_context:2')).diagnosticExcerpt).toBeUndefined()
  expect(verifyModuleSourceValues(pdfCorpus,[{sourceId:'pdf-source',path:pdfPath,contentHash:pdfHash,page:1,quote:pdfText,rawValue:'总体规划已经印发'}])).toHaveLength(1)
 })
})
