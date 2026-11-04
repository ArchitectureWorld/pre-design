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
const content=()=>({blocks:[
  {id:'outline-01-1',items:[{title:'项目区位',paragraphs:[],points:['任务书提供项目所在地。'],evidenceIndexes:[0]}],internalNotes:['项目边界待核实。']},
  {id:'outline-03-1',items:[{title:'发展方向的适用条件',paragraphs:[],points:['具体用途取决于项目实施条件。'],evidenceIndexes:[]}],internalNotes:[]},
]})
async function fixture(t,{confirmed=true}={}){
  const pool=new pg.Pool(connection),schema='workflow_api_'+randomUUID().replaceAll('-','')
  await pool.query(`CREATE SCHEMA ${schema}`)
  const db=new pg.Pool({...connection,options:`-c search_path=${schema}`}),root=await mkdtemp(join(tmpdir(),'workflow-api-')),contexts=new Map(),calls=[]
  const workers={async call(p,body){
    if(body.operation==='create')contexts.set(p.id,{project:{projectId:p.id,currentRevision:0},proposals:[],stateObjects:[]})
    return structuredClone(contexts.get(p.id))
  },async run(p,text,onEvent,policy,signal){calls.push({readOnly:p.read_only,text,policy,signal});onEvent?.({stage:'generating'});return{response:JSON.stringify(content()),eventCount:3}},
  async listArtifacts(){return[{id:'core-artifact',filename:'核心成果.md'}]},async readArtifact(_p,id){if(id!=='core-artifact')throw Object.assign(new Error('unknown core artifact'),{statusCode:404});return{filename:'核心成果.md',contentType:'text/markdown',data:'核心成果'}},async close(){},async closeAll(){}}
  const users=[{id:'admin',role:'admin',token:'a'.repeat(40)},{id:'other',token:'b'.repeat(40)}]
  let app=await createApp({db,workers,projectsRoot:root,users})
  t.after(async()=>{await app.close();await db.end();await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();await rm(root,{recursive:true,force:true})})
  const request=(method,url,payload,user=0)=>app.inject({method,url,headers:{authorization:`Bearer ${users[user].token}`},...(payload!==undefined?{payload}:{})})
  const policy=(await request('GET','/api/admin/models')).json(),model=policy.models.find(row=>row.provider==='SenseNova'&&row.model==='sensenova-6.8-flash-lite')
  model.status='verified';model.capabilities.tools=true
  assert.equal((await request('PUT','/api/admin/models',{expectedRevision:policy.revision,policy})).statusCode,200)
  const project=(await request('POST','/api/projects',{requestId:'create',name:'阶段初稿隔离测试'})).json(),base=`/api/projects/${project.id}`
  const post=(path,body={})=>request('POST',base+path,{requestId:randomUUID(),baseRevision:0,...body})
  const upload=await post('/materials',{filename:'任务书.txt',content:Buffer.from('任务书提供项目所在地。').toString('base64')})
  assert.equal(upload.statusCode,200,upload.body)
  if(confirmed){
    await confirmedOutlineFixture(db,project.id)
    const value=draft(upload.json().id);value.questions=[]
    await db.query('UPDATE outline_versions SET draft=$2,flow=$3,retained_waivers=$4 WHERE project_id=$1',[project.id,value,JSON.stringify(['01','03']),JSON.stringify([{questionId:'goal',prompt:'本次策划需要支持什么决策？',reason:'用户本轮暂不补充，先整理现有资料',chapterIds:['03'],userId:'admin',createdAt:new Date().toISOString(),version:1}])])
  }
  return{db,workers,calls,project,base,request,post,get app(){return app},
    async restart(){await app.close();app=await createApp({db,workers,projectsRoot:root,users})},
    async state(){const result=await request('GET',base+'/state');assert.equal(result.statusCode,200,result.body);return result.json()},
    async generate(body={}){const result=await post('/workflow/draft',{outlineVersion:1,...body});assert.equal(result.statusCode,200,result.body);await app.waitForJobs();return result.json()},
  }
}

