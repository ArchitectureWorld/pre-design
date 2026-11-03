import {expect,it} from 'vitest'
import {createHash} from 'node:crypto'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {verifyModuleSourceValues} from '../src/research-v2/module-claims.ts'
import {moduleSourceTextConflicts} from '../src/research-v2/module-source-text-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {getModuleAuthorGroupOutputSchemaPrompt} from '../src/research-v2/module-author-groups.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
const text='统计价格原文。注：历史统计值采用当年价格。修订状态未核。'
const documents=[{path:'wrong-planning.txt',text:'网站导航。规划发展愿景，未给统计价格。'},
 {path:'correct-statistics.txt',text:'网站导航\n'.repeat(200)+'\n'+text}].map(doc=>({...doc,contentHash:createHash('sha256').update(doc.text).digest('hex'),byteLength:Buffer.byteLength(doc.text)}))
const base={documents,limitations:['历史资料不证明当前状态']},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const target={port:'market_context',recordId:'MC-SYNTHETIC',field:'priceBasis',at:''}
const raw=()=>({groupId:'market_context:3.1',outputs:{market_context:{records:[{recordId:target.recordId,
 priceBasis:{value:'历史统计值采用当年价格',claimClass:'source_conclusion',limitations:['历史资料']}}]}},
 evidence:[{target,kind:'source',source:{path:documents[0].path,quote:text}}]})
it('binds literal frozen quote readbacks to the rejected target and exact candidate identity without replacing or accepting the source',()=>{
 const draft=raw(),before=hash({draft,corpus}),conflict=moduleSourceTextConflicts(draft,corpus)[0] as any
 expect(conflict.sourceLiteralReadback).toMatchObject({version:'source-literal-readback.v1',diagnosticOnly:true,rawValueHash:hash(draft.outputs.market_context.records[0].priceBasis.value),
  quoteLocationContexts:[{path:documents[1].path,contentHash:documents[1].contentHash,wholeQuoteAcceptedForTarget:false}]})
 const row=conflict.sourceLiteralReadback.quoteLocationContexts[0]
 expect(row.sourceExcerpt).toContain(text)
 expect(documents[1].text.slice(row.sourceExcerptStart,row.sourceExcerptStart+row.sourceExcerpt.length)).toBe(row.sourceExcerpt)
 expect(row.sourceExcerpt.length).toBeLessThanOrEqual(640)
 expect(()=>verifyModuleSourceValues(corpus,[{sourceId:'rejected',path:documents[0].path,contentHash:documents[0].contentHash,quote:text,rawValue:draft.outputs.market_context.records[0].priceBasis.value}])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
 expect(hash({draft,corpus})).toBe(before)
})
it('shows bounded original occurrences of a rejected value in its bound file when its composite quote has no complete match',()=>{
 const draft=raw();draft.evidence[0].source={path:documents[1].path,quote:text+'不存在的连接段。'}
 const before=hash(draft),conflict=moduleSourceTextConflicts(draft,corpus)[0] as any
 expect(conflict.sourceLiteralReadback.boundValueContexts).toHaveLength(1)
 expect(conflict.sourceLiteralReadback.boundValueContexts[0].sourceExcerpt).toContain(text)
 expect(conflict.sourceLiteralReadback.boundValueContexts[0].wholeQuoteAcceptedForTarget).toBe(false)
 expect(hash(draft)).toBe(before)
})
it('does not manufacture literal occurrences for an author paraphrase',()=>{
 const draft=raw();draft.outputs.market_context.records[0].priceBasis.value='改写后的统计口径'
 draft.evidence[0].source.path=documents[1].path;draft.evidence[0].source.quote+='不存在的连接段。'
 const conflict=moduleSourceTextConflicts(draft,corpus)[0] as any
 expect(conflict.sourceLiteralReadback.boundValueContexts).toEqual([])
 expect(conflict.sourceLiteralReadback.boundValueFoundInBoundSource).toBe(false)
})
it('carries the same target readbacks and native revision rule into checkpoint feedback',()=>{
 const draft=raw(),audit={reviewReceipts:[],attempts:[{classId:'text',groupId:draft.groupId,status:'failed',structuredOutput:draft,error:'MODULE_SOURCE_VALUE_QUOTE: rejected'}]},before=hash(audit)
 const feedback=moduleRecoveryFeedback({module:{id:'3.01'},corpus,resumeExecutionAudit:audit} as any,draft.groupId)
 const conflict=JSON.parse(feedback.split('\n').at(-1)!).previousRejection.diagnosticExcerpt.fieldTextConflicts[0]
 expect(conflict.sourceLiteralReadback.version).toBe('source-literal-readback.v1')
 expect(feedback).toContain('原文位置对照协议 source-literal-readback.v1')
 expect(feedback).toContain('不能沿用另一条记录或前组的path')
 expect(hash(audit)).toBe(before)
})
it.each([['2.02','regional_nodes:1'],['3.01','market_context:3.1']])('gives %s %s a literal field meaning and per-record identity rule before submission',(itemId,groupId)=>{
 const prompt=getModuleAuthorGroupOutputSchemaPrompt(itemId,groupId,[])
 expect(prompt).toContain('原文位置对照协议 source-literal-readback.v1')
 expect(prompt).toContain('类型字段不能用对象名称代替')
 expect(prompt).toContain('不能沿用另一条记录或前组的path')
})
