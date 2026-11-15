import {createHash} from 'node:crypto'
import {z} from 'zod'
export const SCHEMA='pre-design.layout-package.v1'
export const RENDERER='pre-design-native-html-v1.0'
export const SKILL_IDS=Object.freeze(['V07','V08','V09','V10','V11','V12','V13','V14','Q05','Q07','Q08'])
export const fail=(message,statusCode=400,code='LAYOUT_INVALID')=>Object.assign(new Error(message),{statusCode,code})
const text=n=>z.string().trim().min(1).max(n)
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const themeSchema=z.object({background:color,ink:color,accent:color,muted:color,fontFamily:z.enum(['sans','serif']),titleSize:z.number().min(32).max(90),bodySize:z.number().min(22).max(44),captionSize:z.number().min(16).max(30),lineHeight:z.number().min(1.2).max(1.9)}).strict()
export const patchSchema=z.object({theme:themeSchema.partial().optional(),layoutId:z.string().regex(/^[a-z][a-z0-9-]{0,47}$/).optional()}).strict()
const rect=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),w:z.number().positive().max(1),h:z.number().positive().max(1)}).strict()
const slot=z.object({role:z.enum(['title','claim','body','image','table','source']),rect}).strict()
const layoutSchema=z.object({id:z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),label:text(60),kind:z.enum(['points','columns','focus','image-left','table']),slots:z.array(slot).min(4).max(7)}).strict()
const source=z.object({kind:z.enum(['manual','built-in','pptx','reference-text','project-page']),name:text(180).optional(),sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),limitations:z.array(text(400)).max(20).default([]),parents:z.array(z.object({resourceId:z.string().uuid(),version:z.number().int().positive(),hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(4).optional()}).strict()
const resourceSchema=z.object({schemaVersion:z.literal(SCHEMA),name:text(100),description:z.string().max(600).default(''),kind:z.enum(['theme','page','set']),tags:z.array(text(40)).max(12).default([]),canvas:z.object({width:z.literal(1600),height:z.literal(900)}).strict(),theme:themeSchema,layouts:z.array(layoutSchema).min(1).max(12),formats:z.tuple([z.literal('html')]),source,rights:z.object({basis:z.enum(['original','licensed','permission','unknown']),shareAllowed:z.boolean(),note:z.string().max(600)}).strict()}).strict()
export const nativeFigureSchema=z.object({materialId:z.uuid(),caption:text(160)}).strict()
export const nativeTableSchema=z.object({columns:z.array(text(100)).min(2).max(8),rows:z.array(z.array(z.string().max(300)).min(2).max(8)).min(1).max(40)}).strict().refine(t=>t.rows.every(r=>r.length===t.columns.length),'每行列数须与表头一致')
export const defaultTheme=Object.freeze({background:'#f7f9fc',ink:'#24364c',accent:'#3454a0',muted:'#53647c',fontFamily:'sans',titleSize:48,bodySize:30,captionSize:18,lineHeight:1.5})
const s=(role,x,y,w,h)=>({role,rect:{x,y,w,h}})
export function defaultLayouts(){
 const common=[s('title',.05,.08,.90,.10),s('claim',.05,.21,.90,.10)]
 const tail=s('source',.05,.91,.90,.045)
 return [
  {id:'points',label:'清晰要点',kind:'points',slots:[...common,s('body',.05,.36,.90,.49),tail]},
  {id:'columns',label:'双栏对照',kind:'columns',slots:[...common,s('body',.05,.36,.90,.49),tail]},
  {id:'focus',label:'重点陈述',kind:'focus',slots:[...common,s('body',.09,.36,.86,.49),tail]},
  {id:'image-left',label:'左图右文',kind:'image-left',slots:[...common,s('image',.05,.36,.49,.49),s('body',.59,.36,.36,.49),tail]},
  {id:'table',label:'数据比较',kind:'table',slots:[...common,s('body',.05,.34,.90,.09),s('table',.05,.46,.90,.40),tail]},
 ]
}
export function createPackage(name='清晰蓝灰 · 标准汇报'){
 return {schemaVersion:SCHEMA,name,description:'原生版式资源；预览、试排与项目成果采用相同渲染器。',kind:'set',tags:['汇报','通用'],canvas:{width:1600,height:900},theme:{...defaultTheme},layouts:defaultLayouts(),formats:['html'],source:{kind:'manual',limitations:[]},rights:{basis:'original',shareAllowed:false,note:''}}
}
export function contrast(a,b){
 const luminance=h=>{const c=h.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]}
 const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)
}
export function validateTheme(value){
 const t=themeSchema.parse(value)
 for(const key of ['ink','muted','accent'])if(contrast(t[key],t.background)<(key==='accent'?3:4.5))throw fail(`${key}与背景的对比度不足，不能发布或应用。`)
 return t
}
export function validatePackage(value){
 const p=resourceSchema.parse(value);validateTheme(p.theme)
 if(new Set(p.layouts.map(x=>x.id)).size!==p.layouts.length)throw fail('版式ID重复。')
 for(const l of p.layouts){
  const roles=l.slots.map(s=>s.role)
  const required=['title','claim','body','source',...(l.kind==='image-left'?['image']:[]),...(l.kind==='table'?['table']:[])]
  if(roles.length!==required.length||required.some(r=>roles.filter(x=>x===r).length!==1))throw fail('版式内容位置必须完整且不重复。')
  for(const slot of l.slots){const r=slot.rect;if(r.x+r.w>1.000001||r.y+r.h>1.000001)throw fail('版式元素超出画布。')}
  for(let i=0;i<l.slots.length;i++)for(let j=i+1;j<l.slots.length;j++){
   const a=l.slots[i].rect,b=l.slots[j].rect
   if(Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>.001&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>.001)throw fail('版式内容位置重叠。')
  }
 }
 return p
}
function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v}
export const packageDigest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')
export function chooseLayout(p,item,id){
 const l=id?p.layouts.find(l=>l.id===id):p.layouts.find(l=>l.kind===(item.table?'table':item.figure?'image-left':item.presentation?.layout??'points'))??p.layouts.find(l=>['points','columns','focus'].includes(l.kind))
 if(!l)throw fail('资源没有适合本页内容的版式，请选择其他版式。',409)
 if(l.kind==='image-left'&&!item.figure)throw fail('该版式需要实际图片，请先补齐页脚本图片。',409)
 if(l.kind==='table'&&!item.table)throw fail('该版式需要结构化表格，请先补齐页脚本表格。',409)
 if(item.table&&l.kind!=='table')throw fail('不能用不含表格的版式丢弃本页表格。',409)
 if(item.figure&&l.kind!=='image-left')throw fail('不能用不含图片的版式丢弃本页图片。',409)
 if(item.table&&item.figure)throw fail('本版不支持同页同时配置图片和表格，请先调整分页脚本。',409)
 return l
}
export function resolvePage({page,globalPackage,globalOverrides,local,manual,resourceRefs=[]}){
 const global=validatePackage(globalPackage??createPackage()),p=local?.package?validatePackage(local.package):global
 const globalPatch=patchSchema.parse(globalOverrides??{}),localPatch=patchSchema.parse(local?.overrides??{}),manualPatch=patchSchema.parse(manual??{})
 const theme=validateTheme({...global.theme,...globalPatch.theme,...(local?.package?p.theme:{}),...localPatch.theme,...manualPatch.theme})
 const layout=chooseLayout(p,page.item,manualPatch.layoutId??localPatch.layoutId??(local?.package?undefined:globalPatch.layoutId))
 return {schemaVersion:SCHEMA,renderer:RENDERER,canvas:p.canvas,theme,layout,resourceRefs,manual:manualPatch,formats:['html']}
}
export function exportReusable(page,name){
 if(!page.nativeLayout||page.nativeLayout.renderer!==RENDERER)throw fail('请先应用原生版式后再保存为资源。',409)
 const p=createPackage(name);p.theme={...page.nativeLayout.theme};p.layouts=[structuredClone(page.nativeLayout.layout)];p.kind='page';p.source={kind:'project-page',parents:page.nativeLayout.resourceRefs??[],limitations:['仅保留样式和内容位置；项目正文、图片、表格、身份和原件均不复制。']}
 return validatePackage(p)
}
export function assertInstanceContent(page){
 if(!page?.id||!page.item||typeof page.item.title!=='string'||!Array.isArray(page.item.paragraphs)||!Array.isArray(page.item.points))throw fail('页面输入不完整。')
 if(page.item.figure)nativeFigureSchema.parse(page.item.figure)
 if(page.item.table)nativeTableSchema.parse(page.item.table)
}
