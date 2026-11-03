import {chromium} from '@playwright/test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
const config=JSON.parse(await readFile('.local/web/config.json','utf8'))
const project=JSON.parse(await readFile('.cache/web-e2e/project.json','utf8'))
const headers={authorization:`Bearer ${config.users[0].token}`}
const snapshot=async()=> (await fetch(`http://127.0.0.1:4318/api/projects/${project.id}/state`,{headers})).json()
const before=await snapshot()
const browser=await chromium.launch({executablePath:'/home/zetta/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true})
const page=await browser.newPage({viewport:{width:1600,height:1000}})
try{
 await page.goto('http://127.0.0.1:4318');await page.locator('#accessToken').fill(config.users[0].token);await page.getByRole('button',{name:'进入项目空间'}).click()
 await page.locator('#accessDialog').waitFor({state:'detached'});await page.getByRole('button',{name:'打开历史项目 Web 实机验证 · 社区服务中心',exact:true}).click()
 await page.locator('#workspaceStage').waitFor({state:'visible'});await page.locator('.morph-ghost').waitFor({state:'detached'})
 await page.locator('[data-node-id="script-1-1"]').dblclick();await page.locator('#previewQuoteBtn').click();await page.locator('#closePreview').click()
 await page.locator('#chatInput').fill('请在启动原因中补充一句明确的限制：约1200平方米仅为用户提供且未经产权或测绘核验，不构成面积结论；后续须取得权属及测绘资料。保留原有项目条件，只修订 PS01 并提交待确认提案。')
 await page.locator('#chatSubmit').click();await page.waitForFunction(()=>document.querySelector('#annotationCount').textContent==='1')
 const saved=await snapshot();assert.equal(saved.jobs.length,before.jobs.length);assert.equal(saved.annotations.length,before.annotations.length+1)
 await page.locator('#openAnnotationDrawer').click();await page.locator('#batchSubmitBtn').click()
 await page.waitForTimeout(1000);const submitted=await snapshot();assert.equal(submitted.jobs.length,before.jobs.length+1)
 await page.screenshot({path:'.cache/web-e2e/prototype-annotation.png'})
 await writeFile('.cache/web-e2e/annotation-submit.json',JSON.stringify({projectId:project.id,savedWithoutRun:true,annotationId:saved.annotations.at(-1).id,batchId:submitted.jobs.at(-1).id},null,2))
 console.log('PASS: original quote → save annotation (no run) → batch submit (one task)')
}finally{await browser.close()}
