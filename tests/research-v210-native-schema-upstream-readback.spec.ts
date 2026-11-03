import {describe,it,expect} from 'vitest'
import {bindNativeModuleEvidenceSchema,getModuleAuthorProjectionSchema} from '../src/research-v2/module-author-projection.ts'
import {nativeSchemaCorrectionFeedback,nativeSchemaRecoveryFeedback} from '../src/research-v2/native-schema-recovery.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'

const all=bindNativeModuleEvidenceSchema(getModuleAuthorProjectionSchema('3.04'))
const schema:any={type:'object',additionalProperties:false,required:['evidence'],properties:{evidence:structuredClone(all.properties!.evidence)}}
const upstream:any=[{moduleId:'2.04',claims:[{claimId:'claim-real',kind:'source'}]}]
const inference=schema.properties.evidence.items.oneOf.find((row:any)=>row.properties.kind.const==='inference'||row.properties.kind.enum?.includes('inference'))
inference.properties.inputRefs.items={oneOf:[{type:'object',additionalProperties:false,required:['upstream'],properties:{upstream:{
  type:'object',additionalProperties:false,required:['moduleId','claimId'],properties:{moduleId:{type:'string',const:'2.04'},claimId:{type:'string',enum:['claim-real']}},
}}}]}
const target={port:'peer_supply',recordId:'peer-1',field:'servedNeeds',at:'/0'}
const raw={evidence:[{target,kind:'inference',rationale:'待研究任务回查真实依据',inputRefs:[{upstream:{moduleId:'2.04',claimId:'claim-does-not-exist'}}]}]}
function events(stopKind='max-tokens'):any[]{return [
  {seq:1,type:'turn/start',data:{turn:1}},
  {seq:2,type:'request/header',data:{header:{tools:[{name:'structured_output',parameters:schema}]}}},
  {seq:3,type:'tool/call',data:{turn:1,step:0,name:'structured_output',callId:'call',arguments:JSON.stringify({value:raw})}},
  {seq:4,type:'tool/result',data:{turn:1,step:0,message:{content:[{type:'tool-result',toolCallId:'call',isError:true,content:[{type:'text',text:'UNTRUSTED ERROR TEXT'}]}]}}},
  {seq:5,type:'turn/end',data:{turn:1,reason:{kind:stopKind}}},
]}
function context(){return {projectId:'project',upstream,signal:new AbortController().signal,resumeExecutionAudit:{attempts:[{
  classId:'text',groupId:'peer_supply:1',status:'failed',error:'MODULE_NATIVE_max-tokens',executionId:'exec',childId:'child',sourceContextFingerprint:'same-input',
}]}} as any}
const execution:any={id:'exec',projectId:'project',parentId:'parent',classId:'text',status:'failed',childId:'child',selected:{provider:'p',model:'m'},actual:{provider:'p',model:'m'}}
describe('native schema upstream identity readback',()=>{
  it('names an unavailable original claim without supplying a substitute or rewriting the rejected draft',()=>{
    const original=events(),before=JSON.stringify(original)
    const feedback=nativeSchemaCorrectionFeedback(original,schema,'exec','child',undefined,upstream)
    const data=JSON.parse(feedback.split('\n').at(-1)!).rejectedNativeSchema
    expect(data.fieldDiagnostics[0]).toMatchObject({evidenceIndex:0,target,kind:'inference'})
    expect(data.fieldReadbackDiagnostics.fieldUpstreamReferenceConflicts).toEqual([expect.stringContaining('claimId is not present in the frozen upstream module')])
    expect(data.fieldReadbackDiagnostics.fieldUpstreamReferenceConflicts[0]).toContain('claim-does-not-exist')
    expect(data.originalSubmission).toEqual(raw);expect(data.originalSubmissionHash).toBe(sha256CanonicalJson(raw))
    expect(data.acceptanceGranted).toBe(false);expect(feedback).not.toContain('UNTRUSTED ERROR TEXT')
    expect(JSON.stringify(original)).toBe(before)
  })
  it('recovers only the receipt-bound rejected tool args when the same native turn actually hit its output limit',async()=>{
    const feedback=await nativeSchemaRecoveryFeedback(context(),{id:'parent'} as any,{execution:()=>execution},async()=>events(),'peer_supply:1',schema,'same-input')
    expect(feedback).toContain(sha256CanonicalJson(raw));expect(feedback).toContain('claimId is not present')
  })
  it('refuses a claimed output-limit recovery without the matching native terminal or source identity',async()=>{
    expect(await nativeSchemaRecoveryFeedback(context(),{id:'parent'} as any,{execution:()=>execution},async()=>events('completed'),'peer_supply:1',schema,'same-input')).toBe('')
    expect(await nativeSchemaRecoveryFeedback(context(),{id:'parent'} as any,{execution:()=>execution},async()=>events(),'peer_supply:1',schema,'changed-input')).toBe('')
  })
})
