import {describe,it,expect} from 'vitest'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'
import {moduleAuthorGroupSourceContext} from '../src/research-v2/module-group-source-context.ts'
import {expandModuleReferencePromptView,moduleReferencePromptView} from '../src/research-v2/module-reference-context.ts'
import {getModuleAuthorExecutionFieldGroups,getModuleAuthorGroupSchema,getModuleAuthorGroupOutputSchemaPrompt} from '../src/research-v2/module-author-groups.ts'

const plans=[
  {groupId:'asset_rights:1',port:'asset_rights',fields:['assetId','position','rightType','rightHolder']},
  {groupId:'asset_rights:2',port:'asset_rights',fields:['proofIds','registeredArea','measuredArea','registeredUse']},
  {groupId:'asset_rights:3',port:'asset_rights',fields:['actualUse','leaseTerm','restrictions','availability']},
  {groupId:'rights_context:1',port:'rights_context',fields:['assetId','rightType','rightHolder','proofIds']},
  {groupId:'rights_context:2',port:'rights_context',fields:['proposedAction','disposalPermissions','restrictions','requiredApprovals']},
  {groupId:'rights_context:3',port:'rights_context',fields:['status','responsibleActor']},
]
function sources(){
  const note='Only a provisional study boundary; no measured geometry, legal ownership or approval.'
  return {corpus:{documents:[{path:'original.txt',text:'Unchanged original source.'}]},sourceValues:[{sourceId:'original'}],
    inputRefs:[{moduleId:'preplan.research.01.02',resultHash:'original-result'}],images:{sources:[{path:'original.jpg',contentHash:'original-image'}]},
    upstream:[{itemId:'1.02',moduleId:'preplan.research.01.02',outputs:{boundaries:{type:'site-boundaries',quality:'limited',scope:'Provisional study',asOf:'2026-09-26',limitations:[note],
      records:[{recordId:'working-boundary',resultClass:'inference',boundaryId:{value:'working-id',claimClass:'decision',claimRefs:['work-id'],limitations:[note.repeat(1000)]},
        geometry:{value:null,claimClass:'missing',claimRefs:[],limitations:['No surveyed boundary.']}}]}},
      claims:[{claimId:'work-id',selector:'/outputs/boundaries/records/0/boundaryId/value',value:'working-id',kind:'proposal',rationale:'Study identifier only.',limitations:[note]}],
      limitations:[note,'/outputs/boundaries/records/0/geometry: No surveyed boundary.']}],
  }
}

describe('asset research author context after repeated native output exhaustion',()=>{
  it.each(plans)('bounds duplicated upstream text for $groupId without losing claims or restrictions',group=>{
    const input=sources(),before=structuredClone(input),identity=sha256CanonicalJson(input)
    const scoped:any=moduleAuthorGroupSourceContext('1.04',group.fields,input)
    expect(scoped.upstream[0]).not.toHaveProperty('outputs')
    expect(scoped.upstream[0].claims).toEqual(before.upstream[0].claims)
    expect(scoped.upstream[0].limitations).toEqual(before.upstream[0].limitations)
    expect(scoped.upstream[0].outputInventory.boundaries).toEqual({type:'site-boundaries',quality:'limited',scope:'Provisional study',asOf:'2026-09-26',limitations:before.upstream[0].outputs.boundaries.limitations,
      records:[{recordId:'working-boundary',resultClass:'inference',fieldClasses:{boundaryId:'decision',geometry:'missing'}}]})
    expect(scoped.groupSourceScope).toMatchObject({fullSourceContextHash:identity,upstreamClaimsAvailable:true,upstreamOutputsInventoryOnly:true,omitted:['upstream.outputs']})
    for(const key of ['corpus','sourceValues','inputRefs','images'] as const)expect(scoped[key]).toEqual(before[key])
    expect(expandModuleReferencePromptView(moduleReferencePromptView(scoped))).toEqual(scoped)
    expect(JSON.stringify(scoped).length).toBeLessThan(JSON.stringify(input).length/2)
    expect(input).toEqual(before);expect(sha256CanonicalJson(input)).toBe(identity)
  })
  it('retains full upstream inputs when the complete published claims or record inventory cannot be checked',()=>{
    for(const missing of ['claims','limitations','outputs'] as const){
      const input:any=sources();delete input.upstream[0][missing]
      expect(moduleAuthorGroupSourceContext('1.04',['assetId'],input)).toBe(input)
    }
    const input:any=sources();delete input.upstream[0].outputs.boundaries.records[0].resultClass
    expect(moduleAuthorGroupSourceContext('1.04',['assetId'],input)).toBe(input)
    expect(moduleAuthorGroupSourceContext('1.05',['assetId'],sources())).not.toHaveProperty('groupSourceScope')
  })
  it.each(plans)('avoids sending a duplicate professional schema for $groupId while preserving its native contract',group=>{
    const schema:any=getModuleAuthorGroupSchema('1.04',group.groupId,[])
    const output=schema.properties.outputs
    expect(output.required).toEqual([group.port])
    expect(output.properties[group.port].properties.records.items.required).toEqual(['recordId','resultClass',...group.fields])
    expect([...schema.required].sort()).toEqual(['evidence','groupId','limitations','outputs','projectionVersion','stepResults'])
    const prompt=getModuleAuthorGroupOutputSchemaPrompt('1.04',group.groupId,[])
    expect(prompt.length).toBeLessThan(1000)
    expect(prompt).not.toContain(JSON.stringify(output))
    expect(getModuleAuthorExecutionFieldGroups('1.04')).toEqual(plans)
  })
})
