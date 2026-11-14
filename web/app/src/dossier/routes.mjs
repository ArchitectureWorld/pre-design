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
   {id:'V14',name:'参考样稿解析与模板提炼',state:'connected_limited',boundary:'任务外原生JSON/PPTX解析及受控DSH文字参考提炼；只生成候选。PDF/截图视觉提炼和原PPT母版保真不在本版。'},
   ...['V07','V08','V10','V11','V12','V13','Q07'].map(id=>({id,name:integration.registry.skills.find(s=>s.id===id)?.name??id,state:'connected_limited',boundary:'原生版式库、固定1600×900 HTML、属性覆盖、不可变资源/成果版本和实际浏览器检查；不表示全部专业场景已验收。'})),
   {id:'R01',name:'研究问题与检索组织',state:'connected_limited',boundary:'含项目基本情况的整稿调用平台搜索，检索所在地与项目对象相关的官方政策。'},
   {id:'R02',name:'外部证据适用性核验',state:'connected_limited',boundary:'政策采用实际网页读取收执与逐字引用，保存原文快照、链接及日期。适用判断由模型给出，待用户审阅。'},
   {id:'C01.02',name:'项目阶段与已知条件概况',state:'connected_limited',boundary:'基本情况包含独立政策背景，衔接已核实的公共政策与上位规划。'},
   {id:'V09',name:'内容分组与分页计划',state:'connected_limited',boundary:'每个页脚本绑定一页成果，初次生成采用脚本指定的呈现方式。'},
   {id:'W01',name:'汇报论证与篇章组织',state:'connected_limited',boundary:'确认流程进入阶段稿时，与 W02、W03 联合生成业务报告名和各节短标题。'},
   {id:'W02',name:'章节目条结构化正文',state:'connected_limited',boundary:'按章分节并保存独立汇报正文。每份页脚本保存主题、结论、上屏内容与呈现方式。'},
   {id:'W03',name:'内部备注与条件说明',state:'connected_limited',boundary:'问询与待决项进入内部备注；对外文字保留影响结论的实质条件。'},
   {id:'A03',name:'任务适用性与资料充分性',state:'connected_limited',boundary:'章节推荐和资料核对逐章保存本轮深度、依据和限制。在章节详情查看；旧专业模块执行前仍单独核对条件。'},
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
