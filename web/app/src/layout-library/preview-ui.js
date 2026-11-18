export function mountNativePreview(container,html,{onSelect}={}){
 const document=container.ownerDocument,view=document.defaultView
 const parsed=new view.DOMParser().parseFromString(html,'text/html'),deck=parsed.querySelector('.native-deck')
 if(!deck)throw Error('版式预览缺少页面结构。')
 const canvas=deck.dataset.canvasWidth?deck:deck.querySelector('[data-canvas-width]')
 const validSize=(value,fallback)=>Number.isFinite(Number(value))&&Number(value)>=240&&Number(value)<=7680?Number(value):fallback
 const canvasWidth=validSize(canvas?.dataset.canvasWidth,1600),canvasHeight=validSize(canvas?.dataset.canvasHeight,900)
 container.style.aspectRatio=canvasWidth+' / '+canvasHeight
 const host=document.createElement('div');host.className='ll-preview-host'
 host.style.cssText='position:absolute;left:0;top:0;width:'+canvasWidth+'px;height:'+canvasHeight+'px;transform-origin:0 0'
 const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style')
 style.textContent=(parsed.querySelector('style')?.textContent??'')+(onSelect?'[data-layout-slot]{cursor:pointer}[data-layout-slot]:hover{outline:2px solid #7d9dd8}[data-layout-slot].is-selected{outline:3px solid #3454a0;outline-offset:3px}':'')
 const content=deck.cloneNode(true)
 content.querySelectorAll('script,iframe,object,embed,link').forEach(node=>node.remove())
 shadow.append(style,content);container.replaceChildren(host)
 if(onSelect)shadow.addEventListener('click',event=>{
  const slot=event.target.closest('[data-layout-slot]');if(!slot)return
  shadow.querySelectorAll('.is-selected').forEach(n=>n.classList.remove('is-selected'));slot.classList.add('is-selected')
  onSelect({layoutId:slot.closest('[data-layout]')?.dataset.layout,slot:slot.dataset.layoutSlot,...(slot.dataset.layoutSlotId||slot.dataset.slotId?{slotId:slot.dataset.layoutSlotId||slot.dataset.slotId}:{})})
 })
 let width=-1
 const fit=()=>{const next=container.clientWidth;if(next>0&&next!==width){width=next;host.style.transform='scale('+(next/canvasWidth)+')'}}
 fit()
 const observer=view.ResizeObserver?new view.ResizeObserver(fit):null
 observer?.observe(container);view.addEventListener('resize',fit)
 return {host,dispose(){observer?.disconnect();view.removeEventListener('resize',fit)}}
}

/** Check mounted, unscaled slot geometry. Metadata alone never proves content fit. */
export async function verifyNativePreviewFit(host,{signal}={}){
 const fail=message=>Object.assign(new Error(message),{code:'NATIVE_PREVIEW_FIT'})
 const abort=()=>Object.assign(new Error('预览检查已取消。'),{name:'AbortError'})
 if(signal?.aborted)throw abort()
 const doc=host?.ownerDocument,view=doc?.defaultView,root=host?.shadowRoot
 if(!root||!view||!host.isConnected)throw fail('预览页面尚未就绪，无法确认真实排版。')
 let stopped=false,timer,frame,rejectAbort
 const check=()=>{if(stopped||signal?.aborted)throw abort();if(!host.isConnected)throw fail('预览页面已关闭，请重新打开。')}
 const cancelled=new Promise((_,reject)=>{rejectAbort=()=>reject(abort());signal?.addEventListener('abort',rejectAbort,{once:true})})
 const timeout=new Promise((_,reject)=>{timer=view.setTimeout(()=>reject(fail('预览检查超时，请重试。')),10000)})
 const nextFrame=()=>new Promise(resolve=>{frame=view.requestAnimationFrame(()=>{frame=undefined;resolve()})})
 const inspect=async()=>{
  if(!doc.fonts?.ready)throw fail('字体未能加载，无法确认真实排版。')
  try{await doc.fonts.ready}catch{throw fail('字体未能加载，无法确认真实排版。')}
  check()
  if([...doc.fonts].some(font=>font.status==='error'))throw fail('字体未能加载，无法确认真实排版。')
  try{await Promise.all([...root.querySelectorAll('img')].map(async image=>{await image.decode();if(!image.naturalWidth||!image.naturalHeight)throw Error('empty image')}))}catch{throw fail('图片未能加载，无法确认真实排版。')}
  check();await nextFrame();check();await nextFrame();check()
  const slots=[...root.querySelectorAll('[data-layout-slot]')]
  if(!slots.length)throw fail('预览缺少可读内容区域，无法确认真实排版。')
  for(const slot of slots){
   const {clientWidth:w,clientHeight:h,scrollWidth:sw,scrollHeight:sh}=slot
   if(![w,h,sw,sh].every(Number.isFinite)||w<=0||h<=0)throw fail('版式内容区域没有可读尺寸，请调整版式后重试。')
   if(sw>w+2||sh>h+2)throw fail('文字或内容超出版式可读区域，请调整版式后重试。')
  }
 }
 try{await Promise.race([inspect(),cancelled,timeout])}
 finally{stopped=true;view.clearTimeout(timer);if(frame!==undefined)view.cancelAnimationFrame(frame);signal?.removeEventListener('abort',rejectAbort)}
}
