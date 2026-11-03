import {describe,it,expect} from 'vitest'
import {sha256CanonicalJson as hash} from '../src/presentation/canonical-json.ts'
import {moduleAuthorGroupSourceContext} from '../src/research-v2/module-group-source-context.ts'

const sources=()=>({corpus:{documents:[{path:'original.txt',text:'Frozen original peer source'}],limitations:['Frozen source boundary']},
 sourceValues:[{sourceId:'peer-source',rawValue:'Frozen original peer source'}],inputRefs:[{moduleId:'project',claimId:'constraint'}],
 upstream:['1.01','2.01','3.01'].map(itemId=>({itemId,moduleId:'module-'+itemId,claims:[{claimId:'claim-'+itemId,value:itemId==='3.01'?'Unrelated historical macro statistic '.repeat(3000):'Original project constraint '+itemId}],
  limitations:['Original module constraint '+itemId],outputs:{context:{type:'synthetic',quality:'limited',scope:'Frozen scope '+itemId,asOf:'2026-01-01',limitations:['Frozen port constraint '+itemId],
   records:[{recordId:'record-'+itemId,resultClass:'observation_summary',value:{value:null,claimClass:'missing',limitations:['Unavailable source']}}]}}}))})

describe('peer blind spots use frozen records and retain project constraints',()=>{
 it('withholds unrelated macro claims while preserving exact sources, regional constraints and full validation identity',()=>{
  const full=sources(),before=structuredClone(full),identity=hash(full),scoped:any=moduleAuthorGroupSourceContext('3.04',['blindSpots'],full)
  expect(scoped.upstream[2]).not.toHaveProperty('claims');expect(scoped.upstream[2]).not.toHaveProperty('limitations')
  for(let i=0;i<2;i++){expect(scoped.upstream[i].claims).toEqual(before.upstream[i].claims);expect(scoped.upstream[i].limitations).toEqual(before.upstream[i].limitations)}
  expect(scoped.upstream[2].outputInventory.context).toMatchObject({quality:'limited',scope:'Frozen scope 3.01',asOf:'2026-01-01',limitations:['Frozen port constraint 3.01']})
  expect(scoped.upstream[2].outputInventory.context.records[0].fieldClasses.value).toBe('missing')
  expect(scoped.groupSourceScope).toMatchObject({fullSourceContextHash:identity,peerBlindSpotsOnly:true,upstreamExcludedModuleIds:['module-3.01']})
  expect(scoped.groupSourceScope.peerSelectionOnly).toBeUndefined()
  for(const key of ['corpus','sourceValues','inputRefs'])expect(scoped[key]).toEqual(before[key as keyof typeof before])
  expect(JSON.stringify(scoped).length).toBeLessThan(JSON.stringify(full).length/2)
  expect(full).toEqual(before);expect(hash(full)).toBe(identity)
 })
 it('keeps all supplied macro claims for mixed tasks, peer relations and coverage',()=>{
  for(const fields of [['blindSpots','relationship'],['discoveryQueries','coverage'],['servedNeeds','relationship']]){
   const full=sources(),scoped:any=moduleAuthorGroupSourceContext('3.04',fields,full)
   expect(scoped.upstream[2].claims).toEqual(full.upstream[2].claims);expect(scoped.upstream[2].limitations).toEqual(full.upstream[2].limitations)
   expect(scoped.groupSourceScope.peerBlindSpotsOnly).toBeUndefined()
  }
 })
 it('falls back to complete input when a frozen output inventory is malformed',()=>{
  const full:any=sources();full.upstream[2].outputs={unavailable:true}
  expect(moduleAuthorGroupSourceContext('3.04',['blindSpots'],full)).toBe(full)
 })
 it('does not advertise claims when only withheld macro data exists',()=>{
  const full=sources();full.upstream=full.upstream.filter(row=>row.itemId==='3.01')
  const scoped:any=moduleAuthorGroupSourceContext('3.04',['blindSpots'],full)
  expect(scoped.groupSourceScope.upstreamClaimsAvailable).toBe(false)
  expect(scoped.upstream[0]).not.toHaveProperty('claims')
  expect(scoped.upstream[0].outputInventory.context.records[0].fieldClasses.value).toBe('missing')
 })
})
