import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyModuleSourceValues, moduleSourceQuoteDiagnostic } from '../src/research-v2/module-claims.ts'
import { moduleRecoveryFeedback } from '../src/research-v2/module-recovery-feedback.ts'
import { materialCorpusFingerprint } from '../src/materials/research-evidence.ts'

function example(text: string, quote: string, rawValue: string | number, valueQuote?: string) {
  const document={path:'原件.pdf',contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text),pages:[{page:26,text}]}
  const content={documents:[document],limitations:[]}, corpus={...content,fingerprint:materialCorpusFingerprint(content)}
  return {corpus,source:{sourceId:'quoted',path:document.path,contentHash:document.contentHash,page:26,quote,rawValue,...(valueQuote?{valueQuote}:{})}}
}
describe('Chinese PDF layout quote matching',()=>{
  it('pinpoints literal whitespace in a rejected PDF quote without changing acceptance or source bytes',()=>{
    const original='新洲区地处长江中游北岸，东北\n部为低山丘陵， 中部岗地、 平原相间， 西南部为滨湖平原。'
    const {corpus,source}=example(original,'新洲区地处长江中游北岸，东北部为低山丘陵，中部岗地、平原相间，西南部为滨湖平原','新洲区')
    const before=JSON.stringify({corpus,source})
    const diagnostic=moduleSourceQuoteDiagnostic(corpus,source)
    expect(diagnostic?.sourceWhitespaceContexts).toEqual([
      {sourceOffset:14,codePoints:['U+000A'],before:'中游北岸，东北',after:'部为低山丘陵，'},
      {sourceOffset:22,codePoints:['U+0020'],before:'部为低山丘陵，',after:'中部岗地、 平'},
      {sourceOffset:28,codePoints:['U+0020'],before:'， 中部岗地、',after:'平原相间， 西'},
      {sourceOffset:34,codePoints:['U+0020'],before:'、 平原相间，',after:'西南部为滨湖平'},
    ])
    expect(diagnostic?.correctionRule).toContain('literal whitespace')
    expect(()=>verifyModuleSourceValues(corpus,[source])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
    expect(JSON.stringify({corpus,source})).toBe(before)
  })
  it('puts fresh whitespace diagnostics ahead of an old quote diagnostic in native recovery feedback',()=>{
    const original='新洲区地处长江中游北岸，东北\n部为低山丘陵， 中部岗地、 平原相间， 西南部为滨湖平原。'
    const {corpus,source}=example(original,'新洲区地处长江中游北岸，东北部为低山丘陵，中部岗地、平原相间，西南部为滨湖平原','新洲区')
    const audit={reviewReceipts:[],attempts:[{classId:'text',groupId:'regional_context:3',status:'failed',
      error:'MODULE_SOURCE_VALUE_QUOTE: quoted; quoteDiagnostic='+JSON.stringify({sourceExcerpt:original})+'x'.repeat(2200),
      structuredOutput:{evidence:[{kind:'source',source}]}}]}
    const before=JSON.stringify(audit)
    const rejection=JSON.parse(moduleRecoveryFeedback({resumeExecutionAudit:audit,corpus},'regional_context:3').split('\n').at(-1)!).previousRejection
    expect(rejection.authorErrors[0]).toContain('quoteWhitespaceDiagnostic=')
    expect(rejection.authorErrors[0]).toContain('U+0020')
    expect(rejection.authorErrors[0]).toContain('literal whitespace')
    expect(JSON.stringify(audit)).toBe(before)
  })
  it('returns bounded original text for quote correction without accepting or rewriting a changed word',()=>{
    const original='少潭河水库生态基流的操\n作性不强，没有具体的执行方案。'
    const {corpus,source}=example(original,'少潭河水库生态基流的操作性能不强，没有具体的执行方案。','操作性能不强')
    const before=JSON.stringify({corpus,source})
    let error=''
    try { verifyModuleSourceValues(corpus,[source]) } catch(value){error=String(value)}
    expect(error).toContain('MODULE_SOURCE_VALUE_QUOTE')
    expect(error).toContain('quoteDiagnostic=')
    const diagnostic=JSON.parse(error.split('quoteDiagnostic=')[1])
    expect(diagnostic.sourceExcerpt).toBe(original)
    expect(diagnostic.diagnosticOnly).toBe(true)
    expect(diagnostic.submittedQuote).toBe(source.quote)
    expect(JSON.stringify({corpus,source})).toBe(before)
  })
  it('matches a Chinese document number wrapped after its closing bracket without merging digit tokens',()=>{
    const {corpus,source}=example('湖北省水利厅下发文件《省水利厅关于公\n布 2021 年全省水工程生态基流重点监管名录的通知》鄂水利函【2021】\n356 号',
      '湖北省水利厅下发文件《省水利厅关于公布 2021 年全省水工程生态基流重点监管名录的通知》鄂水利函【2021】356 号','鄂水利函【2021】356 号')
    expect(verifyModuleSourceValues(corpus,[source])).toEqual([source])
  })
  it('accepts the exact Chinese text across a PDF line wrap while preserving original bytes and submitted quote',()=>{
    const {corpus,source}=example('水库执法以少潭河工程管理局及新洲区各相关行业主管部门执法为\n主，因各执法主体的执法权限制约，统一执法难度大。',
      '水库执法以少潭河工程管理局及新洲区各相关行业主管部门执法为主，因各执法主体的执法权限制约，统一执法难度大。','少潭河工程管理局')
    const before=JSON.stringify({corpus,source})
    expect(verifyModuleSourceValues(corpus,[source])).toEqual([source])
    expect(JSON.stringify({corpus,source})).toBe(before)
  })
  it.each([
    ['面积 1 2 平方米','面积 12 平方米',12,'12'],
    ['holder AB CD','holder ABCD','ABCD',undefined],
    ['水库执法为主','水库产权为主','产权',undefined],
    ['少潭河管理\n\n资产有权属争议','少潭河管理资产有权属争议','少潭河',undefined],
  ] as const)('keeps non-layout differences rejected: %s',(text,quote,raw,valueQuote)=>{
    const {corpus,source}=example(text,quote,raw,valueQuote)
    expect(()=>verifyModuleSourceValues(corpus,[source])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
  })
})
