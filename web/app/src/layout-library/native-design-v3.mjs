import {projectSourceFooterSchema,validateProjectSourceFooter} from './project-source-footer.mjs'
import {contentFitPolicySchema,validateContentFitPolicy} from './content-fit-policy.mjs'
import {decorativeAssetSchema,decorationSchema,validateDecorativeAssets} from './decoration-assets.mjs'
import {validateFidelityFeatures} from './fidelity-assessment.mjs'
import {deriveReadableTheme} from './accessible-theme.mjs'
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
export const contentFitRulesSchema=z.object({overflow:z.literal('reject'),maxTextBlocks:count(32).optional(),maxTextCharacters:count(50000).optional(),maxTitleCharacters:count(2000),maxClaimCharacters:count(10000),maxBodyPoints:count(64),maxBodyCharacters:count(50000),maxImages:count(6),maxTableRows:count(40),maxTableColumns:count(8)}).strict()
export const nativeLayoutSchema=compositionLayoutSchema.extend({projectSourceFooter:projectSourceFooterSchema.optional(),contentAdaptationPolicy:contentFitPolicySchema.optional(),decorations:z.array(decorationSchema).max(16).optional(),prototypeSvg:z.string().min(1).max(512000),contentFitRules:contentFitRulesSchema}).strict()
const themeDerivation=z.object({key:z.enum(['ink','muted','accent']),source:z.string().regex(/^#[0-9a-fA-F]{6}$/),derived:z.string().regex(/^#[0-9a-fA-F]{6}$/),background:z.string().regex(/^#[0-9a-fA-F]{6}$/),minimum:z.union([z.literal(3),z.literal(4.5)]),method:z.literal('rgb-endpoint-minimum-v1'),reason:z.literal('text-contrast')}).strict()
export const nativePackageFields={decorativeAssets:z.array(decorativeAssetSchema).min(1).max(32).optional(),fidelityFeatures:z.array(z.unknown()).min(1).max(256).optional(),themeDerivations:z.array(themeDerivation).min(1).max(3).optional(),schemaVersion:z.literal(SCHEMA_V3),layouts:z.array(nativeLayoutSchema).min(1).max(24),designSpec:designSpecSchema,compilerVersion:z.literal(COMPILER_V3),upstreamRevision:z.literal(UPSTREAM_REVISION),rendererCompatibility:z.tuple([z.literal(RENDERER_V3)]),validationReceipts:z.array(z.object({kind:z.enum(['native-schema','svg-safety']),version:z.literal(COMPILER_V3),status:z.literal('passed')}).strict()).length(2)}
const invalid=message=>Object.assign(new Error(message),{statusCode:409,code:'NATIVE_DESIGN_INVALID'})
export function validateNativeDesignPackage(p,context={}){
 validateDecorativeAssets(p)
 validateFidelityFeatures(p)
 const spec=validateDesignSpec(p.designSpec,context),profile=spec.profile
 if(!isDeepStrictEqual(p.designProfile,profile))throw invalid('V3 设计规范与 Profile 不一致。')
 const system=profile.designSystem
 const original={...system.colors,...system.typography},derived=deriveReadableTheme(original)
 if(p.themeDerivations&&!isDeepStrictEqual(p.themeDerivations,derived.changes))throw invalid('可读性派生记录与原色不一致。')
 const expected=p.themeDerivations?derived.theme:original
 if(p.canvas.width!==system.canvas.width||p.canvas.height!==system.canvas.height||Object.entries(expected).some(([k,v])=>p.theme[k]!==v))throw invalid('V3 设计系统与实际画布或主题不一致。')
 for(const layout of p.layouts){
  const a=profile.archetypes.find(a=>a.id===layout.archetypeId)
  if(!a)throw invalid('原型缺少设计证据。')
  if(layout.contentAdaptationPolicy){
   validateContentFitPolicy(layout.contentAdaptationPolicy,layout)
   const source=layout.contentAdaptationPolicy.source,byId=new Map(profile.evidence.map(e=>[e.id,e])),visited=new Set()
   const matches=id=>{if(visited.has(id))return false;visited.add(id);const e=byId.get(id);return !!e&&(e.fileSha256===source.fileSha256&&e.pageNumber===source.pageNumber||(e.dependsOn??[]).some(matches))}
   if(!a.evidenceIds.some(matches))throw invalid('适配策略来源必须属于当前原型证据页。')
  }
  if(layout.projectSourceFooter)validateProjectSourceFooter(layout,p.canvas)
  const roles=new Set(layout.slots.filter(s=>!(layout.projectSourceFooter&&s.id===layout.projectSourceFooter.slotId)).map(s=>s.role))
  if(a.roles.some(r=>!roles.has(r))||[...roles].some(r=>!a.roles.includes(r)))throw invalid('原生原型槽位没有完整匹配设计规范。')
  if(profile.intent==='structure'&&a.regions){
   const unmatched=layout.slots.filter(s=>!(layout.projectSourceFooter&&s.id===layout.projectSourceFooter.slotId))
   for(const region of a.regions){
    const index=unmatched.findIndex(slot=>slot.role===region.role&&['x','y','w','h'].every(key=>Math.abs(slot.rect[key]-region.rect[key])<=.000001))
    if(index<0)throw invalid('结构迁移必须保留设计规范声明的具体内容区域。')
    unmatched.splice(index,1)
   }
   if(unmatched.length)throw invalid('结构迁移不能增加设计规范未声明的内容区域。')
  }
  // Necessary lower bound only; real browser trial remains the publication gate.
  for(const slot of layout.slots.filter(s=>['title','claim','body','source','text'].includes(s.role))){
   const style=slot.style??{},fontSize=style.fontSize??(slot.role==='title'?p.theme.titleSize:slot.role==='source'?p.theme.captionSize:p.theme.bodySize)
   const lineHeight=style.lineHeight??(slot.role==='title'?1.2:p.theme.lineHeight)
   const inset=2*((style.padding??0)+(style.borderWidth??0))
   if(slot.rect.h*p.canvas.height-inset+0.01<fontSize*lineHeight)throw invalid('文字槽位高度不足以容纳一行文字，请调整设计区域或可读字号。')
  }
  const fit=layout.contentFitRules
  const textSlots=layout.slots.filter(s=>s.role==='text')
  if(textSlots.length!==(fit.maxTextBlocks??0)||new Set(textSlots.map(s=>s.binding)).size!==textSlots.length||(fit.maxTextBlocks??0)>(a.capacity.textBlocks??0)||textSlots.length&&!(fit.maxTextCharacters>=textSlots.length))throw invalid('局部文字容量或绑定键不一致。')
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
  const full=p.layouts.some(l=>l.archetypeId===archetype.id&&l.contentFitRules.maxImages===archetype.capacity.images&&l.contentFitRules.maxBodyPoints===archetype.capacity.bodyPoints&&l.contentFitRules.maxTableRows===archetype.capacity.tableRows&&(l.contentFitRules.maxTextBlocks??0)===(archetype.capacity.textBlocks??0))
  if(!full)throw invalid('每个设计原型至少需要一个完整承载全部声明容量的 SVG 变体，不能缩减容量。')
 }
 if(new Set(p.validationReceipts.map(r=>r.kind)).size!==2)throw invalid('原生检查收执不完整。')
 return p
}
