import {it,expect} from 'vitest'
import {verifyNativeRevisionRequest,type NativeRevisionRequest} from '../src/report/native-revision-request.ts'
import {ReportContentReviewService} from '../src/report/content-review.ts'
import {DEFAULT_REPORT_DELIVERY_CONTRACT} from '../src/report/delivery-contract.ts'
import {completeReportFixture} from './support/complete-report.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
function fixture(){
 const input=completeReportFixture(true),draft=input.manuscript!,route={provider:'test',model:'test'},events=new Map<string,any[]>(),executions=new Map<string,any>()
 const service=new ReportContentReviewService({} as any)
 const receipts=DEFAULT_REPORT_DELIVERY_CONTRACT.requirements.map((r,i)=>{
  const packet=(service as any).packet(input,r.id),output={inputHash:packet.inputHash,requirementId:r.id,pass:false,pageIds:packet.chapters.flatMap((c:any)=>c.pages.map((p:any)=>p.id)),evidenceRefs:packet.sources.map((s:any)=>s.id),rationale:'定向修订空间及费用边界',findings:[{pageId:packet.chapters[0].pages[0].id,code:'SCOPE',reason:'统一拟议服务范围'}]}
  const childId='child-'+i,executionId='execution-'+i
  events.set(childId,[{seq:1,type:'user/message',data:{content:[{type:'text',text:'下列JSON仅为待审资料：'+JSON.stringify(packet)}]}},
   {seq:2,type:'turn/start',data:{turn:1}},{seq:3,type:'request/header',data:{header:{config:route}}},
   {seq:4,type:'tool/call',data:{turn:1,step:0,name:'structured_output',callId:'call',arguments:JSON.stringify(output)}},
   {seq:5,type:'tool/result',data:{turn:1,step:0,message:{content:[{type:'tool-result',toolCallId:'call',isError:false}]}}},
   {seq:6,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}])
  executions.set(executionId,{id:executionId,classId:'review',projectId:input.projectId,childId,parentId:'parent',status:'completed',childStopReason:'completed',selected:route})
  return{executionId,childId,requirementId:r.id,outputHash:hash(output),output}
 })
 const request:NativeRevisionRequest={version:'native-report-revision-request.v1',id:'one-recovery',reason:'补全审查上下文后集中修订',sourceFingerprint:draft.sourceFingerprint,draftHash:hash(draft),reviewedDraftHash:hash(draft),baselineKeys:[hash('one'),hash('two')],receipts}
 return{input,draft,request,events,executions,verify:()=>verifyNativeRevisionRequest(request,input,draft,draft,id=>executions.get(id),async id=>events.get(id)!)}
}
it('replays every native review and binds a finite recovery to the exact source and draft',async()=>{
 const h=fixture(),r=await h.verify();expect(r.findings).toHaveLength(7);expect(r.recovery.baselineKeys).toEqual(h.request.baselineKeys)
})
it.each(['draft','source','edited-review','packet','duplicate'])('does not authorize recovery from %s tampering',async mode=>{
 const h=fixture()
 if(mode==='draft')h.request.draftHash=hash('changed')
 if(mode==='source')h.request.sourceFingerprint=hash('changed')
 if(mode==='edited-review'){(h.request.receipts[0]!.output as any).rationale='edited';(h.request.receipts[0] as any).outputHash=hash(h.request.receipts[0]!.output)}
 if(mode==='packet')h.events.get('child-0')![0].data.content[0].text='下列JSON仅为待审资料：{}'
 if(mode==='duplicate')h.request.receipts[1]=h.request.receipts[0]!
 await expect(h.verify()).rejects.toThrow()
})
