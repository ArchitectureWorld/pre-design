import {expect,it} from 'vitest'
import {moduleAuthorGroupSourceContext} from '../src/research-v2/module-group-source-context.ts'
import {sha256CanonicalJson} from '../src/presentation/canonical-json.ts'
import {expandModuleReferencePromptView,moduleReferencePromptView} from '../src/research-v2/module-reference-context.ts'

function sourceFixture(){
 const field=(value:string)=>({value,claimClass:'source_conclusion',limitations:[]})
 const limits=['Global source coverage is incomplete.','/outputs/peer_supply/records/0/status: first peer is unverified.','/outputs/peer_supply/records/1/status: second peer is unverified.']
 return {corpus:{documents:[{path:'original.txt',text:'Complete original source.'}]},sourceValues:[{sourceId:'source-original',rawValue:'Original'}],inputRefs:[{moduleId:'preplan.research.03.04'}],
  upstream:[{itemId:'3.04',moduleId:'preplan.research.03.04',outputs:{peer_supply:{type:'planning.peer_supply.v1.2',quality:'limited',scope:'Full peer research',asOf:'2026-09-28',limitations:limits,
   records:[{recordId:'supply-first',resultClass:'observation_summary',peerId:field('peer-first'),formalName:field('First')},{recordId:'supply-second',resultClass:'observation_summary',peerId:field('peer-second'),formalName:field('Second')}]}},
   claims:[{claimId:'first',selector:'/outputs/peer_supply/records/0/formalName/value',value:'First',claimClass:'source_conclusion'},
    {claimId:'second',selector:'/outputs/peer_supply/records/1/formalName/value',value:'Second',claimClass:'source_conclusion'},
    {claimId:'global',selector:'/outputs/peer_supply/scope',value:'Full peer research',claimClass:'assumption'}],limitations:limits}]}
}

it('keeps exact selected peer claims and original selector indices, global limitations and all frozen sources',()=>{
 const sources=sourceFixture(),before=structuredClone(sources)
 const scoped:any=moduleAuthorGroupSourceContext('3.05',['refundTerms','advantagesAndGaps'],sources,['peer-second'])
 expect(scoped.upstream[0].claims).toEqual([sources.upstream[0].claims[1],sources.upstream[0].claims[2]])
 expect(scoped.upstream[0].claims[0].selector).toContain('/records/1/')
 expect(scoped.upstream[0].limitations).toEqual([sources.upstream[0].limitations[0],sources.upstream[0].limitations[2]])
 expect(scoped.upstream[0].outputInventory.peer_supply.records.map((r:any)=>r.recordId)).toEqual(['supply-second'])
 expect(scoped.upstream[0].outputInventory.peer_supply.limitations).toEqual(scoped.upstream[0].limitations)
 expect(scoped.groupSourceScope).toMatchObject({fullSourceContextHash:sha256CanonicalJson(before),peerProductRecordSubsetOnly:true,selectedPeerIds:['peer-second'],omitted:['upstream.outputs','upstream.unassigned-peer-records']})
 for(const key of ['corpus','sourceValues','inputRefs'] as const)expect(scoped[key]).toEqual(before[key])
 expect(expandModuleReferencePromptView(moduleReferencePromptView(scoped))).toEqual(scoped)
 expect(sources).toEqual(before)
})

it('preserves all upstream context when a peer identity is missing or ambiguous',()=>{
 const sources=sourceFixture(),normal=moduleAuthorGroupSourceContext('3.05',['refundTerms','advantagesAndGaps'],sources)
 for(const ids of [['unknown-peer'],[undefined],[]])expect(moduleAuthorGroupSourceContext('3.05',['refundTerms','advantagesAndGaps'],sources,ids)).toEqual(normal)
 const ambiguous=sourceFixture();ambiguous.upstream[0].outputs.peer_supply.records[1].peerId.value='peer-first'
 expect(moduleAuthorGroupSourceContext('3.05',['advantagesAndGaps'],ambiguous,['peer-first'])).toEqual(moduleAuthorGroupSourceContext('3.05',['advantagesAndGaps'],ambiguous))
})

it('leaves identity, unknown fields and other modules on their existing full-claim transport',()=>{
 const sources=sourceFixture()
 for(const [item,fields] of [['3.05',['peerId']],['3.05',['unregisteredField']],['2.04',['distance']]] as const){
  expect(moduleAuthorGroupSourceContext(item,fields,sources,['peer-second'])).toEqual(moduleAuthorGroupSourceContext(item,fields,sources))
 }
})

