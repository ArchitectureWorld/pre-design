#!/usr/bin/env node
/** Explicit target-machine real DSH acceptance. Makes at most one model job; no automatic retries. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
const args={};for(let i=2;i<process.argv.length;i++){const a=process.argv[i];if(a==='--allow-model')args.allowModel=true;else if(['--target','--config','--out'].includes(a))args[a.slice(2)]=process.argv[++i];else throw new Error('未知参数 '+a);}
if(!args.target)throw new Error('需要 --target 现有Web目录');
const target=resolve(args.target),config=JSON.parse(await readFile(args.config?resolve(args.config):join(target,'.local/web/config.json'),'utf8'));
if(config.port!==4320)throw new Error('保留固定Web端口4320，不扫描或换用其他端口');
const actor=config.users.find(x=>x.role==='admin')??config.users[0];if(!actor)throw new Error('缺少已有访问账号');
const base='http://127.0.0.1:4320',out=args.out?resolve(args.out):join(target,'.local/dossier-acceptance',new Date().toISOString().replaceAll(':','-')+'.json');
const report={release:'r5.1',startedAt:new Date().toISOString(),mode:args.allowModel?'real-dsh-acceptance':'read-only-preflight',base,steps:[],status:'running',modelJobsSubmitted:0,isolatedProjectId:null,productionAccepted:false};
const step=(name,data={})=>report.steps.push({name,at:new Date().toISOString(),...data});
async function api(path,{method='GET',body}={}){const r=await fetch(base+'/api'+path,{method,headers:{Authorization:'Bearer '+actor.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});const content=await r.text();let data;try{data=JSON.parse(content);}catch{data={text:content};}if(!r.ok)throw new Error(`${method} ${path}: ${r.status} ${data.error??'请求失败'}`);return data;}
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
try{
 const identity=await api('/me');step('authentication',{userId:identity.id,role:identity.role});const ui=await fetch(base+'/dossier-ui.js',{signal:AbortSignal.timeout(5000)});assert(ui.ok&&(await ui.text()).includes('mountDossier'),'构建后的页面缺少总档模块');step('ui-bundle-available');
 if(!args.allowModel){report.status='preflight_pass';step('model-not-run',{reason:'未给 --allow-model，不创建项目、不调用模型'});}
 else{
  const name='总档接入验收-'+new Date().toISOString().replace(/[:.]/g,'-');const project=await api('/projects',{method:'POST',body:{requestId:randomUUID(),name,metadata:{type:'隔离验收，不是业务项目',location:'测试环境',regionDetail:'不代表实际地点',brief:'仅验证资料总档、版本与任务引用，不开展策划业务。'}}});report.isolatedProjectId=project.id;const path='/projects/'+project.id,post=(suffix,body)=>api(path+suffix,{method:'POST',body});step('isolated-project-created',{projectId:project.id});
  const raw='本文件仅用于总档接口验收，不代表真实开发任务。\n服务对象为周边居民。\n本次希望增加公共体育服务。';
  const material=await post('/materials',{requestId:randomUUID(),baseRevision:project.revision??0,filename:'总档验收任务.txt',content:Buffer.from(raw).toString('base64')});
  await post('/dossier/messages',{requestId:randomUUID(),text:'先梳理已有资料，不编制具体建设方案。',intent:'requirement'});step('material-and-user-input-recorded',{materialId:material.id});
  let current=await api(path+'/dossier');const job=await post('/dossier/sync',{requestId:randomUUID(),baseRevision:project.revision??0,expectedDossierRevision:current.revision,inputHash:current.inputHash});report.modelJobsSubmitted++;step('one-dsh-job-submitted',{jobId:job.id});
  const deadline=Date.now()+20*60*1000;let finished;while(Date.now()<deadline){await new Promise(r=>setTimeout(r,1500));current=await api(path+'/dossier');const j=current.jobs.find(x=>x.id===job.id);if(j&&!['queued','running','cancelling'].includes(j.status)){finished=j;break;}}
  assert(finished,'任务观察超时：未自动重新提交，请在Web检查原任务');assert(['completed','partial','recovered'].includes(finished.status),`原任务终态：${finished.status}；${finished.error??''}；没有自动重试`);assert(current.revision>=1,'没有持久化总档');
  const materialSource='material:'+material.id,record=current.snapshot.records.find(r=>r.status==='active'&&r.evidence.sourceId===materialSource);assert(record,'没有来自已上传材料的可追溯记录；不能用用户填写代替原件读取验收');assert(raw.includes(record.evidence.quote),'总档引文不在验收原件内');assert(current.snapshot.coverage.some(c=>c.sourceId===materialSource&&c.state==='read_segments'),'缺少原件真实读取收执');step('material-read-and-dossier-published',{revision:current.revision,snapshotHash:current.snapshot.snapshotHash,jobStatus:finished.status});
  if(identity.role==='admin'){const jobs=await api('/admin/jobs'),j=jobs.find(x=>x.id===job.id),trace=j?.execution_metadata;const requestCount=trace?.parent?.requests?.length??0,executionsCount=trace?.executions?.length??0;report.modelTrace={parentStatus:trace?.parent?.status??'not_recorded',requestCount,executionsCount};assert(requestCount>0||executionsCount>0,'任务虽然返回，但没有实际模型执行收执，不能验收真实DSH调用');step('actual-model-receipt-observed',report.modelTrace);}else{throw new Error('需管理员查看本次真实执行收执，当前只完成业务链验证');}
  const originalVersion=current.revision,task=await post('/dossier/tasks',{requestId:randomUUID(),expectedDossierRevision:originalVersion,query:{recordIds:[record.recordId]}});step('task-input-frozen',{taskId:task.taskId,version:originalVersion});
  const correction={requestId:randomUUID(),expectedDossierRevision:originalVersion,recordId:record.recordId,valueText:'验收用明确更正：服务对象调整为老年居民。',reason:'只用于验证用户更正、历史保留与任务失效，不是实际项目事实'};const changed=await post('/dossier/corrections',correction),same=await post('/dossier/corrections',correction);assert(changed.revision===same.revision,'重放同请求产生重复版本');
  const old=await api(path+'/dossier/versions/'+originalVersion),oldTask=await api(path+'/dossier/tasks/'+task.taskId);assert(old.records.find(r=>r.recordId===record.recordId)?.status==='active','历史版本被改写');assert(oldTask.status==='stale','旧资料包没有失效');current=await api(path+'/dossier');assert(current.revision===changed.revision,'刷新版本不一致');step('correction-history-idempotence-stale-task-pass',{oldVersion:originalVersion,newVersion:current.revision});
  const source=await api(path+'/dossier/sources/'+encodeURIComponent(record.evidence.sourceId)+'?hash='+record.evidence.sourceHash);assert(source.sha256===record.evidence.sourceHash,'来源回查版本错误');const exported=await api(path+'/dossier/export/json?revision='+current.revision);assert(exported.snapshotHash===current.snapshot.snapshotHash,'JSON导出不同源');
  report.status='real_dsh_business_chain_pass';report.productionAccepted=false;report.remaining=['目标机人工检查页面、模型抽取内容质量','重启后按记录中的projectId再次回查版本','PDF/Office/影像语义与全部97项专业能力不在本批验收'];step('test-project-retained',{reason:'保留验收项目及原任务供回查，不删除用户数据'});
 }
}catch(e){report.status='failed_or_incomplete';report.error=e.message;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await mkdir(dirname(out),{recursive:true,mode:0o700});await writeFile(out,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:report.status,reportPath:out,projectId:report.isolatedProjectId,modelJobsSubmitted:report.modelJobsSubmitted,error:report.error??null}));}
