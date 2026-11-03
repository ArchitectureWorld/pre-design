import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile,readdir,stat } from 'node:fs/promises'
import { dirname,join,relative } from 'node:path'
import JSZip from 'jszip'
import { sha256CanonicalJson as hash } from '../presentation/canonical-json.ts'

export interface TerrainGrid { rows:number;columns:number;x:number[];y:number[];z:number[];valid:number[];water:number[] }
export interface TerrainCell { id:string;row:number;column:number;bounds:readonly number[];validFraction:number;waterFraction:number;
  elevationRange:readonly number[];slopeDegrees:number;anchor:readonly number[] }
export interface TerrainReference { version:'terrain-reference.v1';id:string;fingerprint:string;gridPath:string;georeferencePath:string;
  files:readonly {path:string;sha256:string}[];bounds:readonly number[];cells:readonly TerrainCell[];method:string;limitations:readonly string[] }
export interface TerrainPlan {
  sourceId:string
  zones:readonly {name:string;cellIds:readonly string[];productRefs:readonly string[]}[]
  nodes:readonly {id:string;name:string;cellId:string;role:'arrival'|'product'|'service'|'logistics';productRefs:readonly string[]}[]
  routes:readonly {name:string;kind:'visitor'|'logistics';nodeIds:readonly string[]}[]
}
function fail(code:string):never{throw new Error(code)}
const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
async function fileHash(path:string){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex')}
function numpy(bytes:Buffer){
  if(bytes[0]!==147||bytes.subarray(1,6).toString()!=='NUMPY'||![1,2].includes(bytes[6]!))return fail('TERRAIN_ARRAY_FORMAT')
  const offset=bytes[6]===1?10:12,length=bytes[6]===1?bytes.readUInt16LE(8):bytes.readUInt32LE(8),header=bytes.subarray(offset,offset+length).toString()
  const dtype=/'descr':\s*'([^']+)'/u.exec(header)?.[1],shape=/'shape':\s*\(([^)]+)\)/u.exec(header)?.[1]?.split(',').map(s=>s.trim()).filter(Boolean).map(Number)
  if(!shape||shape.length!==2||shape.some(n=>!Number.isSafeInteger(n)||n<2)||shape[0]!*shape[1]!>2000000||!/'fortran_order':\s*False/u.test(header))return fail('TERRAIN_ARRAY_SHAPE')
  const width=dtype==='<f8'?8:dtype==='<f4'?4:dtype==='|b1'||dtype==='|u1'?1:0
  if(!width||bytes.length!==offset+length+shape[0]!*shape[1]!*width)return fail('TERRAIN_ARRAY_TYPE')
  const values=Array.from({length:shape[0]!*shape[1]!},(_,i)=>width===8?bytes.readDoubleLE(offset+length+i*width):width===4?bytes.readFloatLE(offset+length+i*width):bytes[offset+length+i]!)
  return{rows:shape[0]!,columns:shape[1]!,values}
}
export async function readTerrainGrid(path:string):Promise<TerrainGrid>{
  if((await stat(path)).size>64000000)fail('TERRAIN_GRID_TOO_LARGE')
  const zip=await JSZip.loadAsync(await readFile(path)),arrays:Record<string,ReturnType<typeof numpy>>={}
  for(const name of ['X','Y','Z_raw','valid','water']){
    const entry=zip.file(name+'.npy');if(!entry)fail('TERRAIN_ARRAY_MISSING')
    const value=numpy(await entry!.async('nodebuffer'))
    if(arrays.X&&(value.rows!==arrays.X.rows||value.columns!==arrays.X.columns))fail('TERRAIN_ARRAY_SHAPE')
    arrays[name]=value
  }
  const a=arrays as Record<string,ReturnType<typeof numpy>>
  return{rows:a.X!.rows,columns:a.X!.columns,x:a.X!.values,y:a.Y!.values,z:a.Z_raw!.values,valid:a.valid!.values,water:a.water!.values}
}
export function terrainBounds(grid:TerrainGrid){
  let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity
  for(let i=0;i<grid.x.length;i++){const x=grid.x[i]!,y=grid.y[i]!;if(!Number.isFinite(x)||!Number.isFinite(y))fail('TERRAIN_COORDINATES_INVALID');west=Math.min(west,x);east=Math.max(east,x);south=Math.min(south,y);north=Math.max(north,y)}
  if(east<=west||north<=south)fail('TERRAIN_COORDINATES_INVALID')
  return[west,south,east,north]
}
export function terrainSlope(grid:TerrainGrid,i:number){
  const row=Math.floor(i/grid.columns),column=i%grid.columns,l=row*grid.columns+Math.max(0,column-1),r=row*grid.columns+Math.min(grid.columns-1,column+1),b=Math.max(0,row-1)*grid.columns+column,t=Math.min(grid.rows-1,row+1)*grid.columns+column
  const dzdx=(grid.z[r]!-grid.z[l]!)/(grid.x[r]!-grid.x[l]!),dzdy=(grid.z[t]!-grid.z[b]!)/(grid.y[t]!-grid.y[b]!)
  return Math.atan(Math.hypot(dzdx,dzdy))*180/Math.PI
}
export function deriveTerrainCells(grid:TerrainGrid,size=6):TerrainCell[]{
  const [west,south,east,north]=terrainBounds(grid) as [number,number,number,number],buckets=Array.from({length:size*size},()=>[] as number[])
  for(let i=0;i<grid.x.length;i++){
    if(grid.valid[i]&&(!Number.isFinite(grid.z[i])||![0,1].includes(grid.water[i]!)))fail('TERRAIN_ELEVATION_INVALID')
    const column=Math.min(size-1,Math.floor((grid.x[i]!-west)/(east-west)*size)),row=Math.min(size-1,Math.floor((north-grid.y[i]!)/(north-south)*size))
    buckets[row*size+column]!.push(i)
  }
  return buckets.map((indices,index)=>{
    const row=Math.floor(index/size),column=index%size,bounds=[west+(east-west)*column/size,north-(north-south)*(row+1)/size,west+(east-west)*(column+1)/size,north-(north-south)*row/size]
    const valid=indices.filter(i=>grid.valid[i]),land=valid.filter(i=>!grid.water[i]),slopes=land.map(i=>terrainSlope(grid,i)).filter(Number.isFinite)
    const cx=(bounds[0]!+bounds[2]!)/2,cy=(bounds[1]!+bounds[3]!)/2
    const anchor=[...land].sort((a,b)=>Math.hypot(grid.x[a]!-cx,grid.y[a]!-cy)-Math.hypot(grid.x[b]!-cx,grid.y[b]!-cy))[0]
    return{id:String.fromCharCode(65+row)+(column+1),row,column,bounds,validFraction:valid.length/Math.max(1,indices.length),waterFraction:valid.filter(i=>grid.water[i]).length/Math.max(1,valid.length),
      elevationRange:valid.length?[Math.min(...valid.map(i=>grid.z[i]!)),Math.max(...valid.map(i=>grid.z[i]!))]:[],
      slopeDegrees:slopes.length?slopes.reduce((a,b)=>a+b,0)/slopes.length:0,anchor:anchor===undefined?[]:[grid.x[anchor]!,grid.y[anchor]!,grid.z[anchor]!],}
  })
}
export async function loadTerrainReference(root:string):Promise<TerrainReference|undefined>{
  const matches:string[]=[]
  async function walk(folder:string,depth=0){if(depth>8)return;for(const entry of await readdir(folder,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const path=join(folder,entry.name);if(entry.isDirectory())await walk(path,depth+1);else if(entry.name==='terrain_grid.npz')matches.push(path)}}
  try{await walk(join(root,'原始资料'))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
  if(!matches.length)return;if(matches.length!==1)fail('TERRAIN_REFERENCE_AMBIGUOUS')
  const gridPath=matches[0]!,georeferencePath=join(dirname(gridPath),'georeference.json'),bytes=await readFile(georeferencePath),geo=JSON.parse(bytes.toString())
  if(typeof geo.elevation_source!=='string'||typeof geo.local_axes!=='string'||!Array.isArray(geo.limitations)||geo.vertical_exaggeration!==1)fail('TERRAIN_GEOREFERENCE_INVALID')
  const grid=await readTerrainGrid(gridPath),files=[{path:gridPath,sha256:await fileHash(gridPath)},{path:georeferencePath,sha256:digest(bytes)}]
  const directory=dirname(dirname(gridPath)),models=(await readdir(directory)).filter(p=>p.endsWith('.blend'))
  for(const name of models)files.push({path:join(directory,name),sha256:await fileHash(join(directory,name))})
  const fingerprint=hash(files.map(f=>({...f,path:relative(root,f.path)}))),id='terrain:'+fingerprint.slice(0,16)
  return{version:'terrain-reference.v1',id,fingerprint,gridPath,georeferencePath,files,bounds:terrainBounds(grid),cells:deriveTerrainCells(grid),
    method:`${geo.elevation_source}。${geo.local_axes}。坡度按原始DEM中心差分，分区为等距研究网格；点位选取网格中心附近的有效陆域样本，仅为方案候选位置。`,
    limitations:[...geo.limitations.map(String),'研究网格、节点与连接为概念方案，不证明产权、建设边界、道路可达性、法定审批或施工精度。']}
}
export function validateTerrainPlan(plan:TerrainPlan|undefined,terrain:TerrainReference,productIds:readonly string[]){
  if(!plan||plan.sourceId!==terrain.id||!plan.zones?.length||!plan.nodes?.length||!plan.routes?.length)fail('TERRAIN_PLAN_REQUIRED')
  const cells=new Map(terrain.cells.map(c=>[c.id,c])),products=new Set(productIds),nodes=new Map(plan.nodes.map(n=>[n.id,n]))
  if(nodes.size!==plan.nodes.length)fail('TERRAIN_NODE_DUPLICATE')
  const refs=(ids:readonly string[])=>{if(ids.some(id=>!products.has(id)))fail('TERRAIN_PRODUCT_INVALID')}
  for(const zone of plan.zones){if(!zone.name.trim()||!zone.cellIds.length||zone.cellIds.some(id=>!cells.has(id)))fail('TERRAIN_CELL_INVALID');refs(zone.productRefs)}
  for(const node of plan.nodes){const cell=cells.get(node.cellId);if(!cell||cell.anchor.length!==3||cell.validFraction===0||cell.waterFraction>=0.9)fail('TERRAIN_CELL_INVALID');refs(node.productRefs)}
  for(const role of ['arrival','product','service','logistics'])if(!plan.nodes.some(n=>n.role===role))fail('TERRAIN_ORGANIZATION_REQUIRED')
  for(const route of plan.routes)if(route.nodeIds.length<2||route.nodeIds.some(id=>!nodes.has(id)))fail('TERRAIN_ROUTE_INVALID')
  if(!plan.routes.some(r=>r.kind==='visitor')||!plan.routes.some(r=>r.kind==='logistics'))fail('TERRAIN_ROUTE_INVALID')
  for(const product of products)if(!plan.nodes.some(n=>n.productRefs.includes(product))||!plan.zones.some(z=>z.productRefs.includes(product)))fail('TERRAIN_PRODUCT_UNBOUND')
}
