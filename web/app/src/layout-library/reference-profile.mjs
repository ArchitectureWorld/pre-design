import {z} from 'zod'

export const REFERENCE_PROFILE_SCHEMA='pre-design.reference-profile.v2'
export const referencePageTypes=['cover','section','text','figure','map','data','comparison','timeline','relationship','mixed']
export const referenceStructures=['single-column','equal-columns','asymmetric-columns','grid','hero','full-bleed','stacked']
export const referenceRoles=['title','claim','body','image','table','chart','timeline','diagram','source']
const id=z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
const hash=z.string().regex(/^[a-f0-9]{64}$/)
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/)
const evidenceIds=z.array(id).min(1).max(128)
const canvas=z.object({width:z.number().int().min(240).max(7680),height:z.number().int().min(240).max(7680)}).strict()
const rect=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),w:z.number().positive().max(1),h:z.number().positive().max(1)}).strict().refine(v=>v.x+v.w<=1.000001&&v.y+v.h<=1.000001)
const region=z.object({role:z.enum(referenceRoles),rect}).strict()
const fact=(property,value)=>z.object({property:z.literal(property),value}).strict()
// Controlled design values deliberately have no free text or file/path fields.
export const referenceDesignFactSchema=z.discriminatedUnion('property',[
 fact('canvas',canvas),...['background','ink','accent','muted'].map(p=>fact(p,color)),
 fact('font-family',z.enum(['sans','serif'])),...['title-size','body-size','caption-size'].map(p=>fact(p,z.number().min(1).max(200))),
 fact('line-height',z.number().min(1).max(3)),...['margin','gutter'].map(p=>fact(p,z.number().min(0).max(.5))),
 fact('alignment',z.enum(['left','center','right'])),fact('image-fit',z.enum(['contain','cover'])),
 fact('text-columns',z.number().int().min(1).max(6)),
 ...['body-points','image-count','table-rows','table-columns','chart-count','shape-count'].map(p=>fact(p,z.number().int().min(0).max(10000))),
 fact('region',region),
])
const sourceEvidence={id,fileSha256:hash,pageNumber:z.number().int().positive().nullable(),factId:id}
const evidence=z.discriminatedUnion('provenance',[
 z.object({...sourceEvidence,provenance:z.literal('extracted')}).strict(),
 z.object({...sourceEvidence,pageNumber:z.number().int().positive(),provenance:z.literal('observed')}).strict(),
 z.object({id,provenance:z.literal('inferred'),dependsOn:evidenceIds}).strict(),
 z.object({id,provenance:z.literal('user')}).strict(),
])
const rule=z.object({id,property:z.string(),value:z.unknown(),provenance:z.enum(['extracted','observed','inferred','user']),evidenceIds}).strict().superRefine((v,ctx)=>{
 if(!referenceDesignFactSchema.safeParse({property:v.property,value:v.value}).success)ctx.addIssue({code:'custom',message:'设计规则只能使用受限的设计属性和值。'})
})
export const referenceProfileSchema=z.object({
 schemaVersion:z.literal(REFERENCE_PROFILE_SCHEMA),intent:z.enum(['style','structure']),
 designSystem:z.object({canvas,colors:z.object({background:color,ink:color,accent:color,muted:color}).strict(),
  typography:z.object({fontFamily:z.enum(['sans','serif']),titleSize:z.number().min(32).max(90),bodySize:z.number().min(22).max(44),captionSize:z.number().min(16).max(30),lineHeight:z.number().min(1.2).max(1.9)}).strict(),
  spacing:z.object({margin:z.number().min(0).max(.3),gutter:z.number().min(0).max(.3)}).strict(),evidenceIds}).strict(),
 archetypes:z.array(z.object({id:z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),pageType:z.enum(referencePageTypes),structure:z.enum(referenceStructures),density:z.enum(['low','medium','high']),
  roles:z.array(z.enum(referenceRoles)).min(1).max(10),capacity:z.object({images:z.number().int().min(0).max(6),bodyPoints:z.number().int().min(0).max(30),tableRows:z.number().int().min(0).max(40)}).strict(),
  regions:z.array(region).min(1).max(24).optional(),evidenceIds}).strict()).min(1).max(24),
 rules:z.array(rule).max(80),evidence:z.array(evidence).min(1).max(256),
 limitations:z.array(z.object({code:z.enum(['partial-coverage','text-only','unrendered-pages','approximate-measurement','unsupported-editable-mirror','font-substitution','unsupported-decoration','readability-adjusted','conflicting-sources','content-capacity-limited']),evidenceIds:z.array(id).max(128)}).strict()).max(20),
}).strict()
const invalid=message=>Object.assign(new Error(message),{statusCode:409,code:'REFERENCE_PROFILE_INVALID'})
const unique=(items,message)=>{if(new Set(items).size!==items.length)throw invalid(message)}

