/** Three-page controlled end-to-end pipeline + real Chromium, no remote model or DB.
 * Implements Task 3 of docs/superpowers/plans/2026-11-18-image-derived-decoration-v1.md.
 * Pixel checks prove primitive paint and bounds, NOT supplier/source visual fidelity. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import sharp from 'sharp'
import {chromium} from 'playwright-core'
import {resolveBrowserExecutable} from '../../../src/report/browser-executable.ts'
import {samplePages} from '../src/layout-library/validation.mjs'
import {renderNativeDocument} from '../src/layout-library/render.mjs'
import {buildDecorationReuseFixture,primitiveColors,primitiveCenters,primitiveOutside,textCounts,imageCounts} from './fixtures/component-decoration-reuse.mjs'
const out=resolve(process.env.PRE_LAYOUT_SCREENSHOTS??'/tmp/component-decoration-reuse-browser');await mkdir(out,{recursive:true})
const f=await buildDecorationReuseFixture(),pkg=f.result.response.package,observations=JSON.stringify(f.observations),before=JSON.stringify(pkg)
assert.deepEqual(f.calls,['observe-1','components-1','components-2','components-3','profile','adapt-1','adapt-2','adapt-3'])
const seeds=samplePages(pkg).filter((_p,i)=>i%2===0),pages=[]
for(const [i,seed]of seeds.entries())for(const [j,density]of ['short','medium','long'].entries()){
 const p=structuredClone(seed);p.id=`synthetic-${i+1}-${density}`;p.number=pages.length+1
 p.item.title=`合成第${i+1}页 · ${density} · 可替换内容`
 p.item.textBlocks=p.item.textBlocks.map((b,k)=>({...b,text:b.key.startsWith('heading')?`第${i+1}页${k+1} · `+['标题','信息标题','可复用标题'][j]:`第${i+1}页第${k+1}块。`+'公开合成文字用于检查完整呈现。'.repeat([1,2,3][j])}))
 p.nativeAssets={images:[]}
 for(const [k,figure]of (p.item.figures??[]).entries()){
  figure.caption=`合成${(j+k)%2?'竖':'横'}图${k+1}`
  const width=(j+k)%2?160:480,height=(j+k)%2?480:160
  const bytes=await sharp({create:{width,height,channels:3,background:['#386b86','#874c61','#527343'][k]}}).png().toBuffer()
  p.nativeAssets.images.push({materialId:figure.materialId,dataUrl:'data:image/png;base64,'+bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')})
 }
 pages.push(p)
}
const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,chromiumSandbox:process.env.PRE_LAYOUT_TEST_NO_SANDBOX!=='1',args:['--disable-background-networking','--disable-extensions','--no-first-run']})
try{
 const view=await browser.newPage({viewport:{width:1680,height:1100}}),errors=[];view.on('pageerror',e=>errors.push(e.message));await view.route('**/*',route=>route.abort())
 const ready=async()=>view.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})
 const overflow=()=>view.evaluate(()=>[...document.querySelectorAll('[data-layout-slot]')].filter(e=>e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2).map(e=>({role:e.dataset.layoutSlot,binding:e.querySelector('[data-text-block]')?.dataset.textBlock})))
 const pixel=async(bytes,x,y)=>{const {data,info}=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});const offset=(Math.floor(y*info.height)*info.width+Math.floor(x*info.width))*info.channels;return [...data.subarray(offset,offset+3)]}
 const expected=c=>c.slice(1).match(/../g).map(v=>parseInt(v,16))
 const receipt=[]
 for(const [n,p]of pages.entries()){
  const i=Math.floor(n/3),l=p.nativeLayout.layout
  await view.setContent(renderNativeDocument([p]),{waitUntil:'load'});await ready();assert.deepEqual(await overflow(),[],p.id)
  const article=view.locator('[data-native-page]');assert.equal(await article.count(),1)
  assert.equal(await article.locator('[data-layout-slot="text"]').count(),textCounts[i])
  for(const b of p.item.textBlocks)assert.equal(await article.locator(`[data-text-block="${b.key}"]`).textContent(),b.text)
  assert.equal(await article.locator('.ln-title h2').textContent(),p.item.title)
  const images=article.locator('.ln-figure-grid img');assert.equal(await images.count(),imageCounts[i])
  for(let k=0;k<imageCounts[i];k++){
   assert.equal(await images.nth(k).getAttribute('src'),p.nativeAssets.images[k].dataUrl)
   assert.equal(await images.nth(k).evaluate(e=>getComputedStyle(e).objectFit),i===1?'cover':'contain')
  }
  assert.equal(await article.locator('.ln-native-prototype').evaluate(e=>e.naturalWidth),1600)
  const bytes=await article.screenshot({path:resolve(out,p.id+'.png')}),center=primitiveCenters[i]
  assert.deepEqual(await pixel(bytes,center.x,center.y),expected(primitiveColors[i]),p.id+' actual primitive paint')
  // Primitive corners/outer line region remain white: a filled bbox substitute must fail.
  assert.deepEqual(await pixel(bytes,primitiveOutside[i].x,primitiveOutside[i].y),[255,255,255],p.id+' bounded shape, not filled bounding box')
  assert.match(l.prototypeSvg,[/<line /,/<ellipse /,/<rect [^>]*rx=/][i])
  await article.locator('.ln-native-prototype').evaluate(e=>e.style.visibility='hidden')
  assert.notDeepEqual(await pixel(await article.screenshot(),center.x,center.y),expected(primitiveColors[i]),'negative control detects missing primitive')
  receipt.push({page:p.id,sourcePage:i+1,textBlocks:textCounts[i],images:imageCounts[i],fit:i===1?'cover':'contain',pixel:primitiveColors[i],overflow:false})
 }
 // Geometric overflow is checked below capacity, not hidden by the count gate.
 const excessive=structuredClone(pages.at(-1));excessive.item.textBlocks[1].text='超长合成内容'.repeat(180)
 assert(excessive.item.textBlocks.reduce((n,b)=>n+b.text.length,0)<excessive.nativeLayout.layout.contentFitRules.maxTextCharacters)
 await view.setContent(renderNativeDocument([excessive]),{waitUntil:'load'});await ready();assert((await overflow()).some(x=>x.binding==='body-1'))
 await view.screenshot({path:resolve(out,'expected-overflow-negative.png')})
 excessive.item.textBlocks[0].text='超'.repeat(2000);assert.throws(()=>renderNativeDocument([excessive]),/CONTENT_FIT/)
 assert.deepEqual(errors,[]);assert.equal(JSON.stringify(pkg),before);assert.equal(JSON.stringify(f.observations),observations)
 await f.replay();assert.equal(f.calls.length,8,'exact checkpoint replay adds no calls')
 await writeFile(resolve(out,'receipt.json'),JSON.stringify({passed:true,source:'three authored synthetic images',realBrowser:true,pdfParsingVerified:false,sourceIdentity:'controlled same-document SHA and page numbers; actual synthetic PNG byte hashes',remoteModelCalls:0,productionCandidates:0,databaseUsed:false,stages:f.calls,pages:receipt,overflowNegative:true,missingPrimitiveNegative:true,sourceObservationsUnchanged:true,visualFidelity:'not-evaluated',scope:'versioned pipeline, editable content replacement, bounds and rendered primitive pixels'},null,2))
 console.log('component-decoration reuse PASS: 3 source pages / 9 content replacements, controlled provider, actual Chromium, not fidelity acceptance')
}finally{await browser.close()}
