import {it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const version='module-author-field-group.v21'
const historical='module-author-field-group.v17'
const text='The original record describes a historical pavilion.'
const base={documents:[{path:'original.txt',text,contentHash:createHash('sha256').update(text).digest('hex'),byteLength:Buffer.byteLength(text)}],limitations:['Synthetic research source only']}
const corpus={...base,fingerprint:createHash('sha256').update(JSON.stringify(base)).digest('hex')}
const fieldNames=['resourceId','category','location','historicalSource','authenticity','currentState','custodian','protectionLevel','rights','experienceContent','requiredConditions','prohibitedUses','seasonality','carryingLimits']
const target=(field:string)=>({port:'local_resources',recordId:'study-1',field,at:''})
function draft(group:any,wire:string=version):any {
  return {projectionVersion:wire,groupId:group.groupId,outputs:{local_resources:{type:'planning.local_resources.v1.2',quality:'limited',scope:'Synthetic resource study',asOf:'2026-09-26',limitations:['No verified current state or rights'],records:[{recordId:'study-1',resultClass:'observation_summary',...Object.fromEntries(group.fields.map((field:string)=>[field,{value:null,claimClass:'missing',limitations:['No evidence for this field']}]))}]}},evidence:[],limitations:['Synthetic only'],stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Checked current assigned fields',fieldRefs:[],limitations:['Current field scope only']}]))}
}
function classificationDraft():any {
  const plan=groups.getModuleAuthorExecutionFieldGroups('1.06'),raw=draft(plan[0])
  const record=raw.outputs.local_resources.records[0]
  record.resourceId={value:'study-resource-1',claimClass:'decision',limitations:['Temporary study identifier only']}
  record.historicalSource={value:text,claimClass:'source_conclusion',limitations:['Historical description does not establish current condition']}
  record.category={value:'Historical cultural lead',claimClass:'agent_inference',limitations:['Research interpretation only']}
  raw.evidence=[
    {target:target('resourceId'),kind:'proposal',rationale:'The synthetic author selected a temporary identifier for this study record; it is not an official identity.'},
    {target:target('historicalSource'),kind:'source',source:{path:'original.txt',quote:text}},
    {target:target('category'),kind:'inference',rationale:'The actual historical description supports this research classification; current survival and permission are unverified.',inputRefs:[{local:target('historicalSource')}]},
  ]
  raw.stepResults.step1.fieldRefs=[target('historicalSource')]
  raw.stepResults.step3.fieldRefs=[target('category')]
  return raw
}

it('makes an authored historical source available when a fresh native author classifies the resource',()=>{
  const plan=groups.getModuleAuthorExecutionFieldGroups('1.06')
  expect(groups.getModuleAuthorExecutionGroupVersion('1.06')).toBe(version)
  expect(plan[0].fields).toEqual(['resourceId','historicalSource','category'])
  expect(plan[1].fields).toEqual(['location'])
  expect(plan).toHaveLength(7)
  expect(plan.flatMap(group=>group.fields).sort()).toEqual([...fieldNames].sort())
  expect(new Set(plan.flatMap(group=>group.fields)).size).toBe(fieldNames.length)
})
it('strictly resolves classification inference to the actual source field in the same native group',()=>{
  const raw=classificationDraft()
  expect(()=>groups.validateModuleAuthorGroup('1.06',raw,[],corpus)).not.toThrow()
  const plan=groups.getModuleAuthorExecutionFieldGroups('1.06')
  const raws=[raw,...plan.slice(1).map(group=>draft(group))]
  const candidate=groups.compileModuleAuthorGroups('1.06',raws,corpus)
  const source=candidate.claims.find(claim=>claim.kind==='source'&&claim.value===text)!
  const category=candidate.claims.find(claim=>claim.kind==='inference'&&claim.value==='Historical cultural lead')!
  expect(source).toBeDefined()
  expect(category.inputRefs).toEqual(expect.arrayContaining([expect.objectContaining({claimId:source.claimId})]))
  expect((candidate.outputs.local_resources as any).records[0].currentState.value).toBeNull()
  const audit=groups.createModuleAuthorGroupsAudit('1.06',raws.map((raw,index)=>({raw,receipt:{executionId:'synthetic-new-'+index,childId:'synthetic-new-child-'+index,actualModel:{provider:'test',model:'test'},stopReason:'completed' as const}})),candidate)
  expect(groups.replayModuleAuthorGroups('1.06',corpus,audit)).toEqual(candidate)
})
it('continues rejecting an interpretive classification relabelled as a literal source value',()=>{
  const raw=classificationDraft()
  raw.outputs.local_resources.records[0].category.claimClass='source_conclusion'
  raw.evidence[2]={target:target('category'),kind:'source',source:{path:'original.txt',quote:text}}
  expect(()=>groups.validateModuleAuthorGroup('1.06',raw,[],corpus)).toThrow('MODULE_SOURCE_VALUE_TEXT')
})
it('preserves original v17 author plans hashes and strict complete-candidate replay',()=>{
  const plan=groups.getModuleAuthorFieldGroups('1.06',historical as any),raws=plan.map(group=>draft(group,historical))
  const before=hash(raws)
  expect(groups.getModuleAuthorExecutionGroupVersion('1.06',raws.slice(0,1))).toBe(historical)
  expect(groups.getModuleAuthorExecutionFieldGroups('1.06',raws.slice(0,1))).toEqual(plan)
  const candidate=groups.compileModuleAuthorGroups('1.06',raws,corpus)
  const audit=groups.createModuleAuthorGroupsAudit('1.06',raws.map((raw,index)=>({raw,receipt:{executionId:'synthetic-'+index,childId:'synthetic-child-'+index,actualModel:{provider:'test',model:'test'},stopReason:'completed' as const}})),candidate)
  expect(groups.replayModuleAuthorGroups('1.06',corpus,audit)).toEqual(candidate)
  expect(hash(raws)).toBe(before)
  expect(()=>groups.getModuleAuthorFieldGroups('1.05',version as any)).toThrow('MODULE_GROUP_VERSION')
})
