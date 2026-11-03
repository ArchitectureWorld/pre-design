import {it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import * as groups from '../src/research-v2/module-author-groups.ts'
import {moduleAuthorGroupSourceContext} from '../src/research-v2/module-group-source-context.ts'
import {getModuleFieldContracts} from '../src/research-v2/module-contracts.ts'
import {moduleGroupWorkPlan} from '../src/research-v2/module-group-work-plan.ts'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'

const version='module-author-field-group.v18'
const fields=['documentId','documentNumber','issuer','publishedDate','effectiveDate','revokedDate','approvalStatus','clauseLocation','applicableRegion','applicableSubjects','applicableUses','constraintObject','requirement','exceptions','controlGeometry','precision','projectImpact','response','reviewer','reviewStatus']
const base={documents:[],limitations:['Synthetic only']},corpus={...base,fingerprint:createHash('sha256').update(JSON.stringify(base)).digest('hex')}
function raw(group:any,wire=version):any {
 return {projectionVersion:wire,groupId:group.groupId,outputs:{planning_conditions:{type:'planning.planning_conditions.v1.2',quality:'limited',scope:'Synthetic policy evidence study',asOf:'2026-10-05',limitations:['No verified approvals'],records:Array.from({length:7},(_,index)=>({recordId:'policy-'+index,resultClass:'observation_summary',...Object.fromEntries(group.fields.map((field:string)=>[field,{value:null,claimClass:'missing',limitations:['No supplied evidence']}]))}))}},evidence:[],limitations:['Synthetic only'],stepResults:Object.fromEntries([1,2,3,4].map(step=>['step'+step,{status:'limited',summary:'Checked current policy fields only',fieldRefs:[],limitations:['Unknown facts remain missing']}]))}
}
function sources(){return {corpus:{documents:[{path:'original.txt',text:'Exact original policy source'}]},sourceValues:[{sourceId:'original',rawValue:'Exact original policy source'}],inputRefs:[{moduleId:'boundary',resultHash:'original-hash'}],images:{sources:[{path:'original.jpg',contentHash:'original-image'}]},upstream:[{itemId:'1.02',moduleId:'boundary',claims:[{claimId:'boundary-claim',value:'Provisional study identity',kind:'proposal',rationale:'Study selection only'}],limitations:['Study identity is not a permit or measured geometry'],outputs:{boundaries:{type:'synthetic',quality:'limited',scope:'Frozen study scope',asOf:'2026-09-26',limitations:['No verified approvals'],records:[{recordId:'study',resultClass:'inference',geometry:{value:null,claimClass:'missing',limitations:['No measured geometry. '.repeat(1500)]}}]}}}]}}

it('retains the original policy identity anchor and bounds every later author to two complete fields and all four steps',()=>{
 const plan=groups.getModuleAuthorExecutionFieldGroups('1.03')
 expect(groups.getModuleAuthorExecutionGroupVersion('1.03')).toBe(version)
 expect(plan).toHaveLength(9);expect(plan[0].fields).toEqual(['documentId','documentNumber','issuer','publishedDate'])
 expect(plan.flatMap(group=>group.fields)).toEqual(fields)
 for(const group of plan.slice(1)){
  expect(group.fields.length).toBeLessThanOrEqual(2)
  expect(moduleGroupWorkPlan('1.03',group,plan).stepCoverage.map(step=>step.assignedFields)).toEqual([group.fields,group.fields,group.fields,group.fields])
  const schema:any=groups.getModuleAuthorGroupSchema('1.03',group.groupId)
  expect(schema.properties.outputs.properties.planning_conditions.properties.records.items.required).toEqual(['recordId','resultClass',...group.fields])
 }
})
it('strictly merges and replays all policy fields and rejects incomplete or relabelled native receipts',()=>{
 const plan=groups.getModuleAuthorExecutionFieldGroups('1.03'),raws:any[]=[]
 for(const group of plan){const draft=raw(group);groups.validateModuleAuthorGroup('1.03',draft,raws,corpus);raws.push(draft)}
 const candidate=groups.compileModuleAuthorGroups('1.03',raws,corpus),audit=groups.createModuleAuthorGroupsAudit('1.03',raws.map((draft,index)=>({raw:draft,receipt:{executionId:'synthetic-e-'+index,childId:'synthetic-c-'+index,actualModel:{provider:'test',model:'test'},stopReason:'completed' as const}})),candidate)
 expect(groups.replayModuleAuthorGroups('1.03',corpus,audit)).toEqual(candidate)
 expect((candidate.outputs.planning_conditions as any).records).toHaveLength(7)
 for(const record of (candidate.outputs.planning_conditions as any).records)expect(Object.keys(record).sort()).toEqual(['recordId','resultClass',...fields].sort())
 expect(()=>groups.compileModuleAuthorGroups('1.03',raws.slice(0,-1),corpus)).toThrow(/MODULE_GROUP_/)
 const changed:any=structuredClone(audit);changed.groups[1].raw.projectionVersion=groups.MODULE_AUTHOR_GROUP_VERSION
 expect(()=>groups.replayModuleAuthorGroups('1.03',corpus,changed)).toThrow(/MODULE_GROUP_/)
})
it.each([1,2,3,4])('preserves %i accepted historical policy groups exactly and narrows only the unaccepted suffix',prefixLength=>{
 const old=groups.getModuleAuthorFieldGroups('1.03',groups.MODULE_AUTHOR_GROUP_VERSION),prior=old.slice(0,prefixLength).map(group=>raw(group,groups.MODULE_AUTHOR_GROUP_VERSION)),before=hash(prior)
 const narrowed=groups.getModuleAuthorExecutionFieldGroups('1.03',prior);expect(narrowed).toHaveLength(10-prefixLength);expect(narrowed.slice(0,prefixLength)).toEqual(old.slice(0,prefixLength))
 expect(groups.getModuleAuthorExecutionGroupVersion('1.03',prior)).toBe(version)
 expect(narrowed.flatMap(group=>group.fields)).toEqual(fields)
 expect(narrowed.slice(prefixLength).every(group=>group.fields.length<=2)).toBe(true)
 const raws=[...prior];for(const group of narrowed.slice(prefixLength)){const draft=raw(group);groups.validateModuleAuthorGroup('1.03',draft,raws,corpus);raws.push(draft);expect(groups.isCurrentModuleAuthorPrefix('1.03',raws)).toBe(true)}
 const candidate=groups.compileModuleAuthorGroups('1.03',raws,corpus),audit=groups.createModuleAuthorGroupsAudit('1.03',raws.map((draft,index)=>({raw:draft,receipt:{executionId:'mixed-e-'+index,childId:'mixed-c-'+index,actualModel:{provider:'test',model:'test'},stopReason:'completed' as const}})),candidate)
 expect(audit.version).toBe(version);expect(groups.replayModuleAuthorGroups('1.03',corpus,audit)).toEqual(candidate);expect(hash(prior)).toBe(before)
 expect(audit.groups.slice(0,prefixLength).map(group=>group.raw)).toEqual(prior)
 expect(audit.groups.slice(0,prefixLength).map(group=>group.projectionHash)).toEqual(prior.map(draft=>hash(draft)))
 const relabelled:any=structuredClone(audit);relabelled.groups[prefixLength-1].raw.projectionVersion=version
 expect(()=>groups.replayModuleAuthorGroups('1.03',corpus,relabelled)).toThrow(/MODULE_GROUP_/)
 expect(()=> (groups as any).getModuleAuthorFieldGroups('1.06',version)).toThrow(/MODULE_GROUP_VERSION/)
 expect(getModuleFieldContracts('1.03').ports.planning_conditions.fields.map(field=>field.name)).toEqual(fields)
})
it('preserves a complete historical policy author plan for independent review and rejects noncontiguous or overlapping suffixes',()=>{
 const old=groups.getModuleAuthorFieldGroups('1.03',groups.MODULE_AUTHOR_GROUP_VERSION),historical=old.map(group=>raw(group,groups.MODULE_AUTHOR_GROUP_VERSION)),before=hash(historical)
 expect(groups.getModuleAuthorExecutionFieldGroups('1.03',historical)).toEqual(old)
 expect(groups.getModuleAuthorExecutionGroupVersion('1.03',historical)).toBe(groups.MODULE_AUTHOR_GROUP_VERSION)
 const candidate=groups.compileModuleAuthorGroups('1.03',historical,corpus),audit=groups.createModuleAuthorGroupsAudit('1.03',historical.map((draft,index)=>({raw:draft,receipt:{executionId:'old-e-'+index,childId:'old-c-'+index,actualModel:{provider:'test',model:'test'},stopReason:'completed' as const}})),candidate)
 expect(audit.version).toBe(groups.MODULE_AUTHOR_GROUP_VERSION);expect(groups.replayModuleAuthorGroups('1.03',corpus,audit)).toEqual(candidate);expect(hash(historical)).toBe(before)
 const skipped=[historical[0],historical[2]]
 expect(groups.isCurrentModuleAuthorPrefix('1.03',skipped)).toBe(false);expect(()=>groups.compileModuleAuthorGroups('1.03',skipped,corpus)).toThrow(/MODULE_GROUP_/)
 const narrow=raw(groups.getModuleAuthorExecutionFieldGroups('1.03',[historical[0]])[1]),overlap=[historical[0],narrow,historical[1]]
 expect(groups.isCurrentModuleAuthorPrefix('1.03',overlap)).toBe(false);expect(()=>groups.compileModuleAuthorGroups('1.03',overlap,corpus)).toThrow(/MODULE_GROUP_/)
 const extra=structuredClone(narrow);extra.outputs.planning_conditions.records[0].clauseLocation=historical[1].outputs.planning_conditions.records[0].clauseLocation
 expect(()=>groups.validateModuleAuthorGroup('1.03',extra,[historical[0]],corpus)).toThrow(/MODULE_GROUP_/)
})
it('omits repeated policy upstream manuscripts while preserving complete original claims restrictions sources and images',()=>{
 const full=sources(),before=structuredClone(full),scoped:any=moduleAuthorGroupSourceContext('1.03',['effectiveDate','revokedDate'],full)
 expect(Object.hasOwn(scoped.upstream[0],'outputs')).toBe(false);expect(scoped.upstream[0].claims).toEqual(before.upstream[0].claims);expect(scoped.upstream[0].limitations).toEqual(before.upstream[0].limitations)
 for(const key of ['corpus','sourceValues','inputRefs','images'] as const)expect(scoped[key]).toEqual(before[key])
 expect(scoped.groupSourceScope.fullSourceContextHash).toBe(hash(full));expect(JSON.stringify(scoped).length).toBeLessThan(JSON.stringify(full).length/2);expect(full).toEqual(before)
 for(const key of ['outputs','claims','limitations'] as const){const unavailable:any=sources();delete unavailable.upstream[0][key];expect(moduleAuthorGroupSourceContext('1.03',['effectiveDate'],unavailable)).toBe(unavailable)}
 expect(moduleAuthorGroupSourceContext('1.03',['sensitiveObjects'],full)).toBe(full)
})
it('scopes missing verification fields to the native group while keeping missing approval references invalid',()=>{
 const plan=groups.getModuleAuthorExecutionFieldGroups('1.03'),prior=plan.slice(0,-1).map(group=>raw(group)),before=hash(prior)
 const draft=raw(plan.at(-1));expect(()=>groups.validateModuleAuthorGroup('1.03',draft,prior,corpus)).not.toThrow()
 const unsupported=structuredClone(draft),record=unsupported.outputs.planning_conditions.records[0]
 record.reviewStatus={value:'Synthetic unsupported verification state',claimClass:'assumption',limitations:['No verification receipt']}
 unsupported.evidence=[{target:{port:'planning_conditions',recordId:'policy-0',field:'reviewStatus',at:''},kind:'assumption',rationale:'Synthetic invalid dependency only',inputRefs:[{local:{port:'planning_conditions',recordId:'policy-0',field:'approvalStatus',at:''}}]}]
 expect(()=>groups.validateModuleAuthorGroup('1.03',unsupported,prior,corpus)).toThrow(/MODULE_PROJECTION_REFERENCE.*referenced field is missing/u)
 const prompt=groups.getModuleAuthorGroupOutputSchemaPrompt('1.03','planning_conditions:5.2',prior)
 const block=prompt.match(/^\{"verificationGroupScope":.+\}$/mu)
 expect(block?JSON.parse(block[0]).verificationGroupScope:undefined).toMatchObject({
  fields:[{name:'reviewer',meaning:'核验人'},{name:'reviewStatus',meaning:'核验状态'}],
  allMissingWithinGroupAllowed:true,approvalStatusIsVerificationEvidence:false,completeModuleUsefulConclusionRequired:true,independentReviewRequired:true,
 })
 expect(hash(prior)).toBe(before)
 expect(groups.getModuleAuthorGroupOutputSchemaPrompt('1.03','planning_conditions:5.1',prior)).not.toContain('verificationGroupScope')
})
