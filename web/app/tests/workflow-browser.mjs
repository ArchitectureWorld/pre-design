// Real browser / API / PostgreSQL, with only the model replaced by a controlled double.
import {chromium} from '@playwright/test'
import serveStatic from '@fastify/static'
import pg from 'pg'
import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
import {createApp} from '../src/server.mjs'
import {confirmedOutlineFixture,draft} from './fixtures/outline.mjs'
import {workflowTargets} from '../src/workflow-contract.mjs'

const connection={host:'/tmp/pre-design-pg-1000',port:55439,database:'pre_design_web',user:'zetta'}
const pool=new pg.Pool(connection),schema='workflow_browser_'+randomUUID().replaceAll('-','')
await pool.query(`CREATE SCHEMA ${schema}`)
const db=new pg.Pool({...connection,options:`-c search_path=${schema}`}),root=await mkdtemp(join(tmpdir(),'workflow-browser-'))
const contexts=new Map(),calls=[],token=randomUUID()+randomUUID(),headers={authorization:`Bearer ${token}`},flow=['01','03','04','02','11']
const hold=Promise.withResolvers();let firstCall=true
const workers={
 async call(p,body){if(body.operation==='create')contexts.set(p.id,{project:{projectId:p.id,currentRevision:0},proposals:[],stateObjects:[]});return structuredClone(contexts.get(p.id))},
 async run(p,text,onEvent,policy,signal){
  const job=(await db.query('SELECT kind,payload FROM jobs WHERE id=$1',[p.task_id])).rows[0]
  calls.push({kind:job.kind,readOnly:p.read_only,payload:job.payload});onEvent({stage:'reading_material'})
  if(firstCall){firstCall=false;await hold.promise}
  if(signal.aborted)throw signal.reason
  const outline=(await db.query('SELECT draft,flow FROM outline_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[p.id])).rows[0]
  const targets=workflowTargets(outline).filter(target=>!job.payload.blockId||target.id===job.payload.blockId)
  onEvent({stage:'generating'})
  const longText='任务书列出工程位置与周边交通条件，现有资料可以支持项目区位与道路衔接的基本描述。'.repeat(21)
  return {response:JSON.stringify({blocks:targets.map(target=>({id:target.id,
   items:[1,2].map(index=>{
    const explanation=target.id==='outline-01-1'?longText:'既有资料记载该项现状。'
    return {
    id:`${target.id}-item-${index}`,title:index===1?'项目区位与交通条件':'建设范围与实施条件',
    paragraphs:[`${job.payload.itemId?'修订后汇报正文':'汇报正文'}：任务书提供项目所在地。本节以既有资料为基础描述 ${target.title}。${explanation}`,explanation,explanation],
    points:['保留现状道路出入口。','方案阶段核对交通衔接。'],evidenceIndexes:[0],
    }
   }).filter(item=>!job.payload.itemId||item.id===job.payload.itemId),
   internalNotes:Array.from({length:5},(_,index)=>`内部疑问 ${index+1}：${target.id} 的项目边界仍需用户补充。${'项目用地边界和详细规划管控要求有待核对。'.repeat(7)}`),
  }))}),eventCount:3}
 },async listArtifacts(){return[]},async close(){},async closeAll(){hold.resolve()},
}
const app=await createApp({db,workers,projectsRoot:root,users:[{id:'test',role:'admin',token}]})
await app.register(serveStatic,{root:resolve(process.env.PRE_WEB_BUILD_DIR||'web/app/dist')})
await app.listen({host:'127.0.0.1',port:0})
const url=`http://127.0.0.1:${app.server.address().port}`,request=async(method,path,body)=>{
 const result=await app.inject({method,url:path,headers,...(body?{payload:body}:{})})
 assert.equal(result.statusCode,200,result.body);return result.json()
}
const policy=await request('GET','/api/admin/models'),model=policy.models.find(m=>m.provider==='SenseNova'&&m.model==='sensenova-6.8-flash-lite')
model.status='verified';model.capabilities.tools=true;await request('PUT','/api/admin/models',{expectedRevision:policy.revision,policy})
const project=await request('POST','/api/projects',{requestId:randomUUID(),name:'成果流程浏览器验收'}),base=`/api/projects/${project.id}`
const post=(path,body)=>request('POST',base+path,{requestId:randomUUID(),baseRevision:0,...body}),state=()=>request('GET',base+'/state')
const material=await post('/materials',{filename:'任务书.txt',content:Buffer.from('任务书提供项目所在地。').toString('base64')})
await confirmedOutlineFixture(db,project.id)
const outline=draft(material.id);outline.questions=[]
for(const chapter of outline.chapters)chapter.tasks=[`${chapter.title}的现有依据`,`${chapter.title}的策划内容`,`${chapter.title}涉及的现有资料和历史范围及后续工作条件的完整长标题用于检验换行及节点内部排版`]
await db.query('UPDATE outline_versions SET draft=$2,flow=$3,retained_waivers=$4 WHERE project_id=$1',[project.id,outline,JSON.stringify(flow),JSON.stringify([{questionId:'boundary',prompt:'请提供本次项目边界',reason:'本轮暂不提供，保留缺口',chapterIds:flow,userId:'test',createdAt:new Date().toISOString(),version:1}])])
const before=await state(),evidence=resolve('.cache/workflow-browser');await mkdir(evidence,{recursive:true})
const browser=await chromium.launch({executablePath:'/home/zetta/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:['--no-proxy-server']})
const page=await browser.newPage({viewport:{width:1552,height:1052}}),errors=[],httpErrors=[]
page.on('pageerror',error=>errors.push(error.message))
page.on('response',response=>{if(response.status()>=500)httpErrors.push({path:new URL(response.url()).pathname,status:response.status()})})
const openProject=async()=>{await page.getByRole('button',{name:'打开历史项目 成果流程浏览器验收',exact:true}).click();await page.locator('#workspaceStage:not(.workspace-transitioning)').waitFor({state:'visible'})}
const settleAnimations=()=>page.evaluate(()=>Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))))
const waitVersion=version=>page.waitForFunction(version=>document.querySelector('[data-workflow-state]')?.textContent.includes(`V${version}`),version,{timeout:20000})
async function checkGraph(expectedScripts,expectedVisuals=0){
 const result=await page.evaluate(()=>{
  const data=[...document.querySelectorAll('#nodeLayer .mapnode')].map(node=>({id:node.dataset.nodeId,kind:node.dataset.nodeKind,x:Number.parseFloat(node.style.left),y:Number.parseFloat(node.style.top),w:node.offsetWidth,h:node.offsetHeight,title:node.title,text:node.textContent,scrollW:node.scrollWidth,clientW:node.clientWidth,scrollH:node.scrollHeight,clientH:node.clientHeight}))
  return {data,paths:[...document.querySelectorAll('#edgeLayer path')].map(path=>path.getAttribute('d')),visuals:document.querySelectorAll('.artnode').length}
 })
 for(const [kind,count] of [['chapter',5],['section',15],['script',expectedScripts]]){
  const nodes=result.data.filter(node=>node.kind===kind);assert.equal(nodes.length,count)
  if(count)assert.equal(new Set(nodes.map(node=>node.w)).size,1,`${kind} equal widths`)
 }
 assert.equal(result.visuals,expectedVisuals);assert.ok(result.data.every(node=>[node.x,node.y,node.w,node.h].every(Number.isFinite)))
 assert.ok(result.paths.every(path=>!/[CQSTA]/i.test(path)&&!path.includes('NaN')),'only straight/chamfered paths')
 for(const node of result.data.filter(node=>['chapter','section'].includes(node.kind))){assert.ok(node.text.includes(node.title),node.id);assert.ok(node.scrollW<=node.clientW+1,node.id+' horizontal overflow');assert.ok(node.scrollH<=node.clientH+1,node.id+' vertical overflow')}
 const last=[1,2,3].map(i=>result.data.find(node=>node.id===`section-5-${i}`).y);assert.ok(last[0]<last[1]&&last[1]<last[2],'5.3 must follow 5.2')
 return result
}
try{
 await page.goto(url);await page.locator('#accessToken').fill(token);await page.getByRole('button',{name:'进入项目空间'}).click();await page.locator('#accessDialog').waitFor({state:'detached'});await openProject()
 const initialGraph=await checkGraph(0)
 const viewport=await page.locator('#graphViewport').boundingBox(),oldTransform=await page.locator('#graphBoard').evaluate(element=>element.style.transform)
 await page.mouse.move(viewport.x+20,viewport.y+20);await page.mouse.down();await page.mouse.move(viewport.x+110,viewport.y+85,{steps:10});await page.mouse.up()
 assert.notEqual(await page.locator('#graphBoard').evaluate(element=>element.style.transform),oldTransform,'left drag pans')
 assert.equal(await page.locator('#nodePicker').isVisible(),false,'panning must not select nodes')
 await page.screenshot({path:join(evidence,'before-generation.png')})
 await page.locator('#pipelineBtn').click();await page.waitForFunction(()=>document.querySelector('[data-workflow-status]')?.dataset.status==='running')
 await page.waitForFunction(()=>document.querySelector('[data-workflow-activity]')?.textContent.includes('读取资料'))
 assert.match(await page.locator('[data-workflow-time]').textContent(),/已运行/)
 await page.screenshot({path:join(evidence,'running.png')});hold.resolve();await app.waitForJobs();await waitVersion(1)
 const first=(await state()).workflow.current;assert.equal(first.blocks.length,15);assert.equal(first.formatVersion,2);assert.equal(first.blocks[0].items.length,2);await checkGraph(30)
 const targetItem=first.blocks[0].items[0].id,approveWhole=page.locator('[data-workflow-approve]'),generateVisuals=page.locator('[data-workflow-visuals]')
 assert.equal(await generateVisuals.isDisabled(),true)
 assert.equal(await page.locator('[data-workflow-layout]').isVisible(),false)
 await page.locator('#pipelineBtn').click();await page.locator('[data-workflow-body]').waitFor({state:'visible'})
 assert.match(await page.locator('[data-workflow-body]').textContent(),/汇报正文/);assert.doesNotMatch(await page.locator('[data-workflow-body]').textContent(),/内部疑问|本轮暂不提供/)
 await page.setViewportSize({width:1060,height:630})
 const body=page.locator('[data-workflow-pane="body"]'),notes=page.locator('[data-workflow-pane="notes"]')
 assert.match(await notes.innerText(),/项目边界与规划管控/)
 assert.doesNotMatch(await notes.innerText(),/内部疑问/)
 await notes.getByText('查看原始说明',{exact:true}).first().click()
 assert.match(await notes.innerText(),/内部疑问/)
 assert.match(await notes.textContent(),/本轮暂不提供/)
 const panes=await page.evaluate(()=>{
  const [body,notes]=document.querySelectorAll('[data-workflow-pane]'),initial=[body.scrollTop,notes.scrollTop]
  body.scrollTop+=160
  const afterBody=[body.scrollTop,notes.scrollTop]
  notes.scrollTop+=160
  const afterNotes=[body.scrollTop,notes.scrollTop]
  return {widths:[body.offsetWidth,notes.offsetWidth],initial,afterBody,afterNotes}
 })
 assert.ok(Math.abs(panes.widths[0]-panes.widths[1])<=1,JSON.stringify(panes))
 assert.ok(panes.afterBody[0]>panes.initial[0]);assert.equal(panes.afterBody[1],panes.initial[1])
 assert.equal(panes.afterNotes[0],panes.afterBody[0]);assert.ok(panes.afterNotes[1]>panes.afterBody[1])
 await page.setViewportSize({width:760,height:820})
 assert.equal(await notes.isVisible(),false)
 await page.getByRole('button',{name:'内部备注',exact:true}).click()
 assert.equal(await notes.isVisible(),true);assert.equal(await body.isVisible(),false)
 await page.getByRole('button',{name:'汇报正文',exact:true}).click()
 assert.equal(await body.isVisible(),true);assert.equal(await notes.isVisible(),false)
 await page.setViewportSize({width:1552,height:1052})
 await page.locator('#previewNext').click()
 assert.match(await page.locator('#previewTitle').textContent(),/1\.1\.2 建设范围/)
 await page.locator('#previewPrev').click()
 assert.match(await page.locator('#previewTitle').textContent(),/1\.1\.1 项目区位/)
 await page.locator('#scriptEditBtn').click();await page.locator('#chatInput').fill('请明确这是已有资料能够支持的表述，调整第一段措辞。');await page.locator('#chatSubmit').click()
 await waitVersion(2);await app.waitForJobs();const second=(await state()).workflow.current
 assert.match(second.blocks[0].items[0].paragraphs[0],/修订后/)
 assert.deepEqual(second.blocks[0].items.slice(1),first.blocks[0].items.slice(1))
 assert.deepEqual(second.blocks.slice(1),first.blocks.slice(1));assert.deepEqual(second.reviewedItemIds,[])
 assert.equal(calls[1].payload.itemId,targetItem)
 await page.locator('#pipelineBtn').click();await page.locator('[data-workflow-body]').waitFor();assert.match(await page.locator('[data-workflow-body]').textContent(),/修订后/)
 await settleAnimations();await page.screenshot({path:join(evidence,'body-and-internal-notes.png')})
 await page.locator('#scriptApproveBtn').click();await page.waitForFunction(()=>document.querySelector('#scriptApproveBtn').textContent.includes('已审阅'))
 await page.locator('#closePreview').click()
 assert.equal(await generateVisuals.isDisabled(),true)
 assert.equal((await state()).workflow.visuals.current,null)
 await approveWhole.click();await page.waitForFunction(()=>document.querySelector('[data-workflow-approve]').textContent.includes('整稿已确认'))
 const approved=(await state()).workflow
 assert.equal(approved.current.approval.draftId,second.id);assert.equal(approved.visuals.current,null)
 assert.match(await page.locator('[data-workflow-summary]').textContent(),/整稿已确认/)
 assert.doesNotMatch(await page.locator('[data-workflow-summary]').textContent(),/已审阅 1 条/)
 const approvedGraph=await checkGraph(30)
 assert.ok(approvedGraph.data.filter(node=>node.kind==='script').every(node=>node.text.includes('已审阅')))
 await generateVisuals.click()
 const openVisual=page.locator('[data-workflow-open-visual]')
 await openVisual.waitFor({state:'visible'})
 const firstDeck=(await state()).workflow.visuals.current
 assert.equal(firstDeck.pages.length,30)
 assert.deepEqual(firstDeck.pages.map(item=>item.itemId),second.blocks.flatMap(block=>block.items.map(item=>item.id)))
 await checkGraph(30,30)
 await openVisual.click()
 assert.match(await page.locator('#previewTitle').textContent(),/HTML 汇报页 · 1 项目区位/)
 const visualFrame=page.frameLocator('iframe.workflow-visual-preview')
 const visualHeading=visualFrame.getByRole('heading',{name:'项目区位与交通条件',exact:true})
 const visualParagraph=visualFrame.getByText(/^修订后汇报正文/).first()
 await visualHeading.waitFor({state:'visible',timeout:5000})
 await visualParagraph.waitFor({state:'visible',timeout:5000})
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 const [frameBox,headingBox,paragraphBox]=await Promise.all([page.locator('iframe.workflow-visual-preview').boundingBox(),visualHeading.boundingBox(),visualParagraph.boundingBox()])
 assert.ok(frameBox?.width>300&&frameBox.height>100)
 assert.ok(headingBox?.width>100&&headingBox.height>0&&headingBox.y>=frameBox.y&&headingBox.y+headingBox.height<=frameBox.y+frameBox.height)
 assert.ok(paragraphBox?.width>100&&paragraphBox.height>0&&paragraphBox.y>=frameBox.y&&paragraphBox.y<frameBox.y+frameBox.height)
 await page.screenshot({path:join(evidence,'html-visual-preview.png')})
 const layoutDialog=page.locator('[data-workflow-layout-dialog]')
 const applyLayout=async (layout,version)=>{
  await layoutDialog.locator('[name=layout]').selectOption(layout)
  await layoutDialog.getByRole('button',{name:'应用版式'}).click()
  await layoutDialog.waitFor({state:'detached'})
  const deck=(await state()).workflow.visuals.current
  assert.equal(deck.version,version)
  return deck
 }
 await page.locator('[data-workflow-page-layout]').click()
 await page.keyboard.press('Escape')
 await layoutDialog.waitFor({state:'detached'})
 assert.equal(await page.locator('#previewOverlay').isVisible(),true)
 await page.locator('[data-workflow-page-layout]').click()
 assert.equal(await layoutDialog.locator('[name=pageIds]:checked').count(),1)
 const secondDeck=await applyLayout('columns',2)
 assert.equal(secondDeck.pages[0].layout,'columns')
 assert.deepEqual(secondDeck.pages.slice(1),firstDeck.pages.slice(1))
 await page.locator('#closePreview').click()
 await page.locator('[data-workflow-layout]').click()
 await layoutDialog.locator('[name=pageIds]').nth(1).check()
 await layoutDialog.locator('[name=pageIds]').nth(2).check()
 const finalDeck=await applyLayout('focus',3)
 assert.deepEqual(finalDeck.pages.slice(0,3).map(page=>page.layout),['columns','focus','focus'])
 assert.deepEqual(finalDeck.pages.slice(3),firstDeck.pages.slice(3));assert.deepEqual(finalDeck.theme,firstDeck.theme)
 await page.locator('[data-open="tasks"]').click()
 for(const extension of ['html','md']){
  const button=page.locator(`[data-artifact="workflow-${second.id}-${extension}"]`);await button.waitFor()
  const downloadReady=page.waitForEvent('download');await button.click();const download=await downloadReady,path=join(evidence,`draft-v2.${extension}`);await download.saveAs(path)
  const content=await readFile(path,'utf8');assert.match(content,/修订后汇报正文/);assert.match(content,/内部备注/);assert.match(content,/内部疑问/);assert.match(content,/本轮暂不提供/)
  if(extension==='html')assert.doesNotMatch(content.match(/<main>[\s\S]*?<\/main>/)?.[0]??'',/内部疑问|本轮暂不提供/)
 }
 const downloadDeck=async()=>{
  const button=page.locator(`[data-artifact="workflow-visual-${finalDeck.id}-html"]`)
  await button.waitFor()
  assert.match(await button.locator('xpath=../..').textContent(),/HTML 汇报页集/)
  const ready=page.waitForEvent('download');await button.click();const download=await ready,path=join(evidence,'visual-v3.html')
  await download.saveAs(path);const content=await readFile(path,'utf8')
  assert.match(content,/修订后汇报正文/)
  assert.doesNotMatch(content,/内部疑问|本轮暂不提供/)
 }
 await downloadDeck()
 await page.reload();await openProject();await waitVersion(2);await checkGraph(30,30)
 await openVisual.click();assert.match(await page.locator('#previewTitle').textContent(),/HTML 汇报页 · 1 项目区位.*V3/)
 await page.locator('#closePreview').click();await page.locator('[data-open="tasks"]').click();await downloadDeck()
 const final=await state();assert.deepEqual(final.workflow.current.reviewedItemIds,[targetItem]);assert.deepEqual(final.workflow.visuals.current,finalDeck);assert.equal(final.revision,0);assert.deepEqual(final.core.proposals,[])
 assert.deepEqual(final.outline,before.outline);assert.equal(calls.length,2);assert.ok(calls.every(call=>call.kind==='workflow'&&call.readOnly));assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[])
 await page.screenshot({path:join(evidence,'reloaded.png')})
 await writeFile(join(evidence,'report.json'),JSON.stringify({model:'controlled-test-double',realBrowserApiDatabase:true,flow,chapters:5,sections:15,noPrematureScripts:true,noPrematureVisualizations:true,visualPages:30,wholeDraftApproval:true,singleAndMultiPageLayout:true,independentScroll:true,mobileTabs:true,fullTitlesEqualWidths:true,straightChamferedEdges:true,leftButtonPan:true,realProgress:true,bodyAndNotesSeparate:true,targetedRevision:true,review:true,downloads:['html','md','visual-html'],reloadRecovery:true,revision:final.revision,versions:final.workflow.history.length,errors,httpErrors,initialGraph},null,2))
 console.log('PASS five chapters / 15 sections, titles, panning, generation, progress, revision, review, download, refresh, whole-draft approval, 30-page HTML deck and single/multi-page layout')
}catch(error){await page.screenshot({path:join(evidence,'failure.png')});await writeFile(join(evidence,'failure-state.json'),JSON.stringify({snapshot:await state(),calls,errors,httpErrors},null,2));throw error}
finally{hold.resolve();await browser.close();await app.close();await db.end();await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();await rm(root,{recursive:true,force:true})}
