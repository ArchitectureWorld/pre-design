import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'

const graph=await import('../src/workflow-graph.js').catch(()=>({}))

function fixture(counts=[3,3,3,3,3]){
 const records={}
 const chapters=counts.map((count,c)=>({id:`chapter-${c+1}`,name:`第${c+1}章项目研究`,sections:Array.from({length:count},(_,s)=>{
  const id=`outline-${c+1}-${s+1}`
  records[id]={id,outlineTask:true,workflowDraft:true,workflowDraftId:'draft-1',body:`本节真实生成的正文 ${c+1}.${s+1}。`,generated:false}
  return {id:`section-${c+1}-${s+1}`,number:`${c+1}.${s+1}`,name:`项目条件与需求${s+1}`,script:{id},artifact:{id:`page-${c+1}-${s+1}`,visual:'text',generated:true,record:records[id]}}
 })}))
 return {chapters,records,projectName:'少潭河水库'}
}

function layout(input){assert.equal(typeof graph.layoutWorkflowGraph,'function');return graph.layoutWorkflowGraph(input)}
const center=node=>node.y+node.h/2
const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y

test('五章各三节顺序排列，5.3位于第五章范围内，所有图块均在画布内且不重叠',()=>{
 const result=layout(fixture())
 assert.equal(result.nodes.length,36)
 assert.equal(result.sectionCount,15)
 assert.equal(result.scriptCount,15)
 const sections=result.nodes.filter(node=>node.kind==='section')
 assert.deepEqual(sections.map(node=>node.section.number),['1.1','1.2','1.3','2.1','2.2','2.3','3.1','3.2','3.3','4.1','4.2','4.3','5.1','5.2','5.3'])
 for(let i=1;i<sections.length;i++)assert.ok(sections[i].y>=sections[i-1].y+sections[i-1].h+12)
 for(let c=1;c<=5;c++){
  const chapter=result.rects.get(`chapter-${c}`),first=result.rects.get(`section-${c}-1`),last=result.rects.get(`section-${c}-3`)
  assert.ok(center(chapter)>=center(first)&&center(chapter)<=center(last))
 }
 for(const [index,node] of result.nodes.entries()){
  for(const key of ['x','y','w','h'])assert.ok(Number.isFinite(node[key]),`${node.id}.${key}`)
  assert.ok(node.x>=0&&node.y>=0&&node.x+node.w<=result.boardW&&node.y+node.h<=result.boardH)
  for(const other of result.nodes.slice(index+1))assert.equal(overlaps(node,other),false,`${node.id} 与 ${other.id} 重叠`)
 }
 for(const section of sections)assert.equal(center(section),center(result.rects.get(section.section.script.id)))
})

test('每章节数不同或为空时仍累计排布，重复计算稳定且不修改输入',()=>{
 const input=fixture([1,5,0,3]),before=structuredClone(input),result=layout(input)
 assert.equal(result.sectionCount,9)
 assert.equal(result.nodes.length,23)
 assert.ok(result.rects.get('chapter-3').y>result.rects.get('section-2-5').y)
 assert.ok(result.rects.get('section-4-1').y>result.rects.get('chapter-3').y)
 assert.deepEqual(layout(input),result)
 assert.deepEqual(input,before)
 const empty=layout({chapters:[],records:{},projectName:'新项目'})
 assert.equal(empty.nodes.length,1)
 assert.equal(empty.edges.length,0)
 assert.ok(Number.isFinite(empty.boardW)&&Number.isFinite(empty.boardH))
})

test('只有真实正文出现脚本，待生成任务及可视化均无占位节点或连线',()=>{
 const input=fixture([5]),ids=input.chapters[0].sections.map(section=>section.script.id)
 input.records[ids[0]]={id:ids[0],outlineTask:true,generated:true,body:'任务安排并非生成正文'}
 input.records[ids[1]].body=' \n '
 delete input.records[ids[2]]
 input.records[ids[3]]={id:ids[3],proposalId:'proposal-1',body:'Agent 生成的专业提案正文。'}
 const result=layout(input)
 assert.deepEqual(result.nodes.filter(node=>node.kind==='script').map(node=>node.id),[ids[3],ids[4]])
 assert.equal(result.nodes.some(node=>node.kind==='artifact'||node.id.startsWith('page-')),false)
 assert.equal(result.edges.length,result.nodes.length-1)
 const blank=layout({...input,records:{}})
 assert.equal(blank.scriptCount,0)
 assert.ok(blank.boardW<result.boardW,'未生成时画布不预留脚本空列')
})

