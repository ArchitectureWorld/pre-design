// The conversation and task monitor have their own DOM lifecycle, independent of the flow canvas.
const activeStatuses=new Set(['queued','running','cancelling'])
const labels={queued:'排队中',running:'运行中',cancelling:'中止中',completed:'已完成',partial:'有资料缺口',unreviewed:'待审查',failed:'执行失败',error:'执行失败',cancelled:'已中止',interrupted:'执行中断',recovered:'已恢复，待审阅'}
const kinds={outline:'章节核对',chat:'项目讨论',research:'专业研究',report:'成果整理',annotations:'批注处理',confirm:'提案确认'}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const timestamp=value=>value?Date.parse(value):NaN
const clockTime=value=>Number.isFinite(timestamp(value))?new Date(value).toLocaleTimeString('zh-CN',{hour12:false}):''
const duration=seconds=>seconds===null?'':seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`

export function publicAgentText(value){
 if(typeof value!=='string')return ''
 return value.replace(/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,'').trim()
}

export function agentUserMessage(job){
 const text=publicAgentText(job.user_text)
 if(job.kind==='outline'&&!text)return {label:'操作',text:'根据资料推荐章节'}
 if(job.kind==='outline'&&text==='用户通过流程编辑器提交流程，请严格保留选择与顺序，逐章比对已有资料并询问必要缺项。')return {label:'操作',text:'已提交流程'}
 return {label:'你',text}
}

export function consultMessageMode(outline,{dirty=false,requestedMode='chat'}={}){
 const updating=outline?.busy&&activeStatuses.has(outline?.lastJob?.status)
 return requestedMode==='outline'&&outline?.flowReviewed&&!dirty&&(outline.status!=='stale'||updating)?'outline':'chat'
}

export function consultContentKey(value,cadReplacements=[]){
 const {busy:_busy,lastJob:_lastJob,...outline}=value.outline??{}
 return JSON.stringify([value.id,outline,value.materials,cadReplacements,outline.draft?null:!!_busy])
}

export function createConsultDrafts(storage){
 const fallback=new Map(),key=id=>`pre-outline-message:${id}`
 const read=id=>{try{return storage.getItem(key(id))??fallback.get(id)??''}catch{return fallback.get(id)??''}}
 const save=(id,text)=>{if(!id)return;fallback.set(id,text);try{if(text)storage.setItem(key(id),text);else storage.removeItem(key(id))}catch{}}
 return {read,save,acknowledge(id,sent){if(read(id)!==sent)return false;save(id,'');return true}}
}

export function agentJobView(jobs=[],now=Date.now()){
 const job=jobs.find(j=>j.status==='running'||j.status==='cancelling')??jobs.find(j=>j.status==='queued')??jobs.at(-1)
 if(!job)return null
 const started=timestamp(job.started_at),created=timestamp(job.created_at),finished=timestamp(job.finished_at),active=activeStatuses.has(job.status)
 const start=job.status==='queued'?created:started,end=active?now:finished
 return {id:job.id,status:job.status,label:labels[job.status]??job.status,kind:kinds[job.kind]??'项目任务',active,
  elapsedSeconds:Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,Math.floor((end-start)/1000)):null,
  startedAt:job.started_at??null,finishedAt:job.finished_at??null,createdAt:job.created_at??null,
  queuedCount:jobs.filter(j=>j.status==='queued').length,canCancel:job.status==='queued'||job.status==='running',
  activity:publicAgentText(job.progress?.label),updatedAt:job.progress?.updatedAt??null,error:publicAgentText(job.error)}
}

export function watchProjectEvents({url,headers,refresh,onProgress,onConnection,fetcher=fetch,reconnectMs=1500,pollMs=5000,idleMs=15000}){
 let stopped=false,streamLive=false,connection='',cursor='0',streamController=null,lastPacket=Date.now(),refreshing=null,refreshTimer=null,retryTimer=null,retryResolve=null,refreshAgain=false
 const connected=value=>{if(!stopped&&connection!==value){connection=value;onConnection(value)}}
 const refreshState=()=>{
  if(stopped)return Promise.resolve()
  if(refreshing){refreshAgain=true;return refreshing}
  refreshing=(async()=>{do{refreshAgain=false;try{await refresh();connected(streamLive?'live':'polling')}catch{connected('offline')}}while(refreshAgain&&!stopped)})().finally(()=>{refreshing=null})
  return refreshing
 }
 const scheduleRefresh=()=>{if(!refreshTimer&&!stopped)refreshTimer=setTimeout(()=>{refreshTimer=null;void refreshState()},80)}
 const poll=setInterval(()=>{if(connection!=='live')void refreshState();if(Date.now()-lastPacket>idleMs)streamController?.abort()},Math.min(pollMs,idleMs))
 const retry=()=>new Promise(resolve=>{retryResolve=resolve;retryTimer=setTimeout(()=>{retryTimer=null;retryResolve=null;resolve()},reconnectMs)})
 connected('connecting')
 void(async()=>{
  while(!stopped){
   streamController=new AbortController();lastPacket=Date.now()
   try{
    const response=await fetcher(`${url}${url.includes('?')?'&':'?'}after=${cursor}`,{headers,signal:streamController.signal,cache:'no-store'})
    if(!response.ok||!response.body)throw new Error('状态连接中断')
    if(stopped){await response.body.cancel();return}
    streamLive=true;connected('live');const reader=response.body.getReader(),decoder=new TextDecoder();let buffer=''
    try{while(!stopped){
     const chunk=await reader.read();if(chunk.done)break
     lastPacket=Date.now();buffer+=decoder.decode(chunk.value,{stream:true})
     let boundary
     while((boundary=/\r?\n\r?\n/.exec(buffer))){
      const block=buffer.slice(0,boundary.index);buffer=buffer.slice(boundary.index+boundary[0].length)
      const id=/^id:\s*(\d+)/m.exec(block)?.[1],data=/^data:\s*(.+)/m.exec(block)?.[1]
      if(!id||!data)continue
      let event;try{event=JSON.parse(data)}catch{scheduleRefresh();continue}
      cursor=id
      if(event.type!=='task-progress'||!onProgress(event))scheduleRefresh()
     }
    }}finally{reader.releaseLock()}
   }catch{if(stopped)return}
   streamLive=false;streamController.abort()
   if(stopped)return
   connected('polling');void refreshState();await retry()
  }
 })()
 return {abort(){stopped=true;clearInterval(poll);clearTimeout(refreshTimer);clearTimeout(retryTimer);retryResolve?.();streamController?.abort()}}
}

export function mountOutlineAgent(bottom,{input,sendButton,onCancel,onModeChange,storage=sessionStorage}){
 const panel=document.createElement('section');panel.id='outlineAgentPanel';panel.className='outline-agent';panel.setAttribute('aria-label','Agent 沟通与运行状态')
 panel.innerHTML='<div class="outline-agent-status"><strong data-agent-state>Agent</strong><span data-agent-time></span><span data-agent-queue></span><span class="outline-agent-activity" data-agent-activity></span><span data-agent-connection></span><button type="button" data-agent-cancel hidden>中止</button></div><div class="outline-agent-history" data-agent-history role="log" aria-label="项目讨论记录" aria-live="polite" aria-relevant="additions text"></div><div class="outline-agent-notice" data-agent-notice role="status" hidden></div>'
 bottom.insertBefore(panel,input.closest('#consultComposer'))
 const modes=document.createElement('div');modes.className='outline-agent-modes';modes.setAttribute('role','group');modes.setAttribute('aria-label','消息用途')
 modes.innerHTML='<button type="button" data-agent-mode="chat" aria-pressed="true">讨论</button><button type="button" data-agent-mode="outline" aria-pressed="false">补充核对</button>'
 input.before(modes)
 for(const button of modes.querySelectorAll('button'))button.onclick=()=>onModeChange(button.dataset.agentMode)
 const sendText=document.createElement('span');sendText.dataset.agentSendLabel='';sendButton.append(sendText);sendButton.classList.add('outline-agent-send')
 const drafts=createConsultDrafts(storage),find=selector=>panel.querySelector(selector),history=find('[data-agent-history]')
 let current={jobs:[],connection:'connecting',mode:'chat',busy:false,sending:false},projectId=null,historyKey='',notice='',cancelPending=false
 let followLatest=true,pendingHistoryScroll=true,historyPosition=0,historyFrame=0
 const historyAtEnd=()=>history.scrollHeight-history.scrollTop-history.clientHeight<28
 function positionHistory(){
  // A hidden stage reports zero geometry. Keep the first positioning pending until it is visible.
  if(!pendingHistoryScroll||history.clientHeight<=0)return
  history.scrollTop=followLatest?history.scrollHeight:historyPosition
  historyPosition=history.scrollTop;pendingHistoryScroll=false
 }
 function scheduleHistoryPosition(){positionHistory();if(pendingHistoryScroll&&!historyFrame)historyFrame=requestAnimationFrame(()=>{historyFrame=0;positionHistory()})}
 history.addEventListener('scroll',()=>{if(history.clientHeight<=0||pendingHistoryScroll)return;followLatest=historyAtEnd();historyPosition=history.scrollTop})
 const historyResize=new ResizeObserver(()=>{if(followLatest)pendingHistoryScroll=true;positionHistory()});historyResize.observe(history)
 input.maxLength=16000
 input.addEventListener('input',()=>{drafts.save(projectId,input.value);if(notice)setNotice('')})
 const setText=(selector,value)=>{const el=find(selector);if(el.textContent!==value)el.textContent=value}
 function setNotice(message){notice=message;const el=find('[data-agent-notice]');el.textContent=message;el.hidden=!message}
 function updateStatus(){
  const view=agentJobView(current.jobs),cancel=find('[data-agent-cancel]')
  panel.dataset.status=view?.status??'idle'
  setText('[data-agent-state]',view?`${view.kind} · ${view.label}`:'Agent · 可交流')
  const times=[]
  if(view?.startedAt)times.push(`开始 ${clockTime(view.startedAt)}`)
  if(view?.finishedAt)times.push(`结束 ${clockTime(view.finishedAt)}`)
  if(view?.elapsedSeconds!==null&&view?.elapsedSeconds!==undefined)times.push(`${view.status==='queued'?'已等待':view.active?'已运行':'用时'} ${duration(view.elapsedSeconds)}`)
  setText('[data-agent-time]',times.join(' · '))
  find('[data-agent-time]').title=[view?.startedAt?`开始：${new Date(view.startedAt).toLocaleString('zh-CN')}`:'',view?.finishedAt?`结束：${new Date(view.finishedAt).toLocaleString('zh-CN')}`:''].filter(Boolean).join('；')
  setText('[data-agent-queue]',view?.queuedCount?`待执行 ${view.queuedCount}`:'')
  setText('[data-agent-activity]',view?.error||view?.activity||'')
  find('[data-agent-activity]').title=[view?.error||view?.activity,view?.updatedAt?`更新 ${clockTime(view.updatedAt)}`:''].filter(Boolean).join(' · ')
  setText('[data-agent-connection]',{connecting:'连接中',live:'已连接',polling:'连接中断 · 轮询中',offline:'连接中断 · 重试中'}[current.connection]??'连接中')
  find('[data-agent-connection]').dataset.connection=current.connection
  cancel.hidden=!view?.active;cancel.disabled=!view?.canCancel||cancelPending;cancel.textContent=view?.status==='cancelling'||cancelPending?'中止中…':'中止'
  sendButton.disabled=!!current.sending||(current.mode==='outline'&&current.busy)
  const sendLabel=current.sending?'正在发送':current.mode==='outline'?current.busy?'任务运行中，补充草稿已保留':'提交补充并核对':view?.active?'发送讨论，进入队列':'发送讨论'
  sendButton.title=sendLabel;sendButton.setAttribute('aria-label',sendLabel)
  sendText.textContent=current.sending?'发送中':current.mode==='outline'?'核对':'发送'
  for(const button of modes.querySelectorAll('button')){button.setAttribute('aria-pressed',String(button.dataset.agentMode===current.mode));button.disabled=button.dataset.agentMode==='outline'&&!current.canReview;button.title=button.disabled?'提交流程后可补充核对':button.dataset.agentMode==='outline'?'发送后更新资料核对':'只讨论，不提交流程'}
  input.placeholder=current.mode==='outline'?current.busy?'可继续填写补充，任务结束后发送……':'回答资料疑点，或补充本轮研究要求……':view?.active?'可继续讨论，消息将排队处理……':'与 Agent 讨论本轮章节或项目要求……'
 }
 function updateHistory(){
  // Progress labels and timestamps never replace a conversation or the canvas.
  const key=JSON.stringify([projectId,current.jobs.map(j=>[j.id,j.kind,j.status,j.user_text,j.result?.response,j.error])])
  if(key===historyKey){scheduleHistoryPosition();return}
  if(history.clientHeight>0&&!pendingHistoryScroll){followLatest=historyAtEnd();historyPosition=history.scrollTop}
  historyKey=key
  history.innerHTML=current.jobs.map(job=>{
   const user=agentUserMessage(job),response=publicAgentText(job.result?.response),error=publicAgentText(job.error),result=response||error||`${kinds[job.kind]??'任务'} · ${labels[job.status]??job.status}`
   return `${user.text?`<div class="outline-agent-message is-user"><b>${user.label}</b><p>${escape(user.text)}</p></div>`:''}<div class="outline-agent-message ${error?'is-error':''}" data-agent-job="${escape(job.id)}"><b>Agent</b><p>${escape(result)}</p><small>${escape(labels[job.status]??job.status)}</small></div>`
  }).join('')||'<div class="outline-agent-empty">在这里与 Agent 交流</div>'
  pendingHistoryScroll=true;scheduleHistoryPosition()
 }
 find('[data-agent-cancel]').onclick=async()=>{
  const view=agentJobView(current.jobs);if(!view?.canCancel||cancelPending)return
  const targetProject=projectId;cancelPending=true;updateStatus()
  try{await onCancel(view.id,targetProject)}catch(error){if(projectId===targetProject)setNotice(`中止未成功：${error.message}`)}finally{cancelPending=false;updateStatus()}
 }
 const ticker=setInterval(()=>{if(!document.hidden&&panel.offsetParent)updateStatus()},1000)
 return {
  update(value){if(value.projectId!==projectId){if(projectId)drafts.save(projectId,input.value);projectId=value.projectId;input.value=drafts.read(projectId);historyKey='';followLatest=true;pendingHistoryScroll=true;historyPosition=0;setNotice('')}current={...current,...value};updateHistory();updateStatus()},
  setDraft(text){input.value=text;drafts.save(projectId,text);input.focus()},
  acknowledge(id,sent){if(projectId===id)drafts.save(id,input.value);const cleared=drafts.acknowledge(id,sent);if(cleared&&projectId===id)input.value='';return cleared},
  setNotice,
  destroy(){clearInterval(ticker);cancelAnimationFrame(historyFrame);historyResize.disconnect();panel.remove();modes.remove();sendText.remove();sendButton.classList.remove('outline-agent-send')},
 }
}
