import test from 'node:test'
import assert from 'node:assert/strict'
import {compositionStyleSchema} from '../src/layout-library/composition-contract.mjs'
import {renderCompositionPage,RENDERER_V2} from '../src/layout-library/composition-render.mjs'
import {defaultTheme} from '../src/layout-library/contract.mjs'
const page={id:'p',item:{title:'项目背景',paragraphs:['壹'],points:[],evidenceIndexes:[]}}
const spec=()=>({renderer:RENDERER_V2,canvas:{width:1600,height:900},theme:defaultTheme,layout:{id:'section',kind:'composition',slots:[{id:'title',role:'title',rect:{x:.1,y:.5,w:.6,h:.2},style:{fontFamily:'calligraphic-fallback',letterSpacing:32,lineHeight:1.2}},{id:'chapter',role:'claim',rect:{x:.65,y:.1,w:.3,h:.35},style:{fontSize:220,lineHeight:1.1,fontFamily:'calligraphic-fallback'}}]}})
test('local typography retains editable large chapter labels and controlled fallback family',()=>{for(const slot of spec().layout.slots)assert.doesNotThrow(()=>compositionStyleSchema.parse(slot.style));const html=renderCompositionPage(page,spec());assert.match(html,/font-size:13\.75[0-9]*cqw/);assert.match(html,/letter-spacing:2cqw/);assert.match(html,/AR PL UKai CN/);assert.match(html,/>壹</);assert.match(html,/line-height:1.1/)})
test('font family cannot inject arbitrary CSS or fetch remote fonts, typography remains bounded',()=>{for(const style of [{fontFamily:'url(https://example.com)'},{letterSpacing:80},{lineHeight:.2},{fontSize:500}])assert.equal(compositionStyleSchema.safeParse(style).success,false)})
