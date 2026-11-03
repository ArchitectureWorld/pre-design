import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { MAX_ORIGINAL_IMAGE_USES, type OriginalImageIdentity } from '../visual/image-policy.ts'
import { regularImageFamilies } from './regular/visual-audit.ts'
import type { ChapterPageLayout } from './chapter-render.ts'
import type { ImageRectangle } from './caption-alignment.ts'
import type { ChapterTerrainAnchor } from './chapter-graphics.ts'

export interface ChapterImageSource { id:string; sha256?:string; imageIdentity?:OriginalImageIdentity; width?:number;height?:number;terrainAnchors?:ChapterTerrainAnchor[] }
export interface ChapterImageUse extends ChapterImageSource { chapterId:string; pageId:string; page:number; caption:string }
export interface ChapterImageOverlay { target:'title'|'caption'; figureIndex:number; rect:ImageRectangle; align:'left'|'center'|'right'; tone:'light'|'dark'; reason:string }
export interface ChapterProtectedArea { figureIndex:number; rect:ImageRectangle; reason:string }
export interface CompiledChapterOverlay extends ChapterImageOverlay { figureElement:number }
export interface CompiledProtectedArea extends ChapterProtectedArea { figureElement:number }

export function intersects(a:ImageRectangle,b:ImageRectangle):boolean {
  return Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)+.1 && Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y)+.1
}
export function imageRelativeRect(relative:ImageRectangle,image:ImageRectangle):ImageRectangle {
  if(!relative||![relative.x,relative.y,relative.width,relative.height].every(Number.isFinite)||relative.x<0||relative.y<0||relative.width<=0||relative.height<=0||relative.x+relative.width>1.00001||relative.y+relative.height>1.00001)throw new Error('CHAPTER_OVERLAY_BOUNDS')
  return {x:image.x+relative.x*image.width,y:image.y+relative.y*image.height,width:relative.width*image.width,height:relative.height*image.height}
}

export function auditChapterImageUse(chapterId:string,layouts:readonly ChapterPageLayout[],assets:readonly ChapterImageSource[],previous:readonly ChapterImageUse[]=[]){
  const current=layouts.flatMap((layout,i)=>layout.elements.filter(e=>e.type==='figure').map(e=>{
    const asset=assets.find(a=>a.id===e.assetId);if(!asset)throw new Error('CHAPTER_LAYOUT_ASSET')
    return {...asset,chapterId,pageId:layout.pageId,page:i+1,caption:e.caption??''}
  }))
  const uses=[...previous.filter(u=>u.chapterId!==chapterId),...current]
  const families=regularImageFamilies(uses.map((a,i)=>({assetId:String(i),sha256:a.sha256??'unhashed:'+a.id,imageIdentity:a.imageIdentity})))
  const originals=new Map<string,{originalId:string;count:number;uses:ChapterImageUse[]}>()
  const samePageDuplicates:{chapterId:string;pageId:string;originalId:string}[]=[]
  const pages=new Set<string>()
  uses.forEach((use,i)=>{
    const originalId=families.get(String(i))!,key=use.chapterId+'\0'+use.pageId+'\0'+originalId
    if(pages.has(key))samePageDuplicates.push({chapterId:use.chapterId,pageId:use.pageId,originalId});pages.add(key)
    const group=originals.get(originalId)??{originalId,count:0,uses:[]};group.count++;group.uses.push(use);originals.set(originalId,group)
  })
  const repeatedOriginals=[...originals.values()].filter(g=>g.count>MAX_ORIGINAL_IMAGE_USES)
  return {version:'chapter-image-usage-20261016.1',maxOriginalUses:MAX_ORIGINAL_IMAGE_USES,pass:!samePageDuplicates.length&&!repeatedOriginals.length,
    uses:current,originals:[...originals.values()],samePageDuplicates,repeatedOriginals}
}
export function assertChapterImageUse(audit:ReturnType<typeof auditChapterImageUse>):void{
  if(audit.samePageDuplicates.length)throw new Error('CHAPTER_IMAGE_SAME_PAGE_DUPLICATE: '+JSON.stringify(audit.samePageDuplicates))
  if(audit.repeatedOriginals.length)throw new Error('CHAPTER_IMAGE_ORIGINAL_REUSE: '+JSON.stringify(audit.repeatedOriginals.map(g=>({originalId:g.originalId,count:g.count,pages:g.uses.map(u=>u.pageId)}))))
}

export function chapterAssetAvailability<T extends ChapterImageSource>(chapterId:string,assets:readonly T[],previous:readonly ChapterImageUse[]=[]){
  const prior=previous.filter(u=>u.chapterId!==chapterId),all=[...prior,...assets]
  const families=regularImageFamilies(all.map((a,i)=>({assetId:String(i),sha256:a.sha256??'unhashed:'+a.id,imageIdentity:a.imageIdentity})))
  const counts=new Map<string,number>()
  prior.forEach((_,i)=>{const key=families.get(String(i))!;counts.set(key,(counts.get(key)??0)+1)})
  return assets.flatMap((asset,i)=>{
    const remainingUses=MAX_ORIGINAL_IMAGE_USES-(counts.get(families.get(String(prior.length+i))!)??0)
    return remainingUses>0?[{...asset,remainingUses}]:[]
  })
}

/** Only current versions of other chapters count; archived revisions do not. */
export async function readOtherChapterImageUse(workspace:string,currentId:string):Promise<ChapterImageUse[]>{
  const folder=join(workspace,'.pre-design/chapter-productions'),uses:ChapterImageUse[]=[]
  let chapters;try{chapters=await readdir(folder,{withFileTypes:true})}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e}
  for(const chapter of chapters.filter(c=>c.isDirectory()&&c.name!==currentId)){
    let state;try{state=JSON.parse(await readFile(join(folder,chapter.name,'latest.json'),'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e}
    if(!state.htmlPath)continue
    const packet=JSON.parse(await readFile(join(dirname(state.htmlPath),'原图复用检查.json'),'utf8'))
    if(!packet.pass||!Array.isArray(packet.uses))throw new Error('CHAPTER_OTHER_IMAGE_USAGE_UNVERIFIED: '+chapter.name)
    uses.push(...packet.uses)
  }
  return uses
}