test('完整长标题自动换行，同层同宽，测量回调得到的宽度不会溢出图块',()=>{
 const input=fixture([3,2])
 input.projectName='非常长的完整项目名称'.repeat(12)
 input.chapters[1].name='综合开发和生态保护项目现状与需求以及社会经济发展研究'.repeat(8)
 input.chapters[0].sections[2].name='评估水库及周边区域现状、需求与提升方向（含防洪、水资源、生态和产业）'.repeat(10)
 const result=layout({...input,measureText:text=>Array.from(text).length*13})
 for(const kind of ['root','chapter','section','script']){
  const nodes=result.nodes.filter(node=>node.kind===kind)
  assert.equal(new Set(nodes.map(node=>node.x)).size,1)
  assert.equal(new Set(nodes.map(node=>node.w)).size,1)
  for(const node of nodes.filter(node=>node.kind!=='script')){
   assert.equal(node.titleLines.join(''),node.title)
   assert.ok(node.titleLines.every(line=>Array.from(line).length*13<=node.titleWidth))
   assert.ok(node.h>=node.titleLines.length*node.lineHeight+20)
  }
 }
 assert.ok(result.rects.get('chapter-2').titleLines.length>1)
 assert.ok(result.rects.get('section-1-3').titleLines.length>1)
 assert.equal(result.rects.get('section-1-3').title,'1.3 '+input.chapters[0].sections[2].name)
})

test('分层连线只使用直线和倒角，连接端点准确，沿途不会穿入其他图块',()=>{
 const input=fixture([2,5,1,4]),result=layout(input)
 for(const edge of result.edges){
  assert.match(edge.path,/^M /)
  assert.doesNotMatch(edge.path,/[CQSTA]/i)
  assert.ok(edge.points.length>=2)
  assert.deepEqual(edge.points[0],{x:edge.source.x+edge.source.w,y:center(edge.source)})
  assert.deepEqual(edge.points.at(-1),{x:edge.target.x,y:center(edge.target)})
  for(let i=1;i<edge.points.length;i++){
   const from=edge.points[i-1],to=edge.points[i]
   for(let sample=1;sample<30;sample++){
    const x=from.x+(to.x-from.x)*sample/30,y=from.y+(to.y-from.y)*sample/30
    for(const node of result.nodes)assert.equal(x>node.x&&x<node.x+node.w&&y>node.y&&y<node.y+node.h,false,`${edge.id} 穿过 ${node.id}`)
   }
  }
 }
})

test('渲染完整标题且不执行标题HTML，真实脚本保留预览与连线选择，重绘不残留旧节点',()=>{
 assert.equal(typeof graph.renderWorkflowGraph,'function')
 const dom=new JSDOM('<div id="board"><svg id="edges"></svg><div id="nodes"></div></div>')
 try{
  const document=dom.window.document,input=fixture([3]),opened=[],selected=[]
  input.chapters[0].name='<img src=x onerror=bad()>完整章节名称'
  delete input.records['outline-1-2']
  const context={...input,board:document.querySelector('#board'),nodeLayer:document.querySelector('#nodes'),edgeLayer:document.querySelector('#edges'),onOpenScript:section=>opened.push(section.script.id),onSelectEdge:edge=>selected.push(edge.id)}
  const result=graph.renderWorkflowGraph(context)
  assert.equal(document.querySelectorAll('.scriptnode').length,2)
  assert.equal(document.querySelectorAll('.artnode,.locked,img').length,0)
  assert.equal(document.querySelector('.chap-label strong').textContent,input.chapters[0].name)
  assert.equal(document.querySelector('#board').style.height,`${result.boardH}px`)
  document.querySelector('[data-node-id="outline-1-1"]').dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true}))
  assert.deepEqual(opened,['outline-1-1'])
  document.querySelector('.edge-hit').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}))
  assert.equal(selected.length,1)
  graph.renderWorkflowGraph({...context,records:{}})
  assert.equal(document.querySelectorAll('.scriptnode,.artnode').length,0)
  assert.equal(document.querySelectorAll('.edge-hit').length,4)
 }finally{dom.window.close()}
})

