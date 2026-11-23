import test from 'node:test'
import assert from 'node:assert/strict'
import {renderWorkflowArtifact,workflowPrompt} from '../src/workflow-contract.mjs'
import {draft} from './fixtures/outline.mjs'

test('比较矩阵的可见编号与依据索引分开，按原始资料顺序对应',()=>{
 const outline={flow:['03'],draft:draft('e8221326-e03b-4b7e-8a69-2fcd23216924')}
 const input=workflowPrompt({name:'比较方向'},{...outline},{payload:{}})
 assert.match(input,/表格可见编号按资料清单从 1 开始/)
 assert.match(input,/\x60evidenceIndexes\x60 仍填从 0 开始的原始索引/)
 const sources=['现场踏勘记录','未引用的中间资料','运营备忘摘要'].map(filename=>({filename,summary:'验证用样例'}))
 const item={id:'page',title:'方向矩阵',paragraphs:[],points:[],evidenceIndexes:[0,2],table:{columns:['方向','已有依据'],rows:[['方向甲','现场踏勘 [1]'],['方向乙','运营备忘 [3]']]}}
 const block={id:'outline-03-1',chapterId:'03',title:'发展方向',items:[item],internalNotes:[],limitations:[]}
 const doc={projectName:'示例',version:1,outlineVersion:1,createdAt:'2026-11-22',flow:outline.flow,chapters:outline.draft.chapters,evidence:sources,blocks:[block],limitations:[]}
 const html=renderWorkflowArtifact(doc,'html')
 assert.match(html,/<td>方向甲<\/td><td>现场踏勘 \[1\]<\/td>/)
 assert.match(html,/<td>方向乙<\/td><td>运营备忘 \[3\]<\/td>/)
 assert.match(html,/<small>依据：\[1\]、\[3\]<\/small>/)
 assert.match(html,/<ol><li><b>现场踏勘记录<\/b>[\s\S]*?<li><b>未引用的中间资料<\/b>[\s\S]*?<li><b>运营备忘摘要<\/b>/)
})
