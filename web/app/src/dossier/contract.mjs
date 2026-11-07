/** Project dossier domain. Pure functions; the model proposes text, the server owns identity and adoption. */
import {createHash} from 'node:crypto';
export const DOSSIER_VERSION='pre-design.dossier.web.v1';
export const CHAPTERS=Array.from({length:11},(_,i)=>String(i+1).padStart(2,'0'));
export const INFO_CLASSES=['document_statement','user_statement','user_requirement','user_preference','user_decision'];
export const clone=v=>structuredClone(v);
export const problem=(code,message,statusCode=409)=>Object.assign(new Error(message),{code:`DOSSIER_${code}`,statusCode});
export function requireThat(ok,code,message,status=409){if(!ok)throw problem(code,message,status);}
export function canonical(v){
 if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number'){requireThat(Number.isFinite(v),'JSON','不接受非有限数值',400);return JSON.stringify(v);}
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 requireThat(v&&Object.getPrototypeOf(v)===Object.prototype,'JSON','需要普通JSON对象',400);
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
}
export const digest=v=>createHash('sha256').update(typeof v==='string'?v:canonical(v)).digest('hex');
export const contentHash=text=>digest(text);
export function exactKeys(obj,allowed,required=[]){
 requireThat(obj&&typeof obj==='object'&&!Array.isArray(obj),'SHAPE','输入必须是对象',400);
 requireThat(Object.keys(obj).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(obj,k)),'FIELDS','字段缺失或含未允许字段',400);
}
export function boundedString(v,name,max=4000){requireThat(typeof v==='string'&&v.trim().length>0&&v.length<=max,'TEXT',`${name}为空或超长`,400);return v;}
export function id(v){requireThat(typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,180}$/.test(v),'ID','对象标识不合法',400);return v;}
export function validateQuery(q){
 exactKeys(q,['all','fields','entityKeys','recordIds','chapters']);
 if(Object.hasOwn(q,'all'))requireThat(typeof q.all==='boolean','QUERY','all必须为布尔值',400);
 for(const k of ['fields','entityKeys','recordIds','chapters'])if(q[k]!==undefined){
  requireThat(Array.isArray(q[k])&&q[k].length<=100&&q[k].every(v=>typeof v==='string'&&v.length>0&&v.length<=180),'QUERY','查询字段不合法',400);
  if(k==='chapters')requireThat(q[k].every(v=>CHAPTERS.includes(v)),'QUERY','未知章节',400);
 }
 requireThat(q.all===true||['fields','entityKeys','recordIds','chapters'].some(k=>q[k]?.length),'QUERY','查询范围不能为空',400);
 return clone(q);
}
function sourceEvidence(raw,sources,reads){
 exactKeys(raw,['sourceId','quote','startLine','endLine','pages'],['sourceId','quote']);
 const source=sources.find(s=>s.sourceId===raw.sourceId);
 requireThat(source&&!source.withdrawn,'SOURCE','引用了不属于本次输入的来源');
 boundedString(raw.quote,'引文',8000);
 const norm=t=>t.replace(/\r\n/g,'\n');
 if(source.kind!=='material'){
  requireThat(!raw.pages&&Number.isSafeInteger(raw.startLine)&&Number.isSafeInteger(raw.endLine)&&raw.startLine>=1&&raw.endLine>=raw.startLine,'LOCATOR','用户原话须指定准确起止行');
  const lines=norm(source.text).split('\n');
  requireThat(raw.endLine<=lines.length&&lines.slice(raw.startLine-1,raw.endLine).join('\n').includes(norm(raw.quote)),'QUOTE','引文不在用户原话的对应行内');
  return {...clone(raw),quote:norm(raw.quote),sourceHash:source.sha256,sourceKind:source.kind};
 }
 const matching=reads.filter(r=>r.contentHash===source.sha256&&r.sourceRelativePath===source.path&&r.status==='ok'&&r.kind!=='metadata');
 requireThat(matching.length>0,'READ_RECEIPT','材料引用缺少同路径、同哈希的真实读取收执');
 if(raw.pages!==undefined){
  requireThat(raw.startLine===undefined&&raw.endLine===undefined&&Array.isArray(raw.pages)&&raw.pages.length>0&&raw.pages.length<=10&&new Set(raw.pages).size===raw.pages.length&&raw.pages.every(p=>Number.isSafeInteger(p)&&p>0),'LOCATOR','PDF页码不合法');
  const pageTexts=raw.pages.map(page=>matching.flatMap(r=>r.pages??[]).filter(p=>p.page===page).map(p=>norm(p.text)));
  requireThat(pageTexts.every(a=>a.length)&&pageTexts.some(a=>a.some(t=>t.includes(norm(raw.quote)))),'QUOTE','引用原文不在已读取的PDF页面中');
 }else{
  requireThat(Number.isSafeInteger(raw.startLine)&&Number.isSafeInteger(raw.endLine)&&raw.startLine>=1&&raw.endLine>=raw.startLine,'LOCATOR','文本引用缺少准确起止行');
  const ok=matching.filter(r=>r.kind==='text'&&r.startLine<=raw.startLine&&r.endLine>=raw.endLine).some(r=>norm(r.text).split('\n').slice(raw.startLine-r.startLine,raw.endLine-r.startLine+1).join('\n').includes(norm(raw.quote)));
  requireThat(ok,'QUOTE','引文不在已读取的对应行内');
 }
 return {...clone(raw),quote:norm(raw.quote),sourceHash:source.sha256,sourceKind:source.kind};
}
export function validateCandidate(response,{projectId,sources,reads=[]}){
 requireThat(typeof response==='string'&&Buffer.byteLength(response)<=1024*1024,'RESPONSE','模型输出为空或超出大小限制');
 let candidate;try{candidate=JSON.parse(response.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw problem('JSON','模型未返回有效JSON；当前总档保持不变');}
 exactKeys(candidate,['records','limitations'],['records']);
 requireThat(Array.isArray(candidate.records)&&candidate.records.length<=160,'RECORDS','候选记录数不合法');
 if(candidate.limitations!==undefined)requireThat(Array.isArray(candidate.limitations)&&candidate.limitations.length<=30&&candidate.limitations.every(t=>typeof t==='string'&&t.length<=2000),'LIMITATIONS','限制说明不合法');
 const records=candidate.records.map(r=>{
  exactKeys(r,['entityKey','entityLabel','field','label','scope','valueText','informationClass','chapters','evidence'],['entityKey','entityLabel','field','label','valueText','informationClass','chapters','evidence']);
  id(r.entityKey);id(r.field);id(r.scope??'project');boundedString(r.entityLabel,'对象名称',300);boundedString(r.label,'字段名称',300);boundedString(r.valueText,'原值',4000);
  requireThat(INFO_CLASSES.includes(r.informationClass),'CLASS','不允许将资料摘录直接标为已核实事实或模型决定');
  requireThat(Array.isArray(r.chapters)&&r.chapters.length<=11&&r.chapters.every(c=>CHAPTERS.includes(c)),'CHAPTER','章节引用不合法');
  const evidence=sourceEvidence(r.evidence,sources,reads),source=sources.find(s=>s.sourceId===evidence.sourceId);
  requireThat(evidence.quote.includes(r.valueText.replace(/\r\n/g,'\n')),'VALUE','字段原值必须由引文逐字支持；归纳不可冒充原值');
  if(source.kind==='material')requireThat(r.informationClass==='document_statement','CLASS','文件内容只能登记为材料记载，不能冒充用户授权');
  else{
   requireThat(r.informationClass!=='document_statement','CLASS','用户原话不能伪装成独立材料证据');
   if(r.informationClass==='user_decision')requireThat(source.intent==='decision','CLASS','只有用户明确的决定操作可产生决定记录');
  }
  const base={entityKey:r.entityKey,entityLabel:r.entityLabel,field:r.field,label:r.label,scope:r.scope??'project',valueText:r.valueText.replace(/\r\n/g,'\n'),informationClass:r.informationClass,chapters:[...new Set(r.chapters)].sort(),evidence,independentlyVerified:false};
  const identity={projectId,entityKey:base.entityKey,field:base.field,scope:base.scope,informationClass:base.informationClass,valueText:base.valueText,sourceHash:evidence.sourceHash,quote:evidence.quote};
  return {...base,recordId:'rec-'+digest(identity).slice(0,32),recordHash:digest(base),status:'active'};
 });
 const unique=new Map();for(const r of records){const old=unique.get(r.recordId);
  if(old){const semantic=x=>({entityKey:x.entityKey,entityLabel:x.entityLabel,field:x.field,label:x.label,scope:x.scope,valueText:x.valueText,informationClass:x.informationClass,chapters:x.chapters,sourceHash:x.evidence.sourceHash,quote:x.evidence.quote});
   requireThat(digest(semantic(old))===digest(semantic(r)),'DUPLICATE','同一记录身份出现不一致字段');
   continue; // Same captured bytes are not independent evidence; all read receipts are archived.
  }
  unique.set(r.recordId,r);
 }
 return {records:[...unique.values()],limitations:candidate.limitations??[]};
}
export function inputFingerprint(inputs){return digest({metadata:inputs.metadata??{},sources:inputs.sources.map(s=>({id:s.sourceId,hash:s.sha256,kind:s.kind,intent:s.intent??null,withdrawn:!!s.withdrawn})).sort((a,b)=>a.id.localeCompare(b.id))});}
const groupKey=r=>[r.entityKey,r.field,r.scope].join('|');
export function findConflicts(records){
 const groups=new Map();for(const r of records.filter(r=>r.status==='active')){const k=groupKey(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
 return [...groups].filter(([,rs])=>new Set(rs.map(r=>r.valueText)).size>1).map(([key,rs])=>({conflictId:'conf-'+digest(key).slice(0,24),entityKey:rs[0].entityKey,field:rs[0].field,scope:rs[0].scope,recordIds:rs.map(r=>r.recordId).sort(),kind:'different_candidate_values',status:'unresolved'}));
}
export function sourceCoverage(sources,reads,records){
 return sources.map(s=>{
  if(s.kind!=='material')return {sourceId:s.sourceId,sourceHash:s.sha256,state:'captured_user_text',quotedRecords:records.filter(r=>r.evidence.sourceId===s.sourceId).length,wholeSourceVerified:false};
  const matched=reads.filter(r=>r.contentHash===s.sha256&&r.sourceRelativePath===s.path);
  const pages=[...new Set(matched.flatMap(r=>r.pages??[]).map(p=>p.page))].sort((a,b)=>a-b);
  const ranges=matched.filter(r=>r.kind==='text'&&Number.isSafeInteger(r.startLine)&&Number.isSafeInteger(r.endLine)).map(r=>[r.startLine,r.endLine]);
  const hasContent=matched.some(r=>r.status==='ok'&&(r.kind==='text'||r.pages?.length));
  return {sourceId:s.sourceId,sourceHash:s.sha256,state:hasContent?'read_segments':matched.some(r=>r.status==='needs_ocr')?'needs_ocr':matched.some(r=>r.kind==='metadata')?'metadata_only':'not_read',pages,lineRanges:ranges,wholeSourceVerified:false,quotedRecords:records.filter(r=>r.evidence.sourceId===s.sourceId).length};
 });
}
export function nextSnapshot(previous,{projectId,inputHash,sources,records=[],coverage=[],limitations=[],jobId=null,correction=null,authoritativeSources=false},now=new Date().toISOString()){
 requireThat(!previous||previous.projectId===projectId,'PROJECT','总档项目不一致');
 const all=clone(previous?.records??[]),map=new Map(all.map(r=>[r.recordId,r])),delta=[];
 if(authoritativeSources){
  const currentSources=new Map(sources.map(s=>[s.sourceId,s]));
  for(const old of all.filter(r=>r.status==='active')){
   const src=currentSources.get(old.evidence.sourceId);
   if(!src||src.withdrawn||src.sha256!==old.evidence.sourceHash){
    old.status=!src||src.withdrawn?'source_withdrawn':'source_changed';
    delta.push({action:old.status,recordId:old.recordId,field:old.field});
   }
  }
 }
 for(const r of records){
  const old=map.get(r.recordId);
  if(old){requireThat(old.recordHash===r.recordHash||old.evidence.sourceHash===r.evidence.sourceHash&&old.valueText===r.valueText,'IDENTITY','既有记录身份冲突');continue;}
  all.push(clone(r));map.set(r.recordId,all.at(-1));delta.push({action:'added',recordId:r.recordId,field:r.field});
 }
 if(correction){
  const old=map.get(correction.oldId),fresh=map.get(correction.newId);
  requireThat(old&&fresh&&old.recordId!==fresh.recordId&&old.status==='active'&&fresh.status==='active'&&groupKey(old)===groupKey(fresh),'CORRECTION','更正对象或版本不成立');
  old.status='superseded';old.supersededBy=fresh.recordId;
  delta.push({action:'superseded',recordId:old.recordId,replacementId:fresh.recordId,reason:correction.reason});
 }
 const cvs=new Map((previous?.coverage??[]).map(c=>[c.sourceId,c]));for(const c of coverage)cvs.set(c.sourceId,clone(c));
 const knownSources=new Map((previous?.sources??[]).map(s=>[s.sourceId,s]));for(const s of sources){const {text,...descriptor}=s;knownSources.set(s.sourceId,descriptor);}
 const out={schemaVersion:DOSSIER_VERSION,projectId,revision:(previous?.revision??0)+1,previousHash:previous?.snapshotHash??null,inputHash,sources:[...knownSources.values()],records:all,conflicts:findConflicts(all),coverage:[...cvs.values()],limitations:[...new Set([...(previous?.limitations??[]),...limitations,'原文引用及读取收执不等于独立事实核验。'])],delta,jobId,createdAt:now};
 out.snapshotHash=digest(out);return out;
}
export function selectRecords(snapshot,query){
 validateQuery(query);
 const records=(snapshot?.records??[]).filter(r=>r.status==='active'&&(!query.fields?.length||query.fields.includes(r.field))&&(!query.entityKeys?.length||query.entityKeys.includes(r.entityKey))&&(!query.recordIds?.length||query.recordIds.includes(r.recordId))&&(!query.chapters?.length||query.chapters.some(c=>r.chapters.includes(c))));
 const ids=new Set(records.map(r=>r.recordId)),keys=new Set(records.map(groupKey));
 const conflicts=(snapshot?.conflicts??[]).filter(c=>keys.has([c.entityKey,c.field,c.scope].join('|')));
 for(const c of conflicts)for(const rid of c.recordIds)if(!ids.has(rid)){const r=snapshot.records.find(r=>r.recordId===rid);if(r){records.push(r);ids.add(rid);}}
 const signature=digest({records:records.map(r=>[r.recordId,r.recordHash,r.status]).sort((a,b)=>a[0].localeCompare(b[0])),conflicts});
 return {records:clone(records),conflicts:clone(conflicts),selectionHash:signature,readiness:conflicts.length?'limited_conflict':records.length?'data_available':'limited_missing'};
}
export function assessTask(task,snapshot,currentInputHash){
 if(currentInputHash!==(snapshot?.inputHash??null))return {status:'pending_inputs',reason:'新增或更正的原始输入尚未归并；旧任务不能提交'};
 const selection=selectRecords(snapshot,task.query);
 if(selection.selectionHash!==task.payload.selectionHash)return {status:'stale',reason:'字段值、冲突或查询成员改变',currentRevision:snapshot?.revision??0};
 return {status:'current',reason:'所取数据与当前总档一致',currentRevision:snapshot?.revision??0};
}
export function markdown(snapshot){
 if(!snapshot)return '# 项目资料总档\n\n尚未整理。\n';
 const safe=v=>String(v).replace(/</g,'&lt;').replace(/>/g,'&gt;');
 return [`# 项目资料总档 · V${snapshot.revision}`,`项目：${snapshot.projectId}  \n快照：${snapshot.snapshotHash}`, '> 由同版JSON生成；资料记载、用户陈述与独立核实事实不同。',...snapshot.records.map(r=>`## ${safe(r.label)}\n\n${safe(r.valueText)}\n\n状态：${r.status}；性质：${r.informationClass}；对象：${safe(r.entityLabel)}\n\n来源：${r.evidence.sourceId}；${r.evidence.pages?'PDF物理页 '+r.evidence.pages.join(','):'第 '+r.evidence.startLine+'—'+r.evidence.endLine+' 行'}\n\n原文：${safe(r.evidence.quote)}`),'## 未决差异',...snapshot.conflicts.map(c=>`${c.conflictId}：${c.recordIds.join(' / ')}`),'## 资料限制',...snapshot.limitations.map(t=>'- '+safe(t))].join('\n\n')+'\n';
}
