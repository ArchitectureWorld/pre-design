import {z} from 'zod'
const sourceKey=(sha,page)=>sha+':'+page
const invalid=()=>Object.assign(Error('全文设计综合必须覆盖每个已观察原页并引用该页真实设计事实。'),{code:'REFERENCE_COVERAGE_INVALID',statusCode:409})
export const coverageContract='仅输出 {"pages":[{"fileSha256":"原文件SHA256","pageNumber":原页码,"archetypeId":"已验证Profile原型ID","factIds":["该原页实际观察事实ID"]}]}。恰好覆盖所有输入原页，每页一次，不能遗漏、重复或新增。将每页映射至能够承载其设计特征的已验证页面原型，引用1至8项该页真实观察事实。若现有原型无法承载，不得冒称覆盖；不输出原文、文件名、图片或任意其他字段。'
export function coverageInput(profile,observations){return {archetypes:profile.archetypes,pages:observations.flatMap(batch=>batch.pages)}}
export function validateCoverageMap(raw,profile,observations){
 const result=z.object({pages:z.array(z.object({fileSha256:z.string().regex(/^[a-f0-9]{64}$/),pageNumber:z.number().int().positive(),archetypeId:z.string(),factIds:z.array(z.string()).min(1).max(8)}).strict()).max(300)}).strict().parse(raw)
 const expected=new Map(observations.flatMap(batch=>batch.pages).map(page=>[sourceKey(page.fileSha256,page.pageNumber),page])),seen=new Set(),archetypes=new Set(profile.archetypes.map(a=>a.id))
 for(const page of result.pages){
  const key=sourceKey(page.fileSha256,page.pageNumber),original=expected.get(key),facts=new Set(original?.facts.map(f=>f.id))
  if(!original||seen.has(key)||!archetypes.has(page.archetypeId)||new Set(page.factIds).size!==page.factIds.length||page.factIds.some(id=>!facts.has(id)))throw invalid()
  seen.add(key)
 }
 if(seen.size!==expected.size)throw invalid()
 return result
}
export function referenceCoverage(inventory,observations=[],mapping){
 const files=new Map(inventory.files.map(f=>[f.sha256,f])),totalPages=[...files.values()].reduce((n,f)=>n+(f.pageCount??0),0)
 const extracted=new Set(inventory.files.flatMap(f=>f.pages.map(p=>sourceKey(f.sha256,p.pageNumber)))),observed=new Set(observations.flatMap(b=>b.pages.map(p=>sourceKey(p.fileSha256,p.pageNumber)))),synthesized=new Set((mapping?.pages??[]).map(p=>sourceKey(p.fileSha256,p.pageNumber)))
 return {totalPages,extractedPages:extracted.size,observedPages:observed.size,synthesizedPages:synthesized.size,complete:totalPages>0&&extracted.size===totalPages&&observed.size===totalPages&&synthesized.size===totalPages}
}
