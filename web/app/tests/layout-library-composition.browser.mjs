import test from 'node:test'
import assert from 'node:assert/strict'
import {chromium} from 'playwright-core'
import {resolveBrowserExecutable} from '../../../src/report/browser-executable.ts'
import {resolvePage} from '../src/layout-library/contract.mjs'
import {renderNativeDocument} from '../src/layout-library/render.mjs'
import {compositionPackage,compositionPage} from './fixtures/composition.mjs'

test('真实 Chromium：长中文、多图、表格完整呈现，实际画布保留 6:5 比例',async()=>{
 const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,chromiumSandbox:process.env.PRE_LAYOUT_TEST_NO_SANDBOX!=='1'})
 try{
  const page=compositionPage();page.nativeLayout=resolvePage({page,globalPackage:compositionPackage()})
  const tab=await browser.newPage({viewport:{width:1320,height:1100}})
  await tab.setContent(renderNativeDocument([page]),{waitUntil:'load'})
  await tab.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()))})
  const actual=await tab.evaluate(()=>{
   const article=document.querySelector('[data-native-page]'),box=article.getBoundingClientRect()
   return {width:box.width,height:box.height,font:getComputedStyle(article).fontFamily,text:article.textContent,images:[...document.images].map(i=>({width:i.naturalWidth,box:i.getBoundingClientRect().height})),overflow:[...article.querySelectorAll('[data-layout-slot]')].filter(s=>s.scrollWidth>s.clientWidth+2||s.scrollHeight>s.clientHeight+2).map(s=>({slot:s.dataset.layoutSlotId,actual:s.scrollHeight,available:s.clientHeight}))}
  })
  assert.equal(actual.width,1200);assert.equal(actual.height,1000)
  assert.match(actual.font,/Noto Sans CJK SC/)
  for(const text of [...page.item.paragraphs,...page.item.points,...page.item.figures.map(f=>f.caption),'服务设施'])assert(actual.text.includes(text),text)
  assert(actual.images.every(image=>image.width>0&&image.box>80))
  assert.deepEqual(actual.overflow,[])
 }finally{await browser.close()}
})

test('真实 Chromium：图表值与关系节点为可量测 DOM，过量文字会触发溢出',async()=>{
 const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,chromiumSandbox:process.env.PRE_LAYOUT_TEST_NO_SANDBOX!=='1'})
 try{
  const p=compositionPackage(),page=compositionPage()
  page.item={title:'合成数据组合试排',paragraphs:[],points:[],evidenceIndexes:[0],chart:{type:'line',categories:['第一阶段','第二阶段','第三阶段'],series:[{name:'合成设施数量',values:[2,5,3]}]},timeline:{events:[{label:'前期准备',description:'核对基础条件'},{label:'分期实施',description:'组织建设时序'}]},diagram:{direction:'horizontal',nodes:[{id:'service',label:'公共服务'},{id:'operation',label:'运营管理'}],edges:[{from:'service',to:'operation',label:'协同'}]}}
  const s=(id,role,x,y,w,h)=>({id,role,rect:{x,y,w,h}})
  p.layouts[0].slots=[s('title','title',.04,.04,.92,.13),s('chart','chart',.04,.22,.43,.56),s('timeline','timeline',.54,.22,.42,.23),s('diagram','diagram',.54,.53,.42,.25),s('source','source',.04,.91,.92,.05)]
  page.nativeLayout=resolvePage({page,globalPackage:p})
  const tab=await browser.newPage({viewport:{width:1320,height:1100}})
  await tab.setContent(renderNativeDocument([page]),{waitUntil:'load'})
  await tab.evaluate(()=>document.fonts.ready)
  assert.equal(await tab.locator('[data-chart-series] span').count(),3)
  assert.equal(await tab.locator('[data-diagram-node]').count(),2)
  const overflow=await tab.locator('[data-layout-slot]').evaluateAll(slots=>slots.filter(s=>s.scrollHeight>s.clientHeight+2||s.scrollWidth>s.clientWidth+2).map(s=>s.dataset.layoutSlotId))
  assert.deepEqual(overflow,[])
  page.item.title='超出容量检查'.repeat(600)
  await tab.setContent(renderNativeDocument([page]),{waitUntil:'load'})
  assert(await tab.locator('[data-layout-slot="title"]').evaluate(s=>s.scrollHeight>s.clientHeight+2))
 }finally{await browser.close()}
})
