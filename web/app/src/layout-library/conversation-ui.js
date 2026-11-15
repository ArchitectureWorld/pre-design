const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const requestId=()=>crypto.randomUUID?.()??Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('')
const roles={title:'标题',claim:'主结论',body:'正文',image:'图片',table:'表格',source:'引用'}
const active=status=>['queued','running','cancelling'].includes(status)

async function readText(file){
 if(file.size>128*1024)throw Error('参考文件较大，请保留需要的版式要求后上传。')
 const bytes=new Uint8Array(await file.arrayBuffer())
 let text
 if(bytes[0]===255&&bytes[1]===254)text=new TextDecoder('utf-16le').decode(bytes)
 else if(bytes[0]===254&&bytes[1]===255)text=new TextDecoder('utf-16be').decode(bytes)
 else{try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{text=new TextDecoder('gb18030',{fatal:true}).decode(bytes)}}
 if(text.length>16000)throw Error('单份参考文字最多16000字，请精简后上传。')
 return {name:file.name,text}
}

export function mountLayoutConversation({container,request,notify,getContext,onResource,onDraft=()=>{},onImport,onState=()=>{},onChange=()=>{}}){
 container.innerHTML=`<header class="ll-chat-head"><div><strong>版式助手</strong></div><button type="button" data-chat-upload aria-label="上传参考文件" title="上传参考文件"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M5 14v6h14v-6"/></svg><span>参考文件</span></button><input data-chat-file type="file" accept=".txt,.md,.markdown,.json,.pptx" multiple hidden></header>
 <div class="ll-chat-files" data-chat-files></div><div class="ll-chat-messages" data-chat-messages role="log" aria-live="polite"></div>
 <div class="ll-chat-composer"><div data-chat-selection></div><textarea data-layout-message rows="3" maxlength="16000" placeholder="输入修改意见，或选中左侧内容继续讨论…" aria-label="版式会话"></textarea><div class="ll-chat-actions"><span data-chat-status role="status"></span><button data-chat-stop hidden>停止</button><button data-layout-send class="ll-primary" aria-label="发送版式消息">发送 ↑</button></div></div>`
 const find=selector=>container.querySelector(selector),input=find('[data-layout-message]'),filesInput=find('[data-chat-file]')
 let currentId=null,conversation=null,config=null,generation=0,pollTimer,selection=null,pendingFiles=[],submitting=false,disposed=false
 const valid=token=>!disposed&&token===generation
 const running=()=>conversation?.turns.findLast(turn=>active(turn.status))
 function controls(){
  const job=running(),busy=!!job
  find('[data-layout-send]').disabled=submitting||busy||!config?.configured||!input.value.trim()&&!pendingFiles.length
  find('[data-chat-stop]').hidden=!busy;find('[data-chat-stop]').disabled=job?.status==='cancelling'
  find('[data-chat-status]').textContent=submitting?'正在提交…':job?.progress?.label??(busy?'正在生成…':config?.configured===false?'暂时无法连接，请稍后重试':'')
  onState({busy:busy||submitting,conversation})
 }
 function renderFiles(){
  const known=new Map((conversation?.referenceFiles??[]).map(f=>[f.name,f]))
  for(const turn of conversation?.turns??[])for(const file of turn.files??[])known.set(file.name,file)
  find('[data-chat-files]').innerHTML=[...known.values()].map(f=>`<span class="ll-file-chip" title="${esc(f.name)}">${esc(f.name)}</span>`).join('')+pendingFiles.map((f,i)=>`<span class="ll-file-chip pending">${esc(f.name)}<button data-remove-file="${i}" aria-label="移除待发送参考 ${esc(f.name)}">×</button></span>`).join('')
  find('[data-chat-files]').querySelectorAll('[data-remove-file]').forEach(b=>b.onclick=()=>{pendingFiles.splice(Number(b.dataset.removeFile),1);renderFiles();controls()})
 }
 function renderMessages(){
  const area=find('[data-chat-messages]'),nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<90,previous=area.scrollTop
  area.innerHTML=(conversation?.turns??[]).map(turn=>{
   const reply=turn.result?.reply??(turn.result?.id?'已生成版式 V'+turn.result.version+'。':null)
   const status=active(turn.status)?turn.progress?.label??'正在生成…':turn.error??'任务已结束。'
   return `<div class="ll-chat-turn" data-layout-turn="${turn.id}"><div class="ll-message user">${esc(turn.text).replaceAll('\n','<br>')}</div><div class="ll-message assistant">${reply?esc(reply).replaceAll('\n','<br>'):`<span class="${active(turn.status)?'working':'error'}">${esc(status)}</span>`}${turn.result?.id?`<button class="ll-inline" data-show-version="${turn.result.id}" data-version="${turn.result.version}">查看 V${turn.result.version}</button>`:''}${['failed','interrupted','cancelled'].includes(turn.status)?`<button class="ll-inline" data-retry-turn="${turn.id}" ${running()?'disabled':''}>重试</button>`:''}</div></div>`
  }).join('')||'<div class="ll-chat-empty">上传参考文件，或直接描述想要的版式。</div>'
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
  const token=++generation;clearTimeout(pollTimer);currentId=id??null;conversation=null;submitting=false;selection=null;pendingFiles=[];input.value=''
  find('[data-chat-selection]').replaceChildren();renderFiles();renderMessages();controls()
  if(currentId)await load(token)
  if(valid(token))onChange(currentId)
 }
 async function send(){
  if(disposed||submitting||running())return
  if(!config?.configured){notify(config?.reason??'模型设置正在读取。');return}
  const text=input.value.trim();if(!text&&!pendingFiles.length)return
  let context
  try{context=getContext()??{}}catch(error){notify(error.message);find('[data-chat-status]').textContent=error.message;return}
  const token=generation,submittedText=input.value,submittedFiles=[...pendingFiles],submittedSelection=selection,files=submittedFiles.map(f=>({...f}))
  const body={requestId:requestId(),...(currentId?{conversationId:currentId}:{}),...(context.resourceId?{resourceId:context.resourceId,resourceVersion:context.resourceVersion}:{}),...(context.package?{package:structuredClone(context.package)}:{}),
   ...(context.name?{name:context.name}:{}),text:text||(context.resourceId?'按上传参考调整当前版式。':'根据上传参考生成版式。'),files,selection,allowModel:true}
  submitting=true;controls()
  try{
   const result=await request('/layout-library/conversations',{method:'POST',body})
   if(!valid(token))return
   currentId=result.conversationId
   if(input.value===submittedText)input.value=''
   pendingFiles=pendingFiles.filter(file=>!submittedFiles.includes(file))
   if(selection===submittedSelection){selection=null;find('[data-chat-selection]').replaceChildren()}
   await load(token);find('[data-chat-messages]').scrollTop=find('[data-chat-messages]').scrollHeight;onChange(currentId)
  }catch(error){if(valid(token)){notify(error.message);find('[data-chat-status]').textContent=error.message}}
  finally{if(valid(token)){submitting=false;controls()}}
 }
 async function upload(files){
  const token=generation
  try{
   for(const file of files){
    if(/\.(txt|md|markdown)$/i.test(file.name)){const text=await readText(file);if(valid(token))pendingFiles.push(text)}
    else if(/\.(json|pptx)$/i.test(file.name)){
     if(submitting||running())throw Error('请先完成或停止当前回复，再导入新的版式。')
     const imported=await onImport(file)
     if(!valid(token))return
     currentId=imported.conversationId??null;conversation=null
     if(currentId)await load(token)
     onChange(currentId)
    }else throw Error('请选择 TXT、Markdown、JSON 或 PPTX 参考。')
   }
   if(!valid(token))return
   renderFiles();controls()
   if(pendingFiles.length&&!running())await send()
  }catch(error){notify(error.message);if(valid(token))find('[data-chat-status]').textContent=error.message}
 }
 find('[data-chat-upload]').onclick=()=>filesInput.click()
 filesInput.onchange=async()=>{const files=[...filesInput.files];filesInput.value='';await upload(files)}
 container.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();container.classList.add('is-file-drag')}})
 container.addEventListener('dragleave',event=>{if(!container.contains(event.relatedTarget))container.classList.remove('is-file-drag')})
 container.addEventListener('drop',event=>{if(!event.dataTransfer?.files.length)return;event.preventDefault();event.stopPropagation();container.classList.remove('is-file-drag');void upload([...event.dataTransfer.files])})
 input.oninput=controls
 input.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();void send()}}
 find('[data-layout-send]').onclick=()=>void send()
 find('[data-chat-stop]').onclick=async()=>{const job=running();if(!job)return;try{await request('/layout-library/reference-jobs/'+job.id+'/cancel',{method:'POST',body:{}});await load()}catch(error){notify(error.message)}}
 void request('/layout-library/reference-config').then(value=>{if(disposed)return;config=value;controls()}).catch(()=>{if(!disposed){config={configured:false};controls()}})
 renderFiles();renderMessages();controls()
 return {select,refresh:load,get id(){return currentId},get busy(){return !!running()||submitting},
  focusSelection(value){selection=value;find('[data-chat-selection]').innerHTML=`<span class="ll-selection">${esc(roles[value.slot]??value.slot)}<button aria-label="取消引用">×</button></span>`;find('[data-chat-selection] button').onclick=()=>{selection=null;find('[data-chat-selection]').replaceChildren()};input.focus()},
  dispose(){disposed=true;generation++;clearTimeout(pollTimer)},
 }
}