function pointer(window,target,type,x,y,options={}){
 const event=new window.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1,...options})
 Object.defineProperties(event,{pointerId:{value:options.pointerId??1},pointerType:{value:options.pointerType??'mouse'},isPrimary:{value:true}})
 target.dispatchEvent(event)
 return event
}

test('左键按压超过阈值才平移，拖动结束不误选或引用，普通单击和按钮仍可用',()=>{
 assert.equal(typeof graph.mountGraphPan,'function')
 const dom=new JSDOM('<div id="viewport"><div class="mapnode" role="button">章节</div><button>添加批注</button></div>')
 try{
  const document=dom.window.document,viewport=document.querySelector('#viewport'),node=document.querySelector('.mapnode'),button=document.querySelector('button'),board={x:10,y:20,scale:.48}
  let selected=0,referenced=0,started=0,transformed=0
  node.addEventListener('click',()=>selected++);button.addEventListener('click',()=>referenced++)
  const pan=graph.mountGraphPan(viewport,{getBoard:()=>board,onTransform:()=>transformed++,onPanStart:()=>started++,threshold:5})
  pointer(dom.window,node,'pointerdown',100,100);pointer(dom.window,node,'pointermove',103,100);pointer(dom.window,node,'pointerup',103,100)
  node.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,detail:1}))
  assert.equal(selected,1);assert.deepEqual(board,{x:10,y:20,scale:.48});assert.equal(started,0)
  pointer(dom.window,node,'pointerdown',100,100);pointer(dom.window,viewport,'pointermove',140,160);pointer(dom.window,viewport,'pointerup',140,160)
  node.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}))
  assert.equal(selected,1);assert.deepEqual(board,{x:50,y:80,scale:.48});assert.equal(started,1);assert.equal(transformed,1)
  assert.equal(viewport.classList.contains('dragging'),false)
  pointer(dom.window,button,'pointerdown',100,100);pointer(dom.window,button,'pointermove',160,180);pointer(dom.window,button,'pointerup',160,180)
  button.click();assert.equal(referenced,1);assert.deepEqual(board,{x:50,y:80,scale:.48})
  pointer(dom.window,node,'pointerdown',100,100);pointer(dom.window,node,'pointerup',100,100)
  node.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,detail:1}));assert.equal(selected,2)
  pan.destroy()
  pointer(dom.window,node,'pointerdown',100,100);pointer(dom.window,node,'pointermove',180,190);pointer(dom.window,node,'pointerup',180,190)
  assert.deepEqual(board,{x:50,y:80,scale:.48})
 }finally{dom.window.close()}
})

test('移动设备能拖动大画布，右键事件保持交给原有平移处理',()=>{
 assert.equal(typeof graph.mountGraphPan,'function')
 const dom=new JSDOM('<div id="viewport"></div>')
 try{
  const viewport=dom.window.document.querySelector('#viewport'),board={x:0,y:0,scale:1};let rightDown=0
  viewport.addEventListener('pointerdown',event=>{if(event.button===2)rightDown++})
  const pan=graph.mountGraphPan(viewport,{getBoard:()=>board,onTransform:()=>{}})
  pointer(dom.window,viewport,'pointerdown',250,300,{pointerType:'touch'})
  pointer(dom.window,viewport,'pointermove',50,70,{pointerType:'touch'})
  pointer(dom.window,viewport,'pointerup',50,70,{pointerType:'touch'})
  assert.deepEqual(board,{x:-200,y:-230,scale:1})
  const right=pointer(dom.window,viewport,'pointerdown',40,40,{button:2,buttons:2})
  pointer(dom.window,viewport,'pointermove',100,100,{button:2,buttons:2});pointer(dom.window,viewport,'pointerup',100,100,{button:2,buttons:0})
  assert.equal(rightDown,1);assert.equal(right.defaultPrevented,false);assert.deepEqual(board,{x:-200,y:-230,scale:1})
  pan.destroy()
 }finally{dom.window.close()}
})