test('已确认流程可生成只读阶段稿，完成请求可重试，刷新恢复及导出保留专业门槛',async t=>{
  const f=await fixture(t),body={requestId:'initial-draft',outlineVersion:1}
  const accepted=await f.post('/workflow/draft',body)
  assert.equal(accepted.statusCode,200,accepted.body)
  await f.app.waitForJobs()
  const s=await f.state(),document=s.workflow.current,job=s.jobs.find(row=>row.id===accepted.json().id)
  assert.equal(job.kind,'workflow');assert.equal(job.status,'completed');assert.equal(job.progress.stage,'completed')
  assert.equal(document.version,1);assert.deepEqual(document.flow,['01','03']);assert.deepEqual(document.blocks.map(block=>block.id),['outline-01-1','outline-03-1'])
  assert.deepEqual(document.blocks[0].items,[{...content().blocks[0].items[0],id:'outline-01-1-item-1'}]);assert.deepEqual(document.reviewedBlockIds,[])
  assert.equal(job.result.workflowDraftId,document.id);assert.equal(job.result.workflowVersion,1)
  assert.doesNotMatch(job.result.response,/"blocks"/);assert.equal(s.revision,0);assert.deepEqual(s.core.proposals,[])
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].readOnly,true);assert.ok(f.calls[0].policy.routes.parent)
  assert.match(f.calls[0].text,/任务书\.txt/);assert.match(f.calls[0].text,/用户本轮暂不补充/)
  const stored=(await f.db.query('SELECT payload,policy_snapshot FROM jobs WHERE id=$1',[job.id])).rows[0]
  assert.equal(stored.payload.baseDraftId,null);assert.match(stored.payload.outlineInputHash,/^[a-f0-9]{64}$/)
  assert.ok(stored.policy_snapshot.routes.parent)
  const retried=await f.post('/workflow/draft',body);assert.equal(retried.statusCode,200,retried.body);assert.equal(retried.json().id,job.id);assert.equal(retried.json().status,'completed')
  assert.equal((await f.post('/workflow/draft',{...body,text:'changed'})).statusCode,409)
  assert.equal(f.calls.length,1)
  const denied=await f.post('/research',{moduleIds:['1.01'],flags:{industryPlanning:false,existingBuildings:false,externalPartners:false,marketing:false}})
  assert.equal(denied.statusCode,409,denied.body)
  const artifacts=(await f.request('GET',f.base+'/artifacts')).json()
  assert.ok(artifacts.some(artifact=>artifact.id==='core-artifact'))
  for(const extension of ['html','md']){
    const id=`workflow-${document.id}-${extension}`
    assert.ok(artifacts.some(artifact=>artifact.id===id),JSON.stringify(artifacts))
    const exported=await f.request('GET',`${f.base}/artifacts/${id}`)
    assert.equal(exported.statusCode,200,exported.body);assert.match(exported.body,/任务书提供项目所在地/)
    assert.match(exported.headers['content-disposition'],/attachment/);assert.match(exported.headers['content-security-policy'],/sandbox/)
  }
  assert.equal((await f.request('GET',f.base+'/artifacts/core-artifact')).body,'核心成果')
  await f.restart();assert.deepEqual((await f.state()).workflow,s.workflow)
})

test('阶段稿严格校验请求字段，未确认、旧版本与跨用户请求不进入队列',async t=>{
  const f=await fixture(t,{confirmed:false})
  assert.deepEqual((await f.state()).workflow,{current:null,history:[],visuals:{current:null,history:[]}})
  const missing=await f.post('/workflow/draft',{outlineVersion:0})
  assert.equal(missing.statusCode,409,missing.body);assert.match(missing.json().code,/^WORKFLOW_/)
  for(const invalid of [
    {},{outlineVersion:-1},{outlineVersion:0,unexpected:true},{outlineVersion:0,baseDraftId:'not-a-uuid'},
    {outlineVersion:0,blockId:'outline-01-1',text:'请修改'},
    {outlineVersion:0,baseDraftId:randomUUID(),text:'请修改'},
    {outlineVersion:0,baseDraftId:randomUUID(),blockId:'outline-01-1',text:'   '},
    {outlineVersion:0,text:'x'.repeat(16001)},{outlineVersion:0,blockId:'../../escape'},
    {outlineVersion:0,requestId:'contains spaces'},{outlineVersion:0,baseRevision:0.5},
  ])assert.equal((await f.post('/workflow/draft',invalid)).statusCode,400,JSON.stringify(invalid))
  assert.equal((await f.post('/workflow/review',{draftId:randomUUID(),blockId:'outline-01-1',unexpected:true})).statusCode,400)
  assert.equal((await f.request('POST',f.base+'/workflow/draft',{requestId:'foreign',baseRevision:0,outlineVersion:0},1)).statusCode,404)
  assert.equal((await f.request('GET',f.base+'/state',undefined,1)).statusCode,404)
  assert.equal((await f.state()).jobs.length,0);assert.equal(f.calls.length,0)
})

