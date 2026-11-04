import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {JSDOM} from 'jsdom'
import * as workflow from '../src/workflow-ui.js'
import * as content from '../src/workflow-content.mjs'

const source=await readFile(new URL('../src/prototype-api.js',import.meta.url),'utf8')
const prototype=await readFile(new URL('../../index.html',import.meta.url),'utf8')
const makeProject=()=>({id:'project-1',name:'少潭河水库',revision:4,materials:[],annotations:[],jobs:[],core:{stateObjects:[{objectId:'PS01',value:{data:{canonical_name:'原专业记录'}}}],proposals:[]},outline:{version:6,status:'confirmed',flow:['01'],waivers:[],draft:{chapters:[{id:'01',title:'项目背景',tasks:['项目基本情况'],gaps:[]}]}},workflow:{current:{id:'draft-1',version:1,outlineVersion:6,inputHash:'input-1',createdAt:'2026-11-04T05:00:00Z',flow:['01'],blocks:[{id:'outline-01-1',chapterId:'01',taskIndex:0,title:'项目基本情况',body:'真实阶段稿正文。',evidenceIndexes:[],limitations:[]}],evidence:[],limitations:['本轮已跳过现状调查'],reviewedBlockIds:[],stale:false},history:[]}})

function setup(t,project=makeProject()){
 const dom=new JSDOM(prototype.replace(/<script>[\s\S]*?<\/script>/,''),{url:'http://localhost/'})
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true}
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))}
 const previous={document:globalThis.document};globalThis.document=dom.window.document
 const calls=[],notices=[],state={currentProjectId:project.id,stage:'test',scripts:{},annotations:[],selected:null}
 const context=vm.createContext({document:dom.window.document,window:dom.window,sessionStorage:dom.window.sessionStorage,crypto:globalThis.crypto,setInterval,clearInterval,setTimeout,clearTimeout,requestAnimationFrame:fn=>fn(),state,graphData:[],ICON:{close:'×'},$:selector=>dom.window.document.querySelector(selector),escapeHTML:value=>String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),chapterCapabilityLabel:()=> '资料梳理',updateProjectSwitcher(){},toast:text=>notices.push(text),setReference:ref=>{state.selected=ref},clearReference:()=>{state.selected=null},closePreview(){},updatePreviewNav(){},showPreviewAction(){},clearPreviewAction(){},...workflow,...content,fetch:async(url,options)=>{if(options.method==='POST')calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>url.endsWith('/state')?project:{id:'job-1'}}}})
 vm.runInContext(source.replace(/^import .+$/gm,''),context)
 // The API adapter is real; the unrelated outline canvas is outside this test boundary.
 vm.runInContext('updateFlowConfirmation=()=>{}; renderConsult=()=>{}; startConsult=()=>{}; renderGraph=()=>{graphData=buildData()};',context)
 const api=vm.runInContext('({server,applySnapshot,buildData,handleChatSubmit,renderScriptPage,recordForReference,updatePipelineUI,setReference,allScriptEntries,allVisualEntries})',context)
 api.applySnapshot(project);context.graphData=api.buildData()
 t.after(()=>{api.server.workflowUI?.destroy();Object.assign(globalThis,previous);dom.window.close()})
 return {api,document:dom.window.document,state,calls,notices,project}
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,25))

test('原型生成按钮提交当前流程初稿请求且保留已有专业记录',async t=>{
 const project=makeProject();project.workflow.current=null
 const {api,document,calls,state}=setup(t,project)
 api.updatePipelineUI();document.querySelector('#pipelineBtn').click();await settle()
 assert.equal(calls.length,1)
 assert.equal(calls[0].url,'/api/projects/project-1/workflow/draft')
 assert.equal(calls[0].body.outlineVersion,6)
 assert.equal(calls[0].body.baseRevision,4)
 assert.ok(calls[0].body.requestId)
 assert.equal(calls[0].body.baseDraftId,undefined)
 assert.equal(state.scripts['script-1-1'].confirmed.data.canonical_name,'原专业记录')
})

