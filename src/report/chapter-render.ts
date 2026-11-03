import type { ChapterDraftRecord } from './chapter-plan.ts'
import { displayedImageRect, captionAnchor, type ImageRectangle, type CaptionAlignment } from './caption-alignment.ts'
import { REPORT_DESIGN_RULES } from './design-rules.ts'
import { sha256CanonicalJson as hash } from '../presentation/canonical-json.ts'
import type { CompiledChapterOverlay, CompiledProtectedArea } from './chapter-visual-policy.ts'
import { chapterProfile, chapterProjectTitle } from './chapter-profile.ts'
import { chapterGraphicSvg,renderChapterAnnotations,type ChapterGraphic,type ChapterAnnotations } from './chapter-graphics.ts'
export const CHAPTER_RENDER_VERSION='chapter-project-context-20261103.1'
export const CHAPTER_PROCESS_LANGUAGE=/(会议纪要|具名对象|来源所载|供讨论|来源显示|待核|待确认|需人工确认)/

export interface ChapterRenderAsset {
  readonly id: string; readonly dataUrl: string; readonly width: number; readonly height: number
  readonly label: string; readonly sourceNote: string
}
export type ChapterRenderElement =
  | { readonly type: 'figure'; readonly assetId: string; readonly rect: ImageRectangle; readonly fit?: 'contain' | 'cover'; readonly align?: CaptionAlignment; readonly caption?: string; readonly captionOverlay?:CompiledChapterOverlay;readonly annotations?:ChapterAnnotations }
  | { readonly type: 'body'; readonly index: number; readonly rect: ImageRectangle; readonly fontSize?: number }
  | { readonly type: 'table'; readonly rect: ImageRectangle; readonly fontSize?: number; readonly columnWidths?:readonly number[] }
  | { readonly type: 'label'; readonly text: string; readonly rect: ImageRectangle; readonly fontSize?: number }
  | { readonly type: 'sequence'; readonly rect:ImageRectangle; readonly label:string; readonly nodes:readonly {title:string;detail:string}[] }
  | ({readonly type:'graphic'} & ChapterGraphic)
