import {describe,it,expect} from 'vitest'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {moduleAuthorGroupSourceContext} from '../src/research-v2/module-group-source-context.ts'
import * as protocols from '../src/research-v2/module-field-protocol-diagnostics.ts'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'

const envelope=(port:string)=>({[port]:{type:'synthetic',quality:'limited',scope:'Synthetic research scope',asOf:'2026-01-01',limitations:['Original port limit'],records:[{recordId:'synthetic-record',resultClass:'observation_summary',value:{value:null,claimClass:'missing',limitations:['No invented facts']}}]}})
const sources=()=>({corpus:{documents:[],limitations:['Original corpus limit']},sourceValues:[{sourceId:'synthetic-source',rawValue:'original'}],inputRefs:[{moduleId:'synthetic-module',claimId:'synthetic-ref'}],
 upstream:['1.01','2.01','3.01'].map(itemId=>({itemId,moduleId:'synthetic-'+itemId,outputs:envelope(itemId==='3.01'?'market_context':'project_context'),claims:[{claimId:'synthetic-claim-'+itemId,value:'Original '+itemId,limitations:['Original claim limit']}],limitations:['Original module limit '+itemId]}))})
const selectionFeedback=(error:string,raw:unknown)=>(protocols as unknown as {peerSelectionEvidenceFeedback:(error:string,raw:unknown)=>string}).peerSelectionEvidenceFeedback(error,raw)
const draft=(field='selection')=>({groupId:'peer_supply:4.1.3',outputs:{peer_supply:{records:[{recordId:'synthetic-peer', [field]:{value:field==='selection'?'include':'Authored research judgement',claimClass:'decision',limitations:['Research choice only']}}]}},evidence:[]})

describe('peer selection context keeps project evidence and removes unrelated macro drafts',()=>{
 it('retains complete project and regional constraints while withholding macro claims from the selection author',()=>{
  const full=sources(),scoped:any=moduleAuthorGroupSourceContext('3.04',['selection','selectionReason'],full)
  for(let i=0;i<2;i++){expect(scoped.upstream[i].claims).toEqual(full.upstream[i].claims);expect(scoped.upstream[i].limitations).toEqual(full.upstream[i].limitations)}
  expect(scoped.upstream[2]).not.toHaveProperty('claims');expect(scoped.upstream[2]).not.toHaveProperty('limitations')
  expect(scoped.upstream[2].outputInventory.market_context.quality).toBe('limited')
  expect(scoped.upstream[2].outputInventory.market_context.limitations).toEqual(['Original port limit'])
  expect(scoped.groupSourceScope).toMatchObject({peerSelectionOnly:true,upstreamExcludedModuleIds:['synthetic-3.01']})
 })
 it('preserves exact frozen sources and full validation identity without altering the original object',()=>{
  const full=sources(),before=structuredClone(full),identity=hash(full),scoped:any=moduleAuthorGroupSourceContext('3.04',['selection'],full)
  expect(scoped.groupSourceScope.fullSourceContextHash).toBe(identity)
  for(const key of ['corpus','sourceValues','inputRefs'])expect(scoped[key]).toEqual(before[key as keyof typeof before])
  expect(full).toEqual(before);expect(hash(full)).toBe(identity)
 })
 it('also bounds selectionReason and expressly forbids citing omitted macro claims',()=>{
  const scoped:any=moduleAuthorGroupSourceContext('3.04',['selectionReason'],sources())
  expect(scoped.groupSourceScope.peerSelectionOnly).toBe(true)
  expect(scoped.groupSourceScope.reason).toContain('不得引用未提供的3.01')
  expect(scoped.groupSourceScope.reason).toContain('完整汇合')
 })
 it('keeps relationship, coverage and mixed groups on their existing full-claims path',()=>{
  for(const fields of [['servedNeeds','relationship'],['discoveryQueries','coverage'],['selection','relationship']]){
   const full=sources(),scoped:any=moduleAuthorGroupSourceContext('3.04',fields,full)
   expect(scoped.upstream[2].claims).toEqual(full.upstream[2].claims);expect(scoped.groupSourceScope.peerSelectionOnly).toBeUndefined()
  }
 })
 it('falls back to original complete input when a source inventory is malformed',()=>{
  const full:any=sources();full.upstream[2].outputs={malformed:true}
  expect(moduleAuthorGroupSourceContext('3.04',['selection'],full)).toBe(full)
 })
 it('does not advertise available claims when every upstream module is the withheld macro module',()=>{
  const full=sources();full.upstream=full.upstream.filter(row=>row.itemId==='3.01')
  const scoped:any=moduleAuthorGroupSourceContext('3.04',['selection'],full)
  expect(scoped.groupSourceScope.upstreamClaimsAvailable).toBe(false)
  expect(scoped.upstream[0]).not.toHaveProperty('claims');expect(scoped.upstream[0].outputInventory.market_context.quality).toBe('limited')
 })
})
describe('selection evidence protocol distinguishes a research choice from literal source evidence',()=>{
 it('guides a rejected authored selection through the existing decision/proposal schema without editing its draft',()=>{
  const raw=draft(),before=hash(raw),text=selectionFeedback('MODULE_SOURCE_VALUE_TEXT: synthetic',raw)
  expect(text).toContain('decision+proposal');expect(text).toContain('rationale');expect(text).toContain('不能只把source改成proposal')
  expect(text).toContain('不是营业状态');expect(hash(raw)).toBe(before)
 })
 it('supports a selectionReason-only rejection and preserves literal source and inference restrictions',()=>{
  const text=selectionFeedback('MODULE_SOURCE_VALUE_TEXT: synthetic',draft('selectionReason'))
  expect(text).toContain('selectionReason');expect(text).toContain('连续原文');expect(text).toContain('精确叶地址');expect(text).toContain('完整汇合和独立审查')
 })
 it('delivers decision guidance for the latest structured rejection even when a later native correction hits max-tokens',()=>{
  const raw=draft(),audit={reviewReceipts:[],attempts:[{classId:'text',groupId:raw.groupId,status:'failed',error:'MODULE_SOURCE_VALUE_TEXT: synthetic',structuredOutput:raw},{classId:'text',groupId:raw.groupId,status:'failed',error:'MODULE_NATIVE_max-tokens',submissionState:'not-submitted'}]},before=hash(audit)
  const text=moduleRecoveryFeedback({resumeExecutionAudit:audit,resumeExecutionError:'MODULE_NATIVE_max-tokens'},raw.groupId)
  expect(text).toContain('筛选决策证据协议 peer-selection-evidence.v1');expect(text).toContain('decision+proposal');expect(hash(audit)).toBe(before)
 })
 it('does not add selection guidance to other peer fields or unrelated errors',()=>{
  expect(selectionFeedback('MODULE_SOURCE_VALUE_TEXT: synthetic',draft('formalName'))).toBe('')
  expect(selectionFeedback('MODULE_NATIVE_max-tokens',draft())).toBe('')
 })
})
