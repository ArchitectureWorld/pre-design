import test from 'node:test'
import assert from 'node:assert/strict'
import {compileResearchPlan,validateResearchFindings,researchPrompt,researchSkillHash} from '../src/research-matrix.mjs'
const outline=()=>({version:7,inputHash:'a'.repeat(64),flow:['03','01','04','05','11'],draft:{chapters:['01','03','04','05','11'].map(id=>({id,title:id,tasks:['当前任务'],assessment:{level:'conditional'},gaps:['访谈未完成'],cannotDo:['不能定量'],dependsOn:[]})),evidence:[{kind:'content',quote:'原件'}, {kind:'inventory'}]}})
const findings=plan=>plan.tasks.map(task=>({taskId:task.id,skillIds:[task.skillIds[0]],status:'conditional',answer:'有条件建议',conclusions:[{kind:'proposal',text:'保留方案作为备选',evidenceIndexes:[0],assumptions:['需求待验证']}],gaps:['访谈未完成']}))
test('编排保留用户汇报顺序与任务ID，研究顺序独立，并登记方向反馈而非循环执行',()=>{
 const plan=compileResearchPlan(outline())
 assert.deepEqual(plan.reportOrder,['03','01','04','05','11'])
 assert.deepEqual(plan.executionOrder,['01','03','04','05','11'])
 assert.equal(plan.tasks.length,5)
 assert.equal(plan.tasks[0].id,'outline-03-1')
 assert.ok(plan.tasks[0].skillIds.includes('C03.01'))
 assert.deepEqual(plan.feedback,[{from:['04','05'],to:'03',action:'review_direction',requiresNewVersion:true}])
 assert.match(plan.skillHash,/^[a-f0-9]{64}$/)
 assert.ok(researchPrompt(plan).includes('未经独立业务验收'))
})
test('仅编排所选任务，未入选章不强行加入；未知/无效深度失败关闭',()=>{
 const o=outline();o.flow=['04'];assert.deepEqual(compileResearchPlan(o).executionOrder,['04'])
 delete o.draft.chapters.find(c=>c.id==='04').assessment
 assert.equal(compileResearchPlan(o).tasks[0].depth,'inventory')
 o.flow=['99'];assert.throws(()=>compileResearchPlan(o),/章节/)
 o.flow=['04','04'];assert.throws(()=>compileResearchPlan(o),/重复/)
})
test('研究结论逐项绑定确认任务、该章Skill、真实内容引用和明确假设',()=>{
 const o=outline(),plan=compileResearchPlan(o),value=findings(plan)
 const result=validateResearchFindings(value,plan,o.draft.evidence)
 assert.equal(result.length,5);assert.notEqual(result,value)
 for(const mutate of [v=>v.pop(),v=>v.push(v[0]),v=>v[0].taskId='outline-08-1',v=>v[0].skillIds=['C08.01'],v=>v[0].conclusions[0].evidenceIndexes=[88],v=>v[0].conclusions[0].evidenceIndexes=[1],v=>{v[0].conclusions[0].kind='fact';v[0].conclusions[0].evidenceIndexes=[]},v=>{v[0].conclusions[0].evidenceIndexes=[];v[0].conclusions[0].assumptions=[]},v=>{v[0].status='insufficient';v[0].gaps=[]}]){
  const changed=structuredClone(value);mutate(changed);assert.throws(()=>validateResearchFindings(changed,plan,o.draft.evidence))
 }
})
test('输入不足保留真实缺口而不是伪造专业结论；旧任务深度不可默认为完整研究',()=>{
 const o=outline(),plan=compileResearchPlan(o),value=findings(plan)
 value[0]={...value[0],status:'insufficient',answer:'当前只能确认位置',conclusions:[],gaps:['需求量缺少依据']}
 assert.equal(validateResearchFindings(value,plan,o.draft.evidence)[0].status,'insufficient')
 assert.equal(plan.skillHash,researchSkillHash)
})