/** Public profiles are useful without original bytes. During generation, pass
 * the private inventory and observations to additionally verify every citation. */
export function validateReferenceProfile(value,{inventory,observations}={}){
 const parsed=referenceProfileSchema.safeParse(value)
 if(!parsed.success)throw invalid('参考设计Profile格式不合法，不能保存为可复用资源。')
 const p=parsed.data,byId=new Map(p.evidence.map(e=>[e.id,e]))
 unique(p.evidence.map(e=>e.id),'参考证据ID重复。');unique(p.archetypes.map(a=>a.id),'页面原型ID重复。');unique(p.rules.map(r=>r.id),'设计规则ID重复。')
 function refs(ids){unique(ids,'同一证据被重复引用。');for(const key of ids)if(!byId.has(key))throw invalid('参考设计引用了不存在的证据。')}
 refs(p.designSystem.evidenceIds)
 for(const a of p.archetypes){refs(a.evidenceIds);unique(a.roles,'页面原型内容角色重复。');if(a.regions?.some(r=>!a.roles.includes(r.role)))throw invalid('原型区域角色不在支持内容中。')}
 for(const r of p.rules)refs(r.evidenceIds)
 for(const l of p.limitations)refs(l.evidenceIds)
 const visiting=new Set(),visited=new Set()
 function visit(key){
  if(visiting.has(key))throw invalid('参考设计推断证据存在循环。')
  if(visited.has(key))return
  const e=byId.get(key);visiting.add(key)
  if(e.provenance==='inferred'){refs(e.dependsOn);e.dependsOn.forEach(visit)}
  visiting.delete(key);visited.add(key)
 }
 for(const e of p.evidence){
  visit(e.id)
  if(!['extracted','observed'].includes(e.provenance))continue
  const file=inventory?.files?.find(f=>f.sha256===e.fileSha256)
  const page=e.pageNumber===null?null:file?.pages?.find(s=>s.pageNumber===e.pageNumber)
  if(inventory&&(!file||e.pageNumber!==null&&!page))throw invalid('参考证据引用了未读取的文件或页面。')
  if(e.provenance==='observed'){
   if(inventory&&!page?.hasImage)throw invalid('没有实际图像的页面不能声明视觉观察证据。')
   if(observations&&!observations.some(b=>b.pages?.some(s=>s.fileSha256===e.fileSha256&&s.pageNumber===e.pageNumber&&s.facts?.some(f=>f.id===e.factId))))throw invalid('参考证据引用了不存在的页面观察。')
  }else if(inventory&&!(page?.extractedFacts??file?.extractedFacts??[]).some(f=>f.id===e.factId))throw invalid('参考证据引用了不存在的提取事实。')
 }
 const observationFor=e=>observations?.flatMap(b=>b.pages??[]).find(s=>s.fileSha256===e.fileSha256&&s.pageNumber===e.pageNumber&&s.facts?.some(f=>f.id===e.factId))
 const factFor=e=>{
  if(e.provenance==='observed')return observationFor(e)?.facts?.find(f=>f.id===e.factId)
  const file=inventory?.files?.find(f=>f.sha256===e.fileSha256),facts=e.pageNumber===null?file?.extractedFacts:file?.pages?.find(s=>s.pageNumber===e.pageNumber)?.extractedFacts
  return facts?.find(f=>f.id===e.factId)
 }
 for(const r of p.rules){
  const proof=r.evidenceIds.map(key=>byId.get(key))
  if(r.provenance!=='inferred'&&!proof.some(e=>e.provenance===r.provenance))throw invalid('设计规则的来源类型与所引证据不一致。')
  if((r.provenance==='observed'&&observations||r.provenance==='extracted'&&inventory)&&!proof.some(e=>{const fact=factFor(e);return e.provenance===r.provenance&&fact?.property===r.property&&JSON.stringify(fact.value)===JSON.stringify(r.value)}))throw invalid('直接观察或提取的规则值与证据不一致；改写结论须标为推断。')
 }
 if(observations)for(const a of p.archetypes){
  const proof=a.evidenceIds.map(key=>byId.get(key))
  if(proof.every(e=>e.provenance==='observed')&&!proof.some(e=>{const page=observationFor(e);return page?.pageType===a.pageType&&page?.structure===a.structure}))throw invalid('页面原型与直接引用的实际页面观察不一致。')
 }
 return p
}

