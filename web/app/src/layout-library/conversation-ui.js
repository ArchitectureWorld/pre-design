const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const requestId=()=>crypto.randomUUID?.()??Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('')
const roles={title:'标题',claim:'主结论',body:'正文',image:'图片',table:'表格',source:'引用'}
const active=status=>['queued','running','cancelling'].includes(status)
const fileKey=file=>file.id?'upload:'+file.id:'text:'+file.name
const fileDetail=file=>file.kind==='pdf'?'PDF · '+((file.readPages?.length??0)<file.pageCount?'前'+(file.readPages?.length??0)+'/'+file.pageCount+'页':file.pageCount+'页'):file.kind==='image'?'图片'+(file.limitations?.some(note=>note.includes('缩放'))?' · 已缩放':''):file.kind==='docx'?'Word · 已提取文字':file.kind==='text'?'文本':file.summary??''

export function mountLayoutConversation({container,request,notify,getContext,onResource,onDraft=()=>{},onImport,onState=()=>{},onChange=()=>{}}){
 container.innerHTML=`<header class="ll-chat-head"><div><strong>版式助手</strong></div></header>
 <progress class="ll-model-progress" data-model-progress aria-label="Agent 正在分析参考" hidden></progress><div class="ll-chat-messages" data-chat-messages role="log" aria-live="polite"></div>
 <div class="ll-chat-composer"><div class="ll-composer-box"><div data-chat-selection></div><div class="ll-chat-files" data-chat-files aria-label="待发送参考文件"></div><textarea data-layout-message rows="3" maxlength="16000" placeholder="描述你的版式要求…" aria-label="版式会话"></textarea><div class="ll-chat-actions"><button type="button" data-chat-upload aria-label="上传参考文件" title="上传参考文件"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7L9.5 17a2 2 0 0 1-2.8-2.8L15 6"/></svg><span>参考文件</span></button><div class="ll-composer-send"><button type="button" data-chat-stop aria-label="停止生成" title="停止生成" hidden><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor"/></svg></button><button type="button" data-layout-send class="ll-primary" aria-label="发送版式消息" title="发送"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V4m-7 7 7-7 7 7"/></svg></button></div></div><input data-chat-file type="file" accept=".pdf,.docx,.jpg,.jpeg,.png,.webp,.txt,.md,.markdown,.json,.pptx" multiple hidden><div class="ll-drop-hint" aria-hidden="true">松开添加文件</div></div><div class="ll-chat-status" data-chat-status role="status"></div></div>`
 const find=selector=>container.querySelector(selector),input=find('[data-layout-message]'),filesInput=find('[data-chat-file]'),composer=find('.ll-chat-composer')
 let currentId=null,conversation=null,config=null,generation=0,pollTimer,selection=null,pendingFiles=[],submitting=false,disposed=false,transfers=[],uploadChain=Promise.resolve()
 const valid=token=>!disposed&&token===generation
 const running=()=>conversation?.turns.findLast(turn=>active(turn.status))
 const uploading=()=>transfers.some(t=>['queued','reading','uploading','parsing'].includes(t.state))
 const uploadErrors=()=>transfers.some(t=>t.state==='failed')
 const visualReferences=()=>[...pendingFiles,...conversation?.referenceFiles??[]].some(f=>f.hasImages)
 const modelConfig=()=>visualReferences()?(config?.vision??config):config
 const uploadState={queued:'等待上传',reading:'正在读取',uploading:'上传中',parsing:'解析中',ready:'待发送',submitted:'已发送',failed:'上传失败'}
 const elapsed=job=>{const value=Date.parse(job.startedAt??job.createdAt??'');return Number.isFinite(value)?' · '+Math.max(0,Math.floor((Date.now()-value)/1000))+' 秒':''}
 function cancelUploads(){for(const t of transfers)t.controller?.abort();transfers=[]}
 function resizeInput(){input.style.height='auto';input.style.height=Math.min(160,Math.max(72,input.scrollHeight))+'px'}

 function controls(){
  const job=running(),busy=!!job,uploadBusy=uploading(),ready=modelConfig()
  find('[data-layout-send]').disabled=submitting||busy||uploadBusy||uploadErrors()||!ready?.configured||!input.value.trim()&&!pendingFiles.length
  find('[data-layout-send]').hidden=busy
  find('[data-chat-stop]').hidden=!busy;find('[data-chat-stop]').disabled=job?.status==='cancelling'
  find('[data-model-progress]').hidden=!busy
  const empty=find('.ll-chat-empty');if(empty)empty.hidden=uploadBusy||submitting||busy
  find('[data-chat-status]').textContent=submitting?'正在提交…':busy?(job.progress?.label??'正在分析参考…')+elapsed(job):uploadBusy?'正在接收参考文件…':ready?.configured===false?(visualReferences()?'图片理解暂不可用':'暂时无法连接，请稍后重试'):''
  onState({busy:busy||submitting||uploadBusy,conversation,phase:uploadBusy?'uploading':busy?'analyzing':null})
 }
 function transferLabel(t){
  if(t.state==='failed')return t.error
  if(t.state==='ready')return (t.result?fileDetail(t.result)+' · ':'')+'待发送'
  const percentage=t.total>0?Math.min(100,Math.round(t.loaded/t.total*100)):null
  return (uploadState[t.state]??'')+(t.state==='parsing'&&t.phaseStartedAt?' · '+Math.max(0,Math.floor((Date.now()-t.phaseStartedAt)/1000))+' 秒':'')+(t.state==='uploading'&&percentage!==null?' '+percentage+'%':'')
 }
 function paintTransfer(t){
  const row=find('[data-upload-row="'+t.localId+'"]');if(!row)return
  row.dataset.state=t.state;row.querySelector('[data-upload-state]').textContent=transferLabel(t)
  const bar=row.querySelector('progress'),value=['ready','submitted'].includes(t.state)?100:['reading','uploading'].includes(t.state)&&t.total>0?Math.min(100,t.loaded/t.total*100):null
  if(value===null)bar.removeAttribute('value');else bar.value=value
  bar.setAttribute('aria-valuetext',transferLabel(t))
 }
 function renderFiles(){
  const known=new Map((conversation?.referenceFiles??[]).map(f=>[fileKey(f),f]))
  for(const turn of conversation?.turns??[])for(const file of turn.files??[])if(!known.has(fileKey(file)))known.set(fileKey(file),file)
  const knownIds=new Set([...known.values()].map(f=>f.id).filter(Boolean))
  const waiting=transfers.filter(t=>!['removed','imported','submitted'].includes(t.state)&&!knownIds.has(t.result?.id))
  find('[data-chat-files]').innerHTML=waiting.map(t=>`<div class="ll-upload-file" data-upload-row="${t.localId}" data-state="${t.state}"><div><strong title="${esc(t.file.name)}">${esc(t.file.name)}</strong>${t.state==='failed'?`<button data-retry-upload="${t.localId}" aria-label="重试上传 ${esc(t.file.name)}">重试</button>`:''}<button data-remove-upload="${t.localId}" aria-label="${['ready','failed','submitted'].includes(t.state)?'移除参考':'取消上传'} ${esc(t.file.name)}" ${t.state==='ready'?'data-remove-file="'+pendingFiles.findIndex(f=>f.transferId===t.localId)+'"':''}>×</button></div><progress max="100" aria-label="${esc(t.file.name)} 上传进度"></progress><small data-upload-state></small></div>`).join('')+
   pendingFiles.filter(f=>!f.transferId).map((f,i)=>`<span class="ll-file-chip pending">${esc(f.name)}<button data-remove-legacy="${i}" aria-label="移除待发送参考 ${esc(f.name)}">×</button></span>`).join('')
  for(const t of waiting)paintTransfer(t)
  find('[data-chat-files]').querySelectorAll('[data-remove-upload]').forEach(button=>button.onclick=()=>{const t=transfers.find(t=>t.localId===button.dataset.removeUpload);t.controller?.abort();t.state='removed';pendingFiles=pendingFiles.filter(f=>f.transferId!==t.localId);renderFiles();controls()})
  find('[data-chat-files]').querySelectorAll('[data-retry-upload]').forEach(button=>button.onclick=()=>{const t=transfers.find(t=>t.localId===button.dataset.retryUpload);t.state='queued';t.error=null;queueTransfers([t],generation);renderFiles();controls()})
  find('[data-chat-files]').querySelectorAll('[data-remove-legacy]').forEach(button=>button.onclick=()=>{const f=pendingFiles.filter(f=>!f.transferId)[Number(button.dataset.removeLegacy)];pendingFiles=pendingFiles.filter(value=>value!==f);renderFiles();controls()})
 }
 function fileChips(files){return files.map(f=>`<span class="ll-file-chip" title="${esc([f.name,f.summary,...f.limitations??[]].filter(Boolean).join(' · '))}"><span>${esc(f.name)}${fileDetail(f)?`<small>${esc(fileDetail(f))}</small>`:''}</span>${f.id?`<button data-download-reference="${esc(f.id)}" aria-label="下载参考文件 ${esc(f.name)}" title="下载原件">↓</button>`:''}</span>`).join('')}
 function bindDownloads(area){area.querySelectorAll('[data-download-reference]').forEach(button=>button.onclick=async()=>{try{const file=await request('/layout-library/reference-files/'+button.dataset.downloadReference+'/download',{download:true}),url=URL.createObjectURL(file.blob),a=container.ownerDocument.createElement('a');a.href=url;a.download=file.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(error){notify(error.message)}})}
 function renderMessages(){
  const area=find('[data-chat-messages]'),nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<90,previous=area.scrollTop
  const attached=new Set((conversation?.turns??[]).flatMap(turn=>turn.files??[]).map(fileKey)),legacy=(conversation?.referenceFiles??[]).filter(f=>!attached.has(fileKey(f)))
  const messages=(conversation?.turns??[]).map(turn=>{
   const reply=turn.result?.reply??(turn.result?.id?'已生成版式 V'+turn.result.version+'。':null)
   const status=active(turn.status)?turn.progress?.label??'正在生成…':turn.error??'任务已结束。'
   return `<div class="ll-chat-turn" data-layout-turn="${turn.id}"><div class="ll-message user">${turn.files?.length?`<div class="ll-sent-files">${fileChips(turn.files)}</div>`:''}<div>${esc(turn.text).replaceAll('\n','<br>')}</div></div><div class="ll-message assistant">${reply?esc(reply).replaceAll('\n','<br>'):`<span class="${active(turn.status)?'working':'error'}">${esc(status)}</span>`}${turn.result?.id?`<button class="ll-inline" data-show-version="${turn.result.id}" data-version="${turn.result.version}">查看 V${turn.result.version}</button>`:''}${['failed','interrupted','cancelled'].includes(turn.status)?`<button class="ll-inline" data-retry-turn="${turn.id}" ${running()?'disabled':''}>重试</button>`:''}</div></div>`
  }).join('')
  area.innerHTML=(legacy.length?`<div class="ll-sent-files ll-reference-history" aria-label="历史参考文件">${fileChips(legacy)}</div>`:'')+messages||'<div class="ll-chat-empty">描述想要的版式，或添加参考文件。</div>'
  bindDownloads(area)
  area.querySelectorAll('[data-show-version]').forEach(button=>button.onclick=async()=>{try{await onResource(await request('/layout-library/'+button.dataset.showVersion+'/'+button.dataset.version),{historical:true})}catch(e){notify(e.message)}})
  area.querySelectorAll('[data-retry-turn]').forEach(button=>button.onclick=async()=>{
   if(submitting||running())return
   const token=generation;submitting=true;controls()
   try{const result=await request('/layout-library/reference-jobs/'+button.dataset.retryTurn+'/retry',{method:'POST',body:{requestId:requestId()}});if(!valid(token))return;currentId=result.conversationId??result.id;await load(token);onChange(currentId)}catch(e){notify(e.message)}finally{if(valid(token)){submitting=false;controls()}}
  })
  area.scrollTop=nearBottom?area.scrollHeight:previous
 }
 async function load(token=generation){
  clearTimeout(pollTimer)
  if(!currentId||!valid(token))return
  const value=await request('/layout-library/conversations/'+currentId)
  if(!valid(token))return
  if(value.resource)await onResource(value.resource)
  else if(value.draftPackage)await onDraft(value.draftPackage)
  if(!valid(token))return
  conversation=value;renderFiles();renderMessages();controls()
  if(running())pollTimer=setTimeout(()=>{void load(token).catch(e=>{if(valid(token)){find('[data-chat-status]').textContent=e.message;pollTimer=setTimeout(()=>void load(token).catch(()=>{}),2500)}})},2000)
 }
 async function select(id){
  const token=++generation;clearTimeout(pollTimer);cancelUploads();uploadChain=Promise.resolve();currentId=id??null;conversation=null;submitting=false;selection=null;pendingFiles=[];input.value=''
  find('[data-chat-selection]').replaceChildren();composer.classList.remove('is-file-drag');resizeInput();renderFiles();renderMessages();controls()
  if(currentId)await load(token)
  if(valid(token))onChange(currentId)
 }
 async function send(){
  if(disposed||submitting||running()||uploading()||uploadErrors())return
  if(!modelConfig()?.configured){notify(visualReferences()?'请先配置可用的图片理解模型。':modelConfig()?.reason??'模型设置正在读取。');return}
  const text=input.value.trim();if(!text&&!pendingFiles.length)return
  let context
  try{context=getContext()??{}}catch(error){notify(error.message);find('[data-chat-status]').textContent=error.message;return}
  const token=generation,submittedText=input.value,submittedFiles=[...pendingFiles],submittedSelection=selection,files=submittedFiles.map(f=>f.id?{id:f.id}:{name:f.name,text:f.text})
  const body={requestId:requestId(),...(currentId?{conversationId:currentId}:{}),...(context.resourceId?{resourceId:context.resourceId,resourceVersion:context.resourceVersion}:{}),...(context.package?{package:structuredClone(context.package)}:{}),
   ...(context.name?{name:context.name}:{}),text:text||(context.resourceId?'按上传参考调整当前版式。':'根据上传参考生成版式。'),files,selection,allowModel:true}
  submitting=true;controls()
  try{
   const result=await request('/layout-library/conversations',{method:'POST',body})
   if(!valid(token))return
   currentId=result.conversationId
   if(input.value===submittedText){input.value='';resizeInput()}
   pendingFiles=pendingFiles.filter(file=>!submittedFiles.includes(file))
   for(const file of submittedFiles){const transfer=transfers.find(t=>t.localId===file.transferId);if(transfer)transfer.state='submitted'}
   if(selection===submittedSelection){selection=null;find('[data-chat-selection]').replaceChildren()}
   await load(token);find('[data-chat-messages]').scrollTop=find('[data-chat-messages]').scrollHeight;onChange(currentId)
  }catch(error){if(valid(token)){notify(error.message);find('[data-chat-status]').textContent=error.message}}
  finally{if(valid(token)){submitting=false;controls()}}
 }
 function queueTransfers(batch,token){
  uploadChain=uploadChain.catch(()=>{}).then(async()=>{
   for(const transfer of batch){
    if(!valid(token))return
    if(transfer.state==='removed')continue
    transfer.controller=new AbortController();transfer.state='reading';transfer.loaded=0;transfer.total=0;renderFiles();controls()
    const onProgress=progress=>{if(!valid(token)||transfer.state==='removed')return;if(transfer.state!==progress.phase)transfer.phaseStartedAt=Date.now();transfer.state=progress.phase;transfer.loaded=progress.loaded??0;transfer.total=progress.total??0;paintTransfer(transfer);controls()}
    try{
     const native=/\.(json|pptx)$/i.test(transfer.file.name)
     if(native){
      if(submitting||running())throw Error('请先完成或停止当前回复，再导入新的版式。')
      const imported=await onImport(transfer.file,{signal:transfer.controller.signal,onUploadProgress:onProgress})
      if(!valid(token))return
      if(transfer.state==='removed')continue
      currentId=imported.conversationId??null;conversation=null;transfer.state='imported'
      renderFiles();controls()
      if(currentId)await load(token)
      onChange(currentId)
     }else{
      if(!/\.(pdf|docx|jpe?g|png|webp|txt|md|markdown)$/i.test(transfer.file.name))throw Error('请选择 PDF、DOCX、图片或文本参考。')
      onProgress({phase:'uploading',loaded:0,total:0})
      const file=await request('/layout-library/reference-files',{method:'POST',file:transfer.file,requestId:transfer.requestId,signal:transfer.controller.signal,onUploadProgress:onProgress})
      if(!valid(token))return
      if(transfer.state==='removed')continue
      if(!file.id)throw Error('未收到文件上传收执，请重试。')
      transfer.result=file;transfer.state='ready';pendingFiles.push({...file,transferId:transfer.localId})
     }
    }catch(error){
     if(!valid(token)||transfer.state==='removed')continue
     if(error.name==='AbortError'){transfer.state='removed'}else{transfer.state='failed';transfer.error=error.message;notify(error.message)}
    }
    if(valid(token)){renderFiles();controls()}
   }
  })
  return uploadChain
 }
 async function upload(files){
  if(!files.length)return
  if(pendingFiles.length+transfers.filter(t=>['queued','reading','uploading','parsing'].includes(t.state)).length+files.length>8){notify('每轮最多添加8份参考文件。');return}
  const batch=files.map(file=>({localId:requestId(),requestId:requestId(),file,state:'queued',loaded:0,total:0}));transfers.push(...batch)
  renderFiles();controls();return queueTransfers(batch,generation)
 }
 find('[data-chat-upload]').onclick=()=>filesInput.click()
 filesInput.onchange=async()=>{const files=[...filesInput.files];filesInput.value='';input.focus();await upload(files)}
 const dragOver=event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';composer.classList.add('is-file-drag')}}
 const dragLeave=event=>{if(!container.contains(event.relatedTarget))composer.classList.remove('is-file-drag')}
 const drop=event=>{if(!event.dataTransfer?.files.length)return;event.preventDefault();event.stopPropagation();composer.classList.remove('is-file-drag');input.focus();void upload([...event.dataTransfer.files])}
 const paste=event=>{const files=[...event.clipboardData?.files??[]].filter(f=>/^image\/(png|jpeg|webp)$/i.test(f.type));if(!files.length)return;event.preventDefault();void upload(files)}
 container.addEventListener('dragover',dragOver);container.addEventListener('dragleave',dragLeave);container.addEventListener('drop',drop);input.addEventListener('paste',paste)
 input.oninput=()=>{resizeInput();controls()}
 input.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();void send()}}
 find('[data-layout-send]').onclick=()=>void send()
 find('[data-chat-stop]').onclick=async()=>{const job=running();if(!job)return;try{await request('/layout-library/reference-jobs/'+job.id+'/cancel',{method:'POST',body:{}});await load()}catch(error){notify(error.message)}}
 void request('/layout-library/reference-config').then(value=>{if(disposed)return;config=value;controls()}).catch(()=>{if(!disposed){config={configured:false};controls()}})
 const statusTimer=setInterval(()=>{if(running()||uploading()){for(const t of transfers)if(t.state==='parsing')paintTransfer(t);controls()}},1000)
 renderFiles();renderMessages();controls()
 return {select,refresh:load,get id(){return currentId},get busy(){return !!running()||submitting||uploading()},
  focusSelection(value){selection=value;find('[data-chat-selection]').innerHTML=`<span class="ll-selection">${esc(roles[value.slot]??value.slot)}<button aria-label="取消引用">×</button></span>`;find('[data-chat-selection] button').onclick=()=>{selection=null;find('[data-chat-selection]').replaceChildren()};input.focus()},
  dispose(){disposed=true;generation++;clearTimeout(pollTimer);clearInterval(statusTimer);cancelUploads();container.removeEventListener('dragover',dragOver);container.removeEventListener('dragleave',dragLeave);container.removeEventListener('drop',drop);input.removeEventListener('paste',paste)},
 }
}
