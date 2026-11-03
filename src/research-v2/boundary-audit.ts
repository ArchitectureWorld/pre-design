import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { getResearchModuleSpec } from './specification.ts'
import { assertModuleInputReferencesCurrent } from './module-input-identity.ts'

export const BOUNDARY_AUDIT_VERSION = 'research-boundary-audit.v3'
type BoundaryAuditVersion = 'research-boundary-audit.v1' | 'research-boundary-audit.v2' | typeof BOUNDARY_AUDIT_VERSION
export const BOUNDARY_AREA_REVIEW_CRITERION = '边界面积的来源、计算方法和适用范围必须一致；图幅、管理范围与项目实施范围不得混用，差异需逐项说明。'
export const BOUNDARY_PRECISION_REVIEW_CRITERION = 'DEM采样间距、坐标小数位和EXIF/GPS标签不证明定位或高程精度；精度数值与实测表述须有独立来源或可复算误差评定，缺失保持未知。有依据的设计控制目标须明确为目标，不能伪装为现状精度。'
export const BOUNDARY_PHOTO_REVIEW_CRITERION = '照片GPS是相机位置，不等于画面地物实测点位；点位名称及图片中的设想不证明现状用途、经营或批准，不构成必须采用的方案。新增空间方案须基于照片与研究自主论证取舍，不能照搬标签并冒称现场事实。'
export const currentBoundaryReviewCriteria = (qa: readonly string[]) => [...qa, BOUNDARY_AREA_REVIEW_CRITERION, BOUNDARY_PRECISION_REVIEW_CRITERION, BOUNDARY_PHOTO_REVIEW_CRITERION]
export function boundaryReviewCriteria(qa: readonly string[], audit?: BoundaryResearchAudit): readonly string[] {
  return audit?.version === BOUNDARY_AUDIT_VERSION ? currentBoundaryReviewCriteria(qa) : audit ? [...qa, BOUNDARY_AREA_REVIEW_CRITERION] : qa
}
const radius = 6371008.8, radians = Math.PI / 180
type Point = [number, number]
type Polygon = Point[][]
type Field = { value?: unknown }
type Row = Record<string, Field | string>
const value = (row: Row, key: string): unknown => (row[key] as Field | undefined)?.value ?? null
function fail(code: string): never { throw new Error(code) }
const same = (a: unknown, b: unknown) => sha256CanonicalJson(a) === sha256CanonicalJson(b)
const method = { id: 'spherical-edge-integral.v1', radiusMeters: radius,
  limitations: ['球面边界积分近似，非椭球测绘面积；沿经纬坐标边线积分，保留原坐标，不作投影转换。', '仅用于有来源的研究几何校核，不证明用地、权属、可建设性或法定批准。'] }

