import {z} from 'zod'
import {nativeFigures,assertCompositionCoverage} from './composition-render.mjs'
export {nativeFigures,assertCompositionCoverage}

export const SCHEMA_V2='pre-design.layout-package.v2'
export const RENDERER_V2='pre-design-native-html-v2.0'
const invalid=message=>Object.assign(new Error(message),{statusCode:409,code:'LAYOUT_INVALID'})
const text=max=>z.string().trim().min(1).max(max)
const id=z.string().regex(/^[a-z][a-z0-9-]{0,47}$/)
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const compositionCanvasSchema=z.object({width:z.number().finite().min(240).max(7680),height:z.number().finite().min(240).max(7680)}).strict().refine(c=>c.width/c.height>=.2&&c.width/c.height<=5,'画布比例须在 1:5 至 5:1 之间。')
const rect=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),w:z.number().positive().max(1),h:z.number().positive().max(1)}).strict()
export const compositionStyleSchema=z.object({
 bodyPresentationVersion:z.literal(1).optional(),bodyPresentation:z.literal('labeled-paragraph').optional(),
 presentationVersion:z.literal(1).optional(),textMarker:z.literal('disc').optional(),captionPolicy:z.literal('when-present').optional(),
 tableDensity:z.enum(['normal','compact']).optional(),tableGrid:z.boolean().optional(),tableColumnWidths:z.array(z.number().finite().positive().max(1000)).min(2).max(8).optional(),
 fontFamily:z.enum(['sans','serif','calligraphic-fallback']).optional(),letterSpacing:z.number().min(-4).max(48).optional(),lineHeight:z.number().min(1).max(2).optional(),fontSize:z.number().min(16).max(320).optional(),fontWeight:z.union([z.literal(400),z.literal(500),z.literal(600),z.literal(700)]).optional(),
 align:z.enum(['left','center','right']).optional(),verticalAlign:z.enum(['top','middle','bottom']).optional(),
 emphasisColor:color.optional(),color:color.optional(),background:color.optional(),borderColor:color.optional(),borderWidth:z.number().min(0).max(6).optional(),padding:z.number().min(0).max(40).optional(),
 fit:z.enum(['contain','cover']).optional(),columns:z.number().int().min(1).max(3).optional(),
}).strict()
const compositionSlotSchema=z.object({
 id,role:z.enum(['title','claim','body','image','table','chart','timeline','diagram','source','text']),binding:id.optional(),purpose:z.enum(['label','heading','subheading','body','conclusion']).optional(),rect,
 index:z.number().int().min(0).max(63).optional(),
 range:z.object({start:z.number().int().min(0).max(63),end:z.number().int().min(1).max(64)}).strict().refine(r=>r.end>r.start,'内容范围须为非空的半开区间。').optional(),
 layer:z.number().int().min(0).max(20).optional(),overlap:z.literal('allow').optional(),style:compositionStyleSchema.optional(),
}).strict().superRefine((slot,ctx)=>{
 if((slot.role==='text')!==!!slot.binding||slot.purpose&&slot.role!=='text')ctx.addIssue({code:'custom',message:'局部文字必须有独立绑定键，其他槽位不能声明。'})
 if(slot.index!==undefined&&slot.range)ctx.addIssue({code:'custom',message:'槽位 index 与 range 只能选择一种。'})
 if(!['claim','body','image'].includes(slot.role)&&(slot.index!==undefined||slot.range))ctx.addIssue({code:'custom',message:'单一内容槽位不能配置 index 或 range。'})
 if(slot.role!=='table'&&['tableDensity','tableGrid','tableColumnWidths'].some(k=>slot.style?.[k]!==undefined))ctx.addIssue({code:'custom',message:'表格样式只适用于表格槽位。'})
 if((slot.style?.textMarker||slot.style?.captionPolicy)&&slot.style.presentationVersion!==1)ctx.addIssue({code:'custom',message:'内容呈现策略须显式声明版本1。'})
 if(slot.style?.textMarker&&(slot.role!=='text'||slot.purpose!=='body'))ctx.addIssue({code:'custom',message:'圆点列表仅适用于独立正文文字槽。'})
 if(slot.style?.bodyPresentationVersion!==undefined||slot.style?.bodyPresentation!==undefined){if(slot.role!=='body'||slot.style.bodyPresentationVersion!==1||slot.style.bodyPresentation!=='labeled-paragraph'||slot.style.columns!==undefined)ctx.addIssue({code:'custom',message:'编辑式正文须成对声明版本和呈现，仅支持独立正文槽且不能叠加分栏。'})}
 if(slot.style?.captionPolicy&&slot.role!=='image')ctx.addIssue({code:'custom',message:'图注策略仅适用于图片槽。'})
 if(slot.style?.fit&&slot.role!=='image')ctx.addIssue({code:'custom',message:'fit 只适用于图片槽位。'})
 if(slot.style?.columns&&!['body','image'].includes(slot.role))ctx.addIssue({code:'custom',message:'columns 只适用于正文或图片槽位。'})
 if(slot.style?.fontSize!==undefined&&slot.style.fontSize<(slot.role==='title'?32:['source','image'].includes(slot.role)?16:22))ctx.addIssue({code:'custom',message:'槽位字号低于对应内容的最小可读字号。'})
 if(slot.overlap&&slot.layer===undefined)ctx.addIssue({code:'custom',message:'允许重叠时必须显式指定 layer。'})
})
export const compositionLayoutSchema=z.object({id,label:text(60),kind:z.literal('composition'),archetypeId:id,slots:z.array(compositionSlotSchema).min(1).max(32)}).strict()

