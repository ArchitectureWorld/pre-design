import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,relative} from 'node:path'
import pg from 'pg'
import {createApp} from '../src/server.mjs'
import {draft,readFixture} from './fixtures/outline.mjs'
import {readInputs} from '../src/dossier/store.mjs'
import {nextSnapshot} from '../src/dossier/contract.mjs'

test('真实会话派生分章草案，改写或暂缓经核对后才可确认并进入脚本',async t=>{
  const connection={host:'/tmp/pre-design-pg-1000',port:55439,database:'pre_design_web',user:'zetta'}
  const pool=new pg.Pool(connection),schema='outline_plan_'+randomUUID().replaceAll('-','')
  await pool.query('CREATE SCHEMA '+schema)
  const db=new pg.Pool({...connection,options:'-c search_path='+schema})
  const root=await mkdtemp(join(tmpdir(),'outline-plan-')),contexts=new Map(),calls=[]
  const users=[{id:'owner',token:'p'.repeat(40),role:'admin'},{id:'other',token:'q'.repeat(40)}]
  let fileId
  const note='建议先核实居民通行和日常管护，村内教育作为备选。'
  const workers={
    async call(p,body){if(body.operation==='create')contexts.set(p.id,{project:{projectId:p.id,currentRevision:0},proposals:[],stateObjects:[]});return contexts.get(p.id)},
    async run(p,text){
      const job=(await db.query('SELECT kind,payload FROM jobs WHERE id=$1',[p.task_id])).rows[0]
      calls.push({text,readOnly:p.read_only,job})
      if(job.kind==='chat')return {response:note,eventCount:1}
      if(job.kind==='workflow'){
        return {eventCount:1,response:JSON.stringify({reportTitle:'片区发展条件',blocks:['日常通行','居民服务'].map((heading,i)=>({id:'outline-03-'+(i+1),heading,sectionText:heading+'是本区的研究主题。',sectionEvidenceIndexes:[0],items:[{title:heading+'要点',points:['居民日常通行涉及村间联系。'],paragraphs:['通行关系是服务方向之一。'],presentation:{layout:'points',note:'列出服务对象。'},evidenceIndexes:[0]}],internalNotes:[]}))})}
      }
      if(job.payload.planningMode==='adjust')return {eventCount:1,response:JSON.stringify({changes:[
        {id:'03',reason:'聚焦通行',tasks:['补充进出点位调查'],questions:['走访哪些村？'],evidenceIndexes:[0]},
        {id:'04',reason:'对应方向调整访谈',tasks:['访谈村民和管护人员'],questions:[],evidenceIndexes:[0]}]})}
      const value=draft(fileId),f=(await db.query('SELECT * FROM materials WHERE id=$1',[fileId])).rows[0]
      value.chapters[2].tasks=['调查通行','研究教育条件']
      value.questions.push({id:'education_option',prompt:'是否同时核对教育服务需求？',reason:'影响本轮调查深度。',chapterIds:['03','04'],blocking:false})
      return {eventCount:1,response:JSON.stringify(value),materialReads:[readFixture({...f,sourceRelativePath:relative(p.workspace,f.path)})]}
    },async closeAll(){}
  }
  let app=await createApp({db,users,workers,projectsRoot:root})
  t.after(async()=>{await app.close();await db.end();await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();await rm(root,{recursive:true,force:true})})
  const req=(method,url,payload,who=0)=>app.inject({method,url,headers:{authorization:'Bearer '+users[who].token},...(payload?{payload}:{})})
  const policy=(await req('GET','/api/admin/models')).json()
  const model=policy.models.find(x=>x.provider==='SenseNova'&&x.model==='sensenova-6.8-flash-lite')
  model.status='verified';model.capabilities.tools=true
  assert.equal((await req('PUT','/api/admin/models',{expectedRevision:policy.revision,policy})).statusCode,200)
  const project=(await req('POST','/api/projects',{name:'章节衔接验收',requestId:randomUUID()})).json()
  const base='/api/projects/'+project.id
  const post=(route,fields,who=0)=>req('POST',base+route,{requestId:randomUUID(),baseRevision:0,...fields},who)
  const state=async()=>(await req('GET',base+'/state')).json()
  const file=await post('/materials',{filename:'任务书.txt',content:Buffer.from('任务书提供项目所在地。').toString('base64')})
  assert.equal(file.statusCode,200,file.body);fileId=file.json().id
  async function waitJob(route,fields){
    const accepted=await post(route,fields);assert.equal(accepted.statusCode,200,accepted.body)
    await app.waitForJobs()
    const s=await state(),job=s.jobs.find(row=>row.id===accepted.json().id)
    assert.equal(job.status,'completed',JSON.stringify(job));return {s,job}
  }
  const projectRow=(await db.query('SELECT * FROM projects WHERE id=$1',[project.id])).rows[0]
  const inputs=await readInputs(db,projectRow)
  const dossier=nextSnapshot(null,{projectId:project.id,inputHash:inputs.inputHash,sources:inputs.sources})
  await db.query('INSERT INTO pd_dossier_versions(project_id,revision,input_hash,snapshot_hash,payload) VALUES($1,1,$2,$3,$4)',[project.id,dossier.inputHash,dossier.snapshotHash,dossier])
  const {job:chat}=await waitJob('/chat',{text:'讨论首轮方向',discussionOnly:true})
  const old=await waitJob('/outline/draft',{outlineVersion:0,text:'',flow:['03','04','01']})
  assert.equal(old.s.outline.flowReviewed,true)
  const handoff={outlineVersion:1,planningMode:'fromDiscussion',sourceJobId:chat.id}
  assert.equal((await post('/outline/draft',handoff,1)).statusCode,404)
  assert.equal((await post('/outline/draft',{...handoff,sourceJobId:old.job.id})).statusCode,404)
  let {s}=await waitJob('/outline/draft',handoff)
  assert.deepEqual(s.outline.flow,['03','04','01'])
  assert.equal(s.outline.flowReviewed,false);assert.equal(s.outline.confirmedAt,null)
  assert.equal(s.outline.planning.source.jobId,chat.id)
  assert.equal(s.outline.planning.source.dossierRevision,1);assert.deepEqual(s.outline.planning.dossier,{revision:1,hash:dossier.snapshotHash})
  assert.ok(calls.at(-1).text.includes(note));assert.ok(calls.at(-1).readOnly)
  const confirm=()=>({version:s.outline.version,inputHash:s.outline.inputHash})
  assert.equal((await post('/outline/confirm',confirm())).statusCode,409)
  assert.equal((await post('/outline/draft',{...handoff,outlineVersion:2})).statusCode,409)
  const edit={requestId:'edit',version:2,planningRevision:0,chapterId:'03',index:0,action:'adopt',text:'走访村民核实通行点位'}
  assert.equal((await post('/outline/tasks',edit)).statusCode,200)
  assert.equal((await post('/outline/tasks',edit)).statusCode,200)
  assert.equal((await post('/outline/tasks',{...edit,text:'重用请求编号'})).statusCode,409)
  assert.equal((await post('/outline/tasks',{...edit,requestId:'stale'})).statusCode,409)
  assert.equal((await post('/outline/tasks',{...edit,requestId:'cross'},1)).statusCode,404)
  assert.equal((await post('/outline/tasks',{version:2,planningRevision:1,chapterId:'03',index:1,action:'defer'})).statusCode,200)
  s=(await waitJob('/outline/draft',{outlineVersion:2,planningMode:'adjust',planningRevision:2,targetChapterId:'03',text:'同步调整访谈重点，保留管护任务。',flow:['03','04','01']})).s
  assert.equal(s.outline.flowReviewed,false)
  assert.deepEqual(s.outline.planning.changed,['03','04'])
  assert.equal(s.outline.planning.entries['03'][1].state,'deferred')
  assert.equal(s.outline.planning.entries['03'][0].text,edit.text)
  assert.equal((await post('/outline/tasks',{version:3,planningRevision:0,chapterId:'03',index:2,action:'defer'})).statusCode,200)
  const selected=['03']
  s=(await waitJob('/outline/draft',{outlineVersion:3,planningMode:'check',planningRevision:1,flow:selected})).s
  assert.equal(s.outline.flowReviewed,true);assert.deepEqual(s.outline.flow,selected)
  assert.deepEqual(s.outline.draft.chapters[2].tasks,[edit.text])
  assert.deepEqual(s.outline.draft.questions.map(q=>q.id),['goal','education_option'])
  assert.equal((await post('/outline/confirm',confirm())).statusCode,409)
  assert.equal((await post('/outline/decisions',{...confirm(),questionId:'goal',action:'skip',reason:'本轮先摸底'})).statusCode,200)
  assert.equal((await post('/outline/confirm',confirm())).statusCode,200)
  assert.equal((await post('/outline/tasks',{version:4,planningRevision:0,chapterId:'03',index:0,action:'defer'})).statusCode,409)
  s=(await waitJob('/workflow/draft',{outlineVersion:4})).s
  assert.equal(s.workflow.current.blocks.length,2);assert.equal(s.workflow.current.blocks[0].taskTitle,edit.text);assert.equal(s.workflow.current.blocks[0].title,'日常通行')
  assert.ok(s.workflow.current.blocks[0].limitations.includes('本轮暂缓：研究教育条件'))
  assert.ok(s.workflow.current.blocks[0].limitations.includes('待用户决定：是否同时核对教育服务需求？'))
  assert.ok(!s.workflow.current.limitations.some(s=>s.includes('是否同时核对教育服务需求')))
  assert.equal(s.workflow.current.approval,null);assert.equal(s.workflow.visuals.current,null)
  await app.close();app=await createApp({db,users,workers,projectsRoot:root})
  s=await state();assert.equal(s.outline.planning.source.jobId,chat.id);assert.equal(s.outline.status,'confirmed')
  assert.equal(s.outline.planning.entries['03'][0].state,'adopted')
})
