import {describe,expect,it} from 'vitest'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {moduleAuthorGroupSourceContext} from '../src/research-v2/module-group-source-context.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'

const corpusBase={documents:[],limitations:['Synthetic missing environmental survey']}
const corpus={...corpusBase,fingerprint:materialCorpusFingerprint(corpusBase)}
const oldPlan=groups.getModuleAuthorFieldGroups('1.05',groups.MODULE_AUTHOR_GROUP_VERSION)
function draft(group:any,version:any){
  return {projectionVersion:version,groupId:group.groupId,outputs:{environment:{
    type:getModuleFieldContracts('1.05').ports.environment.type,quality:'limited',scope:'Synthetic conditional environmental study',
    asOf:'2026-10-08',limitations:['No current survey or verified boundary'],records:[{recordId:'study-A',resultClass:'observation_summary',
      ...Object.fromEntries(group.fields.map((field:string)=>[field,{value:null,claimClass:'missing',limitations:['No original support']}]))}]}},
    evidence:[],limitations:['No current survey'],stepResults:Object.fromEntries([1,2,3,4].map(n=>['step'+n,{
      status:'limited',summary:'Synthetic group only; environmental investigation remains incomplete.',fieldRefs:[],limitations:['No original support']}]))} as any
}
const prefix=oldPlan.slice(0,3).map(group=>draft(group,groups.MODULE_AUTHOR_GROUP_VERSION))

describe('environmental verification tasks use a separate native author',()=>{
  it('keeps three original authors and assigns each remaining complete field once',()=>{
    const plan=groups.getModuleAuthorExecutionFieldGroups('1.05',prefix)
    expect(plan.slice(0,3)).toEqual(oldPlan.slice(0,3))
    expect(plan.slice(3).map(g=>[g.groupId,g.fields])).toEqual([
      ['environment:4.1',['sensitiveObjects','precision','activityImpact']],['environment:4.2',['verificationTasks']]])
    expect(plan.flatMap(g=>g.fields)).toEqual(oldPlan.flatMap(g=>g.fields))
    expect(groups.isCurrentModuleAuthorPrefix('1.05',prefix)).toBe(true)
  })
  it('compiles original authors with an actual native task proposal without changing their hashes',()=>{
    const before=hash(prefix),version=groups.getModuleAuthorExecutionGroupVersion('1.05',prefix)
    const plan=groups.getModuleAuthorExecutionFieldGroups('1.05',prefix),observations=draft(plan[3],version),tasks=draft(plan[4],version)
    tasks.outputs.environment.records[0].verificationTasks={value:['Obtain a current environmental survey before activity assessment.'],claimClass:'decision',limitations:['Proposed research task, not a completed survey']}
    const target={port:'environment',recordId:'study-A',field:'verificationTasks',at:'/0'}
    tasks.evidence=[{target,kind:'proposal',rationale:'The synthetic author chooses this research task because current observations are unavailable; no present environmental state or permission is asserted.'}]
    tasks.stepResults.step4.fieldRefs=[target]
    const compiled=groups.compileModuleAuthorGroups('1.05',[...prefix,observations,tasks],corpus)
    expect((compiled.outputs.environment as any).records[0].verificationTasks.claimRefs).toHaveLength(1)
    expect(compiled.claims[0].kind).toBe('proposal')
    expect(hash(prefix)).toBe(before)
    expect((compiled.outputs.environment as any).records[0].measuredValue.value).toBeNull()
  })
  it('rejects the observed nonempty task array when its native evidence is absent',()=>{
    const plan=groups.getModuleAuthorExecutionFieldGroups('1.05',prefix),version=groups.getModuleAuthorExecutionGroupVersion('1.05',prefix)
    const observations=draft(plan[3],version),tasks=draft(plan[4],version)
    tasks.outputs.environment.records[0].verificationTasks={value:['Unsubstantiated task'],claimClass:'decision',limitations:['Not completed']}
    expect(()=>groups.validateModuleAuthorGroup('1.05',tasks,[...prefix,observations],corpus)).toThrow('verificationTasks.claimRefs')
  })
  it('replays a complete old plan on its original review path',()=>{
    const complete=oldPlan.map(group=>draft(group,groups.MODULE_AUTHOR_GROUP_VERSION)),before=hash(complete)
    expect(groups.getModuleAuthorExecutionGroupVersion('1.05',complete)).toBe(groups.MODULE_AUTHOR_GROUP_VERSION)
    expect(groups.getModuleAuthorExecutionFieldGroups('1.05',complete)).toEqual(oldPlan)
    expect(groups.isCurrentModuleAuthorPrefix('1.05',complete)).toBe(true)
    expect(hash(complete)).toBe(before)
  })
  it('narrows task-only source context while preserving exact upstream claims and restrictions',()=>{
    const sources={corpus:{originalFingerprint:'frozen-corpus',documents:[{path:'original.txt',contentHash:'original-hash',byteLength:90000,
      paragraphs:[{paragraph:1,startOffset:0,endOffset:90000,text:'original source body '.repeat(4500)}]}],limitations:['Historical measurements only']},
      inputRefs:[{moduleId:'preplan.research.01.02',resultHash:'original-result'}],sourceValues:[{quote:'original private quote'}],
      upstream:[{itemId:'1.02',moduleId:'preplan.research.01.02',outputs:{boundaries:{type:'boundary',quality:'limited',scope:'Unverified research boundary',asOf:'2026-09-26',limitations:['No geometry'],records:[{recordId:'boundary-A',resultClass:'observation_summary',geometry:{value:null,claimClass:'missing',limitations:['No coordinates']}}]}},claims:[{claimId:'original-claim',value:'original value'}],limitations:['Boundary unanswered']}]}
    const before=hash(sources),scoped:any=moduleAuthorGroupSourceContext('1.05',['verificationTasks'],sources)
    expect(scoped.groupSourceScope).toMatchObject({fullSourceContextHash:before,upstreamClaimsAvailable:true,environmentVerificationTasksOnly:true})
    expect(scoped.corpus.documents[0]).toEqual({path:'original.txt',contentHash:'original-hash',byteLength:90000})
    expect(scoped.corpus.limitations).toEqual(sources.corpus.limitations)
    expect(scoped.upstream[0].claims).toEqual(sources.upstream[0].claims)
    expect(scoped.upstream[0].limitations).toEqual(sources.upstream[0].limitations)
    expect(scoped.inputRefs).toEqual(sources.inputRefs)
    expect(scoped.sourceValues).toEqual([])
    expect(JSON.stringify(scoped)).not.toContain('original source body')
    expect(JSON.stringify(scoped)).not.toContain('original private quote')
    expect(hash(sources)).toBe(before)
    expect(JSON.stringify(scoped).length).toBeLessThan(JSON.stringify(sources).length/10)
  })
})
