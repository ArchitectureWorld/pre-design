const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
const metrics={
 root:{minW:200,maxW:320,minH:80,inset:28,extraH:48,fontSize:13,lineHeight:20},
 chapter:{minW:216,maxW:448,minH:64,inset:66,extraH:42,fontSize:12,lineHeight:18},
 section:{minW:240,maxW:576,minH:60,inset:44,extraH:40,fontSize:12,lineHeight:18},
 script:{minW:320,maxW:320,minH:116,inset:28,extraH:120,fontSize:11,lineHeight:17},
 artifact:{minW:228,maxW:320,minH:84,inset:28,extraH:62,fontSize:11,lineHeight:17},
}

// Conservative font estimates keep layout independent of DOM size and resize events.
function estimateText(text,fontSize){
 return Array.from(text).reduce((width,char)=>width+fontSize*(/\s/u.test(char)?.4:/[ilI.,:;'!|]/u.test(char)?.4:/[MW@#%&]/u.test(char)?1:/[A-Z]/u.test(char)?.82:/[\x20-\x7e]/u.test(char)?.7:1.12),0)
}

function wrapTitle(title,width,measure){
 const lines=[]
 for(const paragraph of title.split('\n')){
  let line=''
  for(const character of Array.from(paragraph)){
   if(line&&measure(line+character)>width){lines.push(line);line=''}
   line+=character
  }
  lines.push(line)
 }
 return lines
}

function numberedTitle(number,title){
 return `${number?number+' ':''}${title??''}`
}

function scriptRecord(records,id){
 const record=records instanceof Map?records.get(id):records?.[id]
 if(!record||!String(record.body??'').trim())return null
 if(record.workflowDraft)return record
 return !record.outlineTask&&(record.proposalId||record.confirmed||record.payload||record.textGenerated===true)?record:null
}

function connection(source,target){
 const start={x:source.x+source.w,y:source.y+source.h/2},end={x:target.x,y:target.y+target.h/2}
 const middle=(start.x+end.x)/2,dy=end.y-start.y,direction=Math.sign(dy),corner=Math.min(9,Math.abs(dy)/2,(end.x-start.x)/4)
 const points=dy===0?[start,end]:[start,{x:middle-corner,y:start.y},{x:middle,y:start.y+corner*direction},{x:middle,y:end.y-corner*direction},{x:middle+corner,y:end.y},end]
 return {id:`${source.id}--${target.id}`,source,target,main:source.kind==='root',points,path:points.map((point,index)=>`${index?'L':'M'} ${point.x} ${point.y}`).join(' ')}
}

/** Pure, deterministic columns and rows. No element measurement or render recursion. */
export function layoutWorkflowGraph({chapters=[],records={},projectName='',measureText,positions={}}={}){
 const title=String(projectName||'项目')
 const groups=chapters.map((chapter,index)=>({
  chapter,index,sections:(chapter.sections??[]).map(section=>{
   const sectionTitle=numberedTitle(section.number,section.name),scripts=[]
   if(Array.isArray(section.scripts)){
    for(const entry of section.scripts){
     const record=entry.record??scriptRecord(records,entry.id)
     if(!entry.id||!String(record?.body??'').trim())continue
     const subdivided=section.scripts.length>1
     const scriptTitle=numberedTitle(subdivided?entry.number:section.number,subdivided?entry.title:section.name)
     const visual=entry.visual?.id&&entry.visual.itemId===entry.id?entry.visual:null
     const visualTitle=visual?numberedTitle(visual.number,visual.displayTitle??(subdivided?visual.item?.title??entry.title:section.name)):''
     scripts.push({id:entry.id,entry,record,scriptTitle,visual,visualTitle,subdivided})
    }
   }else{
    const id=section.script?.id,record=scriptRecord(records,id)
    if(record)scripts.push({id,entry:section,record,scriptTitle:sectionTitle+' · 文字脚本',legacy:true})
   }
   return {section,sectionTitle,scripts}
  })
 }))
 const sections=groups.flatMap(group=>group.sections),scripts=sections.flatMap(row=>row.scripts)
 const visuals=scripts.filter(script=>script.visual)
 const titles={
  root:[title],chapter:groups.map(group=>String(group.chapter.name??'')),
  section:sections.map(row=>row.sectionTitle),script:scripts.filter(script=>!script.legacy&&script.subdivided).map(script=>script.scriptTitle),
  artifact:visuals.map(script=>script.visualTitle),
 }
 const columns={},measures={},padding=32,columnGap=72,rowGap=22,chapterGap=42
 let x=padding
 for(const [kind,spec] of Object.entries(metrics)){
  const cache=new Map()
  const measure=text=>{
   if(!cache.has(text)){
    const measured=measureText?.(text,{kind,fontSize:spec.fontSize,fontWeight:kind==='section'?690:700})
    const width=typeof measured==='number'?measured:measured?.width
    cache.set(text,Number.isFinite(width)&&width>=0?width:estimateText(text,spec.fontSize))
   }
   return cache.get(text)
  }
  measures[kind]=measure
  const natural=Math.max(0,...titles[kind].flatMap(value=>value.split('\n').map(measure)))
  const w=Math.min(spec.maxW,Math.max(spec.minW,Math.ceil(natural+spec.inset))),titleWidth=w-spec.inset
  const lines=Math.max(0,...titles[kind].map(value=>wrapTitle(value,titleWidth,measure).length))
  const h=lines?Math.max(spec.minH,lines*spec.lineHeight+spec.extraH):spec.minH
  columns[kind]={x,w,h,titleWidth,lineHeight:spec.lineHeight}
  x+=w+columnGap
 }
 const nodes=[],edges=[],rects=new Map()
 const node=(kind,id,nodeTitle,y,extra={})=>{
  const size=columns[kind],result={id,kind,...size,y,title:nodeTitle,titleLines:extra.legacy?[]:wrapTitle(nodeTitle,size.titleWidth,measures[kind]),...extra}
  nodes.push(result);rects.set(id,result);return result
 }
 let nextY=padding
 const placements=groups.map(group=>{
  let sectionY=0
  let firstScriptCenter,lastScriptCenter
  const rows=group.sections.map(row=>{
   let nextScriptY=0
   const scripts=row.scripts.map(script=>{
    const h=Math.max(columns.script.h,script.visual?columns.artifact.h:0)
    const centerY=nextScriptY+h/2
    nextScriptY+=h+rowGap
    return {...script,centerY}
   })
   const scriptHeight=Math.max(0,nextScriptY-rowGap),h=Math.max(columns.section.h,scriptHeight)
   const scriptY=sectionY+(h-scriptHeight)/2
   if(scripts.length){
    firstScriptCenter??=scriptY+scripts[0].centerY
    lastScriptCenter=scriptY+scripts.at(-1).centerY
   }
   const placement={...row,scripts,y:sectionY,h,scriptY}
   sectionY+=h+rowGap
   return placement
  })
  const sectionHeight=Math.max(0,sectionY-rowGap)
  const chapterCenter=firstScriptCenter==null?sectionHeight/2:(firstScriptCenter+lastScriptCenter)/2
  const chapterTop=chapterCenter-columns.chapter.h/2,chapterBottom=chapterTop+columns.chapter.h
  const contentY=nextY-Math.min(0,chapterTop)
  const placement={...group,chapterY:contentY+chapterTop,rows,sectionY:contentY}
  nextY=contentY+Math.max(sectionHeight,chapterBottom)+chapterGap
  return placement
 })
 const contentBottom=placements.length?nextY-chapterGap:padding+columns.root.h
 const root=node('root','root',title,Math.max(padding,(padding+contentBottom-columns.root.h)/2))
 for(const group of placements){
  const {chapter,index}=group
  const scriptCount=group.rows.reduce((count,row)=>count+row.scripts.length,0)
  const chapterNode=node('chapter',chapter.id,String(chapter.name??''),group.chapterY,{chapter,index,scriptCount})
  edges.push(connection(root,chapterNode))
  for(const {section,sectionTitle,scripts,y,h,scriptY} of group.rows){
   const centerY=group.sectionY+y+h/2
   const sectionNode=node('section',section.id,sectionTitle,centerY-columns.section.h/2,{chapter,section})
   edges.push(connection(chapterNode,sectionNode))
   for(const {id,entry,record,scriptTitle,visual,visualTitle,legacy,subdivided,centerY:offsetY} of scripts){
    const scriptCenterY=group.sectionY+scriptY+offsetY
    const script=node('script',id,scriptTitle,scriptCenterY-columns.script.h/2,{chapter,section,entry,record,legacy,subdivided})
    edges.push(connection(sectionNode,script))
    if(visual){
     const page=node('artifact',visual.id,visualTitle,scriptCenterY-columns.artifact.h/2,{chapter,section,entry,visual})
     edges.push(connection(script,page))
    }
   }
  }
 }
 const result={nodes,edges,rects,root,columns,sectionCount:sections.length,scriptCount:scripts.length,visualCount:visuals.length}
 const defaults=new Map(nodes.map(item=>[item.id,{x:item.x,y:item.y}]))
 for(const item of nodes){
  const point=positions?.[item.id]
  if(point&&Number.isFinite(point.x)&&Number.isFinite(point.y)&&point.x>=32&&point.y>=32&&point.x<100000&&point.y<100000)Object.assign(item,{x:point.x,y:point.y})
 }
 // Restore the entire snapshot before validating relationships; never clamp a parent against a child's default position.
 const invalid=edges.some(edge=>edge.source.x+edge.source.w+32>edge.target.x)||nodes.some((item,index)=>nodes.slice(index+1).some(other=>item.x<other.x+other.w&&item.x+item.w>other.x&&item.y<other.y+other.h&&item.y+item.h>other.y))
 if(invalid)for(const item of nodes)Object.assign(item,defaults.get(item.id))
 refreshGeometry(result)
 return result
}

/** Grid and same-level alignment. Keep parents left of children and avoid occupied rectangles. */
export function positionWorkflowNode(layout,id,point,{avoid=true}={}){
 const node=layout.rects.get(id),grid=8,gap=16
 const incoming=layout.edges.filter(edge=>edge.target.id===id).map(edge=>edge.source)
 const outgoing=layout.edges.filter(edge=>edge.source.id===id).map(edge=>edge.target)
 const minX=Math.max(32,...incoming.map(parent=>parent.x+parent.w+32))
 const maxX=outgoing.length?Math.min(...outgoing.map(child=>child.x-node.w-32)):100000-node.w
 let x=Math.max(minX,Math.min(maxX,Math.round(point.x/grid)*grid)),y=Math.max(32,Math.round(point.y/grid)*grid)
 const peers=layout.nodes.filter(other=>other.id!==id&&other.kind===node.kind)
 const alignX=[layout.columns[node.kind].x,...peers.map(other=>other.x)].sort((a,b)=>Math.abs(a-x)-Math.abs(b-x))[0]
 if(Math.abs(alignX-x)<=12&&alignX>=minX&&alignX<=maxX)x=alignX
 const alignY=peers.flatMap(other=>[other.y,other.y+(other.h-node.h)/2,other.y+other.h-node.h]).sort((a,b)=>Math.abs(a-y)-Math.abs(b-y))[0]
 if(Math.abs(alignY-y)<=12&&alignY>=32)y=alignY
 const peersInLane=layout.nodes.filter(other=>other.id!==id&&x<other.x+other.w+gap&&x+node.w+gap>other.x)
 const free=top=>top>=32&&peersInLane.every(other=>top+node.h+gap<=other.y||top>=other.y+other.h+gap)
 if(avoid&&!free(y)){
  const candidates=[32,...peersInLane.flatMap(other=>[Math.floor((other.y-node.h-gap)/grid)*grid,Math.ceil((other.y+other.h+gap)/grid)*grid])]
  y=candidates.filter(free).sort((a,b)=>Math.abs(a-y)-Math.abs(b-y)||a-b)[0]??y
 }
 return {x,y}
}

function refreshGeometry(layout){
 layout.edges=layout.edges.map(edge=>connection(edge.source,edge.target))
 layout.boardW=Math.ceil(Math.max(...layout.nodes.map(item=>item.x+item.w))+32)
 layout.boardH=Math.ceil(Math.max(...layout.nodes.map(item=>item.y+item.h))+32)
}

export function updateWorkflowGraphGeometry(layout,{board,nodeLayer,edgeLayer}){
 refreshGeometry(layout)
 board.style.width=layout.boardW+'px';board.style.height=layout.boardH+'px'
 edgeLayer.setAttribute('width',layout.boardW);edgeLayer.setAttribute('height',layout.boardH);edgeLayer.setAttribute('viewBox',`0 0 ${layout.boardW} ${layout.boardH}`)
 for(const element of nodeLayer.querySelectorAll('[data-node-id]')){
  const node=layout.rects.get(element.dataset.nodeId)
  if(node){element.style.left=node.x+'px';element.style.top=node.y+'px'}
 }
 const edges=new Map(layout.edges.map(edge=>[edge.id,edge.path]))
 for(const path of edgeLayer.querySelectorAll('[data-edge-id]'))if(edges.has(path.dataset.edgeId))path.setAttribute('d',edges.get(path.dataset.edgeId))
}

function titleMarkup(node){return node.titleLines.map(line=>`<span class="workflow-graph-title-line">${escape(line)}</span>`).join('')}
function defaultScriptMarkup(item){
 const {section,record,legacy,subdivided}=item
 const excerpt=record.item?[...(record.item.paragraphs??[]),...(record.item.points??[])].join(' · '):record.body
 if(!legacy)return `<div class="script-top"><strong>文字脚本${subdivided?'':` <span>${escape(section.number)}</span>`}</strong><em class="script-status ${record.approved?'approved':'draft'}">${record.stale?'旧版初稿':record.approved?'已审阅':'待审阅'}</em></div>${subdivided?`<strong class="workflow-script-title">${titleMarkup(item)}</strong>`:''}<div class="script-excerpt">${escape(excerpt)}</div><div class="script-bottom">双击查看${subdivided?'本条':'本节'}内容 <span>↗</span></div>`
 return `<div class="script-top"><strong>文字脚本 <span>${escape(section.number)}</span></strong><em class="script-status ${record.approved?'approved':'draft'}">${record.stale?'旧版初稿':record.approved?'已审阅':'待审阅'}</em></div><div class="script-excerpt">${escape(record.body)}</div><div class="script-bottom">双击查看本节内容 <span>↗</span></div>`
}

/** Render into the accepted prototype layers; callers retain selection and reference state. */
export function renderWorkflowGraph({board,nodeLayer,edgeLayer,makeNode,renderScriptNode,onOpenScript,onOpenVisual,onSelectEdge,onSelectNode,...input}){
 const layout=layoutWorkflowGraph(input),document=nodeLayer.ownerDocument
 const classes={root:'rootnode',chapter:'chapnode',section:'sectionnode',script:'scriptnode',artifact:'artnode workflow-visual-node'}
 const colors=[['#e8eefa','#6185c8'],['#e3f1ed','#568f7e'],['#f0eaf8','#8d77b2'],['#f6eee2','#ae8b5e']]
 nodeLayer.replaceChildren();edgeLayer.replaceChildren();board.classList.add('workflow-graph-board')
 board.style.width=layout.boardW+'px';board.style.height=layout.boardH+'px'
 edgeLayer.setAttribute('width',layout.boardW);edgeLayer.setAttribute('height',layout.boardH);edgeLayer.setAttribute('viewBox',`0 0 ${layout.boardW} ${layout.boardH}`)
 for(const item of layout.nodes){
  let html
  if(item.kind==='root')html=`<div class="root-head">PRE—DESIGN / 项目</div><div class="root-name">${titleMarkup(item)}</div><div class="root-meta">${input.chapters?.length??0} 章 · ${layout.sectionCount} 节</div>`
  else if(item.kind==='chapter'){
   const [background,color]=colors[item.index%colors.length]
   html=`<div class="chap-num" style="--chap-bg:${background};--chap-clr:${color}">${String(item.index+1).padStart(2,'0')}</div><div class="chap-label"><strong>${titleMarkup(item)}</strong><span>${item.chapter.sections?.length??0} 节${item.scriptCount?` · ${item.scriptCount} 份脚本`:''}</span></div>`
  }else if(item.kind==='section')html=`<div class="sec-bullet"></div><div class="workflow-section-label"><div class="sec-main">${titleMarkup(item)}</div><div class="sec-info">大纲 · 章节标题</div></div>`
  else if(item.kind==='script')html=(item.legacy?renderScriptNode?.(item.section):renderScriptNode?.(item.entry,item.section,titleMarkup(item)))??defaultScriptMarkup(item)
  else html=`<div class="workflow-visual-label"><span class="art-fmt">HTML</span><span>汇报页</span></div><strong class="workflow-script-title">${titleMarkup(item)}</strong><div class="script-bottom">双击预览 <span>↗</span></div>`
  const element=makeNode?makeNode(classes[item.kind],item.id,item.x,item.y,html):document.createElement('div')
  if(!makeNode){
   element.className='mapnode '+classes[item.kind];element.innerHTML=html;element.tabIndex=0;element.setAttribute('role','button')
   element.addEventListener('click',event=>{event.stopPropagation();onSelectNode?.(item.id,event)})
   element.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelectNode?.(item.id,event)}})
  }
  element.dataset.nodeId=item.id;element.dataset.nodeKind=item.kind;element.title=item.title;element.setAttribute('aria-label',item.title)
  Object.assign(element.style,{left:item.x+'px',top:item.y+'px',width:item.w+'px',height:item.h+'px'})
  if(item.kind==='script'){
   if(item.record.workflowDraftId)element.dataset.workflowDraftId=item.record.workflowDraftId
   element.addEventListener('dblclick',event=>{
    event.stopPropagation()
    if(item.legacy)onOpenScript?.(item.section)
    else onOpenScript?.(item.entry,item.section)
   })
  }else if(item.kind==='artifact'){
   element.dataset.itemId=item.visual.itemId
   element.addEventListener('dblclick',event=>{event.stopPropagation();onOpenVisual?.(item.visual)})
  }
  nodeLayer.append(element)
 }
 for(const edge of layout.edges){
  const path=document.createElementNS('http://www.w3.org/2000/svg','path'),hit=document.createElementNS('http://www.w3.org/2000/svg','path')
  path.setAttribute('d',edge.path);path.setAttribute('class','edge'+(edge.main?' main':''));path.dataset.edgeId=edge.id
  hit.setAttribute('d',edge.path);hit.setAttribute('class','edge-hit');hit.dataset.edgeId=edge.id
  hit.addEventListener('click',event=>{
   event.stopPropagation();edgeLayer.querySelectorAll('.is-picked').forEach(selected=>selected.classList.remove('is-picked'));path.classList.add('is-picked');onSelectEdge?.(edge,event)
  })
  edgeLayer.append(path,hit)
 }
 return layout
}

