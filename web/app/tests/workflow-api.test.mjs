import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import {randomUUID} from 'node:crypto'
import {createHash} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createApp} from '../src/server.mjs'
import {confirmedOutlineFixture,draft} from './fixtures/outline.mjs'

const connection={host:'/tmp/pre-design-pg-1000',port:55439,database:'pre_design_web',user:'zetta'}
const content=()=>({reportTitle:'项目条件与发展方向',blocks:[
 ['outline-01-1','项目区位','任务书提供项目所在地。'],['outline-01-2','河流水系','项目与沿河水系相邻。'],
 ['outline-03-1','发展方向','具体用途取决于项目实施条件。'],['outline-03-2','服务对象','既有服务面向周边居民。']
].map(([id,heading,sectionText])=>({id,heading,sectionText,sectionEvidenceIndexes:[0],items:[{title:heading+'要点',paragraphs:[heading+'具有明确的研究主题。'],points:['项目名称和区位见任务书。'],presentation:{layout:'focus',note:'采用要点卡。'},evidenceIndexes:[0]}],internalNotes:['项目边界待核实。']}))})
test('对应稿件可直接下载独立的对外PDF，内部记录仅留在工作稿且跨项目隔离',async t=>{
 const f=await fixture(t)
 f.workers.run=async()=>({response:JSON.stringify({reportTitle:'沿河片区机会研判',blocks:content().blocks.map((b,i)=>({...b,heading:i?b.heading:'区位与范围',internalNotes:['内部专用：请核实权属？']}))})})
 await f.generate()
 const doc=(await f.state()).workflow.current
 assert.equal(doc?.clientReport?.title,'沿河片区机会研判','模型汇报标题须持久化')
 assert.equal(doc.blocks[0].title,'区位与范围')
 const listing=(await f.request('GET',f.base+'/artifacts')).json()
 const file=listing.find(a=>a.kind==='client-report'&&a.draftId===doc.id)
 assert.ok(file);assert.match(file.filename,/沿河片区机会研判.*\.pdf$/)
 const r=await f.request('GET',f.base+'/artifacts/'+file.id)
 assert.equal(r.statusCode,200,r.body.slice(0,100));assert.equal(r.headers['content-type'],'application/pdf')
 assert.equal(r.rawPayload.subarray(0,5).toString(),'%PDF-')
 const {spawnSync}=await import('node:child_process')
 const extracted=spawnSync('pdftotext',['-layout','-','-'],{input:r.rawPayload})
 assert.equal(extracted.status,0,extracted.error?.message??extracted.stderr?.toString()??'PDF text extraction failed');const text=extracted.stdout.toString().replace(/\s/gu,'')
 if(!/沿河片区机会研判/u.test(text)){const raw=spawnSync('pdftotext',['-raw','-','-'],{input:r.rawPayload});assert.equal(raw.status,0,raw.error?.message??raw.stderr?.toString());console.log('[PDF_CONTENT_DIAGNOSTIC]',JSON.stringify({layout:text.slice(0,150),raw:raw.stdout.toString().replace(/\s/gu,'').slice(0,150)}));}assert.match(text,/沿河片区机会研判/);assert.match(text,/项目所在地/);assert.match(text,/资料来源/)
 assert.doesNotMatch(text,/内部专用|内部备注|待审阅|请核实|阶段初稿隔离测试|的本项目研究任务/)
 assert.equal((await f.request('GET',f.base+'/artifacts/'+file.id,undefined,1)).statusCode,404)
})
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

