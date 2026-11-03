import type { ImageRectangle, CaptionAlignment } from './caption-alignment.ts'
import type { PlanningManuscriptDiagram } from './manuscript/types.ts'
import { renderPlanningDiagram } from '../presentation/manuscript-diagrams.ts'

export interface ChapterGraphic {
  rect: ImageRectangle; label: string; graph: PlanningManuscriptDiagram; sourceRefs: string[]; notes: string[]
}
type Point = { x:number; y:number }
export interface ChapterTerrainAnchor {id:string;point:Point;water:boolean;elevation:number}
export interface ChapterAnnotations {
  sourceRefs:string[]; notes:string[]
  markers:{label:string;point:Point;labelRect:ImageRectangle;align:CaptionAlignment;kind?:'observation'|'proposed';terrainAnchor?:string}[]
  paths:{role:'ridge'|'valley'|'proposed';points:Point[];anchorIds?:string[]}[]
}
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
const units=(s:string)=>[...s].reduce((n,c)=>n+(/^[\x00-\x7f]$/.test(c)?.6:1),0)
export function validateGraphicSources(value:{sourceRefs:string[];notes:string[]},refs:readonly string[]){
  if(!value.sourceRefs?.length||value.sourceRefs.some(r=>!refs.includes(r))||!value.notes?.length||value.notes.some(n=>!n.trim()))throw new Error('CHAPTER_GRAPHIC_SOURCE: '+JSON.stringify({submitted:value.sourceRefs,allowed:refs,required:'use page body sourceRefs, provide internal notes; omit unused annotations'}))
}
export function chapterGraphicSvg(value:ChapterGraphic,id:string){
  if(!value.label?.trim())throw new Error('CHAPTER_GRAPHIC_LABEL')
  const rendered=renderPlanningDiagram(value.graph,id,value.label)
  const scale=Math.min(value.rect.width/rendered.width,(value.rect.height-36)/rendered.height)
  const sourceSizes=[...rendered.svg.matchAll(/font-size="([\d.]+)"/g)].map(m=>Number(m[1]))
  const minSourceText=Math.min(...sourceSizes),minText=minSourceText*scale
  const minimumRect=sourceSizes.length&&minSourceText>0?{width:Math.max(500,Math.ceil(rendered.width*20/minSourceText)),height:Math.max(200,Math.ceil(rendered.height*20/minSourceText+36))}:undefined
  if(value.rect.width<500||value.rect.height<200||!sourceSizes.length||minText<20)throw new Error('CHAPTER_GRAPHIC_SIZE: '+JSON.stringify({rect:value.rect,minText,naturalWidth:rendered.width,naturalHeight:rendered.height,minimumRect,required:'effective text >=20px; both rectangle dimensions must meet minimumRect for this exact graph; rearrange semantic groups or the page instead of shrinking text'}))
  return rendered.svg.replace('<svg ','<svg class="native-graph" ').replace(/<text /g,'<text data-graphic-label ')
}
export function validateChapterAnnotations(value:ChapterAnnotations,rect:ImageRectangle,refs:readonly string[]){
  validateGraphicSources(value,refs)
  const point=(p:Point)=>p&&[p.x,p.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1)
  if(!value.markers?.length||!Array.isArray(value.paths))throw new Error('CHAPTER_ANNOTATION_REQUIRED: omit annotations entirely on a plain image; use nonempty markers on an analysis image')
  const labels:ImageRectangle[]=[]
  for(const m of value.markers){
    if(m.kind&&!['observation','proposed'].includes(m.kind))throw new Error('CHAPTER_ANNOTATION_KIND')
    const r=m.labelRect
    if(!point(m.point)||!r||!point(r)||![r.width,r.height].every(v=>Number.isFinite(v)&&v>0)||r.x+r.width>1||r.y+r.height>1)throw new Error('CHAPTER_ANNOTATION_BOUNDS')
    if(!m.label?.trim()||r.width*rect.width<units(m.label)*22+20||r.height*rect.height<34)throw new Error('CHAPTER_ANNOTATION_TEXT_SIZE: '+JSON.stringify({label:m.label,width:r.width*rect.width,height:r.height*rect.height,minimumWidth:units(m.label)*22+20,minimumHeight:34}))
    if(!['left','right','center'].includes(m.align)||Math.abs(m.align==='left'?r.x:m.align==='right'?r.x+r.width-1:r.x+r.width/2-.5)>.002)throw new Error('CHAPTER_ANNOTATION_ALIGNMENT: '+JSON.stringify({label:m.label,align:m.align,rect:r,required:'left x=0; right x=1-width; center x=(1-width)/2; applies to ALL markers'}))
    if(labels.some(b=>Math.min(r.x+r.width,b.x+b.width)>Math.max(r.x,b.x)&&Math.min(r.y+r.height,b.y+b.height)>Math.max(r.y,b.y)))throw new Error('CHAPTER_ANNOTATION_COLLISION')
    labels.push(r)
  }
  for(const p of value.paths)if(!['ridge','valley','proposed'].includes(p.role)||p.points.length<2||p.points.some(v=>!point(v)))throw new Error('CHAPTER_ANNOTATION_PATH')
}
export function renderChapterAnnotations(value:ChapterAnnotations,rect:ImageRectangle){
  const w=rect.width,h=rect.height,colors={ridge:'#f6d884',valley:'#82dded',proposed:'#ffffff'}
  const paths=value.paths.map(p=>`<polyline data-analysis-path="${p.role}" points="${p.points.map(v=>`${v.x*w},${v.y*h}`).join(' ')}" stroke="${colors[p.role]}" stroke-width="4" fill="none" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="${p.role==='proposed'?'8 8':'none'}"/>`).join('')
  const markers=value.markers.map((m,i)=>{
    const r=m.labelRect,x=r.x*w,y=r.y*h,rw=r.width*w,rh=r.height*h,px=m.point.x*w,py=m.point.y*h
    const lx=Math.max(x+10,Math.min(x+rw-10,px)),ly=Math.max(y,Math.min(y+rh,py))
    const tx=m.align==='left'?x:m.align==='right'?x+rw:x+rw/2
    return `<path d="M${lx} ${ly} L${px} ${py}" stroke="#27463c" stroke-width="3"/><path d="M${lx} ${ly} L${px} ${py}" stroke="#fff" stroke-width="1.5"/><circle data-marker-kind="${m.kind??'observation'}" cx="${px}" cy="${py}" r="${m.kind==='proposed'?9:6}" fill="${m.kind==='proposed'?'#bd713b':'#f6d884'}" stroke="#253b31" stroke-width="2"/><rect x="${x}" y="${y}" width="${rw}" height="${rh}" rx="3" fill="#193c32" fill-opacity=".92"/><text data-graphic-label data-map-align="${m.align}" x="${tx}" y="${y+rh/2}" text-anchor="${m.align==='left'?'start':m.align==='right'?'end':'middle'}" dominant-baseline="central" fill="#fff" font-size="22">${esc(m.label)}</text>`
  }).join('')
  return `<svg class="map-annotations" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${paths}${markers}</svg>`
}
