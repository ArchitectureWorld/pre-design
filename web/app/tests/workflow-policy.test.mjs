import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {workflowTargets,parseWorkflowResult} from '../src/workflow-contract.mjs'
import {draft} from './fixtures/outline.mjs'
import {publicBusinessData} from '../src/research-contract.mjs'
const policy=await import('../src/policy-evidence.mjs').catch(()=>({}))
const receipts=await import('../../worker/material-read-receipts.mjs')
const url='https://www.wuhan.gov.cn/zwgk/policy/example.html'
const text='武汉市示例规划\n发布机构 武汉市人民政府\n2026年1月1日\n统筹推进流域综合治理与生态环境保护。'
const source={url,title:'武汉市示例规划',publisher:'武汉市人民政府',publishedDate:'2026年1月1日',scope:'武汉市',quote:'统筹推进流域综合治理与生态环境保护。',summary:'市域规划提出流域综合治理要求。',status:'正文已读取，适用边界待核实'}
const read={url,text,contentHash:createHash('sha256').update(text).digest('hex'),retrievedAt:'2026-11-14T03:00:00.000Z'}

test('官方网页URL经过业务返回值处理仍保持原文，Windows及Linux私有路径继续隐藏',()=>{
 const links=['https://www.gov.cn/zhengce/zhengceku/202502/content_7003572.htm','https://sft.hubei.gov.cn/zfxxgk/zc/gfxwj/202011/t20201127_3056759.shtml','https://example.gov.cn/home/policy']
 const raw={response:JSON.stringify({sources:links}),webReads:links.map(url=>({url,text:'公开正文'}))}
 assert.deepEqual(publicBusinessData(raw),raw)
 assert.equal(publicBusinessData('本机 /home/zetta/private.txt 以及 C:\\Users\\private.txt'),'本机 [内部路径] 以及 [内部路径]')
})

test('政策证据必须来自本次真实网页读取，搜索摘要及模型自报链接不进入报告依据',()=>{
 assert.equal(typeof receipts.publicWebReceipts,'function')
 const call={type:'tool/call',data:{callId:'a',name:'web_fetch'}}
 const result={type:'tool/result',data:{message:{toolCallId:'a',content:[{type:'text',text:'Fetched '+url+' (HTTP 200)\n\n'+text}]}}}
 assert.equal(receipts.publicWebReceipts([call,result]).length,1)
 for(const events of [[result],[{...call,data:{...call.data,name:'web_search'}},result],[call,{...result,data:{message:{...result.data.message,isError:true}}}]])assert.deepEqual(receipts.publicWebReceipts(events),[])
 assert.equal(typeof policy.verifiedPolicySources,'function')
 const [e]=policy.verifiedPolicySources([source],[read])
 assert.equal(e.url,url);assert.equal(e.quote,source.quote);assert.equal(e.filename,source.title);assert.equal(e.contentHash,read.contentHash)
 assert.throws(()=>policy.verifiedPolicySources([source],[]),/读取/)
 assert.throws(()=>policy.verifiedPolicySources([{...source,quote:'本项目已获准建设大型度假设施。'}],[read]),/原文/)
 assert.throws(()=>policy.verifiedPolicySources([{...source,url:'https://www.wuhan.gov.cn.example.com/fake'}],[{...read,url:'https://www.wuhan.gov.cn.example.com/fake'}]),/官方/)
})
test('基本情况中已有两节时仍能增补政策节，已安排政策任务时复用该任务',()=>{
 const outline={flow:['01'],draft:draft('2b51dd03-9734-4058-9f91-69a12ad87d74')}
 const targets=workflowTargets(outline,{sectionPages:true,policyResearch:true})
 assert.equal(targets.length,3);assert.equal(targets[2].title,'政策背景');assert(targets[2].policyTopic)
 outline.draft.chapters[0].tasks=['行政区位','水系归属','政策背景']
 const again=workflowTargets(outline,{sectionPages:true,policyResearch:true})
 assert.equal(again.length,3);assert(again[2].policyTopic)
})
test('官方来源编号、政策节及局部修订保持绑定，缺少证据时显式保留待研究状态',()=>{
 const outline={flow:['01'],draft:draft('2b51dd03-9734-4058-9f91-69a12ad87d74'),waivers:[],retainedWaivers:[]}
 const make=(id,heading,sectionText,index)=>({id,heading,sectionText,sectionEvidenceIndexes:[index],items:[{title:heading,paragraphs:['本页呈现'+heading+'的主要依据。'],points:['当前主题为'+heading+'。'],presentation:{layout:'points',note:'以文字要点呈现。'},evidenceIndexes:[index]}],internalNotes:[]})
 const blocks=[make('outline-01-1','项目位置','本项目位于武汉市。',0),make('outline-01-2','自然地理','周边具有河流水系。',0),make('outline-01-3','政策背景','市域规划明确了流域综合治理的方向。',1)]
 const input={reportTitle:'项目概况',blocks,policySources:[source],policyGaps:[]}
 const options={requireStructured:true,requireReport:true,sectionPages:true,policyResearch:true,webReads:[read]}
 const parsed=parseWorkflowResult(JSON.stringify(input),outline,undefined,options)
 assert.equal(parsed.evidence[1].url,url);assert.equal(parsed.policyResearch.status,'ready')
 assert.throws(()=>parseWorkflowResult(JSON.stringify({...input,blocks:blocks.slice(0,2)}),outline,undefined,options),/完整|政策/)
 const missing=parseWorkflowResult(JSON.stringify({...input,blocks:blocks.slice(0,2),policySources:[],policyGaps:['官方原文暂未成功读取。']}),outline,undefined,options)
 assert.equal(missing.policyResearch.status,'missing');assert(missing.blocks[0].internalNotes.some(s=>s.includes('政策')))
 outline.draft.evidence[0].quote=source.quote
 const local=parseWorkflowResult(JSON.stringify({...input,blocks:blocks.map(b=>b.id==='outline-01-3'?{...b,sectionEvidenceIndexes:[0],items:b.items.map(i=>({...i,evidenceIndexes:[0]}))}:b),policySources:[],policyEvidenceIndexes:[0]}),outline,undefined,{...options,policyResearch:false,policyRequested:true,webReads:[]})
 assert.equal(local.policyResearch.status,'ready');assert.equal(local.blocks[2].title,'政策背景')
})
