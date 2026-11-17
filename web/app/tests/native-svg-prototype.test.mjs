import test from 'node:test'
import assert from 'node:assert/strict'
const module=await import('../src/layout-library/svg-prototype.mjs').catch(()=>({}))
const sanitize=(svg,opts={canvas:{width:1200,height:1000}})=>module.sanitizePrototypeSvg(svg,opts)
test('canonical decorative prototype preserves geometry, local gradients and canvas',()=>{
 assert.equal(typeof module.sanitizePrototypeSvg,'function')
 const result=sanitize('<svg><defs><linearGradient id="a"><stop offset="0" stop-color="#ffffff"/></linearGradient></defs><rect width="1200" height="1000" fill="url(#a)"/><path d="M0 0 L20 30 Z"/></svg>')
 assert.match(result,/viewBox="0 0 1200 1000"/)
 assert.match(result,/fill="url\(#a\)"/)
 assert.equal(sanitize(result),result)
})
test('rejects active, private, malformed and unsupported SVG instead of stripping',()=>{
 for(const body of ['<script/>','<foreignObject/>','<text>private</text>','<title>private</title>','<desc/>','<image href="data:image/png;base64,AA=="/>','<rect onclick="alert(1)"/>','<rect style="fill:red"/>','<use href="#a"/>','<rect fill="url(https://example.org/a)"/>','<rect fill="url(#missing)"/>','<rect xmlns="http://evil"/>','<rect x="NaN"/>','<rect x="1" x="2"/>','<rect/><svg/>','private','<g></rect>','<rect unknown="1"/>','<rect fill="&#114;ed"/>','<rect width="-1"/>']){
  assert.throws(()=>sanitize('<svg>'+body+'</svg>'), /SVG/)
 }
 for(const svg of ['<!DOCTYPE svg><svg/>','<?xml version="1.0"?><svg/>','<svg/><!-- comment -->','<svg/><svg/>','<svg viewBox="0 0 1600 900"/>','<svg width="100%"/>'])assert.throws(()=>sanitize(svg),/SVG/)
})
test('limits nesting, node count, input bytes and numeric magnitude',()=>{
 for(const svg of ['<svg>'+ '<g>'.repeat(33)+'</g>'.repeat(33)+'</svg>', '<svg>'+'<rect/>'.repeat(2001)+'</svg>', '<svg>'+ ' '.repeat(262145)+'</svg>', '<svg><rect x="1000001"/></svg>'])assert.throws(()=>sanitize(svg),/SVG/)
 assert.throws(()=>sanitize('<svg/>',{canvas:{width:1,height:1000}}),/SVG/)
})
test('rejects recursive clipping even when reference is in a descendant',()=>{
 assert.throws(()=>sanitize('<svg><defs><clipPath id="a"><g><rect width="10" height="10" clip-path="url(#a)"/></g></clipPath></defs><rect width="10" height="10" clip-path="url(#a)"/></svg>'),/SVG/)
})
test('preserves safe clip geometry and numeric transforms',()=>{
 const svg=sanitize('<svg><defs><clipPath id="cut"><circle cx="10" cy="10" r="8"/></clipPath></defs><g transform="translate(10,20) rotate(30)" clip-path="url(#cut)"><path d="M0 0 C1 2 3 4 5 6 Z" fill="#fff"/></g></svg>')
 assert.match(svg,/transform="translate\(10 20\) rotate\(30\)"/)
 assert.equal(sanitize(svg),svg)
})
