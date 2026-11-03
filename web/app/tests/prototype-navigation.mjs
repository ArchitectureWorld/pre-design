import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
const config=JSON.parse(await readFile('.local/web/config.json','utf8'))
const browser=await chromium.launch({executablePath:'/home/zetta/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true})
const page=await browser.newPage({viewport:{width:1600,height:1000}})
const errors=[];page.on('pageerror',e=>errors.push(e.message))
try{
 await page.goto('http://127.0.0.1:4318');await page.locator('#accessToken').fill(config.users[0].token);await page.getByRole('button',{name:'进入项目空间'}).click();await page.locator('#accessDialog').waitFor({state:'detached'})
 await page.locator('#overviewCreateBtn').click();await page.locator('#entryStage').waitFor({state:'visible'});await page.screenshot({path:'.cache/web-e2e/prototype-create.png'});await page.locator('#createBackOverview').click()
 let release,intercepted;const waiting=new Promise(r=>intercepted=r);const gate=new Promise(r=>release=r)
 await page.route('**/api/projects/*/state',async route=>{intercepted();await gate;await route.continue()},{times:1})
 await page.getByRole('button',{name:'打开历史项目 Web 实机验证 · 社区服务中心',exact:true}).click();await waiting
 await page.locator('.brand-label').click();release();await page.waitForTimeout(1200)
 assert.ok(await page.locator('#overviewStage').isVisible(),'late state must not navigate back to workspace')
 await page.getByRole('button',{name:'打开历史项目 Web 实机验证 · 社区服务中心',exact:true}).click();await page.locator('#workspaceStage').waitFor({state:'visible'});await page.locator('.morph-ghost').waitFor({state:'detached'})
 await page.locator('#themeBtn').click();assert.ok(await page.locator('body').evaluate(el=>el.classList.contains('theme-dark')));await page.locator('#themeBtn').click()
 await page.locator('#visualExpandedBtn').click();await page.locator('#visualGroupedBtn').click();await page.locator('#openAnnotationDrawer').click();await page.locator('#annotationHistoryBtn').click();assert.ok((await page.locator('#annotationList').innerText()).includes('已完成'));await page.locator('#closeAnnotationDrawer').click()
 await page.screenshot({path:'.cache/web-e2e/prototype-final.png'});assert.deepEqual(errors,[])
 console.log('PASS: original create form, delayed navigation, reopen, themes, grouped/expanded layout and annotation history')
}finally{await browser.close()}
