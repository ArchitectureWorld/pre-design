import {z} from 'zod'
import {validateComponentObservation} from './reference-components.mjs'
const id=z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),unit=z.number().finite().min(0).max(1)
const rect=z.object({x:unit,y:unit,w:unit.positive(),h:unit.positive()}).strict()
const source=z.object({fileSha256:z.string().regex(/^[a-f0-9]{64}$/),pageNumber:z.number().int().positive()}).strict()
const schema=z.object({version:z.literal(1),source,components:z.array(z.object({componentId:id,marker:z.enum(['disc','none','other','unknown']).optional(),emphasis:z.object({status:z.enum(['present','absent','unknown']),regions:z.array(rect).max(16)}).strict().optional(),caption:z.enum(['present','absent','unknown']).optional()}).strict()).max(64)}).strict()
const fail=()=>{throw Object.assign(Error('视觉语义来源、组件或特征无效。'),{code:'REFERENCE_VISUAL_SEMANTICS_INVALID'})}
/** Separate versioned image evidence. Never accepts source text or permission claims. */
export function validateVisualSemantics(raw,observation,allowedSources){
 const parsed=schema.safeParse(raw);if(!parsed.success)fail()
 let observed;try{observed=validateComponentObservation({source:observation.source,components:observation.components},allowedSources)}catch{fail()}
 const value=parsed.data
 if(value.source.fileSha256!==observed.source.fileSha256||value.source.pageNumber!==observed.source.pageNumber)fail()
 const components=new Map(observed.components.map(c=>[c.id,c])),seen=new Set()
 for(const row of value.components){
  const c=components.get(row.componentId);if(!c||seen.has(c.id))fail();seen.add(c.id)
  if(row.marker!==undefined&&(c.kind!=='text'||c.purpose!=='body'))fail()
  if(row.caption!==undefined&&c.kind!=='image')fail()
  if(row.emphasis){
   if(c.kind!=='text'||(row.emphasis.status==='present')!==(row.emphasis.regions.length>0))fail()
   for(const r of row.emphasis.regions)if(r.x<c.rect.x||r.y<c.rect.y||r.x+r.w>c.rect.x+c.rect.w+1e-6||r.y+r.h>c.rect.y+c.rect.h+1e-6)fail()
  }
  if(row.marker===undefined&&!row.emphasis&&row.caption===undefined)fail()
 }
 return {...value,evidenceKind:'image',visualAcceptance:'pending',editability:'unknown',shareAllowed:false}
}
/** Proposals only: applying to a package requires explicit version, mapping and QA. */
export function proposeVisualPresentation(raw,observation,allowedSources){
 const evidence=validateVisualSemantics(raw,observation,allowedSources),rows=new Map(evidence.components.map(c=>[c.componentId,c])),hints=[],unresolved=[]
 for(const c of observation.components){
  if(!['text','image'].includes(c.kind))continue
  const row=rows.get(c.id),add=reason=>unresolved.push({componentId:c.id,reason})
  if(!row){add('not-observed');continue}
  if(c.kind==='text'){
   if(c.purpose==='body'){
    if(row.marker==='disc')hints.push({componentId:c.id,style:{presentationVersion:1,textMarker:'disc'},provenance:'derived-adaptation',reason:'image-observed-disc-marker'})
    else if(row.marker!== 'none')add(row.marker==='other'?'unsupported-marker':'marker-unknown')
   }
   if(row.emphasis?.status==='present')add('emphasis-needs-explicit-text-binding')
   else if(row.emphasis?.status!=='absent')add('emphasis-unknown')
  }else if(row.caption==='absent')hints.push({componentId:c.id,style:{presentationVersion:1,captionPolicy:'when-present'},provenance:'derived-adaptation',reason:'image-observed-caption-absence',constraint:'never-remove-supplied-caption'})
  else if(row.caption!=='present')add('caption-unknown')
 }
 return {version:1,source:{...evidence.source},hints,unresolved,emphasisCandidates:evidence.components.filter(c=>c.emphasis?.status==='present').map(c=>({version:1,componentId:c.componentId,status:'pending-text-binding',regions:structuredClone(c.emphasis.regions)})),visualAcceptance:'pending',editability:'unknown',shareAllowed:false}
}
export const visualSemanticsSchema=()=>z.toJSONSchema(schema)