test('原型任务显示阶段稿正文，审阅只调用条级接口',async t=>{
 const p=makeProject(),draft=p.workflow.current,block=draft.blocks[0]
 draft.formatVersion=2
 const item={id:block.id+'-item-1',title:'项目情况',paragraphs:[block.body],points:[],evidenceIndexes:[]}
 block.items=[item]
 const {api,document,calls,state}=setup(t,p)
 const record=state.scripts[item.id]
 assert.match(record.body,/真实阶段稿正文。/)
 state.activeScript=api.buildData()[0].sections[0].scripts[0];api.renderScriptPage()
 assert.match(document.querySelector('#previewSheet').textContent,/真实阶段稿正文/)
 document.querySelector('#scriptApproveBtn').click();await settle()
 assert.equal(calls.length,1)
 assert.equal(calls[0].url,'/api/projects/project-1/workflow/review')
 assert.equal(calls[0].body.draftId,'draft-1')
 assert.equal(calls[0].body.blockId,'outline-01-1')
 assert.equal(calls[0].body.itemId,item.id)
 assert.equal(calls[0].body.proposalId,undefined)
})

test('引用阶段稿后只修订本条，不重新编排章节或保存专业批注',async t=>{
 const p=makeProject(),draft=p.workflow.current,block=draft.blocks[0]
 draft.formatVersion=2
 const item={id:block.id+'-item-1',title:'项目情况',paragraphs:[block.body],points:[],evidenceIndexes:[]}
 block.items=[item]
 const {api,document,calls,state}=setup(t,p)
 state.selected={id:item.id+'#text-1',kind:'block',title:'项目基本情况',workflowDraftId:'draft-1',blockId:block.id,itemId:item.id}
 document.querySelector('#chatInput').value='保留缺口，再说明资料边界。'
 api.handleChatSubmit();await settle()
 assert.equal(calls.length,1)
 assert.equal(calls[0].url,'/api/projects/project-1/workflow/draft')
 assert.equal(calls[0].body.baseDraftId,'draft-1')
 assert.equal(calls[0].body.blockId,'outline-01-1')
 assert.equal(calls[0].body.itemId,item.id)
 assert.equal(calls[0].body.text,'保留缺口，再说明资料边界。')
 assert.equal(state.selected,null)
})

test('旧阶段稿保留预览，确认和修订都不发送请求',async t=>{
 const project=makeProject();project.workflow.current.stale=true
 const {api,document,calls,state,notices}=setup(t,project)
 state.activeScript=api.buildData()[0].sections[0];api.renderScriptPage()
 assert.match(document.querySelector('#previewSheet').textContent,/真实阶段稿正文/)
 assert.equal(document.querySelector('#scriptApproveBtn').disabled,true)
 assert.ok(document.querySelector('[data-workflow-generate]'))
 state.selected={id:'outline-01-1',kind:'script',workflowDraftId:'draft-1'};document.querySelector('#chatInput').value='修订旧稿'
 api.handleChatSubmit();await settle()
 assert.equal(calls.length,0)
 assert.match(notices.join(' '),/旧版|重新生成/)
})

test('旧正文浮层引用不能在新稿刷新后被重新绑定并提交',async t=>{
 const p=makeProject(),draft=p.workflow.current,block=draft.blocks[0]
 draft.formatVersion=2
 const item={id:block.id+'-item-1',title:'项目情况',paragraphs:[block.body],points:[],evidenceIndexes:[]}
 block.items=[item]
 const {api,document,calls,state,notices}=setup(t,p)
 api.setReference({id:item.id+'#text-1',kind:'block',title:'项目基本情况',excerpt:'旧版正文',workflowDraftId:'older-draft',blockId:block.id,itemId:item.id})
 assert.equal(state.selected.workflowDraftId,'older-draft')
 document.querySelector('#chatInput').value='修改旧版摘录'
 api.handleChatSubmit();await settle()
 assert.equal(calls.length,0)
 assert.match(notices.join(' '),/旧版|重新引用/)
})

test('未生成的任务不进入脚本预览，阶段稿和专业文字均不冒充可视化',t=>{
 const project=makeProject();project.workflow.current=null
 const first=setup(t,project)
 assert.equal(first.api.allScriptEntries().some(section=>section.script.id==='outline-01-1'),false)
 assert.equal(first.api.recordForReference('section-1-1')?.outlineTask,true,'可见任务仍可映射到生成入口')
 assert.equal(first.api.allVisualEntries().length,0)
 project.workflow=makeProject().workflow;first.api.applySnapshot(project)
 assert.equal(first.api.allScriptEntries().some(section=>section.script.id==='outline-01-1'),true)
 assert.equal(first.api.allVisualEntries().length,0)
 assert.equal(first.api.buildData()[0].sections[0].artifact.generated,false)
})

