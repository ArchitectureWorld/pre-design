import {expect,it} from 'vitest'
import {createHash} from 'node:crypto'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {moduleSourceTextConflicts} from '../src/research-v2/module-source-text-diagnostics.ts'
import {expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {verifyModuleSourceValues} from '../src/research-v2/module-claims.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const quote='冻结原文，仅用于合成回归：\n'+Array.from({length:8},(_,i)=>`功能${i}保留原始对象、年代和适用限制。`).join('；')+'\n'+('上下文保留真实空白及原标点；'.repeat(65))
const documents=[{path:'wrong-source.txt',text:'导航页，没有本项目功能原文。'},
 ...Array.from({length:3},(_,i)=>({path:`frozen-${i}.txt`,text:quote}))]
 .map(row=>({...row,contentHash:createHash('sha256').update(row.text).digest('hex'),byteLength:Buffer.byteLength(row.text)}))
const base={documents,limitations:['synthetic test sources']},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
function draft(count=8){return {groupId:'peer_supply:2.2.1',outputs:{peer_supply:{records:[{recordId:'PS-SYNTHETIC',
 servedNeeds:{value:Array.from({length:count},(_,i)=>`功能${i}`),claimClass:'source_conclusion',limitations:['合成回归']}}]}},
 evidence:Array.from({length:count},(_,i)=>({target:{port:'peer_supply',recordId:'PS-SYNTHETIC',field:'servedNeeds',at:`/${i}`},kind:'source',
 source:{path:documents[0].path,quote}}))}}
function feedback(raw:ReturnType<typeof draft>){return moduleRecoveryFeedback({module:{id:'3.04'},corpus,
 resumeExecutionAudit:{reviewReceipts:[],attempts:[{classId:'text',status:'failed',groupId:raw.groupId,structuredOutput:raw,
 error:'MODULE_SOURCE_VALUE_QUOTE: synthetic rejected binding'}]}} as any,raw.groupId)}
it('retains every large source conflict and the exact hash-bound original diagnostics within the transport budget',()=>{
 const raw=draft(),before=hash({raw,corpus}),conflicts=moduleSourceTextConflicts(raw,corpus)
 expect(JSON.stringify(conflicts).length).toBeGreaterThan(24000)
 const text=feedback(raw),diagnostic=JSON.parse(text.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
 expect(diagnostic).toBeDefined()
 expect(JSON.stringify(diagnostic).length).toBeLessThanOrEqual(24000)
 expect(diagnostic.fieldTextConflicts.map((row:any)=>row.target)).toEqual(conflicts.map(row=>row.target))
 const original=expandModuleReferencePromptView(diagnostic.readOnlyDiagnosticView) as any
 expect(original.originalSubmissionHash).toBe(hash(raw));expect(original.completeSubmission).toBe(false)
 expect(original.fieldTextConflicts).toEqual(conflicts)
 expect(hash(original)).toBe(diagnostic.originalDiagnosticHash)
 expect(text).toContain('诊断只读对照协议 source-diagnostic-view.v1')
 expect(hash({raw,corpus})).toBe(before)
})
it('does not change the existing small complete diagnostic or source acceptance',()=>{
 const raw=draft(1),conflicts=moduleSourceTextConflicts(raw,corpus)
 const diagnostic=JSON.parse(feedback(raw).split('\n').at(-1)!).previousRejection.diagnosticExcerpt
 expect(diagnostic.fieldTextConflicts).toEqual(conflicts);expect(diagnostic.readOnlyDiagnosticView).toBeUndefined()
 expect(()=>verifyModuleSourceValues(corpus,[{sourceId:'still-rejected',path:documents[0].path,
  contentHash:documents[0].contentHash,quote,rawValue:'功能0'}])).toThrow('MODULE_SOURCE_VALUE_QUOTE')
})
it('preserves the literal source whitespace and candidate locations in the compressed original',()=>{
 const raw=draft(),diagnostic=JSON.parse(feedback(raw).split('\n').at(-1)!).previousRejection.diagnosticExcerpt
 expect(diagnostic).toBeDefined()
 const original=expandModuleReferencePromptView(diagnostic.readOnlyDiagnosticView) as any
 expect(original.fieldTextConflicts[0].quoteExcerpt).toBe(quote.slice(0,640))
 expect(original.fieldTextConflicts[0].quoteHash).toBe(hash(quote))
 expect(original.fieldTextConflicts[0].quoteLocationMatches.map((row:any)=>row.path)).toEqual(documents.slice(1).map(row=>row.path))
 expect(original.fieldTextConflicts.every((row:any)=>row.sourceLiteralReadback.diagnosticOnly)).toBe(true)
})
