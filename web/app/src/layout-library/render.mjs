// Pure, shared renderer: the same module is served to the Web UI and used on the server.
// Only validated declarative tokens/slots enter here. No package-supplied HTML/CSS/JS is executed.
import {RENDERER_V2,COMPOSITION_CSS,renderCompositionPage,assertCompositionCoverage} from './composition-render.mjs'
export {RENDERER_V2}
export const RENDERER='pre-design-native-html-v1.0'
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const color=v=>/^#[0-9a-f]{6}$/i.test(v)?v:'#24364c'
const size=(v,lo,hi)=>Math.min(hi,Math.max(lo,Number(v)||lo))
export const NATIVE_CSS=`
.layout-native-page{container-type:inline-size;position:relative!important;box-sizing:border-box;width:100%;aspect-ratio:16/9;display:block!important;padding:0!important;border:0!important;overflow:hidden!important;background:var(--ln-bg);color:var(--ln-ink);font-family:var(--ln-font)}
.layout-native-page *{box-sizing:border-box}.ln-slot{position:absolute;margin:0;overflow:hidden;overflow-wrap:anywhere}.ln-slot h2,.ln-slot p,.ln-slot ul{margin:0}.ln-slot h2{font:inherit;color:var(--ln-accent);line-height:1.2}.ln-title{font-weight:700}.ln-claim{font-weight:500}.ln-body{padding:0}.ln-body ul{padding-left:1.3em}.ln-body li{padding-bottom:.45em;break-inside:avoid}.ln-body[data-kind=columns] ul{columns:2;column-gap:2em}.ln-body[data-kind=focus]{border-left:.16em solid var(--ln-accent);padding-left:1em}.ln-source{color:var(--ln-muted);border-top:1px solid var(--ln-muted);padding-top:.3em;display:flex;justify-content:space-between;gap:1em;line-height:1.3}.ln-image{display:flex;flex-direction:column;gap:.3em}.ln-image img{width:100%;height:calc(100% - 1.7em);object-fit:contain;display:block}.ln-image figcaption{font-size:.75em;color:var(--ln-muted)}.ln-table table{border-collapse:collapse;table-layout:fixed;width:100%;line-height:1.35}.ln-table th,.ln-table td{padding:.35em .5em;text-align:left;vertical-align:top;border-bottom:1px solid var(--ln-muted);overflow-wrap:anywhere}.ln-table th{border-top:3px solid var(--ln-accent);font-weight:700;color:var(--ln-ink);background:transparent}.ln-missing{color:#9c2430;background:#fff1f2;padding:1em}
${COMPOSITION_CSS}
@media print{.layout-native-page{break-after:page;page-break-after:always;break-inside:avoid}}
`
export function renderNativePage(page,spec=page.nativeLayout){
 if(spec?.renderer===RENDERER_V2)return renderCompositionPage(page,spec)
 if(!spec||spec.renderer!==RENDERER)throw new Error('LAYOUT_RENDERER_INCOMPATIBLE')
 assertCompositionCoverage(spec.layout,page.item)
 const t=spec.theme,layout=spec.layout,item=page.item,W=1600
 const vars=`--ln-bg:${color(t.background)};--ln-ink:${color(t.ink)};--ln-accent:${color(t.accent)};--ln-muted:${color(t.muted)};--ln-font:${t.fontFamily==='serif'?'"Noto Serif CJK SC",SimSun,serif':'"Noto Sans CJK SC","Microsoft YaHei",sans-serif'}`
 const slots=layout.slots.map(s=>{
  const r=s.rect,fs=s.role==='title'?size(t.titleSize,32,90):s.role==='source'?size(t.captionSize,16,30):size(t.bodySize,22,44)
  const pos=`left:${size(r.x,0,1)*100}%;top:${size(r.y,0,1)*100}%;width:${size(r.w,0,1)*100}%;height:${size(r.h,0,1)*100}%;font-size:${fs/W*100}cqw;line-height:${size(t.lineHeight,1.2,1.9)}`
  let body=''
  if(s.role==='title')body=`<h2>${esc(item.title)}</h2>`
  if(s.role==='claim')body=item.paragraphs.map(p=>`<p>${esc(p)}</p>`).join('')
  if(s.role==='body')body=`<ul>${item.points.map(p=>`<li>${esc(p)}</li>`).join('')}</ul>`
  if(s.role==='source')body=`<span>${esc(page.chapterTitle)} · 资料 ${esc((item.evidenceIndexes??[]).map(i=>`[${i+1}]`).join(' '))}</span><span>${esc(page.number)}</span>`
  if(s.role==='table')body=item.table?`<table><thead><tr>${item.table.columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${item.table.rows.map(row=>`<tr>${row.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="ln-missing">缺少表格内容</div>'
  if(s.role==='image'){
   const figure=item.figures?.[0]??item.figure,legacy=page.nativeAssets?.image
   const img=page.nativeAssets?.images?.find(a=>a.materialId===figure?.materialId)??(legacy&&(!legacy.materialId||legacy.materialId===figure?.materialId)?legacy:undefined)
   body=img&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(img.dataUrl)?`<img src="${img.dataUrl}" alt="${esc(figure?.caption)}"><figcaption>${esc(figure?.caption)}</figcaption>`:'<div class="ln-missing">缺少已核对的项目图片</div>'
  }
  return `<div class="ln-slot ln-${s.role}" data-layout-slot="${esc(s.role)}" data-kind="${esc(layout.kind)}" style="${pos}">${body}</div>`
 }).join('')
 return `<article class="layout-native-page workflow-visual-page" data-native-page="${esc(page.id)}" data-visual-page="${esc(page.id)}" data-layout="${esc(layout.id)}" data-canvas-width="1600" data-canvas-height="900" style="${esc(vars)}">${slots}</article>`
}
export function renderNativeDocument(pages,{title='版式试排',sources=[],qaScript=''}={}){
 const canvases=pages.map(p=>({width:size(p.nativeLayout?.canvas?.width,240,7680),height:size(p.nativeLayout?.canvas?.height,240,7680)})),first=canvases[0]??{width:1600,height:900}
 const dimensions=[...new Map(canvases.map(c=>[`${c.width}x${c.height}`,c])).values()]
 const printPages=dimensions.map((c,i)=>`@page native${i}{size:${c.width/10}mm ${c.height/10}mm;margin:0}.layout-native-page[data-canvas-width="${c.width}"][data-canvas-height="${c.height}"]{page:native${i}}`).join('')
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${NATIVE_CSS}body{margin:0;padding:20px;background:#e8edf3}.native-deck{width:${first.width}px;margin:auto}.layout-native-page{margin-bottom:20px}.native-sources{background:#fff;color:#24364c;padding:36px;font:20px/1.6 sans-serif;overflow-wrap:anywhere}@page{size:${first.width/10}mm ${first.height/10}mm;margin:0}${printPages}@media print{body{padding:0;background:white}.native-deck{width:100%}.layout-native-page{margin:0}.native-sources{page-break-before:always}}</style></head><body><main class="native-deck" data-canvas-width="${first.width}" data-canvas-height="${first.height}">${pages.map(p=>renderNativePage(p)).join('')}</main>${sources.length?`<section class="native-sources"><h2>资料来源</h2><ol>${sources.map(s=>`<li>${esc(s.filename)} · ${esc(s.locator)}</li>`).join('')}</ol></section>`:''}${qaScript}</body></html>`
}