it.each([['positioningQuote','formatId'],['applicableAudience','entitlements'],['price','pricingUnit']])('scopes assigned product fields %j and %j to their peers while retaining global and dependency constraints',(first,second)=>{
 const fields=[first,second]
 const sources=sourceFixture(),before=structuredClone(sources)
 const scoped:any=moduleAuthorGroupSourceContext('3.05',fields,sources,['peer-second'])
 expect(scoped.upstream[0].claims).toEqual([sources.upstream[0].claims[1],sources.upstream[0].claims[2]])
 expect(scoped.groupSourceScope.selectedPeerIds).toEqual(['peer-second'])
 expect(scoped.upstream[0].limitations).toEqual([sources.upstream[0].limitations[0],sources.upstream[0].limitations[2]])
 for(const key of ['corpus','sourceValues','inputRefs'] as const)expect(scoped[key]).toEqual(before[key])
 expect(expandModuleReferencePromptView(moduleReferencePromptView(scoped))).toEqual(scoped)
 expect(sources).toEqual(before)
})

it('omits compiler-addressed restrictions only for proven excluded claims, retaining unknown and global restrictions verbatim',()=>{
 const sources=sourceFixture()
 const first:any=sources.upstream[0].claims[0],second:any=sources.upstream[0].claims[1]
 first.claimId='claim-a1';first.kind='source';delete first.claimClass
 second.claimId='claim-b2';second.kind='source';delete second.claimClass
 const claimRestrictions=['claim-a1 [source_conclusion]: first peer is unverified.','claim-b2 [source_conclusion]: second peer is unverified.',
  'claim-c3 [inference]: ancestor source remains limited.','Unknown first-peer restriction must remain.',
  'claim-a1 [inference]: This class does not match the addressed claim; keep it.']
 for(const target of [sources.upstream[0].limitations,sources.upstream[0].outputs.peer_supply.limitations])target.push(...claimRestrictions)
 const before=structuredClone(sources),scoped:any=moduleAuthorGroupSourceContext('3.05',['refundTerms'],sources,['peer-second'])
 const expected=before.upstream[0].limitations.filter(x=>x!==claimRestrictions[0]&&!x.startsWith('/outputs/peer_supply/records/0/'))
 expect(scoped.upstream[0].limitations).toEqual(expected)
 expect(scoped.upstream[0].outputInventory.peer_supply.limitations).toEqual(expected)
 expect(scoped.upstream[0].claims).toEqual([sources.upstream[0].claims[1],sources.upstream[0].claims[2]])
 expect(scoped.groupSourceScope.fullSourceContextHash).toBe(sha256CanonicalJson(before))
 expect(expandModuleReferencePromptView(moduleReferencePromptView(scoped))).toEqual(scoped)
 expect(sources).toEqual(before)
 const dependent:any=sources.upstream[0].claims[1]
 dependent.inputRefs=[{moduleId:'preplan.research.03.04',claimId:'claim-a1'}]
 expect((moduleAuthorGroupSourceContext('3.05',['refundTerms'],sources,['peer-second']) as any).upstream[0].limitations).toEqual(sources.upstream[0].limitations)
})

it('preserves referenced claims and their object limitations transitively, and falls back for an unresolved local dependency',()=>{
 const sources=sourceFixture(),dependent:any=sources.upstream[0].claims[1]
 dependent.inputRefs=[{moduleId:'preplan.research.03.04',claimId:'first'}]
 const scoped:any=moduleAuthorGroupSourceContext('3.05',['advantagesAndGaps'],sources,['peer-second'])
 expect(scoped.upstream[0].claims).toEqual(sources.upstream[0].claims)
 expect(scoped.upstream[0].limitations).toEqual(sources.upstream[0].limitations)
 expect(scoped.groupSourceScope.retainedOriginalRecordIndices).toEqual([0,1])
 dependent.inputRefs=[{moduleId:'preplan.research.03.04',claimId:'absent'}]
 expect(moduleAuthorGroupSourceContext('3.05',['advantagesAndGaps'],sources,['peer-second'])).toEqual(moduleAuthorGroupSourceContext('3.05',['advantagesAndGaps'],sources))
})
