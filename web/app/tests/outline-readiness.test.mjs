import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {draft,readFixture} from './fixtures/outline.mjs'
import * as contract from '../src/outline-contract.mjs'
import {outlineMarkup} from '../src/outline-view.js'
const file={id:'a3a94266-8b52-4ffb-bfef-9377f98e497d',filename:'任务书.txt',sha256:'a'.repeat(64),bytes:12,sourceRelativePath:'原始资料/a/任务书.txt'}
function limited(){const value=draft(file.id);value.conditions=['study_area','project_boundary','land_use','planning_controls'].map(id=>({id,status:'unverified',detail:'现有材料未核实本次项目的对应条件',evidenceIndexes:[]}));for(const c of value.chapters)Object.assign(c,{readiness:'limited',canDo:['整理历史资料和缺口'],cannotDo:['形成场地可开发结论'],unlockWhen:['取得本项目边界和用途依据'],requires:[]});return value}
const parse=value=>contract.parseOutline(JSON.stringify(value),[file],[readFixture(file)])
test('章节适用性与可执行性分开；缺少项目边界不能宣称空间章已就绪',()=>{
 const value=limited();assert.equal(parse(value).chapters[7].readiness,'limited')
 value.chapters[7].readiness='ready';value.chapters[7].cannotDo=[]
 assert.throws(()=>parse(value),/前置条件|资料/)
})
test('已上传和元数据不能作为关键条件具备的证明',()=>{
 const value=limited();value.evidence[0].kind='inventory';value.conditions[0].status='supported';value.conditions[0].evidenceIndexes=[0]
 assert.throws(()=>parse(value),/内容依据/)
 value.conditions[0].status='unverified';value.conditions.push(value.conditions[0]);assert.throws(()=>parse(value))
})
test('确认目录后仍拦截资料不足的任务；按旧专业模块实际含义路由而非章号碰巧相同',()=>{
 const value=limited();value.questions=[]
 const state={status:'confirmed',draft:value}
 assert.throws(()=>contract.assertOutlineExecutable(state,'research',{moduleIds:['6.01']}),/空间布局与建设方案/)
 value.chapters[0].readiness='ready';value.chapters[0].cannotDo=[]
 assert.doesNotThrow(()=>contract.assertOutlineExecutable(state,'research',{moduleIds:['1.01']}))
 assert.throws(()=>contract.assertOutlineExecutable(state,'research',{moduleIds:['1.01','6.01']}))
 assert.throws(()=>contract.assertOutlineExecutable(state,'research',{moduleIds:['9.99']}))
 for(const kind of ['report','confirm','annotations'])assert.throws(()=>contract.assertOutlineExecutable(state,kind,{}))
 assert.equal(contract.outlineAllowsWrites(state),false)
})
test('全部62个专业模块都有明确章节映射，不能漏过门禁',async()=>{
 const raw=await readFile(new URL('../../../src/research-v2/catalog-data.ts',import.meta.url),'utf8')
 const ids=[...raw.split('"portTypes"')[0].matchAll(/^    \["([1-8]\.0[1-9])","/gm)].map(m=>m[1])
 assert.equal(ids.length,62)
 assert.deepEqual(Object.keys(contract.RESEARCH_OUTLINE_CHAPTERS??{}).sort(),ids.sort())
 assert.equal(contract.RESEARCH_OUTLINE_CHAPTERS['4.01'],'05')
 assert.equal(contract.RESEARCH_OUTLINE_CHAPTERS['1.07'],'06')
})
test('首屏直接呈现关键条件和每章能力，不用展开才能发现全部仅可梳理',()=>{
 const html=outlineMarkup({version:3,status:'draft',draft:limited()})
 assert.match(html,/data-outline-conditions/);assert.match(html,/项目红线/);assert.match(html,/用地性质/)
 assert.match(html,/<summary>08 空间布局与建设方案 · 仅可先梳理<\/summary>/)
 assert.match(html,/现在可做/);assert.match(html,/暂不能做/);assert.match(html,/启动条件/)
 assert.doesNotMatch(html,/<summary>[^<]+ · 纳入<\/summary>/)
})
test('全部排除或部分排除的章节不能放开不限定对象的专业写入',()=>{
 const value=limited();value.questions=[]
 for(const c of value.chapters){c.disposition='include';c.readiness='ready';c.cannotDo=[]}
 for(const c of value.conditions)c.status='supported'
 const state={status:'confirmed',draft:value}
 assert.equal(contract.outlineAllowsWrites(state),true)
 value.chapters[7].disposition='exclude'
 assert.equal(contract.outlineAllowsWrites(state),false)
 assert.throws(()=>contract.assertOutlineExecutable(state,'confirm'))
 for(const c of value.chapters)c.disposition='exclude'
 assert.equal(contract.outlineAllowsWrites(state),false)
})
