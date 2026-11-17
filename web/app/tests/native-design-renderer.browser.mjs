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
