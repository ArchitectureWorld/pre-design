import { createHash } from 'node:crypto'
import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { geodesicDistanceMeters, toWgs84 } from '../report/cartography/geometry.ts'
import { createPublicMapProviders } from '../report/cartography/providers.ts'
import type { AnalysisRoute, AnalysisLocation, Wgs84Point } from '../report/cartography/types.ts'
import { loadPlanningCatalog } from './catalog.ts'
import { freeze } from './graph.ts'
import { parseRegionalOdRequest, type RegionalOdRequest, type EvidenceClass } from './regional-schema.ts'

export const REGIONAL_OD_METHOD = 'regional-od.v1:haversine-R6371008.8+osrm-driving-v5'
export const sha256Bytes = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
export interface RegionalReceipt {
  readonly id: string; readonly url: string; readonly retrievedAt: string; readonly mediaType: string
  readonly status: number; readonly body: string; readonly sha256: string
}
export interface RegionalClaim {
  readonly claimId: string; readonly resultClass: 'calculation'; readonly quality: 'limited'
  readonly snapshotId: string; readonly rowId: string; readonly metric: 'straightMeters'|'roadMeters'|'durationSeconds'
  readonly value: number; readonly unit: 'm'|'s'; readonly inputClaimClasses: readonly EvidenceClass[]
  readonly evidenceIds: readonly string[]; readonly receiptIds: readonly string[]; readonly limitations: readonly string[]
  readonly methodVersion: string
}
export interface RegionalOdRow {
  readonly id: string; readonly fromId: string; readonly toId: string; readonly mode: string
  readonly straightMeters: number; readonly roadMeters: number|null; readonly durationSeconds: number|null
  readonly timeBasis: 'static-network-model'|null; readonly snapMeters: readonly number[]|null
  readonly routeGeometry: readonly Wgs84Point[]|null; readonly receiptIds: readonly string[]
  readonly issues: readonly string[]; readonly limitations: readonly string[]; readonly claimRefs: readonly string[]
}
export interface RegionalOdResult {
  readonly schemaVersion: 'regional-od-run.v1'; readonly execution: 'regional_slice'; readonly status: 'limited'
  readonly transportMode: 'offline'|'public-network'|'injected'
  readonly publicationGranted: false; readonly catalogHash: string; readonly specSha256: string
  readonly projectId: string; readonly snapshotId: string; readonly inputSha256: string; readonly createdAt: string
  readonly input: RegionalOdRequest; readonly rows: readonly RegionalOdRow[]; readonly claims: readonly RegionalClaim[]
  readonly receipts: readonly RegionalReceipt[]
  readonly attempts: readonly { readonly id: string; readonly url: string; readonly receiptId: string|null; readonly errorCode: string|null }[]
  readonly usage: { readonly requests: number; readonly limit: number; readonly networkAuthorized: boolean }
  readonly outputs: { readonly regional_od: { readonly type: 'planning.regional_od.v1.2'; readonly quality: 'limited'
    readonly records: readonly RegionalOdRow[]; readonly claimRefs: readonly string[]; readonly limitations: readonly string[]
    readonly asOf: string; readonly scope: string } }
  readonly limitations: readonly string[]
}
export interface RegionalOdOptions {
  /** Only the trusted caller, not the input file, may authorize public requests. */
  readonly allowNetwork?: boolean
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>
  readonly now?: () => Date
  readonly signal?: AbortSignal
}

const GENERAL_LIMITS = [
  '来源及坐标绑定已按结构校验，未经独立现场核验；摘要校验值不证明资料真实。',
  '直线距离采用平均地球半径6371008.8米的球面Haversine算法，不是椭球测绘成果。',
  '可达距离不代表客源量、消费需求或服务覆盖人口。',
]
const ROUTE_LIMIT = '道路里程和时间为OSRM路网模型值，不含实时路况、候车、换乘或末段步行；通行权限与入口需人工复核。'
const issueCode = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  return /^[A-Z][A-Z0-9_]{2,79}$/u.test(message) ? message : 'ROUTE_UNAVAILABLE'
}

async function responseBytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const limit = 8 * 1024 * 1024
  if (Number(response.headers.get('content-length') ?? 0)>limit) { await response.body?.cancel(); throw new Error('ROUTE_RESPONSE_TOO_LARGE') }
  const reader=response.body?.getReader()
  if (!reader) throw new Error('ROUTE_RESPONSE_EMPTY')
  const chunks: Uint8Array[]=[]; let total=0
  const onAbort=()=>{void reader.cancel(signal.reason).catch(()=>{})}
  signal.addEventListener('abort',onAbort,{once:true})
  try {
    while(true) {
      signal.throwIfAborted()
      const {done,value}=await reader.read()
      signal.throwIfAborted()
      if(done) break
      total+=value.byteLength
      if(total>limit) throw new Error('ROUTE_RESPONSE_TOO_LARGE')
      chunks.push(value)
    }
  } catch(error) { await reader.cancel().catch(()=>{}); throw error } finally { signal.removeEventListener('abort',onAbort); reader.releaseLock() }
  return Buffer.concat(chunks)
}

