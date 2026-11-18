import test from 'node:test'
import assert from 'node:assert/strict'
import {profileFixture} from './fixtures/reference-workflow.mjs'
const api=await import('../src/layout-library/content-style-composition-policy.mjs').catch(()=>({}))
const item=()=>({title:'完整标题',paragraphs:['原文段落'],points:['完整要点一','完整要点二']})
const input=()=>({item:item(),sourceStyle:profileFixture().designSystem,styleAcknowledged:true})
function propose(i=input()){assert.equal(typeof api.proposeContentStyleCompositions,'function');return api.proposeContentStyleCompositions(i)}
test('candidates conserve every source block once, never output source business prose or claim fit',()=>{
 const i=input(),before=structuredClone(i),p=propose(i);assert.deepEqual(i,before);assert.ok(p.candidates.length<=3);for(const c of p.candidates){assert.deepEqual(c.blocks.map(b=>b.selector),[{role:'title'},{role:'claim',index:0},{role:'body',index:0},{role:'body',index:1}]);assert.equal(c.status,'measurement-required');assert.equal(c.provenance,'inferred');assert.equal(c.visualAcceptance,'pending')}
 for(const text of [i.item.title,...i.item.paragraphs,...i.item.points])assert.ok(!JSON.stringify(p).includes(text));assert.equal(p.overflowPolicy.action,'explicit-pagination-required');assert.equal(p.overflowPolicy.splitInsideBlock,false)
})
test('editorial hierarchy is source-relative not an absolute 72px title and point count does not force columns',()=>{
 const i=input();i.sourceStyle.typography.titleSize=72;i.sourceStyle.typography.bodySize=36;const p=propose(i),c=p.candidates[0];assert.ok(c.typography.title.fontSize<72);assert.ok(c.typography.body.fontSize>=22);assert.ok(c.typography.title.fontSize>c.typography.body.fontSize);assert.equal(c.flow.columns,1);assert.equal(c.blocks.at(-1).presentation,'text-module');assert.ok(c.derivations.some(d=>d.property==='titleSize'&&d.source===72));assert.equal(c.colors.ink,i.sourceStyle.colors.ink)
})
test('column proposals require measured contiguous partitions and bounded geometry, never character estimates',()=>{
 const p=propose(),c=p.candidates.find(c=>c.flow.columns===2);assert.ok(c);assert.equal(c.flow.partition,'measured-contiguous-blocks');assert.equal(c.flow.readingOrder,'column-major');assert.ok(c.flow.gutter>0);assert.equal(c.flow.splitInsideBlock,false);assert.deepEqual(c.flow.possibleBreakAfter,[1,2]);assert.equal(c.fit,null)
 const i=input();i.sourceStyle.canvas={width:900,height:1600};assert.ok(propose(i).candidates.every(c=>c.flow.columns===1))
})
test('empty intro and one point do not invent titles or manufacture repeated group labels',()=>{
 const i=input();i.item.paragraphs=[];i.item.points=['原文'];const p=propose(i);assert.ok(p.candidates.every(c=>c.flow.columns===1));assert.deepEqual(p.candidates[0].blocks.map(b=>b.selector),[{role:'title'},{role:'body',index:0}]);assert.ok(p.candidates[0].blocks.every(b=>!Object.hasOwn(b,'heading')))
})
test('unsupported content and missing explicit permission reject; hashes bind full text and source rules',()=>{
 assert.throws(()=>propose({...input(),styleAcknowledged:false}));assert.throws(()=>propose({...input(),item:{...item(),chart:{}}}));const a=propose(),i=input();i.item.points[0]+='changed';assert.notEqual(a.contentHash,propose(i).contentHash);i.sourceStyle.spacing.gutter=.05;assert.notEqual(a.sourceStyleHash,propose(i).sourceStyleHash)
})
test('candidate set and source data remain immutable, canvas-dependent spacing stays finite',()=>{
 const i=input();i.sourceStyle.spacing.gutter=0;const p=propose(i);assert.ok(Object.isFrozen(p.candidates[0].blocks));assert.ok(p.candidates.every(c=>c.flow.groupGap>0&&c.typography.body.fontSize>=22));assert.deepEqual(p,propose(i));assert.throws(()=>propose({...i,sourceStyle:{...i.sourceStyle,canvas:{width:NaN,height:900}}}));assert.equal(p.candidates.at(-1).id,'compact-readable-flow')
})