export const nativeChartSchema=z.object({
 type:z.enum(['bar','line']),title:text(160).optional(),unit:text(24).optional(),categories:z.array(text(80)).min(2).max(12),
 series:z.array(z.object({name:text(80),values:z.array(z.number().finite().min(-1e12).max(1e12)).min(2).max(12)}).strict()).min(1).max(4),
}).strict().refine(c=>c.series.every(s=>s.values.length===c.categories.length),'每条图表系列的数值数量须与分类一致。')
export const nativeTimelineSchema=z.object({title:text(160).optional(),events:z.array(z.object({label:text(80),description:text(240).optional()}).strict()).min(2).max(12)}).strict()
export const nativeDiagramSchema=z.object({
 title:text(160).optional(),direction:z.enum(['horizontal','vertical']).default('horizontal'),
 nodes:z.array(z.object({id,label:text(100)}).strict()).min(2).max(12),
 edges:z.array(z.object({from:id,to:id,label:text(80).optional()}).strict()).max(24),
}).strict().superRefine((diagram,ctx)=>{
 const ids=new Set(diagram.nodes.map(n=>n.id))
 if(ids.size!==diagram.nodes.length)ctx.addIssue({code:'custom',message:'关系图节点 ID 重复。'})
 if(diagram.edges.some(e=>!ids.has(e.from)||!ids.has(e.to)||e.from===e.to))ctx.addIssue({code:'custom',message:'关系图连线须引用不同的现有节点。'})
 if(new Set(diagram.edges.map(e=>`${e.from}:${e.to}`)).size!==diagram.edges.length)ctx.addIssue({code:'custom',message:'关系图连线重复。'})
})

export function validateCompositionLayout(layout,theme,contrast){
 if(new Set(layout.slots.map(s=>s.id)).size!==layout.slots.length)throw invalid('组合槽位 ID 重复。')
 for(const slot of layout.slots){
  const {rect:r,style={}}=slot
  if(r.x+r.w>1.000001||r.y+r.h>1.000001)throw invalid('组合槽位超出画布。')
  const background=style.background??theme.background
  if(style.emphasisColor&&contrast(style.emphasisColor,background)<4.5)throw invalid('局部强调与背景的对比度不足。')
  const foreground=style.color??(slot.role==='title'?theme.accent:slot.role==='source'?theme.muted:theme.ink)
  if(contrast(foreground,background)<(slot.role==='title'?3:4.5))throw invalid('组合槽位文字与背景的对比度不足。')
  if(['image','table','chart','timeline','diagram'].includes(slot.role)&&contrast(theme.muted,background)<4.5)throw invalid('组合槽位图注与背景的对比度不足。')
 }
 for(let i=0;i<layout.slots.length;i++)for(let j=i+1;j<layout.slots.length;j++){
  const a=layout.slots[i],b=layout.slots[j],x=a.rect,y=b.rect
  const overlaps=Math.min(x.x+x.w,y.x+y.w)-Math.max(x.x,y.x)>.001&&Math.min(x.y+x.h,y.y+y.h)-Math.max(x.y,y.y)>.001
  if(overlaps&&!(a.overlap==='allow'&&b.overlap==='allow'&&a.layer!==undefined&&b.layer!==undefined&&a.layer!==b.layer))throw invalid('组合槽位重叠须双方声明允许，并显式使用不同层级。')
 }
 return layout
}

export function chooseCompositionLayout(pkg,item,id){
 if(id){const layout=pkg.layouts.find(l=>l.id===id);if(!layout)throw invalid('指定的组合版式不存在。');return assertCompositionCoverage(layout,item)}
 const matches=pkg.layouts.filter(layout=>{try{assertCompositionCoverage(layout,item);return true}catch{return false}})
 if(!matches.length)throw invalid('资源没有完整覆盖本页内容的适合版式，请调整分页或选择其他资源。')
 const requested=item.presentation?.archetypeId
 return matches.find(l=>l.archetypeId===requested)??matches[0]
}
