// Real browser/API/database; model replaced only inside this isolated test schema.
import {chromium} from '@playwright/test'
import serveStatic from '@fastify/static'
import pg from 'pg'
import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,relative} from 'node:path'
import assert from 'node:assert/strict'
import {createApp} from '../src/server.mjs'
import {draft,readFixture} from './fixtures/outline.mjs'
const connection={host:'/tmp/pre-design-pg-1000',port:55439,database:'pre_design_web',user:'zetta'},pool=new pg.Pool(connection),schema='outline_browser_'+randomUUID().replaceAll('-','')
await pool.query(`CREATE SCHEMA ${schema}`)
const db=new pg.Pool({...connection,options:`-c search_path=${schema}`}),root=await mkdtemp(join(tmpdir(),'outline-browser-')),contexts=new Map(),calls=[]
const token=randomUUID()+randomUUID(),users=[{id:'test',role:'admin',token}]
let sequence=0
const workers={async call(p,b){if(b.operation==='create')contexts.set(p.id,{project:{projectId:p.id,currentRevision:0},proposals:[],stateObjects:[]});return contexts.get(p.id)},async run(p,text){calls.push({readOnly:p.read_only,text});const files=(await db.query('SELECT * FROM materials WHERE project_id=$1',[p.id])).rows;const value=draft(files[0].id);++sequence;for(const c of value.chapters)if(!['01','03','06'].includes(c.id)){c.disposition='defer';c.readiness='blocked'};return{response:JSON.stringify(value),materialReads:[readFixture({...files[0],sourceRelativePath:relative(p.workspace,files[0].path)})]}},async closeAll(){}}
const app=await createApp({db,workers,projectsRoot:root,users});await app.register(serveStatic,{root:resolve(process.env.PRE_WEB_BUILD_DIR||'web/app/dist')})
await app.listen({host:'127.0.0.1',port:0});const base=app.server.address(),url=`http://127.0.0.1:${base.port}`,headers={authorization:`Bearer ${token}`}
const policy=(await app.inject({url:'/api/admin/models',headers})).json(),model=policy.models.find(m=>m.provider==='SenseNova'&&m.model==='sensenova-6.8-flash-lite');model.status='verified';model.capabilities.tools=true
await app.inject({method:'PUT',url:'/api/admin/models',headers,payload:{expectedRevision:policy.revision,policy}})
const browser=await chromium.launch({executablePath:'/home/zetta/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-proxy-server']}),page=await browser.newPage({viewport:{width:954,height:1052}}),errors=[]
page.on('pageerror',e=>errors.push(e.message));const evidence=resolve('.cache/outline-browser');await mkdir(evidence,{recursive:true})
try{
 await page.goto(url);await page.locator('#accessToken').fill(token);await page.getByRole('button',{name:'进入项目空间'}).click();await page.locator('#accessDialog').waitFor({state:'detached'})
 await page.locator('#overviewCreateBtn').click();await page.locator('#projectName').fill('章节流程浏览器验收')
 await page.locator('#createFileInput').setInputFiles([{name:'任务书.txt',mimeType:'text/plain',buffer:Buffer.from('湖北武汉项目，目标尚需明确。')},{name:'待转换.DWG',mimeType:'application/octet-stream',buffer:Buffer.from('AC1027')}])
 assert.match(await page.locator('.cad-replacement-list').textContent(),/待转换.DWG/)
 assert.match(await page.locator('#uploadReadiness').textContent(),/已添加 1 份/)
 await page.locator('#createForm button[type="submit"]').click()
 const flow=()=>page.locator('[data-flow-zone="selected"] [data-flow-node]')
 const order=()=>flow().evaluateAll(nodes=>nodes.map(n=>n.dataset.flowNode))
 const dragBefore=async(source,target)=>{const locator=page.locator(`[data-flow-node="${target}"]`),box=await locator.boundingBox(),direction=await locator.evaluate(n=>Number(n.closest('.flow-step').dataset.flowDirection));await page.locator(`[data-flow-node="${source}"]`).dragTo(locator,{targetPosition:{x:direction===1?8:box.width-8,y:box.height/2}})}
 const waitVersion=v=>page.locator(`#consultStage .outline-flow-editor[data-outline-version="${v}"]`).waitFor({timeout:20000})
 await waitVersion(1);assert.deepEqual(await order(),['01','03','06'])
 assert.equal(await page.locator('[data-flow-question]').count(),0,'questions appear only after the user submits a flow')
 assert.equal(await page.locator('#confirmOutline').isDisabled(),true)
 await dragBefore('06','01')
 assert.deepEqual(await order(),['06','01','03'])
 await dragBefore('08','03')
 assert.deepEqual(await order(),['06','01','08','03'])
 await page.reload();await page.getByRole('button',{name:'打开历史项目 章节流程浏览器验收'}).click();await waitVersion(1)
 assert.deepEqual(await order(),['06','01','08','03'],'unsubmitted edits survive refresh')
 await page.locator('[data-flow-submit]').click();await waitVersion(2)
 assert.deepEqual(await order(),['06','01','08','03'],'model cannot silently restore catalog order')
 assert.equal(await page.locator('[data-flow-question]').count(),1)
 await page.locator('[data-flow-tab="flow"]').click();await page.locator('[data-flow-up="08"]').click();assert.equal(await page.locator('#confirmOutline').isDisabled(),true)
 assert.equal(await page.locator('[data-flow-question]').count(),0,'editing invalidates the visible assessment')
 await page.locator('[data-flow-submit]').click();await waitVersion(3)
 assert.deepEqual(await order(),['06','08','01','03'])
 await page.locator('[data-flow-question="goal"] details > summary').click()
 await page.locator('[data-flow-reason="goal"]').fill('本轮先摸底，缺口保留在后续章节。')
 await page.locator('[data-flow-skip="goal"]').click();await page.locator('[data-flow-reopen="goal"]').waitFor()
 await page.waitForFunction(()=>!document.querySelector('#confirmOutline').disabled)
 await page.screenshot({path:join(evidence,'interactive-flow.png')})
 await page.reload();await page.getByRole('button',{name:'打开历史项目 章节流程浏览器验收'}).click();await waitVersion(3)
 await page.locator('[data-flow-reopen="goal"]').waitFor();assert.deepEqual(await order(),['06','08','01','03'])
 await page.locator('#confirmOutline').click();await page.locator('#workspaceStage').waitFor({state:'visible'});await page.locator('.morph-ghost').waitFor({state:'detached'})
 assert.match(await page.locator('#graphBoard').textContent(),/空间布局与建设方案/)
 assert.doesNotMatch(await page.locator('#graphBoard').textContent(),/开发与运营/)
 assert.match(await page.locator('#chatHistory').textContent(),/本轮先摸底，缺口保留/)
 await page.reload();await page.getByRole('button',{name:'打开历史项目 章节流程浏览器验收'}).click();await page.locator('#workspaceStage').waitFor({state:'visible'});await page.locator('.morph-ghost').waitFor({state:'detached'})
 await page.screenshot({path:join(evidence,'confirmed-flow.png')})
 const versions=(await db.query('SELECT version,flow,flow_reviewed,confirmed_at FROM outline_versions ORDER BY version')).rows
 assert.deepEqual(versions.at(-1).flow,['06','08','01','03']);assert.ok(versions.at(-1).confirmed_at)
 assert.equal(calls.length,3);assert.ok(calls.every(c=>c.readOnly));assert.deepEqual(errors,[])
 await writeFile(join(evidence,'interactive-report.json'),JSON.stringify({model:'test-double',realBrowserAndApi:true,flow:versions.at(-1).flow,versions:3,confirmedVersion:3,skippedQuestions:1,cadFiltered:true,localEditsReloaded:true,errors},null,2))
 console.log('PASS browser: CAD filter → recommendation → drag reorder/add → reload → submit → revise/resubmit → explicit skip → confirm → selected flow and limitations → reload')
}catch(e){await page.screenshot({path:join(evidence,'failure.png')});throw e}finally{await browser.close();await app.close();await db.end();await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();await rm(root,{recursive:true,force:true})}
