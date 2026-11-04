import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createApp} from '../src/server.mjs'
import {confirmedOutlineFixture,draft} from './fixtures/outline.mjs'
const connection={host:'/tmp/pre-design-pg-1000',port:55439,database:'pre_design_web',user:'zetta'}
const item=(id,title)=>({id,title,paragraphs:[],points:['项目名称：少潭河水库','项目区位：湖北省武汉市新洲区'],evidenceIndexes:[0]})
const content=()=>({blocks:[{id:'outline-01-1',items:[item('outline-01-1-item-1','项目概况'),item('outline-01-1-item-2','历史资料适用范围')],internalNotes:['本次研究范围待明确。']},{id:'outline-03-1',items:[item('outline-03-1-item-1','历史管理主题')],internalNotes:['边界与管控仍需核实。']}]})
async function fixture(t){
 const pool=new pg.Pool(connection),schema='structured_'+randomUUID().replaceAll('-','');await pool.query(`CREATE SCHEMA ${schema}`)
 const db=new pg.Pool({...connection,options:`-c search_path=${schema}`}),root=await mkdtemp(join(tmpdir(),'structured-')),contexts=new Map()
 const workers={async call(p,body){if(body.operation==='create')contexts.set(p.id,{project:{projectId:p.id,currentRevision:0},proposals:[],stateObjects:[]});return structuredClone(contexts.get(p.id))},async run(p){const job=(await db.query('SELECT payload FROM jobs WHERE id=$1',[p.task_id])).rows[0];return {response:JSON.stringify(job.payload.itemId?{blocks:[{id:job.payload.blockId,items:[{...item(job.payload.itemId,'修订项目概况'),points:['项目名称：少潭河水库','片区策划'] }],internalNotes:['本次研究范围待明确。']}]}:content())}},async listArtifacts(){return[]},async close(){},async closeAll(){}}
 const app=await createApp({db,workers,projectsRoot:root,users:[{id:'admin',role:'admin',token:'a'.repeat(40)},{id:'other',token:'b'.repeat(40)}]})
 t.after(async()=>{await app.close();await db.end();await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();await rm(root,{recursive:true,force:true})})
 const request=(method,url,payload,user='a')=>app.inject({method,url,headers:{authorization:'Bearer '+user.repeat(40)},...(payload===undefined?{}:{payload})})
 const policy=(await request('GET','/api/admin/models')).json(),model=policy.models.find(m=>m.provider==='SenseNova'&&m.model==='sensenova-6.8-flash-lite');model.status='verified';model.capabilities.tools=true
 await request('PUT','/api/admin/models',{expectedRevision:policy.revision,policy})
 const project=(await request('POST','/api/projects',{requestId:'create',name:'结构化条页验收'})).json(),base=`/api/projects/${project.id}`
 const post=(path,payload={})=>request('POST',base+path,{requestId:randomUUID(),baseRevision:0,...payload}),state=async()=>(await request('GET',base+'/state')).json()
 const material=(await post('/materials',{filename:'任务书.txt',content:Buffer.from('任务书提供项目所在地。').toString('base64')})).json()
 await confirmedOutlineFixture(db,project.id);const outline=draft(material.id);outline.questions=[]
 await db.query('UPDATE outline_versions SET draft=$2,flow=$3 WHERE project_id=$1',[project.id,outline,JSON.stringify(['01','03'])])
 const generated=await post('/workflow/draft',{outlineVersion:1});assert.equal(generated.statusCode,200,generated.body);await app.waitForJobs()
 const first=(await state()).workflow.current;assert.ok(first,'real queue must persist a structured draft');assert.equal(first.formatVersion,2)
 return {app,db,workers,request,project,base,post,state,first}
}
test('整稿确认是首次可视化门槛，首次必须覆盖全部条目，一条一页且统一主题',async t=>{
 const f=await fixture(t),draftId=f.first.id
 assert.equal((await f.post('/workflow/visuals',{draftId})).statusCode,409)
 assert.equal((await f.post('/workflow/visuals',{draftId,pageIds:['visual-page-outline-01-1-item-1']})).statusCode,400)
 assert.equal((await f.request('POST',f.base+'/workflow/approve',{requestId:'foreign',baseRevision:0,draftId},'b')).statusCode,404)
 for(const block of f.first.blocks)for(const item of block.items)assert.equal((await f.post('/workflow/review',{draftId,blockId:block.id,itemId:item.id})).statusCode,200)
 const reviewed=(await f.state()).workflow.current;assert.deepEqual(reviewed.reviewedBlockIds,['outline-01-1','outline-03-1']);assert.equal(reviewed.approval,null)
 assert.equal((await f.post('/workflow/visuals',{draftId})).statusCode,409,'individual reviews do not silently approve the whole script')
 const draftFile=await f.request('GET',`${f.base}/artifacts/workflow-${draftId}-md`);assert.match(draftFile.body,/已审阅阶段稿/);assert.doesNotMatch(draftFile.body,/本节待审阅/)
 const draftFiles=(await f.request('GET',`${f.base}/artifacts`)).json().filter(file=>file.kind==='workflow-draft');assert.ok(draftFiles.every(file=>file.status==='reviewed'))
 const approval={requestId:'approve-all',draftId},approved=await f.post('/workflow/approve',approval);assert.equal(approved.statusCode,200,approved.body)
 assert.deepEqual((await f.post('/workflow/approve',approval)).json(),approved.json())
 const body={requestId:'visual-all',draftId},created=await f.post('/workflow/visuals',body);assert.equal(created.statusCode,200,created.body)
 const visual=(await f.state()).workflow.visuals.current;assert.equal(visual.pages.length,3);assert.equal(visual.draftId,draftId);assert.equal(visual.theme.id,'pre-design-report-v1');assert.equal(visual.stale,false)
 assert.deepEqual(visual.pages.map(page=>page.itemId),['outline-01-1-item-1','outline-01-1-item-2','outline-03-1-item-1'])
 assert.deepEqual((await f.post('/workflow/visuals',body)).json(),created.json())
 const file=await f.request('GET',`${f.base}/artifacts/workflow-visual-${visual.id}-html`);assert.equal(file.statusCode,200,file.body);assert.match(file.body,/项目概况/);assert.match(file.body,/历史资料适用范围/);assert.doesNotMatch(file.body,/本次研究范围待明确/)
 assert.equal((await f.request('GET',`${f.base}/artifacts/workflow-visual-${visual.id}-html`,undefined,'b')).statusCode,404)
 const state=await f.state();assert.equal(state.revision,0);assert.deepEqual(state.core.proposals,[])
})
test('单条修订保留同节其他条，整稿确认失效，旧视觉保持可下载且不能更新',async t=>{
 const f=await fixture(t),draftId=f.first.id;await f.post('/workflow/approve',{draftId});await f.post('/workflow/visuals',{draftId})
 const visual=(await f.state()).workflow.visuals.current,blockId='outline-01-1',itemId='outline-01-1-item-1'
 const invalid=await f.post('/workflow/draft',{outlineVersion:1,baseDraftId:draftId,blockId,itemId:'outline-03-1-item-1',text:'修改'});assert.equal(invalid.statusCode,409,invalid.body)
 const accepted=await f.post('/workflow/draft',{outlineVersion:1,baseDraftId:draftId,blockId,itemId,text:'精简本条'});assert.equal(accepted.statusCode,200,accepted.body);await f.app.waitForJobs()
 const state=await f.state(),current=state.workflow.current;assert.equal(current.version,2);assert.equal(current.approval,null)
 assert.deepEqual(current.blocks[0].items[1],f.first.blocks[0].items[1]);assert.deepEqual(current.blocks[1],f.first.blocks[1]);assert.match(current.blocks[0].items[0].title,/修订/)
 assert.equal(state.workflow.visuals.current.stale,true);assert.equal((await f.post('/workflow/visuals',{draftId,baseVisualId:visual.id,pageIds:[visual.pages[0].id],layout:'focus'})).statusCode,409)
 assert.equal((await f.post('/workflow/approve',{draftId})).statusCode,409);assert.equal((await f.post('/workflow/review',{draftId:current.id,blockId,itemId})).statusCode,200)
 assert.deepEqual((await f.state()).workflow.current.reviewedItemIds,[itemId]);assert.equal((await f.request('GET',`${f.base}/artifacts/workflow-visual-${visual.id}-html`)).statusCode,200)
})
test('同一源稿的单页与多页版式更新保留其他页和主题，拒绝跨页及旧版覆盖',async t=>{
 const f=await fixture(t),draftId=f.first.id;await f.post('/workflow/approve',{draftId});await f.post('/workflow/visuals',{draftId})
 const first=(await f.state()).workflow.visuals.current
 const edited=await f.post('/workflow/visuals',{draftId,baseVisualId:first.id,pageIds:[first.pages[0].id],layout:'focus'});assert.equal(edited.statusCode,200,edited.body)
 const second=(await f.state()).workflow.visuals.current;assert.equal(second.version,2);assert.equal(second.pages[0].layout,'focus');assert.deepEqual(second.pages.slice(1),first.pages.slice(1));assert.deepEqual(second.theme,first.theme)
 assert.equal((await f.post('/workflow/visuals',{draftId,baseVisualId:first.id,pageIds:[first.pages[0].id],layout:'columns'})).statusCode,409)
 assert.equal((await f.post('/workflow/visuals',{draftId,baseVisualId:second.id,pageIds:['unknown'],layout:'columns'})).statusCode,404)
 const update=await f.post('/workflow/visuals',{draftId,baseVisualId:second.id,pageIds:second.pages.slice(1).map(page=>page.id),layout:'columns'});assert.equal(update.statusCode,200,update.body)
 const third=(await f.state()).workflow.visuals.current;assert.equal(third.version,3);assert.deepEqual(third.pages[0],second.pages[0]);assert.ok(third.pages.slice(1).every(page=>page.layout==='columns'))
 assert.equal((await f.post('/workflow/visuals',{draftId,baseVisualId:third.id,pageIds:[third.pages[0].id,third.pages[0].id],layout:'focus'})).statusCode,400)
})
