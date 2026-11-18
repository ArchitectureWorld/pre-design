import {z} from 'zod'
import {validatePackage,packageDigest} from './contract.mjs'
import {compileNativeDesignPackageV3} from './native-design-compiler.mjs'
export const CONTENT_STYLE_RULE_VERSION='content-driven-style-plan-v1'
const issued=new WeakMap()
const fail=message=>{throw Object.assign(Error(message),{code:'CONTENT_STYLE_PLAN_INVALID',statusCode:409})}
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o)}return o}
const text=z.string().min(1).max(10000)
const contentSchema=z.object({title:text,paragraphs:z.array(text).max(14),points:z.array(text).max(14),evidenceIndexes:z.array(z.number().int().nonnegative()).max(64).optional()}).strict()
const positive=z.number().finite().positive(),nonnegative=z.number().finite().nonnegative()
const responseSchema=z.object({schemaVersion:z.literal('content-style-measurement-v1'),requestHash:z.string(),textId:z.string(),fontsReady:z.literal(true),units:z.literal('canvas-pixels'),lineBoxes:z.array(z.object({x:nonnegative,y:z.number().finite(),width:positive,height:positive}).strict()).min(1).max(2048),requiredWidth:positive,requiredHeight:positive}).strict()
/** Internal-only capability boundary. Requests contain private text, results do not.
 * Callers must supply a trusted renderer-backed browser measureText function.
 * This module cannot authenticate an injected function or certify visual quality. */
