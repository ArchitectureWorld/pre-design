import {z} from 'zod'
import {isDeepStrictEqual} from 'node:util'
import {compositionLayoutSchema} from './composition-contract.mjs'
import {designSpecSchema,validateDesignSpec} from './design-spec.mjs'
import {sanitizePrototypeSvg} from './svg-prototype.mjs'
export const SCHEMA_V3='pre-design.layout-package.v3'
export const RENDERER_V3='pre-design-native-html-v3.0'
export const COMPILER_V3='pre-design-native-compiler-v3.0'
export const UPSTREAM_REVISION='3af3e8ef774c4d67ee57e1306d9256d08c9ee1bf'
const count=max=>z.number().int().min(0).max(max)
export const contentFitRulesSchema=z.object({overflow:z.literal('reject'),maxTitleCharacters:count(2000),maxClaimCharacters:count(10000),maxBodyPoints:count(64),maxBodyCharacters:count(50000),maxImages:count(6),maxTableRows:count(40),maxTableColumns:count(8)}).strict()
export const nativeLayoutSchema=compositionLayoutSchema.extend({prototypeSvg:z.string().min(1).max(512000),contentFitRules:contentFitRulesSchema}).strict()
export const nativePackageFields={schemaVersion:z.literal(SCHEMA_V3),layouts:z.array(nativeLayoutSchema).min(1).max(24),designSpec:designSpecSchema,compilerVersion:z.literal(COMPILER_V3),upstreamRevision:z.literal(UPSTREAM_REVISION),rendererCompatibility:z.tuple([z.literal(RENDERER_V3)]),validationReceipts:z.array(z.object({kind:z.enum(['native-schema','svg-safety']),version:z.literal(COMPILER_V3),status:z.literal('passed')}).strict()).length(2)}
const invalid=message=>Object.assign(new Error(message),{statusCode:409,code:'NATIVE_DESIGN_INVALID'})
export function validateNativeDesignPackage(p,context={}){
 const spec=validateDesignSpec(p.designSpec,context),profile=spec.profile
 if(!isDeepStrictEqual(p.designProfile,profile))throw invalid('V3 设计规范与 Profile 不一致。')
 const system=profile.designSystem
 if(p.canvas.width!==system.canvas.width||p.canvas.height!==system.canvas.height||Object.entries({...system.colors,...system.typography}).some(([k,v])=>p.theme[k]!==v))throw invalid('V3 设计系统与实际画布或主题不一致。')
 for(const layout of p.layouts){
  const a=profile.archetypes.find(a=>a.id===layout.archetypeId)
  if(!a)throw invalid('原型缺少设计证据。')
  const roles=new Set(layout.slots.map(s=>s.role))
  if(a.roles.some(r=>!roles.has(r))||[...roles].some(r=>!a.roles.includes(r)))throw invalid('原生原型槽位没有完整匹配设计规范。')
  if(profile.intent==='structure'&&a.regions){
   const unmatched=[...layout.slots]
   for(const region of a.regions){
    const index=unmatched.findIndex(slot=>slot.role===region.role&&['x','y','w','h'].every(key=>Math.abs(slot.rect[key]-region.rect[key])<=.000001))
    if(index<0)throw invalid('结构迁移必须保留设计规范声明的具体内容区域。')
    unmatched.splice(index,1)
   }
   if(unmatched.length)throw invalid('结构迁移不能增加设计规范未声明的内容区域。')
  }
  const fit=layout.contentFitRules
  if(fit.maxImages>a.capacity.images||fit.maxBodyPoints>a.capacity.bodyPoints||fit.maxTableRows>a.capacity.tableRows)throw invalid('原型容量超过设计规范。')
  for(const [role,capacity] of [['image',fit.maxImages],['body',fit.maxBodyPoints]]){
   const slots=layout.slots.filter(s=>s.role===role)
   if(capacity>0&&!slots.length)throw invalid('原型声明容量缺少对应内容槽位。')
   const unbounded=slots.filter(s=>s.index===undefined&&!s.range)
   if(unbounded.length){
    if(slots.length!==1)throw invalid('重复内容槽位必须用选择器明确划分容量。')
   }else{
    const indexes=slots.flatMap(s=>s.index!==undefined?[s.index]:Array.from({length:s.range.end-s.range.start},(_,i)=>s.range.start+i)).sort((x,y)=>x-y)
    if(indexes.length!==capacity||indexes.some((value,index)=>value!==index))throw invalid('内容选择器必须完整且不重复地覆盖原型变体容量。')
   }
  }
  if(fit.maxTableRows>0&&(!roles.has('table')||fit.maxTableColumns<2))throw invalid('表格容量缺少实际表格槽位或可用列数。')
  layout.prototypeSvg=sanitizePrototypeSvg(layout.prototypeSvg,{canvas:p.canvas})
 }
 for(const archetype of profile.archetypes){
  const full=p.layouts.some(l=>l.archetypeId===archetype.id&&l.contentFitRules.maxImages===archetype.capacity.images&&l.contentFitRules.maxBodyPoints===archetype.capacity.bodyPoints&&l.contentFitRules.maxTableRows===archetype.capacity.tableRows)
  if(!full)throw invalid('每个设计原型至少需要一个完整承载全部声明容量的 SVG 变体，不能缩减容量。')
 }
 if(new Set(p.validationReceipts.map(r=>r.kind)).size!==2)throw invalid('原生检查收执不完整。')
 return p
}
