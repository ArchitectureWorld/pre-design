// Drag feedback is a preview only. The selection changes once, on a valid drop.
export function locateFlowDrop(nodes,point,dragged){
 if(!nodes.length)return {before:null,index:0,anchor:null,edge:'left'}
 // Choose the nearest stable cell in two dimensions, then follow that row's arrow.
 const distance=n=>Math.max(n.left-point.x,0,point.x-n.right)**2+Math.max(n.top-point.y,0,point.y-n.bottom)**2
 const nearest=nodes.reduce((best,node)=>distance(node)<distance(best)?node:best,nodes[0])
 const vertical=nearest.axis==='y'
 const leading=vertical?point.y<(nearest.top+nearest.bottom)/2:nearest.direction===1?point.x<(nearest.left+nearest.right)/2:point.x>(nearest.left+nearest.right)/2
 const offset=nodes.indexOf(nearest)+(leading?0:1)
 const before=nodes.slice(offset).find(n=>n.id!==dragged)?.id??null
 const remaining=nodes.filter(n=>n.id!==dragged)
 return {before,index:before?remaining.findIndex(n=>n.id===before):remaining.length,anchor:nearest.id,edge:vertical?(leading?'top':'bottom'):(leading?nearest.direction===1:nearest.direction!==1)?'left':'right'}
}
export function mountOutlineDrag(host,{selected,busy,allowedIds,onMove,onRemove}){
 let dragged=null,target=null,dragY=0,frame
 const status=host.querySelector('[data-flow-drag-status]')
 const indicator=host.querySelector('[data-flow-drop-indicator]')
 function clearPreview(){target=null;for(const el of host.querySelectorAll('.is-drop-target,.is-drop-shift'))el.classList.remove('is-drop-target','is-drop-shift');if(indicator)indicator.hidden=true}
 function outside(event){if(!host.isConnected){finish();return}if(!host.contains(event.target)||!event.target.closest('[data-flow-zone]')){clearPreview();if(status)status.textContent=''}}
 function finish(){document.removeEventListener('dragover',outside,true);document.removeEventListener('dragend',finish,true);clearPreview();dragged=null;cancelAnimationFrame(frame);host.classList.remove('is-flow-dragging');for(const el of host.querySelectorAll('.is-dragging'))el.classList.remove('is-dragging');if(status)status.textContent=''}
 function scroll(){if(!dragged||!host.isConnected)return;const viewport=host.closest('#consultStream');if(viewport){const r=viewport.getBoundingClientRect();if(dragY<r.top+28)viewport.scrollTop-=12;else if(dragY>r.bottom-28)viewport.scrollTop+=12}frame=requestAnimationFrame(scroll)}
 function preview(event){
  dragY=event.clientY
  const zone=event.target.closest('[data-flow-zone]');if(!zone||!host.contains(zone)){clearPreview();return}
  event.preventDefault();event.dataTransfer.dropEffect='move';clearPreview();zone.classList.add('is-drop-target')
  if(zone.dataset.flowZone==='library'){target={zone:'library'};if(status)status.textContent=selected.includes(dragged)?'松开移到备用':'已在备用区';return}
  const steps=[...zone.querySelectorAll('.flow-step')]
  const vertical=zone.querySelector('.flow-track').style.getPropertyValue('--flow-columns')==='1'
  const nodes=steps.map(el=>{const r=el.getBoundingClientRect();return {id:el.querySelector('[data-flow-node]').dataset.flowNode,left:r.left,right:r.right,top:r.top,bottom:r.bottom,direction:Number(el.dataset.flowDirection),axis:vertical?'y':'x'}})
  const end=event.target.closest('[data-flow-end]')
  const slot=end?{before:null,index:selected.filter(id=>id!==dragged).length}:locateFlowDrop(nodes,{x:event.clientX,y:event.clientY},dragged)
  const {before,index}=slot
  target={zone:'selected',before}
  const label=`松开${selected.includes(dragged)?'移至':'加入'}第 ${index+1} 位`
  if(status)status.textContent=label
  const track=zone.querySelector('.flow-track'),bounds=track.getBoundingClientRect()
  const anchor=steps.find(el=>el.querySelector('[data-flow-node]').dataset.flowNode===slot.anchor),r=(anchor??track.querySelector('[data-flow-end]')).getBoundingClientRect()
  indicator.style.top=`${(vertical?(slot.edge==='bottom'?r.bottom+9:r.top-12):r.top)-bounds.top}px`;indicator.style.left=`${(vertical?r.left:slot.edge==='right'?r.right+5:r.left-7)-bounds.left}px`;indicator.style.height=`${vertical?3:r.height}px`;indicator.style.width=`${vertical?r.width:3}px`;indicator.textContent=label;indicator.hidden=false
  if(anchor){anchor.style.setProperty('--shift-x',`${vertical?0:slot.edge==='right'?-4:4}px`);anchor.style.setProperty('--shift-y',`${vertical?(slot.edge==='bottom'?-4:4):0}px`);anchor.classList.add('is-drop-shift')}
 }
 host.ondragstart=event=>{
  const node=event.target.closest('[data-flow-node]');if(!node||busy){event.preventDefault();return}
  dragged=node.dataset.flowNode;dragY=event.clientY;event.dataTransfer.setData('text/x-pre-outline-chapter',dragged);event.dataTransfer.effectAllowed='move'
  document.addEventListener('dragover',outside,true);document.addEventListener('dragend',finish,true);node.classList.add('is-dragging');host.classList.add('is-flow-dragging');frame=requestAnimationFrame(scroll)
 }
 host.ondragenter=event=>{if(dragged&&!busy&&event.target.closest('[data-flow-zone]'))event.preventDefault()}
 host.ondragover=event=>{if(dragged&&!busy)preview(event)}
 host.ondragend=finish
 host.ondrop=event=>{
  if(!dragged||busy||!allowedIds.includes(dragged))return
  preview(event);if(!target){finish();return}event.preventDefault();event.stopPropagation()
  const id=dragged,destination=target;finish()
  if(destination.zone==='library')onRemove(id);else onMove(id,destination.before)
 }
 return finish
}