export function prepareContentDrivenStylePlan({sourcePackage,layoutId,item,styleAcknowledged}){
 if(styleAcknowledged!==true)fail('需要显式平台重设计授权。')
 const pkg=validatePackage(structuredClone(sourcePackage));if(!pkg.designSpec||pkg.schemaVersion!=='pre-design.layout-package.v3')fail('需要冻结 Native V3 资源。')
 const layout=pkg.layouts.find(l=>l.id===layoutId);if(!layout)fail('源版式不存在。')
 // Ignore transport/presentation metadata, but never silently drop content kinds.
 for(const k of ['figure','figures','table','chart','diagram','timeline','textBlocks'])if(item[k]!==undefined&&item[k]!==null&&(!Array.isArray(item[k])||item[k].length))fail('首版只支持纯文字正文。')
 const content=contentSchema.parse({title:item.title,paragraphs:item.paragraphs,points:item.points,...(item.evidenceIndexes?{evidenceIndexes:item.evidenceIndexes}:{})})
 if(content.paragraphs.length+content.points.length>28)fail('正文槽位超过本轮容量。')
 const canvas=pkg.canvas,theme=pkg.theme,profile=pkg.designSpec.profile
 const roleRules=[],roleCache=new Map()
 const roleSlot=role=>{
  if(roleCache.has(role))return roleCache.get(role)
  const slots=layout.slots.filter(s=>s.role===role).sort((a,b)=>a.rect.x-b.rect.x||a.id.localeCompare(b.id));if(!slots.length||role==='title'&&slots.length!==1)fail('源角色缺少可追溯锚点。')
  const first=slots[0],tolerance=.000001
  const effective=s=>({...{fontFamily:theme.fontFamily,fontSize:role==='title'?theme.titleSize:theme.bodySize,fontWeight:role==='title'?700:400,lineHeight:role==='title'?1.2:theme.lineHeight,letterSpacing:0,align:'left',verticalAlign:'top',padding:0,color:role==='title'?theme.accent:theme.ink},...s.style})
  const expected=packageDigest(effective(first))
  for(let i=1;i<slots.length;i++){const a=slots[i];if(packageDigest(effective(a))!==expected||Math.abs(a.rect.y-first.rect.y)>tolerance||Math.abs(a.rect.h-first.rect.h)>tolerance||a.rect.x<slots[i-1].rect.x+slots[i-1].rect.w-tolerance)fail('源同角色网格样式、共线或非重叠条件不成立。')}
  const result={...first,rect:{...first.rect,w:slots.at(-1).rect.x+slots.at(-1).rect.w-first.rect.x}}
  roleRules.push({role,strategy:slots.length>1?'aligned-role-envelope':'source-role-anchor',provenance:'inferred',sourceSlotIds:slots.map(s=>s.id),sourceRectsHash:packageDigest(slots.map(s=>({id:s.id,rect:s.rect}))),sourceStyleHash:expected,alignmentTolerance:tolerance,sourcePadding:first.style?.padding??0,derivedPadding:0,sourceVerticalAlign:first.style?.verticalAlign??'top',derivedVerticalAlign:'top',reason:'continuous-text-flow'})
  roleCache.set(role,result);return result
 }
 const title=roleSlot('title'),source=layout.slots.find(s=>s.role==='source')
 const requests=[],origins={}
 const add=(role,value,index)=>{
  const origin=roleSlot(role),s=origin.style??{},fontSize=s.fontSize??(role==='title'?theme.titleSize:theme.bodySize)
  if(fontSize<(role==='title'?32:22))fail('源字号低于可读下限，不能静默调整。')
  if(s.columns&&s.columns!==1||s.background||s.borderWidth)fail('当前源含需单独处理的装饰或分栏文字。')
  const textId=role==='title'?'title':`${role}-${index}`
  const style={fontFamily:s.fontFamily??theme.fontFamily,fontSize,fontWeight:s.fontWeight??(role==='title'?700:400),lineHeight:s.lineHeight??(role==='title'?1.2:theme.lineHeight),letterSpacing:s.letterSpacing??0,align:s.align??'left',padding:0}
  const r={schemaVersion:'content-style-measurement-v1',textId,role,text:value,width:origin.rect.w*canvas.width,canvas:structuredClone(canvas),style}
  r.requestHash=packageDigest(r);requests.push(r);origins[textId]={x:origin.rect.x,w:origin.rect.w,color:s.color??(role==='title'?theme.accent:theme.ink),...(index!==undefined?{index}:{})}
 }
 add('title',content.title);content.paragraphs.forEach((s,i)=>add('claim',s,i));content.points.forEach((s,i)=>add('body',s,i))
 const request=freeze({ruleVersion:CONTENT_STYLE_RULE_VERSION,sourceHash:packageDigest(pkg),layoutHash:packageDigest(layout),contentHash:packageDigest(content),canvas:structuredClone(canvas),requests})
 issued.set(request,{pkg,layout,content,origins,top:title.rect.y,bottom:source?.rect.y??1-profile.designSystem.spacing.margin,gap:profile.designSystem.spacing.gutter*canvas.height,source,roleRules})
 return request
}
export async function buildContentDrivenStylePlan(request,{measureText}={}){
 const state=issued.get(request);if(!state||typeof measureText!=='function')fail('缺少签发请求或可信浏览器测量能力。')
 const {pkg,content,origins,top,bottom,gap,source}=state,{width,height}=request.canvas
 let y=top*height;const slots=[],measurements=[],typographyAdjustments=[]
 for(const originalRequest of request.requests){
  let r=originalRequest,m,accepted=false;const attempts=[]
  // Font selection boxes can extend above a CSS line box. Never clamp that
  // evidence away: remeasure a bounded, explicit readability derivation.
  const candidates=[...new Set([r.style.lineHeight,1.5,1.75,2].filter(n=>n>=r.style.lineHeight))]
  for(const lineHeight of candidates){
   const {requestHash:_prior,...body}=originalRequest
   const next={...body,style:{...body.style,lineHeight}};r=freeze({...next,requestHash:packageDigest(next)})
   m=responseSchema.parse(await measureText(r));attempts.push(packageDigest(m))
   if(m.requestHash!==r.requestHash||m.textId!==r.textId||m.requiredWidth>r.width+1/64+1e-9||m.lineBoxes.some(b=>b.x+b.width>m.requiredWidth+.01||b.y+b.height>m.requiredHeight+.01))fail('测量身份或行盒边界无效。')
   if(m.lineBoxes.every(b=>b.y>=0)){accepted=true;break}
  }
  if(!accepted)fail('字体行盒仍超出可读区域，未裁切文字或生成计划。')
  if(r.style.lineHeight!==originalRequest.style.lineHeight)typographyAdjustments.push({textId:r.textId,sourceLineHeight:originalRequest.style.lineHeight,derivedLineHeight:r.style.lineHeight,reason:'measured-font-line-box',provenance:'inferred',attemptHashes:attempts})
  if(y+m.requiredHeight>bottom*height)fail('完整内容超过可用高度，未生成计划。')
  const origin=origins[r.textId];slots.push({id:r.textId,role:r.role,...(origin.index!==undefined?{index:origin.index}:{}),rect:{x:origin.x,y:y/height,w:origin.w,h:m.requiredHeight/height},style:{...r.style,color:origin.color,verticalAlign:'top'}})
  y+=m.requiredHeight+gap;measurements.push(m)
 }
 if(source)slots.push(structuredClone(source));else if(content.evidenceIndexes?.length)fail('来源正文缺少页脚槽。')
 const key=packageDigest({rule:request.ruleVersion,source:request.sourceHash,layout:request.layoutHash,content:request.contentHash,measurements}).slice(0,16),id=`content-style-${key}`,evidenceId=`style-plan-${key}`
 const profile=pkg.designSpec.profile,original=profile.archetypes.find(a=>a.id===state.layout.archetypeId)
 const delta={evidence:[{id:evidenceId,provenance:'inferred',dependsOn:[...original.evidenceIds]}],archetype:{id,pageType:'text',structure:'single-column',density:'medium',roles:[...new Set(slots.map(s=>s.role))],capacity:{images:0,bodyPoints:content.points.length,tableRows:0,textBlocks:0},regions:slots.map(s=>({role:s.role,rect:{...s.rect}})),evidenceIds:[evidenceId]},masterLayoutGraph:[],components:[]}
 const n=1+Math.max(0,...pkg.designSpec.masterLayoutGraph.map(n=>Number(n.id.split('-').at(-1)))),c=1+Math.max(0,...pkg.designSpec.components.map(n=>Number(n.id.split('-').at(-1))))
 delta.masterLayoutGraph=[{id:`master-${n}`,kind:'master',parentId:null,evidenceIds:[evidenceId]},{id:`layout-${n}`,kind:'layout',parentId:`master-${n}`,archetypeId:id,evidenceIds:[evidenceId]}]
 delta.components=delta.archetype.roles.map((role,i)=>({id:`component-${c+i}`,kind:'content-slot',role,evidenceIds:[evidenceId]}))
 const chars=s=>Array.from(s).length
 const prototype={id,archetypeId:id,label:'内容测量驱动 · 平台重设计',slots,prototypeSvg:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`,contentFitRules:{overflow:'reject',maxTitleCharacters:chars(content.title),maxClaimCharacters:content.paragraphs.reduce((n,s)=>n+chars(s),0),maxBodyPoints:content.points.length,maxBodyCharacters:content.points.reduce((n,s)=>n+chars(s),0),maxImages:0,maxTableRows:0,maxTableColumns:0,maxTextBlocks:0,maxTextCharacters:0}}
 const spec=structuredClone(pkg.designSpec);spec.profile.evidence.push(...delta.evidence);spec.profile.archetypes.push(delta.archetype);spec.masterLayoutGraph.push(...delta.masterLayoutGraph);spec.components.push(...delta.components)
 compileNativeDesignPackageV3({name:pkg.name,rights:pkg.rights,designSpec:spec,prototypes:[...pkg.layouts.map(({kind,...p})=>p),prototype]})
 return freeze({prototype,delta,receipt:{ruleVersion:request.ruleVersion,sourceHash:request.sourceHash,layoutHash:request.layoutHash,contentHash:request.contentHash,measurementHash:packageDigest(measurements),outputHash:packageDigest({prototype,delta}),provenance:'inferred',typographyAdjustments,roleRules:structuredClone(state.roleRules),visualAcceptance:'pending',limitations:['仅正文实测顺序流；未复制原装饰，不声称原稿复刻。','页脚与最终整页仍需真实浏览器复核。']}})
}
