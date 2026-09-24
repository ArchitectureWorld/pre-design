import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { loadPlanningCatalog } from './catalog.ts'
import { freeze } from './graph.ts'
import { PEER_FIELDS, parsePeerRequest, type PeerField, type PeerRequest } from './peer-schema.ts'
import { assertSourceValue, type BoundEvidence } from './source-intake.ts'
import { parseRegionalOdRequest, type RegionalOdRequest } from './regional-schema.ts'

export const PEER_METHOD='peer-research.v1:source-exact+no-latest-wins+same-basis-price'
export interface PeerValue { readonly claimId:string; readonly value:any; readonly evidence:BoundEvidence }
export interface PeerCell { readonly state:'missing'|'recorded'|'limited'|'conflict'; readonly values:readonly PeerValue[] }
export interface PeerRow { readonly peerId:string;readonly role:'direct'|'substitute'|'reference';readonly selection:'include'|'exclude';readonly selectionReason:string;readonly cells:Readonly<Record<PeerField,PeerCell>> }
export interface PeerResult {
  readonly schemaVersion:'peer-research-result.v1';readonly methodVersion:string;readonly publicationGranted:false;
  readonly projectId:string;readonly snapshotId:string;readonly catalogHash:string;readonly inputHash:string;
  readonly input:PeerRequest;readonly rows:readonly PeerRow[];
  readonly summary:{readonly total:number;readonly excluded:number;readonly operatingSupply:number;readonly scenarioOperatingSupply:number;readonly references:number;readonly unknownStatus:number;readonly marketGapProven:false};
  readonly priceGroups:readonly {readonly evidenceBasis:'source-record'|'scenario';readonly key:string;readonly basis:string;readonly currency:string;readonly unit:string;readonly period:string;
    readonly points:readonly {readonly peerId:string;readonly amount:number;readonly claimId:string}[];readonly excludedPlanned:number}[];
  readonly limitations:readonly string[];
}
const SCALAR=new Set<PeerField>(['name','address','status','positioning','coordinate'])
const SOURCE_RECORDS=new Set(['fact','source_conclusion','user_statement'])
const documentedStatus=(row:PeerRow)=>row.cells.status.values.length>0&&row.cells.status.values.every(v=>SOURCE_RECORDS.has(v.evidence.claimClass))
const scalar=(row:PeerRow,key:PeerField)=>row.cells[key].state==='conflict'?undefined:row.cells[key].values[0]?.value
export function analyzePeers(raw:unknown):PeerResult {
  const input=parsePeerRequest(raw),sources=new Map(input.captures.map(s=>[s.sourceId,s]))
  const rows:PeerRow[]=input.peers.map(peer=>{
    const cells={} as Record<PeerField,PeerCell>
    for(const field of PEER_FIELDS){
      const values:PeerValue[]=peer.claims.filter(c=>c.field===field).map(c=>({claimId:c.id,value:structuredClone(c.value),evidence:assertSourceValue(sources.get(c.sourceId),c.selector,c.value)}))
      const different=new Set(values.map(v=>sha256CanonicalJson(v.value))).size>1
      // Formats and audiences are multi-valued. Contradictory scalar claims stay unresolved.
      let conflict=SCALAR.has(field)&&different
      if(field==='price'){
        const grouped=new Map<string,Set<string>>()
        for(const v of values){const {amount,...basis}=v.value,key=sha256CanonicalJson(basis);if(!grouped.has(key))grouped.set(key,new Set());grouped.get(key)!.add(String(amount))}
        conflict=[...grouped.values()].some(g=>g.size>1)
      }
      cells[field]={state:!values.length?'missing':conflict?'conflict':values.some(v=>['assumption','agent_inference','source_conclusion','decision'].includes(v.evidence.claimClass))?'limited':'recorded',values}
    }
    return {peerId:peer.peerId,role:peer.role,selection:peer.selection,selectionReason:peer.selectionReason,cells}
  })
  const groups=new Map<string,{evidenceBasis:'source-record'|'scenario';key:string;basis:string;currency:string;unit:string;period:string;points:{peerId:string;amount:number;claimId:string}[];excludedPlanned:number}>()
  for(const row of rows){
    if(row.selection==='exclude'||row.role==='reference'||row.cells.price.state==='conflict')continue
    const seen=new Set<string>()
    for(const cell of row.cells.price.values){
      const p=cell.value,evidenceBasis=SOURCE_RECORDS.has(cell.evidence.claimClass)&&documentedStatus(row)?'source-record' as const:'scenario' as const,key=sha256CanonicalJson({basis:p.basis,currency:p.currency,unit:p.unit,period:p.period,evidenceBasis})
      if(!groups.has(key))groups.set(key,{key,evidenceBasis,basis:p.basis,currency:p.currency,unit:p.unit,period:p.period,points:[],excludedPlanned:0})
      const group=groups.get(key)!
      if(scalar(row,'status')!=='operating'){if(!seen.has(key))group.excludedPlanned++;seen.add(key);continue}
      const identity=sha256CanonicalJson({peer:row.peerId,price:p})
      if(!seen.has(identity))group.points.push({peerId:row.peerId,amount:p.amount,claimId:cell.claimId})
      seen.add(identity)
    }
  }
  return freeze({schemaVersion:'peer-research-result.v1',methodVersion:PEER_METHOD,publicationGranted:false,
    projectId:input.projectId,snapshotId:input.snapshotId,catalogHash:loadPlanningCatalog().hash,inputHash:sha256CanonicalJson(input),input,rows,
    summary:{total:rows.length,excluded:rows.filter(r=>r.selection==='exclude').length,operatingSupply:rows.filter(r=>r.selection==='include'&&r.role!=='reference'&&scalar(r,'status')==='operating'&&documentedStatus(r)).length,
      scenarioOperatingSupply:rows.filter(r=>r.selection==='include'&&r.role!=='reference'&&scalar(r,'status')==='operating'&&!documentedStatus(r)).length,
      references:rows.filter(r=>r.role==='reference').length,unknownStatus:rows.filter(r=>scalar(r,'status')===undefined||scalar(r,'status')==='unknown').length,marketGapProven:false},
    priceGroups:[...groups.values()],limitations:[
      '来源中的事实、宣传、用户陈述与假设分别保留；字段绑定和哈希不等于独立事实核验。',
      '纳入、排除和竞品/参考分类是输入中的策划决定；相同名称不自动合并为同一项目。',
      '营业状态是来源时点的记载，不是本程序重新调查的当前营业证明。缺失与冲突不自动取最新值。',
      '价格仅按明确的产品口径、币种、单位和月份分组；计划/停业/不明状态不计入营业供给对比，不计算虚构市场均价。',
      '目标客群不等于实际客群；观察样本不自动外推总体，客流和收入不可从照片、评分或宣传推导。',
      '本批为3.04–3.06结构化证据对照及2.04输入衔接，不证明供给全覆盖、市场缺口、盈利能力或完成整章研究。',
    ]})
}

