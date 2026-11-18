import {z} from 'zod'
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/)
const base={componentId:z.string(),provenance:z.literal('derived-adaptation')}
// Keep legacy property order: it is part of frozen schema/prompt identity.
const legacy=z.object({componentId:z.string(),shape:z.enum(['rect','diamond']),fill:color,provenance:z.literal('derived-adaptation')}).strict()
const v1=z.union([legacy,
 z.object({...base,shape:z.literal('rounded-rect'),fill:color,radiusRatio:z.number().finite().gt(0).max(.5)}).strict(),
 z.object({...base,shape:z.literal('ellipse'),fill:color}).strict(),
 z.object({...base,shape:z.literal('line'),stroke:color,strokeWidthRatio:z.number().finite().gt(0).max(1),direction:z.enum(['horizontal','vertical','diagonal-down','diagonal-up'])}).strict()])
export function componentDecorationSchema(version){
 if(version!==undefined&&version!==1)throw Error('Unsupported component decoration version')
 return z.array(version===1?v1:legacy).max(64)
}
export function isOpaqueRectDecoration(d,version){
 return componentDecorationSchema(version).safeParse([d]).success&&d.shape==='rect'
}
const bounds=z.object({x:z.number().finite().min(0),y:z.number().finite().min(0),w:z.number().finite().positive(),h:z.number().finite().positive()}).strict().refine(r=>r.x+r.w<=1.000001&&r.y+r.h<=1.000001)
export function renderComponentDecorations(mapped,canvas,version){
 const inputs=mapped.map(({sourceRect,...d})=>d)
 const values=componentDecorationSchema(version).parse(inputs)
 if(!Number.isInteger(canvas?.width)||!Number.isInteger(canvas?.height)||canvas.width<240||canvas.height<240||canvas.width>7680||canvas.height>7680)throw Error('Invalid decoration canvas')
 return values.map((d,i)=>{
  const r=bounds.parse(mapped[i].sourceRect),x=r.x*canvas.width,y=r.y*canvas.height,w=r.w*canvas.width,h=r.h*canvas.height
  if(d.shape==='rect')return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${d.fill}"/>`
  if(d.shape==='diamond')return `<polygon points="${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}" fill="${d.fill}"/>`
  if(d.shape==='rounded-rect'){const radius=Math.min(w,h)*d.radiusRatio;return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="${d.fill}"/>`}
  if(d.shape==='ellipse')return `<ellipse cx="${x+w/2}" cy="${y+h/2}" rx="${w/2}" ry="${h/2}" fill="${d.fill}"/>`
  // Inset all endpoints by half the stroke. Butt caps keep the entire paint
  // envelope inside the observed bounds, including both diagonal directions.
  const width=Math.min(w,h)*d.strokeWidthRatio,inset=width/2
  let x1=x+inset,y1=y+inset,x2=x+w-inset,y2=y+h-inset
  if(d.direction==='horizontal')y1=y2=y+h/2
  if(d.direction==='vertical')x1=x2=x+w/2
  if(d.direction==='diagonal-up')[y1,y2]=[y2,y1]
  if(x1===x2&&y1===y2)throw Error('Degenerate decoration line endpoints')
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${d.stroke}" stroke-width="${width}" stroke-linecap="butt"/>`
 }).join('')
}
