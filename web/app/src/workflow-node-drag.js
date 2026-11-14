import {positionWorkflowNode,updateWorkflowGraphGeometry} from './workflow-graph.js'

/** Right-button movement owns only the hit node. The camera and report order are untouched. */
export function mountGraphNodeDrag(viewport,{getLayout,getScale,board,nodeLayer,edgeLayer,onStart=()=>{},onCommit=()=>{},onContext=()=>{}}){
 const document=viewport.ownerDocument,view=document.defaultView
 let pending=null
 const paint=()=>updateWorkflowGraphGeometry(getLayout(),{board,nodeLayer,edgeLayer})
 const clearGuides=()=>edgeLayer.querySelectorAll('.workflow-align-guide').forEach(line=>line.remove())
 function guides(node){
  clearGuides()
  for(const axis of ['x','y']){
   const line=document.createElementNS('http://www.w3.org/2000/svg','line')
   line.setAttribute('class','workflow-align-guide')
   const vertical=axis==='x'
   line.setAttribute('x1',vertical?node.x:0);line.setAttribute('x2',vertical?node.x:getLayout().boardW)
   line.setAttribute('y1',vertical?0:node.y);line.setAttribute('y2',vertical?getLayout().boardH:node.y)
   edgeLayer.append(line)
  }
 }
 function down(event){
  if(event.button!==2||event.isPrimary===false||event.target.closest?.('button,a,input,textarea,select,[contenteditable=true]'))return
  const element=event.target.closest?.('[data-node-id],.edge-hit'),edgeId=element?.dataset.edgeId
  const node=edgeId?getLayout().edges.find(edge=>edge.id===edgeId)?.target:getLayout().rects.get(element?.dataset.nodeId)
  if(!node)return
  event.preventDefault();event.stopImmediatePropagation()
  pending={pointerId:event.pointerId,element,node,edgeId,startX:event.clientX,startY:event.clientY,x:node.x,y:node.y,scale:Math.max(.01,getScale()||1),moved:false}
  viewport.setPointerCapture?.(event.pointerId)
 }
 function move(event){
  if(!pending||pending.pointerId!==event.pointerId)return
  event.preventDefault();event.stopImmediatePropagation()
  if(!(event.buttons&2)){finish(event,true);return}
  if(!pending.moved&&Math.hypot(event.clientX-pending.startX,event.clientY-pending.startY)<5)return
  if(pending.edgeId){pending.moved=true;return}
  if(!pending.moved){pending.moved=true;onStart();viewport.classList.add('node-dragging');pending.element.classList.add('is-node-dragging')}
  const point={x:pending.x+(event.clientX-pending.startX)/pending.scale,y:pending.y+(event.clientY-pending.startY)/pending.scale}
  Object.assign(pending.node,positionWorkflowNode(getLayout(),pending.node.id,point,{avoid:false}));paint();guides(pending.node)
 }
 function finish(event,cancel=false){
  if(!pending||event.pointerId!=null&&event.pointerId!==pending.pointerId)return
  const current=pending;pending=null
  event.preventDefault?.();event.stopImmediatePropagation?.()
  const dragged=current.moved&&!current.edgeId
  if(dragged){
   Object.assign(current.node,cancel?{x:current.x,y:current.y}:positionWorkflowNode(getLayout(),current.node.id,current.node))
   paint()
  }
  clearGuides();viewport.classList.remove('node-dragging');current.element.classList.remove('is-node-dragging')
  if(viewport.hasPointerCapture?.(current.pointerId))viewport.releasePointerCapture(current.pointerId)
  if(dragged&&!cancel)onCommit(Object.fromEntries(getLayout().nodes.map(({id,x,y})=>[id,{x,y}])))
  if(!current.moved&&!cancel&&Math.hypot(event.clientX-current.startX,event.clientY-current.startY)<5)
   onContext(current.node,{x:current.startX,y:current.startY},current.element,current.edgeId)
 }
 const cancel=event=>finish(event,true),key=event=>{if(event.key==='Escape')cancel(event)}
 const context=event=>{if(pending||event.target.closest?.('[data-node-id],.edge-hit')){event.preventDefault();event.stopImmediatePropagation()}}
 const handlers={pointerdown:down,pointermove:move,pointerup:finish,pointercancel:cancel,lostpointercapture:cancel,contextmenu:context}
 for(const [type,handler] of Object.entries(handlers))viewport.addEventListener(type,handler,true)
 document.addEventListener('pointerup',finish,true);document.addEventListener('pointercancel',cancel,true);document.addEventListener('keydown',key,true);view?.addEventListener('blur',cancel)
 return {destroy(){
  cancel({});clearGuides()
  for(const [type,handler] of Object.entries(handlers))viewport.removeEventListener(type,handler,true)
  document.removeEventListener('pointerup',finish,true);document.removeEventListener('pointercancel',cancel,true);document.removeEventListener('keydown',key,true);view?.removeEventListener('blur',cancel)
 }}
}
