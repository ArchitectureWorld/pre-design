import {exactKeys,boundedString,requireThat,validateQuery,CHAPTERS} from './contract.mjs';
const uuid=v=>requireThat(typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v),'ID','编号不合法',400);
const requestId=v=>requireThat(typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v),'REQUEST','请求编号不合法',400);
const revision=v=>requireThat(Number.isSafeInteger(v)&&v>=0,'REVISION','版本必须为非负整数',400);
export function registerDossierRoutes({app,integration,project,enqueue,event,finalize=(_id,fn)=>fn()}){
 const store=integration.store;
 app.get('/api/projects/:id/dossier',async req=>store.current(await project(req)));
 app.get('/api/projects/:id/dossier/versions/:revision',async req=>{const n=Number(req.params.revision);revision(n);return store.version(await project(req),n);});
 app.get('/api/projects/:id/dossier/export/:format',async(req,reply)=>{
  requireThat(['json','md'].includes(req.params.format),'FORMAT','仅支持JSON或Markdown',400);
  const p=await project(req),n=req.query.revision===undefined?null:Number(req.query.revision);if(n!==null)revision(n);
  const snapshot=n===null?(await store.current(p)).snapshot:await store.version(p,n);requireThat(snapshot,'NOT_READY','尚无已整理版本');
  reply.header('Content-Disposition',`attachment; filename="project-dossier-v${snapshot.revision}.${req.params.format}"`).header('Content-Security-Policy',"sandbox; default-src 'none'");
  return req.params.format==='md'?reply.type('text/markdown; charset=utf-8').send(store.markdown(snapshot)):reply.type('application/json; charset=utf-8').send(snapshot);
 });
 app.get('/api/projects/:id/dossier/sources/:sourceId',async req=>{if(req.query.hash!==undefined)requireThat(/^[a-f0-9]{64}$/.test(req.query.hash),'HASH','来源哈希不合法',400);return store.source(await project(req),req.params.sourceId,req.query.hash);});
 app.post('/api/projects/:id/dossier/messages',async req=>{
  const b=req.body;exactKeys(b,['requestId','text','intent'],['requestId','text','intent']);requestId(b.requestId);boundedString(b.text,'补充内容',16000);requireThat(['statement','requirement','preference','decision'].includes(b.intent),'INTENT','信息类型不合法',400);
  const p=await project(req),result=await finalize(p.id,()=>store.addInteraction(p,b,req.user.id));await event(p.id,{type:'dossier-input-added',sourceId:result.sourceId});return result;
 });
 app.post('/api/projects/:id/dossier/sync',req=>{
  const b=req.body;exactKeys(b,['requestId','baseRevision','expectedDossierRevision','inputHash','sourceIds'],['requestId','baseRevision','expectedDossierRevision']);requestId(b.requestId);revision(b.baseRevision);revision(b.expectedDossierRevision);
  if(b.inputHash!==undefined)requireThat(typeof b.inputHash==='string'&&/^[a-f0-9]{64}$/.test(b.inputHash),'HASH','输入哈希不合法',400);
  if(b.sourceIds!==undefined)requireThat(Array.isArray(b.sourceIds)&&b.sourceIds.length>0&&b.sourceIds.length<=12&&new Set(b.sourceIds).size===b.sourceIds.length&&b.sourceIds.every(x=>typeof x==='string'&&x.length<=180),'SOURCES','来源选择不合法',400);
  return enqueue(req,'dossier',b);
 });
 app.post('/api/projects/:id/dossier/corrections',async req=>{
  const b=req.body;exactKeys(b,['requestId','expectedDossierRevision','recordId','valueText','reason'],['requestId','expectedDossierRevision','recordId','valueText','reason']);requestId(b.requestId);revision(b.expectedDossierRevision);boundedString(b.recordId,'记录编号',100);boundedString(b.valueText,'更正原文',4000);boundedString(b.reason,'更正理由',2000);
  const p=await project(req),result=await finalize(p.id,()=>store.correct(p,b,req.user.id));await event(p.id,{type:'dossier-corrected',revision:result.revision});return result;
 });
 app.post('/api/projects/:id/dossier/tasks',async req=>{
  const b=req.body;exactKeys(b,['requestId','expectedDossierRevision','query'],['requestId','expectedDossierRevision','query']);requestId(b.requestId);revision(b.expectedDossierRevision);validateQuery(b.query);
  return store.captureTask(await project(req),b);
 });
 app.get('/api/projects/:id/dossier/tasks/:taskId',async req=>{uuid(req.params.taskId);return store.task(await project(req),req.params.taskId);});
 app.get('/api/projects/:id/dossier/capabilities',async req=>{
  await project(req);
  const current=await store.current(await project(req));
  return {version:'r5.1',chapters:CHAPTERS,matrix:integration.registry,progress:{revision:current.revision,latestJob:current.jobs[0]??null,hasUnmergedInputs:current.hasUnmergedInputs},capabilities:[
   {id:'D01',name:'资料登记',state:'connected',boundary:'复用上传原件与哈希；未解析不算已读'},
   {id:'D02',name:'原文读取',state:'connected_limited',boundary:'复用DSH真实读取收执；Office/CAD/OCR仍按既有工具能力显示限制'},
   {id:'D03',name:'交互归纳',state:'connected_limited',boundary:'DSH语义候选；原文及显式用户更正由程序校验'},
   {id:'D04',name:'对象与字段',state:'connected_limited',boundary:'稳定工作标识；不声称完成跨资料实体自动消歧'},
   {id:'D05',name:'来源绑定',state:'connected',boundary:'逐字原值、页行、路径与哈希核对，不等于事实独立核验'},
   {id:'D06',name:'冲突与更正',state:'connected_limited',boundary:'同对象字段不同原值并存；语义等价/时效比较仍需专业判断'},
   {id:'D07',name:'项目总档',state:'connected',boundary:'PostgreSQL不可变版本；JSON/MD同源'},
   {id:'D08',name:'增量更新',state:'connected',boundary:'上传和有效交互作为新输入；显式整理调用模型；不自动增加费用'},
   {id:'D09',name:'按任务取用',state:'connected',boundary:'冻结查询与版本；outline/chat/workflow使用总档；旧62执行器尚未统一字段消费'},
  ],otherCapabilities:'not_connected_by_this_release',productionAcceptance:'requires_target_smoke'};
 });
}
