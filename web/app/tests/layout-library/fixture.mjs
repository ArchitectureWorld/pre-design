import Fastify from 'fastify'
import {randomUUID} from 'node:crypto'
import {createTestDb} from '../support/dossier-db.mjs'
import {createLayoutLibrary} from '../../src/layout-library/store.mjs'
import {registerLayoutRoutes} from '../../src/layout-library/routes.mjs'
import {createWorkflowVisualStore} from '../../src/workflow-visual-store.mjs'
export async function libraryFixture(){
 const env=await createTestDb()
 const wrap=c=>({query:async(...a)=>{const r=await c.query(...a);if(Array.isArray(r))return {rows:[]};r.rows=(r.rows??[]).map(x=>{for(const k of ['document','validation'])if(typeof x[k]==='string')x[k]=JSON.parse(x[k]);return x});return r},release:()=>c.release?.()})
 const db={...wrap(env.db),connect:async()=>wrap(await env.db.connect())}
 await db.query('CREATE TABLE projects(id uuid PRIMARY KEY,owner_id text);CREATE TABLE workflow_drafts(id uuid PRIMARY KEY);CREATE TABLE jobs(id uuid PRIMARY KEY,project_id uuid,status text);')
 const p={id:randomUUID(),owner_id:'owner',state:{project:{currentRevision:0}}},draft={id:randomUUID(),version:1,projectName:'集成验收项目',formatVersion:2,approval:{approved:true},stale:false,flow:['01'],chapters:[{id:'01',title:'项目基本情况'}],blocks:[{id:'outline-01-1',chapterId:'01',title:'项目区位',items:[{id:'outline-01-1-item-1',title:'项目区位',paragraphs:['项目位于既有城市片区。'],points:['此处使用合成数据验收版式。'],evidenceIndexes:[0]}]}],evidence:[{filename:'验收.txt',locator:'1'}]}
 await db.query('INSERT INTO projects(id,owner_id) VALUES($1,$2)',[p.id,p.owner_id]);await db.query('INSERT INTO workflow_drafts(id) VALUES($1)',[draft.id])
 const library=await createLayoutLibrary(db),visuals=await createWorkflowVisualStore(db,{layoutLibrary:library,currentDraft:async()=>draft})
 const workflows={current:async()=>({current:draft,visuals:await visuals.current(p,draft)})}
 const app=Fastify({bodyLimit:16*1024*1024})
 app.addHook('onRequest',async(req,reply)=>{const key=req.headers.authorization?.replace('Bearer ','');if(!['owner','other','admin'].includes(key))return reply.code(401).send({error:'未授权'});req.user={id:key,role:key==='admin'?'admin':'user'}})
 app.setErrorHandler((e,_req,reply)=>reply.code(e.name==='ZodError'?400:e.statusCode??500).send({error:e.message}))
 const project=async req=>{if(req.params.id!==p.id||req.user.id!==p.owner_id)throw Object.assign(Error('项目不存在'),{statusCode:404});return p}
 registerLayoutRoutes({app,library,project,workflows,serial:(_k,fn)=>fn(),event:async()=>{}})
 app.post('/api/projects/:id/workflow/visuals',async req=>visuals.generate(await project(req),req.body))
 const request=(method,url,payload,actor='owner')=>app.inject({method,url,headers:{authorization:'Bearer '+actor},...(payload===undefined?{}:{payload})})
 return {app,db,library,visuals,p,draft,request,workflows,async close(){await app.close();await env.close()}}
}