import {workflowTargets,parseWorkflowResult,workflowPrompt} from '../src/workflow-contract.mjs'
import {workflowRecord,workflowPreviewMarkup,workflowDraftMutation} from '../src/workflow-ui.js'
import {draft} from './fixtures/outline.mjs'
const state=()=>({version:1,status:'confirmed',flow:['01','03'],draft:draft('e8221326-e03b-4b7e-8a69-2fcd23216924')})
test('新研究模式实际进入写稿提示与解析，缺失研究不得只保存正文；旧任务兼容',()=>{
 const o=state(),plan=compileResearchPlan(o)
 const response={blocks:workflowTargets(o).map(t=>({id:t.id,body:'项目已有位置记载。',evidenceIndexes:[0]})),researchFindings:findings(plan)}
 const prompt=workflowPrompt({name:'示例'},o,{payload:{researchPlan:plan}})
 assert.match(prompt,/researchFindings/);assert.match(prompt,/C03.01/)
 const result=parseWorkflowResult(JSON.stringify(response),o,undefined,{researchPlan:plan})
 assert.equal(result.researchFindings.length,2)
 delete response.researchFindings
 assert.throws(()=>parseWorkflowResult(JSON.stringify(response),o,undefined,{researchPlan:plan}),/研究卡/)
 assert.equal(parseWorkflowResult(JSON.stringify(response),o).blocks.length,2)
})
test('用户可检查关联研究结论与假设，转义文本；正文批准不等于研究验收',()=>{
 const o=state(),plan=compileResearchPlan(o),f=findings(plan)[0];f.answer='<script>研究结果</script>'
 const block={id:'outline-01-2',sourceTaskId:'outline-01-1',chapterId:'01',sectionText:'项目正文',title:'项目概况',items:[],evidenceIndexes:[0]}
 const p={outline:o,workflow:{current:{id:'draft',version:1,outlineVersion:1,formatVersion:2,blocks:[block],research:{plan,findings:[f]},evidence:o.draft.evidence,approval:{draftId:'draft'}}}}
 const record=workflowRecord(p,block),html=workflowPreviewMarkup(record,{})
 assert.equal(record.researchFinding.taskId,f.taskId)
 assert.match(html,/研究结论/);assert.match(html,/尚未独立业务验收/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/)
 assert.equal(workflowDraftMutation(p).researchMatrix,true)
})
test('执行顺序尊重已确认依赖，未选上游显式标记而非自动扩大范围',()=>{
 const o=outline();o.draft.chapters.find(c=>c.id==='03').dependsOn=['04'];o.draft.chapters.find(c=>c.id==='04').dependsOn=['05','02']
 const p=compileResearchPlan(o)
 assert.ok(p.executionOrder.indexOf('05')<p.executionOrder.indexOf('04'))
 assert.ok(p.executionOrder.indexOf('04')<p.executionOrder.indexOf('03'))
 assert.deepEqual(p.externalDependencies,[{chapterId:'04',dependsOn:['02'],state:'not_selected_requires_existing_evidence'}])
 o.draft.chapters.find(c=>c.id==='05').dependsOn=['03']
 assert.throws(()=>compileResearchPlan(o),/循环/)
})
test('写稿不得使用关联研究卡之外的依据，防止研究与正文只是并列留痕',()=>{
 const o=state();o.draft.evidence.push({...o.draft.evidence[0],quote:'另一项有效依据'})
 const plan=compileResearchPlan(o),response={blocks:workflowTargets(o).map(t=>({id:t.id,body:'项目已有位置记载。',evidenceIndexes:[1]})),researchFindings:findings(plan)}
 assert.throws(()=>parseWorkflowResult(JSON.stringify(response),o,undefined,{researchPlan:plan}),/研究卡.*依据/)
})
test('局部改稿沿用研究来源门禁，不能以不重跑研究绕过引用边界',()=>{
 const o=state();o.draft.evidence.push({...o.draft.evidence[0],quote:'另一个来源'})
 const plan=compileResearchPlan(o),cards=findings(plan)
 const input={blocks:[{id:'outline-01-1',body:'局部正文',evidenceIndexes:[1]}]}
 assert.throws(()=>parseWorkflowResult(JSON.stringify(input),o,'outline-01-1',{existingResearchFindings:cards}),/研究卡.*依据/)
})
test('模型收到实际子能力名称而不只是不可解释的矩阵编号',()=>{
 const p=compileResearchPlan(outline()),prompt=researchPrompt(p)
 assert.ok(p.skillCatalog.some(s=>s.id==='C03.01'&&s.name==='初步发展方向与待检验假说'))
 assert.ok(p.skillCatalog.every(s=>p.tasks.some(t=>t.skillIds.includes(s.id))))
 assert.match(prompt,/发展路径比较与方向复核/)
})