/** Text edits retain source evidence. Only changed design values receive a new
 * user provenance marker; a model cannot replace the reference history. */
export function preserveRevisionProfile(value,basePackage){
 if(!basePackage?.designProfile)return value
 if(value.schemaVersion!==basePackage.schemaVersion||!['pre-design.layout-package.v2','pre-design.layout-package.v3'].includes(value.schemaVersion))throw invalid('已有参考资源不能在文字修订中改变版本或丢弃设计Profile。')
 const profile=validateReferenceProfile(basePackage.designProfile)
 const pick=(object,keys)=>Object.fromEntries(keys.map(key=>[key,object?.[key]]))
 const next={...profile.designSystem,canvas:value.canvas,colors:pick(value.theme,['background','ink','accent','muted']),typography:pick(value.theme,['fontFamily','titleSize','bodySize','captionSize','lineHeight'])}
 const changedSystem=JSON.stringify(next)!==JSON.stringify(profile.designSystem)
 const changedArchetypes=new Set()
 for(const layout of value.layouts??[]){
  const previous=basePackage.layouts.find(l=>l.id===layout.id)
  if(!previous||JSON.stringify(layout.slots)!==JSON.stringify(previous.slots)||layout.prototypeSvg!==previous.prototypeSvg||JSON.stringify(layout.contentFitRules)!==JSON.stringify(previous.contentFitRules)){
   const archetype=profile.archetypes.find(a=>a.id===layout.archetypeId)
   if(!archetype)throw invalid('文字修订不能创建没有Profile原型依据的版式。')
   archetype.regions=(layout.slots??[]).map(({role,rect})=>({role,rect}));changedArchetypes.add(archetype.id)
  }
 }
 if(changedSystem||changedArchetypes.size){
  let index=1;while(profile.evidence.some(e=>e.id==='user-revision-'+index))index++
  const evidenceId='user-revision-'+index
  profile.evidence.push({id:evidenceId,provenance:'user'})
  if(changedSystem)next.evidenceIds=[...next.evidenceIds,evidenceId]
  for(const a of profile.archetypes)if(changedArchetypes.has(a.id))a.evidenceIds=[...a.evidenceIds,evidenceId]
 }
 profile.designSystem=next
 const validated=validateReferenceProfile(profile)
 return {...value,designProfile:validated,...(value.schemaVersion==='pre-design.layout-package.v3'?{designSpec:{...value.designSpec,profile:validated}}:{})}
}