/** Produces an auditable input, never executes a network call or silently geocodes names. */
export function preparePeerOd(result:PeerResult):{request:RegionalOdRequest|null;gaps:readonly string[]} {
  if(sha256CanonicalJson(analyzePeers(result.input))!==sha256CanonicalJson(result))throw new Error('PEER_RESULT_MISMATCH')
  const context=result.input.regionalContext
  if(!context)return {request:null,gaps:['未提供已绑定证据的项目入口与明确的对比对象；不猜坐标。']}
  if(new Set(context.peerIds).size!==context.peerIds.length)throw new Error('PEER_OD_DUPLICATE')
  const nodes=[context.origin],captures=[...context.captures],queries:RegionalOdRequest['queries']=[],gaps:string[]=[]
  for(const id of context.peerIds){
    const row=result.rows.find(p=>p.peerId===id)
    if(!row)throw new Error('PEER_OD_UNKNOWN')
    if(row.selection==='exclude')throw new Error('PEER_OD_EXCLUDED')
    if(row.role==='reference')throw new Error('PEER_OD_REFERENCE_NOT_SUPPLY')
    const cell=row.cells.coordinate,name=scalar(row,'name')
    if(cell.state==='missing'||cell.state==='conflict'||!name){gaps.push(`${id}：坐标或身份缺失/冲突，未生成出行请求。`);continue}
    const c=cell.values[0],{entranceStatus,...coordinate}=c.value,source=result.input.captures.find(s=>s.sourceId===c.evidence.sourceId)!
    const sourceId=`coord-${id}`,nodeId=`entry-${id}`
    captures.push({sourceId,label:`来源坐标转写：${id}`,locator:`workspace:peer-research/${id}`,observedAt:source.observedAt,
      claimClass:source.claimClass,mediaType:'application/json',content:JSON.stringify({coordinate,
        lineage:{peerId:id,claimId:c.claimId,selector:c.evidence.selector,originalCapture:source}})})
    nodes.push({id:nodeId,regionId:id,label:name,kind:'other',selectionReason:row.selectionReason,relation:'potential',entranceStatus,coordinate,
      evidenceIds:[sourceId],coordinateBinding:{sourceId,selector:'/coordinate'}})
    queries.push({id:`OD-${id}`,fromId:context.origin.id,toId:nodeId,mode:'driving'})
  }
  // Never quietly compute only a subset of an explicitly requested comparison set.
  if(gaps.length)return {request:null,gaps}
  try {
    return {request:parseRegionalOdRequest({schemaVersion:'regional-od-request.v1',projectId:result.projectId,snapshotId:result.snapshotId,
      scope:result.input.scope,asOf:result.input.asOf,nodes,captures,queries,policy:context.policy}),gaps:[]}
  } catch(error) {
    const code=error instanceof Error ? error.message.split(':')[0] : 'REGIONAL_INPUT_INVALID'
    return {request:null,gaps:[`地域输入未满足既有校验或大小上限（${/^[A-Z_]+$/u.test(code)?code:'REGIONAL_INPUT_INVALID'}）；保留竞品结果，需补齐或重整地域来源后再执行。`]}
  }
}
