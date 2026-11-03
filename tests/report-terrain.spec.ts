import { expect,it } from 'vitest'
import { deriveTerrainCells, validateTerrainPlan } from '../src/report/terrain-reference.ts'
import { terrainRoute } from '../src/report/terrain-render.ts'
import { reportImageInspectionSource } from '../src/presentation/report-image-pipeline.ts'
import { sha256CanonicalJson as hash } from '../src/presentation/canonical-json.ts'

it('derives slope and water constraints from actual elevations, not the preview image',()=>{
  const grid={rows:4,columns:4,x:Array.from({length:16},(_,i)=>(i%4)*20),y:Array.from({length:16},(_,i)=>Math.floor(i/4)*20),
    z:Array.from({length:16},(_,i)=>(i%4)*10),valid:Array(16).fill(1),water:Array.from({length:16},(_,i)=>i<4?1:0)}
  const cells=deriveTerrainCells(grid,2)
  expect(cells).toHaveLength(4)
  expect(cells.find(c=>c.id==='A1')?.slopeDegrees).toBeCloseTo(26.565,1)
  expect(cells.reduce((n,c)=>n+c.waterFraction,0)).toBe(1)
})
it('rejects a terrain appendix without zones, nodes and circulation, and an invented cell',()=>{
  const terrain:any={id:'terrain-original',cells:[{id:'A1',waterFraction:0,validFraction:1,slopeDegrees:2,anchor:[0,0,10]}]}
  expect(()=>validateTerrainPlan(undefined,terrain,['product-a'])).toThrow('TERRAIN_PLAN_REQUIRED')
  const plan={sourceId:'terrain-original',zones:[{name:'体验区',cellIds:['A1'],productRefs:['product-a']}],
    nodes:[{id:'arrival',name:'入口',cellId:'A1',role:'arrival',productRefs:['product-a']},{id:'product',name:'课堂',cellId:'A1',role:'product',productRefs:['product-a']},
      {id:'service',name:'服务',cellId:'A1',role:'service',productRefs:[]},{id:'logistics',name:'后勤',cellId:'A1',role:'logistics',productRefs:[]}],
    routes:[{name:'游览',kind:'visitor',nodeIds:['arrival','product']},{name:'后勤',kind:'logistics',nodeIds:['logistics','service']}]}
  expect(()=>validateTerrainPlan(plan as any,terrain,['product-a'])).not.toThrow()
  plan.nodes[1].cellId='invented';expect(()=>validateTerrainPlan(plan as any,terrain,['product-a'])).toThrow('TERRAIN_CELL_INVALID')
})
it('routes across valid terrain and rejects a water barrier rather than drawing a fictitious crossing',()=>{
  const grid={rows:4,columns:4,x:Array.from({length:16},(_,i)=>(i%4)*20),y:Array.from({length:16},(_,i)=>Math.floor(i/4)*20),z:Array(16).fill(5),valid:Array(16).fill(1),water:Array(16).fill(0)}
  const result=terrainRoute(grid,[0,0],[60,60],35)
  expect(result.lengthMeters).toBe(120)
  for(let i=4;i<8;i++)grid.water[i]=1
  expect(()=>terrainRoute(grid,[0,0],[60,60],35)).toThrow('TERRAIN_ROUTE_BLOCKED')
})
it('rejects steep adjacent edges even where central differences cancel',()=>{
  const grid={rows:4,columns:4,x:Array.from({length:16},(_,i)=>(i%4)*20),y:Array.from({length:16},(_,i)=>Math.floor(i/4)*20),z:Array.from({length:16},(_,i)=>i%2*100),valid:Array(16).fill(1),water:Array(16).fill(0)}
  expect(()=>terrainRoute(grid,[20,20],[40,20],15)).toThrow('TERRAIN_ROUTE_BLOCKED')
  grid.z.fill(5);grid.z[5]=NaN
  expect(()=>terrainRoute(grid,[20,20],[40,20],15)).toThrow('TERRAIN_ROUTE_BLOCKED')
})
it('only verifies a terrain map bound to this project, grid, georeference, plan and actual raster',()=>{
  const terrainPlan={sourceId:'terrain-1',zones:[],nodes:[],routes:[]}
  const project:any={projectId:'p1',projectName:'少潭河',terrain:{id:'terrain-1',fingerprint:'grid-hash',georeferencePath:'/geo.json',files:[{path:'/geo.json',sha256:'geo-hash'}]},manuscript:{chapters:[{pages:[{id:'space-1',terrainPlan}]}]}}
  const proof={kind:'terrain-study',projectId:'p1',pageId:'space-1',terrainId:'terrain-1',terrainFingerprint:'grid-hash',georeferenceHash:'geo-hash',planHash:hash(terrainPlan),sourceSha256:'png-hash'}
  const asset:any={semanticRole:'map',sha256:'png-hash',origin:{method:JSON.stringify(proof)},imageQuality:{contentKind:'map',sourceLocation:'少潭河'}}
  expect(reportImageInspectionSource(asset,project)).toMatchObject({sourceType:'project',sourceLocationVerified:true,textPolicy:'cartographic-language-v1'})
  expect(reportImageInspectionSource({...asset,analysisEvidence:[{statement:'altered route calculations'}]},project).sourceEvidenceHash).not.toBe(reportImageInspectionSource(asset,project).sourceEvidenceHash)
  for(const field of ['projectId','pageId','terrainId','terrainFingerprint','georeferenceHash','planHash','sourceSha256']){
    expect(reportImageInspectionSource({...asset,origin:{method:JSON.stringify({...proof,[field]:'changed'})}},project).sourceLocationVerified).toBe(false)
    expect(reportImageInspectionSource({...asset,origin:{method:JSON.stringify({...proof,[field]:'changed',sourceClaims:{sourceLocation:{status:'supported',value:'少潭河'}}})}},project).sourceLocationVerified).toBe(false)
  }
})
