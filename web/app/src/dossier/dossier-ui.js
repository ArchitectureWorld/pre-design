/** Real API view. No generated fixtures, offline progress or model credentials. */
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stateNames={queued:'排队中',running:'DSH整理中',cancelling:'正在取消',cancelled:'已取消',completed:'已保存',partial:'已保存，仍有读取限制',failed:'失败，原版本保留',interrupted:'中断，需核查',current:'可复用',stale:'数据改变，待复核',pending_inputs:'新输入待归并',not_read:'尚未读取',read_segments:'已读取部分原文',needs_ocr:'扫描内容待识别',metadata_only:'仅影像元数据',captured_user_text:'用户原话已归档'};
const classes={document_statement:'材料记载',user_statement:'用户陈述',user_requirement:'用户要求',user_preference:'用户偏好',user_decision:'用户明确决定'};
const rid=()=>globalThis.crypto?.randomUUID?.()??'req-'+Date.now()+'-'+Math.random().toString(16).slice(2);
export function mountDossier({request,getProject,notify=()=>{}}){
 const button=document.createElement('button');button.type='button';button.className='pd-dossier-open';button.textContent='项目总档';button.dataset.openDossier='';
 const target=document.querySelector('.top-right');if(!target)return {dispose(){},open(){notify('未找到项目工具栏');}};target.prepend(button);
 let panel,projectId,ticket=0,timer,data,selected=null,tab='records',view=null,busy=false,focus,followLatest=true,peek=null,capabilityChapter='';
 const drafts={message:'',intent:'requirement',value:'',reason:'',chapter:''};
 function active(id){return panel?.isConnected&&projectId===id&&getProject()?.id===id;}
 function close(){ticket++;clearTimeout(timer);panel?.close?.();panel?.remove();panel=null;projectId=null;focus?.focus?.();}
 function say(t){if(panel)panel.querySelector('[data-msg]').textContent=t;}
 function remember(){if(!panel)return;for(const key of Object.keys(drafts)){const el=panel.querySelector(`[data-draft="${key}"]`);if(el)drafts[key]=el.value;}}
 function resetDraft(key){drafts[key]='';const el=panel?.querySelector(`[data-draft="${key}"]`);if(el)el.value='';}
 function schedulePoll(id){clearTimeout(timer);if(active(id))timer=setTimeout(()=>{if(!active(id))return;if(busy||panel.querySelector('textarea:focus,input:focus,select:focus'))schedulePoll(id);else void refresh();},3000);}
 function endpoint(path=''){return `/projects/${projectId}/dossier${path}`;}
 async function refresh({manual=false}={}){
  const id=projectId,n=++ticket;try{
   const next=await request(endpoint());if(!active(id)||n!==ticket)return;
   remember();data=next;if(followLatest||view===null)view=next.snapshot;
   render();if(manual)say('已读取后台最新版本。');
  }catch(e){if(active(id)&&n===ticket)say(e.message);}finally{
   schedulePoll(id);
  }
 }
 async function act(fn){if(busy)return;busy=true;remember();try{await fn();}catch(e){say(e.message);notify(e.message);}finally{busy=false;const sync=panel?.querySelector('[data-sync]');if(sync&&data)sync.disabled=data.jobs.some(j=>['queued','running','cancelling'].includes(j.status))||data.pendingSources.length===0;}}
 async function open(){const p=getProject();if(!p?.id){notify('请先打开一个项目。');return;}close();focus=document.activeElement;projectId=p.id;view=null;followLatest=true;peek=null;selected=null;data=null;tab='records';for(const k of ['message','value','reason'])drafts[k]='';
  panel=document.createElement('dialog');panel.className='pd-dossier';panel.setAttribute('aria-label','项目资料总档');
  panel.innerHTML=`<header><div><small>${escape(p.name)}</small><h2>项目资料总档</h2></div><button data-close aria-label="关闭">×</button></header><div class="pd-dossier-tools"><button data-refresh>刷新</button><button class="pd-primary" data-sync>整理并更新</button><button data-json>导出JSON</button><button data-md>导出Markdown</button><span data-counts></span></div><div class="pd-dossier-status" data-msg role="status">正在读取实际项目数据…</div><nav><button data-tab="records">总档条目</button><button data-tab="sources">资料覆盖</button><button data-tab="tasks">任务与影响</button><button data-tab="jobs">执行记录</button><button data-tab="capabilities">已接入能力</button><select data-versions aria-label="总档版本"></select></nav><main><section data-list></section><aside data-side></aside></main><footer>原件与用户说法有来源，不等于独立事实核验。未解析资料不算已读；其他专业Skill不因有文档而标为已接入。</footer>`;
  document.body.append(panel);panel.showModal();panel.querySelector('[data-close]').onclick=close;panel.addEventListener('cancel',e=>{e.preventDefault();close();});
  panel.querySelector('[data-refresh]').onclick=()=>void refresh({manual:true});panel.querySelector('[data-sync]').onclick=()=>void act(()=>sync());
  for(const format of ['json','md'])panel.querySelector(`[data-${format}]`).onclick=()=>void act(async()=>{
   if(!view)throw new Error('请先整理出总档版本。');const id=projectId,file=await request(endpoint(`/export/${format}?revision=${view.revision}`),{download:true});if(active(id))download(file.blob,file.filename);
  });
  panel.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{remember();tab=b.dataset.tab;peek=null;render();});
  panel.querySelector('[data-versions]').onchange=e=>void act(async()=>{const id=projectId;const v=await request(endpoint(`/versions/${e.target.value}`));if(!active(id))return;view=v;followLatest=v.revision===data.revision;peek=null;selected=null;render();});
  await refresh();
 }
 async function sync(sourceIds){
  const p=getProject(),id=projectId;if(!data||p?.id!==id)throw new Error('项目已切换，请重开总档。');
  const job=await request(endpoint('/sync'),{method:'POST',body:{requestId:rid(),baseRevision:p.revision??0,expectedDossierRevision:data.revision,inputHash:data.inputHash,...(sourceIds?{sourceIds}:{})}});
  if(!active(id))return;tab='jobs';view=null;followLatest=true;peek=null;await refresh();say(`已提交任务 ${job.id}。使用已配置的DSH模型与现有额度；状态以后台执行记录为准。`);
 }
 function render(){
  if(!data||!panel)return;
  panel.classList.toggle('pd-cap-view',tab==='capabilities');panel.classList.toggle('pd-cap-inspection',tab==='capabilities'&&!!peek);
  if(!view)view=data.snapshot;const records=view?.records??[],all=(records.filter(r=>r.status==='active'));
  if(!selected||!records.some(r=>r.recordId===selected))selected=all[0]?.recordId??null;
  panel.querySelector('[data-counts]').textContent=`当前V${data.revision} · ${data.snapshot?.records.filter(r=>r.status==='active').length??0}条有效信息 · ${data.snapshot?.conflicts.length??0}组待核差异`;
  const sel=panel.querySelector('[data-versions]');sel.innerHTML=data.versions.map(v=>`<option value="${v.revision}" ${v.revision===view?.revision?'selected':''}>V${v.revision}${v.revision===data.revision?' · 当前':' · 历史只读'}</option>`).join('')||'<option>尚无版本</option>';
  panel.querySelector('[data-sync]').disabled=busy||data.jobs.some(j=>['queued','running','cancelling'].includes(j.status))||data.pendingSources.length===0;
  panel.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.tab===tab));
  const banner=data.hasUnmergedInputs?'有新增/更正输入尚未归并，不能把旧总档当作当前依据。':data.pendingSources.length?`还有${data.pendingSources.length}份来源尚未读取，可整理下一批。`:'当前已归档输入与总档版本对应；原文覆盖与事实核验仍须分别检查。';
  say(view&&view.revision!==data.revision?`正在查看历史V${view.revision}，当前为V${data.revision}；历史记录不可直接更正。`:banner);
  const list=panel.querySelector('[data-list]');
  if(tab==='records')list.innerHTML=`<h3>结构化条目 <small>${all.length}条有效 · ${records.length-all.length}条历史</small></h3>`+(records.length?records.map(r=>`<button class="pd-dossier-record ${r.recordId===selected?'selected':''}" data-record="${escape(r.recordId)}"><span><b>${escape(r.label)}</b><em>${escape(classes[r.informationClass]??r.informationClass)} · ${r.status==='active'?'有效':r.status==='superseded'?'已被更正':escape(r.status)}</em></span><p>${escape(r.valueText)}</p><small>${escape(r.entityLabel)} · ${escape(r.field)} · ${r.chapters.map(c=>c+'章').join('、')||'尚未归章'}</small></button>`).join(''):'<p>还没有结构化总档。上传资料或在右侧补充要求，再点击“整理并更新”。</p>');
  if(tab==='sources')list.innerHTML='<h3>来源与读取覆盖</h3>'+data.inventory.map(s=>{const cv=data.snapshot?.coverage.find(c=>c.sourceId===s.sourceId&&c.sourceHash===s.sha256);return `<article><b>${escape(s.name)}</b><span class="pd-chip">${escape(stateNames[cv?.state]??'待整理')}</span><p>${s.kind==='material'?'原件ID '+escape(s.materialId):'用户输入，原话保留'}</p><small>${cv?.pages?.length?'实际读取PDF页：'+cv.pages.join('、'):cv?.lineRanges?.length?'实际读取行段：'+cv.lineRanges.map(x=>x.join('—')).join('、'):'没有内容读取范围收执'}</small><div><button data-source="${escape(s.sourceId)}">查看来源</button><button data-reprocess="${escape(s.sourceId)}">复核此来源</button></div></article>`;}).join('');
  if(tab==='tasks')list.innerHTML='<h3>冻结任务包与变化影响</h3><p>资料包固定读取版本；新信息与原本空结果的成员变化都纳入检查。</p><div class="pd-inline"><select data-draft="chapter"><option value="">全部已归档内容</option>'+Array.from({length:11},(_,i)=>String(i+1).padStart(2,'0')).map(c=>`<option value="${c}" ${drafts.chapter===c?'selected':''}>第${c}章</option>`).join('')+'</select><button data-capture>冻结一份任务资料包</button></div>'+data.tasks.map(t=>`<article><b>${escape(t.query.chapters?'第'+t.query.chapters.join('、')+'章':'跨章资料包')}</b><span class="pd-chip ${t.status!=='current'?'warn':''}">${escape(stateNames[t.status])}</span><p>冻结V${t.dossierRevision} · ${escape(t.reason)}</p><button data-task="${escape(t.id)}">查看固定输入</button></article>`).join('');
  if(tab==='jobs')list.innerHTML='<h3>真实执行记录</h3>'+data.jobs.map(j=>`<article><b>${escape(stateNames[j.status]??j.status)}</b><small>${escape(j.id)}</small><p>${escape(j.result?.response??j.error??j.progress?.label??'等待后台执行')}</p>${['queued','running','cancelling'].includes(j.status)?`<button data-cancel-job="${escape(j.id)}" ${j.status==='cancelling'?'disabled':''}>取消此任务</button>`:''}</article>`).join('')+(data.jobs.length?'':'<p>尚未提交总档整理任务。上传和保存原话本身不会调用模型。</p>');
  if(tab==='capabilities'){
   list.innerHTML='<h3>本批已接入路径</h3><p>连接状态不是生产验收结论；97项中的其他专业能力没有在本批全量接入。</p><div data-capabilities>正在读取能力边界…</div>';
   const id=projectId;request(endpoint('/capabilities')).then(x=>{if(!active(id)||tab!=='capabilities')return;const target=list.querySelector('[data-capabilities]');if(target)capabilityMatrix(x,target);}).catch(e=>say(e.message));
  }
  list.querySelectorAll('[data-record]').forEach(b=>b.onclick=()=>{remember();selected=b.dataset.record;peek=null;drafts.value='';drafts.reason='';render();});
  list.querySelectorAll('[data-reprocess]').forEach(b=>b.onclick=()=>void act(()=>sync([b.dataset.reprocess])));
  list.querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>void act(async()=>{const id=projectId,s=await request(endpoint('/sources/'+encodeURIComponent(b.dataset.source)));if(!active(id))return;showObject('原始来源',s);}));
  list.querySelectorAll('[data-task]').forEach(b=>b.onclick=()=>void act(async()=>{const id=projectId,x=await request(endpoint('/tasks/'+b.dataset.task));if(active(id))showObject('固定任务资料包',x);}));
  list.querySelectorAll('[data-cancel-job]').forEach(b=>b.onclick=()=>void act(async()=>{const id=projectId;await request(`/projects/${id}/jobs/${b.dataset.cancelJob}/cancel`,{method:'POST',body:{}});if(active(id))await refresh();}));
  const capture=list.querySelector('[data-capture]');if(capture)capture.onclick=()=>void act(async()=>{remember();const id=projectId;await request(endpoint('/tasks'),{method:'POST',body:{requestId:rid(),expectedDossierRevision:data.revision,query:drafts.chapter?{chapters:[drafts.chapter]}:{all:true}}});if(active(id))await refresh();});
  renderSide();
 }
 function renderSide(){if(peek){paintObject();return;}const side=panel.querySelector('[data-side]'),r=view?.records.find(r=>r.recordId===selected);const canCorrect=r?.status==='active'&&view.revision===data.revision;
  side.innerHTML=`<h3>补充信息</h3><p>上传、项目对话、章节问答、批注及这里的补充，会在后台成为总档输入。</p><select data-draft="intent"><option value="requirement">任务要求</option><option value="statement">情况陈述</option><option value="preference">偏好</option><option value="decision">明确决定</option></select><textarea data-draft="message" aria-label="补充原话" placeholder="输入新的项目资料或要求…">${escape(drafts.message)}</textarea><button class="pd-primary" data-message>保存原话</button><small>保存不消耗模型额度；整理时再产生带来源的候选条目。</small>`;
  side.querySelector('[data-draft="intent"]').value=drafts.intent;
  side.querySelector('[data-message]').onclick=()=>void act(async()=>{remember();const id=projectId;if(!drafts.message.trim())throw new Error('请填写补充内容。');await request(endpoint('/messages'),{method:'POST',body:{requestId:rid(),text:drafts.message,intent:drafts.intent}});if(active(id)){resetDraft('message');view=null;followLatest=true;await refresh();say('原话已保存。点击“整理并更新”归并到总档。');}});
  if(r){const block=document.createElement('section');block.innerHTML=`<h3>当前条目与证据</h3><b>${escape(r.label)}</b><p>${escape(r.valueText)}</p><div class="pd-quote">${escape(r.evidence.quote)}</div><small>${escape(r.evidence.sourceId)}<br>${r.evidence.pages?'PDF物理页 '+r.evidence.pages.join('、'):'第 '+r.evidence.startLine+'—'+r.evidence.endLine+' 行'}<br>原件哈希：${escape(r.evidence.sourceHash)}</small><button data-peek>查看原始来源</button>${canCorrect?`<details><summary>更正这一条（产生新版本）</summary><textarea data-draft="value" aria-label="更正后的原值" placeholder="更正后的内容">${escape(drafts.value)}</textarea><textarea data-draft="reason" aria-label="更正理由" placeholder="更正理由">${escape(drafts.reason)}</textarea><p>更正记录为用户陈述，原件不会被修改；旧版本仍可回读。</p><button data-correct>提交明确更正</button></details>`:''}`;side.append(block);
   block.querySelector('[data-peek]').onclick=()=>void act(async()=>{const id=projectId,s=await request(endpoint('/sources/'+encodeURIComponent(r.evidence.sourceId)+'?hash='+encodeURIComponent(r.evidence.sourceHash)));if(active(id))showObject('原始来源',s);});
   const correct=block.querySelector('[data-correct]');if(correct)correct.onclick=()=>void act(async()=>{remember();const id=projectId;if(!drafts.value.trim()||!drafts.reason.trim())throw new Error('更正内容和理由都必须填写。');await request(endpoint('/corrections'),{method:'POST',body:{requestId:rid(),expectedDossierRevision:view.revision,recordId:r.recordId,valueText:drafts.value,reason:drafts.reason}});if(active(id)){resetDraft('value');resetDraft('reason');view=null;followLatest=true;await refresh();say('更正已保存为新版本，旧记录和任务影响已保留。');}});
  }
 }
 function showObject(title,obj){remember();peek={title,obj};panel.classList.toggle('pd-cap-inspection',tab==='capabilities');paintObject();}
 function paintObject(){const side=panel.querySelector('[data-side]');side.replaceChildren();const h=document.createElement('h3'),pre=document.createElement('pre'),back=document.createElement('button');h.textContent=peek.title;pre.textContent=JSON.stringify(peek.obj,null,2);back.textContent='返回条目';back.onclick=()=>{peek=null;panel.classList.remove('pd-cap-inspection');renderSide();};side.append(h,back,pre);}
 function capabilityMatrix(x,target){
  const m=x.matrix,byId=new Map(x.capabilities.map(c=>[c.id,c]));
  const draw=()=>{const cols=capabilityChapter?m.sections.filter(s=>s.chapterId===capabilityChapter):m.chapters;
   target.innerHTML=`<div class="pd-dossier-matrix-tools"><label>章 → 节 <select data-matrix-chapter><option value="">11章总览</option>${m.chapters.map(c=>`<option value="${c.id}" ${c.id===capabilityChapter?'selected':''}>${c.id} ${escape(c.title)}</option>`).join('')}</select></label><small>主/协/引/审/制/排/交：职责关联，不等于已运行。${x.progress.revision?'总档已到V'+x.progress.revision:'总档尚未整理'}</small></div><div class="pd-dossier-matrix"><table><thead><tr><th>技能 / 工作能力</th><th>本批接口</th>${cols.map(c=>`<th title="${escape(c.title)}">${escape(c.id.replace('S',''))}<br>${escape(c.title)}</th>`).join('')}</tr></thead><tbody>${m.skills.map(s=>{
    const live=byId.get(s.id);return `<tr data-skill-row="${s.id}"><td><button data-skill-detail="${s.id}">${s.id} ${escape(s.name)}</button></td><td class="${live?'pd-cell-on':''}">${live?live.state==='connected'?'接口已接':'有限接入':'未接入本批'}</td>${cols.map(c=>{const ids=capabilityChapter?[c.id]:m.sections.filter(sec=>sec.chapterId===c.id).map(sec=>sec.id),roles=[...new Set(m.relations.filter(r=>r.skillId===s.id&&ids.includes(r.sectionId)).map(r=>m.roles[r.role]?.symbol??r.role))];return `<td>${roles.length?escape(roles.join('·')):'—'}</td>`}).join('')}</tr>`;
   }).join('')}</tbody></table></div><p>此表保留11章75节与97项能力关系；本批连接D01—D09的受限链路，真实模型验收仍看目标机记录。</p>`;
   target.querySelector('[data-matrix-chapter]').onchange=e=>{capabilityChapter=e.target.value;draw();};target.querySelectorAll('[data-skill-detail]').forEach(b=>b.onclick=()=>{const skill=m.skills.find(s=>s.id===b.dataset.skillDetail);showObject('能力状态与边界',{...skill,...byId.get(skill.id),notConnected:!byId.has(skill.id),productionAcceptance:x.productionAcceptance});});
  };draw();
 }
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 button.onclick=()=>void open();return {open,close,dispose(){close();button.remove();}};
}
