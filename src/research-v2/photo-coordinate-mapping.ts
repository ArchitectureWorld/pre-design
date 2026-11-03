import type {MaterialCorpusDocument} from '../materials/research-evidence.ts'
import type {MaterialCorpus} from '../materials/research-evidence.ts'
export interface PhotoCoordinateMapping { readonly kind:'photo-gps-axis-order.v1'; readonly axisOrder:'xy'|'yx'; readonly xValueQuote:string; readonly yValueQuote:string }
const fail=():never=>{throw new Error('MODULE_SOURCE_COORDINATE_MAPPING: explicit original-image GPS mapping, exact named tags and matching candidate axes required')}
/** A declared deterministic representation of original GPS tags, never a claim
 * that the source literally contains xy/yx, a surveyed point or visual location. */
export function verifyPhotoCoordinateMapping(source:{rawValue:unknown;quote:string;coordinateMapping:PhotoCoordinateMapping},document:MaterialCorpusDocument) {
  const m=source.coordinateMapping
  if(!document.image||document.pages||typeof document.text!=='string'||m.kind!=='photo-gps-axis-order.v1'
    ||!['xy','yx'].includes(m.axisOrder)||source.rawValue!==m.axisOrder)return fail()
  let original:any
  try{original=JSON.parse(document.text)}catch{return fail()}
  const {latitude,longitude,coordinateDatum}=original?.capture??{}
  if(original.kind!=='source-image-metadata.v1'||typeof latitude!=='number'||typeof longitude!=='number'
    ||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180
    ||typeof coordinateDatum!=='string'||!coordinateDatum.trim())return fail()
  const [x,y]=m.axisOrder==='xy'?[longitude,latitude]:[latitude,longitude]
  if(m.xValueQuote!==String(x)||m.yValueQuote!==String(y)
    ||!source.quote.includes(`"latitude":${String(latitude)}`)||!source.quote.includes(`"longitude":${String(longitude)}`))return fail()
  return {x,y,axisOrder:m.axisOrder,crs:coordinateDatum}
}
export function assertPhotoCoordinateMappingTarget(target:{port?:unknown;field?:unknown;at?:unknown}|undefined,candidate:unknown,expected:{x:number;y:number;axisOrder:string;crs:string}) {
  const value=candidate as {x?:unknown;y?:unknown;axisOrder?:unknown;crs?:unknown}|null|undefined
  if(target?.port!=='site_use'||target.field!=='photoLocation'||target.at!=='/axisOrder'
    ||!value||value.x!==expected.x||value.y!==expected.y||value.axisOrder!==expected.axisOrder||value.crs!==expected.crs)return fail()
}
/** Latent rejected source bindings, reported with identities only. No draft or
 * source values are filled, and no mapping is synthesized on the author's behalf. */
export function modulePhotoAxisMappingDiagnostics(raw:unknown,corpus?:MaterialCorpus) {
  const value=raw as any
  if(!corpus||!Array.isArray(value?.evidence)||value?.groupId!=='site_use:4.1')return []
  return value.evidence.flatMap((entry:any)=>{
    const t=entry?.target,s=entry?.source
    if(entry.kind!=='source'||t?.port!=='site_use'||t.field!=='photoLocation'||t.at!=='/axisOrder'||s?.coordinateMapping)return []
    const doc=corpus.documents.find(d=>d.path===s?.path)
    const row=value.outputs?.site_use?.records?.find((r:any)=>r.recordId===t.recordId),order=row?.photoLocation?.value?.axisOrder
    if(!doc?.image||typeof s?.quote!=='string'||!['xy','yx'].includes(order)||s.quote.includes(order))return []
    return [{target:{port:t.port,recordId:t.recordId,field:t.field,at:t.at},rule:'axisOrder is not a literal source tag; explicitly declare photo-gps-axis-order.v1 mapping from original named latitude/longitude tags, matching this authored x/y. No fabricated source text, automatic values or relaxed number checks.'}]
  })
}
