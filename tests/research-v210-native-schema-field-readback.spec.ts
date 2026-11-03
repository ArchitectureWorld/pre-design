import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { materialCorpusFingerprint } from '../src/materials/research-evidence.ts'
import { sha256CanonicalJson as hash } from '../src/presentation/canonical-json.ts'
import { bindNativeModuleEvidenceSchema, getModuleAuthorProjectionSchema } from '../src/research-v2/module-author-projection.ts'
import { nativeSchemaCorrectionFeedback, nativeSchemaRecoveryFeedback } from '../src/research-v2/native-schema-recovery.ts'
import { moduleAuthorGroupRecoveryFeedback } from '../src/research-v2/native-module-runtime.ts'
import { verifyModuleSourceValues } from '../src/research-v2/module-claims.ts'

const text='关于规划管理的原始通知。历史适用范围尚待核验。',path='sources/original.txt'
const document={path,text,contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text)}
const base={documents:[document],limitations:[]},corpus={...base,fingerprint:materialCorpusFingerprint(base)}
const groupId='planning_conditions:3.2',target={port:'planning_conditions',recordId:'policy-01',field:'applicableUses',at:'/0'}
const stale={...target,recordId:'wrong-record'},value='原文未支持的合成判断'
const raw={groupId,outputs:{planning_conditions:{records:[{recordId:target.recordId,applicableUses:{value:[value],claimClass:'source_conclusion',limitations:[]}}]}},
  evidence:[{target,kind:'source',source:{path,quote:text},quote:'unexpected outer quote'}],
  stepResults:{step1:{summary:'原稿步骤',status:'limited',fieldRefs:[stale],limitations:[]}}}
const schema={type:'object' as const,additionalProperties:false,required:['groupId','outputs','evidence','stepResults'],properties:{
  groupId:{type:'string' as const},outputs:{type:'object' as const},stepResults:{type:'object' as const},
  evidence:bindNativeModuleEvidenceSchema(getModuleAuthorProjectionSchema('1.03')).properties!.evidence}}
function logs(draft:any=raw):any[]{return [
  {seq:1,type:'turn/start',data:{turn:1}},
  {seq:2,type:'request/header',data:{header:{tools:[{name:'structured_output',parameters:schema}]}}},
  {seq:3,type:'tool/call',data:{turn:1,step:0,name:'structured_output',callId:'call',arguments:JSON.stringify(draft)}},
  {seq:4,type:'tool/result',data:{turn:1,step:0,message:{content:[{type:'tool-result',toolCallId:'call',isError:true,content:[{text:'UNTRUSTED ERROR'}]}]}}},
  {seq:5,type:'assistant/message',data:{message:{content:[{type:'thinking',text:'PRIVATE THOUGHT'}]}}},
  {seq:6,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}},
]}
const execution:any={id:'latest',projectId:'project',parentId:'parent',classId:'text',status:'failed',childId:'child',
  selected:{provider:'native',model:'text'},actual:{provider:'native',model:'text'}}
function context():any{return {projectId:'project',signal:new AbortController().signal,corpus,resumeExecutionAudit:{reviewReceipts:[{
  verdict:'limited',executionId:'review',childId:'review-child',candidateHash:'candidate',authorGroupsHash:'groups',
  checks:[{criterion:'真实独审',status:'limited',rationale:'空间适用性仍未核验'}],limitations:['保留真实独审限制']}],attempts:[
  {classId:'text',groupId,status:'completed',structuredOutput:{...raw,groupId:'retained-prefix'},structuredHash:'retained'},
  {classId:'text',groupId:'other:1',status:'failed',error:'MODULE_SOURCE_VALUE_TEXT: other group',structuredOutput:{marker:'other rejected draft'}},
  {classId:'text',groupId,status:'failed',error:'MODULE_SOURCE_VALUE_TEXT: older draft',executionId:'older',childId:'older-child',structuredOutput:{...raw,marker:'OLDER BUSINESS DRAFT'}},
  {classId:'text',groupId,status:'failed',error:'MODULE_NATIVE_error',executionId:'latest',childId:'child',submissionState:'not-submitted',sourceContextFingerprint:'source-hash'},
]}}}
const unpack=(feedback:string)=>JSON.parse(feedback.split('\n').at(-1)!).rejectedNativeSchema
async function verified(c:any,events=logs()){return nativeSchemaRecoveryFeedback(c,{id:'parent'} as any,{execution:()=>execution},async()=>events,groupId,schema,'source-hash')}

