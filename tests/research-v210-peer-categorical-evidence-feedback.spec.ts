import {createHash} from 'node:crypto'
import {describe,it,expect} from 'vitest'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import * as diagnostics from '../src/research-v2/module-field-protocol-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {verifyModuleSourceValues} from '../src/research-v2/module-claims.ts'

const feedback=(error:string,raw:unknown)=>(diagnostics as unknown as {peerCategoricalEvidenceFeedback:(error:string,raw:unknown)=>string}).peerCategoricalEvidenceFeedback(error,raw)
const path='synthetic/status.txt',quote='历史报道描述景区游览设施；未提供当前营业核验。',contentHash=createHash('sha256').update(quote).digest('hex')
const base={documents:[{path,text:quote,contentHash,byteLength:Buffer.byteLength(quote)}],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const groupId='peer_supply:3.1.1',error='MODULE_SOURCE_VALUE_TEXT: rejected-enum'
const raw=()=>({groupId,outputs:{peer_supply:{records:['synthetic-01','synthetic-02'].map(recordId=>({recordId,status:{value:'operating',claimClass:'source_conclusion',limitations:['Historical report, current status unverified']},statusDate:{value:null,claimClass:'missing',limitations:['No operational date']}}))}},
 evidence:['synthetic-01','synthetic-02'].map(recordId=>({kind:'source',target:{port:'peer_supply',recordId,field:'status',at:''},source:{path,quote}}))})

describe('peer categorical evidence feedback keeps source and inference rules together',()=>{
 it('adds classification guidance at the existing cold recovery entry for both rejected status targets',()=>{
  const draft=raw(),audit={reviewReceipts:[],attempts:[{classId:'text',groupId,status:'failed',error,structuredOutput:draft}]},before=hash(audit)
  const text=moduleRecoveryFeedback({resumeExecutionAudit:audit,corpus},groupId),excerpt=JSON.parse(text.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
  expect(text).toContain('分类枚举引用协议')
  expect(text).toContain('operating')
  expect(text).toContain('中文原文不含英文枚举')
  expect(text).toContain('inputRefs仅支持local或upstream')
  expect(excerpt.originalSubmissionHash).toBe(hash(draft));expect(excerpt.fieldTextConflicts).toHaveLength(2);expect(hash(audit)).toBe(before)
 })
 it('keeps one latest diagnostic draft when an inference-reference error is followed by a repeated enum source error',()=>{
  const source=raw(),inference=raw();inference.outputs.peer_supply.records.forEach(row=>{row.status.claimClass='agent_inference'})
  const audit={reviewReceipts:[],attempts:[{classId:'text',groupId,status:'failed',error:'MODULE_PROJECTION_REFERENCE: array container has no evidence',structuredOutput:inference},{classId:'text',groupId,status:'failed',error,structuredOutput:source}]},before=hash(audit)
  const text=moduleRecoveryFeedback({resumeExecutionAudit:audit,corpus},groupId),rejection=JSON.parse(text.split('\n').at(-1)!).previousRejection
  expect(text).toContain('引用错误不能靠切回已被TEXT拒绝的枚举source来规避')
  expect(rejection.diagnosticExcerpt.originalSubmissionHash).toBe(hash(source));expect(hash(audit)).toBe(before)
 })
 it('offers the same joint protocol for live local-reference rejection without choosing a replacement claim',()=>{
  const draft=raw(),before=hash(draft),text=feedback('MODULE_PROJECTION_REFERENCE: exact-address-unavailable',draft)
  expect(text).toContain('数组容器at=""');expect(text).toContain('registeredEvidenceTargets')
  expect(text).toContain('servedNeeds、规模或名称的存在本身不能证明营业状态');expect(text).toContain('missing/null')
  expect(hash(draft)).toBe(before)
 })
 it('covers relationship classifications and preserves bounded JSON-output transport',()=>{
  const draft={outputsJson:JSON.stringify({peer_supply:{records:[{recordId:'synthetic-03',relationship:{value:'direct',claimClass:'source_conclusion'}}]}})}
  expect(feedback(error,draft)).toContain('direct')
 })
 it('does not add peer-classification guidance to unrelated ports or noncategorical fields',()=>{
  expect(feedback(error,{outputs:{regional_context:{records:[{status:{value:'operating'}}]}}})).toBe('')
  expect(feedback(error,{outputs:{peer_supply:{records:[{formalName:{value:'Synthetic source name'}}]}}})).toBe('')
 })
 it('does not add source/reference guidance to unrelated errors or missing fields',()=>{
  expect(feedback('MODULE_NATIVE_max-tokens',raw())).toBe('')
  const draft=raw();draft.outputs.peer_supply.records.forEach(row=>Object.assign(row.status,{value:null,claimClass:'missing'}));expect(feedback(error,draft)).toBe('')
 })
 it('keeps the literal source verifier rejecting an English status absent from the Chinese source',()=>{
  expect(()=>verifyModuleSourceValues(corpus,[{sourceId:'synthetic-status',path,contentHash,quote,rawValue:'operating'}])).toThrow('MODULE_SOURCE_VALUE_TEXT')
 })
 it('keeps genuine literal English source evidence valid without adding a representation mapping',()=>{
  const text='Published status: operating.',doc={path:'synthetic/english.txt',text,contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text)},base={documents:[doc],limitations:[]}
  expect(verifyModuleSourceValues({...base,fingerprint:materialCorpusFingerprint(base)},[{sourceId:'synthetic-literal',path:doc.path,contentHash:doc.contentHash,quote:text,rawValue:'operating'}])).toHaveLength(1)
 })
})