test('逐节修订形成新版本，审阅幂等并绑定当前稿，旧稿仍可下载且不跨项目',async t=>{
  const f=await fixture(t)
  await f.generate();const first=(await f.state()).workflow.current
  const review={requestId:'review-first',draftId:first.id,blockId:'outline-01-1'}
  assert.equal((await f.post('/workflow/review',review)).statusCode,200)
  assert.equal((await f.post('/workflow/review',review)).statusCode,200)
  assert.deepEqual((await f.state()).workflow.current.reviewedBlockIds,['outline-01-1'])
  assert.equal((await f.post('/workflow/review',{...review,blockId:'outline-03-1'})).statusCode,409)
  assert.equal((await f.post('/workflow/review',{draftId:first.id,blockId:'outline-01-1',baseRevision:1})).statusCode,409)
  assert.equal((await f.request('POST',f.base+'/workflow/review',{...review,baseRevision:0},1)).statusCode,404)
  const oldExport=(await f.request('GET',`${f.base}/artifacts/workflow-${first.id}-md`)).body
  f.workers.run=async()=>({response:JSON.stringify({blocks:[{id:'outline-01-1',items:[{title:'项目区位',paragraphs:[],points:['修订后明确：本轮仅整理资料，<script>alert("XSS")</script> 不构成可实施结论。'],evidenceIndexes:[0]}],internalNotes:[]}]})})
  await f.generate({baseDraftId:first.id,blockId:'outline-01-1',text:'明确本轮只整理资料'})
  const s=await f.state(),second=s.workflow.current
  assert.equal(second.version,2);assert.notEqual(second.id,first.id)
  assert.deepEqual(second.blocks[1],first.blocks[1]);assert.match(second.blocks[0].body,/修订后明确/)
  assert.deepEqual(second.reviewedBlockIds,[]);assert.equal(s.workflow.history.length,2)
  assert.equal((await f.request('GET',`${f.base}/artifacts/workflow-${first.id}-md`)).body,oldExport)
  const html=await f.request('GET',`${f.base}/artifacts/workflow-${second.id}-html`)
  assert.equal(html.statusCode,200);assert.doesNotMatch(html.body,/<script>/i);assert.match(html.body,/&lt;script&gt;/)
  assert.equal((await f.post('/workflow/draft',{outlineVersion:1,baseDraftId:first.id,blockId:'outline-01-1',text:'过期修改'})).statusCode,409)
  assert.equal((await f.post('/workflow/review',{draftId:first.id,blockId:'outline-03-1'})).statusCode,409)
  assert.equal((await f.post('/workflow/review',{draftId:second.id,blockId:'outline-02-1'})).statusCode,404)
  const other=(await f.request('POST','/api/projects',{requestId:'other',name:'同用户另一个项目'})).json()
  assert.equal((await f.request('GET',`/api/projects/${other.id}/artifacts/workflow-${second.id}-html`)).statusCode,404)
  assert.equal((await f.request('GET',`${f.base}/artifacts/workflow-${second.id}-html`,undefined,1)).statusCode,404)
  assert.equal((await f.request('GET',`${f.base}/artifacts/workflow-${randomUUID()}-html`)).statusCode,404)
  assert.equal((await f.request('GET',`${f.base}/artifacts/workflow-bad-html`)).statusCode,404)
  await f.post('/materials',{filename:'新补充.txt',content:Buffer.from('补充项目条件').toString('base64')})
  assert.equal((await f.state()).workflow.current.stale,true)
  assert.equal((await f.post('/workflow/review',{draftId:second.id,blockId:'outline-01-1'})).statusCode,409)
  assert.equal((await f.post('/workflow/draft',{outlineVersion:1,baseDraftId:second.id,blockId:'outline-01-1',text:'旧资料稿不能继续修订'})).statusCode,409)
  assert.equal((await f.request('GET',`${f.base}/artifacts/workflow-${second.id}-md`)).statusCode,200)
  assert.equal((await f.state()).revision,0)
})

