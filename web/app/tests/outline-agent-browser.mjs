// Real browser/API/PostgreSQL; only the model is a controllable test double.
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

const connection={host:'/tmp/pre-design-pg-1000',port:55439,database:'pre_design_web',user:'zetta'},pool=new pg.Pool(connection),schema='outline_agent_browser_'+randomUUID().replaceAll('-','')
await pool.query(`CREATE SCHEMA ${schema}`)
const db=new pg.Pool({...connection,options:`-c search_path=${schema}`}),root=await mkdtemp(join(tmpdir(),'outline-agent-browser-')),contexts=new Map(),calls=[],token=randomUUID()+randomUUID(),headers={authorization:`Bearer ${token}`}
let holdKind=null,release=()=>{},emit=()=>{}
const workers={
 async call(p,b){if(b.operation==='create')contexts.set(p.id,{project:{projectId:p.id,currentRevision:0},proposals:[],stateObjects:[]});return contexts.get(p.id)},
 async run(p,text,onEvent,snapshot,signal){
  const job=(await db.query('SELECT kind,payload FROM jobs WHERE id=$1',[p.task_id])).rows[0]
  calls.push({kind:job.kind,readOnly:p.read_only,payload:job.payload});emit=onEvent
  onEvent({stage:'reading_material',label:'SECRET SHOULD NOT BE PUBLIC'})
  if(holdKind===job.kind)await new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(signal.reason),{once:true})})
  if(job.payload.text==='触发错误')throw new Error('TEST_MODEL_ERROR')
  if(job.kind==='chat')return {response:'可以先研究人群；边界和用地条件仍需核实。',eventCount:3}
  const file=(await db.query('SELECT * FROM materials WHERE project_id=$1',[p.id])).rows[0],value=draft(file.id)
  for(const c of value.chapters)if(['08','09','10'].includes(c.id))c.disposition='defer'
  return {response:JSON.stringify(value),materialReads:[readFixture({...file,sourceRelativePath:relative(p.workspace,file.path)})]}
 },async close(){},async closeAll(){release()},
}
const app=await createApp({db,workers,projectsRoot:root,users:[{id:'test',role:'admin',token}]})
await app.register(serveStatic,{root:resolve(process.env.PRE_WEB_BUILD_DIR||'web/app/dist')});await app.listen({host:'127.0.0.1',port:0})
const url=`http://127.0.0.1:${app.server.address().port}`,request=async(method,path,body)=>{const r=await app.inject({method,url:path,headers,...(body?{payload:body}:{})});assert.equal(r.statusCode,200,r.body);return r.json()}
const policy=await request('GET','/api/admin/models'),model=policy.models.find(m=>m.provider==='SenseNova'&&m.model==='sensenova-6.8-flash-lite');model.status='verified';model.capabilities.tools=true
await request('PUT','/api/admin/models',{expectedRevision:policy.revision,policy})
const project=await request('POST','/api/projects',{requestId:randomUUID(),name:'Agent交互验收'}),base=`/api/projects/${project.id}`
const post=(path,body)=>request('POST',base+path,{requestId:randomUUID(),baseRevision:0,...body}),state=()=>request('GET',base+'/state')
await post('/materials',{filename:'任务书.txt',content:Buffer.from('任务书提供项目所在地。').toString('base64')})
await post('/outline/draft',{outlineVersion:0,text:''});await app.waitForJobs()
const browser=await chromium.launch({executablePath:'/home/zetta/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:['--no-proxy-server']}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],httpErrors=[],evidence=resolve('.cache/serpentine-agent')
page.on('pageerror',e=>errors.push(e.message));await mkdir(evidence,{recursive:true})
page.on('response',r=>{if(r.status()>=500)httpErrors.push({path:new URL(r.url()).pathname,status:r.status()})})
const waitState=status=>page.waitForFunction(status=>document.querySelector('#outlineAgentPanel')?.dataset.status===status,status,{timeout:15000})
const order=()=>page.locator('[data-flow-zone="selected"] [data-flow-node]').evaluateAll(ns=>ns.map(n=>n.dataset.flowNode))
const openProject=async()=>{await page.getByRole('button',{name:'打开历史项目 Agent交互验收',exact:true}).click();await page.locator('.outline-flow-editor[data-outline-version]').waitFor()}
async function allVisible(){const report=await page.evaluate(()=>{const r=document.querySelector('#consultStream').getBoundingClientRect();return {viewport:{top:r.top,bottom:r.bottom},cards:[...document.querySelectorAll('[data-flow-node]')].map(n=>({id:n.dataset.flowNode,top:n.getBoundingClientRect().top,bottom:n.getBoundingClientRect().bottom})),composer:document.querySelector('#consultComposer').getBoundingClientRect().bottom}});assert.ok(report.cards.every(c=>c.top>=report.viewport.top-1&&c.bottom<=report.viewport.bottom+1),JSON.stringify(report));assert.ok(report.composer<=900)}
try{
 await page.goto(url);await page.locator('#accessToken').fill(token);await page.getByRole('button',{name:'进入项目空间'}).click();await page.locator('#accessDialog').waitFor({state:'detached'});await openProject()
 assert.equal(await page.locator('#consultComposer').isVisible(),true);await allVisible()
 await page.locator('[data-flow-up="02"]').click();const edited=await order()
 holdKind='chat';await page.locator('#consultInput').fill('为什么人群与需求要放这里？');await page.locator('#consultSend').click();await waitState('running')
 await page.waitForFunction(()=>document.querySelector('[data-agent-activity]').textContent.includes('读取资料'))
 assert.match(await page.locator('[data-agent-time]').textContent(),/已运行/)
 assert.equal((await state()).outline.version,1);assert.deepEqual(await order(),edited)
 await page.locator('#consultInput').fill('还没发出的补充')
 await page.locator('[data-flow-detail="02"]').click();emit({stage:'generating'})
 await page.waitForFunction(()=>document.querySelector('[data-agent-activity]').textContent.includes('生成回复'))
 assert.equal(await page.locator('[data-flow-inspector="task"]').isVisible(),true,'activity must not remount dialog')
 assert.equal(await page.locator('#consultInput').inputValue(),'还没发出的补充')
 await page.locator('[data-flow-inspector="task"] [data-flow-close]').click();holdKind=null;release();await waitState('completed')
 assert.match(await page.locator('[data-agent-history]').textContent(),/可以先研究人群/)
 await page.waitForFunction(()=>{const h=document.querySelector('[data-agent-history]');return h.scrollHeight-h.scrollTop-h.clientHeight<=2})
 await page.reload();await openProject();assert.equal(await page.locator('#consultInput').inputValue(),'还没发出的补充');assert.deepEqual(await order(),edited)
 holdKind='outline';await page.locator('[data-flow-submit]').click();await waitState('running')
 await page.waitForFunction(()=>document.querySelector('[data-agent-activity]').textContent.includes('读取资料'))
 await page.locator('#consultInput').fill('这轮先保留资料缺口');await page.locator('#consultSend').click()
 await page.waitForFunction(()=>document.querySelector('[data-agent-queue]').textContent.includes('1'))
 await page.locator('#consultInput').fill('等待完成后的草稿');await allVisible();await page.waitForFunction(()=>{const h=document.querySelector('[data-agent-history]');return h.scrollHeight-h.scrollTop-h.clientHeight<=2});await page.screenshot({path:join(evidence,'running-and-queued.png')})
 await page.route('**/api/projects/*/events?*',route=>route.abort());await page.reload();await openProject()
 await page.waitForFunction(()=>document.querySelector('[data-agent-connection]').textContent.includes('轮询'))
 assert.equal(await page.locator('#consultInput').inputValue(),'等待完成后的草稿')
 holdKind=null;release();await app.waitForJobs()
 await page.locator('.outline-flow-editor[data-outline-version="2"]').waitFor({timeout:15000});await waitState('completed')
 assert.equal(await page.locator('#consultInput').inputValue(),'等待完成后的草稿')
 await page.locator('[data-flow-tab="flow"]').click();assert.deepEqual(await order(),edited)
 await page.screenshot({path:join(evidence,'completed-with-polling.png')})
 await page.locator('#consultInput').fill('触发错误');await page.locator('#consultSend').click();await waitState('failed')
 assert.match(await page.locator('[data-agent-history]').textContent(),/执行未完成|失败/)
 holdKind='chat';await page.locator('#consultInput').fill('核对后取消此讨论');await page.locator('#consultSend').click();await waitState('running')
 await page.locator('[data-agent-cancel]').click();await waitState('cancelled')
 const final=await state();assert.equal(final.outline.version,2);assert.deepEqual(final.outline.flow,edited);assert.equal(final.revision,0)
 assert.ok(calls.filter(c=>c.kind==='chat').every(c=>c.readOnly&&c.payload.discussionOnly===true));assert.deepEqual(calls.find(c=>c.kind==='chat').payload.discussionFlow,edited);assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[])
 const report={model:'controlled-test-double',realBrowserApiDatabase:true,visibleComposer:true,discussionDoesNotSubmitFlow:true,progressWithoutRemount:true,typedDraftPreserved:true,queuedDiscussion:true,reloadRecovery:true,pollFallback:true,failureVisible:true,cancelVisible:true,originalFlowOrder:edited,revision:final.revision,errors}
 await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2));console.log('PASS Agent conversation, readonly discussion, real progress events, queue, reload, poll fallback, failure and cancel')
}catch(error){await page.screenshot({path:join(evidence,'failure.png')});throw error}finally{holdKind=null;release();await browser.close();await app.close();await db.end();await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();await rm(root,{recursive:true,force:true})}