function validateRoute(route: AnalysisRoute, from: Wgs84Point, to: Wgs84Point, maxSnap: number): void {
  if (![route.distanceMeters,route.durationSeconds].every(n=>Number.isFinite(n)&&n>=0)) throw new Error('ROUTE_MEASUREMENT_INVALID')
  if (!Array.isArray(route.geometry)||route.geometry.length<2||route.geometry.length>100000||route.waypoints.length!==2) throw new Error('ROUTE_GEOMETRY_INVALID')
  route.geometry.forEach(p=>toWgs84({...p,crs:'WGS84'}))
  for (const [index,waypoint] of route.waypoints.entries()) {
    toWgs84({...waypoint.coordinate,crs:'WGS84'})
    if (!Number.isFinite(waypoint.snapDistanceMeters)||waypoint.snapDistanceMeters<0) throw new Error('ROUTE_SNAP_INVALID')
    if (waypoint.snapDistanceMeters>maxSnap) throw new Error('ROUTE_SNAP_EXCEEDED')
    const actual=geodesicDistanceMeters(index===0?from:to,waypoint.coordinate)
    // One metre is a method-level coordinate-rounding check, not an entrance
    // allowance. The actual project allowance is separately approved above.
    if (Math.abs(actual-waypoint.snapDistanceMeters)>1) throw new Error('ROUTE_SNAP_INCONSISTENT')
  }
  if (geodesicDistanceMeters(route.geometry[0],route.waypoints[0].coordinate)>1
    || geodesicDistanceMeters(route.geometry.at(-1)!,route.waypoints[1].coordinate)>1) throw new Error('ROUTE_ENDPOINT_INCONSISTENT')
  const lowerBound=geodesicDistanceMeters(route.waypoints[0].coordinate,route.waypoints[1].coordinate)
  // Spherical vs road-engine geometry can differ slightly; 1% is a documented
  // anomaly-screening allowance, never a relaxation of a planning constraint.
  if (route.distanceMeters+Math.max(1,lowerBound*0.01)<lowerBound) throw new Error('ROUTE_SHORTER_THAN_DIRECT')
}

