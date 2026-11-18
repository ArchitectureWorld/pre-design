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
