import {describe,it,expect} from 'vitest'
import {completeModuleReferencePromptView,moduleReferencePromptView,expandModuleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {assertNativeModuleContext} from '../src/research-v2/native-module-context-budget.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const limits={contextWindow:872000,outputTokenLimit:128000}
function fixture(){
  const rows=Array.from({length:150},(_,index)=>({claimId:'claim-'+index,quote:`原件第${index}条：`+'自然湖景与生态体验采用分区组织。'.repeat(60),
    value:index%3?0:null,limitations:['待人工确认实施条件；保留理想方案研究用途。']}))
  const sources={corpus:{documents:[{path:'原始资料/资料.pdf',contentHash:'a'.repeat(64),pages:[{page:1,text:'原文'}]}]},
    upstream:[{itemId:'2.06',claims:rows}],sourceValues:[],inputRefs:[{moduleId:'2.06',bundleRunId:'RUN-original',valueHash:hash(rows)}]}
  const context={spec:{itemId:'3.07',qa:['对下游任务形成具体交接']},sources:moduleReferencePromptView(sources),taskContext:{taskBrief:'正文写理想方案，人工确认放备注。'}}
  const candidate={outputs:{market_gaps:{records:rows}},claims:[],limitations:['不能将假设升级为已核事实。']}
  const extra={researchSynthesis:{candidateHash:hash(candidate),candidate,upstream:[{itemId:'2.06',judgment:{conclusion:'方案比较'},limitations:['待人工确认实施条件；保留理想方案研究用途。']}]}}
  return {sources,context,candidate,extra}
}
describe('complete module reference sharing across native stages',()=>{
  it('fits a complete source/candidate handoff that fails when the same strings are packed separately',()=>{
    const {context,extra}=fixture()
    const separate=JSON.stringify(context)+'\n'+JSON.stringify({researchSynthesis:moduleReferencePromptView(extra.researchSynthesis)})
    expect(()=>assertNativeModuleContext(limits,separate,'{}',[])).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
    const shared=completeModuleReferencePromptView(context,extra)
    expect(()=>assertNativeModuleContext(limits,JSON.stringify(shared),'{}',[])).not.toThrow()
    expect(Buffer.byteLength(JSON.stringify(shared),'utf8')).toBeLessThan(Buffer.byteLength(separate,'utf8')*0.7)
  })
  it('retains all original sources, upstream identities, candidate values, hashes and restrictions exactly',()=>{
    const {sources,context,extra,candidate}=fixture(),before=structuredClone({context,extra})
    const decoded:any=expandModuleReferencePromptView(completeModuleReferencePromptView(context,extra))
    expect(decoded).toEqual({...context,sources,...extra})
    expect(hash(decoded.researchSynthesis.candidate)).toBe(hash(candidate))
    expect({context,extra}).toEqual(before)
  })
  it('shares the complete independent review and preserves supplementary audits and zero/missing values',()=>{
    const {sources,context,candidate}=fixture()
    const extra={candidateHash:hash(candidate),candidate,reviewCriteria:['原文与限制完整'],authorGroupStates:[{groupId:'a:1',status:'limited'}],
      synthesis:{conclusion:'拟议方案'},boundaryAudit:{geometry:null},projectTaskAudit:{count:0},peerProductArtifacts:{status:'produced_limited'}}
    expect(expandModuleReferencePromptView(completeModuleReferencePromptView(context,extra))).toEqual({...context,sources,...extra})
  })
  it('rejects conflicting context keys and tampered source views without overwriting or repairing either input',()=>{
    const {context}=fixture()
    expect(()=>completeModuleReferencePromptView(context,{spec:{itemId:'4.01'}})).toThrow('MODULE_REFERENCE_CONTEXT_CONFLICT')
    const broken:any=structuredClone(context)
    broken.sources=moduleReferencePromptView({limitations:Array.from({length:30},()=> '原文和限制必须完整保留，不改变用途或来源。'.repeat(20))})
    expect(broken.sources.encoding).toBe('research-reference.v1');broken.sources.originalHash='0'.repeat(64)
    expect(()=>completeModuleReferencePromptView(broken,{})).toThrow('MODULE_REFERENCE_CONTEXT_INVALID')
  })
})
