import {expect,it} from 'vitest'
import * as synthesis from '../src/research-v2/module-synthesis.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const candidate={outputs:{project_brief:{quality:'limited'}},claims:[{claimId:'historical-name',kind:'source',value:'Reservoir'},
  {claimId:'working-task',kind:'proposal',value:'Compare low impact options',rationale:'Working task only'}],sourceValues:[],limitations:['Present rights unknown'],
  steps:[1,2,3,4].map(step=>({step,status:'limited',summary:'Field work only',claimRefs:['working-task'],limitations:['Present rights unknown']}))} as any
const judgment={version:'module-research-synthesis.v1',candidateHash:hash(candidate),
  analysis:'Compare options against the recorded reservoir protections; current rights do not follow from the old name.',
  conclusion:'Advance comparison of low impact options with an explicit rights condition.',claimRefs:['historical-name','working-task'],
  steps:[1,2,3,4].map(step=>({step,status:'limited',summary:'Integrated study conclusion for this step',claimRefs:['working-task'],limitations:['Present rights unknown']})),
  handoff:[{moduleId:'1.02',use:'Use the stated working task for the research extent.',claimRefs:['working-task'],conditions:['Do not treat this as implementation authorization.']}],
  limitations:['Present rights unknown']} as any
const receipt={executionId:'synthesis-native',childId:'synthesis-child',actualModel:{provider:'native',model:'text'},stopReason:'completed'}

it('binds fixed native step keys without changing the original judgment, business values, restrictions or legacy replay',()=>{
  const {steps,...base}=judgment
  const fixed={...base,version:'module-research-synthesis.v4',limitationBasisHash:hash(candidate.limitations),
    stepResults:{step1:(({step,...value}:any)=>value)(steps[0]),step2:(({step,...value}:any)=>value)(steps[1]),
      step3:(({step,...value}:any)=>value)(steps[2]),step4:(({step,...value}:any)=>value)(steps[3])}}
  const before=hash(fixed),candidateBefore=hash(candidate),audit=synthesis.acceptModuleSynthesis(candidate,fixed as any,receipt)
  expect(hash(audit.judgment)).toBe(before);expect(hash(candidate)).toBe(candidateBefore)
  expect(()=>synthesis.verifyModuleSynthesis(candidate,audit)).not.toThrow()
  for(const changed of [
    {...fixed,steps},
    {...fixed,stepResults:{...fixed.stepResults,step4:undefined}},
    {...fixed,stepResults:{...fixed.stepResults,step5:fixed.stepResults.step4}},
    {...fixed,stepResults:{...fixed.stepResults,step1:{...fixed.stepResults.step1,step:'1'}}},
    {...fixed,stepResults:{...fixed.stepResults,step1:{...fixed.stepResults.step1,claimRefs:['invented']}}},
  ])expect(()=>synthesis.acceptModuleSynthesis(candidate,changed as any,receipt)).toThrow(/SYNTHESIS/)
  expect(()=>synthesis.acceptModuleSynthesis(candidate,judgment,receipt)).not.toThrow()
})

it('binds the actual integrated native judgment without replacing field group status or business values',()=>{
  const before=hash(candidate),audit=synthesis.acceptModuleSynthesis(candidate,judgment,receipt)
  synthesis.verifyModuleSynthesis(candidate,audit)
  expect(hash(candidate)).toBe(before)
  expect(audit.judgment.handoff[0].conditions).toHaveLength(1)
  expect(()=>synthesis.acceptModuleSynthesis(candidate,{...judgment,candidateHash:'foreign'},receipt)).toThrow(/SYNTHESIS_BINDING/)
  expect(()=>synthesis.acceptModuleSynthesis(candidate,{...judgment,claimRefs:['invented']},receipt)).toThrow(/SYNTHESIS_CLAIMS/)
  expect(()=>synthesis.verifyModuleSynthesis(candidate,{...audit,judgment:{...judgment,conclusion:'Altered'}})).toThrow(/SYNTHESIS_BINDING/)
})

it('accepts the catalog module identity used by actual native handoffs without rewriting it',()=>{
  const canonical={...judgment,handoff:[{...judgment.handoff[0],moduleId:'preplan.research.01.02'}]}
  const audit=synthesis.acceptModuleSynthesis(candidate,canonical,receipt)
  expect(audit.judgment.handoff[0].moduleId).toBe('preplan.research.01.02')
  expect(()=>synthesis.acceptModuleSynthesis(candidate,{...canonical,handoff:[{...canonical.handoff[0],moduleId:'preplan.research.99.99'}]},receipt)).toThrow()
})

it('binds the full immutable limitation ledger while accepting an integrated summary, preserving strict legacy replay',()=>{
  const before=hash(candidate),summary={...judgment,version:'module-research-synthesis.v2',limitationBasisHash:hash(candidate.limitations),
    limitations:['Rights and implementation remain unverified; only conditional comparison is supported.']}
  const audit=synthesis.acceptModuleSynthesis(candidate,summary as any,receipt)
  expect(hash(candidate)).toBe(before)
  expect(audit.judgment.limitations).toEqual(summary.limitations)
  expect(()=>synthesis.verifyModuleSynthesis(candidate,audit)).not.toThrow()
  expect(()=>synthesis.acceptModuleSynthesis(candidate,{...summary,limitationBasisHash:'foreign'} as any,receipt)).toThrow(/SYNTHESIS_LIMITATIONS/)
  expect(()=>synthesis.acceptModuleSynthesis(candidate,{...summary,limitations:[]} as any,receipt)).toThrow(/SYNTHESIS_LIMITATIONS/)
  expect(()=>synthesis.acceptModuleSynthesis(candidate,{...judgment,limitations:summary.limitations},receipt)).toThrow(/SYNTHESIS_LIMITATIONS/)
})

it('allows an explicitly unperformed limited step to have no supporting claims without inventing a citation or marking it completed',()=>{
  const limitedStep={...judgment.steps[2],summary:'No verified geometry; GIS overlay was not performed.',claimRefs:[],limitations:['Geometry and legal control layers remain unavailable.']}
  const honest={...judgment,version:'module-research-synthesis.v3',limitationBasisHash:hash(candidate.limitations),
    steps:judgment.steps.map((step:any,index:number)=>index===2?limitedStep:step)}
  const audit=synthesis.acceptModuleSynthesis(candidate,honest,receipt)
  synthesis.verifyModuleSynthesis(candidate,audit)
  expect(synthesis.moduleSynthesisSteps(audit.judgment)[2]).toMatchObject({status:'limited',claimRefs:[]})
  expect(()=>synthesis.acceptModuleSynthesis(candidate,{...honest,version:'module-research-synthesis.v2'},receipt)).toThrow(/SYNTHESIS_CLAIMS/)
  expect(()=>synthesis.acceptModuleSynthesis(candidate,{...honest,steps:honest.steps.map((s:any,i:number)=>i===2?{...s,status:'completed'}:s)},receipt)).toThrow(/SYNTHESIS_CLAIMS/)
  expect(()=>synthesis.acceptModuleSynthesis(candidate,{...honest,steps:honest.steps.map((s:any,i:number)=>i===2?{...s,limitations:[]}:s)},receipt)).toThrow(/SYNTHESIS_STEPS/)
  expect(()=>synthesis.acceptModuleSynthesis(candidate,{...honest,claimRefs:[]},receipt)).toThrow(/SYNTHESIS_CLAIMS/)
})
