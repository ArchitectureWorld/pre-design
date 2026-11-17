import test from 'node:test'
import assert from 'node:assert/strict'
import {compositionPackage,compositionPage} from './fixtures/composition.mjs'
const module=await import('../src/layout-library/svg-native-renderer.mjs').catch(()=>({}))
const render=(page,spec)=>module.renderNativeDesignPageV3(page,spec)
function spec(){const p=compositionPackage();return {renderer:'pre-design-native-html-v3.0',canvas:p.canvas,theme:p.theme,layout:{...p.layouts[0],prototypeSvg:'<svg><rect width="1200" height="1000" fill="#fedcba"/></svg>',contentFitRules:{overflow:'reject',maxTitleCharacters:100,maxClaimCharacters:200,maxBodyPoints:4,maxBodyCharacters:400,maxImages:2,maxTableRows:3,maxTableColumns:3}}}}
test('V3 renders isolated visible prototype with escaped editable HTML and arbitrary canvas',()=>{
 assert.equal(typeof module.renderNativeDesignPageV3,'function')
 const page=compositionPage();page.item.title='<script>alert("x")</script>'
 const html=render(page,spec())
 assert.match(html,/data-renderer="pre-design-native-html-v3.0"/)
 assert.match(html,/data-canvas-width="1200"/)
 assert.match(html,/data-canvas-height="1000"/)
 assert.match(html,/&lt;script&gt;/)
 assert.doesNotMatch(html,/<script/)
 assert.match(html,/class="ln-native-prototype"/)
 const url=html.match(/class="ln-native-prototype"[^>]*src="([^"]+)"/)[1]
 assert.match(decodeURIComponent(url.split(',')[1]),/<rect[^>]*fill="#fedcba"/)
 assert.match(html,/data-layout-slot-id="heading"/)
 assert.match(module.NATIVE_V3_CSS,/pointer-events:none/)
})
test('V3 rejects every declared capacity overflow rather than clipping content',()=>{
 for(const field of ['maxTitleCharacters','maxClaimCharacters','maxBodyPoints','maxBodyCharacters','maxImages','maxTableRows','maxTableColumns']){
  const s=spec();s.layout.contentFitRules[field]=0
  assert.throws(()=>render(compositionPage(),s),/CONTENT_FIT/)
 }
 const s=spec();delete s.layout.contentFitRules.maxBodyPoints
 assert.throws(()=>render(compositionPage(),s),/CONTENT_FIT/)
})
test('V3 rejects uncovered chart and missing project image; never silently loses content',()=>{
 const page=compositionPage();page.item.chart={type:'bar',categories:['A'],series:[{name:'value',values:[1]}]}
 assert.throws(()=>render(page,spec()),/图表/)
 delete page.item.chart;page.nativeAssets={}
 assert.throws(()=>render(page,spec()),/ASSET/)
 const s=spec();s.layout.prototypeSvg='<svg><text>reference private data</text></svg>'
 assert.throws(()=>render(compositionPage(),s),/SVG/)
})
