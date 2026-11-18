import test from 'node:test';import assert from 'node:assert/strict'
import {adaptObservedComponents} from '../src/layout-library/component-layout-adapter.mjs'
const source={fileSha256:'a'.repeat(64),pageNumber:15},raw={source,components:[{id:'title',kind:'text',purpose:'title',rect:{x:.05,y:.05,w:.8,h:.12}},{id:'label',kind:'text',purpose:'label',rect:{x:.05,y:.3,w:.4,h:.1}},{id:'photo',kind:'image',rect:{x:.5,y:.3,w:.4,h:.5}},{id:'rule',kind:'decoration',rect:{x:.01,y:0,w:.005,h:.1}}]},theme={background:'#ffffff',ink:'#222222',accent:'#222222',muted:'#444444'},styles={title:{fontSize:40,color:'#222222',lineHeight:1.2},label:{fontSize:22,color:'#222222',lineHeight:1.2},image:{fit:'contain'}}
const args=()=>({observation:raw,allowedSources:[source],canvas:{width:1600,height:900},theme,styles,id:'component-layout',label:'组件适配',archetypeId:'comparison',maxTextCharacters:200})
test('explicit derived styles produce reusable native slots while retaining unmapped decorations',()=>{
 const result=adaptObservedComponents(args());assert.equal(result.layout.contentFitRules.maxTextBlocks,1);assert.equal(result.layout.contentFitRules.maxImages,1);assert.equal(result.layout.slots[1].binding,'label');assert.deepEqual(result.review.unmapped,['rule']);assert.equal(result.review.visualAcceptance,'pending');assert.equal(result.review.styleProvenance,'derived-adaptation');assert.equal(result.review.source.sourceValueUnchanged,true)
})
test('missing styles, illegible contrast, overflowing bounds and too-small text boxes fail rather than truncate',()=>{
 for(const change of [x=>delete x.styles.label,x=>x.styles.label.color='#eeeeee',x=>x.observation.components[1].rect.h=.001,x=>x.styles.label.fontSize=12]){
  const x=structuredClone(args());change(x);assert.throws(()=>adaptObservedComponents(x))
 }
})
test('explicit geometry adaptations preserve original observations and require a reason',()=>{
 const x=args();x.adjustments={label:{rect:{x:.05,y:.3,w:.4,h:.15},reason:'readable-text-height'}}
 const result=adaptObservedComponents(x);assert.equal(result.layout.slots[1].rect.h,.15);assert.equal(result.proposal.slots[1].observedRect.h,.1);assert.equal(result.review.geometryAdjustments[0].reason,'readable-text-height')
 delete x.adjustments.label.reason;assert.throws(()=>adaptObservedComponents(x));x.adjustments={unknown:{rect:{x:0,y:0,w:.1,h:.1},reason:'readable-text-height'}};assert.throws(()=>adaptObservedComponents(x))
})
test('adapted layouts keep existing content-fit rejection and never shorten input text',async()=>{
 const {assertNativeContentFits}=await import('../src/layout-library/svg-native-renderer.mjs')
 const {layout}=adaptObservedComponents(args()),item={title:'测试',paragraphs:[],points:[],textBlocks:[{key:'label',text:'保留原文'.repeat(100)}]};const before=JSON.stringify(item)
 assert.throws(()=>assertNativeContentFits(item,layout),e=>e.code==='CONTENT_FIT');assert.equal(JSON.stringify(item),before)
})
test('adapter enforces final native canvas and explicit usable text capacity',()=>{
 for(const change of [x=>delete x.maxTextCharacters,x=>x.maxTextCharacters=0,x=>x.canvas={width:100,height:4000}]){const x=structuredClone(args());change(x);assert.throws(()=>adaptObservedComponents(x))}
})
test('invalid inherited theme colors cannot pass contrast through NaN',()=>{
 const x=structuredClone(args());x.theme.ink='#zzzzzz';delete x.styles.label.color;assert.throws(()=>adaptObservedComponents(x))
})
test('parameterized decoration maps only actual observed primitives and checks resulting text backgrounds',()=>{
 const x=structuredClone(args());x.observation.components.push({id:'label-band',kind:'decoration',rect:{x:.04,y:.29,w:.42,h:.12}})
 x.decorations=[{componentId:'label-band',shape:'rect',fill:'#333333',provenance:'derived-adaptation'}];x.componentStyles={label:{color:'#ffffff'}}
 const result=adaptObservedComponents(x);assert(result.layout.prototypeSvg.includes('fill="#333333"'));assert.deepEqual(result.review.mappedDecorations.map(x=>x.componentId),['label-band']);assert(!result.review.unmapped.includes('label-band'));assert.equal(result.layout.slots[1].style.background,'#333333')
 delete x.componentStyles;assert.throws(()=>adaptObservedComponents(x))
 x.decorations[0].componentId='invented';assert.throws(()=>adaptObservedComponents(x))
})
test('decorative mappings reject URLs, duplicate IDs, non-decoration sources and partial text cover',()=>{
 for(const decoration of [
  {componentId:'rule',shape:'rect',fill:'url(https://example.com)',provenance:'derived-adaptation'},
  {componentId:'label',shape:'rect',fill:'#333333',provenance:'derived-adaptation'},
  {componentId:'rule',shape:'rect',fill:'#333333',provenance:'native'},
 ]){const x=args();x.decorations=[decoration];assert.throws(()=>adaptObservedComponents(x))}
 const x=structuredClone(args());x.observation.components.push({id:'partial',kind:'decoration',rect:{x:.1,y:.3,w:.1,h:.1}});x.decorations=[{componentId:'partial',shape:'rect',fill:'#333333',provenance:'derived-adaptation'}];assert.throws(()=>adaptObservedComponents(x))
 x.decorations=[{componentId:'rule',shape:'rect',fill:'#333333',provenance:'derived-adaptation'},{componentId:'rule',shape:'rect',fill:'#333333',provenance:'derived-adaptation'}];assert.throws(()=>adaptObservedComponents(x))
})
test('nested opaque decoration uses final visible layer, not every occluded ancestor',()=>{
 const x=structuredClone(args());x.observation.components.push(
 {id:'paper',kind:'decoration',rect:{x:0,y:0,w:1,h:1}},
 {id:'card',kind:'decoration',rect:{x:.01,y:.25,w:.46,h:.3}},
 {id:'band',kind:'decoration',rect:{x:.04,y:.29,w:.42,h:.12}})
 x.decorations=[['paper','#eeeeee'],['card','#ffffff'],['band','#333333']].map(([componentId,fill])=>({componentId,shape:'rect',fill,provenance:'derived-adaptation'}))
 x.componentStyles={label:{color:'#ffffff',background:'#333333'}}
 const before=JSON.stringify(x),r=adaptObservedComponents(x)
 assert.equal(r.layout.slots[1].style.background,'#333333');assert.equal(JSON.stringify(x),before)
 assert(r.layout.prototypeSvg.indexOf('fill="#ffffff"',r.layout.prototypeSvg.indexOf('fill="#eeeeee"'))<r.layout.prototypeSvg.indexOf('fill="#333333"'))
 delete x.componentStyles.label.background;assert.equal(adaptObservedComponents(x).layout.slots[1].style.background,'#333333','transparent slot resolves visible underlying layer')
 x.componentStyles.label.color='#333333';assert.throws(()=>adaptObservedComponents(x),'contrast uses top layer')
 x.componentStyles.label.color='#ffffff';x.decorations.reverse();assert.throws(()=>adaptObservedComponents(x),'reversed paint order changes visible background')
})
test('top partial overlay or non-opaque fill cannot be mistaken for covered lower layers',()=>{
 const x=structuredClone(args());x.observation.components.push({id:'full',kind:'decoration',rect:{x:0,y:0,w:1,h:1}},{id:'partial-top',kind:'decoration',rect:{x:.1,y:.3,w:.1,h:.1}})
 x.decorations=[{componentId:'full',shape:'rect',fill:'#ffffff',provenance:'derived-adaptation'},{componentId:'partial-top',shape:'rect',fill:'#333333',provenance:'derived-adaptation'}]
 assert.throws(()=>adaptObservedComponents(x));x.decorations.reverse();assert.doesNotThrow(()=>adaptObservedComponents(x),'opaque full top layer hides partial lower layer')
 for(const fill of ['transparent','#ffffff80','rgba(0,0,0,0.5)']){x.decorations[1].fill=fill;assert.throws(()=>adaptObservedComponents(x))}
})
