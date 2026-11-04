import test from 'node:test'
import assert from 'node:assert/strict'
import {draft} from './fixtures/outline.mjs'
import {assertOutlineConfirmable} from '../src/outline-contract.mjs'
const state=()=>({version:1,inputHash:'a'.repeat(64),status:'draft',draft:draft(),flow:['06','01'],flowReviewed:false,waivers:[]})
test('推荐流程尚未提交核对，即使没有疑点也不能确认',()=>{const s=state();s.draft.questions=[];assert.throws(()=>assertOutlineConfirmable(s,{version:1,inputHash:s.inputHash}),/提交流程/);s.flowReviewed=true;assert.doesNotThrow(()=>assertOutlineConfirmable(s,{version:1,inputHash:s.inputHash}))})
test('明确跳过当前问题可确认受限流程，但不能改变资料就绪状态',()=>{const s=state();s.flow=['03'];s.flowReviewed=true;s.waivers=[{questionId:'goal',prompt:s.draft.questions[0].prompt,reason:'本轮先摸底',chapterIds:['03','11']}];assert.doesNotThrow(()=>assertOutlineConfirmable(s,{version:1,inputHash:s.inputHash}));assert.equal(s.draft.chapters[0].readiness,'limited');s.waivers=[{questionId:'other'}];assert.throws(()=>assertOutlineConfirmable(s,{version:1,inputHash:s.inputHash}),/疑点/)})
const editor=await import('../src/outline-flow.js').catch(()=>({}))
test('拖入、改序、移出只改变本轮流程，不重复、不修改标准目录',()=>{
 assert.equal(typeof editor.moveChapter,'function')
 const flow=['01','06','03']
 assert.deepEqual(editor.moveChapter(flow,'03','01'),['03','01','06'])
 assert.deepEqual(editor.moveChapter(flow,'08','06'),['01','08','06','03'])
 assert.deepEqual(editor.moveChapter(flow,'06',null),['01','03','06'])
 assert.deepEqual(flow,['01','06','03'])
 assert.deepEqual(editor.normalizeFlow(['06','06','invalid','01']),['06','01'])
})

test('未选章节的问题不阻断本轮流程；相关问题仍需处理',()=>{const s=state();s.flow=['01'];s.flowReviewed=true;assert.doesNotThrow(()=>assertOutlineConfirmable(s,{version:1,inputHash:s.inputHash}));s.draft.questions[0].chapterIds=['01'];assert.throws(()=>assertOutlineConfirmable(s,{version:1,inputHash:s.inputHash}))})
test('相邻下半区拖放不能把当前章推到末尾',()=>{assert.deepEqual(editor.moveChapter(['01','02','03'],'02','02'),['01','02','03'])})
test('补资料改变摘要时保留未提交编排，只让核对过期',()=>{const values=new Map();globalThis.sessionStorage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};try{values.set('pre-outline-flow:p:2',JSON.stringify(['03','01']));const view=editor.flowEditorState('p',{version:2,inputHash:'old',currentInputHash:'new',flow:['01','03']});assert.deepEqual(view.selected,['03','01']);assert.equal(view.dirty,true)}finally{delete globalThis.sessionStorage}})

test('章节按逻辑顺序横向回转，换行后反向，窄屏仍保留顺序',()=>{
 assert.equal(typeof editor.flowCell,'function')
 assert.deepEqual(Array.from({length:8},(_,i)=>editor.flowCell(i,3)),[
  {row:0,column:0,direction:1},{row:0,column:1,direction:1},{row:0,column:2,direction:1},
  {row:1,column:2,direction:-1},{row:1,column:1,direction:-1},{row:1,column:0,direction:-1},
  {row:2,column:0,direction:1},{row:2,column:1,direction:1},
 ])
 assert.deepEqual(editor.flowCell(3,2),{row:1,column:0,direction:-1})
 assert.deepEqual(editor.flowCell(3,1),{row:3,column:0,direction:1})
})
const drag=await import('../src/outline-drag.js')
test('二维拖放在左右两种行向上均准确插入，悬停不修改原顺序',()=>{
 assert.equal(typeof drag.locateFlowDrop,'function')
 const positions=[[0,0,1],[120,0,1],[240,0,1],[240,100,-1],[120,100,-1],[0,100,-1]]
 const nodes=positions.map(([left,top,direction],i)=>({id:String(i+1).padStart(2,'0'),left,top,right:left+100,bottom:top+80,direction}))
 assert.deepEqual(drag.locateFlowDrop(nodes,{x:122,y:30},'08').before,'02')
 assert.deepEqual(drag.locateFlowDrop(nodes,{x:212,y:140},'08').before,'05')
 assert.deepEqual(drag.locateFlowDrop(nodes,{x:125,y:140},'08').before,'06')
 assert.equal(drag.locateFlowDrop(nodes,{x:5,y:140},'08').before,null)
 assert.equal(drag.locateFlowDrop(nodes,{x:5,y:140},'06').before,null)
 assert.equal(drag.locateFlowDrop(nodes,{x:125,y:30},'02').before,'03')
 assert.deepEqual(nodes.map(n=>n.id),['01','02','03','04','05','06'])
})
