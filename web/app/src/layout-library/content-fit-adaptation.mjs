import {createHash} from 'node:crypto'
import {z} from 'zod'
import {compositionCanvasSchema} from './composition-contract.mjs'
const fail=()=>{throw Object.assign(Error('内容适配测量失效、空间不足或会遮挡其他组件；保持原内容，请选择其他版式。'),{code:'CONTENT_ADAPTATION_REQUIRED'})}
const id=z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),unit=z.number().finite().min(0).max(1),rectSchema=z.object({x:unit,y:unit,w:unit.positive(),h:unit.positive()}).strict().refine(r=>r.x+r.w<=1.000001&&r.y+r.h<=1.000001)
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
export const adaptationFingerprint=(layout,contentBySlot,canvas,observation)=>({layoutHash:digest({layout,canvas,observation}),contentHash:digest(contentBySlot)})
/** Internal opt-in proposal. Measurements are browser-derived, not evidence of source design. */
export function proposeContentFitAdaptation({layout,contentBySlot,observation,canvas,measurement,policies,gap=.005}){
 canvas=compositionCanvasSchema.parse(canvas);if(!Number.isFinite(gap)||gap<0||gap>.05)fail()
 const expected=adaptationFingerprint(layout,contentBySlot,canvas,observation)
 const measured=z.object({layoutHash:z.string().regex(/^[a-f0-9]{64}$/),contentHash:z.string().regex(/^[a-f0-9]{64}$/),slots:z.array(z.object({slotId:id,requiredWidth:z.number().finite().positive().max(10000),requiredHeight:z.number().finite().positive().max(10000)}).strict()).min(1).max(64)}).strict().parse(measurement)
 if(measured.layoutHash!==expected.layoutHash||measured.contentHash!==expected.contentHash)fail()
 const rules=z.array(z.object({slotId:id,direction:z.enum(['left','down','up']),maxGrowth:z.number().finite().positive().max(.5)}).strict()).min(1).max(32).parse(policies)
 const slots=new Map(layout.slots.map(s=>[s.id,{...s,rect:rectSchema.parse(s.rect)}])),measurements=new Map(measured.slots.map(s=>[s.slotId,s])),components=new Map(observation.components.map(c=>[c.id,c]))
 if(slots.size!==layout.slots.length||measurements.size!==measured.slots.length||components.size!==observation.components.length||new Set(rules.map(x=>x.slotId)).size!==rules.length)fail()
 const adjustments={},changes=[]
 for(const rule of rules){
  const slot=slots.get(rule.slotId),m=measurements.get(rule.slotId),source=components.get(rule.slotId),parent=components.get(source?.parentId)
  if(!slot||slot.role!=='text'||!m||typeof contentBySlot[rule.slotId]!=='string'||!source||source.kind!=='text'||!parent||parent.kind!=='group')fail()
  const bounds=rectSchema.parse(parent.rect),a=slot.rect,b={...a}
  if(rule.direction==='left'){
   if(m.requiredHeight>canvas.height*a.h+.01)fail()
   b.w=Math.max(a.w,m.requiredWidth/canvas.width);b.x=a.x+a.w-b.w
  }else{
   if(m.requiredWidth>canvas.width*a.w+.01)fail()
   b.h=Math.max(a.h,m.requiredHeight/canvas.height);if(rule.direction==='up')b.y=a.y+a.h-b.h
  }
  if(Math.max(b.w-a.w,b.h-a.h)>rule.maxGrowth+.000001)fail()
  if(b.x<bounds.x-.000001||b.y<bounds.y-.000001||b.x+b.w>bounds.x+bounds.w+.000001||b.y+b.h>bounds.y+bounds.h+.000001)fail()
  rectSchema.parse(b);adjustments[rule.slotId]={rect:b,reason:rule.direction==='left'?'content-width':'readable-text-height'}
  changes.push({componentId:rule.slotId,sourceRect:{...rectSchema.parse(source.rect)},previousDerivedRect:{...a},derivedRect:b,direction:rule.direction})
 }
 const separated=(a,b)=>a.x+a.w+gap<=b.x+.000001||b.x+b.w+gap<=a.x+.000001||a.y+a.h+gap<=b.y+.000001||b.y+b.h+gap<=a.y+.000001
 for(const change of changes)for(const other of slots.values())if(other.id!==change.componentId&&!separated(change.derivedRect,adjustments[other.id]?.rect??other.rect))fail()
 return {adjustments,review:{status:'proposed-requires-browser-recheck',provenance:'measured-content-adaptation',...expected,changes,contentChanged:false,fontSizeChanged:false,sourceValueUnchanged:true,visualAcceptance:'pending'}}
}