function orientation(a: Point, b: Point, c: Point) { return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]) }
function onSegment(a: Point, b: Point, p: Point) {
  return Math.abs(orientation(a,b,p)) < 1e-14 && p[0] >= Math.min(a[0],b[0]) && p[0] <= Math.max(a[0],b[0])
    && p[1] >= Math.min(a[1],b[1]) && p[1] <= Math.max(a[1],b[1])
}
function intersects(a: Point, b: Point, c: Point, d: Point) {
  return orientation(a,b,c)*orientation(a,b,d) < 0 && orientation(c,d,a)*orientation(c,d,b) < 0
    || onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b)
}
function ringsIntersect(a: Point[], b: Point[]) {
  return a.slice(1).some((p,i) => b.slice(1).some((q,j) => intersects(a[i],p,b[j],q)))
}
function inside(point: Point, ring: Point[]) {
  let contained = false
  for (let i=0, j=ring.length-2; i<ring.length-1; j=i++) {
    const a=ring[i], b=ring[j]
    if ((a[1]>point[1]) !== (b[1]>point[1]) && point[0] < (b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]) contained = !contained
  }
  return contained
}
/** Regional WGS84 polygons only; unsupported geographic extent is explicit. */
function polygons(geometry: unknown, crs: unknown, axis: unknown): Polygon[] {
  if (!['WGS84','EPSG:4326'].includes(String(crs))) fail('BOUNDARY_CRS_UNSUPPORTED')
  if (axis !== 'xy' && axis !== 'yx') fail('BOUNDARY_AXIS_ORDER_REQUIRED')
  const g=geometry as { type?: string; coordinates?: unknown }
  const raw=g?.type==='Polygon' ? [g.coordinates] : g?.type==='MultiPolygon' ? g.coordinates : fail('BOUNDARY_POLYGON_REQUIRED')
  if (!Array.isArray(raw) || !raw.length) fail('BOUNDARY_POLYGON_REQUIRED')
  let count=0
  const result: Polygon[] = raw.map(p => {
    if (!Array.isArray(p) || !p.length) fail('BOUNDARY_RING_REQUIRED')
    return p.map((ring: unknown) => {
      if (!Array.isArray(ring) || ring.length<4) fail('BOUNDARY_RING_REQUIRED')
      count+=ring.length
      if (count>2000) fail('BOUNDARY_TOPOLOGY_BUDGET_EXCEEDED')
      const points: Point[]=ring.map((p: unknown) => {
        if (!Array.isArray(p) || p.length<2 || p.length>3 || p.some(v => typeof v!=='number' || !Number.isFinite(v))) fail('BOUNDARY_POINT_INVALID')
        const [x,y]=axis==='xy' ? p : [p[1],p[0]]
        if (Math.abs(x)>180 || Math.abs(y)>90) fail('WGS84_GEOMETRY_OUT_OF_RANGE')
        if (Math.abs(y)>=89) fail('BOUNDARY_POLAR_EXTENT_UNSUPPORTED')
        return [x,y]
      })
      if (!same(points[0],points.at(-1))) fail('GEOMETRY_RING_NOT_CLOSED')
      if (Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0]))>=180) fail('BOUNDARY_ANTIMERIDIAN_UNSUPPORTED')
      for (let i=0; i<points.length-1; i++) {
        if (same(points[i],points[i+1])) fail('BOUNDARY_DUPLICATE_VERTEX')
        for (let j=i+2; j<points.length-1; j++) {
          if (i===0 && j===points.length-2) continue
          if (intersects(points[i],points[i+1],points[j],points[j+1])) fail('BOUNDARY_SELF_INTERSECTION')
        }
      }
      return points
    })
  })
  for (const p of result) for (let i=1; i<p.length; i++) {
    if (ringsIntersect(p[0],p[i]) || !inside(p[i][0],p[0])) fail('BOUNDARY_HOLE_OUTSIDE')
    for (let j=1; j<i; j++) if (ringsIntersect(p[i],p[j]) || inside(p[i][0],p[j]) || inside(p[j][0],p[i])) fail('BOUNDARY_HOLES_OVERLAP')
  }
  for (let i=0; i<result.length; i++) for (let j=0; j<i; j++) {
    // Conservative exclusion of nested parts, including islands inside another part's hole.
    if (result[i].some(a => result[j].some(b => ringsIntersect(a,b))) || inside(result[i][0][0],result[j][0]) || inside(result[j][0][0],result[i][0])) fail('BOUNDARY_PARTS_OVERLAP_OR_NEST')
  }
  return result
}
function ringArea(ring: Point[]) {
  return Math.abs(ring.slice(1).reduce((sum,p,i) => sum+(p[0]-ring[i][0])*radians*(Math.sin(p[1]*radians)+Math.sin(ring[i][1]*radians)),0))*radius**2/2
}
function measure(geometry: unknown, crs: unknown, axis: unknown) {
  const area=polygons(geometry,crs,axis).reduce((sum,p)=>sum+ringArea(p[0])-p.slice(1).reduce((a,r)=>a+ringArea(r),0),0)
  if (!Number.isFinite(area) || area<=0) fail('BOUNDARY_AREA_NONPOSITIVE')
  return area
}
function downstream() {
  const ids=new Set<string>(), pending=[...getResearchModuleSpec('1.02').downstream as string[]]
  while(pending.length) { const id=pending.shift()!; if(ids.has(id)) continue; ids.add(id); pending.push(...getResearchModuleSpec(id).downstream as string[]) }
  return [...ids].sort()
}
function auditRow(row: Row, auditVersion: BoundaryAuditVersion) {
  const geometry=value(row,'geometry'), crs=value(row,'crs'), axis=value(row,'axisOrder')
  // The known source spelling is an alias, not a projection conversion. Keep
  // the author's original CRS in the immutable input hash and preserve v1 replay.
  const calculationCrs=auditVersion!=='research-boundary-audit.v1' && crs==='WGS-84' ? 'WGS84' : crs
  const input={ geometry, crs, axisOrder:axis, version:value(row,'version') }
  const base={ recordId:row.recordId, boundaryId:value(row,'boundaryId'), scopeKind:value(row,'scopeKind'), legalStatus:value(row,'legalStatus'),
    version:input.version, inputHash:sha256CanonicalJson(input), geometryHash:sha256CanonicalJson(geometry), declaredArea:value(row,'area') }
  if (geometry===null) return {...base,status:'unavailable' as const,limitations:['缺少几何；未计算面积，未模拟边界变更。']}
  try {
    const area=measure(geometry,calculationCrs,axis), originalHash=sha256CanonicalJson(row)
    const changed=structuredClone(geometry) as { type:string; coordinates:any[] }
    const ring=changed.type==='Polygon' ? changed.coordinates[0] : changed.coordinates[0][0]
    const longitudeIndex=axis==='xy'?0:1, before=structuredClone(ring[1])
    const delta=ring[1][longitudeIndex]+0.00001<=180 ? 0.00001 : -0.00001
    ring[1][longitudeIndex]+=delta
    let changedArea: number | undefined, mutationError: string | undefined
    try { changedArea=measure(changed,calculationCrs,axis) } catch(error) { mutationError=String(error instanceof Error ? error.message:error) }
    const changedHash=sha256CanonicalJson({...input,geometry:changed})
    let rejected=false
    try { assertModuleInputReferencesCurrent([{selector:'/outputs/boundaries',valueHash:base.inputHash}], [{selector:'/outputs/boundaries',valueHash:changedHash}]) }
    catch(error) { if (error instanceof Error && error.message==='MODULE_INPUT_REFERENCES_CHANGED') rejected=true; else throw error }
    const swapped=structuredClone(geometry) as { coordinates:unknown }
    const swap=(x:any):any => typeof x[0]==='number' ? [x[1],x[0],...x.slice(2)] : x.map(swap)
    swapped.coordinates=swap(swapped.coordinates)
    let detected=false, swapError:string|undefined
    try { measure(swapped,calculationCrs,axis) } catch(error) { swapError=error instanceof Error?error.message:String(error); detected=swapError==='WGS84_GEOMETRY_OUT_OF_RANGE' }
    const declared=base.declaredArea as {value?:number;unit?:string;basis?:string}|null
    const factor:Record<string,number>={'m²':1,m2:1,'平方米':1,ha:10000,'公顷':10000,'km²':1000000,km2:1000000,'平方公里':1000000,'平方千米':1000000}
    const declaredSquareMeters=declared && typeof declared.value==='number' && Object.hasOwn(factor,declared.unit??'') ? declared.value*factor[declared.unit!] : undefined
    return {...base,status:'computed' as const, area:{squareMeters:area,method},
      comparison:declaredSquareMeters===undefined ? {status:'unavailable'} : {status:'review-required',declaredSquareMeters,deltaSquareMeters:declaredSquareMeters-area,
        note:'作者原值和口径未改写；历史估算与球面几何测算差异须由独立审查说明，不能互相冒充。'},
      axisSwapProbe:{detected,...(swapError?{error:swapError}:{}),limitations:detected?[]:['交换后仍在数值范围内，须结合地址/有来源控制点核验，不能宣称已检测轴序错误。']},
      vertexProbe:{synthetic:true,notPersistedIntoProject:true,vertexPath:changed.type==='Polygon'?'/coordinates/0/1':'/coordinates/0/0/1',before,after:structuredClone(ring[1]),
        changedInputHash:changedHash,...(changedArea===undefined?{error:mutationError}:{squareMeters:changedArea,areaDeltaSquareMeters:changedArea-area}),
        staleDependencyRejected:rejected,previousGeometryPreserved:sha256CanonicalJson(row)===originalHash,wouldInvalidateModuleIds:downstream(),
        note:'副本注入测试使用与正式回读相同的输入引用校验；列出需复算后继，不修改当前项目几何、成果或研究状态。'},
      limitations:[...method.limitations]}
  } catch(error) {
    const code=error instanceof Error?error.message:String(error)
    return {...base,status:/UNSUPPORTED|BUDGET_EXCEEDED/.test(code)?'unavailable' as const:'invalid' as const,limitations:[code]}
  }
}
export function buildBoundaryResearchAudit(outputs: Record<string, unknown>, version: BoundaryAuditVersion = BOUNDARY_AUDIT_VERSION) {
  if (!['research-boundary-audit.v1','research-boundary-audit.v2',BOUNDARY_AUDIT_VERSION].includes(version)) fail('BOUNDARY_AUDIT_VERSION_UNSUPPORTED')
  const rows=(outputs.boundaries as {records?:Row[]}|undefined)?.records??[]
  return {version,outputsHash:sha256CanonicalJson(outputs),boundaries:rows.map(row=>auditRow(row,version)),
    authority:'程序计算与副本变更测试回执；不是作者自评、测绘或法定审批。'}
}
export type BoundaryResearchAudit = ReturnType<typeof buildBoundaryResearchAudit>
export function verifyBoundaryResearchAudit(outputs: Record<string,unknown>, audit: BoundaryResearchAudit) {
  if (!same(buildBoundaryResearchAudit(outputs,audit.version),audit)) fail('BOUNDARY_AUDIT_REPLAY_MISMATCH')
}
export function verifyModuleBoundaryAudit(itemId: string, outputs: Record<string,unknown>, execution: {
  readonly boundaryAudit?: BoundaryResearchAudit
  readonly reviewReceipts?: readonly { readonly boundaryAuditHash?: string; readonly executionId?: string; readonly childId?: string }[]
  readonly attempts?: readonly unknown[]
}) {
  if (!execution.boundaryAudit) {
    if (execution.reviewReceipts?.some(r=>r.boundaryAuditHash)) fail('BOUNDARY_REVIEW_AUDIT_BINDING')
    return // Historical receipts remain readable, not newly certified.
  }
  if (itemId!=='1.02') fail('BOUNDARY_AUDIT_MODULE_MISMATCH')
  verifyBoundaryResearchAudit(outputs,execution.boundaryAudit)
  const review=execution.reviewReceipts?.at(-1), hash=sha256CanonicalJson(execution.boundaryAudit)
  if (review?.boundaryAuditHash!==hash) fail('BOUNDARY_REVIEW_AUDIT_BINDING')
  const attempts=(execution.attempts??[]).filter((a): a is Record<string,unknown>=>!!a && typeof a==='object').filter(a=>a.classId==='review'&&a.status==='completed'&&a.executionId===review.executionId&&a.childId===review.childId)
  const attempt=attempts[0], structured=attempt?.structuredOutput as Record<string,unknown>|undefined
  if (!review.executionId || !review.childId || attempts.length!==1 || !structured || structured.boundaryAuditHash!==hash
    || attempt.structuredHash!==sha256CanonicalJson(structured)) fail('BOUNDARY_REVIEW_NATIVE_BINDING')
}
