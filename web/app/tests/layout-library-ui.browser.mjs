import {chromium} from 'playwright-core'
import {readFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
import {libraryFixture} from './layout-library/fixture.mjs'
import {createPackage} from '../src/layout-library/contract.mjs'
import {randomUUID} from 'node:crypto'
const f=await libraryFixture(),output=resolve(process.env.PRE_LAYOUT_SCREENSHOTS??'/tmp/layout-library-ui-evidence');await mkdir(output,{recursive:true})
const browser=await chromium.launch({executablePath:process.env.PREPLANNING_BROWSER_EXECUTABLE??'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']})
let checks=0,actor='owner'
try{
 const pkg=createPackage('界面测试 · 蓝灰'),created=(await f.request('POST','/api/layout-library',{requestId:randomUUID(),package:pkg})).json()
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
 assert.deepEqual(errors,[]);checks++
 console.log(JSON.stringify({checks,passed:true,transport:'Fastify inject bridge (no production HTTP/LLM)',database:'SQLite persistence adapter',screenshots:output},null,2))
}finally{await browser.close();await f.close()}
