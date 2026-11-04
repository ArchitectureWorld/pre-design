import test from 'node:test'
import assert from 'node:assert/strict'
import * as content from '../src/workflow-content.mjs'

test('旧稿以一条只读正文兼容，保留原段落和资料编号',()=>{
 const block={id:'outline-01-1',title:'项目基本情况',body:'第一段。\n\n第二段。',evidenceIndexes:[0]}
 const [item]=content.workflowBlockItems(block)
 assert.deepEqual(item,{id:'outline-01-1-item-1',title:'项目基本情况',paragraphs:['第一段。','第二段。'],points:[],evidenceIndexes:[0],legacy:true})
 assert.match(content.workflowItemText(item),/^项目基本情况[\s\S]*第一段。[\s\S]*第二段。$/)
 assert.match(content.renderWorkflowItem(item),/<p>第一段。<\/p><p>第二段。<\/p>/)
 assert.equal(block.items,undefined)
})

test('结构化空节不会降级成旧正文',()=>{
 assert.deepEqual(content.workflowBlockItems({id:'outline-01-1',items:[],body:'过期内容'}),[])
})

test('备注按主题去重，并保留所有原始限制供展开',()=>{
 const scope='本轮暂缺：本次策划需要支持什么决策？请说明不同阶段的研究范围；处理方式：先采用已确认资料'
 const boundary='项目红线未提供，现有水库管理范围不能替代项目边界。'
 const time='资料时点：2020 年调查，仅适用于历史现状。'
 const extra='尚无访谈样本。'
 const groups=content.compactWorkflowNotes({internalNotes:[boundary,'项目目标待明确。'],limitations:[scope,boundary,time,extra]})
 assert.equal(groups.length,4)
 assert.match(groups.find(group=>group.details.includes(scope)).title,/范围.*目标/)
 assert.match(groups.find(group=>group.details.includes(boundary)).title,/边界.*管控/)
 assert.match(groups.find(group=>group.details.includes(time)).title,/资料/)
 assert.equal(groups.flatMap(group=>group.details).filter(value=>value===boundary).length,1)
 assert.deepEqual(new Set(groups.flatMap(group=>group.details)),new Set([scope,boundary,time,extra,'项目目标待明确。']))
 assert.ok(groups.every(group=>!group.summary.includes(scope)))
})

test('资料适用范围限制归入资料主题，短摘要保留实际适用条件',()=>{
 const note='资料仅适用于水库管理范围。'
 const [group]=content.compactWorkflowNotes({limitations:[note]})
 assert.equal(group.kind,'source')
 assert.equal(group.summary,note)
})

test('多条备注列出实际待核主题，保留带问询和处理方式的原文',()=>{
 const scope=['本次研究范围：尚未核实','本轮暂缺：本次策划主要服务什么决策或解决什么问题，成果希望达到何种深度？；处理方式：本轮暂不提供']
 const boundary=['项目红线 / 实施边界：尚未核实','用地性质（现状与规划）：尚未核实','规划管控线及适用条件：尚未核实']
 const source=['请补充调查资料的来源、时点。','该资料仅适用于历史管理范围，待核对适用条件。']
 const groups=content.compactWorkflowNotes({limitations:[...scope,...boundary,...source]})
 assert.deepEqual(Object.fromEntries(groups.map(group=>[group.kind,group.summary])),{
  scope:'待明确：研究范围、策划目标、成果要求。',
  boundary:'待核实：项目红线、实施边界、用地性质、规划管控。',
  source:'需核对：资料来源、资料时点、适用范围。',
 })
 assert.deepEqual(groups.flatMap(group=>group.details),[...scope,...boundary,...source])
})

test('只提项目边界的多条备注不额外声称存在红线缺口',()=>{
 const [group]=content.compactWorkflowNotes({limitations:['本次项目边界未核实。','项目边界资料待补。']})
 assert.equal(group.summary,'待核实：项目边界。')
})
