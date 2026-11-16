// Browser-safe rendering of declarative V2 content. No resource text becomes markup or CSS.
export const RENDERER_V2='pre-design-native-html-v2.0'
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const color=value=>/^#[0-9a-f]{6}$/i.test(value)?value:'#24364c'
const number=(value,min,max,fallback=min)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback
const invalid=message=>Object.assign(new Error(message),{statusCode:409,code:'LAYOUT_INVALID'})
export function nativeFigures(item){
 if(item.figure!==undefined&&item.figures!==undefined)throw invalid('图片仅能使用 figure 或 figures，不能同时声明。')
 return item.figures??(item.figure?[item.figure]:[])
}
const roleNames={title:'标题',claim:'段落',body:'正文',image:'图片',table:'表格',chart:'图表',timeline:'时间轴',diagram:'关系图',source:'来源'}
// Shared by selection and rendering: a stale layout cannot silently lose later edits.
export function assertCompositionCoverage(layout,item){
 const figures=nativeFigures(item)
 if(layout.kind!=='composition'&&figures.length>1)throw invalid('当前版式不能覆盖多张图片，请选择 V2 组合版式。')
 const counts={title:item.title?.length?1:0,claim:item.paragraphs.length,body:item.points.length,image:figures.length,table:item.table?1:0,chart:item.chart?1:0,timeline:item.timeline?1:0,diagram:item.diagram?1:0,source:item.evidenceIndexes?.length?1:0}
 for(const [role,count]of Object.entries(counts)){
  const slots=layout.slots.filter(s=>s.role===role),seen=Array(count).fill(0)
  for(const slot of slots){
   if(!count&&slot.index===undefined&&!slot.range&&['claim','body','source'].includes(role))continue
   if(!count)throw invalid(`组合版式的${roleNames[role]}槽位没有对应内容。`)
   const start=slot.index??slot.range?.start??0,end=slot.index!==undefined?slot.index+1:slot.range?.end??count
   if(start>=count||end>count)throw invalid(`组合版式的${roleNames[role]}选择越界。`)
   for(let i=start;i<end;i++)seen[i]++
  }
  if(seen.some(n=>n===0))throw invalid(`组合版式未完整覆盖${roleNames[role]}，不能遗漏页面内容。`)
  if(seen.some(n=>n>1))throw invalid(`组合版式重复覆盖${roleNames[role]}，请明确分配各槽位。`)
 }
 return layout
}
const select=(values,slot)=>values.slice(slot.index??slot.range?.start??0,slot.index!==undefined?slot.index+1:slot.range?.end??values.length)
const dataImage=value=>/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value??'')
export const COMPOSITION_CSS=`
.ln-composition .ln-slot{display:flex;flex-direction:column}.ln-composition .ln-slot-content{flex:0 0 auto;min-width:0}.ln-composition .ln-title h2{color:inherit}.ln-composition .ln-claim p+p{margin-top:.35em}.ln-composition .ln-body li:last-child{padding-bottom:0}.ln-composition .ln-source .ln-slot-content{display:flex;justify-content:space-between;gap:1em}.ln-composition .ln-source{border:0;padding-top:0}.ln-composition .ln-image .ln-slot-content{height:100%}.ln-figure-grid{display:grid;grid-auto-rows:minmax(0,1fr);gap:.6em;height:100%;min-height:0}.ln-figure-grid figure{display:flex;flex-direction:column;margin:0;min-width:0;min-height:0;gap:.3em}.ln-figure-grid img{display:block;flex:1 1 auto;min-height:20%;height:0;width:100%;object-fit:contain}.ln-figure-grid figcaption{flex:0 0 auto;font-size:.75em;line-height:1.3;color:var(--ln-muted)}
.ln-chart-content h3,.ln-timeline-content h3,.ln-diagram-content h3{font-size:1em;margin:0 0 .4em}.ln-chart-content{font-size:1em}.ln-chart-unit{font-size:.85em;color:var(--ln-muted)}.ln-chart-data{border-collapse:collapse;width:100%;table-layout:fixed;font-size:.85em}.ln-chart-data th,.ln-chart-data td{text-align:left;vertical-align:top;overflow-wrap:anywhere;padding:.25em .35em;border-bottom:1px solid var(--ln-muted)}.ln-chart-data th{font-weight:600}.ln-chart-track{position:relative;height:.65em;background:color-mix(in srgb,var(--ln-muted) 12%,transparent);margin:.25em 0}.ln-chart-zero{position:absolute;top:-.1em;bottom:-.1em;border-left:1px solid var(--ln-ink)}.ln-chart-bar{position:absolute;top:0;height:100%;background:var(--ln-accent)}.ln-chart-line{display:block;width:100%;height:7em;overflow:visible}.ln-chart-line path,.ln-chart-line circle{stroke:var(--ln-accent)}.ln-chart-line circle{fill:var(--ln-bg)}
.ln-timeline-content{font-size:.85em}.ln-timeline-content ol{list-style:none;margin:0;padding:0 0 0 .8em}.ln-timeline-content li{position:relative;padding:0 0 .65em .8em;border-left:2px solid var(--ln-accent)}.ln-timeline-content li:before{content:'';position:absolute;left:-.24em;top:.35em;width:.4em;height:.4em;border-radius:50%;background:var(--ln-accent)}.ln-timeline-content li:last-child{padding-bottom:0}.ln-timeline-content p{margin-top:.15em;font-size:.9em}
.ln-composition .ln-diagram .ln-slot-content{height:100%}.ln-diagram-content{height:100%;display:flex;flex-direction:column;font-size:1em}.ln-diagram-canvas{position:relative;flex:1;min-height:4em}.ln-diagram-canvas svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;color:var(--ln-accent)}.ln-diagram-node{position:absolute;display:flex;align-items:center;justify-content:center;text-align:center;border:2px solid var(--ln-accent);background:var(--ln-bg);padding:.3em;overflow-wrap:anywhere;font-weight:500}.ln-diagram-edge-label{position:absolute;transform:translate(-50%,-50%);padding:0 .2em;background:var(--ln-bg);font-size:.8em;max-width:35%;text-align:center}
`