test('尚未拖动就移出画布并松开左键，鼠标返回时不会自行平移',()=>{
 assert.equal(typeof graph.mountGraphPan,'function')
 const dom=new JSDOM('<div id="viewport"></div><div id="outside"></div>')
 try{
  const viewport=dom.window.document.querySelector('#viewport'),outside=dom.window.document.querySelector('#outside'),board={x:0,y:0,scale:1}
  const pan=graph.mountGraphPan(viewport,{getBoard:()=>board,onTransform:()=>{}})
  pointer(dom.window,viewport,'pointerdown',0,0)
  pointer(dom.window,outside,'pointerup',-2,0)
  pointer(dom.window,viewport,'pointermove',50,50,{buttons:0})
  assert.deepEqual(board,{x:0,y:0,scale:1})
  assert.equal(viewport.classList.contains('dragging'),false)
  pointer(dom.window,viewport,'pointerdown',0,0)
  pointer(dom.window,viewport,'pointermove',50,50,{buttons:0})
  assert.deepEqual(board,{x:0,y:0,scale:1},'浏览器外松开而未收到up时也会停止等待')
  pan.destroy()
 }finally{dom.window.close()}
})

test('拖动中窗口失去焦点会结束手势，恢复后不继承上次的按压状态',()=>{
 assert.equal(typeof graph.mountGraphPan,'function')
 const dom=new JSDOM('<div id="viewport"></div>')
 try{
  const viewport=dom.window.document.querySelector('#viewport'),board={x:0,y:0,scale:1}
  const pan=graph.mountGraphPan(viewport,{getBoard:()=>board,onTransform:()=>{}})
  pointer(dom.window,viewport,'pointerdown',0,0)
  pointer(dom.window,viewport,'pointermove',20,30)
  dom.window.dispatchEvent(new dom.window.Event('blur'))
  pointer(dom.window,viewport,'pointermove',80,90,{buttons:0})
  assert.deepEqual(board,{x:20,y:30,scale:1})
  assert.equal(viewport.classList.contains('dragging'),false)
  pan.destroy()
 }finally{dom.window.close()}
})

function structuredFixture(){
 const input=fixture()
 for(const chapter of input.chapters){
  for(const [index,section] of chapter.sections.entries()){
   section.scripts=Array.from({length:index+1},(_,itemIndex)=>{
    const id=section.script.id+'-item-'+(itemIndex+1),number=section.number+'.'+(itemIndex+1)
    const title='条目标题：'+number,item={id,title,paragraphs:['本条真实生成的正文。'],points:[]}
    const record={...input.records[section.script.id],id,item,body:item.paragraphs[0]}
    input.records[id]=record
    return {id,number,title,record}
   })
  }
 }
 return input
}

function visualPage(section,entry){
 return {id:'visual-page-'+entry.id,itemId:entry.id,blockId:section.script.id,number:entry.number,chapterTitle:'项目研究',sectionTitle:section.name,item:entry.record.item,layout:'points'}
}

test('十五节按顺序累计多条脚本，每节及每章居中于所属条目组',()=>{
 const input=structuredFixture(),result=layout(input)
 const scripts=result.nodes.filter(node=>node.kind==='script')
 assert.equal(result.sectionCount,15)
 assert.equal(result.scriptCount,30)
 assert.equal(scripts[0].id,'outline-1-1-item-1')
 assert.equal(scripts.at(-1).id,'outline-5-3-item-3')
 assert.deepEqual(scripts.slice(0,6).map(node=>node.entry.number),['1.1.1','1.2.1','1.2.2','1.3.1','1.3.2','1.3.3'])
 assert.equal(new Set(scripts.map(node=>node.w)).size,1)
 assert.ok(scripts.every((node,index)=>index===0||node.y>=scripts[index-1].y+scripts[index-1].h))
 for(const chapter of input.chapters){
  const chapterScripts=chapter.sections.flatMap(section=>section.scripts.map(entry=>result.rects.get(entry.id)))
  assert.equal(center(result.rects.get(chapter.id)),(center(chapterScripts[0])+center(chapterScripts.at(-1)))/2)
  for(const section of chapter.sections){
   const group=section.scripts.map(entry=>result.rects.get(entry.id))
   assert.equal(center(result.rects.get(section.id)),(center(group[0])+center(group.at(-1)))/2)
  }
 }
 for(const [index,node] of result.nodes.entries()){
  for(const other of result.nodes.slice(index+1))assert.equal(overlaps(node,other),false,node.id+' 与 '+other.id+' 重叠')
 }
 assert.equal(result.edges.length,result.nodes.length-1)
})

