import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright-core'
import {fullLayoutFixture} from './layout-library/full-fixture.mjs'
import {compositionPackage} from './fixtures/composition.mjs'
import {pdf} from './fixtures/reference-pdf.mjs'
import {resolveBrowserExecutable} from '../../../src/report/browser-executable.ts'

assert(process.env.PRE_DOSSIER_TEST_DATABASE,'真实对照验收需要隔离 PostgreSQL 配置')
const f=await fullLayoutFixture(),out=resolve(process.env.PRE_LAYOUT_SCREENSHOTS??'/tmp/layout-reference-review-evidence')
await mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,chromiumSandbox:process.env.PRE_LAYOUT_TEST_NO_SANDBOX!=='1'})
const page=await browser.newPage({viewport:{width:1512,height:982}}),errors=[]
page.setDefaultTimeout(45000);page.on('pageerror',error=>errors.push(error.message))
await page.addInitScript(token=>sessionStorage.setItem('pre-access',token),f.token)
let checks=0
try{
 const source=await f.request('POST','/layout-library/reference-files',{requestId:randomUUID(),filename:'合成对照参考.pdf',content:pdf([{text:'SYNTHETIC COVER'},{text:'SYNTHETIC ANALYSIS PAGE'},{text:'SYNTHETIC FINAL PAGE'}]).toString('base64')})
 const pkg=compositionPackage()
 pkg.layouts.push({...structuredClone(pkg.layouts[0]),id:'mixed-second',label:'第二种组合页面'})
 pkg.designProfile.evidence=[{id:'evidence-1',provenance:'observed',fileSha256:source.sha256,pageNumber:2,factId:'synthetic-page-2'}]
 const saved=await f.request('POST','/layout-library',{requestId:randomUUID(),package:pkg}),base='/layout-library/'+saved.id+'/1'
 await page.goto(f.url);await page.locator('[data-layout-library-open]').click();await page.locator('[data-resource-card="'+saved.id+'"]').click()
 await page.locator('[data-reference-review]').click()
 await page.waitForFunction(()=>document.querySelector('[data-review-status]')?.textContent.includes('页面检查通过'),null,{timeout:90000})
 assert.match(await page.locator('[data-source-title]').innerText(),/第 2 页/);checks++
 await page.locator('[data-review-source] img').evaluate(image=>image.decode())
 assert(await page.locator('[data-review-source] img').evaluate(image=>image.naturalWidth>0&&image.naturalHeight>0));checks++
 const article=page.locator('[data-review-prototype] [data-native-page]')
 assert.equal(await article.locator('img').count(),2)
 assert.equal(await article.locator('table').count(),1)
 assert.match(await article.innerText(),/合成/);checks++
 const geometry=await page.locator('.ll-review-pair').evaluate(pair=>{
  const [left,right]=[...pair.children].map(element=>element.getBoundingClientRect()),host=pair.querySelector('.ll-preview-host'),canvas=host.shadowRoot.querySelector('[data-native-page]')
  return {sideBySide:left.right<=right.left+2,canvasWidth:Number(canvas.dataset.canvasWidth),canvasHeight:Number(canvas.dataset.canvasHeight),scrollOverflow:pair.scrollWidth>pair.clientWidth+2}
 })
 assert.deepEqual(geometry,{sideBySide:true,canvasWidth:1200,canvasHeight:1000,scrollOverflow:false});checks++
 await page.locator('[data-review-accepted]').check();assert(await page.locator('[data-review-confirm]').isDisabled());checks++
 await page.locator('[data-review-layout]').selectOption('mixed-second')
 await page.waitForFunction(()=>document.querySelector('[data-review-count]')?.textContent==='2 / 2 已查看')
 assert.equal(await page.locator('[data-review-confirm]').isDisabled(),false);checks++
 await page.screenshot({path:resolve(out,'reference-and-composition.png')})
 await page.locator('[data-review-confirm]').click();await page.locator('.ll-review-dialog').waitFor({state:'detached'})
 const confirmed=await f.request('GET',base)
 assert.equal(confirmed.referenceReview.status,'confirmed');assert.equal(confirmed.referenceReview.layoutIds.length,2);checks++
 await f.request('POST',base+'/validate',{})
 assert.equal((await f.request('GET',base)).referenceReview.status,'stale');checks++
 assert.deepEqual(errors,[]);checks++
 console.log(JSON.stringify({checks,passed:true,transport:'真实HTTP / PostgreSQL / Chromium / PDF原页；合成内容，未调用远程模型',screenshots:out},null,2))
}finally{await browser.close();await f.close()}
