import {sanitizePrototypeSvg} from './svg-prototype.mjs'
import {renderCompositionPage,assertCompositionCoverage,nativeFigures,RENDERER_V2} from './composition-render.mjs'
export const RENDERER_V3='pre-design-native-html-v3.0'
export const NATIVE_V3_CSS=`
.ln-native-v3{isolation:isolate}.ln-native-v3>.ln-native-prototype{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;z-index:0}.ln-native-v3>.ln-slot{z-index:1}
`
const invalid=(code,message)=>{throw Object.assign(new Error(code+': '+message),{code,statusCode:409})}
export function assertNativeContentFits(item,layout){
 const rules=layout.contentFitRules
 const figures=nativeFigures(item)
 const counts={maxTitleCharacters:Array.from(item.title??'').length,maxClaimCharacters:item.paragraphs.reduce((n,s)=>n+Array.from(s).length,0),maxBodyPoints:item.points.length,maxBodyCharacters:item.points.reduce((n,s)=>n+Array.from(s).length,0),maxImages:figures.length,maxTableRows:item.table?.rows.length??0,maxTableColumns:item.table?.columns.length??0}
 if(rules?.overflow!=='reject')invalid('CONTENT_FIT','overflow must reject')
 for(const [key,count]of Object.entries(counts))if(!Number.isInteger(rules[key])||rules[key]<0||count>rules[key])invalid('CONTENT_FIT',key+' capacity exceeded or invalid')
 return layout
}
export function renderNativeDesignPageV3(page,spec){
 if(spec?.renderer!==RENDERER_V3||spec.layout?.kind!=='composition')invalid('LAYOUT_RENDERER_INCOMPATIBLE','V3 composition required')
 const {layout}=spec,item=page.item,figures=nativeFigures(item)
 assertNativeContentFits(item,layout)
 assertCompositionCoverage(layout,item)
 for(const [index,figure]of figures.entries()){
  const legacy=page.nativeAssets?.image
  const asset=page.nativeAssets?.images?.find(a=>a.materialId===figure.materialId)??(index===0&&legacy&&(!legacy.materialId||legacy.materialId===figure.materialId)?legacy:undefined)
  if(!asset||!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(asset.dataUrl??''))invalid('NATIVE_ASSET_MISSING','authorized project image required')
 }
 const svg=sanitizePrototypeSvg(layout.prototypeSvg,{canvas:spec.canvas})
 // URI encoding prevents prototype markup from participating in the HTML DOM.
 const uri='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg).replace(/'/g,'%27')
 const html=renderCompositionPage(page,{...spec,renderer:RENDERER_V2})
 return html.replace('ln-composition workflow-visual-page','ln-composition ln-native-v3 workflow-visual-page')
  .replace('data-renderer="'+RENDERER_V2+'"','data-renderer="'+RENDERER_V3+'"')
  .replace(/^(<article[^>]*>)/,'$1<img class="ln-native-prototype" aria-hidden="true" alt="" src="'+uri+'">')
}
