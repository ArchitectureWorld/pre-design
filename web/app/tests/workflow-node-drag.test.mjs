import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {renderWorkflowGraph,layoutWorkflowGraph,positionWorkflowNode} from '../src/workflow-graph.js'
const drag=await import('../src/workflow-node-drag.js').catch(()=>({}))

function fixture(){
 const dom=new JSDOM('<div id="viewport"><div id="board"><svg id="edges"></svg><div id="nodes"></div></div></div>',{url:'http://localhost/'})
 const document=dom.window.document,viewport=document.querySelector('#viewport'),board=document.querySelector('#board'),nodeLayer=document.querySelector('#nodes'),edgeLayer=document.querySelector('#edges')
 const chapters=[{id:'chapter',name:'项目',sections:[1,2].map(i=>({id:'section-'+i,number:'1.'+i,name:'现有条件'+i,scripts:[]}))}]
 const layout=renderWorkflowGraph({board,nodeLayer,edgeLayer,chapters}),camera={x:20,y:30,scale:.5},saved=[]
 let pan=0
 viewport.addEventListener('pointerdown',e=>{if(e.button===2)pan++})
 assert.equal(typeof drag.mountGraphNodeDrag,'function')
 const controller=drag.mountGraphNodeDrag(viewport,{getLayout:()=>layout,getScale:()=>camera.scale,board,nodeLayer,edgeLayer,onCommit:positions=>saved.push(positions)})
 return {dom,document,viewport,board,nodeLayer,edgeLayer,layout,camera,saved,controller,pan:()=>pan}
}
function event(f,target,type,x,y,options={}){
 const e=new f.dom.window.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:2,buttons:type==='pointerup'?0:2,...options})
 Object.defineProperties(e,{pointerId:{value:1},pointerType:{value:'mouse'},isPrimary:{value:true}})
 target.dispatchEvent(e);return e
}
test('右键拖动图块只移动图块，换算缩放、连线即时随动、松手不触发画布处理',()=>{
 const f=fixture()
 try{
  const node=f.nodeLayer.querySelector('[data-node-id="section-2"]'),before={...f.layout.rects.get('section-2')},path=f.edgeLayer.querySelector('[data-edge-id="chapter--section-2"]').getAttribute('d')
  event(f,node,'pointerdown',100,100);event(f,f.viewport,'pointermove',110,150)
  assert.equal(f.pan(),0);assert.deepEqual(f.camera,{x:20,y:30,scale:.5})
  assert.ok(f.layout.rects.get('section-2').y>=before.y+90)
  assert.notEqual(f.edgeLayer.querySelector('[data-edge-id="chapter--section-2"]').getAttribute('d'),path)
  assert.ok(f.viewport.querySelector('.workflow-align-guide'))
  event(f,f.document,'pointerup',110,150)
  assert.equal(f.saved.length,1);assert.equal(f.viewport.classList.contains('node-dragging'),false)
  assert.equal(f.saved[0]['section-2'].y,f.layout.rects.get('section-2').y)
  assert.equal(f.edgeLayer.querySelector('.workflow-align-guide'),null)
 }finally{f.controller.destroy();f.dom.window.close()}
})
test('点击不移动、空白处右键仍平移，取消与失焦还原图块且不保存',()=>{
 const f=fixture()
 try{
  const node=f.nodeLayer.querySelector('[data-node-id="section-1"]'),before={...f.layout.rects.get('section-1')}
  event(f,node,'pointerdown',100,100);event(f,f.viewport,'pointerup',102,102);assert.equal(f.saved.length,0)
  event(f,f.viewport,'pointerdown',100,100);assert.equal(f.pan(),1)
  for(const cancel of ['pointercancel','blur']){
   event(f,node,'pointerdown',100,100);event(f,f.viewport,'pointermove',120,220)
   if(cancel==='blur')f.dom.window.dispatchEvent(new f.dom.window.Event('blur'));else event(f,f.viewport,cancel,120,220)
   assert.equal(f.layout.rects.get('section-1').x,before.x);assert.equal(f.layout.rects.get('section-1').y,before.y)
   assert.equal(f.saved.length,0);assert.equal(f.viewport.classList.contains('node-dragging'),false)
  }
 }finally{f.controller.destroy();f.dom.window.close()}
})
test('落点自动避开其他图块，刷新时重新应用布局且过滤非法坐标',()=>{
 const f=fixture()
 try{
  const first=f.layout.rects.get('section-1'),second=f.layout.rects.get('section-2'),node=f.nodeLayer.querySelector('[data-node-id="section-2"]')
  event(f,node,'pointerdown',100,100);event(f,f.viewport,'pointermove',100,100+(first.y-second.y)*.5);event(f,f.viewport,'pointerup',100,100)
  assert.ok(second.y+second.h+12<=first.y||second.y>=first.y+first.h+12)
  const next=renderWorkflowGraph({board:f.board,nodeLayer:f.nodeLayer,edgeLayer:f.edgeLayer,chapters:[{id:'chapter',name:'项目',sections:[1,2].map(i=>({id:'section-'+i,number:'1.'+i,name:'现有条件'+i,scripts:[]}))}],positions:{...f.saved[0],missing:{x:100,y:100},root:{x:Infinity,y:-500}}})
  assert.equal(next.rects.get('section-2').y,second.y)
  assert.ok(next.root.x>=0&&next.root.y>=0)
 }finally{f.controller.destroy();f.dom.window.close()}
})

test('父子多层都被拖动后，刷新按完整布局恢复而不被默认位置夹紧',()=>{
 const chapters=[{id:'chapter',name:'项目',sections:[{id:'section',number:'1.1',name:'现状'}]}]
 const layout=layoutWorkflowGraph({chapters})
 for(const [id,x] of [['section',1200],['chapter',800],['root',400]]){
  const node=layout.rects.get(id);Object.assign(node,positionWorkflowNode(layout,id,{x,y:node.y}))
 }
 const positions=Object.fromEntries(layout.nodes.map(({id,x,y})=>[id,{x,y}]))
 const restored=layoutWorkflowGraph({chapters,positions})
 assert.deepEqual(Object.fromEntries(restored.nodes.map(({id,x,y})=>[id,{x,y}])),positions)
})

test('单页节的成果图块与预览一样使用节标题，不露出条级标题',()=>{
 const item={id:'item',title:'应隐藏的条标题'},visual={id:'visual',itemId:'item',number:1,itemCount:1,displayTitle:'节标题',item}
 const layout=layoutWorkflowGraph({chapters:[{id:'chapter',name:'项目',sections:[{id:'section',number:'1.1',name:'节标题',scripts:[{id:item.id,number:'1.1',title:'节标题',record:{body:'正文'},visual}]}]}]})
 assert.equal(layout.rects.get('visual').title,'1 节标题')
})