describe('same-draft native schema field readback',()=>{
  it('reports hidden source and step conflicts from the exact unaccepted native draft without repairing or accepting it',()=>{
    const events=logs(),before=hash(events),feedback=nativeSchemaCorrectionFeedback(events,schema,'latest','child',corpus)
    const result=unpack(feedback)
    expect(result.originalSubmission).toEqual(raw)
    expect(result.originalSubmissionHash).toBe(hash(raw))
    expect(result.fieldReadbackDiagnostics).toMatchObject({diagnosticOnly:true,completeSubmission:false,acceptanceGranted:false,
      originalSubmissionHash:hash(raw),sourceDiagnostics:{originalSubmissionHash:hash(raw),fieldTextConflicts:[{target,diagnosticCode:'MODULE_SOURCE_VALUE_TEXT',rawValueHash:hash(value)}]},
      stepEvidenceConflicts:[{target:stale,fieldRefPaths:['/stepResults/step1/fieldRefs/0']}],
      stepValidationErrors:[expect.stringContaining('limited step'),expect.stringContaining('no matching evidence.target')]})
    expect(hash(events)).toBe(before)
    expect(feedback).not.toContain('PRIVATE THOUGHT')
    expect(feedback).not.toContain('UNTRUSTED ERROR')
    expect(()=>verifyModuleSourceValues(corpus,[{sourceId:'still-rejected',path,contentHash:document.contentHash,quote:text,rawValue:value}])).toThrow('MODULE_SOURCE_VALUE_TEXT')
  })
  it('still supplies exact step paths when no frozen corpus was passed, without inventing source diagnostics',()=>{
    const result=unpack(nativeSchemaCorrectionFeedback(logs(),schema,'latest','child'))
    expect(result.fieldReadbackDiagnostics.stepEvidenceConflicts[0].target).toEqual(stale)
    expect(result.fieldReadbackDiagnostics.sourceDiagnostics).toBeUndefined()
  })
  it('passes the verified frozen context into cold schema readback',async()=>{
    const c=context(),before=hash(c.resumeExecutionAudit),result=unpack(await verified(c))
    expect(result.fieldReadbackDiagnostics.sourceDiagnostics.fieldTextConflicts[0].target).toEqual(target)
    expect(hash(c.resumeExecutionAudit)).toBe(before)
  })
  it('supersedes only the same-group old author prompt while retaining independent review and the unchanged audit',async()=>{
    const c=context(),before=structuredClone(c.resumeExecutionAudit),feedback=await verified(c)
    const result=moduleAuthorGroupRecoveryFeedback(c,{groupId},feedback)
    expect(result).not.toContain('OLDER BUSINESS DRAFT')
    expect(result).not.toContain(hash(c.resumeExecutionAudit.attempts[2].structuredOutput))
    expect(result).toContain('空间适用性仍未核验')
    expect(result).toContain('保留真实独审限制')
    expect(c.resumeExecutionAudit).toEqual(before)
    expect(moduleAuthorGroupRecoveryFeedback(c,{groupId:'other:1'},feedback)).toContain('MODULE_SOURCE_VALUE_TEXT: other group')
  })
  it.each(['no-feedback','wrong-receipt','wrong-route','changed-source'])('retains the earlier business draft when latest schema recovery is unverified: %s',async mode=>{
    const c=context(),events=logs()
    if(mode==='wrong-receipt')events[3].data.message.content[0].toolCallId='different'
    if(mode==='changed-source')c.resumeExecutionAudit.attempts.at(-1)!.sourceContextFingerprint='changed'
    const readEvents=vi.fn(async()=>events)
    const feedback=mode==='no-feedback'?'':await nativeSchemaRecoveryFeedback(c,{id:'parent'} as any,
      {execution:()=>mode==='wrong-route'?{...execution,actual:{provider:'other',model:'text'}}:execution},readEvents,groupId,schema,'source-hash')
    expect(feedback).toBe('')
    expect(moduleAuthorGroupRecoveryFeedback(c,{groupId},feedback)).toContain(hash(c.resumeExecutionAudit.attempts[2].structuredOutput))
  })
})
