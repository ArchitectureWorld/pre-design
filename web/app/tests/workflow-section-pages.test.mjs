import test from 'node:test'
import assert from 'node:assert/strict'
import * as content from '../src/workflow-content.mjs'
import {workflowTargets,parseWorkflowResult,renderWorkflowArtifact} from '../src/workflow-contract.mjs'
import {clientReportHtml} from '../src/client-report.mjs'
import {workflowRecord,workflowPreviewMarkup} from '../src/workflow-ui.js'
import {visualPageMarkup} from '../src/workflow-visual-view.mjs'
import {draft} from './fixtures/outline.mjs'

const outline={flow:['01'],version:3,status:'confirmed',draft:draft('e8221326-e03b-4b7e-8a69-2fcd23216924'),waivers:[],retainedWaivers:[]}
const options={requireReport:true,requireStructured:true,sectionPages:true}
const section=(i,heading,sectionText)=>({id:'outline-01-'+i,heading,sectionText,sectionEvidenceIndexes:[0],
 items:[{title:i===1?'少潭河水库区位':'沙河支流',paragraphs:[i===1?'水库坐落在旧街街。':'少潭河汇入沙河水系。'],points:[i===1?'行政归属为武汉市新洲区。':'少潭河是沙河的支流。'],presentation:{layout:'focus',note:'用地名层级标出项目位置。'},evidenceIndexes:[0]}],
 internalNotes:['待核对项目实施边界。']})
const first=()=>section(1,'地理位置','少潭河水库位于湖北省武汉市新洲区旧街街。')
const second=()=>section(2,'水系归属','少潭河水库位于沙河支流少潭河上。')
const parse=(...blocks)=>parseWorkflowResult(JSON.stringify({reportTitle:'少潭河水库概况',blocks}),outline,undefined,options)

test('单个已确认研究任务可产生两节独立正文，每条页脚本另有结论、上屏内容和呈现方式',()=>{
 const targets=workflowTargets(outline,{sectionPages:true})
 assert.equal(targets.length,2);assert.equal(targets[0].sourceTaskId,targets[1].sourceTaskId)
 assert.throws(()=>parse(first()),/完整|两节/)
 assert.throws(()=>parse(first(),{...second(),heading:first().heading}),/不同|重复/)
 const {blocks}=parse(first(),second());assert.equal(blocks.length,2)
 assert.equal(blocks[1].sectionText,second().sectionText);assert.equal(blocks[1].items[0].presentation.layout,'focus')
 const doc={formatVersion:2,id:'draft',version:4,outlineVersion:3,flow:['01'],createdAt:'2026-11-14',clientReport:{title:'少潭河水库概况',sectionPages:true},chapters:[{id:'01',title:'项目基本情况'}],blocks,evidence:[{filename:'位置摘录.txt',locator:'第2行'}],limitations:[]}
 const project={outline,workflow:{current:doc}},b=blocks[0],rec=workflowRecord(project,b),page=workflowRecord(project,b,b.items[0])
 const sectionHtml=workflowPreviewMarkup(rec,{number:'1',name:b.title}),scriptHtml=workflowPreviewMarkup(page,{number:'1',name:page.title})
 assert.match(sectionHtml,/汇报正文/);assert(sectionHtml.includes(b.sectionText));assert(!sectionHtml.includes(b.items[0].points[0]))
 assert.match(scriptHtml,/本页结论/);assert.match(scriptHtml,/上屏内容/);assert(scriptHtml.includes(b.items[0].presentation.note));assert(!scriptHtml.includes(b.sectionText))
 const pdf=clientReportHtml(doc);assert(pdf.includes(b.sectionText));assert(!pdf.includes(b.items[0].points[0]));assert(!pdf.includes(b.items[0].presentation.note))
 assert(pdf.includes(b.sectionText+' <sup'));assert(pdf.includes('资料来源'))
 for(const fmt of ['md','html']){const output=renderWorkflowArtifact(doc,fmt);assert(output.includes(b.sectionText));assert(output.includes(b.items[0].points[0]));assert(output.includes('内部备注'))}
 const visual=visualPageMarkup({id:'visual',number:1,chapterTitle:'项目基本情况',sectionTitle:b.title,itemCount:1,item:b.items[0],layout:'focus'})
 assert(visual.includes(b.items[0].title));assert(visual.includes(b.items[0].points[0]));assert(!visual.includes(b.sectionText));assert(!visual.includes(b.items[0].presentation.note))
})
test('拦截截图中夹在事实后面的研究提示、空泛标题及逐字复制的页脚本',()=>{
 for(const leaked of ['少潭河水库位于新洲区；后续判断宜分别对应水系影响。','少潭河属于沙河水系，不能据此将整个水库划为项目范围。','建议先补充适用底图，再与委托方确认。']){
  assert.throws(()=>parse({...first(),sectionText:leaked},second()),/正文|备注/)
  const s=first();s.items[0].points=[leaked];assert.throws(()=>parse(s,second()),/正文|备注/)
 }
 for(const heading of ['本阶段的决策重点','区位联系与判断尺度'])assert.throws(()=>parse({...first(),heading},second()),/标题/)
 const s=first();s.items[0].paragraphs=[s.sectionText];assert.throws(()=>parse(s,second()),/复制|重复/)
 assert.throws(()=>parse({...first(),heading:'少潭河片区机会摸底',sectionText:'本阶段适合推进问题筛选。'},second()),/项目基本情况/)
 const copy=first();copy.sectionText=copy.items[0].points.join('。')
 assert.throws(()=>parseWorkflowResult(JSON.stringify({blocks:[{id:copy.id,items:copy.items,internalNotes:[]}]}),outline,copy.id,{...options,itemId:copy.id+'-item-1',existingSectionText:copy.sectionText}),/复制|重复/)
})
test('编号按同级实际数量逐级跳过单项，首个并列项仍为1',()=>{
 assert.equal(typeof content.outlineNumber,'function')
 assert.equal(content.outlineNumber('',0,1),'');assert.equal(content.outlineNumber('',0,2),'1')
 assert.equal(content.outlineNumber('2',0,1),'2');assert.equal(content.outlineNumber('2',0,2),'2.1')
 assert.equal(content.outlineNumber('2.1',0,1),'2.1');assert.equal(content.outlineNumber('2.1',1,3),'2.1.2')
})
