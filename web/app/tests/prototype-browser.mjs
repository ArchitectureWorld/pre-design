import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
const config = JSON.parse(await readFile('.local/web/config.json','utf8'))
const evidence = '.cache/web-e2e'
const browser = await chromium.launch({executablePath:'/home/zetta/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true})
const page = await browser.newPage({viewport:{width:1600,height:1000}})
const errors=[];page.on('pageerror',e=>errors.push(e.message))
try {
 await page.goto('http://127.0.0.1:4318')
 await page.locator('#accessToken').fill(config.users[0].token)
 await page.getByRole('button',{name:'进入项目空间'}).click()
 await page.locator('#accessDialog').waitFor({state:'detached'})
 await page.screenshot({path:`${evidence}/prototype-overview.png`})
 await page.getByRole('button',{name:'打开历史项目 Web 实机验证 · 社区服务中心',exact:true}).click()
 await page.locator('#workspaceStage').waitFor({state:'visible'})
 await page.locator('.morph-ghost').waitFor({state:'detached'})
 await page.locator('[data-node-id="script-1-1"]').dblclick()
 await page.locator('#previewOverlay').waitFor({state:'visible'})
 await page.screenshot({path:`${evidence}/prototype-proposal.png`})
 assert.ok(await page.locator('#previewSheet').innerText().then(t=>t.includes('社区服务中心')))
 if(await page.locator('#scriptApproveBtn').isEnabled()) await page.locator('#scriptApproveBtn').click()
 await page.waitForTimeout(1000)
 await page.screenshot({path:`${evidence}/prototype-workspace.png`})
 assert.deepEqual(errors,[])
 await writeFile(`${evidence}/prototype-browser.json`,JSON.stringify({errors,originalPrototype:'web/index.html',confirmed:true},null,2))
 console.log('PASS: original prototype overview, graph, proposal preview and confirmation; no browser errors')
} catch(error) {await page.screenshot({path:`${evidence}/prototype-failure.png`});throw error} finally {await browser.close()}
