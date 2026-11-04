import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,relative} from 'node:path'
import {createApp} from '../src/server.mjs'
import {draft,readFixture} from './fixtures/outline.mjs'
test('资料→草案→回答→指定版本确认→刷新恢复；过期、跨用户和并发不能绕过',async t=>{
 const connection={host:'/tmp/pre-design-pg-1000',port:55439,database:'pre_design_web',user:'zetta'},pool=new pg.Pool(connection),schema='outline_'+randomUUID().replaceAll('-','')
 await pool.query(`CREATE SCHEMA ${schema}`)
 const db=new pg.Pool({...connection,options:`-c search_path=${schema}`}),root=await mkdtemp(join(tmpdir(),'outline-api-')),contexts=new Map(),calls=[]
 let materialId,answer=false,invalid=false,reword=false
 const workers={async call(p,body){if(body.operation==='research-plan')return {catalog:{modules:[{id:'1.01',title:'项目概况与策划任务'},{id:'6.01',title:'总体空间结构与用地布局'}]}};if(body.operation==='create')contexts.set(p.id,{project:{projectId:p.id,currentRevision:0},proposals:[],stateObjects:[]});return contexts.get(p.id)},
 async run(p,text){calls.push({readOnly:p.read_only,text});const value=draft(materialId);if(reword)value.questions[0].prompt='请明确新增用途？';if(answer)value.questions=[];const file=(await db.query('SELECT * FROM materials WHERE id=$1',[materialId])).rows[0];return{response:invalid?'bad JSON':JSON.stringify(value),materialReads:[readFixture({...file,sourceRelativePath:relative(p.workspace,file.path)})]}},async closeAll(){}}
 const users=[{id:'admin',role:'admin',token:'a'.repeat(40)},{id:'bob',token:'b'.repeat(40)}]
 let app=await createApp({db,workers,projectsRoot:root,users})
 t.after(async()=>{await app.close();await db.end();await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();await rm(root,{recursive:true,force:true})})
 const request=(method,url,payload,user=0)=>app.inject({method,url,headers:{authorization:`Bearer ${users[user].token}`},...(payload?{payload}:{})})
 const policy=(await request('GET','/api/admin/models')).json(),model=policy.models.find(m=>m.provider==='SenseNova'&&m.model==='sensenova-6.8-flash-lite');model.status='verified';model.capabilities.tools=true
 assert.equal((await request('PUT','/api/admin/models',{expectedRevision:policy.revision,policy})).statusCode,200)
 const p=(await request('POST','/api/projects',{requestId:'create',name:'首轮验收'})).json(),url=`/api/projects/${p.id}`
 const post=(path,body={})=>request('POST',url+path,{requestId:randomUUID(),baseRevision:0,...body})
 const state=async()=>(await request('GET',url+'/state')).json()
 const upload=await post('/materials',{filename:'任务书.txt',content:Buffer.from('武汉市项目，本轮目标待澄清').toString('base64')});materialId=upload.json().id
 const blocked=await post('/research',{moduleIds:['1.01'],flags:{industryPlanning:false,existingBuildings:false,externalPartners:false,marketing:false}})
 assert.equal(blocked.statusCode,409,blocked.body);assert.match(blocked.json().error,/章节/)
 const first=await post('/outline/draft',{outlineVersion:0,text:''});assert.equal(first.statusCode,200,first.body)
 await app.waitForJobs();let s=await state();assert.equal(s.outline.version,1);assert.equal(s.outline.draft.chapters.length,11);assert.equal(s.outline.status,'draft');assert.equal(calls[0].readOnly,true)
 assert.match(calls[0].text,/第5章/);assert.equal(s.core.proposals.length,0)
 let confirmation={version:1,inputHash:s.outline.inputHash}
 assert.equal((await post('/outline/confirm',confirmation)).statusCode,409)
 assert.equal((await request('POST',url+'/outline/confirm',{requestId:'cross',baseRevision:0,...confirmation},1)).statusCode,404)
 answer=false
 assert.equal((await post('/outline/draft',{outlineVersion:1,flow:['06','03','01'],text:'目标是判断水库周边公共游憩的可行方向，具体投资后补。'})).statusCode,200)
 await app.waitForJobs();s=await state();assert.equal(s.outline.version,2);assert.equal(s.outline.status,'draft');assert.deepEqual(s.outline.flow,['06','03','01']);assert.equal(s.outline.flowReviewed,true)
 assert.equal((await post('/outline/confirm',confirmation)).statusCode,409)
 const decision={requestId:'skip-goal',version:2,inputHash:s.outline.inputHash,questionId:'goal',action:'skip',reason:'本轮只做资料摸底，后续补充目标'}
 assert.equal((await post('/outline/confirm',{version:2,inputHash:s.outline.inputHash})).statusCode,409)
 assert.equal((await request('POST',url+'/outline/decisions',{baseRevision:0,...decision},1)).statusCode,404)
 assert.equal((await post('/outline/decisions',decision)).statusCode,200)
 assert.equal((await post('/outline/decisions',decision)).statusCode,200)
 assert.equal((await post('/outline/decisions',{...decision,reason:'changed'})).statusCode,409)
 assert.equal((await state()).outline.waivers.length,1)
 assert.equal((await post('/outline/decisions',{...decision,requestId:'reopen',action:'reopen'})).statusCode,200)
 assert.equal((await post('/outline/confirm',{version:2,inputHash:s.outline.inputHash})).statusCode,409)
 assert.equal((await post('/outline/decisions',{...decision,requestId:'skip-again'})).statusCode,200)
 confirmation={requestId:'confirm-v2',version:2,inputHash:s.outline.inputHash}
 assert.equal((await post('/outline/confirm',confirmation)).statusCode,200)
 assert.equal((await post('/outline/confirm',confirmation)).statusCode,200)
 assert.equal((await state()).outline.status,'confirmed');assert.equal((await state()).revision,0);assert.equal(calls.length,2)
 await app.close();app=await createApp({db,workers,projectsRoot:root,users});assert.equal((await state()).outline.status,'confirmed')
 const plan=(await request('GET',url+'/research')).json();assert.match(plan.outlineReadiness.blockedModules['6.01'],/流程/)
 const countBefore=(await state()).jobs.length
 for(const [path,body] of [['/research',{moduleIds:['6.01'],flags:{industryPlanning:false,existingBuildings:false,externalPartners:false,marketing:false}}],['/confirm',{proposalId:'fake'}],['/reports',{chapterId:'spatial',stage:'write'}]]){
  const denied=await post(path,body);assert.equal(denied.statusCode,409,denied.body);assert.match(denied.json().error,/资料前置条件|本轮章节流程/)
 }
 assert.equal((await state()).jobs.length,countBefore,'rejected work must not enqueue or consume a model call')
 await post('/chat',{text:'请直接写空间布局并提交'});await app.waitForJobs();assert.equal(calls.at(-1).readOnly,true)

 await post('/outline/draft',{outlineVersion:2,text:'补充其他说明，保持原问题和明确跳过记录'});await app.waitForJobs()
 s=await state();assert.equal(s.outline.version,3);assert.equal(s.outline.waivers.length,1)
 const inherited={...decision,version:3,inputHash:s.outline.inputHash,requestId:'reopen-inherited',action:'reopen'}
 assert.equal((await post('/outline/decisions',inherited)).statusCode,200)
 assert.equal((await state()).outline.waivers.length,0);assert.equal((await state()).outline.retainedWaivers.length,0,'reopening must revoke inherited applicability too')
 assert.equal((await post('/outline/decisions',{...inherited,requestId:'reskip-inherited',action:'skip'})).statusCode,200)
 reword=true
 await post('/outline/draft',{outlineVersion:3,text:'补充其他事项，不改变已经明确跳过的理由'});await app.waitForJobs()
 s=await state();assert.equal(s.outline.version,4);assert.equal(s.outline.waivers.length,0);assert.equal(s.outline.retainedWaivers.length,1);assert.match(s.outline.retainedWaivers[0].reason,/本轮只做资料摸底/)
 assert.equal((await post('/outline/confirm',{version:4,inputHash:s.outline.inputHash})).statusCode,409,'reworded question is not silently waived')
 await post('/materials',{filename:'补充.txt',content:'eA=='})
 assert.equal((await state()).outline.status,'stale')
 assert.equal((await post('/confirm',{proposalId:'fake'})).statusCode,409)
 invalid=true
 await post('/outline/draft',{outlineVersion:4,text:'请结合补充资料更新'});await app.waitForJobs()
 s=await state();assert.equal(s.outline.version,4);assert.equal(s.outline.status,'stale');assert.equal(s.jobs.at(-1).status,'failed')
 assert.equal((await post('/outline/confirm',{version:2,inputHash:s.outline.inputHash})).statusCode,409)
})
