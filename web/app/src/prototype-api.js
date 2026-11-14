// Production data adapter for the accepted V0.9 prototype. No replacement layout.
import {outlineMarkup,chapterCapabilityLabel} from './outline-view.js'
import {mountFlowEditor,flowEditorState} from './outline-flow.js'
import {mountOutlineAgent,consultContentKey,consultMessageMode,watchProjectEvents} from './outline-agent.js'
import {partitionMaterialUploads,materialUploadIssue} from './material-policy.mjs'
import {workflowRecord,workflowIsStale,workflowStatusLabel,workflowDraftMutation,workflowReviewMutation,workflowPreviewMarkup,mountWorkflowStatus,currentWorkflowVisual} from './workflow-ui.js'
import {renderWorkflowGraph,mountGraphPan} from './workflow-graph.js'
import {mountGraphNodeDrag} from './workflow-node-drag.js'
import {mountAnnotationComposer} from './annotation-composer.js'
import {workflowBlockItems,workflowItemText,workflowItemPresentation,reportHierarchy,outlineNumber} from './workflow-content.mjs'
import {visualPageMarkup,VISUAL_CSS} from './workflow-visual-view.mjs'
// randomUUID is secure-context-only; getRandomValues also works on LAN HTTP.
function requestId(){
 if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
 const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const pendingMutations = new Map(JSON.parse(sessionStorage.getItem('pre-pending-mutations')||'[]'));
const server = { navigation: 0, operation: 0, token: sessionStorage.getItem('pre-access') || '', current: null, loading: false, watch: null, connection:'connecting', agentUI:null, workflowUI:null, flowEditor:null, consultSending:false, createRequest: null, fingerprints: new Map() };
const statusText = { recovered:'已恢复提案，需审阅', queued:'等待执行', running:'正在处理', cancelling:'正在取消', cancelled:'已取消', partial:'有资料缺口', unreviewed:'未经报告审查', completed:'已完成', failed:'未完成', interrupted:'执行中断，需检查', pending:'未提交', submitted:'处理中', awaiting_review:'待确认修订', confirmed:'已确认', pending_review:'待确认' };
async function api(path, body) {
 const response = await fetch('/api'+path, { method:body?'POST':'GET', headers:{Authorization:'Bearer '+server.token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined });
 const data = await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'请求失败'),{status:response.status});return data;
}
async function safely(work) {if(server.loading)return;const ticket=++server.operation;server.loading=true;updatePipelineUI();try{await work()}catch(error){toast(error.message)}finally{if(server.operation===ticket){server.loading=false;updatePipelineUI()}}}
function savePendingMutations(){sessionStorage.setItem('pre-pending-mutations',JSON.stringify([...pendingMutations]))}
async function mutate(path, extra={}) {
 const id=state.currentProjectId,key=JSON.stringify([id,path,extra]);let body=pendingMutations.get(key);
 if(!body){body={requestId:requestId(),baseRevision:server.current.revision,...extra};pendingMutations.set(key,body);savePendingMutations()}
 let result;try{result=await api(`/projects/${id}/${path}`,body)}catch(error){if(error.status>=400&&error.status<500){pendingMutations.delete(key);savePendingMutations()}throw error}
 pendingMutations.delete(key);savePendingMutations();if(state.currentProjectId===id)await refreshCurrent().catch(()=>toast('操作已保存，状态刷新失败，请重新打开项目。'));return result;
}
function invalidateNavigation(){clearAnnotationContext();server.navigation++;server.operation++;server.loading=false;server.watch?.abort();server.graphNodeDrag?.destroy();server.graphNodeDrag=null;server.flowEditor?.destroy();server.flowEditor=null;server.workflowUI?.destroy();server.workflowUI=null;server.renderedConsult=null;server.visualDialog?.remove();server.visualDialog=null;globalThis.prePlatform?.reset();}
function goOverview(){invalidateNavigation();prototypeGoOverview();void refreshProjects().catch(error=>toast(error.message))}
function openNewProject(){invalidateNavigation();state.rejectedMaterials=[];prototypeOpenNewProject()}
function loadProjectRecords(){return []}
function saveProjectRecords(){}
function persistActiveProject(){}
function registerNewProject(){}
function makeScriptRecords(){return {}}
function ensureScripts(){}
function loadDemoFiles(){toast('当前为真实工作区，请上传实际文件；原型中的示例不会写入项目。')}
function projectStatus(p){return p.status==='provisioning'?'项目初始化中':`版本 ${p.revision??0} · ${p.pendingCount??0} 条待提交批注`}
async function refreshProjects(){projectRecords=(await api('/projects')).map(p=>({...p,stage:'workspace',files:[],annotations:[],updatedAt:p.updatedAt||Date.now()}));renderOverview();renderQuickProjects();renderProjectLibrary();void globalThis.prePlatform?.authenticated()}
function renderOverview(){
 const items=projectList($('#overviewSearch').value);$('#overviewTotal').textContent=projectRecords.length;$('#overviewPending').textContent=projectRecords.reduce((n,p)=>n+(p.pendingCount||0),0);
 $('#overviewProjectGrid').innerHTML=items.map(p=>`<button type="button" class="overview-project" data-overview-id="${escapeHTML(p.id)}" aria-label="打开历史项目 ${escapeHTML(p.name)}"><div class="overview-project-top"><span class="overview-project-kind"><i></i>${escapeHTML(p.type||'前期策划')}</span><span class="overview-project-time">${formatProjectTime(p.updatedAt)}</span></div><strong class="overview-project-title" title="${escapeHTML(p.name)}">${escapeHTML(p.name)}</strong><div class="overview-project-place">${escapeHTML(p.location||'未填写项目地点')}</div><div class="overview-project-foot"><span class="progress-meta"><b>${p.pendingCount?p.pendingCount+' 条待批注':'项目已保存'}</b><span>${escapeHTML(projectStatus(p))}</span></span><span class="open-arrow">↗</span></div></button>`).join('')||'<div class="overview-no-projects">还没有项目。点击右上角「＋」创建一个新项目。</div>';
}
function initProjectLibrary(){state.currentProjectId=null;updateProjectSwitcher();renderOverview();setStage('overview');queueMicrotask(async()=>{
 for(const id of ['demoFilesBtn','feedbackUseDemo'])$('#'+id).classList.add('hidden');$('#skipProcessing').textContent='进入项目工作台，后台继续处理 ↗';
 $('.create-feedback span').textContent='请先选择至少一份真实项目资料。';
 if(server.token){try{await refreshProjects();return}catch(error){toast(error.message)}}showAccess();
})}
function showAccess(){
 const overlay=document.createElement('div');overlay.className='project-library-shade';overlay.id='accessDialog';
 overlay.innerHTML='<form class="flow-card glass"><div class="micro">PRE—DESIGN / WORKSPACE</div><h2>连接项目空间</h2><p class="flow-desc">输入管理员提供的访问令牌。</p><label class="field-label" for="accessToken">访问令牌</label><input id="accessToken" class="field-input" type="password" autocomplete="off" required/><div class="flow-actions"><span></span><button class="primary-btn" type="submit">进入项目空间 ↗</button></div></form>';
 document.body.append(overlay);overlay.querySelector('form').onsubmit=async event=>{event.preventDefault();server.token=$('#accessToken').value.trim();try{await refreshProjects();sessionStorage.setItem('pre-access',server.token);overlay.remove()}catch(error){toast(error.message)}};
}
function selectedFile(value){const file=value.file??value;return {name:file.name,relativePath:value.relativePath||file.webkitRelativePath||file.name,size:file.size,type:file.type,file}}
function materialNotice(value) {
 const issue = materialUploadIssue(value)
 if (!issue) return null
 const path = value.relativePath || value.webkitRelativePath || value.filename || value.name || value.file?.name
 return {path, message:issue.message}
}
function rememberRejectedMaterials(files, append = false) {
 const notices = append ? state.rejectedMaterials ?? [] : []
 const paths = new Map(notices.map(notice => [notice.path, notice]))
 for (const file of files) {
  const notice = materialNotice(file)
  if (notice) paths.set(notice.path, notice)
 }
 state.rejectedMaterials = [...paths.values()]
}
function materialNoticesMarkup(notices, title) {
 const rows = notices.map(notice => `<li>${escapeHTML(notice.path)} · ${escapeHTML(notice.message)}</li>`).join('')
 return `<details class="cad-replacement-list" role="status" ${notices.length<=3?'open':''}><summary>${title} · ${notices.length} 份</summary><ul>${rows}</ul></details>`
}
function addFiles(input) {
 const batch = partitionMaterialUploads(input)
 rememberRejectedMaterials(batch.rejected, true)
 let added = 0
 for (const value of batch.accepted) {
  const item = selectedFile(value)
  if (item.size > 512*1024*1024) {toast(`${item.name} 超过单文件512 MB上限`);continue}
  if (state.files.some(f => (f.relativePath || f.name)===item.relativePath && f.size===item.size)) continue
  state.files.push(item)
  added++
 }
 renderFiles()
 if (batch.message) toast(batch.message)
 else if (added) toast(`已添加 ${added} 份资料，文件夹层级会随原件保留`)
}
function materialLabel(item) {
 return materialUploadIssue(item)?.message || item.uploadStatus || item.processing?.label ||
  (item.size===0?'空文件':/\.(pdf|txt|md|csv|json|geojson|yaml|yml|xml|png|jpe?g|webp)$/i.test(item.name)?'上传后检查解析能力':'原件上传 · 待转换')
}
function renderFiles(){
 const list=$('#fileList');list.innerHTML=state.files.map((f,i)=>`<div class="filechip">${ICON.file}<span class="file-name" title="${escapeHTML(f.relativePath||f.name)}">${escapeHTML(f.relativePath||f.name)}</span><span title="${escapeHTML(materialLabel(f))}">${escapeHTML(materialLabel(f))}</span><button type="button" data-remove="${i}" aria-label="移除${escapeHTML(f.relativePath||f.name)}" ${state.processing?'disabled':''}>${ICON.close}</button></div>`).join('');
 if(state.rejectedMaterials?.length)list.insertAdjacentHTML('beforeend',materialNoticesMarkup(state.rejectedMaterials,'本次筛出的资料'))
 list.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{state.files.splice(+b.dataset.remove,1);renderFiles()}));const count=state.files.length;
 $('#uploadReadiness').textContent=count?`已添加 ${count} 份资料 · 保留文件夹层级 · 单文件上限512 MB`:'尚未添加资料，可选择文件或整个文件夹。';$('#uploadReadiness').classList.toggle('ready',count>0);$('#dropZone').classList.remove('invalid');if(count){$('#fileValidation').textContent='';$('#createFeedback').classList.add('hidden')}
}
async function uploadFiles(projectId,files,active=()=>true){
 const revision=server.current?.revision??0;let index=0;
 for(const item of files){if(!active())return;if(!item.file)continue;item.requestId??=requestId();item.uploadStatus='上传中';renderFiles();
  $('#processMeta').textContent=`正在上传 ${++index}/${files.length}：${item.relativePath||item.name}`;
  try{
   const query=new URLSearchParams({requestId:item.requestId,baseRevision:String(revision),filename:item.name,relativePath:item.relativePath||item.file.webkitRelativePath||item.name});
   const response=await fetch(`/api/projects/${projectId}/materials?${query}`,{method:'POST',headers:{Authorization:'Bearer '+server.token,'Content-Type':'application/octet-stream'},body:item.file});
   const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'上传失败'),{status:response.status});item.processing=data.processing;item.uploadStatus='';item.materialId=data.id;
  }catch(error){item.uploadStatus='上传失败，可重试';if(active())renderFiles();throw new Error(`${item.relativePath||item.name}：${error.message}`)}
  if(!active())return;renderFiles();$('#progressFill').style.width=`${15+Math.round(index/files.length*50)}%`;
 }
}
async function droppedFiles(transfer){
 const entries=Array.from(transfer.items||[]).filter(item=>item.kind==='file').map(item=>item.webkitGetAsEntry?.());
 if(!entries.some(Boolean))return Array.from(transfer.files||[]);
 const files=[];
 async function visit(entry,parent=''){
  if(!entry)return;const relativePath=parent+entry.name;
  if(entry.isFile){const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));files.push({file,relativePath});return}
  if(entry.isDirectory){const reader=entry.createReader();while(true){const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!batch.length)break;for(const child of batch)await visit(child,relativePath+'/')}}
 }
 for(const entry of entries)await visit(entry);return files;
}
document.addEventListener('click',event=>{if(!event.target.closest?.('#chooseFolderBtn'))return;event.preventDefault();event.stopImmediatePropagation();$('#createFolderInput').click()},true);
document.addEventListener('change',event=>{if(event.target.id!=='createFolderInput')return;event.stopImmediatePropagation();addFiles(event.target.files);event.target.value=''},true);
document.addEventListener('drop',event=>{if(!event.target.closest?.('#dropZone'))return;event.preventDefault();event.stopImmediatePropagation();$('#dropZone').classList.remove('drag');const generation=server.navigation;void droppedFiles(event.dataTransfer).then(files=>{if(generation===server.navigation)addFiles(files)}).catch(()=>toast('文件夹读取失败，请用「选择文件夹」重新选择'))},true);
async function startProcessing(){
 if(state.processing)return;const generation=++server.navigation;const files=[...state.files];const name=state.projectName;const metadata={type:state.projectType,location:state.projectLocation,regionDetail:state.projectRegionDetail,brief:$('#projectBrief').value};const active=()=>generation===server.navigation;state.processing=true;setStage('processing');$('#entryContent').classList.add('hidden');$('#processContent').classList.remove('hidden');$('#processList').innerHTML='';
 try{const body={name,metadata};const fingerprint=JSON.stringify(body);if(server.createRequest?.fingerprint!==fingerprint)server.createRequest={fingerprint,id:requestId()};
 $('#processMeta').textContent='正在建立服务器项目空间';$('#progressFill').style.width='15%';const project=await api('/projects',{...body,requestId:server.createRequest.id});if(!active())return;state.currentProjectId=project.id;const initial=await api(`/projects/${project.id}/state`);if(!active())return;server.current=initial;
 $('#processMeta').textContent='正在上传原件并核验内容哈希';await uploadFiles(project.id,files,active);if(!active())return;$('#progressFill').style.width='65%';
 $('#progressFill').style.width='100%';$('#processMeta').textContent='资料已登记，正在梳理章节流程';server.createRequest=null;await refreshProjects();if(!active())return;await refreshCurrent();if(!active())return;state.processing=false;startConsult();watchProject(project.id);try{await generateOutline('',undefined,{planningMode:'recommend'})}catch(error){toast(error.message);renderConsult()}
 }catch(error){if(!active())return;state.processing=false;setStage('create');$('#entryContent').classList.remove('hidden');$('#processContent').classList.add('hidden');toast(error.message)}
}
function startConsult(){if(state.stage==='workspace')clearAnnotationContext();server.viewingPastDraft=false;setStage('consult');$('#consultComposer').classList.remove('hidden');$('#confirmOutline').classList.remove('hidden');renderConsult()}
function consultMode(){const outline=server.current?.outline,key=`pre-outline-message-mode:${server.current?.id}`;let requestedMode='chat';try{requestedMode=sessionStorage.getItem(key)||'chat'}catch{}const mode=consultMessageMode(outline,{dirty:flowEditorState(server.current?.id,outline).dirty,requestedMode});if(mode!==requestedMode)try{sessionStorage.setItem(key,mode)}catch{}return mode}
function setConsultMode(mode){try{sessionStorage.setItem(`pre-outline-message-mode:${server.current.id}`,mode)}catch{}updateFlowConfirmation()}
function updateConsultAgent(){
 if(!server.current)return
 if(!server.agentUI)server.agentUI=mountOutlineAgent($('.consult-bottom'),{input:$('#consultInput'),sendButton:$('#consultSend'),onModeChange:setConsultMode,onDiscussToOutline:compileDiscussion,onCancel:async(jobId,projectId)=>{const result=await api(`/projects/${projectId}/jobs/${jobId}/cancel`,{});if(state.currentProjectId===projectId){const job=server.current.jobs.find(j=>j.id===jobId);if(job)job.status=result.status;updateConsultAgent();await refreshCurrent()}}})
 server.agentUI.update({projectId:server.current.id,jobs:server.current.jobs,connection:server.connection,planningSourceJobId:server.current.outline?.planning?.source?.jobId,mode:consultMode(),canReview:consultMessageMode(server.current.outline,{dirty:flowEditorState(server.current.id,server.current.outline).dirty,requestedMode:'outline'})==='outline',busy:!!server.current.outline?.busy,sending:server.consultSending||server.loading})
}
function updateFlowConfirmation(){
 const outline=server.current?.outline;if(!outline)return
 const editor=flowEditorState(server.current.id,outline),button=$('#confirmOutline'),reviewed=outline.flowReviewed&&!editor.dirty&&outline.status!=='stale',waived=new Set((outline.waivers??[]).map(w=>w.questionId))
 const unresolved=outline.draft?.questions.some(q=>q.blocking&&q.chapterIds.some(id=>outline.flow.includes(id))&&!waived.has(q.id))
 const checking=server.current.jobs.some(job=>job.kind==='outline'&&['queued','running','cancelling'].includes(job.status))
 button.textContent=outline.busy?checking?'正在核对流程资料…':'项目任务处理中…':!outline.draft?'生成推荐章节 ↗':!reviewed?'请先提交流程并核对资料':outline.status==='confirmed'?`返回已确认的 V${outline.version} 工作台 ↗`:`确认 V${outline.version} 本轮流程 · 进入工作台 ↗`
 button.disabled=server.loading||!!outline.busy||!!outline.draft&&(!reviewed||unresolved)
 $('.consult-card').classList.toggle('flow-editing',!!outline.draft&&$('#consultStream [data-flow-pane="flow"]')?.hidden===false)
 $('.consult-help').textContent=consultMode()==='chat'?'讨论不会提交当前编排。':outline.busy?'任务结束后可发送补充，当前输入已保留。':unresolved?'补充资料、回答疑点，或明确本轮跳过。':'确认本轮流程后进入工作台。'
 server.flowEditor?.updateBusy(!!outline.busy||server.loading)
 document.querySelectorAll('[data-discussion-to-outline],[data-plan-new-round]').forEach(action=>{action.disabled=!!outline.busy||server.loading})
 updateConsultAgent()
}
function renderConsult(){
 if(!server.current)return;const outline=server.current.outline,contentKey=consultContentKey(server.current,state.rejectedMaterials),host=$('#consultStream');
 if(server.renderedConsult===contentKey){updateFlowConfirmation();return}
 const reopen=server.renderedOutlineProject===server.current.id?server.flowEditor?.activeChapter?.():null
 server.renderedOutlineProject=server.current.id
 const key=server.current.id+':'+outline?.version,previousScroll=host.scrollTop,same=server.renderedOutline===key;server.renderedOutline=key;server.renderedConsult=contentKey;server.flowEditor?.destroy();server.flowEditor=null;host.innerHTML='';
 if(outline?.draft){const editorHost=document.createElement('div');host.append(editorHost);server.flowEditor=mountFlowEditor(editorHost,{projectId:server.current.id,outline,materials:server.current.materials,
  sourceJob:server.current.jobs.find(j=>j.id===outline.planning?.source?.jobId),
  onNotes:openConsultNotes,getNoteCount:()=>state.annotations.filter(isPendingNote).length,
  onSubmit:flow=>void safely(()=>generateOutline('用户通过流程编辑器提交流程，请严格保留选择与顺序，逐章比对已有资料并询问必要缺项。',flow)),
  onRefreshPlan:()=>void (outline.planning?.source?compileDiscussion(outline.planning.source.jobId):safely(()=>generateOutline('',undefined,{planningMode:'recommend'}))),
  onTaskChoice:(chapterId,index,action,text)=>void safely(async()=>{
   await mutate('outline/tasks',{version:outline.version,planningRevision:outline.planning.revision,chapterId,index,action,...(text===undefined?{}:{text})})
  }),
  onChapterFeedback:(chapterId,text)=>void safely(async()=>{
   await generateOutline(text,flowEditorState(server.current.id,outline).selected,{planningMode:'adjust',targetChapterId:chapterId})
  }),
  onAnswer:q=>{setConsultMode('outline');server.agentUI.setDraft($('#consultInput').value.trim()?$('#consultInput').value:q.prompt+' 我的补充：')},
  onDecision:(questionId,action,reason)=>void safely(async()=>{await mutate('outline/decisions',{version:outline.version,inputHash:outline.inputHash,questionId,action,reason});renderConsult()}),
  onUpload:()=>$('#outlineFileInput').click(),onChange:updateFlowConfirmation,
 });}else consultBubble(outlineMarkup(outline,server.current.materials));
 const chats=server.current.jobs.filter(j=>j.kind==='chat'&&j.status==='completed'&&j.result?.response)
 const latest=chats.at(-1)
 if(latest&&latest.id!==outline.planning?.source?.jobId&&outline.status!=='confirmed'){
  const action=document.createElement('button');action.type='button';action.className='link-like';action.dataset.discussionToOutline=latest.id
  action.dataset.flowProjectAction='toolbar';action.textContent='用最近讨论生成章节建议';action.disabled=!!outline.busy
  action.onclick=()=>void compileDiscussion(latest.id)
  const toolbar=host.querySelector('.flow-editor-toolbar')
  if(toolbar){
   const label=toolbar.querySelector('strong');label?.after(action)
  }else host.prepend(action)
 }
 if(outline.confirmedAt&&outline.status==='confirmed'&&outline.planning){
  const button=document.createElement('button');button.type='button';button.className='link-like';button.dataset.planNewRound=''
  button.dataset.flowProjectAction='steps';button.textContent='新一轮编排';button.disabled=!!outline.busy
  button.onclick=()=>void (outline.planning.source?compileDiscussion(outline.planning.source.jobId,true):safely(()=>generateOutline('',undefined,{planningMode:'recommend'})))
  host.querySelector('.flow-stepbar')?.append(button)
 }
 if(server.current.workflow?.current&&outline.status!=='confirmed'){
  const previous=document.createElement('button');previous.type='button';previous.className='link-like';previous.dataset.flowProjectAction='steps';previous.textContent='查看历史初稿'
  previous.onclick=()=>{clearAnnotationContext();server.viewingPastDraft=true;enterWorkspace({resume:true,snapshot:{}});openWorkflowDraft()}
  host.querySelector('.flow-stepbar')?.append(previous)
 }
 const extraHost=host.querySelector('[data-flow-extra]')||host
 const historical=server.current.materials.map(materialNotice).filter(Boolean)
 if(historical.length){
  const note=document.createElement('div')
  note.innerHTML=materialNoticesMarkup(historical,'历史原件')+'<button type="button" class="ghost-btn">补充资料</button>'
  note.querySelector('button').onclick=()=>$('#outlineFileInput').click()
  extraHost.append(note)
 }
 if(state.rejectedMaterials?.length)extraHost.insertAdjacentHTML('beforeend',materialNoticesMarkup(state.rejectedMaterials,'本次筛出的资料'))
 if(reopen&&state.stage==='consult')server.flowEditor?.openChapter?.(reopen)
 updateFlowConfirmation();requestAnimationFrame(()=>{host.scrollTop=same?previousScroll:0})
}
async function generateOutline(text,flow,options={}){
 const outline=server.current.outline,mode=options.planningMode
 const proposed=mode==='fromDiscussion'||mode==='recommend'
 const order=proposed?null:flow??(outline.flowReviewed?outline.flow:null)
 const projectId=server.current.id
 await mutate('outline/draft',{outlineVersion:outline.version,text,...(order?{flow:order}:{}),
  ...(outline.planning&&!proposed?{planningMode:mode??'check',planningRevision:outline.planning.revision}:{}),...options})
 if(state.currentProjectId===projectId&&state.stage==='consult')renderConsult()
}
function compileDiscussion(jobId,force=false){
 const outline=server.current?.outline
 if(!outline)return
 if(!force&&!outline.planningInputsChanged&&outline.status!=='stale'&&outline.planning?.source?.jobId===jobId){
  startConsult()
  server.flowEditor?.openChapter?.(outline.planning.changed[0]??outline.flow[0])
  return
 }
 if(server.loading||outline.busy){toast('项目正在处理任务，请等待本次完成。');return}
 const projectId=server.current.id
 startConsult()
 return safely(async()=>{
  await generateOutline('',undefined,{planningMode:'fromDiscussion',sourceJobId:jobId})
  if(state.currentProjectId===projectId)toast('正在按章整理这条研判')
 })
}

