import {compositionCanvasSchema,compositionStyleSchema} from './composition-contract.mjs'
const fail=()=>{throw Object.assign(Error('标题可复用空间不足或几何无效，需要明确调整。'),{code:'TITLE_REUSE_REQUIRED'})}
const rect=r=>{if(!r||!['x','y','w','h'].every(k=>Number.isFinite(r[k]))||r.x<0||r.y<0||r.w<=0||r.h<=0||r.x+r.w>1.000001||r.y+r.h>1.000001)fail();return r}
/** Explicit derived variant only. Does not change font size, content or source observations. */
export function deriveTitleReuse({observation,input,canvas,rightMargin=.04}){
 canvas=compositionCanvasSchema.parse(canvas)
 if(!Number.isFinite(rightMargin)||rightMargin<0||rightMargin>.3)fail()
 const titles=observation.components.filter(c=>c.kind==='text'&&c.purpose==='title');if(titles.length!==1)fail()
 const title=titles[0],original=rect(title.rect),current=rect(input.adjustments[title.id]?.rect??original)
 const style=compositionStyleSchema.parse({...input.styles.title,...input.componentStyles[title.id]})
 if(!Number.isFinite(style.fontSize)||!Number.isFinite(style.lineHeight)||style.fontSize<=0||style.lineHeight<=0)fail()
 let right=1-rightMargin
 for(const c of observation.components){
  if(c.id===title.id||['group','decoration'].includes(c.kind))continue
  const b=rect(input.adjustments[c.id]?.rect??c.rect)
  if(Math.min(current.y+current.h,b.y+b.h)-Math.max(current.y,b.y)<=.000001)continue
  if(b.x+b.w<=current.x)continue
  right=Math.min(right,b.x-.01)
 }
 if(right<current.x+current.w-.000001)fail()
 const derived={...current,w:right-current.x},inset=2*((style.padding??0)+(style.borderWidth??0))
 const columns=Math.floor((derived.w*canvas.width-inset)/(style.fontSize*1.1+Math.max(0,style.letterSpacing??0))),lines=Math.floor((derived.h*canvas.height-inset)/(style.fontSize*style.lineHeight))
 const maxTitleCharacters=Math.min(100,columns*lines);if(maxTitleCharacters<1)fail()
 return {adjustments:{...structuredClone(input.adjustments),[title.id]:{rect:derived,reason:'content-width'}},maxTitleCharacters,review:{componentId:title.id,sourceRect:{...original},previousDerivedRect:{...current},derivedRect:derived,reason:'expand-into-unoccupied-title-band',capacityKind:'conservative-cjk-estimate',maxTitleCharacters,fontSizeUnchanged:true,contentUnchanged:true,visualAcceptance:'pending'}}
}