export async function runRegionalOd(input: unknown, options: RegionalOdOptions = {}): Promise<RegionalOdResult> {
  options.signal?.throwIfAborted()
  const request=parseRegionalOdRequest(input), catalog=loadPlanningCatalog()
  const now=options.now ?? (()=>new Date()), createdAt=now().toISOString()
  const signal=options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(request.policy.timeoutMs)]) : AbortSignal.timeout(request.policy.timeoutMs)
  const receipts: RegionalReceipt[]=[]
  const attempts: { id:string; url:string; receiptId:string|null; errorCode:string|null }[]=[]
  let requests=0
  const recordingFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    signal.throwIfAborted()
    if (!options.allowNetwork) throw new Error('ROUTING_NOT_AUTHORIZED')
    if (requests>=request.policy.maxRequests) throw new Error('REQUEST_BUDGET_EXHAUSTED')
    requests++
    const attempt={id:`request-${requests}`,url,receiptId:null as string|null,errorCode:null as string|null}
    attempts.push(attempt)
    try {
    const response=await (options.fetch ?? fetch)(url,{...init,signal:init?.signal ? AbortSignal.any([signal,init.signal]) : signal})
    const bytes=await responseBytes(response,signal)
    const body=new TextDecoder('utf-8',{fatal:true}).decode(bytes)
    const receipt: RegionalReceipt={id:`response-${requests}`,url,retrievedAt:now().toISOString(),
      mediaType:response.headers.get('content-type') ?? '',status:response.status,body,sha256:sha256Bytes(bytes)}
    receipts.push(receipt); attempt.receiptId=receipt.id
    return new Response([204,205,304].includes(response.status)?null:bytes as BodyInit,{status:response.status,headers:response.headers})
    } catch(error) {
      const failure=error as {code?:string;cause?:{code?:string}}
      attempt.errorCode=failure?.cause?.code ?? failure?.code ?? issueCode(error)
      throw error
    }
  }
  const provider=createPublicMapProviders({fetch:recordingFetch,now})
  const sources=new Map(request.captures.map(s=>[s.sourceId,s]))
  const nodes=new Map(request.nodes.map(n=>[n.id,n]))
  const rows: RegionalOdRow[]=[], claims: RegionalClaim[]=[]
  const location=(id: string): AnalysisLocation & {wgs84: Wgs84Point} => {
    const n=nodes.get(id)!, s=sources.get(n.coordinateBinding.sourceId)!
    return {id:n.id,label:n.label,coordinate:n.coordinate,wgs84:toWgs84(n.coordinate),
      source:{label:s.label,locator:s.locator,sha256:sha256Bytes(s.content),observedAt:s.observedAt}}
  }
  for (const query of request.queries) {
    signal.throwIfAborted()
    const from=location(query.fromId),to=location(query.toId),issues:string[]=[],limitations=[...GENERAL_LIMITS]
    const evidenceIds=[...new Set([...(nodes.get(from.id)!.evidenceIds),...(nodes.get(to.id)!.evidenceIds)])]
    const classes=[...new Set(evidenceIds.map(id=>sources.get(id)!.claimClass))]
    if (evidenceIds.some(id=>sources.get(id)!.observedAt.slice(0,10)>request.asOf)) limitations.push('部分输入证据日期晚于研究日期；不得把这些记录视为研究日期当时的已知现状。')
    if (classes.some(c=>c!=='fact')) limitations.push('输入包含假设、来源陈述或推断；计算结果仅在这些前提下成立，不升级为实测事实。')
    if ([from.id,to.id].some(id=>nodes.get(id)!.entranceStatus==='provisional')) limitations.push('包含暂定入口；不能将暂定点的到达时间解释为已核定项目入口的到达时间。')
    let route: AnalysisRoute|null=null
    const receiptStart=receipts.length
    if (query.mode!=='driving') issues.push('MODE_UNSUPPORTED')
    else if (!options.allowNetwork) issues.push('ROUTING_NOT_AUTHORIZED')
    else if (!request.policy.snapTolerance) issues.push('SNAP_TOLERANCE_REQUIRED')
    else {
      try {
        const candidate=await provider.route({from,to},signal)
        validateRoute(candidate,from.wgs84,to.wgs84,request.policy.snapTolerance.meters)
        route=candidate
      } catch(error) { signal.throwIfAborted(); issues.push(issueCode(error)) }
    }
    signal.throwIfAborted()
    if (route) {
      limitations.push(ROUTE_LIMIT)
      if(createdAt.slice(0,10)!==request.asOf)limitations.push(`路由抓取日期${createdAt.slice(0,10)}与研究日期${request.asOf}不同；该响应不能证明历史或未来的实际到达时间。`)
    }
    else limitations.push('未获得本交通方式的有效路网结果；道路里程和时间留空，不按固定速度推算。')
    const receiptIds=receipts.slice(receiptStart).map(r=>r.id)
    const metrics={straightMeters:geodesicDistanceMeters(from.wgs84,to.wgs84),roadMeters:route?.distanceMeters ?? null,durationSeconds:route?.durationSeconds ?? null}
    const claimRefs:string[]=[]
    for (const [metric,value] of Object.entries(metrics)) if (value!==null) {
      const claimId=`claim-${query.id}-${metric}`; claimRefs.push(claimId)
      claims.push({claimId,resultClass:'calculation',quality:'limited',snapshotId:request.snapshotId,rowId:query.id,
        metric:metric as RegionalClaim['metric'],value,unit:metric==='durationSeconds'?'s':'m',inputClaimClasses:classes,
        evidenceIds,receiptIds:metric==='straightMeters'?[]:receiptIds,limitations:[...limitations],methodVersion:REGIONAL_OD_METHOD})
    }
    rows.push({id:query.id,fromId:from.id,toId:to.id,mode:query.mode,...metrics,timeBasis:route?'static-network-model':null,
      snapMeters:route?route.waypoints.map(p=>p.snapDistanceMeters):null,routeGeometry:route?.geometry ?? null,
      receiptIds,issues,limitations,claimRefs})
  }
  const limitations=[...new Set(rows.flatMap(r=>r.limitations))]
  const result: RegionalOdResult={schemaVersion:'regional-od-run.v1',execution:'regional_slice',status:'limited',publicationGranted:false,transportMode:!options.allowNetwork?'offline':options.fetch?'injected':'public-network',
    catalogHash:catalog.hash,specSha256:catalog.sourceSha256,projectId:request.projectId,snapshotId:request.snapshotId,
    inputSha256:sha256CanonicalJson(request),createdAt,input:request,rows,claims,receipts,attempts,usage:{requests,limit:request.policy.maxRequests,networkAuthorized:options.allowNetwork===true},
    outputs:{regional_od:{type:'planning.regional_od.v1.2',quality:'limited',records:rows,claimRefs:claims.map(c=>c.claimId),
      limitations,asOf:request.asOf,scope:request.scope}},limitations}
  return freeze(result)
}
