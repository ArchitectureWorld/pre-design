import test from 'node:test'
import assert from 'node:assert/strict'
import {deriveTitleReuse} from '../src/layout-library/title-reuse.mjs'
const fixture=()=>({canvas:{width:1600,height:900},rightMargin:.04,observation:{components:[{id:'title',kind:'text',purpose:'title',rect:{x:.08,y:.05,w:.6,h:.075}},{id:'body',kind:'text',purpose:'body',rect:{x:.04,y:.2,w:.92,h:.6}}]},input:{styles:{title:{fontSize:48,lineHeight:1.2,padding:0}},componentStyles:{},adjustments:{}}})
test('explicit title reuse widens into free right space and records capacity without rewriting content',()=>{
 const x=fixture(),before=JSON.stringify(x),r=deriveTitleReuse(x)
 assert.equal(JSON.stringify(x),before);assert.equal(r.adjustments.title.rect.w,.88);assert.equal(r.adjustments.title.reason,'content-width');assert.equal(r.maxTitleCharacters,26);assert.equal(r.review.capacityKind,'conservative-cjk-estimate');assert.equal(r.review.visualAcceptance,'pending')
})
test('same-band neighbours stop expansion and unsafe geometry fails closed',()=>{
 const x=fixture();x.observation.components.push({id:'logo',kind:'image',rect:{x:.72,y:.06,w:.1,h:.05}})
 assert(Math.abs(deriveTitleReuse(x).adjustments.title.rect.w-.63)<1e-8)
 x.observation.components[2].rect.x=.5;assert.throws(()=>deriveTitleReuse(x))
})
test('insufficient height or invalid margin never invents title capacity',()=>{
 for(const change of [x=>x.input.styles.title.fontSize=100,x=>x.rightMargin=-1,x=>x.rightMargin=NaN]){const x=fixture();change(x);assert.throws(()=>deriveTitleReuse(x))}
})
test('positive letter spacing reduces capacity and negative spacing never inflates it',()=>{
 const x=fixture();x.canvas={width:500,height:500};x.rightMargin=0;x.observation.components[0].rect={x:0,y:0,w:1,h:.12};x.input.styles.title={fontSize:40,lineHeight:1.2,letterSpacing:48}
 assert.equal(deriveTitleReuse(x).maxTitleCharacters,5)
 x.input.styles.title.letterSpacing=0;const zero=deriveTitleReuse(x).maxTitleCharacters
 x.input.styles.title.letterSpacing=-2;assert.equal(deriveTitleReuse(x).maxTitleCharacters,zero)
})
