import {mountNativePreview} from './preview-ui.js'
import {mountLayoutConversation} from './conversation-ui.js'
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const rid=()=>crypto.randomUUID?.()??Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('')
const stateName=r=>r.retired?'已归档':r.published?'已发布':r.validation?.status==='passed'?'检查通过':'草稿'
const visibility={private:'个人',shared:'共享',official:'官方'}
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value
const equal=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b))

export function mountLayoutLibrary({request,notify}){
 const entry=document.createElement('button');entry.type='button';entry.className='ll-entry';entry.textContent='版式库';entry.dataset.layoutLibraryOpen=''
 document.querySelector('.top-right')?.prepend(entry)
 let dialog,identity,resources=[],conversations=[],selected=null,working=null,chat,previewHandle,previewLayout='',layoutChosen=false,picker=null,generation=0,previewGeneration=0,previewTimer,busy=false,modelBusy=false,historyViewing=false,viewEpoch=0,lastDeletion=null
 const pending=new Map()
 const msg=text=>{const el=dialog?.querySelector('[data-ll-status]');if(el)el.textContent=text}
 const own=()=>!selected||selected.ownerId===identity?.id||identity?.role==='admin'
 function close(){generation++;viewEpoch++;clearTimeout(previewTimer);previewHandle?.dispose();chat?.dispose();dialog?.close();dialog?.remove();dialog=null;chat=null;pending.clear();picker=null}
 async function run(action){if(busy)return;busy=true;try{await action()}catch(error){msg(error.message);notify(error.message)}finally{busy=false}}
 async function post(path,body={}){
  const key=JSON.stringify([path,body]);let requestId=pending.get(key);if(!requestId){requestId=rid();pending.set(key,requestId)}
  try{const result=await request(path,{method:'POST',body:{...body,requestId}});pending.delete(key);return result}catch(error){if(error.status>=400&&error.status<500)pending.delete(key);throw error}
 }
 async function reload(){
  const token=generation
  const [library,history]=await Promise.all([request('/layout-library'),request('/layout-library/conversations')])
  if(token!==generation||!dialog)return
  resources=library.resources;conversations=history.conversations;renderList()
 }
 async function open(options={}){
  close();picker=options.onPick??null;const token=generation
  selected=null;working=null;previewLayout='';modelBusy=false;historyViewing=false
  dialog=document.createElement('dialog');dialog.className='ll-dialog';dialog.dataset.layoutLibrary='';dialog.setAttribute('aria-label','版式工作台')
  dialog.innerHTML=`<header class="ll-head"><button data-library-nav aria-label="浏览版式" aria-expanded="false">☰</button><h2>版式库</h2><span data-ll-status role="status">正在连接…</span><button data-undo-delete hidden>撤销删除</button><button data-close aria-label="关闭版式库">×</button></header><div class="ll-main ll-unified"><aside class="ll-sidebar"><div class="ll-tools"><input data-search type="search" placeholder="搜索版式"><button data-new class="ll-primary">新建版式</button><button data-seed hidden>预置版式</button></div><div data-list class="ll-list"></div></aside><section class="ll-inspector" data-layout-results></section><aside class="ll-assistant" data-layout-chat></aside></div>`
  document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-close]').onclick=close;dialog.oncancel=e=>{e.preventDefault();close()}
  dialog.querySelector('[data-library-nav]').onclick=()=>{const open=dialog.classList.toggle('nav-open');dialog.querySelector('[data-library-nav]').setAttribute('aria-expanded',String(open))}
  dialog.querySelector('[data-search]').oninput=renderList
  dialog.querySelector('[data-undo-delete]').hidden=!lastDeletion
  dialog.querySelector('[data-undo-delete]').onclick=()=>void run(undoDeletion)
  dialog.querySelector('[data-new]').onclick=()=>void run(async()=>{await selectConversation(null);msg('')})
  try{
   identity=await request('/me');if(token!==generation)return
   await reload();if(token!==generation)return
   if(options.resourceId){selected=await request('/layout-library/'+options.resourceId+'/'+options.version);working=structuredClone(selected.package);historyViewing=selected.version<selected.latestVersion}
   renderResult()
   chat=mountLayoutConversation({container:dialog.querySelector('[data-layout-chat]'),request,notify,
    getContext:()=>{if(selected?.version<selected?.latestVersion)throw Error('正在查看历史版本，请切换到最新版后继续修改。');readForm();return {...(selected?{resourceId:selected.id,resourceVersion:selected.version}:{}),...(working?{name:working.name,package:working}:{})}},
    onResource:async(resource,{historical=false}={})=>{
     if(token!==generation)return
     if(historical)historyViewing=resource.version<resource.latestVersion
     else if(historyViewing)return
     if(!selected||selected.id!==resource.id||selected.version!==resource.version){selected=resource;working=structuredClone(resource.package);previewLayout='';renderResult();await preview()}
     if(!historical)await reload()
    },
    onDraft:async pkg=>{if(token!==generation||working)return;working=structuredClone(pkg);renderResult();await preview()},
    onImport:importFile,
    onState:state=>{modelBusy=state.busy;updateControls();if(!working)renderResult()},
    onChange:()=>{void reload().catch(e=>msg(e.message))},
   })
   const seed=dialog.querySelector('[data-seed]');seed.hidden=identity.role!=='admin';seed.onclick=()=>void run(async()=>{await post('/layout-library/seed');await reload();msg('预置版式已保存。')})
   await chat.select(options.resourceId?conversations.find(c=>c.resourceId===options.resourceId)?.id:null)
   if(working)await preview()
   msg('')
  }catch(error){msg(error.message)}
 }
 const trashIcon='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg>'
 function renderList(){
  if(!dialog)return
  const query=dialog.querySelector('[data-search]').value.trim().toLowerCase(),list=dialog.querySelector('[data-list]')
  const cards=resources.filter(r=>(r.package.name+' '+r.package.tags.join(' ')).toLowerCase().includes(query)).map(r=>`<div class="ll-card-row"><button class="ll-card ${r.id===selected?.id?'selected':''}" data-resource-card="${r.id}" data-version="${r.version}"><span class="ll-swatch" style="background:${r.package.theme.background};color:${r.package.theme.ink};border-left:4px solid ${r.package.theme.accent}">Aa<i style="background:${r.package.theme.accent}"></i></span><b>${esc(r.package.name)}</b><small>${visibility[r.visibility]} · V${r.version} · ${stateName(r)}</small></button>${r.editable||r.ownerId===identity?.id?`<button class="ll-card-delete" data-delete-resource="${r.id}" aria-label="删除版式 ${esc(r.package.name)}" title="删除版式">${trashIcon}</button>`:''}</div>`)
  const drafts=conversations.filter(c=>!c.resourceId&&c.name?.toLowerCase().includes(query)).map(c=>`<div class="ll-card-row"><button class="ll-card ll-card-draft ${chat?.id===c.id?'selected':''}" data-conversation="${c.id}"><b>${esc(c.name)}</b><small>${['queued','running','cancelling'].includes(c.status)?'正在生成':c.status==='completed'?'待完善':'未生成'}</small></button><button class="ll-card-delete" data-delete-conversation="${c.id}" aria-label="删除版式草稿 ${esc(c.name)}" title="删除草稿">${trashIcon}</button></div>`)
  list.innerHTML=[...cards,...drafts].join('')||'<p class="ll-empty-list">上传参考，开始你的第一份版式。</p>'
  list.querySelectorAll('[data-resource-card]').forEach(b=>b.onclick=()=>void run(()=>selectResource(b.dataset.resourceCard,Number(b.dataset.version))))
  list.querySelectorAll('[data-conversation]').forEach(b=>b.onclick=()=>void run(()=>selectConversation(b.dataset.conversation)))
  list.querySelectorAll('[data-delete-resource]').forEach(b=>b.onclick=()=>void run(()=>deleteEntry('resource',b.dataset.deleteResource)))
  list.querySelectorAll('[data-delete-conversation]').forEach(b=>b.onclick=()=>void run(()=>deleteEntry('conversation',b.dataset.deleteConversation)))
 }
 async function deleteEntry(kind,id){
  const resource=kind==='resource'?resources.find(r=>r.id===id):null
  const path=kind==='resource'?'/layout-library/'+id:'/layout-library/conversations/'+id
  const result=await post(path+'/delete',resource?{expectedVersion:resource.latestVersion}:{})
  lastDeletion={kind,id,path,deleteToken:result.deleteToken}
  if(selected?.id===id||chat.id===id)await selectConversation(null)
  await reload();msg('已删除');dialog.querySelector('[data-undo-delete]').hidden=false
 }
 async function undoDeletion(){
  const removed=lastDeletion;if(!removed)return
  await post(removed.path+'/restore',{deleteToken:removed.deleteToken});lastDeletion=null
  await reload();dialog.querySelector('[data-undo-delete]').hidden=true
  if(removed.kind==='resource'){const resource=resources.find(r=>r.id===removed.id);if(resource)await selectResource(resource.id,resource.version)}
  else await selectConversation(removed.id)
  msg('已恢复')
 }
 function hideNavigation(){dialog?.classList.remove('nav-open');dialog?.querySelector('[data-library-nav]')?.setAttribute('aria-expanded','false')}
 async function selectConversation(id){
  viewEpoch++;hideNavigation();selected=null;working=null;previewLayout='';historyViewing=false;clearTimeout(previewTimer);renderResult()
  await chat.select(id);renderList()
 }
 async function selectResource(id,version,{syncChat=true}={}){
  viewEpoch++;hideNavigation()
  if(syncChat)await chat.select(null)
  const token=generation,resource=await request('/layout-library/'+id+'/'+version)
  if(token!==generation||!dialog)return
  selected=resource;working=structuredClone(resource.package);previewLayout='';layoutChosen=false;historyViewing=resource.version<resource.latestVersion;renderList();renderResult();await preview()
  const conversation=conversations.find(c=>c.resourceId===id)
  if(syncChat)await chat.select(conversation?.id??null)
 }
 function readForm(){
  const form=dialog?.querySelector('[data-editor]');if(!form||!working)return
  const advanced=form.querySelector('[data-json]')
  if(advanced.dataset.dirty==='true'){working=JSON.parse(advanced.value);renderResult();return}
  working.name=dialog.querySelector('[data-resource-name]').value.trim()
  working.theme.fontFamily=form.elements.fontFamily.value
  for(const key of ['background','ink','accent','muted']){const value=form.elements[key].value;if(value.toLowerCase()!==working.theme[key].toLowerCase())working.theme[key]=value}
  for(const key of ['titleSize','bodySize','captionSize'])working.theme[key]=Number(form.elements[key].value)
  Object.assign(working.rights,{basis:form.elements.basis.value,shareAllowed:form.elements.shareAllowed.checked,note:form.elements.rightsNote.value})
 }
 function updateControls(){
  if(!dialog)return
  const form=dialog.querySelector('[data-editor]');if(form)for(const el of form.elements)el.disabled=modelBusy||!own()
  const name=dialog.querySelector('[data-resource-name]');if(name)name.disabled=modelBusy||!own()
  for(const button of dialog.querySelectorAll('[data-save],[data-validate],[data-publish],[data-use-layout]'))button.disabled=modelBusy
 }
 function renderResult(){
  if(!dialog)return
  previewHandle?.dispose();previewHandle=null
  const panel=dialog.querySelector('[data-layout-results]')
  if(!working){panel.innerHTML=`<div class="ll-result-empty"><strong>${modelBusy?'正在生成版式…':'上传参考后，在这里预览版式'}</strong><button data-manual ${modelBusy?'disabled':''}>手动创建</button></div>`;panel.querySelector('[data-manual]').onclick=()=>void run(async()=>{working=(await request('/layout-library/starter')).package;working.name='我的自定义版式';selected=null;renderResult();await preview()});return}
  const pkg=working;previewLayout=pkg.layouts.some(l=>l.id===previewLayout)?previewLayout:pkg.layouts[0].id
  panel.innerHTML=`<div class="ll-result-heading"><input data-resource-name aria-label="版式名称" value="${esc(pkg.name)}" maxlength="100"><span>${selected?'V'+selected.version+' · '+stateName(selected):'新建版式'}</span>${selected&&own()?`<select data-history aria-label="历史版本">${Array.from({length:selected.latestVersion},(_,i)=>`<option value="${i+1}" ${selected.version===i+1?'selected':''}>V${i+1}</option>`).join('')}</select>`:''}</div>
   <div class="ll-preview-controls"><select data-layout aria-label="预览布局">${pkg.layouts.map(l=>`<option value="${l.id}" ${l.id===previewLayout?'selected':''}>${esc(l.label)}</option>`).join('')}</select><button data-preview>更新预览</button></div>
   <div class="ll-preview" data-preview-box></div>
   <div class="ll-result-actions"><button data-save class="ll-primary">${selected&&own()?'保存修改':'保存版式'}</button>${selected?'<button data-validate>检查版式</button><button data-export>导出</button>':''}${picker?'<button data-use-layout class="ll-primary">选用此版式</button>':''}</div>
   <details class="ll-settings"><summary>手动调整</summary><form data-editor class="ll-form">${[['background','背景'],['ink','正文'],['accent','标题'],['muted','注释']].map(([k,l])=>`<label>${l}<input type="color" name="${k}" value="${pkg.theme[k]}"></label>`).join('')}
   <label>字体<select name="fontFamily"><option value="sans" ${pkg.theme.fontFamily==='sans'?'selected':''}>黑体</option><option value="serif" ${pkg.theme.fontFamily==='serif'?'selected':''}>宋体</option></select></label>${[['titleSize','标题字号',32,90],['bodySize','正文字号',22,44],['captionSize','注释字号',16,30]].map(([k,l,min,max])=>`<label>${l}<input name="${k}" type="number" min="${min}" max="${max}" value="${pkg.theme[k]}"></label>`).join('')}
   <label>使用依据<select name="basis">${[['original','原创'],['licensed','取得许可'],['permission','明确授权'],['unknown','待确认']].map(([k,l])=>`<option value="${k}" ${pkg.rights.basis===k?'selected':''}>${l}</option>`).join('')}</select></label><label><span>共享授权</span><span><input type="checkbox" name="shareAllowed" ${pkg.rights.shareAllowed?'checked':''}>允许共享</span></label><label class="wide">授权说明<input name="rightsNote" value="${esc(pkg.rights.note)}"></label><details class="wide"><summary>内容位置与原生 JSON</summary><textarea data-json rows="8">${esc(JSON.stringify(pkg,null,2))}</textarea></details></form></details>
   ${selected&&own()?`<details class="ll-publish"><summary>发布与管理</summary><select data-visibility>${[['private','个人'],['shared','共享'],['official','官方']].filter(([v])=>identity.role==='admin'||v==='private').map(([v,l])=>`<option value="${v}" ${selected.visibility===v?'selected':''}>${l}</option>`).join('')}</select><label><input type="checkbox" data-reviewed>已核对参考与授权</label><button data-publish>发布此版本</button><button data-share>提交共享审查</button><button data-retire>归档</button></details>`:''}
   <small class="ll-result-qa" data-qa-result>${selected?.validation?.status==='passed'?'页面检查通过':selected?.validation?.status==='failed'?'页面检查未通过':''}</small>`
  const form=panel.querySelector('[data-editor]');form.onsubmit=e=>e.preventDefault()
  form.querySelector('[data-json]').oninput=e=>{e.target.dataset.dirty='true'}
  const schedule=()=>{clearTimeout(previewTimer);previewTimer=setTimeout(()=>{if(form.checkValidity())void preview(true).catch(e=>msg(e.message))},250)}
  form.addEventListener('input',e=>{if(!e.target.matches('[data-json]'))schedule()})
  panel.querySelector('[data-resource-name]').oninput=schedule
  panel.querySelector('[data-layout]').onchange=()=>{previewLayout=panel.querySelector('[data-layout]').value;layoutChosen=true;void preview(true).catch(e=>msg(e.message))}
  panel.querySelector('[data-preview]').onclick=()=>void run(()=>preview(true))
  panel.querySelector('[data-history]')?.addEventListener('change',event=>void run(()=>selectResource(selected.id,Number(event.target.value),{syncChat:false})))
  panel.querySelector('[data-save]').onclick=()=>void run(save)
  panel.querySelector('[data-validate]')?.addEventListener('click',()=>void run(async()=>{
   readForm();if(!equal(working,selected.package))throw Error('请先保存修改，再检查当前版本。')
   msg('正在检查页面…');const result=await request('/layout-library/'+selected.id+'/'+selected.version+'/validate',{method:'POST',body:{}})
   selected=await request('/layout-library/'+selected.id+'/'+selected.version);renderResult();await preview();await reload();msg(result.status==='passed'?'版式检查通过。':'页面检查未通过。')
  }))
  panel.querySelector('[data-export]')?.addEventListener('click',()=>void run(async()=>download(await request('/layout-library/'+selected.id+'/'+selected.version+'/export',{download:true}))))
  panel.querySelector('[data-use-layout]')?.addEventListener('click',()=>void run(async()=>{if(!selected||!equal(readWorking(),selected.package))await save();await picker({resourceId:selected.id,version:selected.version,...(layoutChosen?{layoutId:previewLayout}:{})});close()}))
  panel.querySelector('[data-publish]')?.addEventListener('click',()=>void run(async()=>{
   readForm();if(!equal(working,selected.package))throw Error('请先保存当前修改。');if(!panel.querySelector('[data-reviewed]').checked)throw Error('请核对参考与授权。')
   await post('/layout-library/'+selected.id+'/'+selected.version+'/publish',{visibility:panel.querySelector('[data-visibility]').value,reviewed:true});selected=await request('/layout-library/'+selected.id+'/'+selected.version);renderResult();await preview();await reload();msg('已发布此版本。')
  }))
  panel.querySelector('[data-share]')?.addEventListener('click',()=>void run(async()=>{await post('/layout-library/'+selected.id+'/'+selected.version+'/request-share');await reload();msg('共享申请已提交。')}))
  panel.querySelector('[data-retire]')?.addEventListener('click',()=>void run(async()=>{await post('/layout-library/'+selected.id+'/retire',{expectedVersion:selected.latestVersion});selected=await request('/layout-library/'+selected.id+'/'+selected.version);renderResult();await preview();await reload();msg('已归档。')}))
  updateControls()
 }
 function readWorking(){readForm();return working}
 async function save(){
  readForm();if(!working)return
  const result=selected&&own()?await post('/layout-library/'+selected.id+'/revisions',{expectedVersion:selected.latestVersion,package:working}):await post('/layout-library',{package:working})
  selected=await request('/layout-library/'+result.id+'/'+result.version);working=structuredClone(selected.package);historyViewing=false;renderResult();await preview();await reload();msg('已保存版式 V'+selected.version+'。')
 }
 async function preview(read=false){
  if(!dialog||!working)return
  if(read)readForm()
  const token=generation,revision=++previewGeneration,box=dialog.querySelector('[data-preview-box]')
  const result=await request('/layout-library/preview',{method:'POST',body:{package:working,layoutId:previewLayout}})
  if(token!==generation||revision!==previewGeneration||!box.isConnected)return
  previewHandle?.dispose();previewHandle=mountNativePreview(box,result.html,{onSelect:selection=>chat.focusSelection(selection)})
 }
 async function importFile(file){
  const epoch=viewEpoch
  if(file.size>8*1024*1024)throw Error('参考文件超过8 MiB。')
  const data=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192))
  const result=await post('/layout-library/import',{filename:file.name,content:btoa(binary)})
  const resource=await request('/layout-library/'+result.id+'/'+result.version)
  if(!dialog||epoch!==viewEpoch)return result
  selected=resource;working=structuredClone(selected.package);previewLayout='';historyViewing=false;renderResult();await preview();await reload();return result
 }
 function download(file){const url=URL.createObjectURL(file.blob),a=document.createElement('a');a.href=url;a.download=file.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 entry.onclick=()=>void run(()=>open())
 return {open,reset:close,dispose(){close();entry.remove()}}
}
