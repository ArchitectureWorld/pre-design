import type { ImageRectangle, CaptionAlignment } from './caption-alignment.ts'
import type { ChapterRenderElement } from './chapter-render.ts'
import { chapterGraphicSvg,validateGraphicSources,validateChapterAnnotations,type ChapterGraphic,type ChapterAnnotations,type ChapterTerrainAnchor } from './chapter-graphics.ts'

/** Native layout coordinates, not a second copy-writing path. */
export interface ChapterComposition {
  title: ImageRectangle
  claim: ImageRectangle
  figures: { rect: ImageRectangle; fit: 'cover'|'contain'; captionAlign: CaptionAlignment; annotations?:ChapterAnnotations }[]
  bodies: { index: number; rect: ImageRectangle }[]
  sequences: { rect: ImageRectangle; label: string; nodes: { title: string; detail: string }[] }[]
  graphics?:ChapterGraphic[]
  table?:{rect:ImageRectangle;columnWidths:number[]}
}

/** Native selects composition and authors every graphic; the product solves its grid. */
export function resolveChapterComposition(template:string,value:ChapterComposition,body:readonly string[],assets:readonly {width?:number;height?:number;terrainAnchors?:ChapterTerrainAnchor[]}[]):ChapterComposition {
  if(template==='diagram-main'){
    if(assets.length||value.graphics?.length!==1||body.length>3)throw new Error('CHAPTER_DIAGRAM_MAIN: one authored graphic, no photographs, at most 3 body points')
    const width=(1488-24*(body.length-1))/body.length
    return {...value,title:{x:56,y:68,width:1488,height:54},claim:{x:56,y:130,width:1488,height:48},figures:[],sequences:[],
      bodies:body.map((_,index)=>({index,rect:{x:56+index*(width+24),y:718,width,height:122}})),
      graphics:[{...value.graphics[0]!,rect:{x:56,y:202,width:1488,height:490}}]}
  }
  if(template==='analysis-map'){
    const asset=assets[0],figure=value.figures[0]
    if(assets.length!==1||!asset?.width||!asset.height||!figure?.annotations?.markers.length||body.length>3)throw new Error('CHAPTER_ANALYSIS_MAP: one full source image with native markers, at most 3 body points')
    const height=Math.min(740,700*asset.height/asset.width),width=height*asset.width/asset.height
    const anchor=(id:string|undefined,land:boolean)=>{
      const a=asset.terrainAnchors?.find(a=>a.id===id)
      if(!a||(land&&a.water))throw new Error('CHAPTER_TERRAIN_ANCHOR: select an available terrainAnchor; proposed nodes/links require land anchors')
      return a.point
    }
    const annotations={...figure.annotations,markers:figure.annotations.markers.map(m=>{
      const w=([...m.label].length*22+28)/width,h=38/height
      return {...m,...asset.terrainAnchors?{point:anchor(m.terrainAnchor,m.kind==='proposed')}:{},labelRect:{x:m.align==='left'?0:m.align==='right'?1-w:(1-w)/2,y:m.labelRect.y,width:w,height:h}}
    }),paths:figure.annotations.paths.map(p=>{
      if(!asset.terrainAnchors)return p
      if(!p.anchorIds||p.anchorIds.length<2)throw new Error('CHAPTER_TERRAIN_PATH_ANCHORS')
      return {...p,points:p.anchorIds.map(id=>anchor(id,p.role==='proposed'))}
    })}
    return {...value,title:{x:800,y:80,width:744,height:108},claim:{x:800,y:220,width:744,height:80},
      figures:[{...figure,rect:{x:56,y:64,width,height},fit:'contain',annotations}],sequences:[],graphics:[],
      bodies:body.map((_,index)=>({index,rect:{x:800,y:360+index*154,width:744,height:150}}))}
  }
  return value
}

