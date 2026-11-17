import test from 'node:test'
import assert from 'node:assert/strict'
import {validateCoverageMap,referenceCoverage} from '../src/layout-library/reference-coverage.mjs'
test('full-document coverage requires every original page and its own observed facts',()=>{
 const sha='a'.repeat(64),profile={archetypes:[{id:'type-one'}]},observations=[{pages:Array.from({length:87},(_,i)=>({fileSha256:sha,pageNumber:i+1,facts:[{id:'fact-'+(i+1)}]}))}],inventory={files:[{sha256:sha,pageCount:87,pages:Array.from({length:87},(_,i)=>({pageNumber:i+1}))}]}
 const raw={pages:observations[0].pages.map(p=>({fileSha256:sha,pageNumber:p.pageNumber,archetypeId:'type-one',factIds:[p.facts[0].id]}))}
 const good=validateCoverageMap(raw,profile,observations);assert.equal(referenceCoverage(inventory,observations,good).complete,true)
 assert.equal(referenceCoverage(inventory,observations).complete,false);assert.equal(referenceCoverage(inventory,observations).synthesizedPages,0)
 for(const mutate of [x=>x.pages.pop(),x=>x.pages.push(x.pages[0]),x=>x.pages[0].factIds=['fact-2'],x=>x.pages[0].archetypeId='missing']){const value=structuredClone(raw);mutate(value);assert.throws(()=>validateCoverageMap(value,profile,observations))}
})
test('coverage labels never equate parsed pages with synthesized pages or expose arbitrary text',async()=>{
 const {coverageLabel}=await import('../src/layout-library/reference-coverage-ui.js')
 assert.match(coverageLabel({totalPages:87,extractedPages:87,observedPages:30,synthesizedPages:0}),/已综合 0 页/)
 assert.equal(coverageLabel({totalPages:'PRIVATE',extractedPages:1,observedPages:1,synthesizedPages:1}),'')
 assert.equal(coverageLabel({totalPages:1,extractedPages:2,observedPages:1,synthesizedPages:1}),'')
})
