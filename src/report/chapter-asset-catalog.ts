import { createHash } from 'node:crypto'
import { readFile,readdir,mkdir,writeFile } from 'node:fs/promises'
import { join,relative,extname } from 'node:path'
import sharp from 'sharp'
import type { ChapterAssetInput } from './chapter-production-export.ts'
import { chapterTerrainAsset } from './chapter-terrain.ts'

const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
export async function chapterLayoutReviewImages(pages:readonly {pageId:string;path:string;sha256:string}[]){
  const images=[]
  for(const page of pages){
    const source=await readFile(page.path)
    if(digest(source)!==page.sha256)throw new Error('CHAPTER_REVIEW_SCREENSHOT_CHANGED')
    const bytes=await sharp(source).jpeg({quality:90}).toBuffer()
    images.push({bytes,name:`待整改实际页面-${page.pageId}.jpg`,sha256:digest(bytes)})
  }
  return images
}
async function walk(folder:string):Promise<string[]>{
  let entries;try{entries=await readdir(folder,{withFileTypes:true})}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e}
  const files:string[]=[]
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'))){const path=join(folder,entry.name);if(entry.isDirectory())files.push(...await walk(path));else if(entry.isFile()&&/\.(png|jpe?g|webp)$/i.test(path))files.push(path)}
  return files
}
/** Native product discovers source candidates; it never assigns them to report pages. */
export async function discoverChapterAssets(workspace:string,existing:ChapterAssetInput[],signal:AbortSignal):Promise<ChapterAssetInput[]>{
  const assets=[...existing],seen=new Set(assets.map(a=>a.sha256)),folder=join(workspace,'原始资料/用户补充点位照片')
  const generatedFolder=join(workspace,'.pre-design/chapter-scene-assets')
  let generatedFiles:string[]=[]
  try{generatedFiles=(await readdir(generatedFolder)).filter(name=>name.endsWith('.json'))}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
  for(const name of generatedFiles)for(const asset of JSON.parse(await readFile(join(generatedFolder,name),'utf8')) as ChapterAssetInput[]){
    if(!seen.has(asset.sha256)){assets.push(asset);seen.add(asset.sha256)}
  }
  const terrain=await chapterTerrainAsset(workspace,signal)
  if(terrain&&!assets.some(a=>a.id===terrain.id)){assets.push(terrain);seen.add(terrain.sha256)}
  for(const path of await walk(folder)){
    signal.throwIfAborted();const bytes=await readFile(path),sha256=digest(bytes);if(seen.has(sha256))continue
    const metadata=await sharp(bytes).metadata();if(!metadata.width||!metadata.height)continue
    const name=relative(folder,path).replaceAll('\\','/')
    assets.push({id:'site-'+sha256.slice(0,10),path,sha256,width:metadata.width,height:metadata.height,label:name.replace(extname(path),''),
      sourceNote:'用户提供的现场照片：'+name+'。目录名称是资料标签；场景由实际图像核对，不据此确认权属、经营状态或开发许可。'})
    seen.add(sha256)
  }
  // Equal decoded previews also join copies whose EXIF or encoding differs.
  for(const asset of assets){
    asset.visualKind??=['map','region','terrain','dem-relief'].includes(asset.id)?'map':'scene'
    signal.throwIfAborted();const bytes=await readFile(asset.path)
    if(digest(bytes)!==asset.sha256)throw new Error('CHAPTER_ASSET_CHANGED: '+asset.id)
    const pixels=await sharp(bytes).rotate().resize(128,128,{fit:'fill'}).removeAlpha().raw().toBuffer()
    asset.imageIdentity=asset.imageIdentity??{originalId:'pixels:'+digest(pixels),fileSha256:asset.sha256,pixelFingerprint:digest(pixels),verification:'decoded-pixels'}
  }
  return assets
}

export async function chapterAssetContactSheets(root:string,assets:ChapterAssetInput[],signal:AbortSignal){
  const folder=join(root,'素材候选');await mkdir(folder,{recursive:true})
  const images:{bytes:Buffer;name:string;sha256:string}[]=[]
  for(let start=0;start<assets.length;start+=16){
    const part=assets.slice(start,start+16),tiles:sharp.OverlayOptions[]=[]
    for(const [i,asset] of part.entries()){
      signal.throwIfAborted()
      const image=await sharp(await readFile(asset.path)).rotate().resize(320,225,{fit:'contain',background:'#e6e8df'}).jpeg().toBuffer()
      const label=Buffer.from(`<svg width="320" height="39"><rect width="320" height="39" fill="white"/><text x="5" y="16" font-family="Microsoft YaHei" font-size="13">${escape(asset.id)}</text><text x="5" y="33" font-family="Microsoft YaHei" font-size="12">${escape(asset.label.slice(0,25))}</text></svg>`)
      tiles.push({input:image,left:(i%4)*320,top:Math.floor(i/4)*264},{input:label,left:(i%4)*320,top:Math.floor(i/4)*264+225})
    }
    const bytes=await sharp({create:{width:1280,height:Math.ceil(part.length/4)*264,channels:3,background:'white'}}).composite(tiles).jpeg({quality:90}).toBuffer()
    const name=`候选图-${start/16+1}.jpg`;await writeFile(join(folder,name),bytes);images.push({bytes,name,sha256:digest(bytes)})
  }
  const terrain=assets.find(a=>a.id==='terrain')
  if(terrain){
    const bytes=await sharp(await readFile(terrain.path)).rotate().trim({threshold:16}).resize(1040,900,{fit:'cover'}).jpeg({quality:90}).toBuffer()
    const name='首图实际裁切预览.jpg';await writeFile(join(folder,name),bytes);images.push({bytes,name,sha256:digest(bytes)})
  }
  const map=assets.find(a=>a.id==='map')
  if(map){
    const bytes=await sharp(await readFile(map.path)).rotate().resize(1600,1100,{fit:'inside',withoutEnlargement:true}).jpeg({quality:95}).toBuffer()
    const name='原始点位图完整预览.jpg';await writeFile(join(folder,name),bytes);images.push({bytes,name,sha256:digest(bytes)})
  }
  const relief=assets.find(a=>a.id==='dem-relief')
  if(relief){
    const bytes=await sharp(await readFile(relief.path)).resize(1400,1400,{fit:'inside',withoutEnlargement:true}).jpeg({quality:95}).toBuffer()
    const name='DEM形态底图完整预览-北向上.jpg';await writeFile(join(folder,name),bytes);images.push({bytes,name,sha256:digest(bytes)})
  }
  return images
}
