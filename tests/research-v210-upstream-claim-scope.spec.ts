import {expect,it} from 'vitest'
import {moduleScopedUpstream,moduleInputClaimScopePrompt} from '../src/research-v2/module-upstream-claim-scope.ts'
import {moduleUpstreamReferenceDiagnostics} from '../src/research-v2/module-upstream-reference-diagnostics.ts'
const claims=[
 {claimId:'allowed',selector:'/outputs/technical_baseline/records/0/value/value',kind:'proposal'},
 {claimId:'outside',selector:'/outputs/new_building_context/records/0/proposedUse/value',kind:'proposal'},
 {claimId:'lookalike',selector:'/outputs/technical_baseline_extra/records/0/value/value',kind:'proposal'},
 {claimId:'port',selector:'/outputs/technical_baseline',kind:'proposal'},
] as any[]
const upstream=[{moduleId:'preplan.research.01.08',claims,outputs:{original:true},limitations:['retain original limitation']}]
const inputRefs=[{moduleId:'preplan.research.01.08',selector:'/outputs/technical_baseline'}]
it('keeps only claims under the actual input port, including a slash boundary',()=>{
 expect(moduleScopedUpstream(upstream,inputRefs)).toEqual([{...upstream[0],claims:[claims[0]]}])
})
it('preserves original modules, outputs, claims and restrictions',()=>{
 const before=JSON.stringify(upstream),scoped=moduleScopedUpstream(upstream,inputRefs)
 expect(JSON.stringify(upstream)).toBe(before);expect(scoped[0].outputs).toBe(upstream[0].outputs)
 expect(scoped[0].limitations).toEqual(upstream[0].limitations)
})
it('accepts the union of declared ports without opening other modules or prefixes',()=>{
 const other={moduleId:'other',claims:[{...claims[0],claimId:'other-claim'}]}
 const scoped=moduleScopedUpstream([...upstream,other],[...inputRefs,{moduleId:upstream[0].moduleId,selector:'/outputs/new_building_context'}])
 expect(scoped.map(row=>row.claims.map(c=>c.claimId))).toEqual([['allowed','outside'],[]])
})
it('diagnoses a visible but out-of-port proposal before complete merge',()=>{
 const raw={groupId:'diagnosis:2',evidence:[{kind:'proposal',inputRefs:[{upstream:{moduleId:upstream[0].moduleId,claimId:'outside'}}]}]}
 expect(moduleUpstreamReferenceDiagnostics([raw],upstream as any)).toEqual([])
 expect(moduleUpstreamReferenceDiagnostics([raw],moduleScopedUpstream(upstream,inputRefs) as any)).toEqual([expect.stringContaining('group=diagnosis:2;')])
})
it('tells native authors the unchanged input selectors while retaining background sources',()=>{
 const prompt=moduleInputClaimScopePrompt({inputRefs} as any)
 expect(prompt.selectors).toEqual(inputRefs);expect(prompt.rule).toContain('sources.upstream')
 expect(prompt.rule).toContain('selector');expect(prompt.rule).toContain('背景')
})
