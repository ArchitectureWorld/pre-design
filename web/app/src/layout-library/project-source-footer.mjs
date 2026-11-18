import {z} from 'zod'
import {compositionCanvasSchema} from './composition-contract.mjs'
export const projectSourceFooterSchema=z.object({version:z.literal(1),slotId:z.literal('project-source-footer'),provenance:z.literal('derived-project-metadata')}).strict()
const fail=()=>{throw Object.assign(Error('项目来源栏没有独立可用空间，不能遮挡原组件或省略引用。'),{code:'PROJECT_SOURCE_FOOTER_REQUIRED',statusCode:409})}
const overlap=(a,b)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1e-6&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>1e-6
const geometry=canvas=>({x:.04,y:1-.02-24/canvas.height,w:.92,h:24/canvas.height})
export function validateProjectSourceFooter(layout,canvas){
 projectSourceFooterSchema.parse(layout.projectSourceFooter);canvas=compositionCanvasSchema.parse(canvas)
 const sources=layout.slots.filter(s=>s.role==='source'),s=layout.slots.find(s=>s.id==='project-source-footer'),r=geometry(canvas)
 if(!s||sources.length!==1||sources[0]!==s||s.index!==undefined||s.range!==undefined||s.binding!==undefined||Object.keys(r).some(k=>Math.abs(s.rect[k]-r[k])>1e-9)||s.style?.fontSize!==18||s.style?.lineHeight!==1.2||s.style?.padding!==0||!/^#[a-f\d]{6}$/i.test(s.style?.background??''))fail()
 if(layout.slots.some(other=>other!==s&&overlap(s.rect,other.rect)))fail()
 return s
}
/** Platform metadata, not reference design evidence. Original geometry is never moved. */
export function deriveProjectSourceFooter(layout,canvas,theme,observation){
 canvas=compositionCanvasSchema.parse(canvas)
 if(layout.projectSourceFooter||layout.slots.some(s=>s.role==='source'||s.id==='project-source-footer'))fail()
 const r=geometry(canvas)
 if(!observation?.components||observation.components.some(c=>c.kind!=='group'&&overlap(r,c.rect)))fail()
 const result=structuredClone(layout)
 result.projectSourceFooter={version:1,slotId:'project-source-footer',provenance:'derived-project-metadata'}
 result.slots.push({id:'project-source-footer',role:'source',rect:r,style:{fontSize:18,lineHeight:1.2,padding:0,background:theme.background,color:theme.muted}})
 validateProjectSourceFooter(result,canvas);return result
}