test('只绘制已生成的真实视觉页，与对应脚本一对一对齐并保持条目顺序',()=>{
 const input=structuredFixture(),withoutPages=layout(input)
 const first=input.chapters[0].sections[1],second=input.chapters[4].sections[2]
 first.scripts[1].visual=visualPage(first,first.scripts[1])
 second.scripts[2].visual=visualPage(second,second.scripts[2])
 second.scripts[0].visual={...first.scripts[1].visual}
 const result=layout(input),pages=result.nodes.filter(node=>node.kind==='artifact')
 assert.equal(withoutPages.nodes.filter(node=>node.kind==='artifact').length,0)
 assert.ok(withoutPages.boardW<result.boardW)
 assert.deepEqual(pages.map(node=>node.id),['visual-page-outline-1-2-item-2','visual-page-outline-5-3-item-3'])
 assert.equal(pages[0].w,pages[1].w)
 for(const page of pages){
  const script=result.rects.get(page.visual.itemId)
  assert.equal(center(page),center(script))
  assert.ok(result.edges.some(edge=>edge.source===script&&edge.target===page))
 }
})

test('完整显示并转义结构化条标题，双击打开对应的条或页，重绘移除已撤回视觉页',()=>{
 const dom=new JSDOM('<div id="board"><svg id="edges"></svg><div id="nodes"></div></div>')
 try{
  const document=dom.window.document,input=structuredFixture(),opened=[]
  const section=input.chapters[1].sections[1],entry=section.scripts[1]
  entry.title='<img src=x onerror=bad()>的完整长标题'.repeat(9)
  entry.visual=visualPage(section,entry)
  const context={...input,board:document.querySelector('#board'),nodeLayer:document.querySelector('#nodes'),edgeLayer:document.querySelector('#edges'),
   onOpenScript:(script,sourceSection)=>opened.push([script.id,sourceSection.id]),onOpenVisual:page=>opened.push([page.id,page.itemId])}
  const result=graph.renderWorkflowGraph(context)
  const script=document.querySelector('[data-node-id="'+entry.id+'"]'),page=document.querySelector('[data-node-id="'+entry.visual.id+'"]')
  const scriptTitle=[...script.querySelectorAll('.workflow-graph-title-line')].map(line=>line.textContent).join('')
  assert.equal(scriptTitle,'2.2.2 '+entry.title)
  assert.ok(result.rects.get(entry.id).titleLines.length>1)
  assert.equal(document.querySelectorAll('img').length,0)
  script.dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true}))
  page.dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true}))
  assert.deepEqual(opened,[[entry.id,section.id],[entry.visual.id,entry.id]])
  delete entry.visual
  graph.renderWorkflowGraph(context)
  assert.equal(document.querySelectorAll('.artnode').length,0)
  assert.equal(document.querySelectorAll('.edge-hit').length,result.edges.length-1)
 }finally{dom.window.close()}
})

test('章节名称高度大于个别脚本组时，章节点仍居中于首末真实条目',()=>{
 const input=structuredFixture(),chapter=input.chapters[0]
 chapter.sections[0].name='需要逐行展示的超长完整章节名称'.repeat(45)
 chapter.sections[2].scripts=[]
 const result=layout(input),scripts=result.nodes.filter(node=>node.kind==='script'&&node.chapter===chapter)
 assert.equal(scripts.length,3)
 assert.equal(center(result.rects.get(chapter.id)),(center(scripts[0])+center(scripts.at(-1)))/2)
})
