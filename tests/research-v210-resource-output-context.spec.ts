import {it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {moduleAuthorGroupSourceContext} from '../src/research-v2/module-group-source-context.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {moduleGroupWorkPlan} from '../src/research-v2/module-group-work-plan.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const version='module-author-field-group.v17'
const fields=['resourceId','category','location','historicalSource','authenticity','currentState','custodian','protectionLevel','rights','experienceContent','requiredConditions','prohibitedUses','seasonality','carryingLimits']
const base={documents:[],limitations:['Synthetic only']},corpus={...base,fingerprint:createHash('sha256').update(JSON.stringify(base)).digest('hex')}
function raw(group:any,wire=version):any {
 return {projectionVersion:wire,groupId:group.groupId,outputs:{local_resources:{type:'planning.local_resources.v1.2',quality:'limited',scope:'Synthetic resource evidence study',asOf:'2026-10-05',limitations:['No measured or verified resources'],records:Array.from({length:6},(_,index)=>({recordId:'resource-'+index,resultClass:'observation_summary',...Object.fromEntries(group.fields.map((field:string)=>[field,{value:null,claimClass:'missing',limitations:['No supplied evidence']}]))}))}},evidence:[],limitations:['Synthetic only'],stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Checked current resource fields only',fieldRefs:[],limitations:['Unknown facts remain missing']}]))}
}
function sources(){return {corpus:{documents:[{path:'original.txt',text:'Exact original source'}]},sourceValues:[{sourceId:'original',rawValue:'Exact original source'}],inputRefs:[{moduleId:'boundary',resultHash:'original-hash'}],images:{sources:[{path:'original.jpg',contentHash:'original-image'}]},upstream:[{itemId:'1.02',moduleId:'boundary',claims:[{claimId:'boundary-claim',value:'Provisional study identity',kind:'proposal',rationale:'Study selection only'}],limitations:['Provisional study identity is not measured geometry'],outputs:{boundaries:{type:'synthetic',quality:'limited',scope:'Frozen study scope',asOf:'2026-09-26',limitations:['No measured geometry'],records:[{recordId:'study',resultClass:'inference',geometry:{value:null,claimClass:'missing',limitations:['No measured geometry. '.repeat(1500)]}}]}}}]}}

it('preserves v17 resource authors with two complete fields and six original record identities',()=>{
 const plan=groups.getModuleAuthorFieldGroups('1.06',version)
 expect(groups.getModuleAuthorExecutionGroupVersion('1.06',[raw(plan[0])])).toBe(version)
 expect(plan).toHaveLength(7);expect(plan.flatMap(group=>group.fields)).toEqual(fields)
 for(const group of plan){
  expect(group.fields.length).toBeLessThanOrEqual(2)
  const work=moduleGroupWorkPlan('1.06',group,plan)
  expect(work.stepCoverage.map(step=>step.assignedFields)).toEqual([group.fields,group.fields,group.fields,group.fields])
  const schema:any=groups.getModuleAuthorGroupSchema('1.06',group.groupId,[],version)
  expect(schema.properties.outputs.properties.local_resources.properties.records.items.required).toEqual(['recordId','resultClass',...group.fields])
 }
})
it('strictly merges and replays all resource fields without accepting a missing group or relabelled original receipt',()=>{
 const plan=groups.getModuleAuthorFieldGroups('1.06',version),raws:any[]=[]
 for(const group of plan){const draft=raw(group);groups.validateModuleAuthorGroup('1.06',draft,raws,corpus);raws.push(draft)}
 const candidate=groups.compileModuleAuthorGroups('1.06',raws,corpus),audit=groups.createModuleAuthorGroupsAudit('1.06',raws.map((draft,index)=>({raw:draft,receipt:{executionId:'synthetic-execution-'+index,childId:'synthetic-child-'+index,actualModel:{provider:'test',model:'test'},stopReason:'completed' as const}})),candidate)
 expect(groups.replayModuleAuthorGroups('1.06',corpus,audit)).toEqual(candidate)
 expect((candidate.outputs.local_resources as any).records).toHaveLength(6)
 for(const record of (candidate.outputs.local_resources as any).records){expect(Object.keys(record).sort()).toEqual(['recordId','resultClass',...fields].sort());for(const field of fields)expect(record[field]).toMatchObject({value:null,claimClass:'missing'})}
 expect(()=>groups.compileModuleAuthorGroups('1.06',raws.slice(0,-1),corpus)).toThrow(/MODULE_GROUP_/)
 const changed:any=structuredClone(audit);changed.groups[0].raw.projectionVersion=groups.MODULE_AUTHOR_GROUP_VERSION
 expect(()=>groups.replayModuleAuthorGroups('1.06',corpus,changed)).toThrow(/MODULE_GROUP_/)
})
it('retains the exact historical four-field resource plan when an accepted v8 prefix already exists',()=>{
 const old=groups.getModuleAuthorFieldGroups('1.06',groups.MODULE_AUTHOR_GROUP_VERSION),raws:any[]=[]
 expect(old).toHaveLength(4)
 for(const group of old)raws.push(raw(group,groups.MODULE_AUTHOR_GROUP_VERSION))
 expect(groups.getModuleAuthorExecutionFieldGroups('1.06',raws.slice(0,1))).toEqual(old)
 expect(groups.getModuleAuthorExecutionGroupVersion('1.06',raws.slice(0,1))).toBe(groups.MODULE_AUTHOR_GROUP_VERSION)
 expect(groups.isCurrentModuleAuthorPrefix('1.06',raws.slice(0,1))).toBe(true)
 expect(()=>groups.compileModuleAuthorGroups('1.06',raws,corpus)).not.toThrow()
 expect(()=> (groups as any).getModuleAuthorFieldGroups('1.05',version)).toThrow(/MODULE_GROUP_VERSION/)
 expect(getModuleFieldContracts('1.06').ports.local_resources.fields.map(field=>field.name)).toEqual(fields)
})
it('removes repeated upstream resource manuscripts while retaining original claims restrictions sources and images',()=>{
 const full=sources(),before=structuredClone(full),scoped:any=moduleAuthorGroupSourceContext('1.06',['resourceId','category'],full)
 expect(scoped.upstream[0]).not.toHaveProperty('outputs');expect(scoped.upstream[0].claims).toEqual(before.upstream[0].claims);expect(scoped.upstream[0].limitations).toEqual(before.upstream[0].limitations)
 expect(scoped.upstream[0].outputInventory.boundaries.records[0].fieldClasses.geometry).toBe('missing')
 for(const key of ['corpus','sourceValues','inputRefs','images'] as const)expect(scoped[key]).toEqual(before[key])
 expect(scoped.groupSourceScope.fullSourceContextHash).toBe(hash(full));expect(JSON.stringify(scoped).length).toBeLessThan(JSON.stringify(full).length/2);expect(full).toEqual(before)
 for(const key of ['outputs','claims','limitations'] as const){const unavailable:any=sources();delete unavailable.upstream[0][key];expect(moduleAuthorGroupSourceContext('1.06',['resourceId'],unavailable)).toBe(unavailable)}
 expect(moduleAuthorGroupSourceContext('1.06',['sensitiveObjects'],full)).toBe(full)
})
