import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from '@playwright/test'

const [prototype,style,source]=await Promise.all([
 readFile(new URL('../../index.html',import.meta.url),'utf8'),
 readFile(new URL('../src/workflow-graph.css',import.meta.url),'utf8'),
 readFile(new URL('../src/workflow-graph.js',import.meta.url),'utf8'),
])
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE})
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000},hasTouch:true})
 await page.setContent('<div class="graph-viewport" id="viewport"><div class="graph-board" id="board"><svg class="edge-layer" id="edges"></svg><div id="nodes"></div></div></div>')
 await page.addStyleTag({content:prototype.match(/<style>([\s\S]*?)<\/style>/)[1]+style+'#viewport{position:fixed;inset:0}'})
 const graphModule='data:text/javascript;base64,'+Buffer.from(source).toString('base64')
 const layout=await page.evaluate(async graphModule=>{
  const {renderWorkflowGraph,mountGraphPan}=await import(graphModule)
  const viewport=document.querySelector('#viewport'),board=document.querySelector('#board')
  const pan={x:0,y:0,scale:1},opened=[],selected=[]
  const chapters=Array.from({length:5},(_,chapterIndex)=>{
   const chapter=chapterIndex+1
   return {id:'chapter-'+chapter,name:'项目范围与现状及后续利用的研究'.repeat(5),sections:Array.from({length:3},(_,sectionIndex)=>{
    const number=chapter+'.'+(sectionIndex+1),id='section-'+number
    return {id,number,name:'评估项目现有条件、空间布局与实施范围'.repeat(6),scripts:Array.from({length:sectionIndex+1},(_,itemIndex)=>{
     const itemNumber=number+'.'+(itemIndex+1),id='script-'+itemNumber
     const title='依据与项目研究标题 WWW—规划范围 🌱 '.repeat(5)+'成果'
     const item={id,title,paragraphs:['项目现有条件与范围。'.repeat(60)],points:[]}
     const record={body:item.paragraphs[0],workflowDraft:true}
     const visual=chapter===1&&sectionIndex===0?{id:'visual-page-'+id,itemId:id,number:itemNumber,item,layout:'points'}:undefined
     return {id,number:itemNumber,title,record,visual}
    })}
   })}
  })
  const graph=renderWorkflowGraph({chapters,projectName:'完整项目名称与现有条件'.repeat(5),board,nodeLayer:document.querySelector('#nodes'),edgeLayer:document.querySelector('#edges'),onSelectNode:id=>selected.push(id),onOpenScript:entry=>opened.push(entry.id),onOpenVisual:visual=>opened.push(visual.id)})
  const toTransform=()=>{board.style.transform='translate('+pan.x+'px,'+pan.y+'px)'}
  mountGraphPan(viewport,{getBoard:()=>pan,onTransform:toTransform})
  const show=id=>{
   const node=graph.rects.get(id)
   Object.assign(pan,{x:180-node.x,y:160-node.y})
   toTransform()
  }
  window.graphFixture={pan,opened,selected,show}
  await document.fonts.ready
  return {counts:[graph.sectionCount,graph.scriptCount,graph.visualCount],overflow:[...document.querySelectorAll('.mapnode')].flatMap(node=>{
   const box=node.getBoundingClientRect()
   return [...node.querySelectorAll('.workflow-graph-title-line')].flatMap(line=>{
    const range=document.createRange()
    range.selectNodeContents(line)
    return [...range.getClientRects()].some(rect=>rect.left<box.left||rect.right>box.right||rect.top<box.top||rect.bottom>box.bottom)?[node.dataset.nodeId]:[]
   })
  })}
 },graphModule)
 assert.deepEqual(layout,{counts:[15,30,1],overflow:[]})
 const script='script-1.1.1',visual='visual-page-'+script
 const show=id=>page.evaluate(id=>window.graphFixture.show(id),id)
 const node=id=>page.locator('[data-node-id="'+id+'"]')
 const state=()=>page.evaluate(()=>{const {pan,opened,selected}=window.graphFixture;return {pan,opened,selected}})
 await show(script)
 const initial=(await state()).pan,box=await node(script).boundingBox()
 await page.mouse.move(box.x+40,box.y+25)
 await page.mouse.down()
 await page.mouse.move(box.x+140,box.y+95,{steps:8})
 await page.mouse.up()
 assert.deepEqual(await state(),{pan:{x:initial.x+100,y:initial.y+70,scale:1},opened:[],selected:[]})
 await show(script);await node(script).dblclick()
 await show(visual);await node(visual).dblclick()
 assert.deepEqual((await state()).opened,[script,visual])
 await show(visual)
 const beforeTouch=await state(),visualBox=await node(visual).boundingBox()
 const cdp=await page.context().newCDPSession(page)
 const x=visualBox.x+45,y=visualBox.y+35
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]})
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+80,y:y+45}]})
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
 assert.deepEqual(await state(),{...beforeTouch,pan:{x:beforeTouch.pan.x+80,y:beforeTouch.pan.y+45,scale:1}})
 assert.equal(await page.locator('#viewport').evaluate(element=>element.classList.contains('dragging')),false)
 console.log('Chromium 关系图验证通过：5 章、15 节、30 条、1 个真实页，标题无裁切，鼠标及触控拖动不误选，双击定位正确。')
}finally{await browser.close()}
