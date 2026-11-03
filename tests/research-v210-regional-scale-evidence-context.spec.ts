import {it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import {getModuleAuthorGroupOutputSchemaPrompt,validateModuleAuthorGroup} from '../src/research-v2/module-author-groups.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const base={documents:[],limitations:['Synthetic evidence boundary only']}
const corpus={...base,fingerprint:createHash('sha256').update(JSON.stringify(base)).digest('hex')}
function missingGroup():any {
 return {projectionVersion:'module-author-field-group.v8',groupId:'regional_context:1',
  outputs:{regional_context:{type:'planning.regional_context.v1.2',quality:'limited',scope:'Synthetic study scope',asOf:'2026-10-07',limitations:['No spatial evidence'],
   records:[{recordId:'synthetic-study',resultClass:'analysis_judgment',...Object.fromEntries(['scale','projectPosition','entranceIds','boundaryGeometry'].map(field=>[field,{value:null,claimClass:'missing',limitations:['No supplied support']}]))}]}},
  evidence:[],limitations:['Synthetic only; no module qualification'],stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Checked assigned spatial fields only',fieldRefs:[],limitations:['No verified spatial evidence']}]))}
}
it('allows the native spatial group to report unavailable inputs without treating it as module completion',()=>{
 const draft=missingGroup(),before=hash(draft)
 expect(()=>validateModuleAuthorGroup('2.01',draft,[],corpus)).not.toThrow()
 expect(hash(draft)).toBe(before)
})
it('rejects a retained scale value when only its limitation says that the value is unavailable',()=>{
 const draft=missingGroup()
 draft.outputs.regional_context.records[0].scale={value:'Synthetic unsupported scale',claimClass:'agent_inference',limitations:['Scale is unverified and should not be retained']}
 expect(()=>validateModuleAuthorGroup('2.01',draft,[],corpus)).toThrow(/MODULE_PROJECTION_OUTPUT_INVALID:.*scale\.claimRefs/u)
})
it('rejects native scale evidence that uses the scale itself as its only input',()=>{
 const draft=missingGroup(),target={port:'regional_context',recordId:'synthetic-study',field:'scale',at:''}
 draft.outputs.regional_context.records[0].scale={value:'Synthetic unsupported scale',claimClass:'agent_inference',limitations:['Synthetic cycle only']}
 draft.evidence=[{target,kind:'inference',rationale:'Synthetic invalid basis',inputRefs:[{local:target}]}]
 expect(()=>validateModuleAuthorGroup('2.01',draft,[],corpus)).toThrow(/MODULE_CLAIM_CYCLE/u)
})
it('emits the evidence and missing-value scope for the spatial author without changing later group scopes',()=>{
 const prompt=getModuleAuthorGroupOutputSchemaPrompt('2.01','regional_context:1',[])
 const block=prompt.match(/^\{"regionalScaleEvidenceScope":.+\}$/mu)
 expect(block?JSON.parse(block[0]).regionalScaleEvidenceScope:undefined).toMatchObject({
  fields:['scale','projectPosition','entranceIds','boundaryGeometry'],
  nonNullEvidenceRequired:true,selfReferenceCannotProvideBasis:true,missingMustUpdateValueAndClaimClass:true,
  allMissingWithinGroupAllowed:true,completeModuleUsefulConclusionRequired:true,independentReviewRequired:true,
 })
 expect(getModuleAuthorGroupOutputSchemaPrompt('2.01','regional_context:2',[])).not.toContain('regionalScaleEvidenceScope')
})
