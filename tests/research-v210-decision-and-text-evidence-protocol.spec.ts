import {expect,it} from 'vitest'
import {createHash} from 'node:crypto'
import {getModuleAuthorGroupOutputSchemaPrompt} from '../src/research-v2/module-author-groups.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {moduleFieldProtocolDiagnostic} from '../src/research-v2/module-field-protocol-diagnostics.ts'
import {verifyModuleSourceValues} from '../src/research-v2/module-claims.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const coverageError='MODULE_PROJECTION_OUTPUT_INVALID: regional_nodes.records.0.nodeId.claimRefs: Too small: expected array to have >=1 items'
const sourceError='MODULE_SOURCE_VALUE_TEXT: source-synthetic'
const nodeDraft=()=>({groupId:'regional_nodes:1',outputs:{regional_nodes:{records:[{recordId:'RN-SYNTHETIC',
  nodeId:{value:'NODE-SYNTHETIC',claimClass:'decision',limitations:['Working identity, not an official identifier']},
  selectionReason:{value:'Synthetic research choice',claimClass:'decision',limitations:['No verified visitor relationship']}}]}},evidence:[]})
const textDraft=()=>({groupId:'market_context:2.2',outputs:{market_context:{records:[{recordId:'MC-SYNTHETIC',
  classification:{value:'甲类、乙类',claimClass:'source_conclusion',limitations:[]}}]}},
  evidence:[{target:{port:'market_context',recordId:'MC-SYNTHETIC',field:'classification',at:''},kind:'source',
    source:{path:'synthetic.txt',quote:'甲类增加。乙类减少。'}}]})

it('keeps working decisions subject to exact field evidence coverage without changing their values',()=>{
  const raw=nodeDraft(),before=hash(raw),diagnostic=moduleFieldProtocolDiagnostic(coverageError,raw,[],'2.02')
  expect(diagnostic).toMatchObject({originalSubmissionHash:before,fieldEvidenceCoverageGaps:[
    {target:{port:'regional_nodes',recordId:'RN-SYNTHETIC',field:'nodeId',at:''}},
    {target:{port:'regional_nodes',recordId:'RN-SYNTHETIC',field:'selectionReason',at:''}}]})
  expect(hash(raw)).toBe(before)
})

it.each(['NODE-SYNTHETIC','甲类、乙类'])('rejects a working identity or assembled text %s as a literal original',rawValue=>{
  const text='甲类增加。乙类减少。',document={path:'synthetic.txt',text,contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text)}
  const base={documents:[document],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
  expect(()=>verifyModuleSourceValues(corpus,[{sourceId:'source-synthetic',path:document.path,contentHash:document.contentHash,quote:text,rawValue}])).toThrow('MODULE_SOURCE_VALUE_TEXT')
})

it('gives the first regional author one combined rule for decision coverage and literal source support',()=>{
  const prompt=getModuleAuthorGroupOutputSchemaPrompt('2.02','regional_nodes:1',[])
  expect(prompt).toContain('工作决策证据协议 working-decision-evidence.v1')
  expect(prompt).toContain('decision+proposal');expect(prompt).toContain('精确target');expect(prompt).toContain('真实rationale')
  expect(prompt).toContain('不能删除evidence');expect(prompt).toContain('不能只把source改成proposal')
})

it.each([coverageError,sourceError])('retains both decision/source duties across regional checkpoint failure %s',error=>{
  const raw=nodeDraft(),audit={reviewReceipts:[],attempts:[{classId:'text',groupId:raw.groupId,status:'failed',structuredOutput:raw,error}]},before=hash(audit)
  const feedback=moduleRecoveryFeedback({module:{id:'2.02'},resumeExecutionAudit:audit} as any,raw.groupId)
  expect(feedback).toContain('工作决策证据协议 working-decision-evidence.v1')
  expect(feedback).toContain('非空decision');expect(feedback).toContain('同一quote的连续原文支持');expect(feedback).toContain('不能删除evidence')
  expect(JSON.parse(feedback.split('\n').at(-1)!).previousRejection.authorErrors).toContain(error)
  expect(hash(audit)).toBe(before)
})

it('makes classification and statistical basis authors distinguish exact quotation from textual synthesis before submitting',()=>{
  const prompt=getModuleAuthorGroupOutputSchemaPrompt('3.01','market_context:2.2',[])
  expect(prompt).toContain('文本归纳证据协议 text-synthesis-evidence.v1')
  expect(prompt).toContain('原文中的多个分散片段');expect(prompt).toContain('单个连续原文')
  expect(prompt).toContain('真实local或upstream');expect(prompt).toContain('不改变字段类型')
})

it('carries the composite-text rejection and exact original hash into market checkpoint revision',()=>{
  const raw=textDraft(),audit={reviewReceipts:[],attempts:[{classId:'text',groupId:raw.groupId,status:'failed',structuredOutput:raw,error:sourceError}]},before=hash(audit)
  const text='甲类增加。乙类减少。',base={documents:[{path:'synthetic.txt',text,contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text)}],limitations:[]}
  const feedback=moduleRecoveryFeedback({module:{id:'3.01'},corpus:{...base,fingerprint:materialCorpusFingerprint(base)},resumeExecutionAudit:audit} as any,raw.groupId)
  expect(feedback).toContain('文本归纳证据协议 text-synthesis-evidence.v1')
  expect(feedback).toContain('不能拼接quote');expect(feedback).toContain('missing/null')
  expect(JSON.parse(feedback.split('\n').at(-1)!).previousRejection.diagnosticExcerpt.originalSubmissionHash).toBe(hash(raw))
  expect(hash(audit)).toBe(before)
})