test('同一节有两条脚本，预览引用绑定具体条目',async t=>{
 const p=makeProject(),d=p.workflow.current,b=d.blocks[0]
 d.formatVersion=2
 b.items=['区位条件','建设范围'].map((title,index)=>({id:b.id+'-item-'+(index+1),title,paragraphs:[title+'正文'],points:[],evidenceIndexes:[]}))
 const {api,document,calls,state}=setup(t,p)
 const section=api.buildData()[0].sections[0]
 assert.equal(section.scripts.length,2)
 const entries=api.allScriptEntries().filter(entry=>entry.record?.workflowDraft)
 assert.deepEqual(Array.from(entries,entry=>entry.number),['1.1.1','1.1.2'])
 assert.equal(api.allVisualEntries().length,0)
 state.activeScript=entries[1];api.renderScriptPage()
 assert.match(document.querySelector('[data-workflow-body]').textContent,/建设范围正文/)
 document.querySelector('#previewQuoteBtn').click()
 assert.equal(state.selected.itemId,b.items[1].id)
 assert.equal(state.selected.blockId,b.id)
 assert.equal(state.selected.workflowDraftId,d.id)
 document.querySelector('#chatInput').value='更新建设范围。'
 api.handleChatSubmit();await settle()
 assert.equal(calls[0]?.body.itemId,b.items[1].id)
 assert.equal(calls[0]?.body.blockId,b.id)
})

test('单页沿用节标题和节编号，不产生第三层标题或摘要中的Markdown标记',t=>{
 const p=makeProject(),d=p.workflow.current,b=d.blocks[0]
 d.formatVersion=2
 b.items=[{id:b.id+'-item-1',title:'额外条标题',paragraphs:[],points:['已核实的正文。'],evidenceIndexes:[]}]
 const {api,document,state}=setup(t,p),entry=api.allScriptEntries().find(entry=>entry.record?.workflowDraft)
 assert.equal(entry.number,'1.1');assert.equal(entry.name,b.title)
 state.activeScript=entry;api.renderScriptPage()
 assert.equal(document.querySelector('[data-workflow-pane=body] h2').textContent,b.title)
 assert.equal(document.querySelector('[data-workflow-body] h3'),null)
 assert.match(document.querySelector('[data-workflow-body]').textContent,/已核实的正文/)
 assert.equal(state.scripts[b.items[0].id].itemId,b.items[0].id)
})

test('整稿确认与首次整套生成分开触发，生成后才能选择多页调整版式',async t=>{
 const p=makeProject(),d=p.workflow.current,b=d.blocks[0]
 d.formatVersion=2
 b.items=['区位条件','建设范围'].map((title,index)=>({id:b.id+'-item-'+(index+1),title,paragraphs:[title+'正文'],points:[],evidenceIndexes:[]}))
 const {api,document,calls}=setup(t,p)
 api.updatePipelineUI()
 const approve=document.querySelector('[data-workflow-approve]'),generate=document.querySelector('[data-workflow-visuals]')
 assert.equal(generate.disabled,true)
 approve.click();await settle()
 assert.deepEqual(calls.map(call=>call.url.split('/').at(-1)),['approve'])
 d.approval={draftId:d.id};api.applySnapshot(p);api.updatePipelineUI()
 assert.equal(generate.disabled,false)
 generate.click();await settle()
 assert.deepEqual(calls.map(call=>call.url.split('/').at(-1)),['approve','visuals'])
 assert.equal(calls[1].body.draftId,d.id)
 assert.equal(calls[1].body.pageIds,undefined)
 assert.equal(api.allVisualEntries().length,0)
 const pages=b.items.map((item,index)=>({id:'visual-page-'+item.id,itemId:item.id,blockId:b.id,number:'1.1.'+(index+1),chapterTitle:'项目背景',sectionTitle:b.title,item,layout:'points'}))
 p.workflow.visuals={current:{id:'deck-1',version:1,draftId:d.id,pages,stale:false}}
 api.applySnapshot(p);api.updatePipelineUI()
 assert.equal(api.allVisualEntries().length,2)
 document.querySelector('[data-workflow-layout]').click()
 const dialog=document.querySelector('[data-workflow-layout-dialog]')
 assert.ok(dialog.open)
 const choices=[...dialog.querySelectorAll('[name=pageIds]')]
 assert.equal(choices.length,2)
 choices.forEach(choice=>{choice.checked=true})
 dialog.querySelector('[name=layout]').value='columns'
 dialog.querySelector('form').dispatchEvent(new document.defaultView.Event('submit',{bubbles:true,cancelable:true}));await settle()
 assert.deepEqual(calls[2].body.pageIds,pages.map(page=>page.id))
 assert.equal(calls[2].body.baseVisualId,'deck-1')
 assert.equal(calls[2].body.layout,'columns')
})
