import {chromium} from 'playwright-core'
import {readFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
import {libraryFixture} from './layout-library/fixture.mjs'
import {createPackage} from '../src/layout-library/contract.mjs'
import {randomUUID} from 'node:crypto'
const f=await libraryFixture(),output=resolve(process.env.PRE_LAYOUT_SCREENSHOTS??'/tmp/layout-library-ui-evidence');await mkdir(output,{recursive:true})
const browser=await chromium.launch({executablePath:process.env.PREPLANNING_BROWSER_EXECUTABLE??'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']})
let checks=0,actor='owner',referenceJobs=[]
const referenceCalls=[]
const referenceListGate=Promise.withResolvers()
try{
 const pkg=createPackage('界面测试 · 蓝灰');pkg.theme.background='#F7F9FC'
 const created=(await f.request('POST','/api/layout-library',{requestId:randomUUID(),package:pkg})).json()
 const base=`/api/layout-library/${created.id}/1`
 let r=await f.request('POST',base+'/validate',{});assert.equal(r.json().status,'passed');checks++
 r=await f.request('POST',base+'/publish',{requestId:randomUUID(),visibility:'private',reviewed:true});assert.equal(r.statusCode,200);checks++
 const page=await browser.newPage({viewport:{width:1366,height:768},deviceScaleFactor:1})
 page.setDefaultTimeout(6000);page.on('console',m=>console.log('BROWSER',m.text()));
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 const css=await readFile(new URL('../src/layout-library/ui.css',import.meta.url),'utf8'),script=await readFile(new URL('../src/layout-library/ui.js',import.meta.url),'utf8')
 await page.setContent(`<html lang="zh-CN"><style>${css}body{background:#eef2f8;font-family:sans-serif}.top-right{display:flex;justify-content:flex-end}</style><body><div class="top-right"></div><h1>Pre-design 集成工作台 · 隔离测试</h1></body></html>`)
 await page.exposeFunction('bridge',async(path,options={})=>{
  if(path==='/me')return {id:actor,role:actor==='admin'?'admin':'user'}
  if(path==='/layout-library/reference-config')return {configured:true,modelName:'平台测试模型',policyRevision:3}
  if(path==='/layout-library/reference-jobs'){
   if(options.method==='POST'){
    referenceCalls.push(options.body)
    referenceJobs=[{id:'reference-ui-test',name:options.body.name,status:'failed',modelName:'平台测试模型',error:'模型服务超时（HTTP 504），可重试。',progress:{stage:'failed'},created_at:new Date().toISOString()}]
    return {id:'reference-ui-test',status:'queued'}
   }
   await referenceListGate.promise
   return referenceJobs
  }
  if(path==='/layout-library/reference-jobs/reference-ui-test/retry'){referenceCalls.push({retry:options.body});return {id:'reference-ui-test',status:'queued'}}
  const r=await f.request(options.method??'GET','/api'+path,options.body,actor)
  if(r.statusCode>=400){console.log('API FAIL',path,r.statusCode,r.body);throw new Error(r.json().error)}
  return r.json()
 })
 await page.exposeFunction('projectState',async()=>({id:f.p.id,name:'版式集成验收',revision:0,workflow:await f.workflows.current()}))
 await page.addScriptTag({content:script.replace('export function mountLayoutLibrary','window.mountLayoutLibrary = function')})
 await page.evaluate(async()=>{window.fp=await window.projectState();window.messages=[];window.ll=mountLayoutLibrary({request:window.bridge,getProject:()=>window.fp,notify:t=>messages.push(t),refresh:async()=>window.fp=await window.projectState(),mutate:async(path,b)=>{const r=await bridge(`/projects/${fp.id}/${path}`,{method:'POST',body:{requestId:Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join(''),baseRevision:0,...b}});window.fp=await window.projectState();return r}})})
 await page.locator('[data-layout-library-open]').click();await page.locator('[data-editor]').waitFor().catch(async error=>{console.log('LAYOUT_DIAGNOSTIC',JSON.stringify({status:await page.locator('[data-ll-status]').textContent().catch(()=>null),detail:(await page.locator('[data-detail]').innerHTML().catch(()=>'' )).slice(0,1000),diagnostic:await page.evaluate(()=>({open:document.querySelector('[data-layout-library-open]')?.outerHTML,dialogs:[...document.querySelectorAll('dialog')].map(x=>x.outerHTML.slice(0,900)),bodyEnd:document.body.innerHTML.slice(-1800),messages:window.messages})),errors}));throw error});await page.waitForTimeout(250)
 assert.equal(await page.locator('.ll-card').count(),1);checks++
 assert.equal(await page.locator('[data-seed]').isVisible(),false);checks++
 // PostgreSQL JSONB reorders object fields. Opening a saved resource must not
 // make its rights fields or equivalent colour spelling look edited.
 await page.locator('.ll-preview-host').waitFor()
 await page.locator('[data-validate]').click()
 await page.waitForFunction(()=>/检查通过|请先保存/.test(document.querySelector('[data-ll-status]').textContent),null,{timeout:20000})
 assert.match(await page.locator('[data-ll-status]').innerText(),/检查通过/);checks++
 await page.screenshot({path:resolve(output,'library-1366x768.png')})
 await page.locator('[data-mode="project"]').click();await page.locator('[data-bind]').waitFor()
 await page.locator('[data-bind]').click();await page.waitForFunction(()=>document.querySelector('[data-ll-status]').textContent.includes('配置已保存'))
 assert.equal((await f.library.bindings(f.p)).revision,1);checks++
 await page.locator('[data-apply]').click();await page.waitForFunction(()=>document.querySelector('[data-ll-status]').textContent.includes('新成果已生成'),{timeout:20000})
 let deck=(await f.visuals.current(f.p,f.draft)).current;assert.equal(deck.layoutBindingRevision,1);checks++
 await page.locator('[data-scope]').selectOption('manual');await page.locator('.ll-pages input').first().check();await page.locator('[data-local-color]').fill('#111111');await page.locator('[data-bind]').click();await page.waitForFunction(()=>document.querySelector('[data-ll-status]').textContent.includes('配置已保存'))
 await page.locator('[data-apply]').click();await page.waitForFunction(()=>document.querySelector('[data-ll-status]').textContent.includes('新成果已生成'),{timeout:20000})
 deck=(await f.visuals.current(f.p,f.draft)).current;assert.equal(deck.pages[0].nativeLayout.theme.accent,'#111111');checks++
 await page.screenshot({path:resolve(output,'bindings-1366x768.png')})
 await page.locator('[data-variant-name]').fill('界面保存的可复用页');await page.locator('[data-variant]').click();await page.waitForFunction(()=>document.querySelector('[data-ll-status]').textContent.includes('纯版式候选'))
 assert.equal((await f.library.list({id:'owner',role:'user'})).length,2);checks++
 // Developer entry works without any project, and uses the exact same API/store/renderer.
 await page.evaluate(()=>{ll.reset();window.fp=null});actor='admin';await page.locator('[data-layout-library-open]').click();await page.locator('[data-seed]').waitFor();await page.locator('[data-seed]').click();await page.waitForFunction(()=>document.querySelector('[data-ll-status]').textContent.includes('预置3套'))
 assert.equal((await f.library.list({id:'admin',role:'admin'})).filter(r=>r.package.source.kind==='built-in').length,3);checks++
 await page.locator('.ll-card').filter({hasText:'自然墨绿'}).click();await page.locator('[data-editor]').waitFor();await page.waitForTimeout(200)
 await page.screenshot({path:resolve(output,'developer-1366x768.png')})
 for(const width of [1024,1512]){await page.setViewportSize({width,height:768});await page.waitForTimeout(100);assert(await page.locator('[data-close]').isVisible());checks++;await page.screenshot({path:resolve(output,`developer-${width}x768.png`)})}
 await page.locator('[data-new]').click()
 await page.locator('[data-ref-text]').waitFor()
 assert.equal(await page.locator('[data-mode=reference]').innerText(),'自定义版式');checks++
 await page.waitForFunction(()=>document.querySelector('[data-ref-model]')?.textContent.includes('平台测试模型'));checks++
 const referenceText='白色背景、墨绿色标题，正文30px，引用区放在底部。保留清晰的双栏对照布局。'
 await page.locator('[data-ref-file]').setInputFiles({name:'参考设计.md',mimeType:'text/markdown',buffer:Buffer.from(referenceText)})
 await page.waitForFunction(t=>document.querySelector('[data-ref-text]').value===t,referenceText)
 assert.equal(await page.locator('[data-ref-name]').inputValue(),'参考设计');assert.equal(referenceCalls.length,0);checks++
 await page.locator('[data-ref-run]').click()
 for(let i=0;i<20&&!referenceCalls.length;i++)await new Promise(resolve=>setTimeout(resolve,25))
 assert.equal(referenceCalls.length,1,'历史记录加载时仍应能提交自定义要求')
 referenceListGate.resolve()
 await page.waitForFunction(()=>document.querySelector('[data-ref-jobs]')?.textContent.includes('504'))
 assert.equal(referenceCalls[0].text,referenceText);assert.equal(referenceCalls[0].allowModel,true)
 assert.equal(await page.locator('[data-allow-model]').count(),0);checks++
 await page.locator('[data-retry-job]').click();await page.waitForTimeout(100);assert(referenceCalls.at(-1).retry);checks++
 await page.locator('[data-manual]').click();await page.locator('[data-editor]').waitFor()
 await page.locator('[name=name]').fill('手动自定义版式');await page.locator('[name=accent]').fill('#235740')
 await page.locator('[data-save]').click();await page.waitForFunction(()=>document.querySelector('[data-ll-status]')?.textContent.includes('保存'))
 const custom=(await f.library.list({id:'admin',role:'admin'})).find(r=>r.package.name==='手动自定义版式')
 assert(custom);assert.equal(custom.package.theme.accent,'#235740');assert.equal(custom.visibility,'private');checks++
 await page.screenshot({path:resolve(output,'custom-layout.png')})
 assert.deepEqual(errors,[]);checks++
 console.log(JSON.stringify({checks,passed:true,transport:'Fastify inject bridge (no production HTTP/LLM)',database:f.databaseEngine,screenshots:output},null,2))
}finally{referenceListGate.resolve();await browser.close();await f.close()}
