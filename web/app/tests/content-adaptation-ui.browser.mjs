import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {chromium} from 'playwright-core'
import {resolveBrowserExecutable} from '../../../src/report/browser-executable.ts'
const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true})
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}})
 const modules={};for(const f of ['content-adaptation-ui.js','preview-ui.js'])modules[f]=await readFile(new URL('../src/layout-library/'+f,import.meta.url),'utf8')
 await page.route('http://fit.test/**',route=>{const file=new URL(route.request().url()).pathname.slice(1);return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':'text/html',body:modules[file]??'<html><body></body></html>'})});await page.goto('http://fit.test/')
 await page.addStyleTag({content:await readFile(new URL('../src/layout-library/ui.css',import.meta.url),'utf8')})
 await page.evaluate(async()=>{
 const {openContentAdaptation}=await import('/content-adaptation-ui.js');window.calls=[];window.saved=[];window.drafts=[];window.fail=false
 const html='<style>.native-deck{width:1600px;height:900px;background:white;color:black}</style><div class="native-deck" data-canvas-width="1600" data-canvas-height="900">完整试排正文</div>'
 window.openFit=()=>openContentAdaptation({document,resource:{id:'r',version:1,hash:'hash'},layout:{id:'l',slots:[{id:'s',role:'text',binding:'body'}],contentAdaptationPolicy:{version:1,activation:'explicit-preview-only',entries:[{slotId:'s',directions:['down']}]}},initialDraft:window.drafts.at(-1),onDraft:d=>window.drafts.push(d),onSaved:r=>window.saved.push(r),request:async(path,options)=>{window.calls.push({path,body:options.body});if(path.endsWith('preview'))return{previewId:'p',resourceId:'r',sourceVersion:1,sourceHash:'hash',expiresAt:Date.now()+60000,beforeHtml:html,afterHtml:html,changes:[],qa:{pages:1,issues:[]}};if(window.fail)throw Object.assign(Error('版本冲突'),{status:409});return{id:'r',version:2}}});window.handle=window.openFit()
 })
 await page.locator('[data-fit-title]').fill('标题');await page.locator('[data-fit-text]').fill('完整正文');await page.locator('[data-fit-direction]').selectOption('down');await page.locator('[data-fit-preview]').click();await page.locator('[data-fit-before] .ll-preview-host').waitFor();assert.equal(await page.locator('[data-fit-save]').isDisabled(),true)
 await page.locator('[data-fit-reviewed]').check();assert.equal(await page.locator('[data-fit-save]').isEnabled(),true)
 await page.locator('[data-fit-text]').fill('新的完整正文');assert.equal(await page.locator('[data-fit-save]').isDisabled(),true)
 await page.locator('[data-fit-preview]').click();await page.locator('[data-fit-reviewed]').check();await page.evaluate(()=>window.fail=true);await page.locator('[data-fit-save]').click();await page.getByText('版本冲突；试排文字已保留。',{exact:true}).waitFor();assert.equal(await page.locator('[data-fit-save]').isDisabled(),true);assert.equal(await page.locator('[data-fit-text]').inputValue(),'新的完整正文')
 await page.locator('[data-fit-close]').click();await page.evaluate(()=>window.handle=window.openFit());assert.equal(await page.locator('[data-fit-text]').inputValue(),'新的完整正文');assert.equal(await page.locator('[data-fit-save]').isDisabled(),true)
 await page.evaluate(()=>window.fail=false);await page.locator('[data-fit-preview]').click();await page.locator('[data-fit-reviewed]').check();await page.locator('[data-fit-save]').click();await page.getByText('已保存 V2，原版 V1 保留。',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.saved),[{id:'r',version:2}]);assert.equal(await page.evaluate(()=>window.calls.some(c=>'measurements'in c.body||'rect'in c.body)),false)
 console.log('PASS: explicit review, draft invalidation, conflict, reopen preservation, new-version confirmation; mock API only')
}finally{await browser.close()}
