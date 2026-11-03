import {describe,expect,it} from 'vitest'
import {nativeSchemaRecoveryFeedback} from '../src/research-v2/native-schema-recovery.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const schema={type:'object' as const,additionalProperties:false,required:['resultClass'],properties:{resultClass:{type:'string' as const,enum:['source_conclusion','proposal']}}}
const route={provider:'primary',model:'model'},raw={}
function fixture(){
 const old={classId:'text',groupId:'planning_conditions:2.2',status:'failed',error:'MODULE_NATIVE_error',executionId:'rejected-exec',childId:'rejected-child',sourceContextFingerprint:'source-hash',submissionState:'not-submitted'}
 const newest={...old,executionId:'transport-exec',childId:'transport-child'}
 const context:any={projectId:'project',signal:new AbortController().signal,resumeExecutionAudit:{attempts:[old,newest]}}
 const executions:any={}
 for(const a of [old,newest])executions[a.executionId]={id:a.executionId,projectId:'project',parentId:'parent',classId:'text',status:'failed',childId:a.childId,selected:route,actual:route}
 const rejected:any[]=[
  {seq:1,type:'turn/start',data:{turn:2}},
  {seq:2,type:'request/header',data:{header:{config:route,tools:[{name:'structured_output',parameters:schema}]}}},
  {seq:3,type:'tool/call',data:{turn:2,step:0,name:'structured_output',callId:'old-call',arguments:JSON.stringify(raw)}},
  {seq:4,type:'tool/result',data:{turn:2,step:0,message:{content:[{type:'tool-result',toolCallId:'old-call',isError:true,content:[]}]}}},
  {seq:5,type:'turn/end',data:{turn:2,reason:{kind:'error',error:{code:'INVALID_ARGS',message:'schema rejected'}}}},
 ]
 const transport:any[]=[
  {seq:1,type:'turn/start',data:{turn:3}},
  {seq:2,type:'request/header',data:{header:{config:route,tools:[{name:'structured_output',parameters:schema}]}}},
  {seq:3,type:'turn/end',data:{turn:3,reason:{kind:'error',error:{code:'PI_AI_ERROR',message:'WebSocket closed 1000'}}}},
 ]
 return {context,executions,rejected,transport,newest,old}
}
async function feedback(f:ReturnType<typeof fixture>){
 return nativeSchemaRecoveryFeedback(f.context,{id:'parent'} as any,{execution:id=>f.executions[id]},async id=>id==='transport-child'?f.transport:f.rejected,'planning_conditions:2.2',schema,'source-hash')
}
describe('unsubmitted transport failure preserves the actionable native schema rejection',()=>{
 it('delivers the prior original tool rejection after a verified socket close without editing receipts',async()=>{
  const f=fixture(),before=JSON.stringify(f),result=await feedback(f)
  expect(result).toContain('"authorExecutionId":"rejected-exec"')
  expect(result).toContain('"authorChildId":"rejected-child"')
  expect(result).toContain('"originalSubmissionHash":"'+hash(raw)+'"')
  expect(result).toContain('resultClass')
  expect(result).not.toContain('"authorExecutionId":"transport-exec"')
  expect(JSON.stringify(f)).toBe(before)
 })
 it.each(['cancelled','generic-error','pending','missing-header','wrong-request-route','wrong-child','wrong-source','business-rejection','unbound-tool-call','wrong-turn','bad-sequence'])(
  'does not skip the newest attempt when its transport proof is %s',async damage=>{
   const f=fixture()
   if(damage==='cancelled')f.transport[2].data.reason={kind:'error',error:{code:'CANCELLED',message:'WebSocket closed 1000'}}
   if(damage==='generic-error')f.transport[2].data.reason.error.message='Unknown validation error'
   if(damage==='pending')f.transport.pop()
   if(damage==='missing-header')f.transport.splice(1,1)
   if(damage==='wrong-request-route')f.transport[1].data.header.config={provider:'other',model:'model'}
   if(damage==='wrong-child')f.executions['transport-exec'].childId='other'
   if(damage==='wrong-source')f.old.sourceContextFingerprint='other-source'
   if(damage==='business-rejection')Object.assign(f.newest,{error:'MODULE_SOURCE_VALUE_TEXT: unsupported original value',structuredOutput:{},structuredHash:hash({})})
   if(damage==='unbound-tool-call'){f.transport[2].seq=4;f.transport.splice(2,0,{seq:3,type:'tool/call',data:{turn:3,step:0,name:'structured_output',callId:'new-call',arguments:'{}'}})}
   if(damage==='wrong-turn')f.transport[2].data.turn=4
   if(damage==='bad-sequence')f.transport[2].seq=1
   expect(await feedback(f)).toBe('')
  })
})
