import test from 'node:test'
import assert from 'node:assert/strict'
import {draft} from './fixtures/outline.mjs'
import * as planning from '../src/outline-planning.mjs'

const source={jobId:'chat-1',responseHash:'hash',dossierRevision:4}
const dossier={revision:4,hash:'hash-4'}
function scenario(){
 const original=draft('b48533aa-7077-470f-be3b-0a66b3a9f55b')
 original.chapters[2].tasks=['核查日常管护需求','调查村内教育条件']
 return {original,plan:planning.proposedPlan(original,{source,dossier})}
}
test('就地修改、采纳和暂缓分别留痕，提交只采用当前勾选任务并继承缺口',()=>{
 const {original,plan}=scenario()
 const a=planning.chooseTask(plan,{chapterId:'03',index:0,action:'adopt',text:'核查村民用水与巡护的共用点位'})
 const b=planning.chooseTask(a,{chapterId:'03',index:1,action:'defer'})
 assert.deepEqual(plan.entries['03'].map(x=>x.state),['suggested','suggested'])
 assert.equal(b.revision,2);assert.equal(b.entries['03'][0].original,'核查日常管护需求')
 const checked=planning.bindSubmittedTasks(structuredClone(original),b,['03'])
 assert.deepEqual(checked.chapters[2].tasks,['核查村民用水与巡护的共用点位'])
 assert.ok(checked.chapters[2].gaps.some(s=>s.includes('调查村内教育条件')))
 assert.throws(()=>planning.validatePlanSubmission(planning.chooseTask(b,{chapterId:'03',index:0,action:'defer'}),['03']),/全部暂缓/)
 assert.equal(planning.chooseTask(b,{chapterId:'03',index:1,action:'restore'}).entries['03'][1].state,'suggested')
})
test('章内反馈只改模型列出的受影响章，保留其他章节、人工决定和证据边界',()=>{
 const {original,plan}=scenario(),accepted=planning.chooseTask(plan,{chapterId:'03',index:0,action:'adopt'})
 const change={changes:[{id:'03',reason:'聚焦管护',tasks:['对照管护时段'],evidenceIndexes:[0],questions:['是否先核查用水？']},{id:'04',reason:'跟随方向调整访谈',tasks:['访谈管护人员和村民'],evidenceIndexes:[0],questions:[]}]}
 const {draft:next,plan:edited}=planning.adjustChapters(original,accepted,JSON.stringify(change),'03')
 assert.deepEqual(edited.changed,['03','04']);assert.deepEqual(edited.source,source)
 assert.deepEqual(next.chapters[1],original.chapters[1]);assert.deepEqual(next.conditions,original.conditions)
 assert.ok(edited.entries['03'].some(e=>e.state==='adopted'&&e.text==='核查日常管护需求'))
 assert.deepEqual(edited.entries['04'].map(x=>x.text),['访谈管护人员和村民'])
 assert.deepEqual(edited.questions['03'],['是否先核查用水？'])
 assert.throws(()=>planning.adjustChapters(original,accepted,JSON.stringify(change),'02'),/选中/)
 change.changes[1].evidenceIndexes=[17]
 assert.throws(()=>planning.adjustChapters(original,accepted,JSON.stringify(change),'03'),/依据/)
})
