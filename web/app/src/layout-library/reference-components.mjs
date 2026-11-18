import {z} from 'zod'
const id=z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),unit=z.number().finite().min(0).max(1)
const sourceSchema=z.object({fileSha256:z.string().regex(/^[a-f0-9]{64}$/),pageNumber:z.number().int().positive()}).strict()
const componentSchema=z.object({id,kind:z.enum(['group','text','image','table','decoration']),purpose:z.enum(['title','label','heading','subheading','body','conclusion']).optional(),parentId:id.optional(),rect:z.object({x:unit,y:unit,w:unit.positive(),h:unit.positive()}).strict()}).strict()
const schema=z.object({source:sourceSchema,components:z.array(componentSchema).min(1).max(64)}).strict()
const invalid=()=>{throw Object.assign(Error('组件观察缺少有效来源、结构或位置。'),{code:'REFERENCE_COMPONENT_INVALID'})}
/** Image-observed components only. No native text/font claims, bytes or sharing grant. */
export function validateComponentObservation(raw,allowedSources){
 const parsed=schema.safeParse(raw);if(!parsed.success)invalid()
 const value=parsed.data
 if(!allowedSources?.some(s=>s.fileSha256===value.source.fileSha256&&s.pageNumber===value.source.pageNumber))invalid()
 const byId=new Map(value.components.map(c=>[c.id,c]));if(byId.size!==value.components.length)invalid()
 for(const c of value.components){
  if(c.kind==='text'&&!c.purpose)invalid()
  if(c.rect.x+c.rect.w>1.000001||c.rect.y+c.rect.h>1.000001||c.purpose&&c.kind!=='text')invalid()
  const seen=new Set([c.id]);let parent=c.parentId
  while(parent){const p=byId.get(parent);if(!p||p.kind!=='group'||seen.has(parent))invalid();seen.add(parent);parent=p.parentId}
 }
 return {...value,evidenceKind:'image',editability:'unknown',shareAllowed:false}
}
const mappingSchema=z.array(z.object({componentId:id,slotIds:z.array(id).min(1).max(32)}).strict()).max(64)
/** Structural audit, not proof that image observations or rendered appearance are correct. */
export function auditComponentMapping(observation,slots,raw){
 const fail=()=>{throw Object.assign(Error('组件映射缺失、重复或类型不兼容。'),{code:'REFERENCE_COMPONENT_MAPPING_INVALID'})}
 const parsed=mappingSchema.safeParse(raw);if(!parsed.success)fail()
 const components=new Map(observation.components.map(c=>[c.id,c])),targets=new Map(slots.map(s=>[s.id,s])),seen=new Set(),used=new Set()
 if(targets.size!==slots.length)fail()
 const roles={text:['text','title','claim','body','source'],image:['image'],table:['table'],decoration:[],group:[]}
 for(const row of parsed.data){
  const c=components.get(row.componentId);if(!c||seen.has(c.id))fail();seen.add(c.id)
  for(const slotId of row.slotIds){const slot=targets.get(slotId),allowed=c.kind==='text'?(c.purpose==='title'?['title']:c.purpose==='body'?['text','body']:['text']):roles[c.kind];if(!slot||used.has(slotId)||!allowed?.includes(slot.role))fail();used.add(slotId)}
 }
 const unmapped=observation.components.filter(c=>c.kind!=='group'&&!seen.has(c.id)).map(c=>c.id)
 return {complete:unmapped.length===0,unmapped,mapped:[...seen],visualAcceptance:'pending',editability:'unknown',shareAllowed:false}
}

/** Prepared contract for a future versioned observation stage; not wired into v1/v2. */
export const componentObservationContract=`仅输出 {source:{fileSha256,pageNumber},components:[{id,kind,purpose?,parentId?,rect:{x,y,w,h}}]}。仅观察实际提供的一页图像。kind为group|text|image|table|decoration；文字必须有purpose title|label|heading|subheading|body|conclusion。title仅指整页主标题，卡片标题用heading。坐标按原页宽高归一化，不裁切改写源几何。id使用小写英文短横线且页内唯一。父项必须是group，不可循环。每个独立照片单独列image，即使同卡片、同一行、彼此相接也不能合成一张；背景纹理、卡片底板不是业务照片。独立小标题、右侧标签、结论应分别列text，不因字号小省略。不复制文字正文、业务名称或敏感内容。不声称原生可编辑、字体授权或共享许可。对象目录仅是候选证据，不凭目录顺序或对象数量猜测语义。看不清或无法区分时不要伪造组件，后续审阅需明确未覆盖；最多64项。`;

/** Non-renderable structural proposal. Style/content-fit/visual review remain required. */
export function proposeComponentSlots(raw,allowedSources,canvas){
 const observation=validateComponentObservation(raw,allowedSources)
 if(!canvas||![canvas.width,canvas.height].every(n=>Number.isSafeInteger(n)&&n>=100&&n<=4096))invalid()
 let imageIndex=0
 const slots=observation.components.filter(c=>['text','image','table'].includes(c.kind)).map(c=>({
  id:c.id,role:c.kind==='text'?(c.purpose==='title'?'title':'text'):c.kind,
  ...(c.kind==='text'&&c.purpose!=='title'?{binding:c.id,purpose:c.purpose}:{}),...(c.kind==='image'?{index:imageIndex++}:{}),
  ...(c.parentId?{groupId:c.parentId}:{}),observedRect:{...c.rect},
  proposedRect:{x:c.rect.x*canvas.width,y:c.rect.y*canvas.height,w:c.rect.w*canvas.width,h:c.rect.h*canvas.height},
  derivation:'normalized-image-observation-scaled-to-canvas',styleStatus:'unknown',contentFitStatus:'not-evaluated'
 }))
 const mappings=slots.map(s=>({componentId:s.id,slotIds:[s.id]})),audit=auditComponentMapping(observation,slots,mappings)
 return {schemaVersion:'pre-design.component-slot-proposal.v1',source:observation.source,canvas:{...canvas},slots,groups:observation.components.filter(c=>c.kind==='group'),mappings,audit,visualAcceptance:'pending',editability:'unknown',shareAllowed:false}
}
