import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { displayedImageRect } from './caption-alignment.ts'
import type { ChapterPageLayout } from './chapter-render.ts'

export const CLIENT_VISUAL_VERSION='client-scenes-and-rhythm-20261023.1'
export const CHAPTER_CAPACITY_GUIDANCE='先为整页分配图像、正文、图注与流程所需空间，再提交矩形。图像框不是必须保持的旧坐标，允许移动图文组或减少非必要辅图。保留全部已审正文和必要关系，不能通过缩字、缩成小流程条或遮挡解决超量。照片下方预留40px图注；sequences是横向排列，至少160px高，每节点至少220px宽加38px间距；graphics的500×200px只是绝对下限，不能据此判断一张图能放下。具体图件的CHAPTER_GRAPHIC_SIZE诊断提供minimumRect：宽和高必须同时达到，36px图题已包含；若页面容不下，重组语义分组或重排图文，不重复提交原矩形。层级关系图每个group是一列，组内多个节点纵排；matrix则每组一行。横向阶段可用多个有意义的组或sequences。只保留帮助本页判断的必要关系图，不为重复正文而强加流程条。发生几何冲突时整体重排受影响页，不固守失败稿中彼此挤占空间的矩形。'
export const CLIENT_VISUAL_PROMPT='每个正文页必须至少有一张与本页内容直接相关的场景图或产品图，地图、关系图、流程、表格不抵扣。场景/产品图在页面实际显示面积合计至少12%，至少一张达到8%；不能角落小图凑数。照片承担具体场景、体验、设施或产品说明，图注以实际可见内容为准；概念/参考图保留身份。同一种实际图文布局最多连续两页，第三页必须改变主视觉位置或图文组织；仅换图片、标题、颜色、模板名称或挪动几像素不算变化。产品页可保留相同信息字段，但组织方式必须遵守连续限制。'
export type ChapterVisualKind='scene'|'product'|'map'|'diagram'
export interface SceneAsset {id:string;width?:number;height?:number;visualKind?:ChapterVisualKind}