function consultAnswer(answer){
 if(!answer.trim()||!server.current)return
 updateConsultAgent();if(server.consultSending||server.loading){server.agentUI.setNotice('正在保存上一项操作，当前文字已保留。');return}
 const projectId=server.current.id,sent=$('#consultInput').value,mode=consultMode()
 if(mode==='outline'&&server.current.outline.busy){server.agentUI.setNotice('任务运行中，可继续编辑补充，结束后发送。');return}
 server.consultSending=true;server.agentUI.setNotice('');updateConsultAgent()
 void(async()=>{try{
  if(mode==='outline')await generateOutline(answer);else await mutate('chat',{text:answer,discussionOnly:true,discussionFlow:flowEditorState(projectId,server.current.outline).selected})
  server.agentUI.acknowledge(projectId,sent)
 }catch(error){if(state.currentProjectId===projectId)server.agentUI.setNotice(`未发送：${error.message}；文字已保留。`)}finally{server.consultSending=false;if(state.currentProjectId===projectId)updateFlowConfirmation()}})()
}
function finishConsult(){startConsult()}
function askQuestion(){}
async function openExistingProject(id){if(server.loading)return;clearAnnotationContext();if(state.currentProjectId!==id)state.rejectedMaterials=[];server.viewingPastDraft=false;const generation=++server.navigation;await safely(async()=>{closeProjectMenu();closeLibrary();$('#resumeProjectName').textContent=projectRecords.find(p=>p.id===id)?.name||'项目';$('#resumeDescription').textContent='正在恢复资料、章节草案和确认进度。';setStage('resume');state.currentProjectId=id;state.selected=null;state.activeScript=null;state.activeArt=null;$('#previewOverlay').classList.add('hidden');await refreshCurrent(true);if(generation!==server.navigation||state.currentProjectId!==id||state.stage!=='resume')return;if(server.current.outline?.status==='confirmed'||!server.current.outline?.draft&&server.current.workflow?.current&&!server.current.workflow.current.stale)enterWorkspace({resume:true,snapshot:{}});else startConsult();watchProject(id)})}
function applyAnnotations(value){
 state.annotations=value.annotations.map(n=>({...n,targetId:n.reference?.id||n.anchor,targetKind:n.reference?.kind||'script',targetTitle:n.reference?.title||n.anchor,excerpt:n.reference?.excerpt||'',createdAt:n.created_at?new Date(n.created_at).toLocaleString('zh-CN'):'',status:n.status==='completed'?'done':n.status,batchId:n.batch_id}));
}
function applySnapshot(value){
 server.current=value;state.projectName=value.name;state.projectType=value.type||'其他类型';state.projectLocation=value.location||'';state.files=value.materials.map(f=>({name:f.filename,relativePath:f.relativePath||f.filename,size:f.bytes,processing:f.processing}));
 applyAnnotations(value)
 state.scripts={};const ids=new Set((value.core.stateObjects||[]).map(o=>o.objectId));for(const p of value.core.proposals||[])if(p.status==='pending_review')ids.add(p.envelope.target_object_id);if(!ids.size)ids.add('PS01');
 [...ids].sort().forEach((objectId,index)=>{const id=`script-${Math.floor(index/2)+1}-${index%2+1}`,confirmed=(value.core.stateObjects||[]).find(o=>o.objectId===objectId),proposal=[...(value.core.proposals||[])].reverse().find(p=>p.status==='pending_review'&&p.envelope.target_object_id===objectId);const payload=proposal?.envelope.change_set?.payload||confirmed?.value;
 state.scripts[id]={id,objectId,proposalId:proposal?.proposalId,body:payload?textValue(payload.data??payload):'等待资料分析与专业提案。',payload,confirmed:confirmed?.value,thesis:payload?.data?.start_reason||payload?.data?.canonical_name||'等待专业分析',evidence:payload?.quality?.issues?.length?textValue(payload.quality.issues):'内容来自项目资料与 Agent 提案；尚无已记录的缺项，不代表已经核验。',visualBrief:'当前为专业状态的文字成果页；完整图文编排尚未接入。',approved:!!confirmed&&!proposal,generated:!!confirmed,revision:value.revision};});
 $('#sidebarProjectName').textContent=value.name;updateProjectSwitcher();globalThis.prePlatform?.onState(value);
 if(value.outline?.draft)for(const chapter of value.outline.draft.chapters)for(const [index,task] of chapter.tasks.entries()){
  const id=`outline-${chapter.id}-${index+1}`;state.scripts[id]={id,objectId:id,outlineTask:true,capability:chapterCapabilityLabel(chapter),body:task,thesis:task,evidence:[...chapter.gaps,...[...(value.outline.waivers??[]),...(value.outline.retainedWaivers??[])].filter(w=>w.chapterIds.includes(chapter.id)).map(w=>'本轮已跳过：'+w.prompt+'；原因：'+w.reason)].join('；')||'按已确认章节流程开展资料核验。',visualBrief:'当前是研究任务安排，尚未生成专业成果。',approved:false,generated:false,revision:value.revision}
 }
 const draft=value.workflow?.current
 for(const block of draft?.blocks??[]){
  if(block.sectionText){const section=workflowRecord(value,block);state.scripts[section.id]=section}
  const items=draft.formatVersion===2?workflowBlockItems(block):[undefined]
  for(const item of items){const record=workflowRecord(value,block,item);state.scripts[record.id]=record}
 }
}
async function refreshCurrent(force=false){const id=state.currentProjectId;if(!id)return;const value=await api(`/projects/${id}/state`);if(state.currentProjectId!==id)return;const fingerprint=JSON.stringify(value);if(!force&&server.current?.id===id&&server.fingerprints.get(id)===fingerprint)return;const previous=server.current
 server.fingerprints.set(id,fingerprint)
 // Updating the library must not rebuild the graph, the selected paragraph or the chat thread.
 if(!force&&previous?.id===id&&JSON.stringify(previous.annotations)!==JSON.stringify(value.annotations)){
  const content=({annotations,updatedAt,pendingCount,...other})=>JSON.stringify(other)
  if(content(value)===content(previous)){server.current=value;applyAnnotations(value);updateAnnotationUI();return}
 }
 applySnapshot(value);if(state.stage==='workspace'&&!server.viewingPastDraft&&value.outline?.status!=='confirmed'&&(value.outline?.draft||!value.workflow?.current)){startConsult()}if(state.stage==='workspace'){renderGraph();initChat();updateAnnotationUI();updateComposer();refreshOpenPreview()}if(state.stage==='consult')renderConsult();updatePipelineUI()}
