import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,relative} from 'node:path'
import {createApp} from '../src/server.mjs'
import {confirmedOutlineFixture,draft,readFixture} from './fixtures/outline.mjs'

const connection={host:'/tmp/pre-design-pg-1000',port:55439,database:'pre_design_web',user:'zetta'}
const deferred=()=>Promise.withResolvers()
async function until(read,accept){
  const deadline=Date.now()+5000
  while(Date.now()<deadline){const value=await read();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,20))}
  assert.fail('等待真实任务状态超时')
}
async function fixture(t){
  const pool=new pg.Pool(connection),schema='progress_'+randomUUID().replaceAll('-','')
  await pool.query(`CREATE SCHEMA ${schema}`)
  const db=new pg.Pool({...connection,options:`-c search_path=${schema}`}),root=await mkdtemp(join(tmpdir(),'progress-api-')),contexts=new Map()
  const workers={async call(p,body){
    if(body.operation==='create')contexts.set(p.id,{project:{projectId:p.id,currentRevision:0},proposals:[],stateObjects:[]})
    return structuredClone(contexts.get(p.id))
  },async run(){return{response:'完成'}},async close(){},async closeAll(){}}
  const users=[{id:'admin',role:'admin',token:'a'.repeat(40)},{id:'other',token:'b'.repeat(40)}]
  let app=await createApp({db,workers,projectsRoot:root,users})
  t.after(async()=>{await app.close();await db.end();await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();await rm(root,{recursive:true,force:true})})
  const request=(method,url,payload,user=0)=>app.inject({method,url,headers:{authorization:`Bearer ${users[user].token}`},...(payload!==undefined?{payload}:{})})
  const policy=(await request('GET','/api/admin/models')).json(),model=policy.models.find(row=>row.provider==='SenseNova'&&row.model==='sensenova-6.8-flash-lite')
  model.status='verified';model.capabilities.tools=true
  assert.equal((await request('PUT','/api/admin/models',{expectedRevision:policy.revision,policy})).statusCode,200)
  const project=(await request('POST','/api/projects',{requestId:'create',name:'进度隔离测试'})).json(),base=`/api/projects/${project.id}`
  return{db,workers,project,request,base,get app(){return app},
    async restart(){await app.close();app=await createApp({db,workers,projectsRoot:root,users})},
    async state(){const result=await request('GET',base+'/state');assert.equal(result.statusCode,200,result.body);return result.json()},
    async post(path,body={}){return request('POST',base+path,{requestId:randomUUID(),baseRevision:0,...body})},
  }
}