test('平台写稿实际接收官方原文收执，政策进入基本情况和PDF，局部修订保持来源编号',async t=>{
 const f=await fixture(t),policy=(await f.request('GET','/api/admin/models')).json()
 policy.search={provider:'exa',enabled:true,maxQueries:4,maxResults:5,timeoutMs:30000}
 assert.equal((await f.request('PUT','/api/admin/models',{expectedRevision:policy.revision,policy})).statusCode,200)
 const url='https://www.wuhan.gov.cn/policy/test.html',text='武汉市规划。武汉市人民政府。2026年1月1日。统筹推进流域综合治理与生态环境保护。'
 const source={url,title:'武汉市规划',publisher:'武汉市人民政府',publishedDate:'2026年1月1日',scope:'武汉市',quote:'统筹推进流域综合治理与生态环境保护。',summary:'流域治理与生态保护。',status:'正式规划'}
 const policyBlock={...content().blocks[0],id:'outline-01-3',heading:'政策背景',sectionText:'市级规划提出统筹推进流域治理与生态保护的要求。',sectionEvidenceIndexes:[1],items:[{...content().blocks[0].items[0],title:'流域治理与生态保护',paragraphs:['项目策划对接市域生态保护导向。'],points:['统筹推进流域综合治理与生态环境保护。'],evidenceIndexes:[1]}]}
 const body={...content(),policySources:[source],policyGaps:[],blocks:[...content().blocks.slice(0,2),policyBlock,...content().blocks.slice(2)]}
 let forged=false,calls=0
 f.workers.run=async(p,prompt)=>{
  calls++;assert(p.read_only)
  if(calls===2){
   assert(!p.allow_web_read)
   assert(prompt.includes(url))
   return {response:JSON.stringify({blocks:[{id:policyBlock.id,items:[{...policyBlock.items[0],id:'outline-01-3-item-1',title:'生态保护导向'}],internalNotes:[]}]})}
  }
  assert(p.allow_web_read);assert(prompt.includes('R01'));assert(prompt.includes('web_fetch'))
  return {response:JSON.stringify(body),webReads:forged?[]:[{url,text,contentHash:createHash('sha256').update(text).digest('hex'),retrievedAt:'2026-11-14T03:00:00.000Z'}]}
 }
 await f.generate()
 const first=(await f.state()).workflow.current;assert.equal(first?.blocks.length,5)
 assert.equal(first.blocks[2].title,'政策背景');assert.equal(first.evidence[1].url,url);assert.equal(first.clientReport.policyResearch.status,'ready')
 const {clientReportHtml}=await import('../src/client-report.mjs');assert(clientReportHtml(first).includes(url))
 const {workflowRecord,workflowPreviewMarkup}=await import('../src/workflow-ui.js')
 const project=await f.state(),html=workflowPreviewMarkup(workflowRecord(project,first.blocks[2]),{number:'1.3',name:'政策背景'})
 assert(html.includes('官方原文'));assert(html.includes(url))
 await f.generate({baseDraftId:first.id,blockId:policyBlock.id,itemId:'outline-01-3-item-1',text:'精简页名'})
 const revised=(await f.state()).workflow.current;assert.equal(revised.version,2);assert.deepEqual(revised.evidence,first.evidence);assert.equal(revised.blocks[2].items[0].title,'生态保护导向')
 forged=true;const rejected=await f.generate(),after=await f.state()
 assert.equal(after.jobs.find(j=>j.id===rejected.id).status,'failed');assert.equal(after.workflow.current.id,revised.id)
})

test('已确认流程可生成只读阶段稿，完成请求可重试，刷新恢复及导出保留专业门槛',async t=>{
  const f=await fixture(t),body={requestId:'initial-draft',outlineVersion:1}
  const accepted=await f.post('/workflow/draft',body)
  assert.equal(accepted.statusCode,200,accepted.body)
  await f.app.waitForJobs()
  const s=await f.state(),document=s.workflow.current,job=s.jobs.find(row=>row.id===accepted.json().id)
  assert.equal(job.kind,'workflow');assert.equal(job.status,'completed');assert.equal(job.progress.stage,'completed')
  assert.equal(document.version,1);assert.deepEqual(document.flow,['01','03']);assert.deepEqual(document.blocks.map(block=>block.id),['outline-01-1','outline-01-2','outline-03-1','outline-03-2'])
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
  f.workers.run=async()=>({response:JSON.stringify({blocks:[{id:'outline-01-1',heading:'项目区位',sectionText:'原件记载项目的区位信息。',sectionEvidenceIndexes:[0],items:[{title:'项目区位',paragraphs:['区位资料有明确出处。'],presentation:{layout:'focus',note:'使用地名卡。'},points:['修订后明确：本轮仅整理资料，<script>alert("XSS")</script> 不构成可实施结论。'],evidenceIndexes:[0]}],internalNotes:[]}]})})
  await f.generate({baseDraftId:first.id,blockId:'outline-01-1',text:'明确本轮只整理资料'})
  const s=await f.state(),second=s.workflow.current
  assert.equal(second.version,2);assert.notEqual(second.id,first.id)
  assert.deepEqual(second.blocks[1],first.blocks[1]);assert.equal(second.blocks[0].body,'原件记载项目的区位信息。');assert.match(second.blocks[0].items[0].points[0],/修订后明确/)
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

test('写稿自检将夹杂的方法提醒定位到具体页，按原策略只退修一次并仅保存通过的整稿',async t=>{
  const f=await fixture(t),calls=[]
  const bad=content()
  bad.blocks[2].items[0].points=['不能由水库名称直接推定需求。']
  bad.blocks[3].items[0].points=['成立条件：用户确认客群。']
  f.workers.run=async(p,text,_emit,policy,signal)=>{
    calls.push({text,policy,signal,readOnly:p.read_only})
    return {response:JSON.stringify(calls.length===2?content():bad),eventCount:1}
  }
  const first=await f.generate(),s=await f.state()
  assert.equal(calls.length,2)
  assert(calls[1].readOnly);assert.deepEqual(calls[1].policy,calls[0].policy);assert.equal(calls[1].signal,calls[0].signal)
  assert.match(calls[1].text,/outline-03-1-item-1/);assert.match(calls[1].text,/不能由水库名称直接推定需求/)
  assert.match(calls[1].text,/outline-03-2-item-1/);assert.match(calls[1].text,/成立条件：用户确认客群/)
  assert.equal(s.workflow.current.jobId,first.id);assert.equal(s.workflow.history.length,1)
  assert.equal(s.workflow.current.blocks[2].items[0].points[0],content().blocks[2].items[0].points[0])
  const second=await f.generate(),after=await f.state()
  assert.equal(calls.length,4);assert.equal(after.jobs.find(j=>j.id===second.id).status,'failed')
  assert.equal(after.workflow.history.length,1);assert.equal(after.workflow.current.id,s.workflow.current.id)
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
