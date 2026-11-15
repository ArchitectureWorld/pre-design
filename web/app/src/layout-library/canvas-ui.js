import {mountNativePreview} from './preview-ui.js'
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const uid=()=>crypto.randomUUID?.()??Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('')
const mime='application/x-pre-design-layout'
const layoutNames={points:'要点',columns:'双栏',focus:'重点','image-left':'左图右文',table:'数据比较'}

export function mountCanvasLayouts({nodeLayer,viewport,getProject,request,notify,mutate,refresh,openLibrary}){
 let config=null,projectKey='',generation=0,loadNumber=0,panel=null,target=null,previewHandle=null,resources=[],identity,chain=Promise.resolve(),saving=false
 const current=()=>{const p=getProject(),d=p?.workflow?.current;return d?.formatVersion===2&&!d.stale?{p,d}:null}
 const pages=()=>current()?.d.blocks.flatMap(block=>(block.items??[]).map(item=>({id:'visual-page-'+item.id,item,block})))??[]
 const effective=()=>config&&!config.stale?config:{revision:config?.revision??0,global:null,globalOverrides:{},local:{},manual:{}}
 const manualFor=pageId=>{
  const ctx=current(),deck=ctx?.p.workflow.visuals?.current
  const protectedLayout=deck&&!deck.stale&&deck.draftId===ctx.d.id?deck.pages.find(page=>page.id===pageId)?.protectedLayout:null
  const patch=effective().manual?.[pageId]
  return {...protectedLayout,...patch,theme:{...protectedLayout?.theme,...patch?.theme}}
 }
 function close(){previewHandle?.dispose();previewHandle=null;panel?.remove();panel=null;target=null}
 function reset(){generation++;loadNumber++;config=null;projectKey='';close()}
 function status(){const c=current();if(!c||!config?.revision)return '待配置';const deck=c.p.workflow.visuals?.current;return deck&&!deck.stale&&deck.layoutBindingRevision===config.revision?'已应用':deck?'已保存 · 待重排':'已保存 · 待生成'}
 function label(pageId){
  const c=effective(),local=pageId?c.local?.[pageId]:null
  if(pageId&&c.reviewPageIds?.includes(pageId))return '待复核'
  if(local?.resource)return local.resource.package.name
  if(local?.overrides?.layoutId)return layoutNames[local.overrides.layoutId]??local.overrides.layoutId
  if(pageId&&c.global)return '全局 · '+c.global.package.name
  return c.global?.package.name??'默认'
 }
 function paint(){
  const ctx=current(),available=new Set(pages().map(p=>p.id))
  for(const node of nodeLayer.querySelectorAll('[data-node-kind]')){
   const kind=node.dataset.nodeKind,pageId=node.dataset.itemId?'visual-page-'+node.dataset.itemId:null
   if(!ctx||kind!=='root'&&(!['script','artifact'].includes(kind)||!available.has(pageId))){node.querySelector('[data-canvas-layout]')?.remove();continue}
   let button=node.querySelector('[data-canvas-layout]')
   if(!button){
    button=document.createElement('button');button.type='button';button.className='canvas-layout-chip';button.dataset.canvasLayout=''
    const footer=node.querySelector(kind==='root'?'.root-meta':'.script-bottom')??node
    footer.classList.add('canvas-layout-footer')
    for(const arrow of footer.querySelectorAll(':scope > span'))if(arrow.textContent.trim()==='↗')arrow.remove()
    footer.append(button)
    button.addEventListener('click',event=>{event.stopPropagation();void open(kind==='root'?null:pageId,button).catch(e=>notify(e.message))})
    for(const type of ['pointerdown','dblclick','keydown'])button.addEventListener(type,event=>event.stopPropagation())
   }
   button.dataset.layoutPage=kind==='root'?'global':pageId
   button.textContent=(kind==='root'?'全局版式 · ':'版式 · ')+label(kind==='root'?null:pageId)
   const manual=pageId?manualFor(pageId):null
   button.title=button.textContent+' · '+status()+(manual&&(manual.layoutId||Object.keys(manual.theme).length)?' · 含手动覆盖':'')
   button.setAttribute('aria-label',kind==='root'?'配置全局版式':'配置本页版式 '+(pages().find(p=>p.id===pageId)?.item.title??''))
   button.dataset.state=status()==='已应用'?'applied':config?.revision?'saved':'empty'
   button.disabled=saving
  }
  if(panel)position()
 }
 async function load(){
  const ctx=current();if(!ctx)return
  const token=generation,number=++loadNumber
  const value=await request('/projects/'+ctx.p.id+'/layout-bindings')
  if(token!==generation||number!==loadNumber)return
  config=value;paint()
 }
 function update(){
  const ctx=current(),key=ctx?ctx.p.id+':'+ctx.d.id:''
  if(key!==projectKey){reset();projectKey=key}
  paint();if(ctx)void load().catch(error=>notify(error.message))
 }
 function anchor(){return target?nodeLayer.querySelector('[data-layout-page="'+(target.pageId??'global')+'"]'):null}
 function position(){
  const node=anchor();if(!panel||!node){if(panel)close();return}
  const r=node.getBoundingClientRect(),v=viewport.getBoundingClientRect(),width=Math.min(460,v.width-20)
  panel.style.width=width+'px';panel.style.maxHeight=Math.max(240,v.height-20)+'px'
  const x=r.right+12+width<v.right?r.right+12:Math.max(v.left+10,r.left-width-12)
  panel.style.left=Math.min(x,v.right-width-10)+'px';panel.style.top=Math.max(v.top+10,Math.min(r.top,v.bottom-panel.offsetHeight-10))+'px'
 }
 async function open(pageId,button){
  const ctx=current();if(!ctx)return
  close();target={pageId,projectId:ctx.p.id,draftId:ctx.d.id}
  panel=document.createElement('section');panel.className='canvas-layout-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',pageId?'本页版式':'全局版式');panel.dataset.canvasLayoutPanel=''
  document.body.append(panel)
  const token=generation
  panel.innerHTML='<div class="canvas-layout-loading">正在读取版式…</div>';position()
  const [library,user]=await Promise.all([request('/layout-library'),request('/me')])
  if(!panel||token!==generation)return
  const visible=library.resources.filter(r=>!r.retired&&(r.ownerId===user.id||r.publishedVersion))
  resources=await Promise.all(visible.map(r=>r.ownerId!==user.id&&r.version!==r.publishedVersion?request('/layout-library/'+r.id+'/'+r.publishedVersion):r));identity=user
  await load();if(!panel)return;renderPanel();button?.setAttribute('aria-expanded','true')
 }
 function selectedPages(){return target?.pageId?[...panel.querySelectorAll('[data-bind-page]:checked')].map(n=>n.value):pages().map(p=>p.id)}
 function scope(){return target?.pageId?panel.querySelector('[data-layout-layer]').value:'global'}
 function overrides(){
  const layoutId=panel.querySelector('[data-canvas-layout-kind]').value,accent=panel.querySelector('[data-canvas-accent]').value.trim()
  return {...(layoutId?{layoutId}:{}),...(accent?{theme:{accent}}:{})}
 }
 function renderPanel(){
  if(!panel||!target)return
  const page=pages().find(p=>p.id===target.pageId),c=effective(),local=page?c.local?.[page.id]:null,patch=page?local?.overrides??{}:c.globalOverrides??{}
  const resource=page?local?.resource:c.global,ctx=current(),deck=ctx?.p.workflow.visuals?.current
  const usableDeck=deck&&!deck.stale&&deck.draftId===ctx.d.id?deck:null
  panel.innerHTML=`<header><strong>${page?'本页版式':'全局版式'}</strong><button data-layout-close aria-label="关闭版式设置">×</button></header>${page?`<small>${esc(page.item.title)}</small><select data-layout-layer aria-label="设置层级"><option value="local">本页版式</option><option value="manual">手动覆盖</option></select>`:''}
   <div class="canvas-layout-options" data-layout-options><button data-pick-style="" draggable="true" class="${!resource?'selected':''}">默认版式</button>${resources.map(r=>`<button data-pick-style="${r.id}" data-version="${r.publishedVersion&&r.ownerId!==identity.id?r.publishedVersion:r.version}" draggable="true" class="${resource?.resourceId===r.id?'selected':''}"><i style="background:${r.package.theme.background};border-color:${r.package.theme.accent}"></i><span>${esc(r.package.name)}</span></button>`).join('')}</div>
   <div class="canvas-layout-fields"><label>页面布局<select data-canvas-layout-kind><option value="">按内容匹配</option>${Object.entries(layoutNames).map(([id,name])=>`<option value="${id}" ${patch.layoutId===id?'selected':''}>${name}</option>`).join('')}</select></label><label>标题颜色<input data-canvas-accent maxlength="7" placeholder="继承" value="${esc(patch.theme?.accent??'')}"></label></div>
   ${page?`<details class="canvas-layout-pages"><summary>同时配置其他页</summary>${pages().map(p=>`<label><input data-bind-page type="checkbox" value="${p.id}" ${p.id===page.id?'checked disabled':''}>${esc(p.item.title)}</label>`).join('')}</details>`:''}
   <div class="canvas-layout-preview" data-page-layout-preview></div><div class="canvas-layout-status" data-layout-status role="status">${page&&c.reviewPageIds?.includes(page.id)?'页脚本已重组，请重新选择本页版式。':status()}</div>
   <footer><button data-save-page-layout class="primary">保存设置</button><button data-reset-page-layout>${page?'恢复继承':'恢复默认'}</button><button data-open-layout-library>版式库…</button>${ctx?.d.approval?`<button data-apply-layout>${usableDeck?'更新成果':'生成整套成果'}</button>`:''}${usableDeck&&page?'<button data-save-layout-variant>存入版式库</button>':''}</footer><div data-layout-variant-form></div>`
  panel.querySelector('[data-layout-close]').onclick=close
  for(const type of ['pointerdown','dblclick','keydown'])panel.addEventListener(type,event=>{if(event.key==='Escape'){event.preventDefault();close()}event.stopPropagation()})
  panel.querySelector('[data-layout-layer]')?.addEventListener('change',()=>{
   const manual=scope()==='manual',selected=manual?manualFor(target.pageId):effective().local?.[target.pageId]?.overrides??{}
   panel.querySelector('[data-layout-options]').hidden=manual;panel.querySelector('[data-canvas-layout-kind]').value=selected.layoutId??'';panel.querySelector('[data-canvas-accent]').value=selected.theme?.accent??''
  })
  panel.querySelectorAll('[data-pick-style]').forEach(b=>{
   const ref=b.dataset.pickStyle?{resourceId:b.dataset.pickStyle,version:Number(b.dataset.version)}:null
   b.onclick=()=>{const ids=selectedPages();void save(target,{scope:scope(),pageIds:ids,resource:ref,overrides:overrides()}).catch(()=>{})}
   b.ondragstart=event=>{event.dataTransfer.setData(mime,JSON.stringify(ref));event.dataTransfer.effectAllowed='copy';viewport.classList.add('is-layout-dragging')}
   b.ondragend=clearDrag
  })
  panel.querySelector('[data-save-page-layout]').onclick=()=>{
   const selected=target.pageId?effective().local?.[target.pageId]?.resource:effective().global
   void save(target,{scope:scope(),pageIds:selectedPages(),resource:selected?{resourceId:selected.resourceId,version:selected.version}:null,overrides:overrides()}).catch(()=>{})
  }
  panel.querySelector('[data-reset-page-layout]').onclick=()=>void save(target,{scope:scope(),pageIds:selectedPages(),remove:true,resource:null,overrides:{}}).catch(()=>{})
  panel.querySelector('[data-open-layout-library]').onclick=()=>{const snapshot={...target},ids=selectedPages(),layer=scope();close();void openLibrary({onPick:choice=>save(snapshot,{scope:layer,pageIds:ids,resource:{resourceId:choice.resourceId,version:choice.version},overrides:choice.layoutId?{layoutId:choice.layoutId}:{}})})}
  panel.querySelector('[data-apply-layout]')?.addEventListener('click',()=>void apply())
  panel.querySelector('[data-save-layout-variant]')?.addEventListener('click',()=>{
   panel.querySelector('[data-layout-variant-form]').innerHTML='<input data-variant-name placeholder="版式名称" maxlength="100"><button data-variant-save>保存</button>'
   panel.querySelector('[data-variant-save]').onclick=()=>void saveVariant()
  })
  void preview().catch(error=>setStatus(error.message));position()
 }
 function setStatus(text){if(panel)panel.querySelector('[data-layout-status]').textContent=text}
 function assertTarget(snapshot){const ctx=current();if(!ctx||ctx.p.id!==snapshot.projectId||ctx.d.id!==snapshot.draftId)throw Error('项目或页脚本已更新，请重新选择。');return ctx}
 function save(snapshot,body){
  if(!snapshot)return Promise.resolve()
  const operation={...snapshot},data=structuredClone(body)
  chain=chain.catch(()=>{}).then(async()=>{
   const ctx=assertTarget(operation)
   if(data.scope!=='global'&&!data.pageIds.length)throw Error('请至少选择一页。')
   saving=true;paint();setStatus('正在保存…')
   const latest=await request('/projects/'+ctx.p.id+'/layout-bindings')
   const result=await request('/projects/'+ctx.p.id+'/layout-bindings',{method:'POST',body:{requestId:uid(),baseRevision:ctx.p.revision,draftId:ctx.d.id,expectedRevision:latest.revision,scope:data.scope,
    ...(data.scope!=='global'?{pageIds:data.pageIds,remove:!!data.remove}:{}),resource:data.resource,overrides:data.overrides}})
   assertTarget(operation);config=await request('/projects/'+ctx.p.id+'/layout-bindings');loadNumber++;paint();setStatus(status())
   for(const node of nodeLayer.querySelectorAll('[data-canvas-layout]'))if(data.scope==='global'||data.pageIds.includes(node.dataset.layoutPage)){node.classList.add('just-saved');setTimeout(()=>node.classList.remove('just-saved'),800)}
   if(panel){
    const ref=target.pageId?effective().local?.[target.pageId]?.resource:effective().global
    panel.querySelectorAll('[data-pick-style]').forEach(b=>b.classList.toggle('selected',b.dataset.pickStyle===(ref?.resourceId??'')))
    await preview()
   }
   return result
  }).catch(error=>{setStatus(error.message);notify(error.message);throw error}).finally(()=>{saving=false;paint()})
  return chain
 }
 async function preview(){
  if(!panel||!target)return
  const ctx=assertTarget(target),pageId=target.pageId??pages()[0]?.id;if(!pageId)return
  const token=generation,box=panel.querySelector('[data-page-layout-preview]')
  const result=await request('/projects/'+ctx.p.id+'/layout-preview',{method:'POST',body:{draftId:ctx.d.id,pageId}})
  if(token!==generation||!box.isConnected)return
  previewHandle?.dispose();previewHandle=mountNativePreview(box,result.html)
 }
 async function apply(){
  try{const ctx=assertTarget(target),latest=ctx.p.workflow.visuals?.current,deck=latest&&!latest.stale&&latest.draftId===ctx.d.id?latest:null;await mutate('workflow/visuals',{draftId:ctx.d.id,...(deck?{baseVisualId:deck.id}:{}),applyLibrary:true,expectedBindingRevision:config.revision});await refresh();await load();setStatus(status())}catch(error){setStatus(error.message);notify(error.message)}
 }
 async function saveVariant(){
  try{
   const ctx=assertTarget(target),deck=ctx.p.workflow.visuals?.current,name=panel.querySelector('[data-variant-name]').value.trim()
   if(!name)throw Error('请填写版式名称。')
   const pageId=target.pageId??pages()[0].id
   const saved=await request('/projects/'+ctx.p.id+'/layout-save-page',{method:'POST',body:{requestId:uid(),visualId:deck.id,pageId,name}})
   notify('已保存到版式库');close();await openLibrary({resourceId:saved.id,version:saved.version})
  }catch(error){setStatus(error.message);notify(error.message)}
 }
 function clearDrag(){viewport.classList.remove('is-layout-dragging');nodeLayer.querySelectorAll('.is-layout-drop-target').forEach(n=>n.classList.remove('is-layout-drop-target'))}
 const dragover=event=>{
  if(!event.dataTransfer?.types.includes(mime))return
  const node=event.target.closest('[data-node-kind]'),button=node?.querySelector('[data-canvas-layout]');if(!button)return
  event.preventDefault();event.dataTransfer.dropEffect='copy';clearDrag();viewport.classList.add('is-layout-dragging');node.classList.add('is-layout-drop-target')
 }
 const drop=event=>{
  if(!event.dataTransfer?.types.includes(mime))return
  const node=event.target.closest('[data-node-kind]'),button=node?.querySelector('[data-canvas-layout]');if(!button)return
  event.preventDefault();event.stopPropagation();clearDrag()
  try{const resource=JSON.parse(event.dataTransfer.getData(mime)),ctx=current();if(!ctx)return;const pageId=button.dataset.layoutPage==='global'?null:button.dataset.layoutPage;void save({projectId:ctx.p.id,draftId:ctx.d.id,pageId},{scope:pageId?'local':'global',pageIds:pageId?[pageId]:[],resource,overrides:{}}).catch(()=>{})}catch(error){notify(error.message)}
 }
 const outside=event=>{if(panel&&!panel.contains(event.target)&&!event.target.closest('[data-canvas-layout]'))close()}
 const resize=()=>position()
 nodeLayer.addEventListener('dragover',dragover);nodeLayer.addEventListener('drop',drop);document.addEventListener('dragend',clearDrag);document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',resize)
 return {update,reset,dispose(){reset();nodeLayer.removeEventListener('dragover',dragover);nodeLayer.removeEventListener('drop',drop);document.removeEventListener('dragend',clearDrag);document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',resize)}}
}
