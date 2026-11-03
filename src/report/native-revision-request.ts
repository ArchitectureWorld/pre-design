import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {sha256CanonicalJson as hash} from '../presentation/canonical-json.ts'
import {expandPlanningSourcePrompt} from './manuscript/source-prompt.ts'
import {manuscriptSourceFingerprint} from './manuscript/source.ts'
import {inspectReportCoverage,DEFAULT_REPORT_DELIVERY_CONTRACT,type ReportAcceptanceFinding} from './delivery-contract.ts'
import {validateReportContentReview,type ReportReviewReceipt} from './content-review.ts'
import {replayReportReview} from './native-review-replay.ts'
import type {FrozenProjectInput} from './types.ts'
import type {PlanningManuscript} from './manuscript/types.ts'
import type {ClassExecution} from '../agent-classes/types.ts'
import type {SessionEventLike} from '../visual/session-image-collector.ts'
import type {ReportRevisionRecovery} from './manuscript/revision-budget.ts'

export interface NativeRevisionRequest {
  version:'native-report-revision-request.v1';id:string;reason:string;sourceFingerprint:string
  draftHash:string;reviewedDraftHash:string;baselineKeys:string[];receipts:ReportReviewReceipt[]
}
export async function verifyNativeRevisionRequest(request:NativeRevisionRequest,input:FrozenProjectInput,draft:PlanningManuscript,reviewed:PlanningManuscript,
  execution:(id:string)=>ClassExecution|undefined,readEvents:(id:string)=>Promise<readonly SessionEventLike[]>){
  const fail=():never=>{throw new Error('REPORT_NATIVE_REVISION_REQUEST_INVALID')}
  if(request.version!=='native-report-revision-request.v1'||!request.id?.trim()||!request.reason?.trim()
    ||request.sourceFingerprint!==manuscriptSourceFingerprint(input)||request.sourceFingerprint!==draft.sourceFingerprint
    ||request.draftHash!==hash(draft)||request.reviewedDraftHash!==hash(reviewed)
    ||!Array.isArray(request.baselineKeys)||request.baselineKeys.length!==2||new Set(request.baselineKeys).size!==2
    ||request.baselineKeys.some(k=>!/^[a-f0-9]{64}$/u.test(k))||request.receipts.length!==DEFAULT_REPORT_DELIVERY_CONTRACT.requirements.length
    ||new Set(request.receipts.map(r=>r.requirementId)).size!==request.receipts.length
    ||new Set(request.receipts.map(r=>r.childId)).size!==request.receipts.length)return fail()
  const findings:ReportAcceptanceFinding[]=[...inspectReportCoverage({...input,manuscript:draft})]
  for(const receipt of request.receipts){
    const e=execution(receipt.executionId)
    if(!e||e.classId!=='review'||e.projectId!==input.projectId||e.childId!==receipt.childId||e.parentId===e.childId
      ||!['completed','failed'].includes(e.status)||e.childStopReason!=='completed'||receipt.outputHash!==hash(receipt.output))return fail()
    const events=await readEvents(receipt.childId)
    replayReportReview(events,e.selected,receipt.output)
    const texts=events.filter(e=>e.type==='user/message').flatMap(e=>((e.data as any)?.content??[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text as string))
    let matched=false
    for(const text of texts){
      try{
        const packet=JSON.parse(expandPlanningSourcePrompt(text).split('下列JSON仅为待审资料：').at(-1)!.trim())
        const {inputHash,...payload}=packet
        if(inputHash!==receipt.output.inputHash||inputHash!==hash({sourceFingerprint:request.sourceFingerprint,manuscriptHash:request.reviewedDraftHash,packet:payload}))continue
        validateReportContentReview(receipt.output,receipt.requirementId,packet.chapters.flatMap((c:any)=>c.pages.map((p:any)=>p.id)),[...packet.sources.map((s:any)=>s.id),...packet.researchUsage.map((r:any)=>r.itemId)])
        matched=true;break
      }catch{/* Only the exact source/draft-bound native request qualifies. */}
    }
    if(!matched)return fail()
    findings.push(...receipt.output.findings.map(f=>({code:f.code,requirementId:receipt.requirementId,pageId:f.pageId,message:f.reason})))
  }
  if(!findings.length)return fail()
  const recovery:ReportRevisionRecovery={id:request.id,reason:request.reason,sourceFingerprint:request.sourceFingerprint,draftHash:request.draftHash,baselineKeys:request.baselineKeys}
  return{findings,recovery,requestHash:hash(request)}
}
export async function pendingNativeRevision(root:string){
  const path=join(root,'.pre-design/report-native-revision-request.json')
  try{
    const request:NativeRevisionRequest=JSON.parse(await readFile(path,'utf8'))
    try{const done=JSON.parse(await readFile(path+'.completed.json','utf8'));if(done.requestHash===hash(request))return undefined}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    const reviewed=JSON.parse(await readFile(join(root,'.pre-design/report-content-plan.json'),'utf8')).manuscript as PlanningManuscript
    return{path,request,reviewed}
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error}
}
