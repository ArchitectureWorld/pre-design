import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'

const ui=await import('../src/workflow-ui.js').catch(()=>({}))
const draft={id:'draft-1',version:2,outlineVersion:6,inputHash:'input-1',jobId:'job-1',createdAt:'2026-11-04T05:00:00Z',flow:['01'],blocks:[{id:'outline-01-1',chapterId:'01',taskIndex:0,title:'项目基本情况',body:'资料记载的项目范围。\n\n尚缺现状核验。',evidenceIndexes:[0],limitations:['范围待核验']}],evidence:[{materialId:'material-1',kind:'text',locator:'第 3 段',summary:'项目范围记载',quote:'少潭河水库 <现场记录>',filename:'任务书.txt'}],limitations:['本轮已跳过：缺少现状调查'],reviewedBlockIds:['outline-01-1'],stale:false}
const project=()=>({id:'project-1',revision:7,outline:{version:6,status:'confirmed'},workflow:{current:structuredClone(draft),history:[]},jobs:[]})

test('阶段稿按原任务映射正文、引用、审阅状态，不创建专业提案',()=>{
 assert.equal(typeof ui.workflowRecord,'function')
 const record=ui.workflowRecord(project(),draft.blocks[0])
 assert.equal(record.id,'outline-01-1')
 assert.equal(record.body,'资料记载的项目范围。\n\n尚缺现状核验。')
 assert.equal(record.workflowDraftId,'draft-1')
 assert.equal(record.workflowVersion,2)
 assert.equal(record.approved,true)
 assert.equal(record.generated,false,'文字初稿不得被计为可视化成果')
 assert.equal(record.textGenerated,true)
 assert.equal(record.proposalId,undefined)
 assert.equal(record.confirmed,undefined)
 assert.equal(record.workflowEvidence[0].filename,'任务书.txt')
 assert.deepEqual(record.limitations,['本轮已跳过：缺少现状调查','范围待核验'])
})

test('旧稿只读，可按本轮流程整理条目脚本',()=>{
 assert.equal(typeof ui.workflowDraftMutation,'function')
 const p=project(),record=ui.workflowRecord(p,draft.blocks[0])
 assert.deepEqual(ui.workflowDraftMutation(p),{outlineVersion:6})
 assert.throws(()=>ui.workflowDraftMutation(p,record,'请补充范围说明。','draft-1'),/旧版脚本.*整理条目/)
 assert.throws(()=>ui.workflowReviewMutation(p,record),/旧版脚本.*整理条目/)
 assert.throws(()=>ui.workflowDraftMutation(p,record,'修改','older-draft'),/引用.*旧版|重新引用/)
 p.workflow.current.stale=true
 assert.throws(()=>ui.workflowDraftMutation(p,record,'修改','draft-1'),/旧版|重新生成/)
 assert.throws(()=>ui.workflowReviewMutation(p,record),/旧版|重新生成/)
 assert.deepEqual(ui.workflowDraftMutation(p),{outlineVersion:6},'旧稿不妨碍按当前已确认流程重新生成')
 p.outline.status='stale'
 assert.throws(()=>ui.workflowDraftMutation(p),/确认.*流程/)
})

test('目录版本变化后旧正文另行保存，不覆盖新任务位置',()=>{
 assert.equal(typeof ui.workflowRecord,'function')
 const p=project();p.outline.version=7
 const record=ui.workflowRecord(p,draft.blocks[0])
 assert.equal(record.stale,true)
 assert.equal(record.id,'workflow-draft-1:outline-01-1')
 assert.equal(record.blockId,'outline-01-1')
 assert.equal(record.body,draft.blocks[0].body)
})

test('预览逐条显示实际引用与缺口，正文和原文中的标签不能执行',()=>{
 assert.equal(typeof ui.workflowPreviewMarkup,'function')
 const record=ui.workflowRecord(project(),{...draft.blocks[0],body:'<img src=x onerror=bad()>真实正文'})
 const dom=new JSDOM(ui.workflowPreviewMarkup(record,{number:'1.1',name:record.title}))
 try{
  assert.match(dom.window.document.body.textContent,/真实正文/)
  assert.match(dom.window.document.body.textContent,/任务书.txt.*第 3 段/s)
  assert.match(dom.window.document.body.textContent,/少潭河水库 <现场记录>/)
  assert.match(dom.window.document.body.textContent,/本轮已跳过.*缺少现状调查/)
  assert.equal(dom.window.document.querySelector('img'),null)
  assert.doesNotMatch(dom.window.document.body.textContent,/已确认专业成果/)
 }finally{dom.window.close()}
})