export function compileChapterComposition(value: ChapterComposition, body: readonly string[], assetIds: readonly string[], captions: readonly string[], sourceRefs:readonly string[]=[], tableColumnCount=0): ChapterRenderElement[] {
  const issues:string[]=[]
  const verify=(fn:()=>unknown)=>{try{fn()}catch(e){issues.push(String(e))}}
  const check = (r: ImageRectangle, name: string) => {
    if (!r || ![r.x,r.y,r.width,r.height].every(Number.isFinite) || r.x<0 || r.y<0 || r.width<=0 || r.height<=0 || r.x+r.width>1600 || r.y+r.height>850)
      issues.push('CHAPTER_COMPOSITION_BOUNDS: '+name)
  }
  check(value.title,'title');check(value.claim,'claim')
  if(value.title.height<54||value.claim.height<40)throw new Error('CHAPTER_COMPOSITION_HEADING_CAPACITY: title.height must be at least 54; claim.height must be at least 40; actual '+JSON.stringify({title:value.title.height,claim:value.claim.height}))
  if (value.figures.length!==assetIds.length || value.bodies.length!==body.length ||
    body.some((_,i)=>value.bodies.filter(b=>b.index===i).length!==1)) throw new Error('CHAPTER_COMPOSITION_CONTENT')
  const elements: ChapterRenderElement[] = value.figures.map((f,i)=>{
    check(f.rect,'figure '+i)
    if (!['cover','contain'].includes(f.fit)||!['left','center','right'].includes(f.captionAlign)) issues.push('CHAPTER_COMPOSITION_FIGURE')
    if (assetIds[i]==='map'&&f.fit!=='contain') issues.push('CHAPTER_COMPOSITION_MAP_CROP')
    if(f.annotations){if(f.fit!=='contain')issues.push('CHAPTER_ANNOTATION_REQUIRES_FULL_IMAGE: use contain and the source image aspect ratio');verify(()=>validateChapterAnnotations(f.annotations!,f.rect,sourceRefs))}
    return {type:'figure',assetId:assetIds[i]!,caption:captions[i]!,rect:f.rect,fit:f.fit,align:f.captionAlign,...f.annotations?{annotations:f.annotations}:{}}
  })
  for (const b of value.bodies) {
    check(b.rect,'body '+b.index)
    const units=[...body[b.index]!].reduce((sum,char)=>sum+(/^[\x00-\x7f]$/.test(char)?.55:1),0)
    const lines=Math.ceil(units/Math.floor((b.rect.width-39)/24)),needed=lines*38.4
    if(!Number.isFinite(needed)||b.rect.height<needed)issues.push('CHAPTER_COMPOSITION_TEXT_HEIGHT: '+JSON.stringify({index:b.index,width:b.rect.width,height:b.rect.height,needed:Math.ceil(needed),text:body[b.index]}))
    elements.push({type:'body',index:b.index,rect:b.rect,fontSize:24})
  }
  if(Boolean(value.table)!==Boolean(tableColumnCount))issues.push('CHAPTER_COMPOSITION_TABLE: preserve exactly the source table; use table.rect and table.columnWidths')
  if(value.table){
    const {rect,columnWidths}=value.table;check(rect,'table')
    if(!Array.isArray(columnWidths)||columnWidths.length!==tableColumnCount||columnWidths.some(w=>!Number.isFinite(w)||w<=0||w*rect.width<80)||Math.abs(columnWidths.reduce((a,b)=>a+b,0)-1)>.001)
      issues.push('CHAPTER_COMPOSITION_TABLE_COLUMNS: one positive fraction per source column, sum 1, at least 80px per column')
    elements.push({type:'table',rect,fontSize:24,columnWidths})
  }
  for (const s of value.sequences) {
    check(s.rect,'sequence')
    if (!s.label?.trim() || s.nodes.length<2 || s.nodes.length>5 || s.nodes.some(n=>!n.title?.trim()||!n.detail?.trim())) issues.push('CHAPTER_COMPOSITION_SEQUENCE')
    if(s.rect.height<160||s.rect.width<s.nodes.length*220+(s.nodes.length-1)*38)issues.push('CHAPTER_COMPOSITION_SEQUENCE_SIZE: '+JSON.stringify({width:s.rect.width,height:s.rect.height,minWidth:s.nodes.length*220+(s.nodes.length-1)*38,minHeight:160}))
    elements.push({type:'sequence',...s})
  }
  for(const [i,g] of (value.graphics??[]).entries()){
    check(g.rect,'graphic');verify(()=>validateGraphicSources(g,sourceRefs));verify(()=>chapterGraphicSvg(g,'check-'+i))
    elements.push({type:'graphic',...g})
  }
  // Bad geometry is returned to the native model before a browser/export round.
  const blocks=[{rect:value.title,type:'title'},{rect:value.claim,type:'claim'},...elements]
  for(let i=0;i<blocks.length;i++)for(let j=i+1;j<blocks.length;j++){
    const a=blocks[i]!,b=blocks[j]!
    if(Math.min(a.rect.x+a.rect.width,b.rect.x+b.rect.width)>Math.max(a.rect.x,b.rect.x)+1 && Math.min(a.rect.y+a.rect.height,b.rect.y+b.rect.height)>Math.max(a.rect.y,b.rect.y)+1)
      issues.push('CHAPTER_COMPOSITION_COLLISION: '+JSON.stringify({a:{type:a.type,rect:a.rect},b:{type:b.type,rect:b.rect}}))
  }
  if(issues.length)throw new Error(issues.join('\n'))
  return elements
}
