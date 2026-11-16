import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import serveStatic from '@fastify/static'
import assert from 'node:assert/strict'
import {createTestDb} from '../support/dossier-db.mjs'
import {createApp} from '../../src/server.mjs'
import {createPackage} from '../../src/layout-library/contract.mjs'
import {confirmedOutlineFixture,draft} from '../fixtures/outline.mjs'
import {referenceStageFixture} from '../fixtures/reference-workflow.mjs'

export async function fullLayoutFixture({uploadDelayMs=0,modelDelayMs=250}={}){
 const env=await createTestDb();assert.equal(env.engine,'postgresql','统一工作台浏览器验收需要 PRE_DOSSIER_TEST_DATABASE')
 const root=await mkdtemp(join(tmpdir(),'layout-workbench-')),contexts=new Map(),modelCalls=[]
 const worker={async call(p,b){if(b.operation==='create')contexts.set(p.id,{project:{projectId:p.id,currentRevision:0},proposals:[],stateObjects:[]});return structuredClone(contexts.get(p.id))},
 async run(){return {response:JSON.stringify({reportTitle:'画布验收',blocks:[['outline-01-1','项目区位','任务书提供项目所在地。'],['outline-01-2','资源构成','项目周边具有公共服务设施。']].map(([id,heading,sectionText])=>({id,heading,sectionText,sectionEvidenceIndexes:[0],items:[{title:heading+'图示',paragraphs:['本页呈现'+heading+'。'],points:['使用合成内容验证版式。'],presentation:{layout:'points',note:'以要点呈现。'},evidenceIndexes:[0]}],internalNotes:[]}))})}},
 async runLayoutReference(input){
  modelCalls.push(input);input.onEvent?.({stage:'generating'});await new Promise(r=>setTimeout(r,modelDelayMs))
  if(input.stage)return referenceStageFixture(input)
  const context=JSON.parse(input.prompt.slice(input.prompt.lastIndexOf('\n')+1))
  if(context.message.includes('现在用了'))return {response:JSON.stringify({reply:'当前标题采用蓝灰色。'}),execution:{controlled:true}}
  const pkg=structuredClone(context.currentPackage??createPackage())
  pkg.theme.accent=context.message.includes('黑色')?'#111111':'#235740'
  return {response:JSON.stringify({reply:context.message.includes('黑色')?'标题已改为黑色。':'已生成墨绿色版式。',package:pkg}),execution:{controlled:true}}
 },async listArtifacts(){return[]},async close(){},async closeAll(){}}
 const token='layout-browser-'+randomUUID(),app=await createApp({db:env.db,workers:worker,projectsRoot:root,users:[{id:'admin',role:'admin',token}]})
 if(uploadDelayMs)app.addHook('preHandler',async req=>{if(req.url==='/api/layout-library/reference-files')await new Promise(resolve=>setTimeout(resolve,uploadDelayMs))})
 await app.register(serveStatic,{root:resolve(process.env.PRE_WEB_BUILD_DIR||'web/app/dist')})
 await app.listen({host:'127.0.0.1',port:0});const url='http://127.0.0.1:'+app.server.address().port
 const request=async(method,path,body)=>{const r=await app.inject({method,url:'/api'+path,headers:{authorization:'Bearer '+token},...(body===undefined?{}:{payload:body})});assert.equal(r.statusCode,200,r.body.slice(0,500));return r.json()}
 const policy=await request('GET','/admin/models'),model=policy.models.find(m=>m.provider==='SenseNova'&&m.model==='sensenova-6.8-flash-lite');model.status='verified';model.capabilities.tools=true
 await request('PUT','/admin/models',{expectedRevision:policy.revision,policy})
 const project=await request('POST','/projects',{requestId:randomUUID(),name:'画布版式与会话集成验收'})
 const base='/projects/'+project.id,post=(path,body={})=>request('POST',base+path,{requestId:randomUUID(),baseRevision:0,...body})
 const file=await post('/materials',{filename:'验收.txt',content:Buffer.from('任务书提供项目所在地。').toString('base64')})
 await confirmedOutlineFixture(env.db,project.id);const outline=draft(file.id);outline.questions=[]
 await env.db.query('UPDATE outline_versions SET draft=$2,flow=$3 WHERE project_id=$1',[project.id,outline,JSON.stringify(['01'])])
 await post('/workflow/draft',{outlineVersion:1});await app.waitForJobs()
 return {app,db:env.db,url,token,project,base,post,request,modelCalls,state:()=>request('GET',base+'/state'),async close(){await app.close();await env.close();await rm(root,{recursive:true,force:true})}}
}