test('内部备注单独呈现，不混入汇报正文，旧稿兼容没有备注字段',()=>{
 const record=ui.workflowRecord(project(),{...draft.blocks[0],body:'用于汇报的正文。',internalNotes:['请用户确认范围。']})
 assert.deepEqual(record.internalNotes,['请用户确认范围。'])
 const dom=new JSDOM(ui.workflowPreviewMarkup(record,{number:'1.1',name:record.title}))
 try{
  assert.equal(dom.window.document.querySelector('.script-paragraphs').textContent,'用于汇报的正文。')
  assert.match(dom.window.document.querySelector('[data-workflow-internal-notes]').textContent,/请用户确认范围/)
  assert.deepEqual(ui.workflowRecord(project(),draft.blocks[0]).internalNotes,[])
 }finally{dom.window.close()}
})

test('工作台持续显示真实任务活动与耗时，结束后保留审阅和下载入口',t=>{
 assert.equal(typeof ui.mountWorkflowStatus,'function')
 const dom=new JSDOM('<aside id="sidebar"><header></header><div id="chatHistory"></div></aside>')
 const previous={document:globalThis.document};globalThis.document=dom.window.document
 t.after(()=>{Object.assign(globalThis,previous);dom.window.close()})
 const calls=[],p=project(),status=ui.mountWorkflowStatus(document.querySelector('#chatHistory'),{onOpen:()=>calls.push('open'),onGenerate:()=>calls.push('generate'),onDownloads:()=>calls.push('download'),onCancel:(...args)=>calls.push(args)})
 t.after(()=>status.destroy())
 p.jobs=[{id:'job-2',kind:'workflow',status:'running',started_at:new Date(Date.now()-65000).toISOString(),progress:{label:'正在读取任务书',updatedAt:new Date().toISOString()}}]
 status.update({project:p,connection:'live'})
 assert.match(document.querySelector('[data-workflow-status]').textContent,/阶段初稿.*运行中/s)
 assert.match(document.querySelector('[data-workflow-status]').textContent,/1 分 5 秒/)
 assert.match(document.querySelector('[data-workflow-status]').textContent,/正在读取任务书/)
 document.querySelector('[data-workflow-cancel]').click()
 assert.deepEqual(calls[0],['job-2','project-1'])
 p.jobs[0].status='completed';p.jobs[0].finished_at=new Date().toISOString();status.update({project:p,connection:'live'})
 document.querySelector('[data-workflow-open]').click();document.querySelector('[data-workflow-downloads]').click()
 assert.deepEqual(calls.slice(1),['open','download'])
 assert.equal(document.querySelector('[data-workflow-cancel]').hidden,true)
})

test('结构化条目呈现独立正文和备注，并携带条级修订和审阅目标',()=>{
 const p=project(),d=p.workflow.current,b=d.blocks[0]
 const first={id:b.id+'-item-1',title:'区位条件',paragraphs:['南侧与道路相邻。'],points:['保留现状出入口','衔接场外道路'],evidenceIndexes:[0]}
 const second={id:b.id+'-item-2',title:'建设范围',paragraphs:['范围待核对。'],points:[],evidenceIndexes:[]}
 Object.assign(d,{formatVersion:2,reviewedItemIds:[second.id]})
 b.items=[first,second];b.internalNotes=['请用户确认建设范围。','请用户确认建设范围。']
 const record=ui.workflowRecord(p,b,first),dom=new JSDOM(ui.workflowPreviewMarkup(record,{number:'1.1.1',name:first.title,sectionName:b.title}))
 try{
  const doc=dom.window.document
  assert.equal(record.id,first.id)
  assert.equal(record.approved,false)
  assert.equal(ui.workflowRecord(p,b,second).approved,true)
  assert.equal(doc.querySelector('[data-workflow-pane=body] h2').textContent,first.title)
  assert.deepEqual([...doc.querySelectorAll('[data-workflow-body] li')].map(node=>node.textContent),first.points)
  assert.match(doc.querySelector('[data-workflow-pane=notes] [data-workflow-notes]').textContent,/建设范围/)
  assert.doesNotMatch(doc.querySelector('[data-workflow-body]').textContent,/请用户确认/)
  assert.deepEqual(ui.workflowDraftMutation(p,record,'补区位信息',d.id),{outlineVersion:6,baseDraftId:d.id,blockId:b.id,itemId:first.id,text:'补区位信息'})
  assert.deepEqual(ui.workflowReviewMutation(p,record),{draftId:d.id,blockId:b.id,itemId:first.id})
  assert.throws(()=>ui.workflowReviewMutation(p,{...record,itemId:'missing'}),/条目/)
 }finally{dom.window.close()}
})

test('确认整稿后，未逐条点过审阅的条目也显示已审阅',()=>{
 const p=project(),draft=p.workflow.current,block=draft.blocks[0]
 const item={id:block.id+'-item-1',title:'区位',paragraphs:['现状道路。'],points:[],evidenceIndexes:[]}
 draft.formatVersion=2;draft.reviewedItemIds=[];block.items=[item]
 draft.approval={draftId:'different-draft'}
 assert.equal(ui.workflowRecord(p,block,item).approved,false)
 draft.approval={draftId:draft.id}
 assert.equal(ui.workflowRecord(p,block,item).approved,true)
})
