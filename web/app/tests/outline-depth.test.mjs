import test from 'node:test'
import assert from 'node:assert/strict'
import {draft,readFixture} from './fixtures/outline.mjs'
import {parseOutline,assertOutlineExecutable,outlinePrompt} from '../src/outline-contract.mjs'
import {chapterCapabilityLabel,outlineMarkup} from '../src/outline-view.js'
import {chapterPlanMarkup} from '../src/outline-planning-ui.js'
import {proposedPlan} from '../src/outline-planning.mjs'

const file={id:'5d0bff32-5016-4b33-9c18-34252eee801e',filename:'任务书.txt',sha256:'e'.repeat(64),bytes:300,sourceRelativePath:'原始资料/任务书.txt'}
const parse=value=>parseOutline(JSON.stringify(value),[file],[readFixture(file)],{requireAssessment:true})
function assessment(){
 const d=draft(file.id)
 for(const c of d.chapters)c.assessment={level:'inventory',evidenceIndexes:[0]}
 const site=d.chapters.find(c=>c.id==='06')
 Object.assign(site,{reason:'先梳理现状资料和研究边界。',canDo:['按已知条件组织现场调查'],cannotDo:['确定工程容量'],unlockWhen:['提供实测现状和用地条件'],requires:[],assessment:{level:'conditional',evidenceIndexes:[0]}})
 return d
}
test('条件策划有独立的成果深度和原文依据，旧研究执行器不因此取得整章写入许可',()=>{
 const d=parse(assessment()),site=d.chapters.find(c=>c.id==='06')
 assert.equal(site.assessment.level,'conditional')
 assert.deepEqual(site.requires,[])
 assert.equal(chapterCapabilityLabel(site),'可做条件策划')
 const outline={version:1,status:'confirmed',flow:['06'],draft:d,waivers:[],retainedWaivers:[]}
 assert.throws(()=>assertOutlineExecutable(outline,'research',{moduleIds:['1.02']}),/场地现状/)
 outline.planning=proposedPlan(d,{source:null,dossier:null})
 const html=chapterPlanMarkup(outline,site,[file])
 for(const value of ['可做条件策划',site.canDo[0],site.cannotDo[0],file.filename,'第 1—1 行'])assert.ok(html.includes(value),value)
 assert.match(outlineMarkup(outline,[file]),/可做条件策划/)
})
test('真实内容引用、资料适用性和任务精度分别校验',()=>{
 const d=assessment(),site=d.chapters[5]
 site.assessment.evidenceIndexes=[62];assert.throws(()=>parse(d),/依据/)
 site.assessment.evidenceIndexes=[0];d.evidence[0].kind='inventory';assert.throws(()=>parse(d),/依据/)
 d.evidence[0].kind='content';site.assessment.level='quantitative';site.requires=['project_boundary']
 assert.throws(()=>parse(d),/前置条件/)
 d.conditions[1]={id:'project_boundary',status:'supported',detail:'本次委托书有明确边界。',evidenceIndexes:[0]}
 assert.equal(parse(d).chapters[5].assessment.level,'quantitative')
})
test('新任务必须逐章判定，历史草案按原规则读取',()=>{
 const d=assessment();delete d.chapters[6].assessment
 assert.throws(()=>parse(d),/深度/)
 for(const c of d.chapters)delete c.assessment
 assert.doesNotThrow(()=>parseOutline(JSON.stringify(d),[file],[readFixture(file)]))
 assert.match(outlinePrompt({history:[]}),/A03/)
})
test('资料梳理就绪只覆盖约定的成果深度，不能放行不受深度约束的专业执行器',()=>{
 const d=assessment()
 Object.assign(d.chapters[0],{readiness:'ready',cannotDo:[]})
 const current={status:'confirmed',flow:['01'],draft:parse(d)}
 assert.throws(()=>assertOutlineExecutable(current,'research',{moduleIds:['1.01']}),/资料梳理/)
})
test('已核实条件不能作为缺资料重复追问，仍可问独立决策',()=>{
 const d=assessment()
 d.conditions[1]={id:'project_boundary',status:'supported',detail:'本次项目边界已另行明确。',evidenceIndexes:[0]}
 const q={id:'boundary',conditionId:'project_boundary',prompt:'请提供本次项目边界。',reason:'确定研究对象。',chapterIds:['06'],blocking:true}
 d.questions=[q];assert.throws(()=>parse(d),/重复询问/)
 d.questions=[{...q,intent:'decision',id:'survey',prompt:'已明确边界，是否追加界外走访？'}]
 assert.equal(parse(d).questions[0].id,'survey')
 d.questions=[{...q,intent:'clarification',openIssue:'还未确定能否进入东侧调查点。',prompt:'东侧调查点本周可否进入？'}]
 assert.equal(parse(d).questions[0].openIssue,'还未确定能否进入东侧调查点。')
 delete d.questions[0].openIssue
 assert.throws(()=>parse(d),/尚缺/)
})

test('重新推荐可随证据调整章组合，已提交的用户顺序继续沿用',async()=>{
 const store=await import('../src/outline-store.mjs')
 assert.equal(typeof store.nextOutlineFlow,'function')
 const d=assessment()
 for(const c of d.chapters)c.disposition=['01','06'].includes(c.id)?'include':'defer'
 const prior={flow:['03','01'],flowReviewed:false,planning:{source:null}}
 assert.deepEqual(store.nextOutlineFlow(prior,d,{planningMode:'recommend'}),['01','06'])
 const submitted={...prior,planning:{source:null,submittedFlow:true}}
 assert.deepEqual(store.nextOutlineFlow(submitted,d,{planningMode:'recommend'}),['03','01'])
 assert.deepEqual(store.nextOutlineFlow(prior,d,{planningMode:'check',flow:['06','01']}),['06','01'])
})
