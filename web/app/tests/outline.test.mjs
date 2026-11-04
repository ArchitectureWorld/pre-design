import test from 'node:test'
import assert from 'node:assert/strict'
import { draft,readFixture } from './fixtures/outline.mjs'
import {materialReadReceipts} from '../../worker/material-read-receipts.mjs'
const outline=await import('../src/outline-contract.mjs').catch(()=>({}))
const material={id:'a3a94266-8b52-4ffb-bfef-9377f98e497d',filename:'任务书.txt',sha256:'a'.repeat(64),bytes:12,sourceRelativePath:'原始资料/a/任务书.txt'}
test('十一章草案保留竞品依赖、尺度和可追溯资料，拒绝缺章或伪造引用',()=>{
 assert.equal(typeof outline.parseOutline,'function')
 const input=draft(material.id),parse=value=>outline.parseOutline(JSON.stringify(value),[material],[readFixture(material)])
 assert.equal(parse(input).chapters[4].title,'竞品与案例分析')
 for(const change of [x=>x.chapters.pop(),x=>x.chapters[4].dependsOn=[],x=>x.evidence[0].materialId='fake',x=>x.chapters[0].basis=['fake'],x=>x.chapters[0].title='旧目录',x=>x.questions.push({...x.questions[0]})]){const value=structuredClone(input);change(value);assert.throws(()=>parse(value))}
 assert.throws(()=>outline.parseOutline('这是一段没有草案的普通回复',[material]))
 assert.throws(()=>outline.parseOutline(JSON.stringify(input),[{...material,filename:'地形.dwg'}]),/OUTLINE/)
})
test('确认只绑定最新、无阻断疑点、资料未变化的具体版本',()=>{
 assert.equal(typeof outline.assertOutlineConfirmable,'function')
 const state={version:2,inputHash:'a'.repeat(64),status:'draft',flow:['03'],flowReviewed:true,draft:draft(material.id)}
 assert.throws(()=>outline.assertOutlineConfirmable(state,{version:2,inputHash:state.inputHash}),/疑点/)
 state.draft.questions=[]
 assert.doesNotThrow(()=>outline.assertOutlineConfirmable(state,{version:2,inputHash:state.inputHash}))
 assert.throws(()=>outline.assertOutlineConfirmable(state,{version:1,inputHash:state.inputHash}),/版本/)
 state.status='stale';assert.throws(()=>outline.assertOutlineConfirmable(state,{version:2,inputHash:state.inputHash}),/资料/)
 state.status='draft';state.busy=true;assert.throws(()=>outline.assertOutlineConfirmable(state,{version:2,inputHash:state.inputHash}),/处理中/)
})
test('资料内容必须来自实际成功读取的页行和原文；元数据不能冒充影像理解；流程不得成环',()=>{
 const value=draft(material.id)
 assert.throws(()=>outline.parseOutline(JSON.stringify(value),[material],[]),/读取/)
 const reads=[{sourceRelativePath:'原始资料/a/任务书.txt',contentHash:material.sha256,kind:'text',status:'ok',startLine:1,endLine:1,text:'任务书提供项目所在地。'}]
 const file={...material,sourceRelativePath:reads[0].sourceRelativePath}
 value.evidence[0]={...value.evidence[0],quote:'任务书提供项目所在地。',startLine:1,endLine:1}
 assert.doesNotThrow(()=>outline.parseOutline(JSON.stringify(value),[file],reads))
 value.evidence[0].startLine=999999;assert.throws(()=>outline.parseOutline(JSON.stringify(value),[file],reads))
 value.evidence[0].startLine=1;value.evidence[0].summary='原文总结';value.evidence[0].quote='原文没有的话';assert.throws(()=>outline.parseOutline(JSON.stringify(value),[file],reads))
 value.evidence[0].quote='任务书提供项目所在地。';value.chapters[2].dependsOn=['05'];assert.throws(()=>outline.parseOutline(JSON.stringify(value),[file],reads),/循环/)
})
test('读取凭据只接受对应read工具的成功结果，不接受模型声明或失败工具内容',()=>{
 const value={path:'原始资料/a.pdf',status:'ok',contentHash:material.sha256,pages:[{page:6,text:'实际原文'}]},result={type:'tool/result',data:{message:{toolCallId:'call1',content:[{type:'text',text:JSON.stringify(value)}],isError:false}}}
 assert.deepEqual(materialReadReceipts([result]),[])
 const call={type:'tool/call',data:{callId:'call1',name:'preplanning_read_material'}}
 const reads=materialReadReceipts([call,result]);assert.equal(reads[0].pages[0].page,6);assert.equal(reads[0].sourceRelativePath,value.path)
 result.data.message.isError=true;assert.deepEqual(materialReadReceipts([call,result]),[])
})
test('扫描PDF实际读取但需要OCR时可形成带缺口的草案，不能作为内容依据',()=>{
 const file={...material,filename:'扫描.pdf',sourceRelativePath:'原始资料/扫描.pdf'},value=draft(file.id)
 value.evidence[0].kind='inventory'
 const events=[{type:'tool/call',data:{name:'preplanning_read_material',callId:'scan'}},{type:'tool/result',data:{message:{toolCallId:'scan',isError:false,content:[{type:'text',text:JSON.stringify({path:file.sourceRelativePath,contentHash:file.sha256,status:'needs_ocr',pages:[{page:1,text:'',needsOcr:true}]})}]}}}]
 const receipts=materialReadReceipts(events),parsed=outline.parseOutline(JSON.stringify(value),[file],receipts)
 assert.match(parsed.chapters[0].gaps.join(' '),/OCR/)
 value.evidence[0].kind='content';value.evidence[0].pages=[1]
 assert.throws(()=>outline.parseOutline(JSON.stringify(value),[file],receipts))
})
