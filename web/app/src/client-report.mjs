import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {resolveBrowserExecutable} from '../../../src/report/browser-executable.ts'
import {renderWorkflowItem,reportHierarchy,outlineNumber} from './workflow-content.mjs'

const run=promisify(execFile)
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))

export function clientReportHtml(doc){
 const referenced=[...new Set(doc.blocks.flatMap(block=>block.sectionText?block.sectionEvidenceIndexes:block.items.flatMap(item=>item.evidenceIndexes)))].sort((a,b)=>a-b)
 const numbers=new Map(referenced.map((index,i)=>[index,i+1]))
 const refsFor=(indexes,inline=false)=>{
  const ref=indexes.map(i=>'['+numbers.get(i)+']').join(' ')
  if(!ref)return ''
  return inline?` <sup aria-label="资料 ${ref}">${ref}</sup>`:`<small>资料 ${ref}</small>`
 }
 const heading=(number,title)=>number?number+'　'+escape(title):escape(title)
 const chapters=reportHierarchy(doc).map(chapter=>{
  const sections=chapter.sections.map(({block,number,numbered})=>{
   const name=`<h3>${heading(numbered?number:'',block.title)}</h3>`
   if(block.sectionText){
    const paragraphs=block.sectionText.split(/\n+/u).filter(Boolean)
    const body=paragraphs.map((line,i)=>`<p>${escape(line)}${i===paragraphs.length-1?refsFor(block.sectionEvidenceIndexes,true):''}</p>`).join('')
    return `<section>${name}${body}</section>`
   }
   const items=block.items.map((item,j)=>{
    const body=renderWorkflowItem(item,null)
    const title=block.items.length>1?`<h4>${heading(outlineNumber(number,j,block.items.length),item.title)}</h4>`:''
    return `<div class="item">${title}${body}${refsFor(item.evidenceIndexes)}</div>`
   })
   return `<section>${name}${items.join('')}</section>`
  })
  return `<article><h2>${heading(chapter.number,chapter.title)}</h2>${sections.join('')}</article>`
 })
 const sources=referenced.map(index=>{const e=doc.evidence[index];return `<li>${escape(e.filename)}　${escape(e.locator||'登记信息')}${e.kind==='official_policy'?`<br><a href="${escape(e.url)}">${escape(e.url)}</a>`:''}</li>`})
 const title=escape(doc.clientReport.title)
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${title}</title><style>
 @page{size:A4;margin:16mm 19mm}*{box-sizing:border-box}body{margin:0;font:11pt/1.58 "Noto Sans CJK SC","Microsoft YaHei",sans-serif;color:#213046;overflow-wrap:anywhere}header{padding-bottom:4mm;border-bottom:2px solid #446392}h1{font-size:23pt;line-height:1.35;margin:0 0 2mm}h1 .report-title-mark{color:#446392;font-size:14pt;margin-right:3mm}time,small{font-size:8.5pt;color:#53647c}h2,h3,h4{break-after:avoid;line-height:1.45}h2{font-size:16pt;margin:4.5mm 0 1.5mm;color:#284b78}h3{font-size:13pt;margin:2.5mm 0 1mm}h4{font-size:11pt;margin:2.8mm 0 1mm}p,ul,ol{margin:1.2mm 0}p,li{orphans:2;widows:2}ul,ol{padding-left:1.4em}li{margin:.7mm 0}small{display:block;margin:.8mm 0 1.8mm}.sources{border-top:1px solid #cdd5df;margin-top:4mm}.sources li{font-size:9pt}
 main section,.sources{break-inside:avoid}sup{font-size:8pt;color:#53647c}
 </style></head><body><header><h1><span class="report-title-mark" aria-hidden="true">◆</span>${title}</h1><time>${escape(new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric'}).format(new Date(doc.createdAt)))}</time></header><main>${chapters.join('')}</main>${sources.length?`<section class="sources"><h2>资料来源</h2><ol>${sources.join('')}</ol></section>`:''}</body></html>`
}

export async function clientReportPdf(doc){
 const folder=await mkdtemp(join(tmpdir(),'pre-client-report-')),html=join(folder,'report.html'),pdf=join(folder,'report.pdf')
 try{
  await writeFile(html,clientReportHtml(doc),{mode:0o600})
  await run(resolveBrowserExecutable(),['--headless=new','--disable-gpu','--disable-background-networking','--disable-extensions','--no-first-run','--no-default-browser-check','--no-pdf-header-footer','--user-data-dir='+join(folder,'profile'),'--print-to-pdf='+pdf,pathToFileURL(html).href],{timeout:45000,maxBuffer:1024*1024})
  const data=await readFile(pdf)
  if(data.subarray(0,5).toString()!=='%PDF-')throw Error('empty PDF')
  return data
 }catch{throw Object.assign(new Error('汇报 PDF 暂未生成，请重试或检查 Chrome 打印服务。'),{statusCode:503})}
 finally{await rm(folder,{recursive:true,force:true,maxRetries:3}).catch(()=>{})}
}
