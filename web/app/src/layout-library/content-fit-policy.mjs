import {z} from 'zod'
import {validateComponentObservation} from './reference-components.mjs'
const id=z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),unit=z.number().finite().min(0).max(1)
const rect=z.object({x:unit,y:unit,w:unit.positive(),h:unit.positive()}).strict().refine(r=>r.x+r.w<=1.000001&&r.y+r.h<=1.000001)
export const contentFitPolicySchema=z.object({version:z.literal(1),minGap:z.number().finite().min(.001).max(.05),activation:z.literal('explicit-preview-only'),provenance:z.literal('image-observation-parent-bounds'),source:z.object({fileSha256:z.string().regex(/^[a-f0-9]{64}$/),pageNumber:z.number().int().positive()}).strict(),entries:z.array(z.object({slotId:id,parentId:id,sourceRect:rect,bounds:rect,directions:z.array(z.enum(['left','up','down'])).min(1).max(3).refine(a=>new Set(a).size===a.length),maxGrowth:z.number().finite().positive().max(.5)}).strict()).min(1).max(32)}).strict()
const contains=(b,r)=>r.x>=b.x-.000001&&r.y>=b.y-.000001&&r.x+r.w<=b.x+b.w+.000001&&r.y+r.h<=b.y+b.h+.000001
const fail=()=>{throw Object.assign(Error('缺少可核对的组件父组边界，不能启用内容适配。'),{code:'CONTENT_FIT_POLICY_INVALID',statusCode:409})}
export function validateContentFitPolicy(raw,layout){
 const p=contentFitPolicySchema.parse(raw)
 if(new Set(p.entries.map(e=>e.slotId)).size!==p.entries.length)fail()
 for(const e of p.entries){const slot=layout.slots.find(s=>s.id===e.slotId);if(!slot||slot.role!=='text'||!contains(e.bounds,e.sourceRect)||!contains(e.bounds,rect.parse(slot.rect)))fail()}
 return p
}
/** Metadata only, never automatic application or proof of visual fidelity/sharing. */
export function deriveContentFitPolicy({observation,allowedSources,layout}){
 const o=validateComponentObservation(observation,allowedSources),entries=[]
 for(const slot of layout.slots.filter(s=>s.role==='text')){
  const component=o.components.find(c=>c.id===slot.id&&c.kind==='text')
  if(!component)fail()
  if(!component.parentId)continue
  const parent=o.components.find(c=>c.id===component.parentId&&c.kind==='group');if(!parent)fail()
  entries.push({slotId:slot.id,parentId:parent.id,sourceRect:{...component.rect},bounds:{...parent.rect},directions:['left','up','down'],maxGrowth:.05})
 }
 return entries.length?validateContentFitPolicy({version:1,minGap:.002,activation:'explicit-preview-only',provenance:'image-observation-parent-bounds',source:{...o.source},entries},layout):null
}
