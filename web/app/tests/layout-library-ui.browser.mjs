import {chromium} from 'playwright-core'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {fullLayoutFixture} from './layout-library/full-fixture.mjs'
import {createPackage} from '../src/layout-library/contract.mjs'
import {resolveBrowserExecutable} from '../../../src/report/browser-executable.ts'
if(!process.env.PRE_DOSSIER_TEST_DATABASE){console.log(JSON.stringify({skipped:true,reason:'需要真实PostgreSQL配置 PRE_DOSSIER_TEST_DATABASE'}));process.exit(0)}
const f=await fullLayoutFixture(),output=resolve(process.env.PRE_LAYOUT_SCREENSHOTS??'/tmp/layout-workbench-evidence');await mkdir(output,{recursive:true})
const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,chromiumSandbox:process.env.PRE_LAYOUT_TEST_NO_SANDBOX!=='1'})
const page=await browser.newPage({viewport:{width:1512,height:982}}),errors=[]
let checks=0
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(token=>sessionStorage.setItem('pre-access',token),f.token)
const wait=fn=>page.waitForFunction(fn,null,{timeout:30000})
try{
 await page.goto(f.url);await page.locator('[data-layout-library-open]').click();await page.locator('[data-layout-chat]').waitFor()
 assert.equal(await page.locator('[data-mode="project"]').count(),0);checks++
 const left=await page.locator('[data-layout-results]').boundingBox(),right=await page.locator('[data-layout-chat]').boundingBox();assert(left.x+left.width<=right.x+2);checks++
 await page.locator('[data-seed]').click();await wait(()=>document.querySelectorAll('[data-resource-card]').length===3)
 await page.locator('[data-chat-file]').setInputFiles({name:'绿色参考.md',mimeType:'text/markdown',buffer:Buffer.from('白色背景，墨绿标题，充足留白，文字清晰。')})
 await wait(()=>document.querySelector('[data-chat-messages]')?.textContent.includes('已生成墨绿色版式'))
 await page.locator('.ll-preview-host [data-layout-slot=title]').waitFor()
 assert.equal(await page.locator('[data-layout-chat] textarea').inputValue(),'');checks++
 assert.equal(await page.locator('.ll-preview-host [data-native-page]').evaluate(el=>el.style.getPropertyValue('--ln-accent')),'#235740');checks++
 const firstConversation=(await f.request('GET','/layout-library/conversations')).conversations[0]
 await page.locator('.ll-preview-host [data-layout-slot=title]').click();assert.match(await page.locator('[data-chat-selection]').innerText(),/标题/);checks++
 await page.locator('[data-layout-message]').fill('标题改成黑色。');await page.locator('[data-layout-send]').click()
 await wait(()=>document.querySelector('[data-chat-messages]')?.textContent.includes('标题已改为黑色'))
 let conversation=await f.request('GET','/layout-library/conversations/'+firstConversation.id)
 assert.equal(conversation.resource.version,2);assert.equal(conversation.resource.package.theme.accent,'#111111');checks++
 await page.locator('.ll-settings summary').first().click();await page.locator('[name=accent]').fill('#2f5f88');await page.locator('[data-save]').click();await wait(()=>document.querySelector('[data-ll-status]')?.textContent.includes('已保存版式'))
 await page.locator('[data-layout-message]').fill('现在用了什么颜色？');await page.locator('[data-layout-send]').click();await wait(()=>document.querySelector('[data-chat-messages]')?.textContent.includes('当前标题采用蓝灰色'))
 conversation=await f.request('GET','/layout-library/conversations/'+firstConversation.id);assert.equal(conversation.resource.version,3);checks++
 await page.locator('[data-close]').click();await page.reload();await page.locator('[data-layout-library-open]').click();await page.locator('[data-list-mode=conversations]').click();await page.locator('[data-conversation="'+firstConversation.id+'"]').click()
 await page.locator('.ll-preview-host').waitFor();assert.equal(await page.locator('[data-layout-turn]').count(),3);checks++
 const calls=f.modelCalls.length,imported=createPackage('右侧导入的原生版式')
 await page.locator('[data-chat-file]').setInputFiles({name:'参考版式.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))})
 await wait(()=>document.querySelector('[data-resource-name]')?.value==='右侧导入的原生版式')
 assert.equal(f.modelCalls.length,calls);checks++
 await page.screenshot({path:resolve(output,'unified-workbench.png')})
 await page.locator('[data-close]').click();await page.getByRole('button',{name:'打开历史项目 '+f.project.name,exact:true}).click();await page.locator('#workspaceStage:not(.workspace-transitioning)').waitFor()
 await page.locator('[data-layout-page=global]').waitFor();assert.equal(await page.locator('[data-node-kind=script] [data-canvas-layout]').count(),2);checks++
 const library=(await f.request('GET','/layout-library')).resources,green=library.find(r=>r.package.name.includes('自然墨绿')),blue=library.find(r=>r.package.name.includes('清晰蓝灰'))
 await page.locator('[data-layout-page=global]').click();await page.locator('[data-pick-style="'+green.id+'"]').click();await wait(()=>document.querySelector('[data-layout-page=global]')?.textContent.includes('自然墨绿'))
 let state=await f.state();assert.equal(state.workflow.visuals.current,null);assert.equal(state.workflow.current.approval,null);checks++
 const firstId='visual-page-'+state.workflow.current.blocks[0].items[0].id,secondId='visual-page-'+state.workflow.current.blocks[1].items[0].id
 await page.locator('[data-layout-close]').click();await page.locator('[data-layout-page="'+firstId+'"]').click();await page.locator('[data-pick-style="'+blue.id+'"]').click();await wait(()=>document.querySelector('[data-layout-status]')?.textContent.includes('已保存'))
 await page.locator('[data-layout-layer]').selectOption('manual');await page.locator('[data-canvas-accent]').fill('#111111');await page.locator('[data-save-page-layout]').click();await wait(()=>document.querySelector('[data-layout-status]')?.textContent.includes('已保存'))
 let bindings=await f.request('GET',f.base+'/layout-bindings');assert.equal(bindings.manual[firstId].theme.accent,'#111111');checks++
 await page.locator('[data-layout-layer]').selectOption('local');await page.locator('[data-reset-page-layout]').click();await wait(()=>document.querySelector('[data-layout-status]')?.textContent.includes('已保存'))
 bindings=await f.request('GET',f.base+'/layout-bindings');assert.equal(bindings.local[firstId],undefined);assert.equal(bindings.manual[firstId].theme.accent,'#111111');checks++
 await page.locator('[data-pick-style="'+blue.id+'"]').dragTo(page.locator('[data-node-kind=script]').nth(1));await wait(()=>document.querySelectorAll('[data-node-kind=script] [data-canvas-layout]')[1]?.textContent.includes('清晰蓝灰'))
 bindings=await f.request('GET',f.base+'/layout-bindings');assert.equal(bindings.local[secondId].resource.resourceId,blue.id);checks++
 await page.screenshot({path:resolve(output,'script-stage-bindings.png')})
 await page.locator('[data-layout-close]').click();await page.locator('[data-workflow-approve]').click();await wait(()=>document.querySelector('[data-workflow-approve]')?.textContent.includes('已确认'))
 await page.locator('[data-layout-page=global]').click();await page.locator('[data-apply-layout]').click();await wait(()=>document.querySelectorAll('[data-node-kind=artifact]').length===2)
 state=await f.state();assert.equal(state.workflow.visuals.current.pages.length,2);assert.equal(state.workflow.visuals.current.pages[0].nativeLayout.theme.accent,'#111111');checks++
 assert.equal(await page.locator('[data-layout-page="'+firstId+'"]').count(),2);checks++
 await page.locator('[data-layout-close]').click();await page.locator('[data-node-kind=artifact] [data-layout-page="'+firstId+'"]').click();await page.locator('[data-save-layout-variant]').click();await page.locator('[data-variant-name]').fill('从画布保存的版式');await page.locator('[data-variant-save]').click();await page.locator('[data-layout-library]').waitFor();await wait(()=>document.querySelector('[data-resource-name]')?.value==='从画布保存的版式');checks++
 assert.deepEqual(errors,[]);checks++
 console.log(JSON.stringify({checks,passed:true,transport:'真实HTTP / Fastify / PostgreSQL / Chromium，模型为受控替身',database:'postgresql',screenshots:output},null,2))
}finally{await browser.close();await f.close()}
