import test from 'node:test'
import assert from 'node:assert/strict'
import {draft} from './fixtures/outline.mjs'
const module=await import('../src/workflow-contract.mjs').catch(()=>({}))
function outline(){const value=draft('e8221326-e03b-4b7e-8a69-2fcd23216924');return {version:6,inputHash:'hash',confirmedAt:'2026-11-04T06:00:00Z',status:'confirmed',flow:['03','01'],draft:value,waivers:[{questionId:'goal',prompt:'本次目的？',reason:'本轮后补',chapterIds:['03'],version:6}],retainedWaivers:[]}}
test('阶段稿严格跟随确认流程和任务，引用来源编号，保留未知与跳过',()=>{
 assert.equal(typeof module.workflowTargets,'function');const state=outline(),targets=module.workflowTargets(state)
 assert.deepEqual(targets.map(t=>t.id),['outline-03-1','outline-01-1'])
 const body=JSON.stringify({blocks:targets.map(t=>({id:t.id,body:'资料中的历史信息，当前情况待核验。',evidenceIndexes:[0]}))})
 const blocks=module.parseWorkflowResponse(body,state)
 assert.deepEqual(blocks.map(b=>b.id),targets.map(t=>t.id));assert.equal(blocks[0].chapterId,'03');assert.equal(blocks[0].title,targets[0].title)
 assert.deepEqual(blocks[0].evidenceIndexes,[0],'首条真实依据编号0不能被当成空值删去')
 assert.ok(blocks[0].limitations.some(s=>s.includes('本轮后补')))
 assert.match(module.workflowPrompt({name:'当前项目',metadata:{}},state,{payload:{}}),/阶段初稿/)
})
test('模型不能漏任务、塞入备用章、捏造引用，修订只接受目标块',()=>{
 const state=outline(),row={id:'outline-03-1',body:'正文',evidenceIndexes:[]}
 assert.throws(()=>module.parseWorkflowResponse(JSON.stringify({blocks:[row]}),state),/任务/)
 assert.throws(()=>module.parseWorkflowResponse(JSON.stringify({blocks:[{...row,evidenceIndexes:[99]}]}),state,'outline-03-1'),/引用/)
 assert.throws(()=>module.parseWorkflowResponse(JSON.stringify({blocks:[{...row,id:'outline-08-1'}]}),state,'outline-03-1'),/任务/)
 assert.deepEqual(module.parseWorkflowResponse(JSON.stringify({blocks:[row]}),state,'outline-03-1').map(b=>b.id),['outline-03-1'])
 assert.throws(()=>module.parseWorkflowResponse('not JSON',state),/结构/)
})
test('汇报正文与内部备注独立保存，导出正文区不夹带问询记录',()=>{
 const state=outline(),blocks=module.parseWorkflowResponse(JSON.stringify({blocks:module.workflowTargets(state).map(t=>({id:t.id,body:'第一段汇报正文。\n\n第二段历史时点说明。',internalNotes:['需向委托方核实本轮目的。'],evidenceIndexes:[0]}))}),state)
 assert.equal(blocks[0].internalNotes[0],'需向委托方核实本轮目的。');assert.doesNotMatch(blocks[0].body,/委托方/)
 const doc={version:1,outlineVersion:6,projectName:'测试',createdAt:'2026-11-04',flow:state.flow,chapters:state.draft.chapters,blocks,limitations:[],evidence:[{...state.draft.evidence[0],filename:'任务书.txt'}],reviewedBlockIds:[]}
 const html=module.renderWorkflowArtifact(doc,'html'),main=html.match(/<main>([\s\S]+)<\/main>/)[1]
 assert.match(main,/<p>第一段汇报正文。<\/p><p>第二段历史时点说明。<\/p>/);assert.doesNotMatch(main,/需向委托方/);assert.match(html,/<h2>内部备注<\/h2>/)
 const md=module.renderWorkflowArtifact(doc,'md');assert.doesNotMatch(md.split('## 内部备注')[0],/需向委托方/)
})
test('导出沿用真实章顺序，带来源、限制、审阅标记并转义模型HTML',()=>{
 const state=outline(),doc={id:'id',version:1,outlineVersion:6,createdAt:'2026-11-04T06:10:00Z',projectName:'项目<script>',flow:['03','01'],chapters:state.flow.map(id=>state.draft.chapters.find(c=>c.id===id)),blocks:module.parseWorkflowResponse(JSON.stringify({blocks:module.workflowTargets(state).map(t=>({id:t.id,body:'<script>alert(1)</script>',evidenceIndexes:[0]}))}),state),limitations:['边界未提供'],evidence:[{...state.draft.evidence[0],filename:'任务书.txt'}],reviewedBlockIds:[]}
 const html=module.renderWorkflowArtifact(doc,'html'),md=module.renderWorkflowArtifact(doc,'md')
 assert.ok(html.indexOf('项目发展方向')<html.indexOf('项目基本情况'));assert.match(html,/待审阅/);assert.match(html,/边界未提供/);assert.match(html,/任务书.txt/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/)
 assert.match(md,/本轮后补/);assert.match(md,/第1行/);assert.match(md,/阶段初稿/)
})

