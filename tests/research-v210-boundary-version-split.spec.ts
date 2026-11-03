import {describe,expect,it} from 'vitest'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {moduleAuthorGroupSourceContext} from '../src/research-v2/module-group-source-context.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {materialCorpusFingerprint} from '../src/materials/research-evidence.ts'

const corpusBase={documents:[],limitations:['Synthetic missing survey']}
const corpus={...corpusBase,fingerprint:materialCorpusFingerprint(corpusBase)}
const oldPlan=groups.getModuleAuthorFieldGroups('1.02',groups.MODULE_AUTHOR_GROUP_VERSION)
function draft(group:any,version:any){
  return {projectionVersion:version,groupId:group.groupId,outputs:{boundaries:{
    type:getModuleFieldContracts('1.02').ports.boundaries.type,quality:'limited',scope:'Synthetic conditional study',
    asOf:'2026-10-08',limitations:['No survey or approval'],records:[{recordId:'study-A',resultClass:'observation_summary',
      ...Object.fromEntries(group.fields.map((field:string)=>[field,{value:null,claimClass:'missing',limitations:['No original support']}]))}]}},
    evidence:[],limitations:['No survey or approval'],stepResults:Object.fromEntries([1,2,3,4].map(n=>['step'+n,{
      status:'limited',summary:'Only synthetic conditional study; no approved boundary.',fieldRefs:[],limitations:['No original support']}]))} as any
}
const prefix=oldPlan.slice(0,2).map(group=>draft(group,groups.MODULE_AUTHOR_GROUP_VERSION))

describe('boundary working version has a separate native author task',()=>{
  it('preserves the exact old prefix and partitions every remaining complete field once',()=>{
    const plan=groups.getModuleAuthorExecutionFieldGroups('1.02',prefix)
    expect(plan.slice(0,2)).toEqual(oldPlan.slice(0,2))
    expect(plan.slice(2).map(g=>[g.groupId,g.fields])).toEqual([
      ['boundaries:3.1',['entranceIds','locationBasis','precision']],['boundaries:3.2',['version']]])
    expect(plan.flatMap(g=>g.fields)).toEqual(oldPlan.flatMap(g=>g.fields))
    expect(groups.isCurrentModuleAuthorPrefix('1.02',prefix)).toBe(true)
  })
  it('strictly merges original old authors with the new version evidence without rewriting either',async()=>{
    const before=hash(prefix),version=groups.getModuleAuthorExecutionGroupVersion('1.02',prefix)
    const plan=groups.getModuleAuthorExecutionFieldGroups('1.02',prefix)
    const location=draft(plan[2],version),metadata=draft(plan[3],version)
    metadata.outputs.boundaries.records[0].version={value:'Author-selected working version A',claimClass:'decision',limitations:['Not an official boundary edition']}
    const target={port:'boundaries',recordId:'study-A',field:'version',at:''}
    metadata.evidence=[{target,kind:'proposal',rationale:'Synthetic author selects working version A only for this conditional study record; no geometry, approval or effective date is asserted.'}]
    for(const step of Object.values(metadata.stepResults) as any[])step.fieldRefs=[target]
    const compiled=await groups.compileModuleAuthorGroups('1.02',[...prefix,location,metadata],corpus)
    expect((compiled.outputs.boundaries as any).records[0].version.claimRefs).toHaveLength(1)
    expect(compiled.claims).toHaveLength(1)
    expect(compiled.claims[0].kind).toBe('proposal')
    expect(hash(prefix)).toBe(before)
    for(const field of ['geometry','area','effectiveDate'])expect((compiled.outputs.boundaries as any).records[0][field].value).toBeNull()
  })
  it('still rejects a nonempty version with no author evidence',async()=>{
    const plan=groups.getModuleAuthorExecutionFieldGroups('1.02',prefix),version=groups.getModuleAuthorExecutionGroupVersion('1.02',prefix)
    const location=draft(plan[2],version),metadata=draft(plan[3],version)
    metadata.outputs.boundaries.records[0].version={value:'Unsupported version',claimClass:'decision',limitations:['Not official']}
    expect(()=>groups.validateModuleAuthorGroup('1.02',metadata,[...prefix,location],corpus)).toThrow('version.claimRefs')
  })
  it('retains a complete old author set on its original independent review path',()=>{
    const complete=oldPlan.map(group=>draft(group,groups.MODULE_AUTHOR_GROUP_VERSION)),before=hash(complete)
    expect(groups.getModuleAuthorExecutionGroupVersion('1.02',complete)).toBe(groups.MODULE_AUTHOR_GROUP_VERSION)
    expect(groups.getModuleAuthorExecutionFieldGroups('1.02',complete)).toEqual(oldPlan)
    expect(hash(complete)).toBe(before)
  })
  it('provides identity and restrictions but excludes business source bodies from the isolated working metadata task',()=>{
    const sources={corpus:{originalFingerprint:'original-corpus',documents:[{path:'original.txt',contentHash:'original-hash',byteLength:120000,
      paragraphs:[{paragraph:1,startOffset:0,endOffset:120000,text:'original-business-text '.repeat(6000)}]}],limitations:['Historical only']},
      inputRefs:[{moduleId:'preplan.research.01.01',resultHash:'original-result'}],sourceValues:[{quote:'original-private-source-quote'}],
      upstream:[{itemId:'1.01',moduleId:'preplan.research.01.01',claims:[{claimId:'original-claim',value:'original-business-value'}],outputs:{private:'original-business-draft'},limitations:['Task date unresolved']}]}
    const before=hash(sources),scoped:any=moduleAuthorGroupSourceContext('1.02',['version'],sources)
    expect(scoped.groupSourceScope).toMatchObject({fullSourceContextHash:before,upstreamClaimsAvailable:false,boundaryWorkingMetadataOnly:true})
    expect(JSON.stringify(scoped)).not.toContain('original-business-text')
    expect(JSON.stringify(scoped)).not.toContain('original-private-source-quote')
    expect(JSON.stringify(scoped)).not.toContain('original-business-value')
    expect(scoped.sourceValues).toEqual([])
    expect(scoped.upstream[0]).toMatchObject({itemId:'1.01',moduleId:'preplan.research.01.01',limitations:['Task date unresolved']})
    expect(scoped.corpus.documents[0]).toEqual({path:'original.txt',contentHash:'original-hash',byteLength:120000})
    expect(scoped.inputRefs).toEqual(sources.inputRefs)
    expect(hash(sources)).toBe(before)
    expect(moduleAuthorGroupSourceContext('1.02',['locationBasis','precision'],sources)).toBe(sources)
  })
})
