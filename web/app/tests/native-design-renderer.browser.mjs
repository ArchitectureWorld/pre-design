import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {chromium} from 'playwright-core'
import {resolveBrowserExecutable} from '../../../src/report/browser-executable.ts'
import {nativePackageFixture} from './fixtures/native-design-v3-fixture.mjs'
import {samplePages} from '../src/layout-library/validation.mjs'
import {renderNativeDocument} from '../src/layout-library/render.mjs'
test('real Chromium displays native SVG artwork and editable content slots',async()=>{
 const pkg=await nativePackageFixture(),pages=samplePages(pkg)
 const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,chromiumSandbox:process.env.PRE_LAYOUT_TEST_NO_SANDBOX!=='1',args:['--disable-background-networking','--disable-extensions','--no-first-run']})
 try{
  const page=await browser.newPage({viewport:{width:1680,height:1900}})
  await page.route('**/*',route=>route.abort())
  await page.setContent(renderNativeDocument(pages),{waitUntil:'load'})
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()))})
  const result=await page.evaluate(()=>[...document.querySelectorAll('.ln-native-v3')].map(el=>({prototype:el.querySelector('.ln-native-prototype')?.naturalWidth,slots:el.querySelectorAll('[data-layout-slot]').length,title:el.querySelector('.ln-title')?.textContent,renderer:el.dataset.renderer})))
  assert.equal(result.length,2);assert(result.every(r=>r.prototype===1600&&r.slots===5&&r.title&&r.renderer==='pre-design-native-html-v3.0'))
  const root=process.env.PRE_LAYOUT_SCREENSHOTS||'/tmp/pre-design-v3-browser';await mkdir(root,{recursive:true});await page.screenshot({path:join(root,'native-v3-pages.png'),fullPage:true})
 }finally{await browser.close()}
})

test('V3 captions retain opaque validated background over full and partial dark artwork',async()=>{
 const pkg=await nativePackageFixture(),pages=samplePages(pkg).slice(0,1),spec=pages[0].nativeLayout
 spec.theme={...spec.theme,background:'#ffffff',muted:'#222222'}
 const slot=spec.layout.slots.find(s=>s.role==='image'),r=slot.rect
 // The artwork deliberately matches caption ink. An accidentally transparent
 // caption must fail this computed-style regression, not merely pass schema.
 spec.layout.prototypeSvg='<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect x="'+r.x*1600+'" y="'+r.y*900+'" width="'+r.w*1600+'" height="'+r.h*900+'" fill="#222222"/></svg>'
 const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,chromiumSandbox:process.env.PRE_LAYOUT_TEST_NO_SANDBOX!=='1',args:['--disable-background-networking','--disable-extensions','--no-first-run']})
 try{
  const page=await browser.newPage();await page.route('**/*',route=>route.abort())
  for(const scale of [1,.5]){
   if(scale===.5)spec.layout.prototypeSvg=spec.layout.prototypeSvg.replace('width="'+r.w*1600+'"','width="'+r.w*800+'"')
   await page.setContent(renderNativeDocument(pages),{waitUntil:'load'})
   const caption=page.locator('.ln-native-v3 figcaption').first()
   const actual=await caption.evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}))
   assert.deepEqual(actual,{color:'rgb(34, 34, 34)',background:'rgb(255, 255, 255)'})
   await caption.evaluate(el=>el.style.background='transparent')
   assert.notEqual(await caption.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)','negative control detects loss of caption protection')
  }
 }finally{await browser.close()}
})
