import {expect,it} from 'vitest'
import {moduleRecoveryFeedback} from '../src/research-v2/module-recovery-feedback.ts'
import {validateModuleClaims} from '../src/research-v2/module-claims.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const target=(field:string,recordId='RN-SYNTHETIC',at='')=>({port:'regional_nodes',recordId,field,at})
function draft(groupId:string,entries:any[]){
 const records:any[]=[]
 for(const entry of entries){
  let record=records.find(row=>row.recordId===entry.target.recordId)
  if(!record){record={recordId:entry.target.recordId};records.push(record)}
  record[entry.target.field]={value:entry.target.at?['Synthetic leaf']: 'Synthetic '+entry.target.field,
   claimClass:'agent_inference',limitations:['Synthetic fixture only']}
 }
 return {groupId,outputs:{regional_nodes:{records}},evidence:entries,limitations:['Synthetic fixture only']}
}
const edge=(field:string,dependency:string)=>({target:target(field),kind:'inference',rationale:'Synthetic rationale must not be copied into diagnostics',inputRefs:[{local:target(dependency)}]})
function recovery(raws:any[],groupId=raws[0].groupId,error='MODULE_CLAIM_CYCLE: synthetic-cycle'){
 const audit={attempts:raws.map((raw,index)=>({classId:'text',status:'completed',groupId:raw.groupId,structuredOutput:raw,
  executionId:'synthetic-execution-'+index,childId:'synthetic-child-'+index,structuredHash:hash(raw)})),reviewReceipts:[]}
 const before=hash(audit),feedback=moduleRecoveryFeedback({module:{id:'2.02'},resumeExecutionAudit:audit,resumeExecutionError:error} as any,groupId)
 expect(hash(audit)).toBe(before)
 return {feedback,rejection:JSON.parse(feedback.split('\n').at(-1)!).previousRejection}
}
it('identifies the same-group node type and selection reason cycle with exact immutable author addresses and hashes',()=>{
 const raw=draft('regional_nodes:1',[edge('nodeType','selectionReason'),edge('selectionReason','nodeType')])
 const {feedback,rejection}=recovery([raw]),diagnostic=rejection.claimCycleDiagnostic
 expect(diagnostic).toBeDefined()
 expect(diagnostic).toMatchObject({version:'module-claim-cycle-readback.v1',scope:'local-claim-cycle-addresses-only',completeSubmission:false})
 expect(diagnostic.fieldClaimCycles).toHaveLength(1)
 expect(diagnostic.fieldClaimCycles[0].edges).toEqual(raw.evidence.map((entry,index)=>expect.objectContaining({
  groupId:raw.groupId,originalSubmissionHash:hash(raw),evidenceIndex:index,evidenceHash:hash(entry),
  target:entry.target,valueHash:hash(raw.outputs.regional_nodes.records[0][entry.target.field].value),
  refPath:'inputRefs/0',referencedTarget:entry.inputRefs[0].local})))
 expect(feedback).toContain('循环引用字段对照协议 module-claim-cycle-readback.v1')
 expect(feedback).toContain('不得机械删引用')
 expect(JSON.stringify(diagnostic)).not.toContain('Synthetic rationale')
 expect(JSON.stringify(diagnostic)).not.toContain('Synthetic nodeType')
})
it('reports a closed cross-group cycle only to its owning groups and retains the original future reference',()=>{
 const first=draft('regional_nodes:1',[edge('nodeType','selectionReason')]),last=draft('regional_nodes:3',[edge('selectionReason','nodeType')])
 const {rejection}=recovery([first,last],last.groupId)
 expect(rejection.claimCycleDiagnostic).toBeDefined()
 expect(rejection.claimCycleDiagnostic.fieldClaimCycles[0].edges.map((row:any)=>row.originalSubmissionHash)).toEqual([hash(first),hash(last)])
 expect(recovery([first],first.groupId).rejection.claimCycleDiagnostic).toBeUndefined()
 expect(recovery([first,last],'regional_nodes:2').rejection.claimCycleDiagnostic).toBeUndefined()
})
it('distinguishes an exact leaf self-reference from a different address at the same field',()=>{
 const address=target('selectionReason','RN-SYNTHETIC','/0')
 const raw=draft('regional_nodes:1',[{target:address,kind:'inference',inputRefs:[{local:address}]}])
 const {rejection}=recovery([raw])
 expect(rejection.claimCycleDiagnostic).toBeDefined()
 expect(rejection.claimCycleDiagnostic.fieldClaimCycles[0].edges).toHaveLength(1)
 expect(rejection.claimCycleDiagnostic.fieldClaimCycles[0].edges[0].target.at).toBe('/0')
 raw.evidence[0].inputRefs[0].local=target('selectionReason')
 expect(recovery([raw]).rejection.claimCycleDiagnostic).toBeUndefined()
})
it('locates calculation operand and weight cycles without inventing or changing numeric inputs',()=>{
 const raw=draft('regional_nodes:1',[{target:target('nodeType'),kind:'calculation',calculation:{operation:'weighted_mean',
  operands:[{sourceId:'synthetic-existing-source'}],weights:[{local:target('selectionReason')}]}},edge('selectionReason','nodeType')])
 const {rejection}=recovery([raw])
 expect(rejection.claimCycleDiagnostic).toBeDefined()
 expect(rejection.claimCycleDiagnostic.fieldClaimCycles[0].edges.map((row:any)=>row.refPath)).toEqual(['calculation/weights/0','inputRefs/0'])
})
it('bounds the diagnostic while retaining original hashes and explicitly marking omitted cycle edges',()=>{
 const raw=draft('regional_nodes:1',Array.from({length:20},(_,i)=>edge('field'+i,'field'+((i+1)%20))))
 const {rejection}=recovery([raw])
 expect(rejection.claimCycleDiagnostic).toBeDefined()
 const cycle=rejection.claimCycleDiagnostic.fieldClaimCycles[0]
 expect(cycle.edges).toHaveLength(16)
 expect(cycle.omittedEdges).toBe(4)
 expect(cycle.completeCycle).toBe(false)
 expect(cycle.edges.every((row:any)=>row.originalSubmissionHash===hash(raw))).toBe(true)
})
it('does not treat historical cycles as current diagnostics after another central failure',()=>{
 const raw=draft('regional_nodes:1',[edge('nodeType','selectionReason'),edge('selectionReason','nodeType')])
 expect(recovery([raw],raw.groupId,'MODULE_PROJECTION_REFERENCE: synthetic-other-error').rejection.claimCycleDiagnostic).toBeUndefined()
})
it('changes the readback binding when the original author draft changes without mutating either draft',()=>{
 const raw=draft('regional_nodes:1',[edge('nodeType','selectionReason'),edge('selectionReason','nodeType')]),other=structuredClone(raw)
 other.outputs.regional_nodes.records[0].nodeType.value='Different synthetic author value'
 const first=recovery([raw]).rejection.claimCycleDiagnostic,second=recovery([other]).rejection.claimCycleDiagnostic
 expect(first).toBeDefined();expect(second).toBeDefined()
 expect(first.fieldClaimCycles[0].edges[0].originalSubmissionHash).not.toBe(second.fieldClaimCycles[0].edges[0].originalSubmissionHash)
 expect(first.fieldClaimCycles[0].edges[0].valueHash).not.toBe(second.fieldClaimCycles[0].edges[0].valueHash)
})
it('keeps the complete central claim validator rejecting the original cycle',()=>{
 const outputs={regional_nodes:{quality:'limited',claimRefs:['first','second'],records:[{recordId:'RN-SYNTHETIC',
  nodeType:{value:'Synthetic type',claimClass:'agent_inference',claimRefs:['first']},
  selectionReason:{value:'Synthetic reason',claimClass:'agent_inference',claimRefs:['second']}}]}}
 const claims=[{claimId:'first',selector:'/outputs/regional_nodes/records/0/nodeType/value',value:'Synthetic type',kind:'inference',
  rationale:'Synthetic only',inputRefs:[{moduleId:'synthetic-module',claimId:'second'}]},
 {claimId:'second',selector:'/outputs/regional_nodes/records/0/selectionReason/value',value:'Synthetic reason',kind:'inference',
  rationale:'Synthetic only',inputRefs:[{moduleId:'synthetic-module',claimId:'first'}]}]
 expect(()=>validateModuleClaims({outputs,claims:claims as any,moduleId:'synthetic-module',sourceValues:[],upstream:[]})).toThrow('MODULE_CLAIM_CYCLE')
})