function imageContent(page,slot){
 const all=nativeFigures(page.item),chosen=select(all,slot)
 const columns=number(slot.style?.columns,1,3,chosen.length===1?1:Math.min(chosen.length,2))
 return `<div class="ln-figure-grid" style="grid-template-columns:repeat(${columns},minmax(0,1fr))">${chosen.map(figure=>{
  const index=all.indexOf(figure),legacy=page.nativeAssets?.image
  const asset=page.nativeAssets?.images?.find(a=>a.materialId===figure.materialId)??(index===0&&legacy&&(!legacy.materialId||legacy.materialId===figure.materialId)?legacy:undefined)
  return `<figure data-figure-index="${index}">${asset&&dataImage(asset.dataUrl)?`<img src="${asset.dataUrl}" alt="${esc(figure.caption)}" style="object-fit:${slot.style?.fit==='cover'?'cover':'contain'}">`:'<div class="ln-missing">缺少已核对的项目图片</div>'}<figcaption>${esc(figure.caption)}</figcaption></figure>`
 }).join('')}</div>`
}
function tableContent(table){return `<table><thead><tr>${table.columns.map(c=>`<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(row=>`<tr>${row.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`}
function chartContent(chart){
 const values=chart.series.flatMap(s=>s.values),low=Math.min(0,...values),high=Math.max(0,...values),span=high-low||1,zero=(0-low)/span*100
 const percent=value=>(value-low)/span*100
 const title=chart.title?`<h3>${esc(chart.title)}</h3>`:''
 const line=chart.type==='line'?`<svg class="ln-chart-line" viewBox="0 0 1000 360" preserveAspectRatio="none" role="img" aria-label="${esc(chart.title??'折线图')}"><line x1="20" x2="980" y1="${330-zero*3}" y2="${330-zero*3}" stroke="currentColor" stroke-width="1"/>${chart.series.map((series,index)=>{
  const xy=series.values.map((value,i)=>[20+i/(chart.categories.length-1)*960,330-percent(value)*3])
  return `<g data-chart-series="${index}"><title>${esc(series.name)}</title><path d="${xy.map(([x,y],i)=>`${i?'L':'M'}${x},${y}`).join(' ')}" fill="none" stroke-width="4" stroke-dasharray="${['none','12 5','3 5','12 4 3 4'][index]}"/>${xy.map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="6" stroke-width="3"><title>${esc(chart.categories[i])}：${esc(series.values[i])}</title></circle>`).join('')}</g>`
 }).join('')}</svg>`:''
 return `<div class="ln-chart-content" data-chart-type="${chart.type==='line'?'line':'bar'}">${title}${chart.unit?`<p class="ln-chart-unit">单位：${esc(chart.unit)}</p>`:''}${line}<table class="ln-chart-data"><thead><tr><th scope="col">分类</th>${chart.series.map(s=>`<th scope="col">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${chart.categories.map((category,i)=>`<tr><th scope="row">${esc(category)}</th>${chart.series.map((series,j)=>{
  const value=series.values[i],position=percent(value)
  return `<td data-chart-series="${j}"><span>${esc(value)}</span>${chart.type==='bar'?`<div class="ln-chart-track" aria-hidden="true"><span class="ln-chart-zero" style="left:${zero}%"></span><span class="ln-chart-bar" style="left:${Math.min(zero,position)}%;width:${Math.abs(position-zero)}%"></span></div>`:''}</td>`
 }).join('')}</tr>`).join('')}</tbody></table></div>`
}
function timelineContent(timeline){return `<section class="ln-timeline-content">${timeline.title?`<h3>${esc(timeline.title)}</h3>`:''}<ol>${timeline.events.map((event,i)=>`<li data-timeline-event="${i}"><strong>${esc(event.label)}</strong>${event.description?`<p>${esc(event.description)}</p>`:''}</li>`).join('')}</ol></section>`}
function diagramContent(diagram){
 const vertical=diagram.direction==='vertical',n=diagram.nodes.length,columns=vertical?Math.ceil(n/4):Math.min(4,n),rows=Math.ceil(n/columns)
 const width=Math.min(26,80/columns),height=Math.min(38,75/rows)
 const positions=new Map(diagram.nodes.map((node,i)=>[node.id,{x:(i%columns+.5)/columns*100,y:(Math.floor(i/columns)+.5)/rows*100}]))
 const edges=diagram.edges.map(edge=>{
  const a=positions.get(edge.from),b=positions.get(edge.to)
  if(!a||!b)return ''
  const dx=b.x-a.x,dy=b.y-a.y,scale=Math.max(Math.abs(dx)/(width/2),Math.abs(dy)/(height/2)),ratio=scale>0?1/scale:0
  const end={x:b.x-dx*ratio,y:b.y-dy*ratio},angle=Math.atan2(dy,dx),arrow=1.8
  const left={x:end.x-arrow*Math.cos(angle-.5),y:end.y-arrow*Math.sin(angle-.5)},right={x:end.x-arrow*Math.cos(angle+.5),y:end.y-arrow*Math.sin(angle+.5)}
  return `<g data-diagram-edge="${esc(edge.from+':'+edge.to)}"><title>${esc(edge.label??'连接')}</title><path d="M${a.x},${a.y} L${end.x},${end.y} M${left.x},${left.y} L${end.x},${end.y} L${right.x},${right.y}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></g>`
 }).join('')
 return `<section class="ln-diagram-content">${diagram.title?`<h3>${esc(diagram.title)}</h3>`:''}<div class="ln-diagram-canvas"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="${esc(diagram.title??'关系图')}">${edges}</svg>${diagram.nodes.map(node=>{const p=positions.get(node.id);return `<div class="ln-diagram-node" data-diagram-node="${esc(node.id)}" style="left:${p.x-width/2}%;top:${p.y-height/2}%;width:${width}%;min-height:${height}%">${esc(node.label)}</div>`}).join('')}${diagram.edges.filter(e=>e.label).map(edge=>{const a=positions.get(edge.from),b=positions.get(edge.to);return a&&b?`<span class="ln-diagram-edge-label" style="left:${(a.x+b.x)/2}%;top:${(a.y+b.y)/2}%">${esc(edge.label)}</span>`:''}).join('')}</div></section>`
}
export function renderCompositionPage(page,spec){
 if(spec?.renderer!==RENDERER_V2||spec.layout?.kind!=='composition')throw new Error('LAYOUT_RENDERER_INCOMPATIBLE')
 assertCompositionCoverage(spec.layout,page.item)
 const {theme:t,layout}=spec,item=page.item,W=number(spec.canvas.width,240,7680,1600),H=number(spec.canvas.height,240,7680,900)
 const vars=`--ln-bg:${color(t.background)};--ln-ink:${color(t.ink)};--ln-accent:${color(t.accent)};--ln-muted:${color(t.muted)};--ln-font:${t.fontFamily==='serif'?'"Noto Serif CJK SC",SimSun,serif':'"Noto Sans CJK SC","Microsoft YaHei",sans-serif'};aspect-ratio:${W}/${H}`
 const slots=layout.slots.map(slot=>{
  const r=slot.rect,s=slot.style??{},defaultSize=slot.role==='title'?t.titleSize:slot.role==='source'?t.captionSize:t.bodySize,fs=number(s.fontSize??defaultSize,16,96)
  const foreground=s.color??(slot.role==='title'?t.accent:slot.role==='source'?t.muted:t.ink)
  const pos=`left:${number(r.x,0,1)*100}%;top:${number(r.y,0,1)*100}%;width:${number(r.w,0,1)*100}%;height:${number(r.h,0,1)*100}%;font-size:${fs/W*100}cqw;line-height:${number(t.lineHeight,1.2,1.9)};z-index:${number(slot.layer,0,20)};color:${color(foreground)};text-align:${['left','center','right'].includes(s.align)?s.align:'left'};justify-content:${s.verticalAlign==='middle'?'center':s.verticalAlign==='bottom'?'flex-end':'flex-start'}${s.fontWeight?`;font-weight:${number(s.fontWeight,400,700)}`:''}${s.background?`;background:${color(s.background)}`:''}${s.borderWidth?`;border:${number(s.borderWidth,0,6)/W*100}cqw solid ${color(s.borderColor??t.muted)}`:''}${s.padding?`;padding:${number(s.padding,0,40)/W*100}cqw`:''}`
  let content=''
  if(slot.role==='title')content=`<h2>${esc(item.title)}</h2>`
  if(slot.role==='claim')content=select(item.paragraphs,slot).map(text=>`<p>${esc(text)}</p>`).join('')
  if(slot.role==='body')content=`<ul${s.columns?` style="columns:${number(s.columns,1,3)};column-gap:1.2em"`:''}>${select(item.points,slot).map(text=>`<li>${esc(text)}</li>`).join('')}</ul>`
  if(slot.role==='image')content=imageContent(page,slot)
  if(slot.role==='table')content=item.table?tableContent(item.table):'<div class="ln-missing">缺少表格内容</div>'
  if(slot.role==='chart')content=item.chart?chartContent(item.chart):'<div class="ln-missing">缺少图表内容</div>'
  if(slot.role==='timeline')content=item.timeline?timelineContent(item.timeline):'<div class="ln-missing">缺少时间轴内容</div>'
  if(slot.role==='diagram')content=item.diagram?diagramContent(item.diagram):'<div class="ln-missing">缺少关系图内容</div>'
  if(slot.role==='source')content=`<span>${esc(page.chapterTitle)}${item.evidenceIndexes?.length?' · 资料 '+esc(item.evidenceIndexes.map(i=>`[${i+1}]`).join(' ')):''}</span><span>${esc(page.number)}</span>`
  return `<div class="ln-slot ln-${esc(slot.role)}" data-layout-slot="${esc(slot.role)}" data-layout-slot-id="${esc(slot.id)}" data-kind="composition" style="${pos}"><div class="ln-slot-content">${content}</div></div>`
 }).join('')
 return `<article class="layout-native-page ln-composition workflow-visual-page" data-native-page="${esc(page.id)}" data-visual-page="${esc(page.id)}" data-layout="${esc(layout.id)}" data-renderer="${RENDERER_V2}" data-canvas-width="${W}" data-canvas-height="${H}" style="${esc(vars)}">${slots}</article>`
}
