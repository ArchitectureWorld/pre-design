import {mountNativePreview} from './preview-ui.js'
export function mountLayoutMatrix(container,{layouts,renderPreview,onSelect=()=>{},onOpen=()=>{},selectedId,verifyRendered,onPreviewState=()=>{}}){
 const doc=container.ownerDocument,view=doc.defaultView,controller=new AbortController(),handles=[],queue=[];let disposed=false,running=0
 container.replaceChildren();container.classList.add('ll-layout-matrix')
 const select=id=>{for(const button of container.querySelectorAll('[data-layout-select]'))button.setAttribute('aria-pressed',String(button.dataset.layoutSelect===id));onSelect(id)}
 async function pump(){while(!disposed&&running<3&&queue.length){const {layout,box}=queue.shift();running++;void(async()=>{let handle;try{const result=await renderPreview(layout.id,{signal:controller.signal});if(disposed)return;handle=mountNativePreview(box,result.html);handles.push(handle);if(verifyRendered)await verifyRendered(handle.host,{signal:controller.signal});if(!disposed){box.removeAttribute('aria-busy');onPreviewState(layout.id,'passed')}}catch(error){handle?.dispose();if(!disposed){box.textContent=error?.message?'此版式暂不能展示当前内容：'+error.message:'预览暂不可用';box.setAttribute('role','status');box.removeAttribute('aria-busy');onPreviewState(layout.id,'failed')}}finally{running--;pump()}})()}}
 const observer=view.IntersectionObserver?new view.IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);queue.push(entry.target._preview);pump()}},{rootMargin:'300px'}):null
 for(const layout of layouts){onPreviewState(layout.id,'pending');const card=doc.createElement('article');card.className='ll-layout-card';card.dataset.layoutCard=layout.id
  const selectButton=doc.createElement('button');selectButton.type='button';selectButton.dataset.layoutSelect=layout.id;selectButton.setAttribute('aria-pressed',String(layout.id===selectedId));selectButton.setAttribute('aria-label','选择版式 '+layout.label)
  const box=doc.createElement('div');box.className='ll-preview ll-matrix-thumbnail';box.setAttribute('aria-busy','true');box.textContent='正在加载预览…';box.setAttribute('aria-hidden','true');selectButton.append(box)
  const label=doc.createElement('strong');label.textContent=layout.label;selectButton.append(label);selectButton.onclick=()=>select(layout.id)
  const open=doc.createElement('button');open.type='button';open.dataset.layoutOpen=layout.id;open.textContent='放大预览';open.setAttribute('aria-label','放大预览 '+layout.label);open.onclick=()=>onOpen(layout.id,open)
  card.ondblclick=event=>{if(!event.target.closest('[data-layout-open]'))onOpen(layout.id,selectButton)};card.append(selectButton,open);container.append(card)
  const item={layout,box};if(observer){card._preview=item;observer.observe(card)}else queue.push(item)
 }
 pump()
 return {select,dispose(){disposed=true;controller.abort();observer?.disconnect();queue.length=0;handles.forEach(h=>h.dispose());for(const card of container.children){card.ondblclick=null;for(const b of card.querySelectorAll('button'))b.onclick=null}}}
}

export function openLayoutPreview({document,layout,renderPreview,onSelect,onClose=()=>{},returnFocus,contextLabel,verifyRendered,onPreviewState=()=>{}}){
 const dialog=document.createElement('dialog');dialog.className='ll-large-preview';dialog.setAttribute('aria-label','放大预览 '+layout.label)
 const heading=document.createElement('h2');heading.textContent=layout.label
 const closeButton=document.createElement('button');closeButton.type='button';closeButton.textContent='关闭预览';closeButton.setAttribute('aria-label','关闭放大预览')
 const box=document.createElement('div');box.className='ll-preview';box.textContent='正在加载预览…';box.setAttribute('aria-busy','true');dialog.append(heading,closeButton);if(contextLabel){const context=document.createElement('p');context.dataset.previewContext='';context.textContent=contextLabel;dialog.append(context)}dialog.append(box);document.body.append(dialog)
 const controller=new AbortController();let disposed=false,handle
 function dispose(){if(disposed)return;disposed=true;controller.abort();handle?.dispose();dialog.close();dialog.remove();if(returnFocus?.isConnected)returnFocus.focus();onClose()}
 closeButton.onclick=dispose;dialog.oncancel=e=>{e.preventDefault();dispose()};dialog.showModal()
 const ready=Promise.resolve().then(()=>renderPreview(layout.id,{signal:controller.signal})).then(async result=>{if(disposed)return;handle=mountNativePreview(box,result.html,{onSelect});if(verifyRendered)await verifyRendered(handle.host,{signal:controller.signal});if(!disposed){box.removeAttribute('aria-busy');onPreviewState(layout.id,'passed')}}).catch(error=>{handle?.dispose();if(!disposed){onPreviewState(layout.id,'failed');box.textContent=error?.message?'此版式暂不能展示当前内容：'+error.message:'预览暂不可用，请关闭后重试。';box.removeAttribute('aria-busy')}})
 return {dispose,ready}
}