export interface ChapterPageLayout { readonly pageId: string; readonly name: string; readonly tableNoteColumns?: readonly number[]; readonly elements: readonly ChapterRenderElement[]; readonly titleOverlay?:CompiledChapterOverlay; readonly protectedAreas?:readonly CompiledProtectedArea[]; readonly heading?:{title:ImageRectangle;claim:ImageRectangle} }
const esc = (s: string) => s.replace(/[&<>"']/g, v => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[v]!))
const box = (r: ImageRectangle) => `left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;`

/** Project native caption clauses into the public slide and its shared notes.
 * Never turn a reference photograph into an apparent site photograph. */
export function projectChapterCaption(original: string): { caption: string; note?: string } {
  const clauses=original.split(/[，,；;]/u).map(s=>s.trim()).filter(Boolean)
  const publicClauses=clauses.filter(s=>!CHAPTER_PROCESS_LANGUAGE.test(s))
  const hasReferenceLabel=publicClauses.some(s=>!/^(?:非|并非|不是).{0,30}现场/.test(s)&&/(参考|案例|示意)/.test(s))
  const visible=publicClauses.filter(s=>!(hasReferenceLabel&&/^(?:非|并非|不是).{0,30}现场[。.]?$/.test(s)))
  // An entirely internal caption must fail public-copy QA, not disappear silently.
  if(!visible.length||visible.length===clauses.length)return {caption:original}
  return {caption:visible.join('，'),note:`原生图注：${original}`}
}

export function formatChapterSources(refs: readonly string[]): string {
  const pages = refs.filter(ref => /^H-P\d+$/.test(ref)).map(ref => ref.slice(3))
  const labels: Record<string, string> = { F: '现场照片', M: '点位图', T: '地形预览' }
  return [...(pages.length ? [`参考稿 P${pages.join('、')}`] : []), ...refs.filter(ref => !/^H-P\d+$/.test(ref)).map(ref => labels[ref] ?? ref)].join(' / ')
}

/** One note list is shared by the HTML dialog, PDF annotations and sidecar. */
export function collectChapterNotes(draft: ChapterDraftRecord, layouts: readonly ChapterPageLayout[], assets: readonly ChapterRenderAsset[]) {
  return draft.chapter.pages.map((p, i) => {
    const layout = layouts[i]!
    const columns = layout.tableNoteColumns ?? []
    if (columns.some(col => !Number.isInteger(col) || col < 0 || !p.table || col >= p.table.columns.length)) throw new Error(`CHAPTER_RENDER_NOTE_COLUMN_INVALID: ${p.id}`)
    const notes = [
      ...p.notes,
      ...columns.flatMap(col => p.table!.rows.map(row => `${row[0]} · ${p.table!.columns[col]}：${row[col]}`)),
      `正文依据：${formatChapterSources(p.sourceRefs)}（原始索引：${p.sourceRefs.join(' / ')}）`,
      `图意：${p.visual.caption}`,
      ...layout.elements.filter(e => e.type === 'figure').flatMap(e => {
        const asset = assets.find(a => a.id === e.assetId)
        if (!asset) throw new Error(`CHAPTER_RENDER_IMAGE_MISSING: ${e.assetId}`)
        const {note}=projectChapterCaption(e.caption??asset.label)
        return [`图像：${asset.label}。${asset.sourceNote}`,...(note?[note]:[]),...(e.annotations?[`图上分析依据：${e.annotations.sourceRefs.join(' / ')}`,...e.annotations.notes]:[])]
      }),
      ...layout.elements.filter(e=>e.type==='graphic').flatMap(e=>[`关系图：${e.label}；依据：${e.sourceRefs.join(' / ')}`,...e.notes]),
      ...layout.elements.filter(e=>e.type==='label').map(e=>`原生图表性质标识：${e.text}`),
    ]
    return { pageId: p.id, title: p.title, notes }
  })
}

/** A chapter renderer consumes the saved native copy verbatim. Layout metadata
 * can position it but has no override for titles, claims, bodies or tables. */
export function renderChapterHtml(draft: ChapterDraftRecord, layouts: readonly ChapterPageLayout[], assets: readonly ChapterRenderAsset[]): string {
  const profile=chapterProfile(draft.chapterId??draft.chapter.id??'opportunity')
  if (draft.rulesVersion !== REPORT_DESIGN_RULES.version) throw new Error('CHAPTER_RENDER_RULES_MISMATCH')
  if (layouts.length !== draft.chapter.pages.length || layouts.some((l, i) => l.pageId !== draft.chapter.pages[i]?.id)) throw new Error('CHAPTER_RENDER_PAGES_MISMATCH')
  const byId = new Map(assets.map(a => [a.id, a]))
  const notePages = collectChapterNotes(draft, layouts, assets)
  const pages = draft.chapter.pages.map((p, i) => {
    const layout = layouts[i]!, bodyIndices = layout.elements.filter(e => e.type === 'body').map(e => e.index)
    if (bodyIndices.length !== p.body.length || p.body.some((_, n) => bodyIndices.filter(i => i === n).length !== 1)) throw new Error(`CHAPTER_RENDER_BODY_MISSING: ${p.id}`)
    if (!!p.table !== layout.elements.some(e => e.type === 'table')) throw new Error(`CHAPTER_RENDER_TABLE_MISSING: ${p.id}`)
    const elements = layout.elements.map((e, n) => {
      if(e.type==='graphic')return `<div class="native-graphic block" style="${box(e.rect)}"><div class="graphic-label">${esc(e.label)}</div>${chapterGraphicSvg(e,p.id+'-'+n)}</div>`
      if (e.type === 'body') return `<div class="body copy block" data-copy="body:${e.index}" style="${box(e.rect)}font-size:${Math.max(24, e.fontSize ?? 26)}px"><span class="point-number">${String(e.index + 1).padStart(2, '0')}</span><p>${esc(p.body[e.index]!)}</p></div>`
      if (e.type === 'label') return `<div class="label block" style="${box(e.rect)}font-size:${Math.max(16, e.fontSize ?? 24)}px">${esc(e.text)}</div>`
      if (e.type === 'sequence') return `<div class="sequence block" style="${box(e.rect)}"><div class="sequence-label">${esc(e.label)}</div><ol>${e.nodes.map((node,i)=>`<li><div class="sequence-node-title"><span>${String(i+1).padStart(2,'0')}</span>${esc(node.title)}</div><p class="sequence-node-detail">${esc(node.detail)}</p></li>`).join('')}</ol></div>`
      if (e.type === 'table') {
        const widths=e.columnWidths?.filter((_,n)=>!layout.tableNoteColumns?.includes(n)),sum=widths?.reduce((a,b)=>a+b,0)??1
        const colgroup=widths?`<colgroup>${widths.map(w=>`<col style="width:${Number((w/sum*100).toFixed(6))}%">`).join('')}</colgroup>`:''
        return `<div class="table-wrap block" style="${box(e.rect)}"><table data-copy="table" style="font-size:${Math.max(24, e.fontSize ?? 24)}px">${colgroup}<thead><tr>${p.table!.columns.filter((_,n)=>!layout.tableNoteColumns?.includes(n)).map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${p.table!.rows.map(r => `<tr>${r.filter((_,n)=>!layout.tableNoteColumns?.includes(n)).map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      }
      const a = byId.get(e.assetId)
      if (!a || !a.dataUrl.startsWith('data:image/')) throw new Error(`CHAPTER_RENDER_IMAGE_MISSING: ${e.assetId}`)
      const r = displayedImageRect(e.rect, a.width, a.height, e.fit ?? 'cover'), overlay=e.captionOverlay, align = overlay?.align ?? (layout.name === 'hero-left' ? 'center' : e.align ?? 'left')
      const figureId = `${p.id}-figure-${n}`, anchor = captionAnchor(r, align)
      const {caption} = projectChapterCaption(e.caption ?? a.label)
      const captionStyle=(overlay?`${box(overlay.rect)}top:${overlay.rect.y}px!important;--overlay-top:${overlay.rect.y}px;text-align:${align}!important;`: `left:${r.x}px;top:${layout.name === 'hero-left' ? 863 : r.y + r.height + 10}px;width:${r.width}px;`)+(layout.heading?'font-size:20px;':'')
      const protectedAreas=JSON.stringify((layout.protectedAreas??[]).filter(p=>p.figureElement===n).map(p=>p.rect))
      return `<figure id="${figureId}" class="block" data-asset-id="${esc(a.id)}" data-protected-areas="${esc(protectedAreas)}" style="${box(r)}"><img src="${a.dataUrl}" alt="${esc(a.label)}" style="object-fit:${e.fit ?? 'cover'}" width="${a.width}" height="${a.height}">${e.annotations?renderChapterAnnotations(e.annotations,r):''}</figure><figcaption class="caption block${overlay?' image-overlay tone-'+overlay.tone:''}" ${overlay?`data-overlay-for="${figureId}"`:''} data-figure-id="${figureId}" data-align="${align}" data-anchor="${anchor}" style="${captionStyle}text-align:${align}"><span>${esc(caption)}</span></figcaption>`
    }).join('')
    const titleOverlay=layout.titleOverlay,titleAttributes=titleOverlay?`data-overlay-for="${p.id}-figure-${titleOverlay.figureElement}" style="${box(titleOverlay.rect)}--overlay-top:${titleOverlay.rect.y}px;text-align:${titleOverlay.align}"`:layout.heading?`style="${box(layout.heading.title)}right:auto"`:''
    const claimAttributes=layout.heading?`style="${box(layout.heading.claim)}right:auto"`:''
    return `<section class="report-page" id="${p.id}" data-index="${i}" data-layout="${esc(layout.name)}" style="--hero-width:${layout.elements.find(e => e.type === 'figure')?.rect.width ?? 1040}px"><div class="eyebrow">${esc(chapterProjectTitle(draft.projectName))} · 前期策划 <span>${profile.code} / ${esc(profile.title)}</span></div><div class="title-row${titleOverlay?' image-overlay tone-'+titleOverlay.tone:''}" ${titleAttributes}><span class="folio">${profile.number}.${String(i + 1).padStart(2, '0')}</span><h1 data-copy="title">${esc(p.title)}</h1></div><p class="claim copy" data-copy="claim" ${claimAttributes}>${esc(p.claim)}</p>${elements}<footer><span>PROJECT PLANNING · ${profile.english}</span><span>${esc(draft.chapter.title)}</span><span>${String(i + 1).padStart(2, '0')} / ${draft.chapter.pages.length}</span></footer></section>`
  }).join('')
  const notes = notePages.map((p, i) => `<article id="note-${p.pageId}"><h2>${profile.number}.${String(i + 1).padStart(2, '0')} ${esc(p.title)}</h2>${p.notes.map(n => `<p>${esc(n)}</p>`).join('')}</article>`).join('')
  const options = draft.chapter.pages.map((p, i) => `<option value="${i}">${profile.number}.${String(i + 1).padStart(2, '0')} ${esc(p.title)}</option>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="chapter-manuscript-hash" content="${hash(draft.chapter)}"><meta name="chapter-plan-hash" content="${draft.planHash}"><title>${esc(chapterProjectTitle(draft.projectName))}｜${profile.ordinal} ${esc(profile.title)}</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#182923;color:#1e302a;font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif}button,select{font:inherit}#deck{position:relative;margin:auto;overflow:hidden}.report-page{position:relative;display:none;width:1600px;height:900px;background:#f8f7f2;overflow:hidden;transform-origin:0 0}.report-page.active{display:block}.eyebrow{position:absolute;left:56px;right:56px;top:27px;font-size:18px;letter-spacing:2px;color:#65776b;display:flex;justify-content:space-between}.title-row{position:absolute;left:56px;top:68px;right:56px;display:flex;align-items:baseline;gap:24px}.folio{font-size:40px;font-weight:700;color:#ad894b;line-height:1.35}h1{font-size:40px;line-height:1.5;letter-spacing:-.5px;margin:0;font-weight:700}.claim{position:absolute;left:56px;right:56px;top:129px;font-size:25px;line-height:1.55;margin:0;color:#43584e}.block{position:absolute}figure{margin:0;overflow:hidden;background:#e6e8de}figure img{width:100%;height:100%;display:block}.caption{font-size:16px;line-height:1.45;color:#5d7065;margin:0}.body{line-height:1.6;display:flex;gap:14px;align-items:flex-start}.body p{margin:0;flex:1}.point-number{font-size:18px;color:#9c7b42;line-height:2.3;border-top:2px solid #ad894b;padding-top:5px;min-width:25px}.label{color:#275647;line-height:1.4;font-weight:700}.table-wrap{overflow:visible}table{width:100%;border-collapse:collapse;table-layout:fixed;line-height:1.45}th,td{text-align:left;vertical-align:top;padding:15px 16px;border-bottom:1px solid #d4d9cf;overflow-wrap:anywhere}th{text-wrap:balance;background:#2a5546;color:#fff;font-weight:500}td:first-child{font-weight:700;color:#285342}tbody tr:nth-child(even){background:#edf0e8}footer{position:absolute;left:56px;right:56px;bottom:22px;height:28px;border-top:1px solid #d1d8ca;display:flex;justify-content:space-between;align-items:flex-end;font-size:16px;color:#667b6d;gap:24px}footer>span:first-child{font-size:16px;letter-spacing:.7px}.source-line{font-size:16px;color:#738175}#controls{height:54px;display:flex;align-items:center;justify-content:center;gap:12px;color:#e7eee8}button,select{color:inherit;background:#2a4037;border:1px solid #6c8075;border-radius:4px;padding:7px 13px}select{max-width:650px}button{cursor:pointer}button:hover{background:#425c4e}#counter{min-width:64px;text-align:center}dialog{border:0;padding:0;background:#f8f7f2;color:#233b2e;width:min(1000px,93vw);height:85vh;line-height:1.8}dialog::backdrop{background:#0009}dialog header{position:sticky;top:0;background:#e6ecdf;padding:12px 28px;display:flex;justify-content:space-between;align-items:center}dialog article{padding:20px 36px;border-bottom:1px solid #cad4c4}dialog h2{font-size:23px}.note-source{font-size:15px;color:#60725f}.contact-mode #deck{height:auto!important;width:100%!important;overflow:visible}.contact-mode .report-page{display:block;margin-bottom:20px;transform:scale(.5);margin-left:auto;margin-right:auto}.contact-mode #controls{position:fixed;bottom:0;z-index:99;background:#182923;width:100%}
.report-page[data-layout="hero-left"] .eyebrow,.report-page[data-layout="hero-left"] .title-row,.report-page[data-layout="hero-left"] .claim,.report-page[data-layout="hero-left"] footer{left:calc(var(--hero-width) + 48px);right:48px}.report-page[data-layout="hero-left"] .eyebrow span{display:none}.report-page[data-layout="hero-left"] .title-row{top:80px;display:block}.report-page[data-layout="hero-left"] .title-row .folio{display:inline;margin-right:16px}.report-page[data-layout="hero-left"] .title-row h1{display:inline}.report-page[data-layout="hero-left"] .claim{top:290px;font-size:24px}.report-page[data-layout="hero-left"] .caption{background:#f8f7f2e8;line-height:37px;top:863px!important;color:#1e302a;text-align:center!important}.report-page[data-layout="hero-left"] footer>span:first-child{display:none}@media screen and (max-width:600px){#controls{height:auto;min-height:70px;flex-wrap:wrap;padding:8px;gap:6px}#page-select{width:200px;max-width:52vw}#fullscreen{display:none}#controls button{padding:6px 9px;font-size:13px}#counter{font-size:13px;min-width:45px}}@page{size:1600px 900px;margin:0}@media print{html,body{background:#fff}#deck{width:1600px!important;height:auto!important;overflow:visible}.report-page{display:block!important;transform:none!important;break-after:page;page-break-after:always;margin:0}.report-page:last-child{break-after:auto;page-break-after:auto}#controls,dialog{display:none!important}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.report-page .image-overlay{position:absolute;z-index:3;background:transparent!important;top:var(--overlay-top)!important;right:auto!important;line-height:1.45!important}.report-page .image-overlay.tone-light{color:#fff!important;text-shadow:0 2px 5px #000c}.report-page .image-overlay.tone-dark{color:#182c25!important;text-shadow:0 1px 4px #fffc}.image-overlay .folio{color:inherit}.report-page .image-overlay.caption{line-height:1.6!important}.image-overlay.caption span{display:inline;padding:0}.image-overlay.title-row{display:block}.image-overlay.title-row h1{display:inline}.image-overlay.title-row .folio{display:inline;margin-right:16px}.report-page[data-layout="hero-left"]:has(.title-row.image-overlay) .claim{top:115px;font-size:26px}.report-page[data-layout="hero-left"]:has(.title-row.image-overlay) .body{transform:translateY(-95px)}
.report-page[data-layout="composed"] .body p{text-wrap:pretty}.report-page[data-layout="composed"] .title-row{display:block}.report-page[data-layout="composed"] .title-row h1{display:inline}.report-page[data-layout="composed"] .title-row .folio{margin-right:20px}.sequence-label{font-size:20px;letter-spacing:1px;color:#65776b;line-height:1.4}.sequence ol{list-style:none;display:flex;gap:38px;padding:18px 0 0;margin:0}.sequence li{flex:1;min-width:0;border-top:3px solid #ad894b;padding-top:15px;position:relative}.sequence li:not(:last-child):after{content:'→';position:absolute;right:-29px;top:16px;color:#ad894b;font-size:25px}.sequence-node-title{font-size:26px;line-height:1.4;font-weight:700;color:#244d40;white-space:nowrap}.sequence-node-title span{font-size:19px;color:#ad894b;margin-right:12px}.sequence-node-detail{font-size:20px;line-height:1.5;margin:8px 0 0;color:#43584e}
.native-graphic .graphic-label{height:36px;font-size:22px;line-height:30px;color:#43584e}.native-graphic .native-graph{display:block;width:100%;height:calc(100% - 36px)}.map-annotations{position:absolute;inset:0;pointer-events:none;font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif}
</style></head><body><main id="deck">${pages}</main><nav id="controls" aria-label="汇报翻页"><button id="previous-page" title="上一页">←</button><select id="page-select" aria-label="页码">${options}</select><span id="counter"></span><button id="next-page" title="下一页">→</button><button id="notes-button">本页备注</button><button id="fullscreen">全屏汇报</button></nav><dialog id="notes"><header><strong>来源、说明与人工确认事项</strong><button id="close-notes">关闭</button></header>${notes}</dialog><script>
const pages=[...document.querySelectorAll('.report-page')],deck=document.querySelector('#deck'),select=document.querySelector('#page-select');let current=0;function alignGraphicLabels(page){if(!page)return;for(const t of page.querySelectorAll('[data-map-align]')){const svg=t.closest('svg'),sr=svg.getBoundingClientRect(),r=t.getBoundingClientRect();if(!sr.width||!r.width)continue;const a=t.dataset.mapAlign,delta=a==='left'?sr.left-r.left:a==='right'?sr.right-r.right:(sr.left+sr.right-r.left-r.right)/2;t.setAttribute('x',String(Number(t.getAttribute('x'))+delta*svg.viewBox.baseVal.width/sr.width))}}function size(){const s=Math.min(innerWidth/1600,(innerHeight-54)/900);deck.style.width=1600*s+'px';deck.style.height=900*s+'px';pages.forEach(p=>p.style.transform='scale('+s+')');alignGraphicLabels(pages[current])}function show(n){current=Math.min(pages.length-1,Math.max(0,n));pages.forEach((p,i)=>p.classList.toggle('active',i===current));alignGraphicLabels(pages[current]);select.value=current;document.querySelector('#counter').textContent=(current+1)+' / '+pages.length;history.replaceState(null,'','#'+pages[current].id)}document.querySelector('#previous-page').onclick=()=>show(current-1);document.querySelector('#next-page').onclick=()=>show(current+1);select.onchange=()=>show(Number(select.value));document.querySelector('#notes-button').onclick=()=>{document.querySelector('#notes').showModal();document.querySelector('#note-'+pages[current].id).scrollIntoView()};document.querySelector('#close-notes').onclick=()=>document.querySelector('#notes').close();document.querySelector('#fullscreen').onclick=()=>document.documentElement.requestFullscreen();document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]'))return;if(['ArrowRight','PageDown',' '].includes(e.key)){e.preventDefault();show(current+1)}if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();show(current-1)}if(e.key==='Home')show(0);if(e.key==='End')show(pages.length-1)});addEventListener('resize',size);show(Math.max(0,pages.findIndex(p=>p.id===location.hash.slice(1))));size();window.chapterReady=Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode())]).then(()=>{alignGraphicLabels(pages[current])});
</script></body></html>`
}
