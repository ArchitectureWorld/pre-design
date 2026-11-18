import test from 'node:test'
import assert from 'node:assert/strict'
import {buildDecorationReuseFixture,textCounts,imageCounts} from './fixtures/component-decoration-reuse.mjs'
test('three image-guided pages preserve source-scoped repeated IDs and new decoration geometry',async()=>{
 const f=await buildDecorationReuseFixture()
 assert.deepEqual(f.calls,['observe-1','components-1','components-2','components-3','profile','adapt-1','adapt-2','adapt-3'])
 const p=f.result.response.package
 assert.equal(p.layouts.length,3);assert.equal(p.rights.shareAllowed,false)
 assert.deepEqual(f.result.analysis.componentObservations.map(o=>({source:o.source,components:o.components})),f.observations)
 for(const [i,l]of p.layouts.entries()){
  assert.equal(l.slots.filter(s=>s.role==='text').length,textCounts[i])
  assert.equal(l.slots.filter(s=>s.role==='image').length,imageCounts[i])
  assert.equal(f.result.analysis.componentReviews[i].source.pageNumber,i+1)
  assert.match(l.prototypeSvg,[/<line /,/<ellipse /,/<rect [^>]*rx=/][i])
  assert(!l.prototypeSvg.includes('SYNTHETIC SOURCE'))
 }
 const before=JSON.stringify(f.observations);await f.replay();assert.equal(f.calls.length,8);assert.equal(JSON.stringify(f.observations),before)
})
test('legacy grammar rejects new primitive fixture without upgrading its observations',async()=>{
 await assert.rejects(buildDecorationReuseFixture({version:undefined}),/shape|Invalid|invalid|无效|adaptation/i)
})
