import test from 'node:test'
import assert from 'node:assert/strict'
import {componentDecorationSchema,renderComponentDecorations,isOpaqueRectDecoration} from '../src/layout-library/component-decorations.mjs'
import {sanitizePrototypeSvg} from '../src/layout-library/svg-prototype.mjs'
import {adaptObservedComponents} from '../src/layout-library/component-layout-adapter.mjs'
const base={componentId:'d',provenance:'derived-adaptation'},rect={...base,shape:'rect',fill:'#123456'},canvas={width:1000,height:500},sourceRect={x:.1,y:.2,w:.4,h:.2}
const newer=[{...rect,shape:'rounded-rect',radiusRatio:.2},{...rect,shape:'ellipse'},...['horizontal','vertical','diagonal-down','diagonal-up'].map(direction=>({...base,shape:'line',stroke:'#123456',strokeWidthRatio:.1,direction}))]
test('legacy schema and SVG are byte exact and never accept new primitives',()=>{
 const values=[rect,{...rect,shape:'diamond'}];assert.deepEqual(componentDecorationSchema().parse(values),values)
 assert.equal(renderComponentDecorations(values.map(d=>({...d,sourceRect})),canvas),'<rect x="100" y="100" width="400" height="100" fill="#123456"/><polygon points="300,100 500,150 300,200 100,150" fill="#123456"/>')
 for(const d of newer)assert.throws(()=>componentDecorationSchema().parse([d]))
})
test('version 1 accepts only bounded strict shape-specific fields',()=>{
 for(const d of newer)assert.deepEqual(componentDecorationSchema(1).parse([d]),[d])
 for(const version of [0,2,null,'1'])assert.throws(()=>componentDecorationSchema(version))
 for(const extra of [{path:'M0 0'},{opacity:.5},{url:'https://example.test'},{text:'x'},{layer:'foreground'},{radiusRatio:0},{stroke:'red'}])assert.throws(()=>componentDecorationSchema(1).parse([{...rect,...extra}]))
 for(const radiusRatio of [0,-1,.51,Infinity,NaN])assert.throws(()=>componentDecorationSchema(1).parse([{...newer[0],radiusRatio}]))
 for(const strokeWidthRatio of [0,-1,1.01,Infinity])assert.throws(()=>componentDecorationSchema(1).parse([{...newer[2],strokeWidthRatio}]))
})
test('bounded primitives render deterministically inside observed bbox and sanitize',()=>{
 const svg=renderComponentDecorations(newer.map(d=>({...d,sourceRect})),canvas,1)
 assert.equal(svg,renderComponentDecorations(newer.map(d=>({...d,sourceRect})),canvas,1))
 assert.match(svg,/<rect x="100" y="100" width="400" height="100" rx="20" ry="20"/)
 assert.match(svg,/<ellipse cx="300" cy="150" rx="200" ry="50"/)
 assert.match(svg,/<line x1="105" y1="150" x2="495" y2="150"/)
 assert.match(svg,/<line x1="300" y1="105" x2="300" y2="195"/)
 assert.match(svg,/<line x1="105" y1="105" x2="495" y2="195"/)
 assert.match(svg,/<line x1="105" y1="195" x2="495" y2="105"/)
 assert.doesNotThrow(()=>sanitizePrototypeSvg(`<svg width="1000" height="500" viewBox="0 0 1000 500">${svg}</svg>`,{canvas}))
 assert.equal(isOpaqueRectDecoration(rect,1),true);for(const d of newer)assert.equal(isOpaqueRectDecoration(d,1),false)
 assert.throws(()=>renderComponentDecorations([{...rect,sourceRect:{...sourceRect,x:.9}}],canvas,1))
})
const source={fileSha256:'a'.repeat(64),pageNumber:5}
function args(){return {observation:{source,components:[{id:'t',kind:'text',purpose:'title',rect:{x:.1,y:.1,w:.5,h:.2}},{id:'d',kind:'decoration',rect:{x:.1,y:.6,w:.5,h:.2}}]},allowedSources:[source],canvas,theme:{background:'#ffffff',ink:'#111111',accent:'#111111',muted:'#333333'},styles:{title:{fontSize:40,lineHeight:1.2,color:'#111111'}},id:'sample',label:'sample',archetypeId:'hero',maxTextCharacters:0,decorations:[newer[0]],decorationVersion:1}}
test('adapter version gates new primitives without altering observations or content bindings',()=>{
 const a=args(),before=JSON.stringify(a),r=adaptObservedComponents(a);assert.match(r.layout.prototypeSvg,/rx="20"/);assert.equal(JSON.stringify(a),before);assert.equal(r.layout.slots[0].id,'t');assert.equal(r.review.mappedDecorations[0].componentId,'d')
 delete a.decorationVersion;assert.throws(()=>adaptObservedComponents(a))
})
test('adapter rejects foreign identities and all nonrectangular or partial text overlap',()=>{
 for(const d of newer){const a=args();a.decorations=[d];a.observation.components[1].rect={x:0,y:0,w:1,h:1};assert.throws(()=>adaptObservedComponents(a))}
 const a=args();a.decorations=[{...newer[0],componentId:'t'}];assert.throws(()=>adaptObservedComponents(a));a.decorations=[{...newer[0],componentId:'missing'}];assert.throws(()=>adaptObservedComponents(a))
 a.decorations=[rect];a.observation.components[1].rect={x:.15,y:.1,w:.1,h:.1};assert.throws(()=>adaptObservedComponents(a))
})
test('v1 topmost rectangular coverage can hide lower curves but the reverse is rejected even with text background',()=>{
 const a=args();a.observation.components[1].rect={x:0,y:0,w:1,h:1};a.observation.components.push({id:'cover',kind:'decoration',rect:{x:0,y:0,w:1,h:1}})
 a.styles.title.background='#ffffff'
 for(const lower of [newer[0],...newer.slice(2)]){a.decorations=[lower,{...rect,componentId:'cover',fill:'#ffffff'}];assert.doesNotThrow(()=>adaptObservedComponents(a));a.decorations.reverse();assert.throws(()=>adaptObservedComponents(a))}
})
test('opaque classification rejects extra transparency or stroke fields; renderer rejects injected mapped fields',()=>{
 for(const extra of [{opacity:.5},{stroke:'#000000'},{fill:'none'}])assert.equal(isOpaqueRectDecoration({...rect,...extra},1),false)
 assert.throws(()=>renderComponentDecorations([{...rect,sourceRect,path:'M0 0'}],canvas,1))
})
test('one-pixel source rules support their full observed thickness without paint escaping bounds',()=>{
 for(const [direction,sourceRect,expected] of [
  ['horizontal',{x:.1,y:.2,w:.8,h:.002},'<line x1="100.5" y1="100.5" x2="899.5" y2="100.5"'],
  ['vertical',{x:.1,y:.2,w:.001,h:.6},'<line x1="100.5" y1="100.5" x2="100.5" y2="399.5"'],
 ]){
  const d={...base,shape:'line',stroke:'#123456',strokeWidthRatio:1,direction}
  assert.doesNotThrow(()=>componentDecorationSchema(1).parse([d]))
  const svg=renderComponentDecorations([{...d,sourceRect}],canvas,1)
  assert(svg.startsWith(expected));assert.match(svg,/stroke-width="1"/)
 }
})
test('full-thickness square rules reject collapsed endpoints in every direction',()=>{
 for(const direction of ['horizontal','vertical','diagonal-down','diagonal-up']){
  const d={...base,shape:'line',stroke:'#123456',strokeWidthRatio:1,direction,sourceRect:{x:.1,y:.1,w:.1,h:.2}}
  assert.throws(()=>renderComponentDecorations([d],canvas,1),/degenerate/i)
 }
})
