// Opt-in: creates a test project and calls the configured paid model.
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
const url=process.env.PRE_WEB_TEST_URL
const evidence=process.env.PRE_WEB_EVIDENCE
if(!url||!evidence)throw new Error('Set PRE_WEB_TEST_URL and PRE_WEB_EVIDENCE; this test uses the real model')
const projectName=process.env.PRE_WEB_TEST_NAME||'局域网实跑验证·社区阅读空间'
const config=JSON.parse(await readFile('.local/web/config.json','utf8'))
const browser=await chromium.launch({executablePath:'/home/zetta/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-proxy-server']})
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
let project
async function snapshot(){const r=await fetch(`${url}/api/projects/${project.id}/state`,{headers:{authorization:`Bearer ${config.users[0].token}`}});assert.equal(r.status,200);return r.json()}
async function settle(label){
 const deadline=Date.now()+600000
 while(Date.now()<deadline){const s=await snapshot();await writeFile(`${evidence}/state.json`,JSON.stringify(s,null,2));const busy=s.jobs.filter(j=>['queued','running'].includes(j.status));console.log(JSON.stringify({phase:label,revision:s.revision,jobs:s.jobs.map(j=>({kind:j.kind,status:j.status})),proposals:s.core.proposals?.map(p=>({id:p.proposalId,status:p.status}))}));if(!busy.length){assert.ok(s.jobs.length);assert.ok(s.jobs.every(j=>j.status==='completed'),JSON.stringify(s.jobs.map(j=>({status:j.status,error:j.error}))));return s}await new Promise(r=>setTimeout(r,10000))}throw new Error('Real model task exceeded 10 minutes; project retained for inspection')
}
try{
 await page.goto(url);await page.locator('#accessToken').fill(config.users[0].token);await page.getByRole('button',{name:'进入项目空间'}).click();await page.locator('#accessDialog').waitFor({state:'detached'})
 await page.locator('#overviewCreateBtn').click();await page.locator('#projectName').fill(projectName);await page.locator('#createFileInput').setInputFiles(`${evidence}/任务书.txt`)
 const created=page.waitForResponse(r=>r.url()===`${url}/api/projects`&&r.request().method()==='POST',{timeout:90000})
 await page.locator('#createForm button[type="submit"]').click();const response=await created;assert.ok(response.ok());project=await response.json();await writeFile(`${evidence}/project.json`,JSON.stringify(project,null,2));console.log('CREATED '+project.id)
 await page.locator('#consultStage').waitFor({state:'visible',timeout:90000})
 let s=await settle('intake')
 if(!s.core.proposals?.some(p=>p.status==='pending_review')){
  await page.locator('#consultInput').fill('这是授权的模拟验收项目。未提供的信息全部保留为未知或待核查，不追求补齐真实资料。请读取 PS01 精确 Schema，基于已上传材料提交一个 manual human_review/pending_review 的 PS01 草案提案，明确模拟资料及860平方米未核验，不提交后续章节。')
  const sent=page.waitForResponse(r=>r.url().endsWith('/chat')&&r.request().method()==='POST');await page.locator('#consultSend').click();assert.ok((await sent).ok());s=await settle('draft')
 }
 assert.ok(s.core.proposals?.some(p=>p.status==='pending_review'),'Agent must produce an actual proposal')
 const proposal=s.core.proposals.find(p=>p.status==='pending_review');assert.ok(Math.abs(Date.now()-Date.parse(proposal.envelope.created_at))<900000,'proposal creation time must match this run')
 await page.locator('#confirmOutline').click();await page.locator('#workspaceStage').waitFor({state:'visible'});await page.locator('.morph-ghost').waitFor({state:'detached'})
 await page.locator('[data-node-id="script-1-1"]').dblclick();await page.locator('#previewOverlay').waitFor({state:'visible'})
 const preview=await page.locator('#previewSheet').innerText();assert.match(preview,/860/);assert.match(preview,/模拟|测试/);await writeFile(`${evidence}/preview.txt`,preview);await page.screenshot({path:`${evidence}/proposal.png`})
 const confirmation=page.waitForResponse(r=>r.url().endsWith('/confirm')&&r.request().method()==='POST');await page.locator('#scriptApproveBtn').click();assert.ok((await confirmation).ok());s=await settle('confirm');assert.equal(s.revision,1)
 await page.locator('#closePreview').click();await page.screenshot({path:`${evidence}/confirmed.png`})
 await page.reload();await page.getByRole('button',{name:'打开历史项目 '+projectName,exact:true}).click();await page.locator('#workspaceStage').waitFor({state:'visible'});assert.equal((await snapshot()).revision,1);assert.deepEqual(errors,[])
 await writeFile(`${evidence}/result.json`,JSON.stringify({projectId:project.id,url,revision:s.revision,materials:s.materials,errors,confirmed:true,reloaded:true},null,2));console.log('PASS real LAN upload → model → proposal → confirmation → reload')
}catch(error){await page.screenshot({path:`${evidence}/failure.png`});throw error}finally{await browser.close()}
