import {it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import {getModuleAuthorExecutionFieldGroups,getModuleAuthorGroupOutputSchemaPrompt,validateModuleAuthorGroup} from '../src/research-v2/module-author-groups.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const base={documents:[],limitations:['Synthetic evidence boundary only']}
const corpus={...base,fingerprint:createHash('sha256').update(JSON.stringify(base)).digest('hex')}
const missing=()=>({value:null,claimClass:'missing',limitations:['No supplied support']})
function group(groupId='market_context:4.1',fields:Record<string,unknown>={projectImpactHypothesis:missing()}):any {
 return {projectionVersion:'module-author-field-group.v13',groupId,
  outputs:{market_context:{type:'planning.market_context.v1.2',quality:'limited',scope:'Synthetic study scope',asOf:'2026-10-07',limitations:['No project demand evidence'],
   records:[{recordId:'synthetic-context',resultClass:'observation_summary',...fields}]}},evidence:[],limitations:['Synthetic only; no module qualification'],
  stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Checked assigned field only',fieldRefs:[],limitations:['No verified project impact']}]))}
}
function priorGroups():any[] {
 const prior:any[]=[]
 for(let index=0;index<32;index++){
  const next=getModuleAuthorExecutionFieldGroups('3.01',prior)[prior.length]
  if(next.groupId==='market_context:4.1')return prior
  const draft=group(next.groupId,Object.fromEntries(next.fields.map(field=>[field,missing()])))
  validateModuleAuthorGroup('3.01',draft,prior,corpus)
  prior.push(draft)
 }
 throw new Error('Synthetic prefix did not reach impact group')
}
it('allows truthful missing impact fields without claiming module completion',()=>{
 const draft=group(),prior=priorGroups(),before=hash(draft)
 expect(()=>validateModuleAuthorGroup('3.01',draft,prior,corpus)).not.toThrow()
 expect(hash(draft)).toBe(before)
})
it('rejects a retained impact hypothesis after its evidence was removed',()=>{
 const draft=group();draft.outputs.market_context.records[0].projectImpactHypothesis={value:'Synthetic unsupported impact',claimClass:'agent_inference',limitations:['No actual demand evidence']}
 expect(()=>validateModuleAuthorGroup('3.01',draft,priorGroups(),corpus)).toThrow(/MODULE_PROJECTION_OUTPUT_INVALID:.*projectImpactHypothesis\.claimRefs/u)
})
it('rejects missing prior denominators as inference inputs without upgrading or changing them',()=>{
 const prior=priorGroups(),draft=group(),target={port:'market_context',recordId:'synthetic-context',field:'projectImpactHypothesis',at:''}
 draft.outputs.market_context.records[0].projectImpactHypothesis={value:'Synthetic conditional impact',claimClass:'agent_inference',limitations:['Unverified denominator']}
 draft.evidence=[{target,kind:'inference',rationale:'Synthetic invalid missing-input basis',inputRefs:[{local:{...target,field:'denominator'}}]}]
 const before=hash({prior,draft})
 expect(()=>validateModuleAuthorGroup('3.01',draft,prior,corpus)).toThrow(/referenced field is missing/u)
 expect(hash({prior,draft})).toBe(before)
})
it('explains impact inference and missing-input responsibilities only to the assigned native group',()=>{
 const prompt=getModuleAuthorGroupOutputSchemaPrompt('3.01','market_context:4.1',[]),block=prompt.match(/^\{"projectImpactEvidenceScope":.*\}$/mu)
 expect(block).toBeTruthy()
 expect(JSON.parse(block![0]).projectImpactEvidenceScope).toMatchObject({field:'projectImpactHypothesis',nonMissingEvidenceBasisRequired:true,
  missingInputsAreLimitationsNotEvidence:true,missingCannotBeInputRef:true,nonNullCannotDropEvidence:true,missingMustUpdateValueAndClaimClass:true,
  preserveFrozenPriorGroups:true,sourceScaleDoesNotProveProjectDemand:true,completeModuleStillRequiresEvidenceAndIndependentReview:true,noReplacementBusinessValues:true})
 expect(getModuleAuthorGroupOutputSchemaPrompt('3.01','market_context:4.2.1',[])).not.toContain('projectImpactEvidenceScope')
})
