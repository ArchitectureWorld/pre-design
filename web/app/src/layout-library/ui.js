const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const rid=()=>{const b=crypto.getRandomValues(new Uint8Array(16));return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')}
const stateName=r=>r.retired?'已下架':r.published?'已发布':r.shareRequested?'待管理员审查':r.validation?.status==='passed'?'检查通过，待发布':'候选草稿'
const visibility={private:'个人',shared:'共享',official:'官方'}
export function mountLayoutLibrary({request,getProject,notify,mutate,refresh=async()=>{}}){
 const button=document.createElement('button');button.type='button';button.className='ll-entry';button.textContent='版式库';button.dataset.layoutLibraryOpen=''
 document.querySelector('.top-right')?.prepend(button)
 let dialog,identity,resources=[],selected=null,working=null,busy=false,mode='library',ticket=0,pending=new Map(),observer
 const msg=t=>{const el=dialog?.querySelector('[data-ll-status]');if(el)el.textContent=t}
 function close(){ticket++;observer?.disconnect();dialog?.close();dialog?.remove();dialog=null;pending.clear()}
 async function run(fn){if(busy)return;busy=true;try{await fn()}catch(e){msg(e.message);notify(e.message)}finally{busy=false}}
 async function post(path,body={}){
  const key=JSON.stringify([path,body]);let id=pending.get(key);if(!id){id=rid();pending.set(key,id)}
  try{const r=await request(path,{method:'POST',body:{...body,requestId:id}});pending.delete(key);return r}catch(e){if(e.status>=400&&e.status<500)pending.delete(key);throw e}
 }
 async function reload(){resources=(await request('/layout-library')).resources;renderList()}
 async function open(){
  console.log('LL-OPEN-START');
  close();const generation=ticket;dialog=document.createElement('dialog');dialog.className='ll-dialog';dialog.dataset.layoutLibrary='';dialog.setAttribute('aria-label','版式资源库')
  dialog.innerHTML=`<header class="ll-head"><div><small>PRE—DESIGN · NATIVE LAYOUTS</small><h2>版式资源库</h2></div><nav><button data-mode="library">浏览与管理</button><button data-mode="project">当前项目应用</button><button data-mode="reference">参考文字提炼</button></nav><button data-close aria-label="关闭版式库">×</button></header><p class="ll-status" role="status" data-ll-status>正在连接平台…</p><div class="ll-main"><aside class="ll-sidebar"><div class="ll-tools"><input data-search type="search" placeholder="搜索名称、标签"><select data-filter><option value="all">全部可见资源</option><option value="mine">我的</option><option value="official">官方</option><option value="shared">共享</option></select><button data-new>新建原生版式</button><button data-seed hidden>预置3套官方候选</button><label class="ll-file">导入JSON / PPTX<input data-import type="file" accept=".json,.pptx" multiple hidden></label></div><div data-list class="ll-list"></div></aside><section class="ll-inspector" data-detail></section></div>`
  document.body.append(dialog);console.log('LL-DIALOG-APPENDED');dialog.showModal();console.log('LL-DIALOG-SHOWN');dialog.querySelector('[data-close]').onclick=close;dialog.oncancel=e=>{e.preventDefault();close()}
  dialog.querySelector('[data-search]').oninput=renderList;dialog.querySelector('[data-filter]').onchange=renderList
  dialog.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>void run(async()=>{mode=b.dataset.mode;renderMode()}))
  dialog.querySelector('[data-new]').onclick=()=>void run(async()=>{working=(await request('/layout-library/starter')).package;selected=null;mode='library';renderEditor();await preview()})
  dialog.querySelector('[data-import]').onchange=e=>void run(async()=>{
   const files=[...e.target.files];if(files.length>10)throw Error('每批最多导入10份参考文件。')
   for(const f of files){if(f.size>8*1024*1024)throw Error(f.name+'超过8 MiB。');const data=new Uint8Array(await f.arrayBuffer());let binary='';for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));const r=await post('/layout-library/import',{filename:f.name,content:btoa(binary)});await reload();await select(r.id,r.version)}
   msg('已保存为个人候选。请核对来源与适用性，再检查、发布。')
  })
  try{console.log('LL-GET-ME');identity=await request('/me');console.log('LL-ME-OK');dialog.querySelector('[data-seed]').hidden=identity.role!=='admin';dialog.querySelector('[data-seed]').onclick=()=>void run(async()=>{await post('/layout-library/seed');await reload();msg('已预置3套候选；检查并发布后才进入用户可用库。')});console.log('LL-RELOAD');await reload();console.log('LL-RELOAD-OK',resources.length);if(generation!==ticket)return;if(resources.length)await select(resources[0].id,resources[0].version);else{working=(await request('/layout-library/starter')).package;selected=null;renderEditor();await preview()};msg('已连接平台。预览、检查和项目制作使用同一原生渲染器。')}catch(e){msg(e.message)}
 }
 function renderList(){
  if(!dialog)return
  const q=dialog.querySelector('[data-search]').value.trim().toLowerCase(),filter=dialog.querySelector('[data-filter]').value
  const rows=resources.filter(r=>(filter==='all'||filter==='mine'&&r.ownerId===identity?.id||r.visibility===filter)&&(r.package.name+' '+r.package.tags.join(' ')).toLowerCase().includes(q))
  dialog.querySelector('[data-list]').innerHTML=rows.map(r=>`<button class="ll-card ${selected?.id===r.id?'selected':''}" data-id="${r.id}" data-version="${r.version}"><span class="ll-swatch" style="background:${r.package.theme.background};border-left:5px solid ${r.package.theme.accent};color:${r.package.theme.ink}">Aa <i style="background:${r.package.theme.accent}"></i></span><b>${esc(r.package.name)}</b><small>${visibility[r.visibility]} · V${r.version} · ${stateName(r)}</small><small>${r.package.layouts.length}种页面 · 已用于${r.usageCount??0}页 · HTML</small></button>`).join('')||'<p class="ll-hint">没有符合条件的资源。</p>'
  dialog.querySelectorAll('.ll-card').forEach(b=>b.onclick=()=>void run(()=>select(b.dataset.id,Number(b.dataset.version))))
 }
 async function select(id,version){selected=await request(`/layout-library/${id}/${version}`);working=structuredClone(selected.package);renderList();if(mode==='library'){renderEditor();await preview()}else renderMode()}
 function renderMode(){dialog.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));if(mode==='project')void showProject();else if(mode==='reference')void showReference();else{renderEditor();void preview()}}
 const detail=html=>{observer?.disconnect();dialog.querySelector('[data-detail]').innerHTML=html}
 function readForm(){
  const form=dialog.querySelector('[data-editor]');if(!form)return
  const advanced=form.querySelector('[data-json]');if(advanced.dataset.dirty==='true'){working=JSON.parse(advanced.value);advanced.dataset.dirty='false';return}
  working.name=form.elements.name.value.trim();working.theme.fontFamily=form.elements.fontFamily.value
  for(const k of ['background','ink','accent','muted'])working.theme[k]=form.elements[k].value
  for(const k of ['titleSize','bodySize','captionSize'])working.theme[k]=Number(form.elements[k].value)
  working.rights={basis:form.elements.basis.value,shareAllowed:form.elements.shareAllowed.checked,note:form.elements.rightsNote.value}
  working.tags=form.elements.tags.value.split(/[，,]/).map(t=>t.trim()).filter(Boolean)
 }
 function renderEditor(){
  if(!working){detail('<p>选择一个资源或新建原生版式。</p>');return}
  const owned=!selected||selected.ownerId===identity.id||identity.role==='admin',p=working
  detail(`<div class="ll-detail-head"><div><h3>${selected?'资源 V'+selected.version:'新建候选'}</h3><p>${selected?stateName(selected):'不需要创建项目，即可制作与预置。'}</p></div>${selected&&owned?`<select data-history aria-label="历史版本">${Array.from({length:selected.latestVersion},(_,i)=>`<option value="${i+1}" ${selected.version===i+1?'selected':''}>V${i+1}</option>`).join('')}</select>`:''}</div><div class="ll-edit-grid"><div class="ll-edit-controls"><form data-editor class="ll-form"><label class="wide">资源名称<input name="name" value="${esc(p.name)}" maxlength="100"></label><label class="wide">分类标签<input name="tags" value="${esc(p.tags.join('，'))}" placeholder="用逗号分开"></label>${[['background','背景'],['ink','正文'],['accent','标题强调'],['muted','注释']].map(([k,l])=>`<label>${l}<input type="color" name="${k}" value="${p.theme[k]}"></label>`).join('')}<label>字体风格<select name="fontFamily"><option value="sans" ${p.theme.fontFamily==='sans'?'selected':''}>无衬线 / 黑体</option><option value="serif" ${p.theme.fontFamily==='serif'?'selected':''}>衬线 / 宋体</option></select></label>${[['titleSize','标题字号'],['bodySize','正文字号'],['captionSize','注释字号']].map(([k,l])=>`<label>${l}<input type="number" name="${k}" value="${p.theme[k]}"></label>`).join('')}<label>使用依据<select name="basis">${[['original','原创'],['licensed','取得许可'],['permission','明确授权'],['unknown','待确认']].map(([k,l])=>`<option value="${k}" ${p.rights.basis===k?'selected':''}>${l}</option>`).join('')}</select></label><label><span>共享授权</span><span><input type="checkbox" name="shareAllowed" ${p.rights.shareAllowed?'checked':''}>允许作为共享版式</span></label><label class="wide">授权说明<input name="rightsNote" value="${esc(p.rights.note)}" maxlength="600"></label><details class="wide"><summary>高级：原生内容位置与资源JSON</summary><p class="ll-hint">使用平台同一契约；禁止自由HTML、脚本及外部资源。只改布局不改项目事实。</p><textarea data-json rows="12">${esc(JSON.stringify(p,null,2))}</textarea></details></form><div class="ll-actions"><select data-layout>${p.layouts.map(l=>`<option value="${esc(l.id)}">${esc(l.label)}</option>`).join('')}</select><button data-preview>试排当前设置</button><button data-save class="ll-primary">${owned?'保存新版本':'保存到我的库'}</button>${selected?'<button data-export>导出原生JSON</button>':''}</div></div><div class="ll-live-preview"><div class="ll-preview" data-preview-box></div><div class="ll-actions">${selected&&owned?`<button data-validate>实际页面检查</button><select data-visibility><option value="private">个人使用</option>${identity.role==='admin'?'<option value="official">官方预置</option><option value="shared">授权共享</option>':''}</select><label><input type="checkbox" data-reviewed>已核对参考与授权</label><button data-publish>发布此版本</button><button data-share>提交共享审查</button><button data-retire>下架</button>`:''}</div><p class="ll-hint">${esc(p.source.limitations.join('；'))}</p><pre class="ll-receipt">${esc(selected?.validation?JSON.stringify(selected.validation,null,2):'尚未进行本版本的浏览器检查。')}</pre></div></div>`)
  const form=dialog.querySelector('[data-editor]');form.onsubmit=e=>e.preventDefault();form.querySelector('[data-json]').oninput=e=>e.target.dataset.dirty='true'
  dialog.querySelector('[data-history]')?.addEventListener('change',e=>void run(()=>select(selected.id,Number(e.target.value))))
  dialog.querySelector('[data-preview]').onclick=()=>void run(async()=>{readForm();await preview()})
  dialog.querySelector('[data-layout]').onchange=()=>void run(async()=>{readForm();await preview()})
  dialog.querySelector('[data-save]').onclick=()=>void run(async()=>{readForm();const r=selected&&owned?await post(`/layout-library/${selected.id}/revisions`,{expectedVersion:selected.latestVersion,package:working}):await post('/layout-library',{package:working});await reload();await select(r.id,r.version);msg('已保存候选版本；尚未发布或改变项目成果。')})
  dialog.querySelector('[data-export]')?.addEventListener('click',()=>void run(async()=>download(await request(`/layout-library/${selected.id}/${selected.version}/export`,{download:true}))))
  dialog.querySelector('[data-validate]')?.addEventListener('click',()=>void run(async()=>{readForm();if(JSON.stringify(working)!==JSON.stringify(selected.package))throw Error('请先保存当前修改，再检查新版本。');msg('正在使用真实浏览器检查已保存版本…');const r=await request(`/layout-library/${selected.id}/${selected.version}/validate`,{method:'POST',body:{}});await reload();await select(selected.id,selected.version);msg(r.status==='passed'?'已保存版本检查通过；发布仍需核对授权。':'检查未通过，请查看问题记录。')}))
  dialog.querySelector('[data-publish]')?.addEventListener('click',()=>void run(async()=>{readForm();if(JSON.stringify(working)!==JSON.stringify(selected.package))throw Error('请先保存修改并检查新版本。');if(!dialog.querySelector('[data-reviewed]').checked)throw Error('请先核对参考适用性与授权。');await post(`/layout-library/${selected.id}/${selected.version}/publish`,{visibility:dialog.querySelector('[data-visibility]').value,reviewed:true});await reload();await select(selected.id,selected.version);msg('此版本已发布；旧项目不会自动升级。')}))
  dialog.querySelector('[data-share]')?.addEventListener('click',()=>void run(async()=>{await post(`/layout-library/${selected.id}/${selected.version}/request-share`);await reload();msg('共享申请已保存，管理员审查通过后才对其他用户可见。')}))
  dialog.querySelector('[data-retire]')?.addEventListener('click',()=>void run(async()=>{await post(`/layout-library/${selected.id}/retire`,{expectedVersion:selected.latestVersion});await reload();await select(selected.id,selected.version);msg('已下架；既有成果与已冻结绑定保留。')}))
 }
 function download(file){const u=URL.createObjectURL(file.blob),a=document.createElement('a');a.href=u;a.download=file.filename;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
 async function preview(){
  if(!dialog?.querySelector('[data-preview-box]')||!working)return
  const generation=ticket,r=await request('/layout-library/preview',{method:'POST',body:{package:working,layoutId:dialog.querySelector('[data-layout]').value}})
  if(generation!==ticket||!dialog?.querySelector('[data-preview-box]'))return
  const box=dialog.querySelector('[data-preview-box]');box.innerHTML='<iframe title="原生版式实际试排" sandbox=""></iframe>';const frame=box.querySelector('iframe');frame.srcdoc=r.html
  const fit=()=>{frame.style.transform=`scale(${box.clientWidth/1640})`};frame.style.width='1640px';frame.style.height='940px';observer?.disconnect();observer=new ResizeObserver(fit);observer.observe(box);fit()
 }
 async function showProject(){
  const p=getProject();if(!p?.id){detail('<h3>当前没有打开项目</h3><p>可以先在“浏览与管理”中准备版式，再进入项目选用。</p>');return}
  const projectId=p.id,config=await request(`/projects/${p.id}/layout-bindings`),draft=p.workflow?.current,deck=p.workflow?.visuals?.current
  if(!dialog||mode!=='project')return
  if(!draft){detail('<h3>本项目尚未形成页脚本</h3><p>版式制作不受影响；项目绑定需要先有可定位的页脚本。</p>');return}
  const pages=draft.blocks.flatMap(b=>(b.items??[]).map(i=>({id:'visual-page-'+i.id,title:i.title})))
  detail(`<h3>${esc(p.name)} · 版式应用</h3><p class="ll-hint">配置 V${config.revision} · ${config.status==='applied'?'成果已应用':'已保存，待重排'}${config.stale?' · 绑定属于旧稿':''}</p><p>当前全局：${esc(config.global?.package?.name??'平台默认')}。左侧选择资源后，可绑定全局或指定页面。</p><div class="ll-binding"><label>作用范围<select data-scope><option value="global">整套成果</option><option value="local">选定页面（局部）</option><option value="manual">选定页面（保护人工修改）</option></select></label><label>版式资源<select data-resource><option value="">继承 / 平台默认</option>${resources.filter(r=>r.publishedVersion&&!r.retired).map(r=>`<option value="${r.id}|${r.publishedVersion}" ${r.id===selected?.id?'selected':''}>${esc(r.package.name)} · 已发布V${r.publishedVersion}</option>`).join('')}</select></label><label>页面布局<select data-local-layout><option value="">自动适配内容</option><option value="points">要点</option><option value="columns">双栏</option><option value="focus">重点</option><option value="image-left">左图右文（需要图片）</option><option value="table">比较表（需要表格）</option></select></label><label>标题强调色（可留空）<input data-local-color placeholder="#123456" maxlength="7"></label></div><div class="ll-pages">${pages.map(page=>`<label><input type="checkbox" value="${page.id}">${esc(page.title)} <small>${config.manual[page.id]?'人工保护 ':''}${config.local[page.id]?'局部绑定':'继承全局'}</small></label>`).join('')}</div><div class="ll-actions"><button data-bind>保存版式配置</button><button data-remove>移除选定覆盖</button><button data-apply class="ll-primary">按当前配置重排成果</button></div><p class="ll-hint">保存不等于应用。整稿确认后才能生成；超界或素材不足会阻断生成，原成果保留。新的自然语言批注不会自动成为生效覆盖。</p>${deck&&!deck.stale?`<h4>从实际成果积累版式</h4><select data-save-page>${deck.pages.map(page=>`<option value="${page.id}">${esc(page.item.title)}</option>`).join('')}</select><input data-variant-name placeholder="给这个可复用版式命名"><button data-variant>仅保存布局规则到个人库</button>`:''}`)
  const check=()=>{if(getProject()?.id!==projectId||getProject()?.workflow?.current?.id!==draft.id)throw Error('项目或稿件已经改变，请重新打开版式应用。')}
  const save=async remove=>{
   check();const scope=dialog.querySelector('[data-scope]').value,pageIds=[...dialog.querySelectorAll('.ll-pages input:checked')].map(x=>x.value),value=dialog.querySelector('[data-resource]').value,[resourceId,version]=value.split('|'),layoutId=dialog.querySelector('[data-local-layout]').value,accent=dialog.querySelector('[data-local-color]').value.trim()
   if(scope!=='global'&&!pageIds.length)throw Error('请至少选择一页。')
   await post(`/projects/${projectId}/layout-bindings`,{baseRevision:getProject().revision,draftId:draft.id,expectedRevision:config.revision,scope,...(scope!=='global'?{pageIds,remove}:{}),resource:remove||!value?null:{resourceId,version:Number(version)},overrides:{...(layoutId?{layoutId}:{}),...(accent?{theme:{accent}}:{})}})
   await showProject();msg('配置已保存；点击重排才改变成果。')
  }
  dialog.querySelector('[data-bind]').onclick=()=>void run(()=>save(false));dialog.querySelector('[data-remove]').onclick=()=>void run(()=>save(true))
  dialog.querySelector('[data-apply]').onclick=()=>void run(async()=>{check();const latest=await request(`/projects/${projectId}/layout-bindings`);await mutate('workflow/visuals',{draftId:draft.id,...(deck?{baseVisualId:deck.id}:{}),applyLibrary:true,expectedBindingRevision:latest.revision});await refresh();await showProject();msg('新成果已生成并通过实际页面检查，原成果版本保留。')})
  dialog.querySelector('[data-variant]')?.addEventListener('click',()=>void run(async()=>{check();const name=dialog.querySelector('[data-variant-name]').value.trim();if(!name)throw Error('请填写版式名称。');const r=await post(`/projects/${projectId}/layout-save-page`,{visualId:deck.id,pageId:dialog.querySelector('[data-save-page]').value,name});await reload();mode='library';await select(r.id,r.version);msg('已保存纯版式候选，不含本项目正文或图片。')}))
 }
 async function showReference(){
  detail(`<h3>V14 · 在项目任务外提炼参考文字</h3><p>复用管理员配置的DSH模型、任务队列和额度。只生成个人候选，不自动发布，也不读取任何项目。</p><label>候选名称<input data-ref-name placeholder="例如：浅色城市更新汇报"></label><label>设计要求或参考文字<textarea data-ref-text rows="7" placeholder="描述希望沿用的配色、标题、留白、图文组织等。纯文字无法恢复未提供的视觉页面。"></textarea></label><label><input data-allow-model type="checkbox">允许本次实际模型调用</label><div class="ll-actions"><button data-ref-run class="ll-primary">提交参考提炼</button><button data-ref-refresh>刷新执行记录</button></div><div data-ref-jobs></div>`)
  const jobs=async()=>{const rows=await request('/layout-library/reference-jobs');if(!dialog||mode!=='reference')return;dialog.querySelector('[data-ref-jobs]').innerHTML=rows.map(j=>`<div class="ll-job"><b>${esc(j.status)}</b> ${esc(j.error??'')} ${j.result?.id?`<button data-result="${j.result.id}" data-v="${j.result.version}">打开候选</button>`:''}${['queued','running','cancelling'].includes(j.status)?`<button data-cancel-job="${j.id}">取消</button>`:''}<small>${esc(j.id)}</small></div>`).join('')||'<p class="ll-hint">尚无参考提炼任务。</p>';dialog.querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>void run(async()=>{await reload();mode='library';await select(b.dataset.result,Number(b.dataset.v))}));dialog.querySelectorAll('[data-cancel-job]').forEach(b=>b.onclick=()=>void run(async()=>{await request(`/layout-library/reference-jobs/${b.dataset.cancelJob}/cancel`,{method:'POST',body:{}});await jobs()}))}
  dialog.querySelector('[data-ref-run]').onclick=()=>void run(async()=>{if(!dialog.querySelector('[data-allow-model]').checked)throw Error('请明确允许本次模型调用。');await post('/layout-library/reference-jobs',{name:dialog.querySelector('[data-ref-name]').value,text:dialog.querySelector('[data-ref-text]').value,allowModel:true});await jobs();msg('任务已入现有后台队列；关闭此窗口不影响任务，取消请使用取消按钮。')})
  dialog.querySelector('[data-ref-refresh]').onclick=()=>void run(jobs);await jobs()
 }
 button.onclick=()=>{console.log('LL-CLICK');void run(open)}
 return {open,reset:close,dispose(){close();button.remove()}}
}
