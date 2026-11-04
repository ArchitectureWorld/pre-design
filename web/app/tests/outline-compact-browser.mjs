// Browser interaction/geometry test, no user project or model mutations.
import {chromium} from '@playwright/test'
import Fastify from 'fastify'
import serveStatic from '@fastify/static'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
import {draft} from './fixtures/outline.mjs'
const app=Fastify(),dist=resolve(process.env.PRE_WEB_BUILD_DIR||'web/app/dist'),value=draft();value.questions=[]
await app.register(serveStatic,{root:dist})
const original=await readFile(resolve(dist,'index.html'),'utf8')
const pageHtml=original.replace('<script type="module" src="/prototype.js"></script>',`<script type="module">
import {mountFlowEditor} from '/outline-flow.js';import {mountOutlineAgent} from '/outline-agent.js';
const draft=${JSON.stringify(value)};const outline={version:1,status:'draft',flow:['03','04','11','01','02','05','06','07'],flowReviewed:false,draft,waivers:[]};
const agent=mountOutlineAgent(document.querySelector('.consult-bottom'),{input:document.querySelector('#consultInput'),sendButton:document.querySelector('#consultSend'),onCancel(){},onMode(){}});agent.update({projectId:'compact-fixture',jobs:[],connection:'live',mode:'chat'});
window.mutations=[];window.resetFlow=(ids)=>{window.editor?.destroy();outline.flow=ids;sessionStorage.clear();window.editor=mountFlowEditor(document.querySelector('#consultStream'),{projectId:'compact-fixture',outline,materials:[],onSubmit:flow=>window.mutations.push(flow),onAnswer(){},onDecision(){},onUpload(){},onChange:()=>document.querySelector('.consult-card').classList.toggle('flow-editing',document.querySelector('[data-flow-pane="flow"]')?.hidden===false)});document.querySelector('.consult-card').classList.add('flow-editing')};
for(const stage of document.querySelectorAll('.stage'))stage.classList.add('hidden');document.querySelector('#consultStage').classList.remove('hidden');window.resetFlow(outline.flow);
</script>`)
app.get('/test',(_,reply)=>reply.type('text/html').send(pageHtml));await app.listen({host:'127.0.0.1',port:0})
const browser=await chromium.launch({executablePath:'/home/zetta/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:['--no-proxy-server']}),page=await browser.newPage({viewport:{width:1552,height:1052}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});await mkdir('.cache/compact-flow',{recursive:true})
const order=()=>page.locator('[data-flow-zone="selected"] [data-flow-node]').evaluateAll(ns=>ns.map(n=>n.dataset.flowNode))
async function sameScreen(){const geometry=await page.evaluate(()=>{const viewport=document.querySelector('#consultStream').getBoundingClientRect();return {viewport:{top:viewport.top,bottom:viewport.bottom},cards:[...document.querySelectorAll('[data-flow-node]')].map(n=>{const r=n.getBoundingClientRect();return {id:n.dataset.flowNode,top:r.top,bottom:r.bottom}})}});for(const c of geometry.cards){assert.ok(c.top>=geometry.viewport.top-1,JSON.stringify(c));assert.ok(c.bottom<=geometry.viewport.bottom+1,JSON.stringify({c,viewport:geometry.viewport}))}}
async function startDrag(id){const box=await page.locator(`[data-flow-node="${id}"]`).boundingBox();await page.mouse.move(box.x+12,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+30,box.y+box.height/2,{steps:5})}
async function dragBefore(source,target){const locator=page.locator(`[data-flow-node="${target}"]`),r=await locator.boundingBox(),direction=await locator.evaluate(n=>Number(n.closest('.flow-step').dataset.flowDirection));await page.locator(`[data-flow-node="${source}"]`).dragTo(locator,{targetPosition:{x:direction===1?8:r.width-8,y:r.height/2}})}
try{
 await page.goto(`http://127.0.0.1:${app.server.address().port}/test`);await page.locator('[data-flow-node="03"]').waitFor();await page.waitForTimeout(400)
 await sameScreen();await page.screenshot({path:'.cache/compact-flow/eight-chapters.png'})
 const positions=await page.locator('.flow-step').evaluateAll(ns=>ns.map(n=>({x:n.offsetLeft,y:n.offsetTop})))
 assert.ok(positions[0].x<positions[1].x&&positions[1].x<positions[2].x&&positions[0].y===positions[2].y,'first row goes right')
 assert.ok(positions[3].x>positions[4].x&&positions[4].x>positions[5].x&&positions[3].y===positions[5].y,'second row returns left')
 assert.ok(positions[3].y>positions[2].y);assert.equal(await page.locator('[data-flow-connector]').count(),7)
 const before=await order();await startDrag('08');let target=await page.locator('[data-flow-node="04"]').boundingBox();await page.mouse.move(target.x+55,target.y+3,{steps:12});await page.waitForTimeout(180)
 assert.equal(await page.locator('[data-flow-zone="selected"].is-drop-target').count(),1)
 assert.equal(await page.locator('[data-flow-drop-indicator]:visible').count(),1)
 assert.deepEqual(await order(),before,'hover must not commit')
 await page.screenshot({path:'.cache/compact-flow/drop-preview.png',timeout:8000});await page.mouse.up();await page.waitForTimeout(100);assert.deepEqual(await order(),['03','08','04','11','01','02','05','06','07'])
 assert.equal(await page.locator('[data-flow-node="08"].is-just-moved').count(),1)
 await page.locator('[data-flow-node="03"]').dragTo(page.locator('[data-flow-library-drop]'))
 assert.ok(!(await order()).includes('03'));assert.equal(await page.locator('[data-flow-zone="library"] [data-flow-node="03"]').count(),1)
 await page.waitForTimeout(300);const current=await order();await startDrag('07');target=await page.locator('[data-flow-node="08"]').boundingBox();await page.mouse.move(target.x+55,target.y+3,{steps:10});await page.waitForTimeout(130);assert.equal(await page.locator('[data-flow-drop-indicator]:visible').count(),1);await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await order(),current)
 assert.equal(await page.locator('.is-drop-target').count(),0)
 await startDrag('07');await page.mouse.move(8,8,{steps:12});await page.waitForTimeout(80);assert.equal(await page.locator('.is-drop-target').count(),0);await page.mouse.up();assert.deepEqual(await order(),current)
 await page.evaluate(()=>window.resetFlow(['01','02','03','04','05','06','07','08']))
 await dragBefore('09','05');assert.deepEqual(await order(),['01','02','03','04','09','05','06','07','08'],'reserve insertion in reversed row')
 await page.waitForTimeout(300);await dragBefore('08','04');assert.deepEqual(await order(),['01','02','03','08','04','09','05','06','07'],'selected chapter crosses turn into reversed row')
 await page.waitForTimeout(300);await dragBefore('09','02');assert.deepEqual(await order(),['01','09','02','03','08','04','05','06','07'],'moving back from reversed row')
 await page.locator('[data-flow-detail="09"]').click();await page.evaluate(()=>window.editor.updateBusy(true));assert.equal(await page.locator('[data-flow-inspector="task"]').isVisible(),true);assert.equal(await page.locator('[data-flow-submit]').isDisabled(),true);await page.evaluate(()=>window.editor.updateBusy(false));await page.locator('[data-flow-inspector="task"] [data-flow-close]').click()
 await page.setViewportSize({width:950,height:1052});await page.waitForFunction(()=>document.querySelector('.flow-track').style.getPropertyValue('--flow-columns')==='2');assert.equal(await page.locator('.flow-step').nth(2).evaluate(n=>n.dataset.flowDirection),'-1','two-column layout recalculates on resize');assert.equal(await page.locator('[data-flow-connector]').count(),8)
 for(const viewport of [{width:1552,height:1052},{width:1280,height:900}]){await page.setViewportSize(viewport);for(const ids of [Array.from({length:11},(_,i)=>String(i+1).padStart(2,'0')),['01']]){await page.evaluate(ids=>window.resetFlow(ids),ids);await sameScreen()}}
 await page.screenshot({path:'.cache/compact-flow/ten-reserve.png'});assert.deepEqual(await page.evaluate(()=>window.mutations),[]);assert.deepEqual(errors,[])
 await writeFile('.cache/compact-flow/report.json',JSON.stringify({sameScreen:'8/11 selected and 10 reserve at 1552x1052/1280x900',serpentine:true,responsiveColumns:true,reverseRowReorder:true,dragIn:true,dragOut:true,insertPreview:true,cancelPreservesOrder:true,busyPreservesDialog:true,projectMutations:0,errors},null,2));console.log('PASS serpentine geometry, reverse-row drag-in/out/reorder, live insertion, cancel and no mutations')
}finally{await browser.close();await app.close()}
