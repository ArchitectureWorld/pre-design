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
test('结构化图表必须有来源；图表与照片同页尚不支持时明确拒绝，不能漏掉其中一种',()=>{
 const outline={flow:['01'],draft:draft('e8221326-e03b-4b7e-8a69-2fcd23216924'),waivers:[],retainedWaivers:[]}
 const body=(x)=>JSON.stringify({blocks:[{id:'outline-01-1',items:[x],internalNotes:[]}]})
 assert.throws(()=>parseWorkflowResult(body({...item,evidenceIndexes:[]}),outline,'outline-01-1',{requireStructured:true}),/来源|依据/)
 assert.throws(()=>parseWorkflowResult(body({...item,figure:{materialId:'e8221326-e03b-4b7e-8a69-2fcd23216924',caption:'现场'}}),outline,'outline-01-1',{requireStructured:true}),/同时|拆/)
})