const item=(title,fields={})=>({title,paragraphs:[],points:['项目名称：示例水库'],evidenceIndexes:[0],...fields})
const section=(id,items)=>({id,items,internalNotes:[]})
const reply=(...blocks)=>JSON.stringify({blocks})

test('单页导出直接使用节标题，多页才有编号完整的条标题，正文与引用完整保留',()=>{
 const state=outline(),blocks=module.parseWorkflowResponse(reply(section('outline-03-1',[item('单页额外标题')]),section('outline-01-1',[item('条甲'),item('条乙')])),state)
 const doc={id:'draft',version:4,outlineVersion:6,projectName:'测试',createdAt:'2026-11-04',flow:state.flow,chapters:state.draft.chapters,blocks,limitations:[],evidence:[{filename:'原件.pdf'}]}
 const html=module.renderWorkflowArtifact(doc,'html'),md=module.renderWorkflowArtifact(doc,'md')
 assert.doesNotMatch(html,/<h4>[^<]*单页额外标题/);assert.doesNotMatch(md,/####[^\n]*单页额外标题/)
 assert.match(html,/<h4>2\.1\.1 条甲<\/h4>/);assert.match(md,/#### 2\.1\.2 条乙/)
 assert.equal((html.match(/项目名称：示例水库/g)??[]).length,3)
 assert.match(md,/依据：\[1\]/)
})

test('结构化整稿按确认的节序返回，每节按正文条数编号并汇总依据',()=>{
 const state=outline(),blocks=module.parseWorkflowResponse(reply(
  section('outline-01-1',[item('项目名称'),item('区位',{paragraphs:[],points:['与城市的空间联系'],evidenceIndexes:[]})]),
  section('outline-03-1',[item('发展方向')]),
 ),state,undefined,{requireStructured:true})
 assert.deepEqual(blocks.map(b=>b.id),['outline-03-1','outline-01-1'])
 assert.deepEqual(blocks[1].items.map(row=>row.id),['outline-01-1-item-1','outline-01-1-item-2'])
 assert.deepEqual(blocks[1].evidenceIndexes,[0])
 assert.match(blocks[1].body,/项目名称：示例水库/)
 assert.match(blocks[1].body,/- 与城市的空间联系/)
})

test('新稿拒绝旧正文格式、空正文、超限字段、跨节ID及越界依据',()=>{
 const state=outline(),blockId='outline-01-1',options={requireStructured:true}
 assert.throws(()=>module.parseWorkflowResponse(reply({id:blockId,body:'旧正文',evidenceIndexes:[]}),state,blockId,options),/结构/)
 assert.throws(()=>module.parseWorkflowResponse(reply(section(blockId,[item('仅段落',{paragraphs:['项目名称为示例，类型为片区策划，位于某区。'],points:[]})])),state,blockId,options),/要点式正文/)
 for(const items of [[],Array.from({length:9},()=>item('多余')),[
   item('空正文',{paragraphs:[],points:[]})
 ],[item('字'.repeat(101))],[item('超长要点',{points:['字'.repeat(501)]})],[item('过多段落',{paragraphs:['1','2','3','4']})]]){
  assert.throws(()=>module.parseWorkflowResponse(reply(section(blockId,items)),state,blockId,options),/结构/)
 }
 assert.throws(()=>module.parseWorkflowResponse(reply(section(blockId,[item('跨节',{id:'outline-03-1-item-1'})])),state,blockId,options),/条目/)
 assert.throws(()=>module.parseWorkflowResponse(reply(section(blockId,[item('越界',{evidenceIndexes:[99]})])),state,blockId,options),/引用/)
})

test('条级模型返回须显式绑定目标ID，且只允许返回一条',()=>{
 const state=outline(),blockId='outline-01-1',itemId='outline-01-1-item-2',options={requireStructured:true,itemId}
 const revised=item('项目区位',{id:itemId})
 const blocks=module.parseWorkflowResponse(reply(section(blockId,[revised])),state,blockId,options)
 assert.deepEqual(blocks[0].items,[revised])
 for(const items of [[item('缺少ID')],[item('错误ID',{id:'outline-01-1-item-1'})],[revised,revised]]){
  assert.throws(()=>module.parseWorkflowResponse(reply(section(blockId,items)),state,blockId,options),/条目/)
 }
})

test('结构化导出保留每条的标题、列表和各自引用，并安全转义正文',()=>{
 const state=outline()
 const blocks=module.parseWorkflowResponse(reply(
  section('outline-01-1',[item('项目名称'),item('项目区位<script>',{points:['<img src=x onerror=alert(1)>'],evidenceIndexes:[]})]),
  section('outline-03-1',[item('发展方向')]),
 ),state,undefined,{requireStructured:true})
 const doc={version:2,outlineVersion:6,projectName:'测试',createdAt:'2026-11-04',flow:state.flow,chapters:state.draft.chapters,blocks,limitations:[],evidence:state.draft.evidence,reviewedBlockIds:[],reviewedItemIds:['outline-01-1-item-1']}
 const html=module.renderWorkflowArtifact(doc,'html')
 assert.match(html,/项目区位&lt;script&gt;/)
 assert.match(html,/<li>&lt;img src=x onerror=alert\(1\)&gt;<\/li>/)
 assert.doesNotMatch(html,/<script>|<img/)
 assert.equal((html.match(/依据：\[1\]/g)??[]).length,2)
 const md=module.renderWorkflowArtifact(doc,'md')
 assert.match(md,/#### .*项目名称/)
 assert.match(md,/- &lt;img src=x onerror=alert\(1\)&gt;/)
})

test('结构化模型不可用换行把标题拆成多个汇报主题',()=>{
 const state=outline(),blockId='outline-01-1'
 assert.throws(()=>module.parseWorkflowResponse(reply(section(blockId,[item('项目名称\n项目区位')])),state,blockId,{requireStructured:true}),/结构/)
})

test('修订提示只给出被选条的旧正文，并将模型返回绑定到同一条',()=>{
 const state=outline(),blockId='outline-01-1',itemId='outline-01-1-item-2'
 const blocks=module.parseWorkflowResponse(reply(section(blockId,[
  item('项目名称',{paragraphs:['相邻条独有文字']}),
  item('项目区位',{paragraphs:['被选条旧正文']}),
 ])),state,blockId,{requireStructured:true})
 const prompt=module.workflowPrompt({name:'测试项目'},state,{payload:{blockId,itemId,text:'补充已核区位'}},{blocks})
 assert.match(prompt,/被选条旧正文/)
 assert.match(prompt,/补充已核区位/)
 assert.match(prompt,/"id":"outline-01-1-item-2"/)
 assert.doesNotMatch(prompt,/相邻条独有文字/)
})

test('导出从条级审阅推导节和全稿状态，独立保留整稿确认',()=>{
 const state=outline(),id='draft-1'
 const blocks=module.parseWorkflowResponse(reply(
  section('outline-03-1',[item('发展方向')]),
  section('outline-01-1',[item('项目名称'),item('项目区位')]),
 ),state,undefined,{requireStructured:true})
 const doc={id,version:2,outlineVersion:6,projectName:'测试',createdAt:'2026-11-04',flow:state.flow,chapters:state.draft.chapters,blocks,limitations:[],evidence:state.draft.evidence,reviewedBlockIds:[],reviewedItemIds:['outline-01-1-item-1','outline-01-1-item-2','outline-03-1-item-1']}
 for(const format of ['md','html']){
  const reviewed=module.renderWorkflowArtifact(doc,format)
  assert.match(reviewed,/已审阅阶段稿/)
  assert.equal((reviewed.match(/本节已审阅/g)??[]).length,2)
  assert.doesNotMatch(reviewed,/已确认阶段稿|待审阅/)
  const partial=module.renderWorkflowArtifact({...doc,reviewedItemIds:doc.reviewedItemIds.slice(1)},format)
  assert.match(partial,/阶段初稿 · 待审阅/)
  assert.equal((partial.match(/本节待审阅/g)??[]).length,1)
  assert.equal((partial.match(/本条待审阅/g)??[]).length,1)
  const approved=module.renderWorkflowArtifact({...doc,reviewedItemIds:[],approval:{draftId:id}},format)
  assert.match(approved,/已确认阶段稿/)
  assert.match(approved,/本条随整稿确认/)
  assert.doesNotMatch(approved,/待审阅/)
 }
})
