import { readFile,mkdir,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { loadTerrainReference,readTerrainGrid,terrainBounds,type TerrainGrid } from './terrain-reference.ts'
import type { ChapterAssetInput } from './chapter-production-export.ts'

/** A new data expression of the DEM, never a renamed/cropped copy of a photograph. */
export function terrainReliefPixels(grid:TerrainGrid){
  const bounds=terrainBounds(grid),[west,south,east,north]=bounds as [number,number,number,number]
  let low=Infinity,high=-Infinity
  for(let i=0;i<grid.z.length;i++)if(grid.valid[i]&&Number.isFinite(grid.z[i])){low=Math.min(low,grid.z[i]!);high=Math.max(high,grid.z[i]!)}
  if(!Number.isFinite(low))throw new Error('CHAPTER_TERRAIN_EMPTY')
  const pixels=Buffer.alloc(grid.rows*grid.columns*4)
  for(let i=0;i<grid.z.length;i++){
    if(!grid.valid[i]||!Number.isFinite(grid.z[i]))continue
    const col=Math.round((grid.x[i]!-west)/(east-west)*(grid.columns-1)),row=Math.round((north-grid.y[i]!)/(north-south)*(grid.rows-1)),at=(row*grid.columns+col)*4
    const c=i%grid.columns,r=Math.floor(i/grid.columns)
    const sample=(j:number)=>grid.valid[j]&&Number.isFinite(grid.z[j])?grid.z[j]!:grid.z[i]!
    const l=r*grid.columns+Math.max(0,c-1),rr=r*grid.columns+Math.min(grid.columns-1,c+1),b=Math.max(0,r-1)*grid.columns+c,t0=Math.min(grid.rows-1,r+1)*grid.columns+c
    const dx=(sample(rr)-sample(l))/(grid.x[rr]!-grid.x[l]!),dy=(sample(t0)-sample(b))/(grid.y[t0]!-grid.y[b]!)
    const shade=.55+.65*Math.max(0,(dx*.5-dy*.5+.7071)/Math.hypot(dx,dy,1))
    const t=(grid.z[i]!-low)/Math.max(1,high-low),color=grid.water[i]?[70,131,157]:[178+55*t,199-16*t,156-25*t].map(v=>Math.max(0,Math.min(255,Math.round(v*shade))))
    pixels.set([...color,255],at)
  }
  return{pixels,bounds,elevationRange:[low,high]}
}

export async function chapterTerrainAsset(workspace:string,signal:AbortSignal):Promise<ChapterAssetInput|undefined>{
  const terrain=await loadTerrainReference(workspace);if(!terrain)return
  signal.throwIfAborted()
  const grid=await readTerrainGrid(terrain.gridPath),r=terrainReliefPixels(grid)
  const folder=join(workspace,'.pre-design/chapter-derived-assets','dem-relief-v3-'+terrain.fingerprint.slice(0,16))
  await mkdir(folder,{recursive:true})
  const width=1200,height=Math.round(width*(r.bounds[3]!-r.bounds[1]!)/(r.bounds[2]!-r.bounds[0]!))
  const png=await sharp(r.pixels,{raw:{width:grid.columns,height:grid.rows,channels:4}}).resize(width,height).flatten({background:'#f8f7f1'}).png().toBuffer()
  const path=join(folder,'DEM形态底图.png'),sha256=createHash('sha256').update(png).digest('hex')
  const [west,south,east,north]=r.bounds as [number,number,number,number]
  const point=(x:number,y:number)=>({x:Number(((x-west)/(east-west)).toFixed(6)),y:Number(((north-y)/(north-south)).toFixed(6))})
  const terrainAnchors=terrain.cells.filter(c=>c.anchor.length===3).map(c=>({id:c.id,point:point(c.anchor[0]!,c.anchor[1]!),water:false,elevation:Math.round(c.anchor[2]!)}))
  const water=grid.x.map((_,i)=>i).filter(i=>grid.valid[i]&&grid.water[i])
  if(water.length){
    const cx=water.reduce((s,i)=>s+grid.x[i]!,0)/water.length,cy=water.reduce((s,i)=>s+grid.y[i]!,0)/water.length
    const i=water.reduce((best,i)=>Math.hypot(grid.x[i]!-cx,grid.y[i]!-cy)<Math.hypot(grid.x[best]!-cx,grid.y[best]!-cy)?i:best,water[0]!)
    terrainAnchors.push({id:'WATER',point:point(grid.x[i]!,grid.y[i]!),water:true,elevation:Math.round(grid.z[i]!)})
  }
  // The hash binds actual source files, coordinates and interpretation. DSH authors the analysis overlay.
  for(const file of terrain.files)if(createHash('sha256').update(await readFile(file.path)).digest('hex')!==file.sha256)throw new Error('CHAPTER_TERRAIN_CHANGED')
  await writeFile(path,png)
  await writeFile(join(folder,'数据派生依据.json'),JSON.stringify({version:'dem-relief-v3',terrain,bounds:r.bounds,elevationRange:r.elevationRange,terrainAnchors,sha256,orientation:'north-up',method:'Original valid X/Y/Z_raw and water arrays projected north-up; DEM tint with 1:1 gradient hillshade; no inferred roads, contours or legal boundaries.'},null,2))
  return{id:'dem-relief',path,sha256,width,height,terrainAnchors,label:'真实DEM形态底图（北向上）',sourceNote:'由原始terrain_grid.npz数据派生，非旧地形预览的重复裁切。北向上、东向右；蓝色为原模型近似水域掩膜，陆地绿色至浅褐色表达相对高程由低到高。约33米原始采样、20米插值不提高精度，仅作策划形态观察，不推断精确山脊、道路、村落和工程坡度。拟议节点与联系由DSH根据页任务绘制，不代表已落实位置。数据依据：'+join(folder,'数据派生依据.json')}
}