export const CHAPTER_PRIMARY_FLOWS=['image-left-copy-right','copy-left-image-right','image-above-copy','copy-above-image'] as const
export type ChapterPrimaryFlow=typeof CHAPTER_PRIMARY_FLOWS[number]
/** A footer strip or one paragraph below a photo does not change the main reading direction. */
export function primaryChapterPageFlow(p:ChapterPageLayout):ChapterPrimaryFlow|undefined{
  const figures=p.elements.filter(e=>e.type==='figure'),tables=p.elements.filter(e=>e.type==='table')
  const copy=tables.length?tables:p.elements.filter(e=>e.type==='body')
  if(figures.length!==1||!copy.length)return
  const f=figures[0]!.rect,threshold=Math.ceil(copy.length*2/3)
  const directions:((r:typeof f)=>boolean)[]=[r=>f.x+f.width<=r.x+24,r=>r.x+r.width<=f.x+24,r=>f.y+f.height<=r.y+24,r=>r.y+r.height<=f.y+24]
  const i=directions.findIndex(test=>copy.filter(e=>test(e.rect)).length>=threshold)
  return i<0?undefined:CHAPTER_PRIMARY_FLOWS[i]
}
// Compare visible block roles and coarse placement, not names chosen by the author.
export function samePageComposition(a:ChapterPageLayout,b:ChapterPageLayout):boolean{
  const aFlow=primaryChapterPageFlow(a),bFlow=primaryChapterPageFlow(b)
  if(aFlow&&aFlow===bFlow)return true
  const blocks=(p:ChapterPageLayout)=>p.elements.filter(e=>e.type!=='label').map(e=>({role:e.type,r:e.rect})).sort((a,b)=>a.role.localeCompare(b.role)||a.r.x-b.r.x||a.r.y-b.r.y)
  const aa=blocks(a),bb=blocks(b)
  if(aa.length!==bb.length)return false
  return aa.every((e,i)=>{const v=bb[i]!;return e.role===v.role&&Math.abs(e.r.x-v.r.x)<=100&&Math.abs(e.r.y-v.r.y)<=80&&Math.abs(e.r.width-v.r.width)<=120&&Math.abs(e.r.height-v.r.height)<=90})
}
export function auditClientVisuals(layouts:readonly ChapterPageLayout[],assets:readonly SceneAsset[],preceding:readonly ChapterPageLayout[]=[]){
  const findings:{code:string;pageIds:string[];evidence:string}[]=[]
  const pages=layouts.map(p=>{
    if(p.elements.some(e=>e.type==='graphic'&&!e.graph.presentation))findings.push({code:'CHAPTER_DIAGRAM_PRESENTATION_REQUIRED',pageIds:[p.pageId],evidence:'关系图必须显式选择适合语义的现代构图，不允许退回旧大卡片网格。'})
    const scenes=p.elements.filter(e=>e.type==='figure').flatMap(e=>{
      const a=assets.find(a=>a.id===e.assetId)
      if(!a||!['scene','product'].includes(a.visualKind??''))return []
      const r=a.width&&a.height?displayedImageRect(e.rect,a.width,a.height,e.fit??'cover'):e.rect
      return [{assetId:a.id,area:r.width*r.height/(1600*900)}]
    })
    const area=scenes.reduce((sum,s)=>sum+s.area,0)
    if(!scenes.length)findings.push({code:'CHAPTER_SCENE_REQUIRED',pageIds:[p.pageId],evidence:'本页没有场景/产品图；图表、地图和关系图不能代替。'})
    else if(area<.12||!scenes.some(s=>s.area>=.08))findings.push({code:'CHAPTER_SCENE_TOO_SMALL',pageIds:[p.pageId],evidence:`场景/产品图实际面积${Math.round(area*100)}%（${Math.round(area*1600*900)}平方像素）；合计至少12%即172800平方像素，至少一张8%即115200平方像素。只有一图时该图须达到172800平方像素；contain按实际自然比例显示面积计算，增大空图框无效。可扩大图片、调整表格列宽和整体分区，不能缩字或以角落小图凑数。`})
    return {pageId:p.pageId,scenes,sceneArea:area}
  })
  const all=[...preceding.slice(-2),...layouts],current=new Set(layouts.map(p=>p.pageId))
  for(let i=2;i<all.length;i++)if(current.has(all[i]!.pageId)&&samePageComposition(all[i-2]!,all[i-1]!)&&samePageComposition(all[i-1]!,all[i]!))
    findings.push({code:'CHAPTER_LAYOUT_THREE_CONSECUTIVE',pageIds:all.slice(i-2,i+1).map(p=>p.pageId),evidence:'三页实际图文组织连续相同；修改第三页主视觉位置或图文组织，换名称/颜色/素材或微调坐标不算。'})
  return {version:CLIENT_VISUAL_VERSION,pass:!findings.length,pages,findings}
}
export function assertClientVisuals(audit:ReturnType<typeof auditClientVisuals>):void{
  if(!audit.pass)throw new Error(audit.findings.map(f=>f.code+': '+f.pageIds.join(', ')+' '+f.evidence).join('\n'))
}
export async function previousChapterLayouts(workspace:string,current:string):Promise<ChapterPageLayout[]>{
  const order=['opportunity','site','positioning','products','spatial','launch','operation'],index=order.indexOf(current)
  if(index<=0)return []
  try{
    const state=JSON.parse(await readFile(join(workspace,'.pre-design/chapter-productions',order[index-1]!,'latest.json'),'utf8'))
    if(!state.htmlPath)return []
    return JSON.parse(await readFile(join(dirname(state.htmlPath),'版面与图件.json'),'utf8')).layouts.slice(-2)
  }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e}
}