test('章节任务公开真实活动和起止时间，节流脱敏后写入数据库，刷新及重启可恢复',async t=>{
  const f=await fixture(t),release=deferred(),started=deferred(),secret='RAW_SECRET_REASONING_AND_ARGUMENTS'
  t.after(()=>release.resolve())
  const upload=await f.post('/materials',{filename:'任务书.txt',content:Buffer.from('任务书提供项目所在地。').toString('base64')})
  assert.equal(upload.statusCode,200,upload.body)
  const materialId=upload.json().id
  let callback
  f.workers.run=async(p,_text,onEvent)=>{
    callback=onEvent;started.resolve()
    if(onEvent){
      onEvent({stage:secret,label:secret,text:secret})
      onEvent({stage:'completed',label:'回调不能冒充任务完成'})
      for(let i=0;i<200;i++)onEvent({stage:'reading_material',label:secret,arguments:secret,reasoning:secret,updatedAt:'1900-01-01'})
    }
    await release.promise
    const file=(await f.db.query('SELECT * FROM materials WHERE id=$1',[materialId])).rows[0]
    return{response:JSON.stringify(draft(materialId)),materialReads:[readFixture({...file,sourceRelativePath:relative(p.workspace,file.path)})]}
  }
  const accepted=await f.post('/outline/draft',{outlineVersion:0,text:'核对原始资料'})
  assert.equal(accepted.statusCode,200,accepted.body);await started.promise
  try{
    assert.equal(typeof callback,'function','普通 Agent 任务必须接入进度回调')
    const id=accepted.json().id
    const running=await until(f.state,s=>s.jobs.find(j=>j.id===id)?.progress?.stage==='reading_material')
    const job=running.jobs.find(j=>j.id===id)
    assert.equal(job.status,'running');assert.ok(Number.isFinite(Date.parse(job.started_at)));assert.equal(job.finished_at,null)
    assert.match(job.progress.label,/读取资料/);assert.ok(Math.abs(Date.now()-Date.parse(job.progress.updatedAt))<5000)
    assert.deepEqual(Object.keys(job.progress).sort(),['label','stage','updatedAt'])
    const stored=(await f.db.query('SELECT progress FROM jobs WHERE id=$1',[id])).rows[0].progress
    assert.deepEqual(stored,job.progress);assert.deepEqual((await f.state()).jobs.find(j=>j.id===id).progress,stored)
    const eventRows=(await f.db.query("SELECT seq,data FROM events WHERE project_id=$1 AND data->>'type'='task-progress' ORDER BY seq",[f.project.id])).rows
    const events=eventRows.map(row=>row.data)
    assert.ok(events.length>=1&&events.length<=3,'200条相同活动不应逐条写库/推送')
    assert.ok(events.some(e=>e.id===id&&e.status==='running'&&e.progress.stage==='reading_material'))
    assert.ok(!events.some(e=>e.progress.stage==='completed'))
    assert.doesNotMatch(JSON.stringify({stored,events}),new RegExp(secret))
    const address=await f.app.listen({host:'127.0.0.1',port:0}),streamController=new AbortController()
    try{
      const last=eventRows.at(-1),response=await fetch(`${address}${f.base}/events`,{
        headers:{authorization:`Bearer ${'a'.repeat(40)}`,'last-event-id':String(Number(last.seq)-1)},signal:streamController.signal,
      })
      assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/)
      const reader=response.body.getReader();let wire=''
      while(!wire.includes('reading_material')){const {value,done}=await reader.read();if(done)break;wire+=new TextDecoder().decode(value)}
      const streamed=wire.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)))
      assert.deepEqual(streamed.find(e=>e.id===id&&e.type==='task-progress').progress,stored)
      assert.match(wire,new RegExp(`id: ${last.seq}`));assert.doesNotMatch(wire,new RegExp(secret))
    }finally{streamController.abort()}
    assert.equal((await f.request('GET',f.base+'/state',undefined,1)).statusCode,404)
    release.resolve();await f.app.waitForJobs()
    const done=(await f.state()).jobs.find(j=>j.id===id)
    assert.equal(done.status,'completed');assert.equal(done.progress.stage,'completed')
    assert.ok(Date.parse(done.finished_at)>=Date.parse(done.started_at))
    callback({stage:'tool_running'});await new Promise(resolve=>setImmediate(resolve))
    assert.deepEqual((await f.state()).jobs.find(j=>j.id===id).progress,done.progress,'迟到活动不能覆盖真实终态')
    await f.restart();assert.deepEqual((await f.state()).jobs.find(j=>j.id===id),done)
  }finally{release.resolve()}
})

test('同项目沟通可排队；排队取消和运行取消分别保留真实起止时间与终态',async t=>{
  const f=await fixture(t),started=deferred();let calls=0,callback
  f.workers.run=async(_p,_text,onEvent,_policy,signal)=>{
    calls++;callback=onEvent;started.resolve()
    await new Promise((resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true})})
    return{response:'不可到达'}
  }
  const first=(await f.post('/chat',{text:'运行中'})).json();await started.promise
  const second=await f.post('/chat',{text:'等待执行'});assert.equal(second.statusCode,200,second.body)
  const queued=(await f.state()).jobs.find(j=>j.id===second.json().id)
  assert.equal(queued.status,'queued');assert.equal(queued.started_at,null);assert.equal(queued.finished_at,null);assert.equal(queued.progress.stage,'queued')
  const cancelled=await f.request('POST',`${f.base}/jobs/${queued.id}/cancel`,{})
  assert.equal(cancelled.json().status,'cancelled')
  const queuedEnd=(await f.state()).jobs.find(j=>j.id===queued.id)
  assert.equal(queuedEnd.status,'cancelled');assert.equal(queuedEnd.started_at,null);assert.ok(queuedEnd.finished_at);assert.equal(queuedEnd.progress.stage,'cancelled')
  const cancelling=await f.request('POST',`${f.base}/jobs/${first.id}/cancel`,{})
  assert.equal(cancelling.json().status,'cancelling');await f.app.waitForJobs()
  const ended=(await f.state()).jobs.find(j=>j.id===first.id)
  assert.equal(ended.status,'cancelled');assert.equal(ended.progress.stage,'cancelled');assert.ok(ended.started_at&&ended.finished_at);assert.equal(calls,1)
  callback?.({stage:'generating'});await new Promise(resolve=>setImmediate(resolve))
  assert.deepEqual((await f.state()).jobs.find(j=>j.id===first.id),ended)
})

