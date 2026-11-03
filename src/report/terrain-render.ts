import { mkdir,readFile,writeFile } from 'node:fs/promises'
import { join,basename } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { ReportImageDemand } from '../presentation/report-image-pipeline.ts'
import type { PresentationAdoptedAssetInput } from '../presentation/standard-project-types.ts'
import type { FrozenProjectInput } from './types.ts'
import { readTerrainGrid,terrainBounds,terrainSlope,validateTerrainPlan,type TerrainGrid } from './terrain-reference.ts'
import { sha256CanonicalJson as hash } from '../presentation/canonical-json.ts'

/** Four-neighbour least-cost corridor; water, missing samples and steep land remain barriers. */
export function terrainRoute(grid:TerrainGrid,from:readonly number[],to:readonly number[],maximumSlope:number){
  const nearest=(p:readonly number[])=>{let at=-1,best=Infinity;for(let i=0;i<grid.x.length;i++){const distance=Math.hypot(grid.x[i]!-p[0]!,grid.y[i]!-p[1]!);if(distance<best){best=distance;at=i}}return at}
  const start=nearest(from),end=nearest(to),cost=new Float64Array(grid.x.length).fill(Infinity),previous=new Int32Array(grid.x.length).fill(-1),queue:{i:number;cost:number}[]=[]
  const allowed=(i:number)=>grid.valid[i]&&!grid.water[i]&&Number.isFinite(grid.z[i])&&terrainSlope(grid,i)<=maximumSlope
  if(!allowed(start)||!allowed(end))throw new Error('TERRAIN_ROUTE_BLOCKED: 拟定节点位于水域、缺测或超出本路线坡度假设的位置。')
  const push=(value:{i:number;cost:number})=>{queue.push(value);let at=queue.length-1;while(at>0){const p=Math.floor((at-1)/2);if(queue[p]!.cost<=value.cost)break;queue[at]=queue[p]!;at=p}queue[at]=value}
  const pop=()=>{const first=queue[0]!,last=queue.pop()!;if(queue.length){let at=0;while(at*2+1<queue.length){let child=at*2+1;if(child+1<queue.length&&queue[child+1]!.cost<queue[child]!.cost)child++;if(queue[child]!.cost>=last.cost)break;queue[at]=queue[child]!;at=child}queue[at]=last}return first}
  cost[start]=0;push({i:start,cost:0})
  while(queue.length){const current=pop();if(current.cost!==cost[current.i])continue;if(current.i===end)break
    const row=Math.floor(current.i/grid.columns),column=current.i%grid.columns
    const neighbours=[...(column>0?[current.i-1]:[]),...(column+1<grid.columns?[current.i+1]:[]),...(row>0?[current.i-grid.columns]:[]),...(row+1<grid.rows?[current.i+grid.columns]:[])]
    for(const next of neighbours){if(!allowed(next))continue
      const distance=Math.hypot(grid.x[next]!-grid.x[current.i]!,grid.y[next]!-grid.y[current.i]!)
      const edgeSlope=Math.atan(Math.abs(grid.z[next]!-grid.z[current.i]!)/distance)*180/Math.PI
      if(!Number.isFinite(distance)||distance<=0||!Number.isFinite(edgeSlope)||edgeSlope>maximumSlope)continue
      const slope=terrainSlope(grid,next),value=current.cost+distance*(1+(slope/15)**2)
      if(value<cost[next]!){cost[next]=value;previous[next]=current.i;push({i:next,cost:value})}}
  }
  if(!Number.isFinite(cost[end]))throw new Error('TERRAIN_ROUTE_BLOCKED: 拟定节点间无法在当前坡度假设下避让水域与缺测区，须修改方案节点或明确独立交通研究。')
  const indices:number[]=[];for(let i=end;i!==-1;i=previous[i]!)indices.push(i);indices.reverse()
  let lengthMeters=0;for(let i=1;i<indices.length;i++)lengthMeters+=Math.hypot(grid.x[indices[i]!]!-grid.x[indices[i-1]!]!,grid.y[indices[i]!]!-grid.y[indices[i-1]!]!)
  return{points:indices.map(i=>[grid.x[i]!,grid.y[i]!,grid.z[i]!]),lengthMeters,maximumSlope,method:'grid-least-cost.v2',nature:'proposed-corridor-not-existing-road'}
}
const esc=(s:string)=>s.replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
export async function prepareTerrainPlanImage(demand:ReportImageDemand,input:FrozenProjectInput,root:string,signal:AbortSignal):Promise<readonly PresentationAdoptedAssetInput[]>{
  const page=input.manuscript?.chapters.flatMap(c=>c.pages).find(p=>p.id===demand.brief.pageId),terrain=input.terrain,plan=page?.terrainPlan
  if(!terrain||!plan)return[]
  signal.throwIfAborted();validateTerrainPlan(plan,terrain,page.productRefs??[])
  for(const file of terrain.files){const actual=createHash('sha256').update(await readFile(file.path,{signal})).digest('hex');if(actual!==file.sha256)throw new Error('REPORT_TERRAIN_CHANGED')}
  const grid=await readTerrainGrid(terrain.gridPath),[west,south,east,north]=terrainBounds(grid) as [number,number,number,number]
  const cells=new Map(terrain.cells.map(c=>[c.id,c])),nodes=new Map(plan.nodes.map(n=>[n.id,{...n,coordinate:cells.get(n.cellId)!.anchor}]))
  const routes=plan.routes.map(route=>({...route,segments:route.nodeIds.slice(1).map((id,i)=>terrainRoute(grid,nodes.get(route.nodeIds[i]!)!.coordinate,nodes.get(id)!.coordinate,route.kind==='visitor'?35:15))}))
  const w=1800,h=1120,left=65,top=130,mapH=845,mapW=mapH*(east-west)/(north-south),right=left+mapW+80
  const xy=(p:readonly number[])=>[left+(p[0]!-west)/(east-west)*mapW,top+(north-p[1]!)/(north-south)*mapH]
  const pixels=Buffer.alloc(grid.rows*grid.columns*4),range=terrain.cells.flatMap(c=>c.elevationRange),zmin=Math.min(...range),zmax=Math.max(...range)
  for(let i=0;i<grid.x.length;i++){
    const column=Math.min(grid.columns-1,Math.round((grid.x[i]!-west)/(east-west)*(grid.columns-1))),row=Math.min(grid.rows-1,Math.round((north-grid.y[i]!)/(north-south)*(grid.rows-1))),p=(row*grid.columns+column)*4
    if(!grid.valid[i])continue
    const t=(grid.z[i]!-zmin)/Math.max(1,zmax-zmin),color=grid.water[i]?[70,131,157]:[Math.round(126+83*t),Math.round(156+32*t),Math.round(116+39*t)]
    pixels[p]=color[0]!;pixels[p+1]=color[1]!;pixels[p+2]=color[2]!;pixels[p+3]=255
  }
  const base=await sharp(pixels,{raw:{width:grid.columns,height:grid.rows,channels:4}}).png().toBuffer(),palette=['#b66339','#7b70b0','#ceab46','#347d72','#aa4f73','#667d37']
  const zones=plan.zones.map((zone,i)=>zone.cellIds.map(id=>{const c=cells.get(id)!,p=xy([c.bounds[0]!,c.bounds[3]!]),q=xy([c.bounds[2]!,c.bounds[1]!]);return`<rect x="${p[0]}" y="${p[1]}" width="${q[0]!-p[0]!}" height="${q[1]!-p[1]!}" fill="${palette[i%palette.length]}" fill-opacity=".2" stroke="${palette[i%palette.length]}" stroke-width="2"/>`}).join('')).join('')
  const routeSvg=routes.map(r=>r.segments.map(s=>`<polyline points="${s.points.map(p=>xy(p).join(',')).join(' ')}" fill="none" stroke="${r.kind==='visitor'?'#fff4be':'#583b39'}" stroke-width="${r.kind==='visitor'?5:3}" stroke-dasharray="${r.kind==='visitor'?'0':'9 6'}"/>`).join('')).join('')
  const dots=plan.nodes.map((n,i)=>{const p=xy(nodes.get(n.id)!.coordinate);return`<circle cx="${p[0]}" cy="${p[1]}" r="12" fill="#fff" stroke="#243e36" stroke-width="2"/><text x="${p[0]}" y="${p[1]!+5}" text-anchor="middle" font-size="15" fill="#243e36">${i+1}</text>`}).join('')
  const zoneLegend=plan.zones.map((z,i)=>`<text x="${right}" y="${185+i*35}" font-size="23" fill="${palette[i%palette.length]}">${esc(z.name)} · ${esc(z.cellIds.join(' / '))}</text>`).join('')
  const nodeStart=235+plan.zones.length*35,nodeLegend=plan.nodes.map((n,i)=>`<text x="${right}" y="${nodeStart+i*31}" font-size="21">${i+1}　${esc(n.name)} · ${esc(n.cellId)}</text>`).join('')
  const routeStart=nodeStart+plan.nodes.length*31+48,routeLegend=routes.map((r,i)=>`<text x="${right}" y="${routeStart+i*33}" font-size="21">${esc(r.name)}：约 ${(r.segments.reduce((sum,s)=>sum+s.lengthMeters,0)/1000).toFixed(1)} km（拟定廊道）</text>`).join('')
  if(routeStart+routes.length*33>995)throw new Error('TERRAIN_PLAN_TOO_DENSE: 地形图图例过密，请按空间主题拆页。')
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="1800" height="1120" fill="#f5f3eb"/><g font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" fill="#263e35"><text x="65" y="66" font-size="38">${esc(page.title)}</text><text x="65" y="103" font-size="20">真实地形本底 × 拟定空间方案</text><image x="${left}" y="${top}" width="${mapW}" height="${mapH}" href="data:image/png;base64,${base.toString('base64')}"/>${zones}${routeSvg}${dots}<text x="${left+mapW-30}" y="${top+33}" font-size="25">北 ↑</text>${zoneLegend}${nodeLegend}${routeLegend}<path d="M${left} 1000 h${mapW*1000/(east-west)}" stroke="#263e35" stroke-width="5"/><text x="65" y="1030" font-size="20">1 km · 水域为原模型近似掩膜，陆域颜色表示DEM高程</text><text x="65" y="1073" font-size="19">彩色分区、编号节点及连线均为拟定方案；廊道按地形与水域避让，不证明通行条件或工程适建性。</text></g></svg>`
  const identity=hash({version:'terrain-study.v2',terrain:terrain.fingerprint,plan,claim:page.claim,slot:demand.slot??null}),directory=join(root,'.pre-design/report-terrain',identity)
  await mkdir(directory,{recursive:true});const png=await sharp(Buffer.from(svg)).png().toBuffer(),sourcePath=join(directory,'terrain-plan.png'),evidencePath=join(directory,'terrain-plan.json')
  await writeFile(sourcePath,png);await writeFile(join(directory,'terrain-plan.svg'),svg);await writeFile(evidencePath,JSON.stringify({terrain,plan,routes,assumptions:{visitorMaximumSlopeDegrees:35,logisticsMaximumSlopeDegrees:15,meaning:'研究算法的坡度避让假设；不是道路设计规范或审批结论'}},null,2))
  signal.throwIfAborted()
  const calculationEvidence={evidenceId:`${terrain.id}:${page.id}`,kind:'calculation' as const,
    statement:JSON.stringify({sourceNature:'原始DEM与配准记录；分区、节点及路线属于拟定方案',terrainId:terrain.id,terrainFingerprint:terrain.fingerprint,files:terrain.files,bounds:terrain.bounds,plan,routes,
      assumptions:{visitorMaximumSlopeDegrees:35,logisticsMaximumSlopeDegrees:15,meaning:'算法研究假设，不是道路设计规范'},recompute:'逐相邻点以sqrt(dx²+dy²)计算水平距离求和，以atan(abs(dz)/distance)校验边坡度；原始网格用于中心差分坡度与最小代价寻路。'},null,2),
    sourceLabel:'地形空间方案计算依据',sourceDate:input.generatedAt.slice(0,10),locator:evidencePath}
  return[{sourceKey:'terrain-plan-'+identity,sourcePath,originalFileName:basename(sourcePath),displayName:page.title,mimeType:'image/png',semanticRole:'map',analysisKind:'opportunity-structure',
    widthPx:w,heightPx:h,createdAt:input.generatedAt,adoptedAt:input.generatedAt,pageBindingOnly:true,pageBindings:[{findingId:demand.findingId,role:'primary'}],role:'primary',objectIds:[],evidenceIds:[terrain.id,calculationEvidence.evidenceId],analysisEvidence:[calculationEvidence],
    cartography:{boundary:'research',legend:'present',northArrow:'present',scale:{kind:'scale-bar',label:'1 km'},disclosures:terrain.limitations},
    origin:{type:'generated_by_tool',sourceMaterialKeys:[],parentAssetKeys:[],method:JSON.stringify({kind:'terrain-study',projectId:input.projectId,pageId:page.id,terrainId:terrain.id,terrainFingerprint:terrain.fingerprint,georeferenceHash:terrain.files.find(f=>f.path===terrain.georeferencePath)!.sha256,planHash:hash(plan),sourceSha256:createHash('sha256').update(png).digest('hex'),evidencePath}),sourceTool:{name:'terrain-study',version:'2.0.0'}},
    provenance:{sourceLabel:'用户地形数据与拟定方案',sourceDate:input.generatedAt.slice(0,10),sourceFileSha256:terrain.fingerprint,locator:evidencePath,evidenceIds:[terrain.id]},
    imageQuality:{contentKind:'map',sourceLocation:input.projectName,essentialBounds:[{x:0,y:0,width:1,height:1}],requirement:demand.brief}}]
}