/** Left-button and touch panning; right-button handling remains with the prototype. */
export function mountGraphPan(viewport,{getBoard,onTransform=()=>{},onPanStart=()=>{},onPanEnd=()=>{},threshold=5}){
 const controls='button,a,input,select,textarea,[contenteditable="true"],.node-picker,[data-graph-no-pan]'
 const document=viewport.ownerDocument,view=document.defaultView
 let pending=null,suppressUntil=0
 viewport.classList.add('workflow-graph-viewport')
 function down(event){
  if(event.button!==0||event.isPrimary===false)return
  suppressUntil=0
  if(event.target.closest?.(controls))return
  pending={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,dragging:false}
 }
 function move(event){
  if(!pending||pending.pointerId!==event.pointerId)return
  if(event.pointerType!=='touch'&&!(event.buttons&1)){end(event);return}
  if(!pending.dragging){
   if(Math.hypot(event.clientX-pending.startX,event.clientY-pending.startY)<threshold)return
   pending.dragging=true;viewport.classList.add('dragging');viewport.setPointerCapture?.(event.pointerId);onPanStart()
  }
  event.preventDefault();event.stopPropagation()
  const board=getBoard();board.x+=event.clientX-pending.x;board.y+=event.clientY-pending.y
  pending.x=event.clientX;pending.y=event.clientY;onTransform()
 }
 function end(event){
  if(!pending||event.pointerId!=null&&pending.pointerId!==event.pointerId)return
  const finished=pending;pending=null
  if(finished.dragging){
   suppressUntil=Date.now()+400;event.preventDefault();event.stopPropagation();viewport.classList.remove('dragging');onPanEnd()
   if(viewport.hasPointerCapture?.(finished.pointerId))viewport.releasePointerCapture(finished.pointerId)
  }
 }
 function click(event){if(event.detail!==0&&Date.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation()}}
 const handlers={pointerdown:down,pointermove:move,pointerup:end,pointercancel:end,lostpointercapture:end,click,dblclick:click}
 for(const [type,handler] of Object.entries(handlers))viewport.addEventListener(type,handler,true)
 document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',end,true);view?.addEventListener('blur',end)
 return {destroy(){
  if(pending&&viewport.hasPointerCapture?.(pending.pointerId))viewport.releasePointerCapture(pending.pointerId)
  pending=null;suppressUntil=0;viewport.classList.remove('workflow-graph-viewport','dragging')
  for(const [type,handler] of Object.entries(handlers))viewport.removeEventListener(type,handler,true)
  document.removeEventListener('pointerup',end,true);document.removeEventListener('pointercancel',end,true);view?.removeEventListener('blur',end)
 }}
}