function refreshOpenPreview(){
 if($('#previewOverlay').classList.contains('hidden'))return
 if(state.previewMode==='script'){const id=state.activeScript?.script.id;state.deckEntries=state.activeScript?.record?.sectionBody?workflowBodyEntries():allScriptEntries();state.previewIndex=Math.max(0,state.deckEntries.findIndex(section=>section.script.id===id));state.activeScript=state.deckEntries[state.previewIndex];if(state.activeScript)renderScriptPage();else closePreview()}
 else{const id=state.activeArt?.id,deckDraftId=state.activeArt?.draftId;state.deckEntries=allVisualEntries();state.previewIndex=state.deckEntries.findIndex(entry=>entry.art.id===id&&entry.art.draftId===deckDraftId);if(state.previewIndex>=0)renderPreviewPage();else closePreview()}
}
function watchProject(id){
 server.watch?.abort()
 server.watch=watchProjectEvents({url:`/api/projects/${id}/events`,headers:{Authorization:'Bearer '+server.token},
  refresh:async()=>{if(state.currentProjectId===id)await refreshCurrent()},
  onConnection:connection=>{if(state.currentProjectId!==id)return;server.connection=connection;updateConsultAgent();updateWorkflowStatus()},
  onProgress:event=>{
   if(state.currentProjectId!==id)return true
   const job=server.current?.jobs.find(j=>j.id===event.id);if(!job)return false
   if(!['queued','running','cancelling'].includes(job.status))return true
   if(!event.progress)return false
   if(job.progress?.updatedAt&&Date.parse(event.progress.updatedAt)<Date.parse(job.progress.updatedAt))return true
   job.progress=event.progress;updateConsultAgent();updateWorkflowStatus();return true
  },
 })
}
function buildData(){
 const project=server.current,outline=project?.outline,draft=project?.workflow?.current
 if(outline?.draft){
  const entries=draft?.formatVersion===2&&draft.outlineVersion===outline.version?workflowSections():[]
  const byBlock=new Map()
  for(const entry of entries){
   const blockId=entry.record.blockId
   if(!byBlock.has(blockId))byBlock.set(blockId,[])
   byBlock.get(blockId).push(entry)
  }
  const flow=outline.flow??outline.draft.chapters.map(c=>c.id)
  const published=draft?.formatVersion===2&&draft.outlineVersion===outline.version?reportHierarchy(draft):[]
  return flow.map(id=>outline.draft.chapters.find(c=>c.id===id)).filter(Boolean).map((chapter,c)=>{
   const publishedChapter=published.find(v=>v.id===chapter.id)
   const number=outlineNumber('',c,flow.length)
   const sections=publishedChapter?.sections.length?publishedChapter.sections:
    chapter.tasks.map((title,j)=>({block:{id:`outline-${chapter.id}-${j+1}`,title},number:outlineNumber(number,j,chapter.tasks.length),numbered:chapter.tasks.length>1}))
   return {id:`chapter-${c+1}`,catalogId:chapter.id,index:c+1,number,name:chapter.title,sections:sections.map(({block,number,numbered},j)=>{
    const id=block.id,r=state.scripts[id],scripts=draft?.formatVersion===2?(byBlock.get(id)??[]):undefined
    return {id:`section-${c+1}-${j+1}`,name:block.title,number,numbered,sectionBody:!!block.sectionText,script:{id},scripts,artifact:{id:`page-${c+1}-${j+1}`,title:block.title,type:'HTML',visual:'text',chapter:c+1,section:j+1,sourceSection:id,pageCount:0,generated:false,record:r}}
   })}
  })
 }
 const scripts=Object.values(state.scripts).filter(record=>!record.workflowDraft),chapters=[];for(let i=0;i<scripts.length;i++){const r=scripts[i],c=Math.floor(i/2),j=i%2;if(!chapters[c])chapters[c]={id:`chapter-${c+1}`,index:c+1,name:c===0?'项目背景':'专业研究',sections:[]};chapters[c].sections.push({id:`section-${c+1}-${j+1}`,name:r.objectId==='PS01'?'项目基本情况与启动原因':r.objectId,number:`${c+1}.${j+1}`,script:{id:r.id},artifact:{id:`page-${c+1}-${j+1}`,title:r.objectId==='PS01'?'项目基本情况':r.objectId,type:'HTML',visual:'text',chapter:c+1,section:j+1,sourceSection:r.objectId,pageCount:1,generated:r.generated,record:r}})}return chapters
}
function coreSections(){return Object.values(state.scripts).filter(r=>!r.outlineTask&&(r.payload||r.confirmed||r.proposalId)).map((r,i)=>({id:`core-${r.objectId}`,name:r.objectId==='PS01'?'项目基本情况与启动原因':`专业记录 ${r.objectId}`,number:r.objectId,script:{id:r.id},artifact:{id:`core-page-${r.objectId}`,title:`专业记录 ${r.objectId}`,type:'HTML',visual:'text',chapter:0,section:i+1,sourceSection:r.objectId,pageCount:1,generated:r.generated,record:r}}))}
function workflowSections(){
 const draft=server.current?.workflow?.current,deck=currentWorkflowVisual(server.current)
 const pages=new Map((deck?.pages??[]).map(page=>[page.itemId,page]))
 let pageNumber=0
 return (draft?reportHierarchy(draft):[]).flatMap(ch=>ch.sections.flatMap(({block,number:sectionNumber})=>{
  const items=draft.formatVersion===2?workflowBlockItems(block):[undefined]
  return items.map((item,index)=>{
   const {id}=workflowRecord(server.current,block,item),record=state.scripts[id]
   const presentation=workflowItemPresentation(block,index,sectionNumber),page=pages.get(item?.id)
   const visual=page?.blockId===block.id?{...page,itemCount:items.length,displayTitle:presentation.title}:undefined
   return {id:item?.id??`workflow-section-${block.id}`,...presentation,name:presentation.title,pageNumber:++pageNumber,sectionName:block.title,script:{id},record,...(visual?{visual}:{})}
  })
 }))
}
function workflowBodyEntries(){
 const doc=server.current?.workflow?.current
 return (doc?reportHierarchy(doc):[]).flatMap(ch=>ch.sections.filter(({block})=>block.sectionText).map(({block,number})=>{
  const rec=workflowRecord(server.current,block)
  return {id:rec.id,script:{id:rec.id},record:rec,name:rec.title,title:rec.title,number}
 }))
}
function allScriptEntries(){return [...workflowSections(),...coreSections()]}
function openScriptPreview(section){
 const entries=section.record?.sectionBody||state.scripts[section.script.id]?.sectionBody?workflowBodyEntries():allScriptEntries()
 const index=entries.findIndex(entry=>entry.script.id===section.script.id)
 if(index<0)return
 state.previewMode='script';state.previewDeckMode=true;state.deckEntries=entries;state.previewIndex=index
 state.activeScript=entries[index];state.scriptEditing=false;previewData=null;state.activeArt=null
 $('#previewOverlay').classList.remove('hidden');renderScriptPage()
}
function allVisualEntries(){
 const deck=currentWorkflowVisual(server.current)
 if(!deck)return []
 const entries=new Map(workflowSections().map(section=>[section.visual?.id,section]))
 return deck.pages.flatMap(page=>{
  const section=entries.get(page.id)
  return section?[{art:{id:page.id,title:section.title,type:'HTML',record:section.record,page:section.visual,version:deck.version,draftId:deck.draftId},localIndex:0,section}]:[]
 })
}
function scriptStats(){
 const rows=server.current?.outline?.draft?buildData().flatMap(chapter=>chapter.sections.flatMap(section=>section.scripts?.length?section.scripts.map(script=>script.record):[state.scripts[section.script.id]])).filter(Boolean):Object.values(state.scripts)
 const pages=allVisualEntries().length
 return {total:rows.length,approved:rows.filter(r=>r.approved).length,generated:pages,pages}
}
function updatePipelineUI(){
 if(typeof state==='undefined')return
 const st=scriptStats(),pending=Object.values(state.scripts).filter(r=>r.proposalId),running=server.current?.jobs.some(j=>['queued','running','cancelling'].includes(j.status)),outline=server.current?.outline,draft=server.current?.workflow?.current
 $('#scriptProgress').textContent=outline?.draft?`章节流程 V${outline.version} · ${outline.status==='confirmed'?'已确认':'待核对'}${draft?` · 初稿 V${draft.version}`:''}`:`文字成果 ${st.approved}/${st.total} 已确认`
 const btn=$('#pipelineBtn');btn.textContent=draft?workflowIsStale(server.current)?'查看旧版初稿':'查看本轮初稿':running?'正在生成初稿…':outline?.draft?outline.status==='confirmed'?'生成本轮初稿':'核对本轮流程':pending.length?`审阅 ${pending.length} 项待确认提案`:'等待专业提案'
 btn.disabled=server.loading||!draft&&(!!running||!outline?.draft&&!pending.length)
 $('#chatSubmit').disabled=!!running||server.loading||!!state.selected?.workflowDraftId&&(workflowIsStale(server.current)||state.selected.workflowDraftId!==draft?.id)
 updatePreviewControls();updateWorkflowStatus();updateFlowConfirmation()
}
function updateWorkflowStatus(){
 if(!server.current||server.current.id!==state.currentProjectId)return
 if(!server.workflowUI)server.workflowUI=mountWorkflowStatus($('#chatHistory'),{onOpen:openWorkflowDraft,onGenerate:()=>void safely(generateWorkflowDraft),onDownloads:()=>void globalThis.prePlatform?.openTasks(),
  onReport:id=>globalThis.prePlatform.downloadArtifact(state.currentProjectId,'workflow-'+id+'-pdf'),onApprove:()=>void safely(approveWorkflowDraft),onVisuals:()=>void safely(generateWorkflowVisuals),
  onOpenVisual:()=>openWorkflowVisual(),onLayout:()=>openWorkflowLayout(),onNotice:toast,onCancel:async(jobId,projectId)=>{await api(`/projects/${projectId}/jobs/${jobId}/cancel`,{});if(state.currentProjectId===projectId)await refreshCurrent()}})
 server.workflowUI.update({project:server.current,connection:server.connection,loading:server.loading})
}
async function generateWorkflowDraft(){if(server.current?.outline?.status!=='confirmed'){closePreview();startConsult();toast('请先确认本轮章节流程。');return}await mutate('workflow/draft',workflowDraftMutation(server.current));closePreview();toast('已开始生成本轮初稿，可在右侧查看进度。')}
function openWorkflowDraft(){const bodies=workflowBodyEntries();const sections=bodies.length?bodies:workflowSections(),section=sections.find(s=>!state.scripts[s.script.id]?.approved)??sections[0];if(section)openScriptPreview(section)}
function workflowDraftForApproval(){
 const draft=server.current?.workflow?.current
 if(draft?.formatVersion!==2||workflowIsStale(server.current))throw new Error('请先生成当前的条目脚本。')
 return draft
}
async function approveWorkflowDraft(){
 const draft=workflowDraftForApproval()
 if(draft.approval?.draftId===draft.id)return
 await mutate('workflow/approve',{draftId:draft.id})
 toast('整稿已确认，可生成整套成果。')
}
async function generateWorkflowVisuals(){
 const draft=workflowDraftForApproval()
 if(draft.approval?.draftId!==draft.id)throw new Error('请先确认整稿。')
 if(currentWorkflowVisual(server.current))return
 await mutate('workflow/visuals',{draftId:draft.id})
 toast('整套 HTML 汇报页已生成。')
}
function openWorkflowVisual(page){
 const entries=allVisualEntries(),index=page?entries.findIndex(entry=>entry.art.id===page.id):0
 if(!entries[index])return
 state.previewMode='visual';state.previewDeckMode=true;state.deckEntries=entries;state.previewIndex=index
 state.activeScript=null;state.scriptEditing=false
 $('#previewOverlay').classList.remove('hidden');renderPreviewPage()
}
function openWorkflowLayout(pageId){
 const deck=currentWorkflowVisual(server.current)
 if(!deck)return
 server.visualDialog?.remove()
 const projectId=state.currentProjectId,dialog=document.createElement('dialog')
 server.visualDialog=dialog;dialog.className='workflow-layout-dialog';dialog.dataset.workflowLayoutDialog=''
 dialog.setAttribute('aria-labelledby','workflow-layout-title')
 dialog.innerHTML=`<form><h2 id="workflow-layout-title">调整页面版式</h2><fieldset><legend>选择一页或多页</legend>${deck.pages.map(page=>`<label><input type="checkbox" name="pageIds" value="${escapeHTML(page.id)}" ${page.id===pageId?'checked':''}> ${escapeHTML(page.number+' '+(deck.pages.filter(other=>other.blockId===page.blockId).length===1?page.sectionTitle:page.item.title))}</label>`).join('')}</fieldset>
 <label>统一版式 <select name="layout"><option value="points">要点</option><option value="columns">双栏</option><option value="focus">重点</option></select></label>
 <p role="status"></p><footer><button type="button" data-cancel-layout>取消</button><button type="submit" class="primary-btn">应用版式</button></footer></form>`
 const form=dialog.querySelector('form'),message=dialog.querySelector('[role=status]'),submit=form.querySelector('[type=submit]')
 const selectedPage=deck.pages.find(page=>page.id===pageId)
 if(selectedPage)form.querySelector('[name=layout]').value=selectedPage.layout
 form.querySelector('[data-cancel-layout]').onclick=()=>dialog.close()
 dialog.addEventListener('keydown',event=>event.stopPropagation())
 dialog.addEventListener('close',()=>{dialog.remove();if(server.visualDialog===dialog)server.visualDialog=null})
 form.onsubmit=event=>{
  event.preventDefault()
  const pageIds=[...form.querySelectorAll('[name=pageIds]:checked')].map(input=>input.value)
  if(!pageIds.length){message.textContent='请至少选择一页。';return}
  if(state.currentProjectId!==projectId||currentWorkflowVisual(server.current)?.id!==deck.id){message.textContent='成果版本已变化，请关闭窗口后重新选择。';return}
  void safely(async()=>{
   submit.disabled=true;message.textContent=''
   try{
    await mutate('workflow/visuals',{draftId:deck.draftId,baseVisualId:deck.id,pageIds,layout:form.querySelector('[name=layout]').value})
    if(dialog.open)dialog.close()
    if(state.currentProjectId===projectId)toast(`已调整 ${pageIds.length} 页版式。`)
   }catch(error){message.textContent=error.message}finally{submit.disabled=false}
  })
 }
 document.body.append(dialog);dialog.showModal()
}
function scriptStatusLabel(rec){return rec?.workflowDraft?workflowStatusLabel(rec):rec?.outlineTask?'任务待生成':rec?.proposalId?'待确认':rec?.approved?'已确认':'待分析'}
function renderScriptNode(sec){const rec=state.scripts[sec.script.id];return `<div class="script-top"><strong>${rec?.workflowDraft?'阶段初稿':rec?.outlineTask?'研究任务':'文字脚本'} <span>${escapeHTML(sec.number)}</span></strong><em class="script-status ${rec?.approved?'approved':'draft'}">${scriptStatusLabel(rec)}</em></div><div class="script-excerpt">${escapeHTML(rec?.workflowDraft?rec.body:rec?.thesis||'等待资料梳理')}</div><div class="script-bottom">${rec?.workflowDraft?'双击查看本节初稿':'双击查看并执行任务'} <span>↗</span></div>`}
function renderGraph(){
 server.graphNodeDrag?.destroy()
 clearGraphAction();state.activeNodeId=null;graphData=buildData()
 const layoutKey=`pre-graph-layout:${state.currentProjectId}:${server.current?.outline?.version??0}:${server.current?.workflow?.current?.id??'tasks'}`
 let positions={};try{positions=JSON.parse(localStorage.getItem(layoutKey)||'{}')}catch{}
 const layout=renderWorkflowGraph({chapters:graphData,records:state.scripts,projectName:state.projectName,positions,board:$('#graphBoard'),nodeLayer:$('#nodeLayer'),edgeLayer:$('#edgeLayer'),makeNode,renderScriptNode:(entry,section)=>section?undefined:renderScriptNode(entry),onOpenScript:openScriptPreview,onOpenVisual:openWorkflowVisual,onSelectEdge:(edge,event)=>{
  document.querySelectorAll('.edge.is-picked').forEach(node=>node.classList.remove('is-picked'));document.querySelectorAll('.mapnode.active').forEach(node=>node.classList.remove('active'));state.activeNodeId=null
  event.target.previousElementSibling?.classList.add('is-picked')
  const viewport=$('#graphViewport').getBoundingClientRect(),board=state.board;state.pendingTarget={id:`line:${edge.source.id}:${edge.target.id}`,kind:'line',title:`${edge.source.title} → ${edge.target.title}`,excerpt:'章节之间的关联'};showGraphAction((event.clientX-viewport.left-board.x)/board.scale,(event.clientY-viewport.top-board.y)/board.scale)
 }})
 state.nodeRects=layout.rects;graphPositions.root=layout.root;graphPositions.boardW=layout.boardW;graphPositions.boardH=layout.boardH
 if(layout.columns){graphPositions.chapterX=layout.columns.chapter.x;graphPositions.sectionX=layout.columns.section.x;graphPositions.scriptX=layout.columns.script.x}
 const pages=allVisualEntries().length,hint=pages?'章 → 节 → 条 → 文字脚本 → 页':'章 → 节 → 条 → 文字脚本'
 $('#outlineCount').textContent=`${graphData.length} 章 · ${layout.sectionCount} 节 · ${layout.scriptCount} 条脚本${pages?` · ${pages} 页成果`:''}`
 $('.workspace-top .eyebrow').textContent='CONTENT MAP / 章节关系图';$('.workspace-top .pane-title h2').textContent='章节 · 汇报文字'
 $('.visual-mode-control').classList.add('hidden');$('#fullDeckBtn').classList.toggle('hidden',!pages);$('#visualLayoutHint').textContent=hint
 $('.empty-space-tip').textContent='右键批注 · 右键拖动图块 · 双击预览'
 const legend=$('.canvas-legend');legend.innerHTML=`<span id="visualLayoutHint">${hint}</span><span class="legend-dot"></span><span>右键批注或拖动 · 左键平移</span>`
 if(!server.graphPan)server.graphPan=mountGraphPan($('#graphViewport'),{getBoard:()=>state.board,onTransform:transformBoard,onPanStart:clearGraphAction})
 server.graphNodeDrag=mountGraphNodeDrag($('#graphViewport'),{getLayout:()=>layout,getScale:()=>state.board.scale,board:$('#graphBoard'),nodeLayer:$('#nodeLayer'),edgeLayer:$('#edgeLayer'),onStart:clearGraphAction,onContext:(node,point,origin,edgeId)=>offerAnnotation(graphNote(node,edgeId),point,origin),onCommit:positions=>{
  graphPositions.boardW=layout.boardW;graphPositions.boardH=layout.boardH
  try{localStorage.setItem(layoutKey,JSON.stringify(positions))}catch{toast('布局已调整，本次无法保存到浏览器。')}
 }})
 updatePipelineUI()
}
function initChat(){$('#chatHistory').innerHTML='<div class="chat-date">项目会话 · 服务器记录</div>';if((server.current?.outline?.waivers?.length||0)+(server.current?.outline?.retainedWaivers?.length||0))addChat('system',`<div class="flow-waiver"><b>本轮明确跳过的资料与限制</b>${[...server.current.outline.waivers,...(server.current.outline.retainedWaivers??[])].map(w=>`<p>${escapeHTML(w.prompt)}<br>原因：${escapeHTML(w.reason)}；涉及章：${escapeHTML(w.chapterIds.join('、'))}</p>`).join('')}</div>`);const materials=server.current?.materials||[];if(materials.length)addChat('system',`<details><summary>已保存 ${materials.length} 份原件 · 查看路径与解析状态</summary>${materials.map(f=>`${escapeHTML(f.relativePath||f.filename)} — ${escapeHTML(f.processing?.label||'原件已保存')}`).join('<br>')}</details>`);const professional=coreSections();if(professional.length)addChat('system',`<details open><summary>专业提案与已确认成果 · ${professional.length} 项</summary>${professional.map(sec=>`<p><button type="button" class="link-like" data-open-core="${escapeHTML(sec.script.id)}">${escapeHTML(sec.name)} · ${escapeHTML(scriptStatusLabel(state.scripts[sec.script.id]))}</button></p>`).join('')}</details>`);for(const job of server.current?.jobs||[]){
 if(job.user_text)addChat('me',job.user_text,false)
 if(job.result?.response){
  const canCompile=job.kind==='chat'&&job.status==='completed'
  const label=server.current.outline?.planning?.source?.jobId===job.id?'查看章节建议':'编入章节'
  const control=canCompile?`<button type="button" class="link-like" data-discussion-to-outline="${escapeHTML(job.id)}">${label}</button>`:''
  addChat('ai',escapeHTML(job.result.response).replaceAll('\n','<br>')+control)
 }else if(job.error)addChat('system',escapeHTML(job.error))
 else addChat('system',escapeHTML(statusText[job.status]||job.status))
}}

