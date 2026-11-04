import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from '@playwright/test'

test('隐藏时首次挂载的对话在显示后定位最新，主动翻阅与底部跟随分别保留',async()=>{
 const source=await readFile(new URL('../src/outline-agent.js',import.meta.url),'utf8')
 const browser=await chromium.launch({executablePath:'/home/zetta/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',args:['--no-proxy-server']})
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
 try{
  await page.setContent('<style>#stage[hidden]{display:none}.outline-agent-history{height:70px;overflow:auto}.outline-agent-message{min-height:30px}.outline-agent-message p{margin:0}</style><section id="stage" hidden><div id="bottom"><div id="consultComposer"><input id="input"><button id="send">发送</button></div></div></section>')
  await page.evaluate(async url=>{
   const {mountOutlineAgent}=await import(url),values=new Map()
   window.jobs=Array.from({length:10},(_,index)=>({id:String(index),kind:'chat',status:'completed',user_text:`消息 ${index}`,result:{response:`回复 ${index}`}}))
   window.agent=mountOutlineAgent(document.querySelector('#bottom'),{input:document.querySelector('#input'),sendButton:document.querySelector('#send'),onCancel:async()=>{},onModeChange(){},storage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}})
   window.refreshAgent=(projectId='one')=>window.agent.update({projectId,jobs:window.jobs,mode:'chat',connection:'live'})
   window.refreshAgent()
  },`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
  const position=()=>page.locator('[data-agent-history]').evaluate(el=>({top:el.scrollTop,end:el.scrollHeight-el.clientHeight,visible:el.clientHeight>0}))
  assert.equal((await position()).visible,false)
  await page.locator('#stage').evaluate(el=>{el.hidden=false})
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  let state=await position();assert.ok(state.end>300);assert.ok(Math.abs(state.top-state.end)<2,JSON.stringify(state))

  await page.locator('[data-agent-history]').evaluate(el=>{el.scrollTop=40})
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)))
  await page.evaluate(()=>{window.jobs.push({id:'new',kind:'chat',status:'completed',user_text:'新消息',result:{response:'新回复'}});window.refreshAgent()})
  assert.equal((await position()).top,40,'读历史时新消息不强制跳到底部')

  await page.locator('[data-agent-history]').evaluate(el=>{el.scrollTop=el.scrollHeight})
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)))
  await page.evaluate(()=>{window.jobs.push({id:'next',kind:'chat',status:'completed',user_text:'再一条',result:{response:'再回复'}});window.refreshAgent()})
  state=await position();assert.ok(Math.abs(state.top-state.end)<2,'在底部时新消息自动跟随')

  await page.locator('[data-agent-history]').evaluate(el=>{el.scrollTop=40})
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)))
  await page.evaluate(()=>{document.querySelector('#stage').hidden=true;window.refreshAgent('two')})
  await page.locator('#stage').evaluate(el=>{el.hidden=false})
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  state=await position();assert.ok(Math.abs(state.top-state.end)<2,'切换项目后重新定位最新')
  assert.deepEqual(errors,[])
 }finally{await browser.close()}
})