test('模型结构不完整、越界引用或执行期间输入变化时失败，不保存伪完整阶段稿',async t=>{
  const f=await fixture(t)
  for(const value of ['not JSON',JSON.stringify({blocks:[content().blocks[0]]}),JSON.stringify({blocks:content().blocks.map(block=>({...block,items:block.items.map(item=>({...item,evidenceIndexes:[999]}))}))})]){
    f.workers.run=async()=>({response:value})
    const accepted=await f.generate(),s=await f.state(),job=s.jobs.find(row=>row.id===accepted.id)
    assert.equal(job.status,'failed',JSON.stringify(job));assert.equal(job.progress.stage,'failed')
    assert.match(job.error,/初稿|正文|段落|引用|章节|内容|生成|返回|任务|块/)
    assert.equal(s.workflow.current,null);assert.deepEqual(s.workflow.history,[])
  }
  const started=Promise.withResolvers(),release=Promise.withResolvers()
  f.workers.run=async()=>{started.resolve();await release.promise;return{response:JSON.stringify(content())}}
  const queued=await f.post('/workflow/draft',{outlineVersion:1});assert.equal(queued.statusCode,200,queued.body)
  await started.promise
  await f.db.query("UPDATE projects SET metadata=jsonb_set(metadata,'{brief}','\"外部更新任务说明\"'::jsonb) WHERE id=$1",[f.project.id])
  release.resolve();await f.app.waitForJobs()
  const s=await f.state(),job=s.jobs.find(row=>row.id===queued.json().id)
  assert.equal(job.status,'failed');assert.equal(s.workflow.current,null);assert.deepEqual(s.workflow.history,[])
  assert.equal(s.revision,0)
})

test('运行取消不保存新稿，任务忙时不接受并发生成或审阅',async t=>{
  const f=await fixture(t)
  await f.generate();const first=(await f.state()).workflow.current,started=Promise.withResolvers()
  f.workers.run=async(_p,_text,onEvent,_policy,signal)=>{
    onEvent({stage:'generating'});started.resolve()
    await new Promise((resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true})})
    return{response:JSON.stringify(content())}
  }
  const body={requestId:'cancelled-revision',outlineVersion:1,baseDraftId:first.id,blockId:'outline-01-1',text:'修改当前本节'}
  const accepted=await f.post('/workflow/draft',body);assert.equal(accepted.statusCode,200,accepted.body)
  await started.promise
  const busy=await f.post('/workflow/review',{draftId:first.id,blockId:'outline-01-1'})
  assert.equal(busy.statusCode,409,busy.body);assert.equal(busy.json().code,'WORKFLOW_BUSY')
  assert.equal((await f.post('/workflow/draft',{outlineVersion:1})).statusCode,409)
  const cancelled=await f.request('POST',`${f.base}/jobs/${accepted.json().id}/cancel`,{})
  assert.equal(cancelled.json().status,'cancelling');await f.app.waitForJobs()
  const s=await f.state(),job=s.jobs.find(row=>row.id===accepted.json().id)
  assert.equal(job.status,'cancelled');assert.equal(job.progress.stage,'cancelled');assert.deepEqual(s.workflow.current,first)
  assert.equal(s.workflow.history.length,1)
  const retry=await f.post('/workflow/draft',body);assert.equal(retry.json().status,'cancelled');assert.equal(retry.json().id,job.id)
})

test('模型返回后但最终落盘前取消，仍不保存阶段稿',async t=>{
  const f=await fixture(t),finishing=Promise.withResolvers(),release=Promise.withResolvers()
  f.workers.executionTrace=async()=>{finishing.resolve();await release.promise;return{parent:{status:'recorded',requests:[]},executions:[],usage:null}}
  const accepted=await f.post('/workflow/draft',{outlineVersion:1});assert.equal(accepted.statusCode,200,accepted.body)
  await finishing.promise
  const cancelled=await f.request('POST',`${f.base}/jobs/${accepted.json().id}/cancel`,{})
  assert.equal(cancelled.json().status,'cancelling')
  release.resolve();await f.app.waitForJobs()
  const s=await f.state(),job=s.jobs.find(row=>row.id===accepted.json().id)
  assert.equal(job.status,'cancelled');assert.equal(s.workflow.current,null);assert.deepEqual(s.workflow.history,[])
})

test('重启只恢复已有持久稿的中断任务，不重跑模型或将取消任务当作恢复',async t=>{
  const f=await fixture(t)
  const accepted=await f.generate(),first=(await f.state()).workflow.current
  await f.db.query("UPDATE jobs SET status='running',result=NULL,finished_at=NULL WHERE id=$1",[accepted.id])
  await f.restart()
  const s=await f.state(),job=s.jobs.find(row=>row.id===accepted.id)
  assert.equal(job.status,'recovered');assert.equal(job.progress.stage,'recovered');assert.equal(job.finished_at,null)
  assert.equal(job.result.workflowDraftId,first.id);assert.equal(job.result.workflowVersion,1);assert.match(job.result.response,/恢复/)
  assert.deepEqual(s.workflow.current,first);assert.equal(f.calls.length,1)
  await f.db.query("UPDATE jobs SET status='cancelled' WHERE id=$1",[accepted.id])
  await f.restart();assert.equal((await f.state()).jobs.find(row=>row.id===accepted.id).status,'cancelled');assert.equal(f.calls.length,1)
})