function handleChatSubmit(){const text=$('#chatInput').value.trim();if(!text)return;void safely(async()=>{if(state.selected){const ref=state.selected,rec=recordForReference(ref.id);if(ref.workflowDraftId&&!rec?.workflowDraft||rec?.itemId&&(ref.workflowDraftId!==rec.workflowDraftId||ref.blockId!==rec.blockId||ref.itemId!==rec.itemId))throw new Error('引用来自旧版初稿，请重新引用当前内容。');if(rec?.workflowDraft){await mutate('workflow/draft',workflowDraftMutation(server.current,rec,text,ref.workflowDraftId));clearReference();$('#chatInput').value='';toast(rec.sectionBody?'已提交本节修改，完成后形成新版初稿。':'已提交本条修改，完成后形成新版初稿。');return}if(rec?.outlineTask)throw new Error('请先生成本轮初稿，再针对条目提交修改。');if(!rec)throw new Error('请选择具体章节、文字脚本或成果再批注');await mutate('annotations',{anchor:rec.objectId,text,reference:{...ref}});clearReference();toast('批注已保存，尚未执行 Agent')}else await mutate('chat',{text});$('#chatInput').value='';})}
function recordForReference(id){
 const base=String(id).split('#')[0].replace(/^article:/,''),direct=state.scripts[base];if(direct)return direct
 const section=[...graphData.flatMap(chapter=>chapter.sections),...allScriptEntries()].find(section=>section.id===base||section.visual?.id===base||section.artifact&&(section.artifact.id===base||base.startsWith(section.artifact.id+'__page__')))
 return section?state.scripts[section.script.id]:Object.values(state.scripts).find(record=>record.objectId===base)
}
function workflowReference(record){
 return {workflowDraftId:record.workflowDraftId,blockId:record.blockId,itemId:record.itemId}
}
function referenceSnapshot(ref){
 const rec=recordForReference(ref.id)
 return rec?.workflowDraft?{...workflowReference(rec),...ref}:ref
}
function workflowExcerpt(record){return (record.item?workflowItemText(record.item):record.body).slice(0,700)}
function workflowReadOnly(record){return record.stale||record.legacy}
function annotationTarget(anchor,kind,title,excerpt='',version={}) {
 const project=server.current
 if(!anchor||!project||project.id!==state.currentProjectId)return null
 return {projectId:project.id,baseRevision:project.revision,anchor,reference:{id:anchor,kind,title:String(title).slice(0,300),excerpt:String(excerpt).trim().slice(0,2000),...version}}
}
function chapterNote(catalogId,title){
 const outline=server.current.outline
 const name=title??outline.draft?.chapters.find(chapter=>chapter.id===catalogId)?.title
 return name?annotationTarget('chapter-'+catalogId,'chapter',name,'',outlineNoteVersion(outline)):null
}
function outlineNoteVersion(outline){
 return {outlineVersion:outline.version,...(outline.planning?{planningRevision:outline.planning.revision}:{})}
}
function recordNote(record,title,page){
 if(!record)return null
 if(record.outlineTask&&!record.workflowDraft&&/^outline-/.test(record.objectId)){
  return annotationTarget(record.objectId,'section',title||record.title,record.thesis,outlineNoteVersion(server.current.outline))
 }
 const version=record.workflowDraft?{outlineVersion:record.outlineVersion,...workflowReference(record)}:{}
 if(page){
  const deck=currentWorkflowVisual(server.current)
  if(!deck)return null
  Object.assign(version,{visualId:deck.id,pageId:page.id})
 }
 return annotationTarget(page?.id??record.objectId,page?'page':'script',title||record.title,record.workflowDraft?workflowExcerpt(record):record.thesis,version)
}
function graphNote(node,edgeId){
 if(!node)return null
 if(edgeId){
  const source=state.nodeRects.get(edgeId.split('--')[0]),note=graphNote(node)
  if(!source||!note)return null
  Object.assign(note.reference,{kind:'line',id:'line:'+graphNote(source).anchor+':'+note.anchor,title:(source.title+' → '+node.title).slice(0,300)})
  return note
 }
 if(node.kind==='artifact')return recordNote(node.entry.record,node.title,node.visual)
 if(node.kind==='script'||node.kind==='article')return recordNote(node.record,node.title)
 if(node.kind==='chapter'&&node.chapter.catalogId)return chapterNote(node.chapter.catalogId,node.title)
 if(node.kind==='section'){
  if(node.section.sectionBody)return recordNote(state.scripts[node.section.script.id],node.title)
  if(node.chapter.catalogId){
   return annotationTarget(node.section.script.id,'section',node.title,'',outlineNoteVersion(server.current.outline))
  }
  return recordNote(state.scripts[node.section.script.id],node.title)
 }
 const target=annotationTarget('project',node.kind==='root'?'project':'chapter',node.title)
 if(target)target.reference.id=node.id
 return target
}
function previewAnnotationTarget(){
 const art=state.previewMode==='visual'?state.activeArt:null
 return recordNote(previewRecord(),art?.title??state.activeScript?.name,art?.page)
}
const annotationControls='button,a,input,textarea,select,[contenteditable]:not([contenteditable=false]),.annotation-composer'
function selectedPhrase(doc,scope){
 const selection=doc.getSelection()
 if(!scope||!selection?.rangeCount||selection.isCollapsed||!scope.contains(selection.anchorNode)||!scope.contains(selection.focusNode))return null
 const element=node=>node.nodeType===1?node:node.parentElement
 if(doc.activeElement?.matches('input,textarea,select')||doc.activeElement?.isContentEditable)return null
 if(element(selection.anchorNode)?.closest(annotationControls)||element(selection.focusNode)?.closest(annotationControls))return null
 const text=selection.toString()
 if(!text.trim())return null
 const range=selection.getRangeAt(0)
 if([...scope.querySelectorAll(annotationControls)].some(control=>range.intersectsNode(control)))return null
 const rects=[...range.getClientRects()].filter(rect=>rect.width&&rect.height)
 if(!rects.length)return null
 const backwards=selection.focusNode===range.startContainer&&selection.focusOffset===range.startOffset
 const rect=backwards?rects[0]:rects.at(-1)
 // Keep two occurrences of the same word in one article distinguishable.
 const before=range.cloneRange()
 before.selectNodeContents(scope.closest('#previewSheet,[data-note-chapter],.workflow-visual-page')??scope)
 before.setEnd(range.startContainer,range.startOffset)
 return {text,offset:before.toString().length,rects,point:{x:backwards?rect.left:rect.right,y:rect.bottom+5,lineHeight:rect.height+10}}
}
function quotedNote(note,phrase){
 if(!note)return null
 if(phrase.text.length>2000){toast('每条批注可选取最多 2000 字，请缩小选区。');return null}
 note.reference={...note.reference,id:note.anchor+'#quote-'+phrase.offset+'-'+Math.abs(hash(phrase.text)),kind:'quote',excerpt:phrase.text}
 return note
}
function noteExcerpt(note,event,scope){
 if(!note)return null
 const phrase=selectedPhrase(scope.ownerDocument,scope)
 if(phrase?.rects.some(r=>event.clientX>=r.left-1&&event.clientX<=r.right+1&&event.clientY>=r.top-1&&event.clientY<=r.bottom+1))return quotedNote(note,phrase)
 const block=event.target.closest?.('.selectable,.workflow-note,.workflow-evidence,[data-plan-text],p,li,h2')
 if(block){
  const excerpt=block.textContent.trim().slice(0,2000)
  Object.assign(note.reference,{id:note.anchor+'#'+(block.dataset.block||'text-'+Math.abs(hash(excerpt))),kind:'block',excerpt})
 }
 return note
}
function showTextSelectionAction(event,frame){
 if(event.type==='mouseup'&&event.button!==0)return
 if(event.target.closest?.(annotationControls))return
 const doc=frame?.contentDocument??document
 const node=doc.getSelection()?.anchorNode,element=node?.nodeType===1?node:node?.parentElement
 const chapter=element?.closest('[data-note-chapter][open]')
 const scope=chapter??element?.closest(frame?'.workflow-visual-page':'#previewSheet .script-doc-main,#previewSheet .script-aside-card')
 if(!scope||!(scope.contains(event.target)||event.target.contains?.(scope)))return
 const phrase=selectedPhrase(doc,scope)
 if(!phrase)return
 const note=quotedNote(chapter?chapterNote(chapter.dataset.noteChapter):previewAnnotationTarget(),phrase)
 if(!note)return
 const point=phrase.point
 if(frame){
  const rect=frame.getBoundingClientRect()
  point.x+=rect.left+frame.clientLeft;point.y+=rect.top+frame.clientTop
 }
 offerAnnotation(note,point,frame??scope,{focus:false})
}
function offerAnnotation(target,point,origin,options){
 if(!target)return
 clearGraphAction();clearPreviewAction()
 origin=origin?.closest?.('[tabindex],button,iframe,[data-flow-node]')??origin
 server.noteComposer??=mountAnnotationComposer({notify:toast,save:async(note,text)=>{
  if(state.currentProjectId!==note.projectId)throw new Error('项目已切换，请返回原项目。')
  const path=note.noteId?`annotations/${note.noteId}/edit`:'annotations'
  await mutate(path,{text,baseRevision:note.baseRevision,...(note.noteId?{}:{anchor:note.anchor,reference:note.reference})})
 }})
 server.noteComposer.offer(target,point,origin,options)
}
function clearAnnotationContext(){server.noteComposer?.reset();server.libraryDialog?.close()}
function contextNote(event){
 if(event.target.closest?.('.annotation-composer'))return
 const control=event.target.closest?.('button,a,input,textarea,select,[contenteditable=true]')
 if(control&&!control.matches('[data-plan-open]'))return
 const point={x:event.clientX,y:event.clientY},target=event.target
 const card=target.closest?.('[data-flow-node]'),details=target.closest?.('[data-note-chapter]')
 if(card){
  offerAnnotation(chapterNote(card.dataset.flowNode,card.getAttribute('aria-label')),point,card)
 }else if(details){
  const note=noteExcerpt(chapterNote(details.dataset.noteChapter),event,details)
  if(!note)return
  offerAnnotation(note,point,target)
 }else if(target.closest?.('#previewSheet')){
  const note=noteExcerpt(previewAnnotationTarget(),event,$('#previewSheet'))
  if(!note)return
  offerAnnotation(note,point,target)
 }else return
 event.preventDefault();event.stopPropagation()
}
document.addEventListener('contextmenu',contextNote,true)
document.addEventListener('mouseup',event=>showTextSelectionAction(event))
document.addEventListener('touchend',event=>showTextSelectionAction(event))
document.addEventListener('scroll',()=>server.noteComposer?.dismissOffer(),true)
document.addEventListener('keydown',event=>{
 if(event.key!=='ContextMenu'&&!(event.key==='F10'&&event.shiftKey))return
 const element=event.target.closest?.('[data-node-id],[data-flow-node]')
 if(!element)return
 const rect=element.getBoundingClientRect()
 const note=element.dataset.nodeId?graphNote(state.nodeRects.get(element.dataset.nodeId)):chapterNote(element.dataset.flowNode,element.getAttribute('aria-label'))
 event.preventDefault();offerAnnotation(note,{x:rect.left+rect.width/2,y:rect.top+rect.height/2},element)
},true)
function setReference(ref){state.selected=referenceSnapshot(ref);updateComposer();$('#chatInput').focus({preventScroll:true})}
function showGraphAction(x,y){
 const node=state.nodeRects?.get(state.pendingTarget?.id),picker=$('#nodePicker'),button=$('#pickerQuote')
 if(node?.kind==='script'||node?.kind==='article'||node?.kind==='artifact'){
  const origin=document.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`),rect=origin.getBoundingClientRect()
  offerAnnotation(graphNote(node),{x:rect.right,y:rect.top},origin,{focus:false});return
 }
 if(node?.kind!=='section'||!state.scripts[node.section.script.id]?.outlineTask){clearGraphAction();return}
 button.textContent=node.section.sectionBody?'查看节正文':node.section.scripts?.length?'查看本节条目':'生成本轮初稿'
 button.title=button.textContent;button.setAttribute('aria-label',button.textContent);picker.classList.remove('hidden')
 picker.style.left=Math.max(10,Math.min(graphPositions.boardW-140,x))+'px';picker.style.top=Math.max(35,Math.min(graphPositions.boardH-55,y))+'px'
}
function clearPreviewAction(){server.noteComposer?.dismissOffer()}
function updateComposer(){
 const selected=state.selected,rec=selected?recordForReference(selected.id):null,workflow=!!rec?.workflowDraft||!!selected?.workflowDraftId,stale=workflow&&(workflowIsStale(server.current)||selected.workflowDraftId!==server.current?.workflow?.current?.id),chips=$('#referenceChips')
 chips.classList.toggle('hidden',!selected);chips.innerHTML=selected?`<span class="ref-chip" title="${escapeHTML(selected.excerpt||selected.title)}"><span style="font-weight:820">${workflow?'阶段初稿':'内容'}引用</span><span class="ref-chip-label">${escapeHTML(selected.excerpt||selected.title)}</span><button id="removeRef" title="取消引用">${ICON.close}</button></span>`:'';chips.querySelector('#removeRef')?.addEventListener('click',clearReference)
 $('#chatSubmit').classList.toggle('annot',!!selected);$('#submitText').textContent=workflow?(rec?.sectionBody?'提交本节修改':'提交本条修改'):selected?'保存批注':'发送';$('#composerMode').textContent=stale?'旧版引用 · 请重新生成或引用':workflow?(rec?.sectionBody?'本节修订 · 将生成新版初稿':'本条修订 · 将生成新版初稿'):selected?'批注会话 · 先保存，不执行 Agent':'普通会话';$('#chatInput').placeholder=workflow?(rec?.sectionBody?'填写本节修改意见……':'填写本条修改意见……'):selected?'针对当前选中内容输入修改意见…':'向项目 Agent 提问……';$('#chatInput').maxLength=16000
 $('#chatSubmit').disabled=stale||server.loading||!!server.current?.jobs.some(job=>['queued','running','cancelling'].includes(job.status))
}
function openConsultNotes(){
 const drawer=$('#annotationDrawer'),home=drawer.parentElement,dialog=document.createElement('dialog')
 dialog.className='annotation-consult-library';dialog.setAttribute('aria-label','批注库')
 server.libraryDialog=dialog
 dialog.addEventListener('close',()=>{
  server.noteComposer?.reset();drawer.classList.add('hidden');home.append(drawer);dialog.remove();server.libraryDialog=null
 },{once:true})
 document.body.append(dialog);dialog.append(drawer);drawer.classList.remove('hidden');setAnnotationView('pending');dialog.showModal()
}
function isPendingNote(note){return ['pending','failed','interrupted'].includes(note.status)}
function updateAnnotationUI(){const pending=state.annotations.filter(isPendingNote).length;const consultButton=document.querySelector('[data-consult-notes]');if(consultButton)consultButton.textContent=pending?'批注库 · '+pending:'批注库';$('#annotationCount').textContent=pending;$('#annotationSummary').textContent='条批注待统一提交';if($('#historyCount'))$('#historyCount').textContent=state.annotations.length-pending;renderAnnotationList()}
function setAnnotationView(view){annotationDrawerView=view==='history'?'history':'pending';const history=annotationDrawerView==='history';$('#drawerHeading').textContent=history?'历史批注':'批注库';$('#drawerDescription').textContent=history?'已提交批注及实际处理状态':'先集中记录，最后统一交给 Agent 修改';$('#annotationHistoryBtn').textContent=history?'← 返回待提交':'历史批注';$('#pendingDrawerFooter').classList.toggle('hidden',history);$('#historyDrawerFooter').classList.toggle('hidden',!history);renderAnnotationList()}
function renderAnnotationList(){
 const history=annotationDrawerView==='history'
 const rows=state.annotations.filter(note=>history!==isPendingNote(note)).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))
 $('#annotationList').innerHTML=rows.map(note=>{
  const ref=note.reference,workflow=server.current?.workflow
  const draft=ref?.workflowDraftId&&workflow?.history?.find(d=>d.id===ref.workflowDraftId)
  const deck=ref?.visualId&&workflow?.visuals?.history?.find(d=>d.id===ref.visualId)
  const scope=[deck&&`汇报页 V${deck.version}`,draft&&`初稿 V${draft.version}`,ref?.outlineVersion?`章节流程 V${ref.outlineVersion}`:`项目版本 ${note.base_revision}`].filter(Boolean).join(' · ')
  const excerpt=note.excerpt&&['block','quote'].includes(note.targetKind)?`<blockquote>${escapeHTML(note.excerpt)}</blockquote>`:''
  const tools=history?'':`<div><button data-server-edit="${note.id}">编辑</button><button data-server-delete="${note.id}">删除</button></div>`
  return `<div class="annotation-item" data-annotation-id="${escapeHTML(note.id)}"><div class="annotation-item-top"><span class="anno-status ${note.status==='done'?'done':''}">${escapeHTML(note.status==='done'?'已完成':statusText[note.status]||note.status)}</span><strong>${escapeHTML(note.targetTitle)}</strong></div>${excerpt}<p>${escapeHTML(note.text)}</p><div class="anno-tools"><span class="scope">${scope} · ${escapeHTML(note.createdAt)}</span>${tools}</div></div>`
 }).join('')||'<div class="drawer-empty"><b>暂无记录</b></div>'
 $('#batchSubmitBtn').disabled=!state.annotations.some(isPendingNote)||server.current?.jobs.some(j=>['queued','running','cancelling'].includes(j.status))
 $('#batchSubmitBtn').textContent='统一提交给 Agent ↗'
}
function textValue(value){const labels={canonical_name:'项目名称',aliases:'其他名称',location:'项目地点',name:'名称',object_type:'项目类型',origin_mode:'启动方式',trigger_events:'启动事件',start_reason:'启动原因',time_constraints:'时间约束',evidence_refs:'资料依据',status:'状态',issues:'待核验事项',date:'日期',event_type:'事件类型',admin_codes:'行政区划代码',geometry_refs:'空间资料',project_id:'项目编号',event_id:'事件编号',claim_class:'信息性质',locator:'原文位置',evidence_id:'资料引用',asset_id:'原件编号',version_id:'原件版本'};if(value===null||value===undefined)return'待补充';if(Array.isArray(value))return value.length?value.map(textValue).join('\n'):'未提供';if(typeof value==='object')return Object.entries(value).map(([k,v])=>`${labels[k]||k}：${textValue(v)}`).join('\n\n');return String(value)}
function previewRecord(){return state.activeScript?state.scripts[state.activeScript.script.id]:state.activeArt?.record?state.scripts[state.activeArt.record.id]??state.activeArt.record:null}
function updatePreviewControls(){
 const rec=previewRecord();if(!rec)return
 const busy=server.loading||server.current?.jobs.some(job=>['queued','running','cancelling'].includes(job.status)),approve=$('#scriptApproveBtn'),edit=$('#scriptEditBtn')
 edit.textContent=rec.sectionBody?'修订本节':rec.workflowDraft?'修订本条':'生成本轮初稿';edit.disabled=!!busy||workflowReadOnly(rec)
 approve.textContent=rec.workflowDraft?workflowReadOnly(rec)?'旧版初稿只读':rec.sectionBody?(rec.approved?'本节已审阅 ✓':'审阅本节及页脚本'):rec.approved?'本条已审阅 ✓':'审阅本条脚本':rec.outlineTask?'任务尚未生成':rec.proposalId?'确认本节提案':rec.approved?'已确认 ✓':'等待提案'
 approve.disabled=!!busy||(rec.workflowDraft?workflowReadOnly(rec)||rec.approved:!rec.proposalId)
 edit.hidden=!rec.outlineTask
}
function setPreviewAnnotationTarget(note){
 const button=$('#previewQuoteBtn')
 button.textContent='添加批注';button.disabled=!note
 button.onclick=()=>{const rect=button.getBoundingClientRect();offerAnnotation(note,{x:rect.left,y:rect.top},button,{edit:true})}
}
function renderWorkflowPreview(rec,section){
 clearPreviewAction();window.getSelection()?.removeAllRanges()
 $('#previewTitle').textContent=`阶段初稿 · ${section.number} ${rec.title} · V${rec.workflowVersion}`
 $('#scriptReviewActions').classList.remove('hidden')
 setPreviewAnnotationTarget(recordNote(rec,rec.title))
 updatePreviewNav();updatePreviewControls()
 const sheet=$('#previewSheet'),key=rec.workflowDraftId+'/'+rec.id
 const previous=sheet.classList.contains('workflow-sheet')&&sheet.dataset.workflowPreviewKey===key
 const activePane=previous?sheet.querySelector('.workflow-panes')?.dataset.activePane:undefined
 const scroll=previous?[...sheet.querySelectorAll('[data-workflow-pane]')].map(pane=>pane.scrollTop):[]
 const disclosures=previous?[...sheet.querySelectorAll('[data-workflow-pane=notes] details')].map(details=>details.open):[]
 sheet.dataset.workflowPreviewKey=key;sheet.className='preview-sheet script-sheet workflow-sheet';sheet.style.width='';sheet.innerHTML=workflowPreviewMarkup(rec,section)
 const panes=sheet.querySelector('.workflow-panes'),tabs=[...sheet.querySelectorAll('[data-workflow-tab]')]
 function selectPane(name){panes.dataset.activePane=name;tabs.forEach(tab=>tab.setAttribute('aria-pressed',String(tab.dataset.workflowTab===name)))}
 tabs.forEach(tab=>tab.onclick=()=>{clearPreviewAction();selectPane(tab.dataset.workflowTab)})
 if(activePane)selectPane(activePane)
 sheet.querySelectorAll('[data-workflow-pane=notes] details').forEach((details,index)=>{details.open=disclosures[index]??false})
 for(const button of sheet.querySelectorAll('[data-open-page-script]'))button.onclick=()=>{
  const entry=workflowSections().find(e=>e.record.workflowDraftId===rec.workflowDraftId&&e.record.itemId===button.dataset.openPageScript)
  if(entry)openScriptPreview(entry)
 }
 sheet.querySelectorAll('[data-workflow-pane]').forEach((pane,index)=>{pane.scrollTop=scroll[index]??0})
 if(rec.item)sheet.querySelectorAll('[data-workflow-body] p,[data-workflow-body] li').forEach((element,index)=>{
  element.classList.add('selectable');element.dataset.block='text-'+(index+1)
 })
 for(const button of sheet.querySelectorAll('[data-workflow-generate]'))button.disabled=server.loading||!!server.current?.jobs.some(job=>['queued','running','cancelling'].includes(job.status))
}
function renderScriptPage(){
 const sec=state.activeScript;if(!sec)return;const rec=state.scripts[sec.script.id];if(!rec)return
 if(rec.workflowDraft){renderWorkflowPreview(rec,sec);return}
 clearPreviewAction();$('#previewTitle').textContent=`${rec.outlineTask?'研究任务':'文字脚本'} · ${sec.name} · R${rec.revision}`;$('#scriptReviewActions').classList.remove('hidden');updatePreviewControls();setPreviewAnnotationTarget(recordNote(rec,sec.name));updatePreviewNav();const sheet=$('#previewSheet');sheet.className='preview-sheet script-sheet';sheet.style.width='';sheet.innerHTML=`<div class="script-doc-top"><div class="micro">PRE—DESIGN · ${rec.outlineTask?'研究任务':'CONTENT SCRIPT'}</div><div class="script-doc-state">${scriptStatusLabel(rec)}</div></div><div class="script-doc-scroll"><div class="script-doc-main"><div class="script-meta">第 ${sec.number} 节 · R${rec.revision}</div><h2>${escapeHTML(sec.name)}</h2><div class="script-main-thesis">${escapeHTML(rec.thesis)}</div><div class="script-divider"><span>${rec.outlineTask?'本节任务':'具体策划文字'}</span></div><div class="script-paragraphs">${rec.body.split(/\n\s*\n/).map((paragraph,index)=>`<p class="selectable" data-block="paragraph-${index+1}">${escapeHTML(paragraph).replaceAll('\n','<br>')}</p>`).join('')}</div>${rec.outlineTask?'<button type="button" class="primary-btn" data-workflow-generate>执行本轮任务 · 生成初稿</button>':''}</div><aside class="script-doc-aside"><div class="script-aside-card"><span>研究依据 / 缺失项</span><p>${escapeHTML(rec.evidence)}</p></div><div class="script-aside-card"><span>成果状态</span><p>${escapeHTML(rec.visualBrief)}</p></div></aside></div>`
 for(const button of sheet.querySelectorAll('[data-workflow-generate]'))button.disabled=server.loading||!!server.current?.jobs.some(job=>['queued','running','cancelling'].includes(job.status))
}
function renderMini(art){return `<div class="art-mini"><div class="mini-left"><div class="mini-head${art.record?.workflowDraft?' workflow-mini-state':''}">${art.record?.workflowDraft?workflowStatusLabel(art.record):''}</div><div class="mini-title">${escapeHTML(art.title)}</div><div class="mini-line"></div><div class="mini-line short"></div><div class="mini-line"></div></div></div>`}
function renderPreviewPage(){
 const entry=currentVisualEntry();if(!entry)return
 const {art}=entry,{page,record}=art
 previewData=art;state.activeArt=art;clearPreviewAction()
 $('#scriptReviewActions').classList.add('hidden')
 $('#previewTitle').textContent=`HTML 汇报页 · ${page.number} ${page.displayTitle??(page.itemCount===1?page.sectionTitle:page.item.title)} · V${art.version}`
 setPreviewAnnotationTarget(recordNote(record,art.title,page))
 updatePreviewNav()
 const sheet=$('#previewSheet')
 sheet.className='preview-sheet script-sheet workflow-sheet';sheet.style.width=''
 sheet.innerHTML='<div class="workflow-visual-actions"><span>统一主题 · HTML 汇报页</span><button type="button" data-workflow-page-layout>调整页面版式</button></div><iframe class="workflow-visual-preview" title="HTML 汇报页" sandbox="allow-same-origin"></iframe>'
 sheet.querySelector('[data-workflow-page-layout]').onclick=()=>openWorkflowLayout(page.id)
 const frame=sheet.querySelector('iframe')
 // The parent handles the gesture. Scripts remain disabled in the generated document.
 frame.onload=()=>{
  const doc=frame.contentDocument
  if(!doc)return
  doc.addEventListener('pointerdown',()=>server.noteComposer?.dismissOffer(),true)
  doc.addEventListener('scroll',()=>server.noteComposer?.dismissOffer(),true)
  doc.addEventListener('mouseup',event=>showTextSelectionAction(event,frame))
  doc.addEventListener('touchend',event=>showTextSelectionAction(event,frame))
  doc.addEventListener('contextmenu',event=>{
   const rect=frame.getBoundingClientRect(),note=noteExcerpt(previewAnnotationTarget(),event,doc.body)
   if(!note)return
   event.preventDefault();offerAnnotation(note,{x:rect.left+frame.clientLeft+event.clientX,y:rect.top+frame.clientTop+event.clientY},frame)
  })
 }
 frame.srcdoc=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${VISUAL_CSS}</style><main>${visualPageMarkup(page)}</main></html>`
}
function fitPreviewSheet(){const holder=$('#previewSheetHolder'),sheet=$('#previewSheet');if(!holder||!sheet||$('#previewOverlay').classList.contains('hidden'))return;if(sheet.classList.contains('script-sheet')){sheet.style.width='';return}if(!previewData)return;const rect=holder.getBoundingClientRect(),ratio=previewData.type==='PDF'?210/297:16/9;if(rect.width>30&&rect.height>30)sheet.style.width=Math.max(80,Math.min(rect.width-2,(rect.height-3)*ratio))+'px'}
// Capture only simulated mutations. Existing navigation, graph, themes, preview and selection stay intact.
document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;const id=button.id;
 if(button.hasAttribute('data-workflow-generate')){event.preventDefault();event.stopImmediatePropagation();void safely(generateWorkflowDraft);return}
 if(button.hasAttribute('data-workflow-downloads')){event.preventDefault();event.stopImmediatePropagation();void globalThis.prePlatform?.openTasks();return}
 if(id==='closeAnnotationDrawer'&&server.libraryDialog?.open){event.stopImmediatePropagation();server.libraryDialog.close();return}
 if(id==='pickerQuote'){
  event.preventDefault();event.stopImmediatePropagation()
  const section=state.nodeRects.get(state.pendingTarget?.id)?.section
  clearGraphAction()
  if(section?.sectionBody)openScriptPreview(section)
  else if(section?.scripts?.length)openScriptPreview(section.scripts[0])
  else if(section)void safely(generateWorkflowDraft)
  return
 }
 if(button.dataset.discussionToOutline&&button.closest('#chatHistory')){event.preventDefault();event.stopImmediatePropagation();void compileDiscussion(button.dataset.discussionToOutline);return}
 if(button.dataset.openCore){event.preventDefault();event.stopImmediatePropagation();const section=coreSections().find(s=>s.script.id===button.dataset.openCore);if(section)openScriptPreview(section);return}
 if(id==='confirmOutline'){event.preventDefault();event.stopImmediatePropagation();void safely(async()=>{const outline=server.current.outline;if(!outline?.draft||outline.status==='stale'){await generateOutline('',undefined,{planningMode:'recommend'});return}if(flowEditorState(server.current.id,outline).dirty||!outline.flowReviewed)throw new Error('编排尚未提交核对，请先提交流程');if(outline.status!=='confirmed')await mutate('outline/confirm',{version:outline.version,inputHash:outline.inputHash});clearAnnotationContext();enterWorkspace({resume:true,snapshot:{}})});return}
 if(button.dataset.serverEdit){
  event.stopImmediatePropagation();const note=state.annotations.find(a=>a.id===button.dataset.serverEdit);if(!note)return
  const rect=button.getBoundingClientRect()
  offerAnnotation({noteId:note.id,projectId:state.currentProjectId,baseRevision:server.current.revision,reference:{...note.reference,title:note.targetTitle},text:note.text},{x:rect.left,y:rect.top},button,{edit:true});return
 }
 if(button.dataset.serverDelete){event.stopImmediatePropagation();void safely(()=>mutate(`annotations/${button.dataset.serverDelete}/delete`));return}
 if(['pipelineBtn','scriptEditBtn','scriptApproveBtn','batchSubmitBtn','skipProcessing'].includes(id)){event.preventDefault();event.stopImmediatePropagation();
 if(id==='skipProcessing'){if(state.currentProjectId)void openExistingProject(state.currentProjectId);return}
 if(id==='pipelineBtn'){if(server.current?.workflow?.current){openWorkflowDraft();return}if(server.current?.outline?.draft){void safely(generateWorkflowDraft);return}const sec=allScriptEntries().find(s=>state.scripts[s.script.id].proposalId);if(sec)openScriptPreview(sec);return}
 if(id==='scriptEditBtn'){
  const rec=previewRecord()
  if(rec?.workflowDraft&&!workflowReadOnly(rec)){
   setReference({id:rec.id,kind:'script',title:rec.title,excerpt:workflowExcerpt(rec)});closePreview();toast(rec.sectionBody?'填写本节修改意见，提交后生成新版初稿。':'填写本条修改意见，提交后生成新版初稿。')
  }else if(rec?.outlineTask&&!rec.workflowDraft)void safely(generateWorkflowDraft)
  return
 }
 if(id==='scriptApproveBtn'){const rec=previewRecord();if(rec?.workflowDraft)void safely(()=>mutate('workflow/review',workflowReviewMutation(server.current,rec)));else if(rec?.proposalId)void safely(()=>mutate('confirm',{proposalId:rec.proposalId}));return}
 if(id==='batchSubmitBtn')void safely(()=>mutate('annotations/batch-submit',{annotationIds:state.annotations.filter(isPendingNote).map(a=>a.id)}));
 }
},true);
document.addEventListener('change',event=>{
 if(!['chatFileInput','outlineFileInput'].includes(event.target.id))return
 event.stopImmediatePropagation()
 const batch=partitionMaterialUploads(event.target.files),files=batch.accepted.map(selectedFile),id=state.currentProjectId
 event.target.value=''
 rememberRejectedMaterials(batch.rejected)
 if(batch.message)toast(batch.message)
 if(!files.length){if(state.stage==='consult')renderConsult();return}
 void safely(async()=>{
  await uploadFiles(id,files,()=>state.currentProjectId===id)
  if(state.currentProjectId!==id)return
  await refreshCurrent()
  startConsult()
  toast('资料已补充，请提交流程重新核对。')
 })
},true);
