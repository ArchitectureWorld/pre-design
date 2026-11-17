import {resolvePage} from './contract.mjs'
import {REVIEW_IMAGES} from './review-fixtures.mjs'
const points=['优先改善步行可达的公共空间与居民服务设施。','结合不同年龄人群的活动时间安排开放管理。','建设内容与后续运营、日常维护保持衔接。','按照场地条件组织实施顺序，并保留调整空间。']
const statements=['以居民日常需求为依据，统筹服务设施、公共空间与分期实施。','以下图文与数据均为合成试排示例，用于检查参考设计的迁移效果。']
const figureId=index=>'00000000-0000-4000-8000-'+String(index+1).padStart(12,'0')
export function compositionSamplePages(pkg){
 const pages=[]
 for(const layout of pkg.layouts)for(const density of ['short','typical']){
  const original=pkg.designProfile.archetypes.find(a=>a.id===layout.archetypeId),fit=layout.contentFitRules
  const archetype=fit?{...original,capacity:{images:fit.maxImages,bodyPoints:fit.maxBodyPoints,tableRows:fit.maxTableRows}}:original
  const has=role=>layout.slots.some(s=>s.role===role)
  const count=(role,fallback)=>{
   const slots=layout.slots.filter(s=>s.role===role)
   if(!slots.length)return 0
   const ends=slots.map(s=>s.index!==undefined?s.index+1:s.range?.end??0)
   return Math.max(...ends,ends.some(Boolean)?0:fallback)
  }
  const textCount=count('body',density==='short'?Math.min(2,fit?archetype.capacity.bodyPoints:archetype.capacity.bodyPoints||2):fit?archetype.capacity.bodyPoints:archetype.capacity.bodyPoints||3)
  const imageCount=count('image',archetype.capacity.images||1)
  const item={title:has('title')?(density==='short'?'城市更新 · 居民服务':'围绕居民日常需求统筹服务设施与分期实施安排'):'',paragraphs:Array.from({length:count('claim',1)},(_,i)=>statements[i%statements.length]),points:Array.from({length:textCount},(_,i)=>points[i%points.length]),evidenceIndexes:has('source')?[0]:[]}
  if(imageCount)item.figures=Array.from({length:imageCount},(_,i)=>({materialId:figureId(i),caption:'合成示意 · '+(i%2?'活动联系与分期安排':'设施分布与服务范围')}))
  if(has('table'))item.table={columns:['项目','一期','二期'],rows:Array.from({length:Math.max(1,archetype.capacity.tableRows||3)},(_,i)=>[['服务设施','3','2'],['开放空间','2','4'],['开放时段','日间','全天']][i%3])}
  if(has('chart'))item.chart={type:'bar',title:'合成数据 · 服务覆盖对比',unit:'%',categories:['儿童','青年','长者'],series:[{name:'改善前',values:[32,45,38]},{name:'改善后',values:[68,72,75]}]}
  if(has('timeline'))item.timeline={title:'合成示例 · 实施安排',events:[{label:'近期',description:'补足基础服务'},{label:'中期',description:'完善空间联系'},{label:'远期',description:'持续维护评估'}]}
  if(has('diagram'))item.diagram={title:'合成示例 · 服务组织',direction:'horizontal',nodes:[{id:'need',label:'居民需求'},{id:'service',label:'服务配置'},{id:'operation',label:'运营维护'}],edges:[{from:'need',to:'service',label:'指导'},{from:'service',to:'operation',label:'衔接'}]}
  if(fit){
   const shorten=(text,max)=>Array.from(text).slice(0,max).join('')
   item.title=shorten(item.title,fit.maxTitleCharacters)
   let claimLeft=fit.maxClaimCharacters;item.paragraphs=item.paragraphs.map(s=>{const out=shorten(s,claimLeft);claimLeft-=Array.from(out).length;return out}).filter(Boolean)
   let bodyLeft=fit.maxBodyCharacters;item.points=item.points.map(s=>{const out=shorten(s,bodyLeft);bodyLeft-=Array.from(out).length;return out}).filter(Boolean)
   if(item.table){item.table.columns=item.table.columns.slice(0,fit.maxTableColumns);item.table.rows=item.table.rows.map(row=>row.slice(0,fit.maxTableColumns))}
  }
  const page={id:`sample-${layout.id}-${density}`,number:pages.length+1,chapterTitle:'合成内容试排',sectionTitle:layout.label,item}
  if(imageCount)page.nativeAssets={images:item.figures.map((f,i)=>({dataUrl:REVIEW_IMAGES[i%REVIEW_IMAGES.length],materialId:f.materialId,sha256:'synthetic-fixture'}))}
  page.nativeLayout=resolvePage({page,globalPackage:pkg,local:{overrides:{layoutId:layout.id}}})
  pages.push(page)
 }
 return pages
}