test('错误及结果未知分别保持failed和interrupted，不泄漏内部错误或误报完成',async t=>{
  const f=await fixture(t)
  for(const [code,expected] of [['INTERNAL_TEST_FAILURE','failed'],['AGENT_TURN_NOT_COMPLETED','interrupted']]){
    f.workers.run=async(_p,_text,onEvent)=>{onEvent?.({stage:'tool_running'});throw Object.assign(new Error('SECRET_RAW_STACK'),{code})}
    const job=(await f.post('/chat',{text:code})).json();await f.app.waitForJobs()
    const ended=(await f.state()).jobs.find(j=>j.id===job.id)
    assert.equal(ended.status,expected);assert.equal(ended.progress.stage,expected);assert.ok(ended.started_at&&ended.finished_at)
    assert.doesNotMatch(JSON.stringify(ended),/SECRET_RAW_STACK/)
  }
})

test('research/report进度使用同一脱敏存储，partial与unreviewed不转换为成功',async t=>{
  const f=await fixture(t);await confirmedOutlineFixture(f.db,f.project.id)
  for(const [route,method,body,status] of [
    ['/research','runResearch',{moduleIds:['1.01'],flags:{industryPlanning:false,existingBuildings:false,externalPartners:false,marketing:false}},'partial'],
    ['/reports','runReport',{mode:'research-summary',moduleIds:['1.01']},'unreviewed'],
  ]){
    const release=deferred(),started=deferred();t.after(()=>release.resolve())
    f.workers[method]=async(_p,_selection,_snapshot,onEvent)=>{
      onEvent({type:method==='runResearch'?'research-progress':'report-progress',status:'running',modules:[{raw:'PRIVATE_MODULE_DETAIL'}]});started.resolve()
      await release.promise;return{status}
    }
    const accepted=await f.post(route,body);assert.equal(accepted.statusCode,200,accepted.body);await started.promise
    try{
      const running=await until(f.state,s=>s.jobs.find(j=>j.id===accepted.json().id)?.progress?.stage===(method==='runResearch'?'research_running':'report_running'))
      assert.doesNotMatch(JSON.stringify(running.jobs.at(-1).progress),/PRIVATE_MODULE_DETAIL/)
    }finally{release.resolve()}
    await f.app.waitForJobs();const ended=(await f.state()).jobs.find(j=>j.id===accepted.json().id)
    assert.equal(ended.status,status);assert.equal(ended.progress.stage,status)
  }
})

test('编排讨论显式只读，不隐式更改既有已确认流程',async t=>{
  const f=await fixture(t);await confirmedOutlineFixture(f.db,f.project.id)
  const before=(await f.state()).outline,readOnly=[],prompts=[]
  f.workers.run=async(p,text)=>{readOnly.push(p.read_only);prompts.push(text);return{response:'仅讨论章节，不确认新流程'}}
  const accepted=await f.post('/chat',{text:'讨论调整章节顺序',discussionOnly:true,discussionFlow:['03','01','11']})
  assert.equal(accepted.statusCode,200,accepted.body);await f.app.waitForJobs()
  assert.deepEqual(readOnly,[true]);assert.deepEqual((await f.state()).outline,before)
  assert.match(prompts[0],/章节编排讨论/);assert.doesNotMatch(prompts[0],/当前资料条件尚不足/,'讨论模式不能虚构资料不具备的结论')
  assert.match(prompts[0],/当前编辑器中的章节顺序（仅为讨论快照，未提交核对或确认）：\["03","01","11"\]/)
  for(const body of [{discussionFlow:['03']},{discussionOnly:true,discussionFlow:['03','03']},{discussionOnly:true,discussionFlow:['99']}])assert.equal((await f.post('/chat',{text:'非法讨论快照',...body})).statusCode,400)
  const regular=await f.post('/chat',{text:'处理已确认流程'});assert.equal(regular.statusCode,200,regular.body);await f.app.waitForJobs()
  assert.deepEqual(readOnly,[true,false])
})

test('服务重启把未收尾运行标为interrupted，不伪造结束时刻或重复调用模型',async t=>{
  const f=await fixture(t),id=randomUUID(),startedAt=new Date(Date.now()-10000).toISOString();let calls=0
  f.workers.run=async()=>{calls++;return{response:'不应重放'}}
  await f.db.query(`INSERT INTO jobs(id,project_id,request_id,fingerprint,kind,payload,status,started_at,progress)
    VALUES($1,$2,'simulated-crash','crash','chat',$3,'running',$4,$5)`,[id,f.project.id,{baseRevision:0},startedAt,
      {stage:'reading_material',label:'正在读取资料',updatedAt:startedAt}])
  await f.restart();await f.app.waitForJobs()
  const recovered=(await f.state()).jobs.find(job=>job.id===id)
  assert.equal(recovered.status,'interrupted');assert.equal(recovered.progress.stage,'interrupted')
  assert.equal(recovered.started_at,startedAt);assert.equal(recovered.finished_at,null);assert.equal(calls,0)
  const progress=recovered.progress
  await f.restart();assert.deepEqual((await f.state()).jobs.find(job=>job.id===id).progress,progress)
})
