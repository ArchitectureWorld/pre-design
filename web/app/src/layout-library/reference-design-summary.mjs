import {z} from 'zod'
const key=p=>p.fileSha256+':'+p.pageNumber
const fail=()=>Object.assign(Error('设计摘要必须完整保留原页身份并且只引用该页真实事实。'),{code:'REFERENCE_SUMMARY_INVALID',statusCode:409})
export const summaryContract='仅输出 {"pages":[{"fileSha256":"原文件SHA256","pageNumber":原页码,"factIds":["该页原始fact ID"]}]}。恰好覆盖输入全部原页，每页一次。每页选择1至8项最能描述可复用版式的实际事实，按重要性从高到低排列；综合画布、色彩、字体、图文关系和布局区域，避免重复。只能引用本页输入已有ID，不得重写事实值、输出自由摘要文字或业务正文；未选事实仍由系统保留。'
export function sizeBatches(pages,{maxCharacters=100000,maxPages=12,prefix={}}={}){
 const batches=[];let current=[]
 for(const page of pages){
  if(JSON.stringify({...prefix,pages:[page]}).length>maxCharacters)throw fail()
  if(current.length&&(current.length>=maxPages||JSON.stringify({...prefix,pages:[...current,page]}).length>maxCharacters)){batches.push(current);current=[]}
  current.push(page)
 }
 if(current.length)batches.push(current)
 return batches
}
export function designFactPages(inventory,observations){
 const extracted=new Map(inventory.files.flatMap(file=>file.pages.map(page=>[file.sha256+':'+page.pageNumber,page.extractedFacts])))
 return observations.flatMap(batch=>batch.pages).map(page=>({...page,facts:[...(extracted.get(key(page))??[]),...page.facts].filter(f=>!['document-text','unpaged-document-text'].includes(f.property))}))
}
export function validateDesignSummary(raw,pages){
 const result=z.object({pages:z.array(z.object({fileSha256:z.string().regex(/^[a-f0-9]{64}$/),pageNumber:z.number().int().positive(),factIds:z.array(z.string()).min(1).max(8)}).strict()).max(12)}).strict().parse(raw)
 const expected=new Map(pages.map(p=>[key(p),p])),seen=new Set()
 for(const page of result.pages){const original=expected.get(key(page)),facts=new Map(original?.facts.map(f=>[f.id,f]));if(!original||seen.has(key(page))||new Set(page.factIds).size!==page.factIds.length||page.factIds.some(id=>!facts.has(id)))throw fail();seen.add(key(page))}
 if(seen.size!==expected.size)throw fail()
 return result
}
export function materializeDesignSummary(originalPages,selections,limit=8){
 const selected=new Map(selections.flatMap(s=>s.pages).map(p=>[key(p),p]))
 if(selected.size!==originalPages.length)throw fail()
 return originalPages.map(page=>{const choice=selected.get(key(page)),facts=new Map(page.facts.map(f=>[f.id,f]));if(!choice)throw fail();return {...page,facts:choice.factIds.slice(0,limit).map(id=>{if(!facts.has(id))throw fail();return facts.get(id)}),omittedFactCount:page.facts.length-Math.min(limit,choice.factIds.length)}})
}
export function compactSynthesis(inventory,observations,summaryPages){
 const selected=new Map(summaryPages.map(p=>[key(p),new Set(p.facts.map(f=>f.id))]))
 return {inventory:{...inventory,files:inventory.files.map(file=>({...file,extractedFacts:[],pages:file.pages.map(({text,...page})=>({...page,extractedFacts:page.extractedFacts.filter(f=>f.property==='canvas'||selected.get(file.sha256+':'+page.pageNumber)?.has(f.id))}))}))},observations:observations.map(batch=>({...batch,pages:batch.pages.map(page=>({...page,facts:page.facts.filter(f=>selected.get(key(page))?.has(f.id))}))}))}
}
export async function summarizeDesignFacts({analysis,stage}){
 if(analysis.designSummary)return analysis.designSummary
 const pages=designFactPages(analysis.inventory,analysis.observations),selections=[]
 for(const [index,batch]of sizeBatches(pages).entries())selections.push(await stage('design-summary-'+(index+1),{pages:batch},[],raw=>validateDesignSummary(raw,batch)))
 analysis.designSummary={schemaVersion:'pre-design.private-design-summary.v1',selectionMethod:'model-ranked-original-fact-ids',originalPageCount:pages.length,selections,pages:materializeDesignSummary(pages,selections)}
 return analysis.designSummary
}
