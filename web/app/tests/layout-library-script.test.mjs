import test from 'node:test'
import assert from 'node:assert/strict'
import {renderWorkflowItem,workflowBodyMarkdown} from '../src/workflow-content.mjs'
import {parseWorkflowResult} from '../src/workflow-contract.mjs'
import {draft} from './fixtures/outline.mjs'
const item={title:'服务比较',paragraphs:['本页比较服务配置。'],points:['设施数量按清单汇总。'],evidenceIndexes:[0],table:{columns:['对象','数量'],rows:[['<学校>','3'],['体育设施','2']]}}
test('页脚本审阅与工作稿显示真实表格，不可将未展示的数据直接送入视觉成果',()=>{
 const html=renderWorkflowItem(item);assert.match(html,/<table/);assert.match(html,/&lt;学校&gt;/);assert.match(html,/体育设施/)
 const md=workflowBodyMarkdown([item]);assert.match(md,/体育设施/);assert.match(md,/数量/)
 const figure=renderWorkflowItem({...item,table:undefined,figure:{materialId:'1221326e-03b4-4b7e-8a69-2fcd23216924',caption:'现场照片'}})
 assert.match(figure,/现场照片/);assert.match(figure,/1221326e/)
})
test('结构化图表必须有来源；多图和表格共存时完整保存给组合版式',()=>{
 const outline={flow:['01'],draft:draft('e8221326-e03b-4b7e-8a69-2fcd23216924'),waivers:[],retainedWaivers:[]}
 const body=(x)=>JSON.stringify({blocks:[{id:'outline-01-1',items:[x],internalNotes:[]}]})
 assert.throws(()=>parseWorkflowResult(body({...item,evidenceIndexes:[]}),outline,'outline-01-1',{requireStructured:true}),/来源|依据/)
 const mixed={...item,figures:[{materialId:'e8221326-e03b-4b7e-8a69-2fcd23216924',caption:'现场一'},{materialId:'1221326e-03b4-4b7e-8a69-2fcd23216924',caption:'现场二'}],presentation:{layout:'composition',note:'两张图和表格同页'}}
 const [block]=parseWorkflowResult(body(mixed),outline,'outline-01-1',{requireStructured:true}).blocks
 assert.deepEqual(block.items[0].figures,mixed.figures);assert.deepEqual(block.items[0].table,item.table)
 for(const output of [renderWorkflowItem(block.items[0]),workflowBodyMarkdown(block.items)])for(const value of ['现场一','现场二','体育设施'])assert(output.includes(value),value)
 assert.throws(()=>parseWorkflowResult(body({...mixed,figure:mixed.figures[0]}),outline,'outline-01-1',{requireStructured:true}),/结构|图片|同时/)
})

test('结构化图表、时间轴、关系图在脚本审阅与导出中保留全部数据',()=>{
 const content={...item,chart:{type:'line',title:'合成趋势',categories:['一期','二期'],series:[{name:'设施',values:[2,5]}],unit:'处'},timeline:{events:[{label:'启动',description:'资料核对'},{label:'实施',description:'建设安排'}]},diagram:{direction:'horizontal',nodes:[{id:'service',label:'公共服务'},{id:'operation',label:'运营维护'}],edges:[{from:'service',to:'operation',label:'移交'}]}}
 const outline={flow:['01'],draft:draft('e8221326-e03b-4b7e-8a69-2fcd23216924'),waivers:[],retainedWaivers:[]}
 const parse=value=>parseWorkflowResult(JSON.stringify({blocks:[{id:'outline-01-1',items:[value],internalNotes:[]}]}),outline,'outline-01-1',{requireStructured:true})
 const saved=parse(content).blocks[0].items[0]
 for(const output of [renderWorkflowItem(saved),workflowBodyMarkdown([saved])])for(const value of ['合成趋势','二期','设施','5','资料核对','建设安排','公共服务','运营维护','移交'])assert(output.includes(value),value)
 assert.throws(()=>parse({...content,evidenceIndexes:[]}),/来源|依据/)
 assert.throws(()=>parse({...content,chart:{...content.chart,series:[{name:'设施',values:[2]}]}}),/结构/)
})
