import {componentDecorationSchema,renderComponentDecorations,isOpaqueRectDecoration} from './component-decorations.mjs'
import {proposeComponentSlots} from './reference-components.mjs'
import {compositionCanvasSchema,compositionStyleSchema,validateCompositionLayout} from './composition-contract.mjs'
import {nativeLayoutSchema} from './native-design-v3.mjs'
import {contrast} from './accessible-theme.mjs'
const fail=()=>{throw Object.assign(Error('组件样式、容量或可读空间不足，需明确适配。'),{code:'COMPONENT_ADAPTATION_REQUIRED'})}
/** Explicit author-chosen style adaptation. Never represents source font/color extraction. */
export function adaptObservedComponents({observation,allowedSources,canvas,theme,styles,id,label,archetypeId,maxTextCharacters,maxTitleCharacters=100,maxTableRows=0,maxTableColumns=0,adjustments={},decorations=[],componentStyles={},decorationVersion}){
 canvas=compositionCanvasSchema.parse(canvas)
 const proposal=proposeComponentSlots(observation,allowedSources,canvas)
 const decorationInputs=componentDecorationSchema(decorationVersion).parse(decorations)
 if(new Set(decorationInputs.map(d=>d.componentId)).size!==decorationInputs.length)fail()
 const mappedDecorations=decorationInputs.map(d=>{const c=observation.components.find(c=>c.id===d.componentId&&c.kind==='decoration');if(!c)fail();return {...d,sourceRect:{...c.rect}}})
 for(const key of Object.keys(componentStyles))if(!proposal.slots.some(s=>s.id===key))fail()
 const geometryAdjustments=[]
 for(const [key,a]of Object.entries(adjustments)){if(!proposal.slots.some(s=>s.id===key)||!a||!['readable-text-height','reusable-title-capacity','content-width'].includes(a.reason)||!a.rect||Object.keys(a).some(k=>!['rect','reason'].includes(k)))fail()}
 if(!['background','ink','accent','muted'].every(k=>/^#[0-9a-fA-F]{6}$/.test(theme?.[k]??'')))fail()
 const slots=proposal.slots.map(s=>{
  const key=s.role==='title'?'title':s.role==='text'?s.purpose:s.role
  if(!styles?.[key])fail()
  const style=compositionStyleSchema.parse({...styles[key],...(componentStyles[s.id]?compositionStyleSchema.parse(componentStyles[s.id]):{})}),slot={id:s.id,role:s.role,rect:{...(adjustments[s.id]?.rect??s.observedRect)},style,...(s.binding?{binding:s.binding,purpose:s.purpose}:{}),...(s.index!==undefined?{index:s.index}:{})}
  // Structured table cells otherwise inherit a transparent panel over SVG.
  if(s.role==='table'&&!style.background)style.background=theme.background
  // SVG paints in array order. The topmost opaque full rectangle hides all lower layers.
  // Partial or non-rect top coverage remains ambiguous and must fail explicitly.
  if(['title','text'].includes(s.role))for(const d of [...mappedDecorations].reverse()){
   const a=slot.rect,b=d.sourceRect,overlap=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>.000001&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>.000001
   if(!overlap)continue
   const contains=b.x<=a.x+.000001&&b.y<=a.y+.000001&&b.x+b.w+.000001>=a.x+a.w&&b.y+b.h+.000001>=a.y+a.h
   const {sourceRect:_,...shape}=d
   if(!contains||!isOpaqueRectDecoration(shape,decorationVersion))fail()
   if(style.background&&style.background.toLowerCase()!==d.fill.toLowerCase())fail()
   style.background=d.fill
   break
  }
  if(adjustments[s.id])geometryAdjustments.push({componentId:s.id,sourceRect:{...s.observedRect},derivedRect:{...slot.rect},reason:adjustments[s.id].reason})
  if(['title','text'].includes(s.role)){
   if(!Number.isFinite(style.fontSize)||!Number.isFinite(style.lineHeight))fail()
   const inset=2*((style.padding??0)+(style.borderWidth??0))
   if(slot.rect.h*canvas.height-inset+.01<style.fontSize*style.lineHeight)fail()
  }
  return slot
 })
 // A table is one editable structured-data slot, never an image or omitted text.
 const tableCount=slots.filter(s=>s.role==='table').length
 if(tableCount>1||!Number.isSafeInteger(maxTableRows)||!Number.isSafeInteger(maxTableColumns))fail()
 if(tableCount?(maxTableRows<1||maxTableRows>100||maxTableColumns<1||maxTableColumns>12):(maxTableRows!==0||maxTableColumns!==0))fail()
 if(!Number.isSafeInteger(maxTitleCharacters)||maxTitleCharacters<1||maxTitleCharacters>100)fail()
 const textCount=slots.filter(s=>s.role==='text').length
 if(!Number.isSafeInteger(maxTextCharacters)||maxTextCharacters<textCount||maxTextCharacters>50000)fail()
 const decorationSvg=renderComponentDecorations(mappedDecorations,canvas,decorationVersion)
 const layout=nativeLayoutSchema.parse({id,label,kind:'composition',archetypeId,slots,prototypeSvg:`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><rect x="0" y="0" width="${canvas.width}" height="${canvas.height}" fill="${theme.background}"/>${decorationSvg}</svg>`,contentFitRules:{overflow:'reject',maxTitleCharacters,maxClaimCharacters:0,maxBodyPoints:0,maxBodyCharacters:0,maxImages:slots.filter(s=>s.role==='image').length,maxTableRows,maxTableColumns,maxTextBlocks:textCount,maxTextCharacters}})
 validateCompositionLayout(layout,theme,contrast)
 return {layout,review:{...proposal.audit,complete:false,unmapped:proposal.audit.unmapped.filter(id=>!mappedDecorations.some(d=>d.componentId===id)),mappedDecorations,visualAcceptance:'pending',styleProvenance:'derived-adaptation',geometryAdjustments,source:{...proposal.source,sourceValueUnchanged:true},unrepresentedGroups:proposal.groups.map(g=>g.id),contentFitStatus:'requires-real-content-browser-test',editability:'slot-model-only',shareAllowed:false},proposal}
}
