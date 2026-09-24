import { z } from 'zod'
import { sourceCaptureSchema, evidenceSelectorSchema, sourceIdentifier as id, sourceText as text, assertSourceValue } from './source-intake.ts'
import { regionalOdRequestSchema } from './regional-schema.ts'
import { toWgs84 } from '../report/cartography/geometry.ts'
import { freeze } from './graph.ts'

export const PEER_FIELDS=['name','address','status','positioning','format','coordinate','price','targetAudience','observedAudience','metric'] as const
export type PeerField=typeof PEER_FIELDS[number]
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v)
const valueSchemas:Record<PeerField,z.ZodType>={
  name:text(160),address:text(500),status:z.enum(['operating','planned','building','closed','unknown']),positioning:text(1500),format:text(120),
  coordinate:z.object({longitude:z.number().finite(),latitude:z.number().finite(),crs:z.enum(['EPSG:4326','WGS84','EPSG:3857']),entranceStatus:z.enum(['source-recorded','provisional'])}).strict(),
  price:z.object({offer:text(160),basis:text(500),currency:z.string().regex(/^[A-Z]{3}$/u),unit:text(80),period:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),amount:z.number().finite().nonnegative()}).strict(),
  targetAudience:text(1000),
  observedAudience:z.object({description:text(1000),sampleSize:z.number().int().positive().max(100000000),method:text(500),period:text(120)}).strict(),
  metric:z.object({name:z.enum(['visits','revenue','occupancy','rating']),amount:z.number().finite().nonnegative(),unit:text(100),period:text(120),denominator:z.number().finite().positive().nullable()}).strict(),
}
const claim=z.object({id,field:z.enum(PEER_FIELDS),value:z.unknown().refine(v=>v!==undefined),sourceId:id,selector:evidenceSelectorSchema}).strict()
export const peerRequestSchema=z.object({
  schemaVersion:z.literal('peer-research-request.v1'),projectId:id,snapshotId:id,scope:text(500),asOf:day,
  captures:z.array(sourceCaptureSchema).min(1).max(32),
  peers:z.array(z.object({peerId:id.max(48),role:z.enum(['direct','substitute','reference']),selection:z.enum(['include','exclude']).default('include'),selectionReason:text(1000),claims:z.array(claim).min(1).max(80)}).strict()).min(1).max(30),
  regionalContext:z.object({origin:regionalOdRequestSchema.shape.nodes.element,
    captures:regionalOdRequestSchema.shape.captures,peerIds:z.array(id).min(1).max(6),policy:regionalOdRequestSchema.shape.policy}).strict().optional(),
}).strict()
export type PeerRequest=z.infer<typeof peerRequestSchema>
export type PeerClaim=PeerRequest['peers'][number]['claims'][number]
export function parsePeerRequest(raw:unknown):PeerRequest {
  const q=peerRequestSchema.parse(raw)
  if(Buffer.byteLength(JSON.stringify(q),'utf8')>4*1024*1024)throw new Error('PEER_REQUEST_TOO_LARGE')
  const unique=(values:string[],code:string)=>{if(new Set(values).size!==values.length)throw new Error(code)}
  unique(q.peers.map(p=>p.peerId),'PEER_ID_DUPLICATE');unique(q.captures.map(s=>s.sourceId),'SOURCE_ID_DUPLICATE')
  unique(q.peers.flatMap(p=>p.claims.map(c=>c.id)),'CLAIM_ID_DUPLICATE')
  const sources=new Map(q.captures.map(s=>[s.sourceId,s]))
  for(const source of q.captures)if(Date.parse(source.observedAt)>Date.parse(q.asOf+'T23:59:59.999Z'))throw new Error('SOURCE_AFTER_ASOF')
  for(const peer of q.peers){
    if(!peer.claims.some(c=>c.field==='name'))throw new Error('PEER_NAME_REQUIRED')
    for(const c of peer.claims){
      const value=valueSchemas[c.field].parse(c.value),source=sources.get(c.sourceId)
      if(!source)throw new Error('SOURCE_REFERENCE_MISSING')
      assertSourceValue(source,c.selector,c.value)
      if(c.field==='coordinate')toWgs84(value as any)
      if(c.field==='price'&&(value as any).period>q.asOf.slice(0,7))throw new Error('PRICE_AFTER_ASOF')
      if(c.field==='metric'&&(value as any).name==='occupancy'&&((value as any).unit!=='%'||(value as any).amount>100||(value as any).denominator===null))throw new Error('OCCUPANCY_BASIS_REQUIRED')
    }
  }
  return freeze(q)
}
